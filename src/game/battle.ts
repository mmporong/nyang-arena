import { BALANCE } from "./balance.ts";
import { BOSS_ANCHORS, BOSS_BREEDS, BOSS_THRESHOLDS, bossKit, TELEGRAPH_FUSE_MS, type BossKit } from "./bosses.ts";
import { rng } from "./rng.ts";
import {
  BOARD_COLS,
  BOARD_ROWS,
  ENEMY_FRONT_FX,
  cellRow,
  cellToField,
  fieldDistance,
  livingCats,
  surfaceDistance,
  MANA_MAX,
  type Cat,
  type ClassKind,
  type Intervention,
  type Side,
  type Telegraph,
  type TelegraphMode,
  type TelegraphShape,
} from "./types.ts";
import {
  COMBO_MAX,
  COMBO_STEP,
  PASSIVES,
  RICOCHET_MUL,
  RICOCHET_TARGETS,
  runSkill,
  SKILLS,
  type SkillResult,
} from "./skills.ts";
import {
  bossRampFor,
  currentKind,
  finishWave,
  KITTEN,
  makeSummon,
  MIRROR_IMAGE,
  relicActive,
  type RunState,
  type SummonSpec,
} from "./run.ts";

/** 고정 시뮬레이션 스텝. */
export const SIM_STEP_MS = 100;

/**
 * 교착 방지 상한. 이 시간을 넘기면 패배로 처리한다.
 *
 * 처음에는 남은 체력 비율로 판정했는데, 탱키하고 회피 높은 조합이 아무도 죽이지
 * 못한 채 매 웨이브 타임아웃 승리를 가져가며 런이 끝나지 않았다(시뮬 15%가 상한
 * 도달). 이동이 들어가면서 전투가 1~2초 길어졌으므로 상한도 함께 올렸다.
 */
const BATTLE_TIMEOUT_MS = 16_000;
/**
 * 보스는 오래 싸운다. 예고→회피 사이클이 여러 번 돌아야 레이드가 되기 때문이다.
 *
 * 늘려도 예전의 "탱키 조합이 매 웨이브 타임아웃 승리로 런이 안 끝남" 회귀는
 * 되살아나지 않는다. 그 버그는 타임아웃을 **체력 비율로 판정**했기 때문이었고,
 * 지금은 타임아웃이 곧 패배다. 시간을 끌어 봐야 지는 것은 같다.
 */
const BOSS_TIMEOUT_MS = 150_000;

function battleTimeout(state: RunState): number {
  // 성격은 지도가 정한다. 웨이브 번호로 판단하면 상점을 밟은 뒤 어긋난다.
  return currentKind(state) === "boss" ? BOSS_TIMEOUT_MS : BATTLE_TIMEOUT_MS;
}

const POSE_WINK_MS = 500;
const POSE_MOVE_MS = 260;
const FLASH_MS = 160;

/**
 * 같은 편끼리 겹쳐 서지 않게 하는 최소 간격(칸).
 *
 * 스프라이트를 0.66칸으로 줄였으므로 1.0이면 유닛 사이에 확실히 틈이 생긴다.
 * 0.55 → 0.8 → 1.0 순으로 키웠는데, 좁을수록 근접이 한 덩어리로 뭉쳐 보였다.
 * 더 키우면 뒷줄 근접이 사거리 안에 못 들어와 전투가 늘어지므로 여기서 멈춘다.
 */
const SEPARATION = 1.0;

/**
 * 이미 그 적을 노리는 아군 한 명당 더해지는 거리 페널티(칸).
 * 순수 최단거리로만 고르면 근접이 전부 같은 적에게 달려들어 한 점에 쌓인다.
 */
const CROWD_PENALTY = 0.7;

/**
 * 도발이 타겟 점수에서 깎는 값(칸).
 *
 * `pickTarget`은 **거리 + 몰림**으로만 고른다. 미끼는 여기서 거리를 그만큼
 * 당겨 온 것처럼 보이게 만든다 — 무한이 아니라 유한한 값인 것이 중요하다.
 * 무한이면 판 반대편의 미끼에게도 전부 달려가 진형이 통째로 무너지고,
 * 그러면 도발이 "누가 맞을지 바꾸는 것"이 아니라 "적을 끌고 다니는 것"이
 * 된다. 판의 최대 거리가 11칸쯤이므로 4는 "가까운 것들 사이에서는 이기고
 * 판 건너편까지는 못 끄는" 크기다.
 */
const TAUNT_PULL = 4;

/**
 * 예고가 터질 때의 연출 색. 전투 모듈이 테마를 임포트하지 않도록 리터럴로 둔다.
 *
 * 예고 색과 반드시 같아야 한다 — 붉은 장판이 뜨고 초록이 터지면 방금 무엇을
 * 맞았는지가 안 이어진다. theme.ts의 danger/gather와 같은 값이다.
 */
const FX_DANGER = "#FF3F6E";
const FX_GATHER = "#2BE3B4";

/** 전사가 피격 한 번에 얻는 마나 */
const MANA_ON_HIT_WARRIOR = 11;

/** 렌더러가 화면 좌표로 옮겨 띄우는 1회성 연출. */
export interface DamagePop {
  fx: number;
  fy: number;
  text: string;
  life: number;
  crit: boolean;
  /** 회복이면 참. 색이 갈려야 깎인 것과 헷갈리지 않는다. */
  heal?: boolean;
  /**
   * 같은 프레임에 뜬 몇 번째 숫자인가.
   *
   * 전에는 난수 흩뿌리기였는데, 셋이 동시에 뜨면 여전히 붙어서 `72 61`처럼
   * 읽혔다. 계단으로 밀면 겹칠 자리 자체가 없어진다.
   */
  step: number;
}

/** 원거리 공격 연출. 피해는 즉시 적용되고 이것은 순수 시각 효과다. */
export interface Shot {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  life: number;
  ally: boolean;
}

export const POP_LIFE_MS = 520;
export const SHOT_LIFE_MS = 220;

export const damagePops: DamagePop[] = [];
export const shots: Shot[] = [];

/**
 * 연출 조각. 스킬마다 생김새가 달라야 무엇이 터졌는지 눈으로 구분된다.
 *
 * 판정과 완전히 분리돼 있다 — 이 배열이 비어 있어도 전투 결과는 같다.
 * 그래서 헤드리스 시뮬은 이걸 무시하고 돌 수 있다.
 */
export type FxKind =
  | "ring" // 퍼지는 고리 (회전베기·대지 강타·서리 발톱)
  | "slash" // 호를 그리는 참격 (연속 찌르기)
  | "beam" // 직선 광선 (꿰뚫기)
  | "streak" // 짧은 돌진 자국 (그림자 일격)
  | "spark" // 튀는 불똥 (타격 지점)
  | "ember" // 위로 떠오르는 불티 (불씨)
  | "frost" // 얼음 결정 (빙결)
  | "burst" // 장판 모양 그대로 채워지는 섬광 (예고 발동)
  | "bossdeath" // 보스가 죽는 순간의 확장 링 3겹
  | "phaseShift"; // 우두머리가 페이즈 2로 갈아타는 순간 (1회성). render.ts가 충격파 링과 플래시로 그린다.

export interface Fx {
  kind: FxKind;
  fx: number;
  fy: number;
  /** beam·streak·slash가 향하는 곳 */
  tx: number;
  ty: number;
  radius: number;
  angle: number;
  life: number;
  maxLife: number;
  color: string;
  /** `bossdeath` 전용 — 우두머리 처치인가. 렌더의 흔들림 진폭이 갈린다. */
  stageBoss?: boolean;
  /**
   * `burst` 전용 — 예고 장판의 모양을 그대로 옮겨 적는다.
   *
   * `Telegraph`와 필드 이름을 맞췄다. `fireTelegraph`가 터지는 예고에서 그대로
   * 복사해 넣으므로, 렌더러가 원형·직선·부채꼴 채우기를 `drawTelegraphs`와
   * 같은 식으로 그릴 수 있다.
   */
  shape?: TelegraphShape;
  dirX?: number;
  dirY?: number;
  arg?: number;
  reach?: number;
}

export const fxs: Fx[] = [];

/**
 * 연출 큐를 전부 비운다. 새 런을 시작할 때 부른다.
 *
 * 이 셋은 모듈 전역이라 런을 넘어 살아남는다. 예전에는 재시작 경로가
 * damagePops만 비워서, '다시 도전' 직후 첫 프레임에 지난 런의 참격과
 * 화살이 그려졌다.
 */
export function clearBattleFx(): void {
  fxs.length = 0;
  damagePops.length = 0;
  shots.length = 0;
}

function pushFx(f: Omit<Fx, "maxLife"> & { maxLife?: number }): void {
  if (fxs.length > 90) fxs.shift();
  fxs.push({ ...f, maxLife: f.maxLife ?? f.life });
}

export const BURST_LIFE_MS = 320;

/**
 * 상점에서 일어난 일을 판 위에 알린다.
 *
 * 카드를 누르면 생선이 줄고 카드가 사라지는데, **정작 무엇이 어디에 생겼는지는
 * 보드를 뒤져야 알 수 있었다.** 새 고양이가 어느 칸에 앉았는지 못 찾아 같은
 * 카드를 두 번 누르는 일이 생긴다. 산 자리에서 뭔가 터지면 눈이 거기로 간다.
 *
 * `fxs`는 국면과 무관하게 그려지고 필드 좌표를 쓰므로 상점·배치 화면에서도
 * 그대로 나온다. 판정에는 전혀 관여하지 않는다 — 헤드리스 시뮬은 이 배열을
 * 무시하고 돌고, 그래서 시뮬 결과가 이 함수 때문에 바뀌지 않는다.
 */
export function spawnArrivalFx(fx: number, fy: number): void {
  pushFx({ kind: "ring", fx, fy, tx: fx, ty: fy, radius: 1.1, angle: 0, life: 520, color: "#F0BA4A" });
  for (let i = 0; i < 7; i++) {
    pushFx({
      kind: "spark",
      fx,
      fy,
      tx: fx,
      ty: fy,
      radius: 0.55,
      angle: (i / 7) * Math.PI * 2,
      life: 420,
      color: i % 2 === 0 ? "#F4E3C1" : "#F0BA4A",
    });
  }
}

/**
 * 레벨이 올랐다. 도착과 달리 **위로 솟는다** — 같은 자리에서 일어나는 다른
 * 일이므로 모양으로 갈라야 무엇이 일어났는지 읽힌다.
 */
export function spawnLevelUpFx(fx: number, fy: number, level: number): void {
  pushFx({ kind: "ring", fx, fy, tx: fx, ty: fy, radius: 0.9, angle: 0, life: 560, color: "#F0BA4A" });
  for (let i = 0; i < 9; i++) {
    pushFx({
      kind: "ember",
      fx: fx + (i / 9 - 0.5) * 0.8,
      fy,
      tx: fx,
      ty: fy - 1.2,
      radius: 0.3,
      angle: 0,
      life: 620,
      color: i % 3 === 0 ? "#FFE24A" : "#F0BA4A",
    });
  }
  pop({ fx, fy } as Cat, `Lv ${level}`, true);
}


/** 렌더러가 시전 이름표를 그릴 때 쓴다. */
export function skillName(cat: Cat): string {
  if (cat.breed.skill) return SKILLS[cat.breed.skill].name;
  if (cat.breed.passive) return PASSIVES[cat.breed.passive].name;
  return "";
}

function pop(target: Cat, text: string, crit: boolean, heal = false): void {
  if (damagePops.length > 16) damagePops.shift();
  // 같은 자리에 아직 떠 있는 숫자를 센다. 같은 프레임만 세면 보스처럼 여럿에게
  // 연달아 맞는 대상에서 전부 step 0으로 겹쳤다(실제로 그랬다 — 보스 털 위에
  // 38이 다섯 개 쌓였다). 난수가 아니라 이 개수로 계단을 만들므로 같은 시드는
  // 여전히 같은 화면을 낸다.
  //
  // 넷에서 되돌린다. 계단이 끝없이 길어지면 판 밖으로 나간다.
  const near = damagePops.filter(
    (p) => Math.abs(p.fx - target.fx) < 0.7 && Math.abs(p.fy - target.fy) < 0.7,
  ).length;
  const step = near % 4;
  damagePops.push({
    fx: target.fx,
    fy: target.fy,
    text,
    life: POP_LIFE_MS,
    crit,
    heal,
    step,
  });
}

/**
 * 가장 가까운 적을 노린다.
 *
 * 예전에는 열 순서(앞줄 우선)로 골랐는데, 유닛이 실제로 움직이기 시작하면
 * 거리 기준이 자연스럽다. 근접은 알아서 앞줄에 붙고, 원거리는 사거리 안에
 * 들어온 가장 가까운 적을 친다. 거리가 같으면 uid로 갈라 결정적으로 만든다.
 */
export function pickTarget(attacker: Cat, foes: Cat[], claimed?: Map<string, number>): Cat | null {
  let best: Cat | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const f of foes) {
    // 순간이동 부재("gone") 중인 보스는 실제로 거기 없다 — 후보에서 뺀다.
    // `foes`가 이 하나뿐이면 이번 스텝은 아무도 못 찾는다(호출부가 감당한다).
    if (f.blink && f.blink.phase === "gone") continue;
    const crowd = claimed?.get(f.uid) ?? 0;
    const score = fieldDistance(attacker, f) + crowd * CROWD_PENALTY - (f.taunt ? TAUNT_PULL : 0);
    if (score < bestScore || (score === bestScore && best !== null && f.uid < best.uid)) {
      bestScore = score;
      best = f;
    }
  }
  return best;
}

/** 패시브 "연격" — 같은 적을 계속 때리면 공격 속도가 붙는다. */
function comboSpeed(cat: Cat): number {
  if (cat.breed.passive !== "combo") return 1;
  return 1 + Math.min(COMBO_MAX, cat.combo) * COMBO_STEP;
}

/** 실제 피해 적용. 보호막을 먼저 깎는다. */
function damage(target: Cat, amount: number, crit: boolean): void {
  /**
   * 순간이동 부재("gone") 중인 보스는 아예 없는 것으로 친다.
   *
   * `pickTarget`이 이미 후보에서 뺐으니 평타·도탄은 여기 안 들어오지만,
   * 지속 피해(`tickEffects`의 `dot`)는 대상을 다시 고르지 않고 이미 걸린
   * 대상을 그대로 때린다 — 그 경로까지 막아야 "때릴 수 없다"가 어디서나
   * 같은 말이 된다.
   */
  if (target.blink && target.blink.phase === "gone") return;
  let left = Math.round(amount);
  if (target.shield > 0) {
    const absorbed = Math.min(target.shield, left);
    target.shield -= absorbed;
    left -= absorbed;
  }
  /**
   * 피격 반응은 **보호막이 전부 막았을 때도** 일어난다.
   *
   * 전에는 흡수되면 여기서 바로 빠져나갔다. 그때는 보호막을 거는 코드가
   * 아예 없어서(감싸기가 처음이다) 드러나지 않았을 뿐이다. 그대로 두면
   * **보호막을 받은 전사는 피격 마나가 안 차서** 스킬이 늦어진다 — 지키는
   * 축을 넣었더니 전사 마나 엔진이 꺼지는, 아무도 의도하지 않은 상호작용이다.
   *
   * 전사 피격 마나 자체의 근거: 측정에서 전사 스킬이 원거리의 3~6분의
   * 1밖에 안 나갔다. 4번 때려야 하는데 걸어가는 시간까지 있어서다. TFT도
   * 탱커에게 피격 마나를 주는데, 앞에서 두들겨 맞는 역할이 곧 마나 엔진이
   * 되므로 정체성과도 맞는다. 쓸 스킬이 없으면 채워 봐야 쓸 데가 없다 —
   * 보스는 전사이면서 스킬이 없어서 마나바가 가득 찬 채로 영원히 떠 있었다.
   */
  target.flash = FLASH_MS;
  if (target.breed.cls === "warrior" && target.breed.skill) {
    target.mana = Math.min(MANA_MAX, target.mana + MANA_ON_HIT_WARRIOR);
  }
  if (left <= 0) {
    pop(target, "막힘", false);
    return;
  }
  target.hp -= left;
  pop(target, String(left), crit);
  if (target.hp <= 0) {
    target.hp = 0;
    target.alive = false;
    target.pose = "sleep";
    target.poseTimer = 0;
    // 죽으면 달리기도 끝난다. `tickDashes`는 살아 있는 것만 도는 탓에, 여기서
    // 안 지우면 목표가 시체에 붙어 다음 전투까지 따라간다.
    target.dash = null;
    /**
     * 보스가 죽어도 예고·순간이동 페이드를 지우지 않으면 흔적이 남는다.
     *
     * `tickBoss`는 맨 위에서 `if (!boss.alive) return;`이라 죽은 보스는 다시는
     * 자기 상태를 정리하지 못한다. 예고를 안 지우면 죽은 보스 밑에 빨간 장판이
     * 영원히 그려지고(실제로 있었던 버그), `blink`를 안 지우면 순간이동 중에
     * 죽었을 때 반쯤 사라진 채로 화면에 얼어붙는다.
     */
    target.telegraph = null;
    target.blink = null;
    // 저격수(미니 보스)는 뺀다 — 확장 링 3겹·화면 흔들림은 진짜 레이드 보스의
    // 처치에만 어울리는 무게다.
    if (isRaidBoss(target)) spawnBossDeathFx(target);
  }
}

/**
 * 진짜 레이드 보스인가.
 *
 * `BOSS_BREEDS` 소속 여부로 가른다. 저격수(`SNIPER_BREED`, id 12)도 반경이
 * 있고 `bossKit`도 갖지만 `BOSS_BREEDS` 배열엔 없다 — 저격 웨이브의 예고편일
 * 뿐이라 보스 처치 연출을 받을 만큼 무게가 있는 존재가 아니다.
 * `scripts/invariants.mjs`가 보스를 가르는 것과 같은 기준이다(`id <= 11`).
 */
function isRaidBoss(cat: Cat): boolean {
  return BOSS_BREEDS.some((b) => b.id === cat.breed.id);
}

/** 보스 처치 연출 길이(ms). render.ts는 이 kind의 Fx가 살아 있는 동안만 화면을 흔든다. */
export const BOSS_DEATH_FX_MS = 620;

/**
 * 보스 처치 연출 — 확장 링 3겹 + 파편.
 *
 * 화면 흔들림은 여기서 만들지 않는다. battle.ts는 카메라를 모르는 채로 있어야
 * 헤드리스 하네스가 이 함수를 그대로 돌릴 수 있다 — 흔들림은 render.ts가
 * `bossdeath` kind의 Fx가 살아 있는지만 보고 그린다.
 */
function spawnBossDeathFx(boss: Cat): void {
  pushFx({
    kind: "bossdeath",
    fx: boss.fx,
    fy: boss.fy,
    tx: 0,
    ty: 0,
    radius: boss.radius,
    angle: 0,
    life: BOSS_DEATH_FX_MS,
    color: FX_DANGER,
    // 흔들림 진폭이 이걸 읽는다. state.step은 처치 직후 올라가므로 못 쓴다.
    stageBoss: boss.stageBoss === true,
  });
  // 파편. 기존 spawnArrivalFx와 같은 모양의 방사형 스파크라 낯설지 않다.
  for (let i = 0; i < 14; i++) {
    pushFx({
      kind: "spark",
      fx: boss.fx,
      fy: boss.fy,
      tx: 0,
      ty: 0,
      radius: 1.1,
      angle: (i / 14) * Math.PI * 2,
      life: 480,
      color: i % 2 === 0 ? "#F4E3C1" : FX_DANGER,
    });
  }
}

/**
 * 스킬 발동. 마나가 가득 찬 순간 평타 대신 이것이 나간다.
 *
 * 결과 계산은 skills.ts가 하고 여기서는 적용과 연출만 한다. 그래야 브라우저와
 * 헤드리스 시뮬이 같은 판정을 쓴다.
 */
/**
 * 스킬을 쓴다. **아무 일도 못 하면 쓰지 않고 거짓을 돌려준다.**
 *
 * 핥아주기는 전원 만피면 회복할 대상이 없다. 그런데 예전에는 그래도
 * 마나를 0으로 밀고 그 틱의 평타까지 건너뛰었다 — 발동할수록 손해였다.
 * 다른 일곱 스킬도 대상이 없을 수 있으므로 한 자리에서 막는다.
 */
function castSkill(
  state: RunState,
  caster: Cat,
  target: Cat,
  foes: Cat[],
  allies: Cat[],
): boolean {
  const res = runSkill(caster, target, foes, allies);
  if (
    res.hits.length === 0 &&
    res.stuns.length === 0 &&
    res.dots.length === 0 &&
    res.heals.length === 0 &&
    res.shields.length === 0 &&
    res.summons.length === 0
  ) {
    return false;
  }

  /**
   * **소환을 먼저 시도한다.** 상한에 막혀 한 마리도 못 내면 그 스킬은 아무
   * 일도 안 한 것이고, 마나를 태우기 전에 그것을 알아야 한다. 위의 빈 결과
   * 검사는 `runSkill`의 **의도**만 보므로 여기까지 와야 **결과**를 안다.
   */
  const born: Cat[] = [];
  for (const { spec } of res.summons) {
    const made = summon(state, caster, spec);
    if (made === 0) continue;
    for (const sm of state.summons.slice(-made)) {
      // 버팀목처럼 세우면서 보호막을 두르는 사양이 있다. 시전 시점에는 그 몸이
      // 아직 없으므로 `runSkill`의 `shields`로는 표현할 수 없다.
      if (spec.shieldFrac) sm.shield = Math.max(sm.shield, Math.round(sm.maxHp * spec.shieldFrac));
      born.push(sm);
    }
  }
  // 소환만 하는 스킬이 한 마리도 못 냈으면 마나를 안 태우고 평타로 떨어진다.
  if (
    born.length === 0 &&
    res.hits.length === 0 &&
    res.stuns.length === 0 &&
    res.dots.length === 0 &&
    res.heals.length === 0 &&
    res.shields.length === 0
  ) {
    return false;
  }

  caster.mana = res.manaRefund;
  caster.castFlash = 700;
  caster.pose = "wink";
  caster.poseTimer = POSE_WINK_MS;

  spawnSkillFx(caster, target, res);

  for (const h of res.hits) {
    if (!h.target.alive) continue;
    damage(h.target, caster.atk * h.mul, true);
    // 맞은 자리마다 불똥. 몇 명이 맞았는지 눈으로 세어진다.
    pushFx({
      kind: "spark",
      fx: h.target.fx,
      fy: h.target.fy,
      tx: h.target.fx,
      ty: h.target.fy,
      radius: 0.5,
      angle: Math.random() * Math.PI * 2,
      life: 260,
      color: CLASS_FX[caster.breed.cls],
    });
  }
  for (const s of res.stuns) {
    if (!s.target.alive) continue;
    s.target.stun = Math.max(s.target.stun, s.ms);
  }
  for (const d of res.dots) {
    if (!d.target.alive) continue;
    d.target.dot = { dps: d.dps, remain: d.ms };
  }
  for (const h of res.heals) {
    if (!h.target.alive) continue;
    // 최대치를 넘지 않는다. 넘게 두면 불변식(`체력이 최대를 넘는다`)이 깨진다.
    const before = h.target.hp;
    h.target.hp = Math.min(h.target.maxHp, h.target.hp + h.amount);
    const got = Math.round(h.target.hp - before);
    // 0이면 띄우지 않는다. 만피인 고양이 위로 "+0"이 뜨면 스킬이 헛돈 것처럼 보인다.
    if (got > 0) {
      pop(h.target, `+${got}`, false, true);
      pushFx({
        kind: "ring",
        fx: h.target.fx,
        fy: h.target.fy,
        tx: h.target.fx,
        ty: h.target.fy,
        radius: 0.75,
        angle: 0,
        life: 520,
        color: "#8FD9A8",
      });
    }
  }
  for (const sh of res.shields) {
    if (!sh.target.alive) continue;
    // 쌓지 않고 **더 큰 쪽으로 덮는다.** 쌓이면 전사 둘이 감싸기를 번갈아 써서
    // 보호막만으로 판을 버티게 된다.
    sh.target.shield = Math.max(sh.target.shield, sh.amount);
    pushFx({
      kind: "ring",
      fx: sh.target.fx,
      fy: sh.target.fy,
      tx: sh.target.fx,
      ty: sh.target.fy,
      radius: 0.68,
      angle: 0,
      life: 460,
      color: "#9ED0F0",
    });
  }

  for (const sm of born) {
    pushFx({
      kind: "ring",
      fx: sm.fx,
      fy: sm.fy,
      tx: sm.fx,
      ty: sm.fy,
      radius: 0.7,
      angle: 0,
      life: 480,
      color: CLASS_FX.summoner,
    });
  }

  return true;
}

/**
 * 직업별 이펙트 색.
 *
 * **`Record<string, string>`이 아니라 `Record<ClassKind, string>`이다.**
 * 전자였을 때는 직업을 늘려도 타입 검사가 통과하고, 새 직업의 스킬만 조용히
 * 흰색(`?? "#FFFFFF"`)으로 나왔다. 색이 빠진 것을 화면에서 알아채기 전까지
 * 아무도 모른다. 지금은 여기를 안 채우면 컴파일이 안 된다.
 */
const CLASS_FX: Record<ClassKind, string> = {
  warrior: "#FF9E5A",
  rogue: "#D98BE8",
  archer: "#FFC46B",
  mage: "#8FD4FF",
  summoner: "#8E9BFF",
};

/** 스킬마다 다른 연출을 뿌린다. 무엇이 터졌는지 색과 모양으로 구분되게. */
function spawnSkillFx(caster: Cat, target: Cat, res: SkillResult): void {
  const color = CLASS_FX[caster.breed.cls];
  const base = { fx: caster.fx, fy: caster.fy, tx: target.fx, ty: target.fy, angle: 0, color };

  switch (caster.breed.skill) {
    case "whirlwind": {
      // 두 겹 고리 + 회전하는 참격 넷
      pushFx({ ...base, kind: "ring", radius: 1.7, life: 420 });
      pushFx({ ...base, kind: "ring", radius: 1.2, life: 300 });
      for (let i = 0; i < 4; i++) {
        pushFx({ ...base, kind: "slash", radius: 1.5, angle: (Math.PI / 2) * i, life: 340 });
      }
      break;
    }
    case "shockwave": {
      // 두껍고 느린 고리. 땅이 갈라지는 느낌
      pushFx({ ...base, kind: "ring", radius: 2.0, life: 560 });
      pushFx({ ...base, kind: "ring", radius: 1.1, life: 380 });
      break;
    }
    case "shadow_strike": {
      const prey = res.hits[0]?.target ?? target;
      pushFx({ ...base, kind: "streak", tx: prey.fx, ty: prey.fy, radius: 0.5, life: 260 });
      pushFx({ ...base, kind: "ring", fx: prey.fx, fy: prey.fy, radius: 0.9, life: 320 });
      break;
    }
    case "pierce": {
      // 목표 너머까지 뻗는 광선
      const dx = target.fx - caster.fx;
      const dy = target.fy - caster.fy;
      const len = Math.hypot(dx, dy) || 1;
      pushFx({
        ...base,
        kind: "beam",
        tx: caster.fx + (dx / len) * 9,
        ty: caster.fy + (dy / len) * 9,
        radius: 0.34,
        life: 320,
      });
      break;
    }
    case "ember": {
      // 떠오르는 불티 여러 개
      for (let i = 0; i < 7; i++) {
        pushFx({
          ...base,
          kind: "ember",
          fx: target.fx + (Math.random() - 0.5) * 0.7,
          fy: target.fy + (Math.random() - 0.5) * 0.5,
          radius: 0.12 + Math.random() * 0.1,
          life: 620 + Math.random() * 320,
          color: "#D08A4A",
        });
      }
      break;
    }
    case "frost_nova": {
      pushFx({ ...base, kind: "ring", fx: target.fx, fy: target.fy, radius: 1.5, life: 460, color: "#8FB6D0" });
      for (const h of res.hits) {
        pushFx({
          kind: "frost",
          fx: h.target.fx,
          fy: h.target.fy,
          tx: h.target.fx,
          ty: h.target.fy,
          radius: 0.42,
          angle: Math.random() * Math.PI,
          life: 900,
          color: "#A9CBDE",
        });
      }
      break;
    }
  }
}

function attack(attacker: Cat, target: Cat): void {
  attacker.pose = "move";
  attacker.poseTimer = POSE_MOVE_MS;
  attacker.lunge = 1;

  if (attacker.breed.kind === "ranged") {
    if (shots.length > 32) shots.shift();
    shots.push({
      fromX: attacker.fx,
      fromY: attacker.fy,
      toX: target.fx,
      toY: target.fy,
      life: SHOT_LIFE_MS,
      ally: attacker.side === "ally",
    });
  }

  // 마나는 빗나가도 찬다. TFT도 on-attack 기준이다.
  attacker.mana = Math.min(MANA_MAX, attacker.mana + attacker.breed.manaPerAttack);

  if (rng() < target.evade) {
    pop(target, "빗나감", false);
    return;
  }

  // 연격: 같은 대상이면 쌓이고, 바뀌면 처음부터
  if (attacker.breed.passive === "combo") {
    if (attacker.comboTarget === target.uid) attacker.combo = Math.min(COMBO_MAX, attacker.combo + 1);
    else {
      attacker.comboTarget = target.uid;
      attacker.combo = 1;
    }
  }

  damage(target, attacker.atk, attacker.atk >= target.maxHp * 0.35);

  if (!target.alive) {
    attacker.pose = "wink";
    attacker.poseTimer = POSE_WINK_MS;
  }
}

/** 패시브 "도탄" — 가까운 다른 적 둘에게도 튄다. */
function ricochet(attacker: Cat, target: Cat, foes: Cat[]): void {
  if (attacker.breed.passive !== "ricochet") return;
  const others = foes
    .filter((f) => f !== target && f.alive)
    .sort((a, b) => fieldDistance(target, a) - fieldDistance(target, b))
    .slice(0, RICOCHET_TARGETS);

  for (const f of others) {
    pushFx({
      kind: "beam",
      fx: target.fx,
      fy: target.fy,
      tx: f.fx,
      ty: f.fy,
      radius: 0.12,
      angle: 0,
      life: 220,
      color: CLASS_FX.archer,
    });
    damage(f, attacker.atk * RICOCHET_MUL, false);
  }
}

/**
 * 회피 직후 이동 금지 시간.
 *
 * 이게 없으면 빼낸 고양이가 다음 틱부터 목표를 향해 걸어 돌아간다. 도적은
 * 0.6초면 위험 구간에 다시 들어가므로, 회피가 회피가 아니게 된다.
 */
const DODGE_LOCK_MS = 1400;

/** 한 스텝에 소비하는 의도 수와 큐 상한. 브라우저와 봇을 같은 규칙에 묶는다. */
const PENDING_CAP = 4;

/**
 * 회피·뭉침을 쓴 뒤 버튼이 잠기는 시간(ms).
 *
 * 연타로 자원이 새지는 않게 이미 막았지만(달리는 중인 고양이는 다시 세지 않는다),
 * 그건 "손해는 없다"일 뿐이고 누른 것이 손에 남지는 않는다. 한 번 누르면 잠기는
 * 편이 무엇을 썼는지 분명하다. 예고 도화선이 1.2초이므로 1초는 **한 예고에 한
 * 번**이라는 뜻이 된다.
 */
const ACT_COOLDOWN_MS = 1000;

/**
 * 위험 구간 밖의 가장 가까운 자리를 찾는다.
 *
 * 각도와 거리를 고정 격자로 훑는다 — 난수를 쓰면 같은 시드에서도 회피 결과가
 * 갈려 개입의 값을 잴 수 없다.
 */
/**
 * 장판을 벗어난 뒤 더 확보하는 여유(칸).
 *
 * 전에는 "안전한 첫 자리"를 그대로 돌려줬는데, 그건 **장판 경계 바로 바깥**이다.
 * 판정은 통과하지만 겹침 밀어내기가 한 번만 건드려도 도로 안으로 들어간다 —
 * 계측에서 붉은 예고에 걸린 고양이의 40%가 "나갔다가 다시 들어간" 경우였다.
 * 사람 눈에는 눌러서 피했는데 맞은 것으로 보인다.
 */
const DODGE_MARGIN = 0.6;

function safeSpot(cat: Cat, zones: Telegraph[]): { fx: number; fy: number } | null {
  const risky = (fx: number, fy: number) =>
    zones.some((z) => inTelegraph(z, fx, fy, BALANCE.telegraphBodyPad));
  if (!risky(cat.fx, cat.fy)) return null; // 안전하면 움직이지 않는다

  // 오른쪽 상한이 없었다. 판 끝(fx 11.8)에 선 고양이가 오른쪽으로 피하면
  // 12.25에 착지했다 — 세로와 왼쪽만 막혀 있었다.
  const onBoard = (fx: number, fy: number) =>
    fy >= -0.3 && fy <= BOARD_ROWS - 1 + 0.3 && fx >= -0.3 && fx <= FIELD_MAX_FX + 0.3;

  for (let ring = 1; ring <= 9; ring++) {
    const r = ring * 0.55;
    for (let a = 0; a < 12; a++) {
      const ang = (a / 12) * Math.PI * 2;
      const fx = cat.fx + Math.cos(ang) * r;
      const fy = cat.fy + Math.sin(ang) * r;
      // 보드 밖으로 도망가지는 못한다. 피할 자리가 없으면 맞는 게 맞다.
      if (!onBoard(fx, fy) || risky(fx, fy)) continue;
      // 같은 방향으로 조금 더 밀어 **경계에 걸치지 않게** 한다. 더 간 자리가
      // 판 밖이거나 다시 위험하면 원래 자리를 쓴다 — 여유는 보너스지 조건이 아니다.
      const mx = cat.fx + Math.cos(ang) * (r + DODGE_MARGIN);
      const my = cat.fy + Math.sin(ang) * (r + DODGE_MARGIN);
      if (onBoard(mx, my) && !risky(mx, my)) return { fx: mx, fy: my };
      return { fx, fy };
    }
  }
  return null;
}

/**
 * 약점 공격. 취약 창이 열린 보스에게만 들어간다.
 *
 * 연타가 콤보로 쌓여 배수가 붙는다. 창이 닫히면 콤보도 0으로 돌아가므로,
 * "언제 창이 열리는지 알고 준비했다가 몰아치는 것"이 보상받는다 —
 * WoW 레이드의 버스트 창과 같은 구조다.
 */
function doStrike(state: RunState): boolean {
  // 부재(gone) 중인 보스는 대상이 아니다 — damage()가 어차피 0으로 막는데
  // 여기서 콤보만 오르면 "때렸는데 안 깎이는" 거짓 화면이 된다.
  const boss = state.enemy.find(
    (c) => c?.alive && c.radius > 0 && c.vulnerableMs > 0 && !(c.blink && c.blink.phase === "gone"),
  );
  if (!boss) return false;

  boss.strikeCombo = Math.min(BALANCE.strikeComboMax, boss.strikeCombo + 1);
  const mul = 1 + boss.strikeCombo * BALANCE.strikeComboStep;
  damage(boss, Math.max(1, Math.round(boss.maxHp * BALANCE.strikeFrac * mul)), boss.strikeCombo >= 6);
  pushFx({
    kind: "slash",
    fx: boss.fx,
    fy: boss.fy,
    tx: 0,
    ty: 0,
    radius: boss.radius * 0.8,
    angle: (boss.strikeCombo % 6) * 0.5,
    life: 200,
    color: "#F0BA4A",
  });
  return true;
}

/**
 * 뭉침 장판 **안으로** 아군을 모은다.
 *
 * 흩어짐과 정확히 반대 동작이다. 붉은 장판에 이걸 쓰면 위험 한가운데로
 * 모이므로, 어느 장판인지 읽지 못하면 벌을 받는다.
 */
function doGather(state: RunState): boolean {
  const zones: Telegraph[] = [];
  for (const e of state.enemy) if (e?.telegraph) zones.push(e.telegraph);
  const target = zones[0];
  if (!target) return false;

  let moved = false;
  // 소환수도 함께 움직인다. 분신만 장판에 남아 녹으면 화면에서는
  // "눌렀는데 안 피했다"로 읽힌다 — 어느 것이 분신인지 사람은 모른다.
  for (const c of allyBodies(state)) {
    // 흩어짐과 같은 이유. 달리는 중인 고양이는 이미 대답한 것이다.
    if (c.dash) continue;
    if (inTelegraph(target, c.fx, c.fy, BALANCE.telegraphBodyPad)) continue;
    // 장판 중심 쪽으로 당긴다. 가장자리에 걸치면 판정이 아슬아슬해지므로
    // 반경의 60% 안쪽으로 넣는다.
    const dx = target.fx - c.fx;
    const dy = target.fy - c.fy;
    const d = Math.hypot(dx, dy) || 1;
    const pull = Math.max(0, d - target.arg * 0.6);
    const tx = c.fx + (dx / d) * pull;
    const ty = c.fy + (dy / d) * pull;
    // 흩어짐과 같은 이유로 도착할 수 있는 것만 센다. 뭉침은 거리가 더 멀어
    // (실측 2.2칸 · 366ms) 늦게 누르면 더 잘 걸린다.
    if (dashMs(c, tx, ty) <= target.fuse) moved = true;
    startDash(c, tx, ty, "#6E97C4");
  }
  return moved;
}

/**
 * 개입 이동 속도(필드 단위/초).
 *
 * 걸음(1.0~2.4)의 네 배쯤이다. 이보다 느리면 예고가 터지기 전에 못 빠져나가고,
 * 이보다 빠르면 다시 순간이동으로 보인다. 가장 먼 안전지대가 2.5칸쯤이라
 * 최악이 280ms — 예고 도화선 1200ms 안에 넉넉히 끝난다.
 */
const DASH_SPEED = 9;

/**
 * 이 거리를 달리는 데 걸리는 시간(ms). 도화선과 견주려고 따로 뺐다.
 */
function dashMs(c: Cat, tx: number, ty: number): number {
  return (Math.hypot(tx - c.fx, ty - c.fy) / DASH_SPEED) * 1000;
}

/**
 * 목표만 적어 둔다. 실제 이동은 `tickDashes`가 스텝마다 나눠서 한다.
 *
 * 도착 여부는 여기서 안 본다 — 부르는 쪽이 도화선과 견줘서 정하고, 이 함수는
 * 시키는 대로 출발시킨다. 못 갈 거리라도 달리기는 시작하는 편이 낫다. 눌렀는데
 * 아무도 안 움직이면 입력이 먹었는지조차 알 수 없다.
 *
 * `speed`와 `lock`을 부르는 쪽이 정하는 이유는 두 쓰임의 성격이 다르기
 * 때문이다. 개입은 **짧게 옮기고 그 자리를 지켜야** 하고(안 그러면 곧장
 * 위험 구간으로 걸어 돌아간다), 도적 도약은 **멀리 건너가 곧바로 싸워야**
 * 한다. 같은 값을 쓰면 둘 중 하나가 반드시 망가진다.
 */
function startDash(
  c: Cat,
  tx: number,
  ty: number,
  color: string,
  speed: number = DASH_SPEED,
  lock: number = DODGE_LOCK_MS,
): void {
  c.dash = { tx, ty, speed };
  c.moveLock = lock;
  c.pose = "run";
  c.poseTimer = 0;
  // 출발 자리에 잔상을 남긴다. 어디서 어디로 갔는지가 한 컷에 읽힌다.
  if (color) {
    pushFx({ kind: "spark", fx: c.fx, fy: c.fy, tx: 0, ty: 0, radius: 0.5, angle: 0, life: 260, color });
  }
}

/**
 * 달리는 중인 고양이를 목표 쪽으로 옮긴다.
 *
 * 도착하면 목표를 정확히 찍고 끝낸다 — 남은 거리를 반복해서 좁히면 영영
 * 도달하지 못하고 예고 가장자리에서 떨리게 된다.
 */
function tickDashes(cats: Cat[], dt: number): void {
  for (const c of cats) {
    if (!c.dash) continue;
    const travel = c.dash.speed * (dt / 1000);
    const dx = c.dash.tx - c.fx;
    const dy = c.dash.ty - c.fy;
    const d = Math.hypot(dx, dy);
    if (d <= travel || d <= 1e-6) {
      c.fx = c.dash.tx;
      c.fy = c.dash.ty;
      c.dash = null;
      // 착지는 모든 대시(회피·뭉침·도적 도약·소환)가 지나는 길목이다.
      // 목표를 고르는 쪽을 하나 고쳐도 다른 경로가 또 새므로 여기서도 막는다.
      clampToField(c);
    } else {
      c.fx += (dx / d) * travel;
      c.fy += (dy / d) * travel;
      c.pose = "run";
      c.poseTimer = 0;
    }
  }
}

/**
 * 버튼 하나가 지금 무엇을 해야 하는지 정한다.
 *
 * 화면은 `act` 하나만 보낸다. 무엇을 할지 사람이 1.2초 안에 고르게 하는 대신
 * 판을 보고 여기서 정한다 — 취약 창이 열려 있으면 약점 공격, 청록 예고면
 * 뭉치기, 그 밖에는 흩어지기.
 *
 * **이 함수가 유일한 결정 지점이어야 한다.** 화면에서 한 번, 여기서 또 한 번
 * 고르면 브라우저와 헤드리스 시뮬이 갈라진다 — 이 게임의 모든 수치가 둘이
 * 같은 코드를 돈다는 전제 위에 있다.
 *
 * `dodge`·`gather`·`strike`를 직접 지정한 것은 그대로 통과시킨다. 측정
 * 스크립트가 "늘 흩어지기만", "거꾸로 읽기" 같은 나쁜 정책을 일부러 돌려
 * 개입의 값을 재는 데 쓴다.
 *
 * **우선순위: 예고가 활성이면 회피/집결이 약점 공격을 이긴다.**
 * `tickBoss`가 취약 창 **후반부**에는 문턱 예고를 허용하므로([2]), 창이
 * 열린 중에도 예고가 뜰 수 있다 — 그 순간은 몸을 지키는 쪽이 급하다.
 * 예고가 없을 때만 취약 창을 본다. 겹칠 때 이 우선순위 때문에 그 스텝은
 * 회피/집결로 소비되고 약점 공격은 못 나간다 — 취약 창 연타가 "열리면
 * 무조건 누른다"였던 것이 이제 진짜 선택이 된다(부검은 `vulnOverlapSeen`·
 * `vulnOverlapDodged`).
 */
function resolveIntent(state: RunState, intent: Intervention | undefined): Intervention | undefined {
  if (intent?.kind !== "act") return intent;
  const tg = state.enemy.find((c) => c?.telegraph)?.telegraph;
  if (tg) return tg.mode === "gather" ? { kind: "gather" } : { kind: "dodge" };
  if (state.enemy.some((c) => c?.alive && c.vulnerableMs > 0)) return { kind: "strike" };
  return { kind: "dodge" }; // 예고도 취약 창도 없으면 doDodge가 알아서 아무 일도 안 한다
}

/** 위험 구간 안의 아군을 빼낸다. 실제로 누군가 빠져나왔을 때만 참을 돌려준다. */
function doDodge(state: RunState): boolean {
  const zones: Telegraph[] = [];
  for (const e of state.enemy) if (e?.telegraph) zones.push(e.telegraph);
  if (zones.length === 0) return false;

  // 남은 도화선. 여럿이면 가장 먼저 터지는 것에 맞춘다.
  const fuse = Math.min(...zones.map((z) => z.fuse));
  let moved = false;
  for (const c of allyBodies(state)) {
    // 이미 안전한 자리로 달리는 중이면 다시 세지 않는다.
    //
    // 대시는 100~370ms 걸리는데 그동안 고양이는 아직 장판 안에 있다. 그래서
    // 연타하면 "아직 위험한 고양이가 있다"로 읽혀 **차지가 한 번 더 나갔다** —
    // 계측에서 예고 하나에 75번 누르니 2개가 다 빠졌다. 누르는 속도가 자원을
    // 먹는 것은 어떤 설명으로도 정당화되지 않는다.
    //
    // `moved`를 켜지 않고 넘긴다 — 이미 대답한 것을 다시 세면 그게 곧 차지를
    // 또 쓰는 일이다.
    if (c.dash) continue;
    const spot = safeSpot(c, zones);
    if (!spot) {
      /**
       * 이미 안전한 고양이는 **옮기지 않되 붙잡는다.**
       *
       * 전에는 아무것도 안 했다. 그래서 밖에 서 있던 고양이가 1.2초 동안
       * 평소처럼 보스를 향해 걸어가다 장판 안으로 들어갔다 — 계측에서 예고에
       * 걸린 고양이의 22%가 이 경우였고, 플레이어 입장에서는 분명히 눌렀는데
       * 맞은 것이다. "흩어져"는 흩어지라는 뜻이지 "지금 위험한 애들만
       * 옮겨라"가 아니다.
       *
       * 자리를 안 바꾸므로 회피가 공짜로 진형을 정리해 주지도 않는다.
       */
      if (c.moveLock < fuse) c.moveLock = fuse;
      continue;
    }
    // **도착할 수 있는 고양이만 센다.** 이동에 시간이 걸리게 되면서, 늦게 누르면
    // 출발은 하는데 터질 때까지 못 빠져나오는 경우가 생겼다. 그때도 `moved`를
    // 참으로 돌려주면 한정 자원인 회피 차지만 쓰고 아무 일도 안 일어난다 —
    // 순간이동 시절에는 없던 실패다.
    if (dashMs(c, spot.fx, spot.fy) <= fuse) moved = true;
    startDash(c, spot.fx, spot.fy, "#F3E8D6");
  }
  return moved;
}

/** 목표 쪽으로 이동. 사거리 바로 안쪽까지만 간다. */
function stepToward(cat: Cat, target: Cat, stepMs: number): void {
  if (cat.moveLock > 0) return; // 회피 직후에는 제자리를 지킨다
  // 달리는 중이면 걸음은 쉰다. 도적 도약은 moveLock을 안 걸므로(착지 즉시
  // 싸워야 한다) 여기서 막지 않으면 같은 스텝에 두 이동원이 좌표를 민다.
  if (cat.dash) return;
  const dx = target.fx - cat.fx;
  const dy = target.fy - cat.fy;
  const d = Math.hypot(dx, dy);
  if (d <= 1e-6) return;

  const want = cat.breed.moveSpeed * cat.speedMul * (stepMs / 1000);
  // 지나쳐 들어가면 다음 틱에 뒤로 밀렸다 앞으로 갔다 하며 떤다.
  // 반경을 빼야 보스 몸통 앞에서 멈춘다. 일반 고양이는 반경 0이라 그대로다.
  const stopAt = cat.breed.range * 0.95 + cat.radius + target.radius;
  const travel = Math.min(want, Math.max(0, d - stopAt));
  if (travel <= 0) return;

  cat.fx += (dx / d) * travel;
  cat.fy += (dy / d) * travel;
  holdLane(cat, stepMs);
  cat.pose = "run";
  cat.poseTimer = 0;
}

/**
 * 자기 줄로 되돌린다. **전진은 안 건드리고 옆으로 흐르는 것만 붙잡는다.**
 *
 * 이게 없으면 배치가 전투 몇 초 만에 지워진다 — 모두가 목표를 향해 직선으로
 * 걸으므로 시작 자리와 무관하게 같은 모양으로 수렴한다(`BALANCE.lanePull`
 * 주석의 실측 참고). 그러면 플레이어가 고른 대형이 예고 시점에는 남아 있지
 * 않고, 배치가 결정이 아니라 장식이 된다.
 *
 * 벤치(`cell < 0`)에 있거나 소환수처럼 자기 자리가 뜻이 없는 경우는 건드리지
 * 않는다. 소환수는 주인의 셀을 물려받으므로 그 줄로 끌면 주인 자리로 빨려간다.
 */
function holdLane(cat: Cat, stepMs: number): void {
  if (BALANCE.lanePull <= 0 || cat.summon || cat.cell < 0) return;
  const home = cellToField(cat.side, cat.cell);
  const pull = Math.min(1, BALANCE.lanePull * (stepMs / 1000));
  cat.fy += (home.fy - cat.fy) * pull;
}

/** 같은 편끼리 뭉치지 않도록 살짝 밀어낸다. 길찾기가 아니라 겹침 방지다. */
/**
 * 판 위에 실제로 서 있는 아군 전부 — 진짜 고양이 + 소환수.
 *
 * **전투 계산만 이걸 쓴다.** 보유 한도·강화 대상·시너지 집계·유물 조건·전멸
 * 판정은 계속 `livingCats(state.ally)`를 쓴다. 소환수가 그쪽에 섞이면 분신
 * 둘이 '근접 3마리' 유물을 켜고, 주인이 다 죽어도 전멸이 아니게 된다.
 */
function allyBodies(state: RunState): Cat[] {
  return bodies(state, "ally");
}

/**
 * 적 쪽 몸 전부.
 *
 * **지금 악몽 명단에는 소환사가 없어서 적 소환수는 생기지 않는다**
 * (`breeds.ts` 참고 — 적이 소환하면 웨이브 성격이 지워졌다). 그래도 진영을
 * 갈라 두는 이유는, 이 함수가 없으면 나중에 적에게 소환을 주는 순간 적
 * 소환수가 우리 편으로 세어지기 때문이다. 방어는 남기고 근거만 바로잡는다.
 */
function foeBodies(state: RunState): Cat[] {
  return bodies(state, "enemy");
}

/**
 * 한쪽 진영의 몸 전부 — 보드 위 고양이 + 그 진영의 소환수.
 *
 * **`side`로 거르는 것이 핵심이다.** `state.summons`는 양쪽 소환수를 함께
 * 담는다(전투가 끝나면 통째로 비우므로 배열을 둘로 나눌 이유가 없다).
 * 거르지 않으면 적이 부른 몸이 우리 편으로 세어져 **적의 소환수가 우리를
 * 위해 싸운다** — 적에게 소환사를 줘 봤을 때 불변식 검사가 300판에서
 * 11417번 잡았다. 그 실험은 되돌렸지만(궁합이 무너졌다) 필터는 남겨 둔다.
 */
function bodies(state: RunState, side: Side): Cat[] {
  const out = livingCats(side === "ally" ? state.ally : state.enemy);
  for (const s of state.summons) if (s.alive && s.side === side) out.push(s);
  return out;
}

/**
 * 소환수의 수명을 깎고, 다한 것을 치운다.
 *
 * 죽은 것도 여기서 걷어낸다 — 배열에 남겨 두면 `allyBodies`가 매 스텝
 * 걸러내야 하고, 전투가 길어질수록 시체가 쌓인다.
 */
function tickSummons(state: RunState, dtMs: number): void {
  const list = state.summons;
  for (let i = list.length - 1; i >= 0; i--) {
    const s = list[i];
    if (!s) continue;
    if (s.summon) {
      s.summon.lifeMs -= dtMs;
      if (s.summon.lifeMs <= 0) s.alive = false;
    }
    if (!s.alive) list.splice(i, 1);
  }
}

/**
 * 소환수를 불러 판에 세운다.
 *
 * **`caster`와 `model`을 갈라 둔 것이 핵심이다.**
 * - `caster`: 부르는 주체. 살아 있어야 한다.
 * - `model`: 본뜰 원형. 스탯·그림·자리를 여기서 가져온다. **죽어 있어도 된다.**
 *
 * 전에는 인자가 하나여서 두 뜻을 겸했고, 맨 앞의 `!alive` 가드가 되살리기를
 * 통째로 막았다 — 되살리기는 원형이 시체일 때만 의미가 있는데, 정확히 그
 * 경우에만 0마리를 냈다(300시드에서 시전 392회 · 소환 0). 마나와 그 틱의
 * 평타까지 태우면서 아무 일도 안 했고, 어떤 검사도 "소환 스킬이 실제로 몸을
 * 냈는가"를 안 봐서 전부 초록이었다.
 *
 * 진영은 `caster`에서 가져온다. 원형이 시체여도 부른 쪽 편이다.
 *
 * 상한을 두는 이유는 밀도다 — 10마리일 때 최근접 거리가 이미 1.05(분리
 * 목표 1.0)라, 몸을 무제한으로 얹으면 상시 밀어내기가 되고 그게 판 밖으로
 * 밀려나는 버그를 되살린다.
 */
export function summon(
  state: RunState,
  caster: Cat,
  spec: SummonSpec,
  model: Cat = caster,
): number {
  if (!caster.alive) return 0;
  let made = 0;
  // **상한은 진영별이다.** 합계로 세면 한쪽이 먼저 채운 판에서 다른 쪽이
  // 아무것도 못 낸다 — 같은 스킬을 썼는데 누가 먼저 터졌느냐로 결과가
  // 갈리는 것은 규칙이 아니라 사고다. (지금은 적이 소환하지 않으므로
  // 실효가 없지만, 진영 필터와 같은 이유로 남겨 둔다.)
  let mine = state.summons.filter((c) => c.side === caster.side).length;
  for (let i = 0; i < spec.count; i++) {
    if (mine >= SUMMON_CAP) break;
    mine += 1;
    const s = makeSummon(model, spec, i);
    s.side = caster.side;
    // 주인 옆 0.7칸에 놓기만 하므로 주인이 판 끝에 서 있으면 넘어간다.
    // 도적 도약이 먼저 돌면 주인이 적진 맨 뒤라 실제로 fx 12.3까지 나갔다.
    clampToField(s);
    state.summons.push(s);
    made += 1;
  }
  return made;
}

/** **한 진영이** 동시에 세울 수 있는 소환수 수. 밀도 상한이다. 하네스가 이걸 import한다. */
export const SUMMON_CAP = 4;

function separate(cats: Cat[]): void {
  for (let i = 0; i < cats.length; i++) {
    for (let j = i + 1; j < cats.length; j++) {
      const a = cats[i];
      const b = cats[j];
      if (!a || !b) continue;
      // 달리는 중에는 밀어내지 않는다. 겹침 방지가 경로를 휘면 개입으로 지시한
      // 자리에 못 서고, 위험 구간 가장자리에 걸친 채로 끝난다.
      //
      // 개입으로 자리를 지정받은 뒤(`moveLock`)에도 안 민다. **밀어내기는
      // 개입을 되돌린다** — 계측에서 붉은 예고에 걸린 고양이의 40%가 일단
      // 빠져나왔다가 이 힘에 떠밀려 도로 들어간 경우였다. 겹쳐 보이는 1.4초가
      // 눌러도 안 피해지는 것보다 낫다.
      if (a.dash || b.dash || a.moveLock > 0 || b.moveLock > 0) continue;
      const dx = b.fx - a.fx;
      const dy = b.fy - a.fy;
      const d = Math.hypot(dx, dy);
      // 작은 몸은 좁게 선다. 배수가 둘 다 1이면 예전 식과 완전히 같다
      // (`SEPARATION + 반경`) — 소환수만 이 항이 줄어든다.
      const minD = SEPARATION * ((a.sizeMul + b.sizeMul) / 2) + a.radius + b.radius;
      if (d >= minD) continue;
      // 정확히 겹쳤으면 uid 순서로 축을 갈라 결정적으로 만든다.
      const nx = d > 1e-6 ? dx / d : a.uid < b.uid ? 1 : -1;
      const ny = d > 1e-6 ? dy / d : 0;
      const overlap = minD - d;
      // 보스는 밀리지 않는다. 큰 개체가 잡몹에게 떠밀리면 진형이 흐트러지고,
      // 예고 광역의 기준점이 매 틱 흔들려 회피를 조준할 수 없게 된다.
      const aFixed = a.radius > 0;
      const bFixed = b.radius > 0;
      if (aFixed && bFixed) continue;
      const aShare = aFixed ? 0 : bFixed ? 1 : 0.5;
      const bShare = 1 - aShare;
      a.fx -= nx * overlap * aShare;
      a.fy -= ny * overlap * aShare;
      b.fx += nx * overlap * bShare;
      b.fy += ny * overlap * bShare;
      clampToField(a);
      clampToField(b);
    }
  }
}

/**
 * 판 안으로 묶는다.
 *
 * 밀어내기에는 경계가 없었다. 300판 43만 스텝을 훑으니 **1106번** 판 밖으로
 * 나갔고, 최대 1.4칸까지 벗어났다 — 아군이 적 뒷줄 너머 `fx 11.15`, 적이 우리
 * 뒷줄 너머 `fx -1.43`, 세로도 `-0.75 ~ 4.84`였다. 화면에서는 고양이가 판
 * 테두리 밖에 서 있는 것으로 보인다.
 *
 * 한 판을 눈으로 봐서는 안 걸린다. 근접이 몰리는 순간에만 생기고, 밀린 뒤
 * 다시 걸어 들어오므로 몇 프레임 만에 사라진다. 스텝을 수십만 번 보는 검사가
 * 아니면 못 잡는 종류다(`npm run invariants`).
 *
 * 걸음(`stepToward`)은 목표를 향해서만 가므로 판을 안 벗어난다 — 새는 곳은
 * 밀어내기뿐이라 여기서만 묶는다. 보스는 반경이 있어 중심이 가장자리에 서면
 * 몸이 걸치지만, 보스는 밀리지 않으므로(위의 `aFixed`) 이 함수를 안 탄다.
 */
/** 판의 오른쪽 끝. `clampToField`와 `safeSpot`이 같은 값을 봐야 한다. */
const FIELD_MAX_FX = ENEMY_FRONT_FX + BOARD_COLS - 1;

function clampToField(c: Cat): void {
  const maxX = FIELD_MAX_FX;
  if (c.fx < 0) c.fx = 0;
  else if (c.fx > maxX) c.fx = maxX;
  if (c.fy < 0) c.fy = 0;
  else if (c.fy > BOARD_ROWS - 1) c.fy = BOARD_ROWS - 1;
}

function tickEffects(cats: (Cat | null)[], dt: number): void {
  for (const c of cats) {
    if (!c) continue;
    if (c.moveLock > 0) c.moveLock = Math.max(0, c.moveLock - dt);
    if (c.flash > 0) c.flash = Math.max(0, c.flash - dt);
    if (c.lunge > 0) c.lunge = Math.max(0, c.lunge - dt / POSE_MOVE_MS);
    if (c.castFlash > 0) c.castFlash = Math.max(0, c.castFlash - dt);
    if (!c.alive) {
      c.pose = "sleep";
      c.dot = null;
      c.stun = 0;
      continue;
    }

    if (c.stun > 0) c.stun = Math.max(0, c.stun - dt);
    if (c.dot) {
      // 지속 피해는 보호막을 무시하지 않는다. 평타와 같은 경로로 들어간다.
      const slice = (c.dot.dps * Math.min(dt, c.dot.remain)) / 1000;
      c.dot.remain -= dt;
      if (slice > 0.5) damage(c, slice, false);
      if (c.dot.remain <= 0) c.dot = null;
    }
    if (c.poseTimer > 0) {
      c.poseTimer -= dt;
      if (c.poseTimer <= 0) {
        c.poseTimer = 0;
        c.pose = "idle";
      }
    }
  }
}

/**
 * 전투가 시작되는 순간 도적이 상대 뒷줄로 뛰어든다. TFT 암살자와 같은 개념이다.
 *
 * 목표는 상대의 **뒷줄 같은 행** — 원거리가 서는 자리다. 그 칸이 차 있으면
 * 주변 빈칸으로 밀린다. 점유 판정은 **전투 시작 시점** 기준이고, 도적끼리
 * 겹치지 않도록 배정하는 대로 자리를 예약한다.
 *
 * 착지 뒤에는 평소와 같이 가장 가까운 적을 노린다.
 * 양쪽 모두에 적용한다 — 우리만 뛰어들면 도적이 지나치게 강해진다.
 */
/**
 * 도약이 걸리는 시간(ms). 거리와 무관하게 이 시간에 맞춰 속도를 정한다.
 *
 * 이미 있던 연출에서 가져온 값이다 — 궤적이 340ms, `run` 포즈가 320ms였다.
 * 몸이 그보다 오래 걸리면 궤적이 먼저 사라지고 고양이만 허공에 남는다.
 */
const LEAP_MS = 300;

function findLanding(taken: Set<number>, wantRow: number, landSide: Side): number {
  // "뒷줄"은 진영마다 반대편이다. 적 보드는 col이 클수록, 아군 보드는 col이
  // 작을수록 상대에게서 멀다. 이걸 뭉뚱그리면 적 도적이 우리 앞줄로 뛰어든다.
  const back = landSide === "enemy" ? BOARD_COLS - 1 : 0;
  const cells: number[] = [];
  for (let i = 0; i < BOARD_COLS * BOARD_ROWS; i++) cells.push(i);
  // 뒷줄을 강하게 선호하고(계수 3), 그 안에서 원하는 행에 가까운 순
  const score = (i: number) =>
    Math.abs((i % BOARD_COLS) - back) * 3 + Math.abs(Math.floor(i / BOARD_COLS) - wantRow);
  cells.sort((a, b) => score(a) - score(b));
  return cells.find((i) => !taken.has(i)) ?? -1;
}

/**
 * 전투가 열릴 때 규칙 유물이 부르는 소환수.
 *
 * **조건은 진짜 고양이만 센다**(`livingCats(state.ally)`). 분신이 조건을
 * 세면 '다섯 마리 이하' 유물이 자기가 부른 분신 때문에 꺼지거나, 반대로
 * 소환수가 소환 조건을 채워 무한히 불어난다.
 *
 * 주인은 **가장 앞선 고양이**다. 분신은 맞아 주는 몸이라 맞는 자리에
 * 서야 값을 한다 — 뒷줄 마법사를 복제하면 아무도 안 때린다.
 */
function openingSummons(state: RunState): void {
  const cats = livingCats(state.ally);
  if (cats.length === 0) return;
  const owner = cats.reduce((a, b) => (b.fx > a.fx ? b : a));
  for (const r of state.relics) {
    if (!r.boonRule || r.boonRule.kind !== "summon") continue;
    if (!relicActive(r, cats)) continue;
    summon(state, owner, r.boonRule.spec === "mirror" ? MIRROR_IMAGE : KITTEN);
  }
}

function assassinLeap(state: RunState): void {
  const sides: { mine: (Cat | null)[]; foes: (Cat | null)[]; foeSide: Side }[] = [
    { mine: state.ally, foes: state.enemy, foeSide: "enemy" },
    { mine: state.enemy, foes: state.ally, foeSide: "ally" },
  ];

  for (const { mine, foes, foeSide } of sides) {
    const taken = new Set<number>();
    foes.forEach((c, i) => {
      if (c) taken.add(i);
    });

    for (const c of mine) {
      if (!c || !c.alive || c.breed.cls !== "rogue") continue;
      const landing = findLanding(taken, cellRow(c.cell), foeSide);
      if (landing < 0) continue;
      taken.add(landing);

      const from = { fx: c.fx, fy: c.fy };
      const to = cellToField(foeSide, landing);
      /**
       * 뛰어드는 것도 **달려서** 간다.
       *
       * 전에는 `c.fx = to.fx`로 여덟 칸을 한 프레임에 건너뛰었다. 이 게임에서
       * 가장 큰 순간이동이었고, 궤적(streak)을 함께 그려 두긴 했지만 몸은
       * 사라졌다 나타났다.
       *
       * 속도를 개입과 공유하지 않고 **거리로 나눠** 정한다. 초당 9칸이면 여덟
       * 칸에 890ms가 걸려 오는 내내 얻어맞고, 그건 도적을 다른 것으로 만든다.
       * `LEAP_MS`는 이미 여기 있던 연출이 정해 둔 값이다 — 궤적이 340ms 살고
       * `run` 포즈를 320ms 잡고 있었다. 몸이 그 시간에 맞춰 건너가면 연출과
       * 실제가 처음으로 같은 것을 말한다.
       *
       * `moveLock`은 0이다. 개입은 옮긴 자리를 지켜야 하지만 도약은 착지하는
       * 즉시 싸워야 한다 — 1.4초를 묶으면 뛰어든 의미가 없다.
       */
      const dist = Math.hypot(to.fx - from.fx, to.fy - from.fy);
      startDash(c, to.fx, to.fy, "", (dist / LEAP_MS) * 1000, 0);
      c.poseTimer = 320;

      pushFx({
        kind: "streak",
        fx: from.fx,
        fy: from.fy,
        tx: to.fx,
        ty: to.fy,
        radius: 0.5,
        angle: 0,
        life: 340,
        color: CLASS_FX.rogue,
      });
      pushFx({
        kind: "ring",
        fx: to.fx,
        fy: to.fy,
        tx: to.fx,
        ty: to.fy,
        radius: 0.9,
        angle: 0,
        life: 380,
        color: CLASS_FX.rogue,
      });
    }
  }
}


/* ------------------------------------------------------------------ */
/* 보스 광역기 — 체력 문턱에 걸리면 예고하고 터진다                        */
/* ------------------------------------------------------------------ */

/** 살아 있는 대상들의 무게중심. 뭉쳐 있으면 그 한가운데가 나온다. */
function centroid(cats: Cat[]): { fx: number; fy: number } {
  let sx = 0;
  let sy = 0;
  for (const c of cats) {
    sx += c.fx;
    sy += c.fy;
  }
  const n = Math.max(1, cats.length);
  return { fx: sx / n, fy: sy / n };
}

/**
 * 우두머리 전용 페이즈 2가 시작되는 문턱 인덱스.
 *
 * 처음엔 체력 비율(≤50%)로 쟀는데, 피해가 덩어리로 들어와 idx 2(문턱 0.55)
 * 검사 시점에 이미 절반 밑인 판이 대부분이었다 — 리뷰 실측에서 살금이는
 * 95%가 idx 2에서 전환해, "인덱스 3에서 갈아탄다"는 페이즈 2 패턴 설계가
 * 통째로 어긋났다. **인덱스로 직접 재면 전환 지점이 결정적**이고, 각 보스의
 * phase2Patterns 주석이 말하는 순환(idx 3부터)이 실제와 일치한다.
 */
const PHASE2_FROM_IDX = 3;

/**
 * 우두머리가 절반 밑으로 내려오면 페이즈 2로 전환한다.
 *
 * **스테이지 우두머리(`stageBoss`)만** 대상이다 — 중간보스까지 페이즈를 나누면
 * 걸음 하나짜리 보스도 성격이 도중에 바뀌어 "이 보스는 이렇게 잡는다"가
 * 흔들린다. 전환의 무게는 걸음의 끝에만 싣는다.
 *
 * `boss.phase2`가 이미 참이면 다시 켜지 않는다 — 그래야 `phaseShift` Fx가
 * 전환되는 그 한 순간에만 뜬다. 렌더가 매 프레임 다시 그리는 것이 아니라
 * 상태 변화 자체를 여기서 한 번만 감지해야 한다.
 */
function updateBossPhase(boss: Cat, kit: BossKit): void {
  if (boss.phase2 === true) return;
  if (boss.stageBoss !== true || kit.phase2Patterns === undefined) return;
  if (boss.thresholdIdx < PHASE2_FROM_IDX) return;
  boss.phase2 = true;
  pushFx({
    kind: "phaseShift",
    fx: boss.fx,
    fy: boss.fy,
    tx: 0,
    ty: 0,
    radius: boss.radius * 1.4,
    angle: 0,
    life: 640,
    color: "#F0BA4A",
  });
}

/**
 * 문턱 번호에 따라 예고를 만든다.
 *
 * 원형은 **무게중심**을 노린다. 흩어져 있으면 한가운데가 비어 아무도 안 맞고,
 * 뭉쳐 있으면 통째로 맞는다.
 *
 * 뭉침(gather)은 보스와 아군 사이에 선다. 이미 서 있는 자리에 그리면 공짜가
 * 되므로, 근접은 뒤로 원거리는 앞으로 와야 닿는 지점에 둔다.
 *
 * `idx`는 페이즈가 바뀌어도 리셋되지 않는다 — 페이즈 2가 시작되는 문턱(보통
 * 인덱스 3)부터 `phase2Patterns`를 그 인덱스 그대로 돌린다. 패턴 배열은
 * 순환표일 뿐 처음부터 봐야 하는 서사가 아니므로 문제가 안 된다.
 */
function makeTelegraph(boss: Cat, foes: Cat[], idx: number): Telegraph | null {
  if (foes.length === 0) return null;
  const kit = bossKit(boss.breed.id);
  const patterns = boss.phase2 === true && kit.phase2Patterns !== undefined ? kit.phase2Patterns : kit.patterns;
  const pattern = patterns[idx % patterns.length]!;
  const mode: TelegraphMode = pattern === "gather" || pattern === "hearth" ? "gather" : "avoid";
  const shape: TelegraphShape =
    pattern === "gather" || pattern === "stomp" || pattern === "hearth" || pattern === "quake"
      ? "circle"
      : pattern;
  const base = { shape, mode, fuse: TELEGRAPH_FUSE_MS, fuseMax: TELEGRAPH_FUSE_MS };

  /**
   * 발구르기 — **보스 발밑**에 생긴다.
   *
   * 다른 예고는 전부 팀을 따라온다(원형·부채꼴은 무게중심, 직선은 가장 먼
   * 아군, 모이기는 그 중간). 표적이 팀 자신이면 **어디에 서 있든 같은 비율로
   * 걸린다** — 측정에서 대형을 어떻게 바꿔도 예고당 3.5~4.1마리가 잘못된 자리에
   * 있었고 폭이 0.5마리뿐이었다. 대형이 결정이 아니었던 진짜 이유가 이것이다.
   *
   * 이것만 자리가 고정이라 **보스에게서 얼마나 떨어져 서느냐**가 답이 된다.
   * 반경을 넓게 잡는 이유는 근접이 붙어 있는 거리를 확실히 덮기 위해서다.
   */
  /**
   * 화톳불(`hearth`)과 땅울림(`quake`) — **세로 자리가 판에 고정된 예고.**
   *
   * 나머지는 전부 팀을 따라온다(원형·부채꼴은 무게중심, 직선은 가장 먼 아군,
   * 모이기는 그 중간). 표적이 팀 자신이면 **어디에 서 있든 같은 비율로
   * 걸린다** — 그게 배치가 결정이 아니었던 뿌리다.
   *
   * 가로(fx)는 고정할 수 없다. 근접은 사거리 0.8, 원거리는 2.8에서 멈추므로
   * 가로 위치는 대형이 아니라 직업이 정한다. **세로(fy)는 순수하게 배치다** —
   * 어느 행에 서느냐는 플레이어가 고른 것뿐이다. 그래서 세로만 판 한가운데로
   * 고정하고 가로는 전선을 따라간다.
   *
   * 둘은 서로 반대다. 화톳불은 가운데 행이 안전지대라 **뭉치기**를, 땅울림은
   * 가운데 행이 위험지대라 **가장자리로 흩어지기**를 보상한다. 이 게임에
   * 뭉치기를 보상하는 것이 모이기(움직이는 보스에게만 작동한다)뿐이었는데
   * 화톳불이 그 자리를 채운다.
   */
  if (pattern === "hearth" || pattern === "quake") {
    const c = centroid(foes);
    const midY = (BOARD_ROWS - 1) / 2;
    return {
      ...base,
      fx: c.fx,
      fy: midY,
      dirX: 0,
      dirY: 0,
      // 화톳불은 모이기와 같은 이유로 넓다 — 모이라고 해 놓고 못 모이면 벌이다.
      arg: pattern === "hearth" ? 1.9 : 1.5,
      reach: 0,
    };
  }

  if (pattern === "stomp") {
    return { ...base, fx: boss.fx, fy: boss.fy, dirX: 0, dirY: 0, arg: 2.4, reach: 0 };
  }

  if (mode === "gather") {
    const c = centroid(foes);
    /**
     * 안전지대를 **팀 쪽에 가깝게** 둔다.
     *
     * 중간(0.5)에 두었더니 뭉쳐 있든 흩어져 있든 **아무도 그 안에 없었다.**
     * 그러면 모이기가 대형을 전혀 안 가른다 — 뭉침을 보상해야 할 패턴인데
     * 실측에서 분산이 서리귀(모이기 2/4)까지 이겼다(3.06 vs 3.50).
     *
     * 0.25면 뭉친 팀은 상당수가 이미 안에 있고, 흩어진 팀은 바깥 것들이
     * 남는다. 그래도 완전히 팀 위에 두지는 않는다 — 그러면 뭉치기만 하면
     * 공짜로 통과라 **개입할 이유가 사라진다.** 여전히 몇 걸음은 움직여야 한다.
     */
    const GATHER_BIAS = 0.25;
    return {
      ...base,
      fx: c.fx + (boss.fx - c.fx) * GATHER_BIAS,
      fy: c.fy + (boss.fy - c.fy) * GATHER_BIAS,
      dirX: 0,
      dirY: 0,
      // 흩어짐 원형(1.6)보다 넓다. 모이라고 해 놓고 못 모이면 규칙이 아니라 벌이다.
      arg: 1.9,
      reach: 0,
    };
  }

  if (shape === "circle") {
    const c = centroid(foes);
    return { ...base, fx: c.fx, fy: c.fy, dirX: 0, dirY: 0, arg: 1.6, reach: 0 };
  }

  // 직선은 가장 먼 대상을 향해 쏜다 — 뒷줄까지 닿아야 원거리도 위험해진다.
  // 부채꼴은 무게중심을 향한다.
  const aim =
    shape === "line"
      ? foes.reduce((a, b) => (fieldDistance(boss, a) >= fieldDistance(boss, b) ? a : b))
      : centroid(foes);
  const dx = aim.fx - boss.fx;
  const dy = aim.fy - boss.fy;
  const len = Math.hypot(dx, dy) || 1;
  return {
    ...base,
    fx: boss.fx,
    fy: boss.fy,
    dirX: dx / len,
    dirY: dy / len,
    /**
     * 직선은 **폭(칸)**, 부채꼴은 **반각(라디안)**이다. 단위가 달라 헷갈리기 쉽다.
     *
     * 부채꼴이 0.7rad였다 — 반각 40도면 전체 80도라 보스에서 팀을 향해 부챗살을
     * 펴면 사실상 전원을 덮는다. 실측으로 6마리 중 5~6마리를 항상 맞혔고,
     * 그래서 **다른 모든 패턴의 신호를 묻어버렸다.** 대형을 어떻게 잡아도
     * 부채꼴 한 방이면 같은 결과다.
     *
     * 0.35rad(반각 20도, 전체 40도)면 축에서 벗어난 것은 빠져나간다.
     */
    arg: shape === "line" ? 0.75 : 0.35,
    reach: shape === "line" ? 14 : 5.5,
  };
}

/** 이 좌표가 예고 범위 안인가. 판정은 전부 정준 좌표에서 한다. */
/**
 * `pad` — 판정에 더하는 몸 반경(칸). 피해·회피·모임이 전부 같은 값을 넘겨야
 * 화면과 판정이 같은 말을 한다. 기본 0은 측정 스크립트용(중심점 기준).
 */
export function inTelegraph(t: Telegraph, fx: number, fy: number, pad = 0): boolean {
  const rx = fx - t.fx;
  const ry = fy - t.fy;
  const d = Math.hypot(rx, ry);
  if (t.shape === "circle") return d <= t.arg + pad;

  const along = rx * t.dirX + ry * t.dirY;
  if (t.shape === "line") {
    if (along < -pad || along > t.reach + pad) return false;
    return Math.abs(rx * t.dirY - ry * t.dirX) <= t.arg + pad;
  }

  /**
   * 부채꼴. 사거리는 `along`(방향 성분)이 아니라 **거리**로 자른다 — 렌더가
   * `ctx.arc(0,0,reach,-arg,arg)`로 원호를 그리므로, along으로 자르면
   * 가장자리에서 판정이 그림보다 1/cos(arg)만큼 밖으로 삐져나온다(그림 밖인데
   * 맞는 구역). 판정이 그림을 따라간다.
   */
  if (d > t.reach + pad) return false;
  // 시작점 뒤쪽: 꼭짓점에 몸이 걸친 경우만 인정한다.
  if (along < 0) return d <= pad;
  // 시작점에 붙어 있으면 각도가 의미 없으므로 무조건 맞는다.
  if (d < 1e-6) return true;
  const ang = Math.acos(Math.min(1, Math.max(-1, along / d)));
  // 몸 반경을 각도로 환산해 더한다(반지름 d에서 pad칸이 가리는 각).
  const angPad = pad > 0 ? Math.asin(Math.min(1, pad / d)) : 0;
  return ang <= t.arg + angPad;
}

/**
 * 예고가 터진다. 동시에 **성적을 적는다**.
 *
 * 죽는 화면에서 "왜 졌는지"를 말하려면 이 순간의 기록이 필요하다. 예고를 몇 번
 * 봤고 그중 몇 번을 맞았는가 — 이 게임에서 가장 큰 결정 축이 개입이므로,
 * 부검에서 가장 먼저 나와야 할 숫자다.
 */
/**
 * 예고가 한 마리에게 주는 피해.
 *
 * 비율 몫과 고정 몫을 섞는다. 비율만 쓰면 체력이 아무 값을 안 해서 전사와
 * 마법사가 같은 횟수에 죽고, 그러면 보스전에서 배치가 의미를 잃는다.
 * 고정 몫의 기준을 보스 공격력으로 두면 웨이브에 따라 같이 커진다.
 */
function telegraphHit(target: Cat, boss: Cat, frac: number): number {
  const share = BALANCE.telegraphFlatShare;
  const pct = target.maxHp * frac;
  const flat = boss.atk * BALANCE.telegraphFlatMul * (frac / BALANCE.telegraphDmg);
  return Math.max(1, Math.round(pct * (1 - share) + flat * share));
}

/**
 * 예고에 맞은 자리에 튀는 스파크.
 *
 * 보스에서 밀려난 방향으로 튄다 — 폭발의 중심이 어디인지가 스파크 방향에서
 * 읽힌다. `angle`은 위치에서 그대로 계산하므로 rng()를 쓰지 않는다. battle.ts는
 * 헤드리스 하네스가 그대로 돌리는 코드라, 순수 연출이라도 공유 시드를 쓰면
 * 시드 하나로 재현해야 하는 다른 검사(회피율 등)의 뽑기 순서가 밀린다.
 */
function fireTelegraphHitFx(target: Cat, boss: Cat, hue: string): void {
  const away = Math.atan2(target.fy - boss.fy, target.fx - boss.fx);
  pushFx({ kind: "spark", fx: target.fx, fy: target.fy, tx: 0, ty: 0, radius: 0.6, angle: away, life: 260, color: hue });
}

function fireTelegraph(boss: Cat, foes: Cat[], tally: RunState): void {
  const t = boss.telegraph;
  if (!t) return;
  tally.telegraphsSeen += 1;
  /**
   * 취약 창이 열린 채로 예고가 터지는 순간 — [2]가 만든 상충 지점이다.
   * `vulnerableMs`는 tickBoss가 이미 이번 스텝에 깎아 뒀으므로, 여기서
   * 0보다 크면 "지금도 여전히 취약하다"는 뜻이다.
   *
   * 인위적으로 겹침을 늘리지 않았으므로(문턱과 취약 창 로직을 그대로 두고
   * 취약 창의 조기 return만 없앴다) 이 카운터는 순수하게 자연 발생 빈도와
   * 그때 실제로 몸을 지켰는지를 잰다 — 부검·측정 전용이고 판정에는 관여하지
   * 않는다.
   */
  const overlapping = boss.vulnerableMs > 0;
  if (overlapping) tally.vulnOverlapSeen += 1;
  const ramp = bossRampFor(tally);
  const frac =
    (BALANCE.telegraphDmgFirst + (BALANCE.telegraphDmg - BALANCE.telegraphDmgFirst) * ramp) *
    bossKit(boss.breed.id).power;
  const hue = t.mode === "gather" ? FX_GATHER : FX_DANGER;

  /**
   * 장판 전체가 짧게 번쩍인다.
   *
   * 전에는 발동 순간에 그리던 것이 작은 고리 하나뿐이었다 — 예고선이 스르륵
   * 사라지는 것과 크게 안 갈려서 "터졌다"가 아니라 "꺼졌다"로 읽혔다. `burst`는
   * `drawTelegraphs`가 장판을 그리는 것과 같은 모양(원·직선·부채꼴)을 그대로
   * 채워 넣으므로, 방금 위험했던 그 자리가 정확히 빛나고 사라진다.
   */
  pushFx({
    kind: "burst",
    fx: t.fx,
    fy: t.fy,
    tx: 0,
    ty: 0,
    radius: 0,
    angle: 0,
    life: BURST_LIFE_MS,
    color: hue,
    shape: t.shape,
    dirX: t.dirX,
    dirY: t.dirY,
    arg: t.arg,
    reach: t.reach,
  });

  if (t.mode === "gather") {
    /**
     * 청록 원은 **대피소**다. 안에 있으면 안 맞고, 밖에 있으면 맞는다 —
     * 붉은 장판의 정확한 반대이고, 그래서 규칙이 둘이 아니라 하나다.
     * "장판 색이 안이냐 밖이냐를 말한다."
     *
     * 전에는 WoW의 soak였다. 절반 이상이 들어오면 피해를 **들어온 것들끼리
     * 나눠 받고**, 모자라면 전원이 크게 맞았다. 규칙으로는 말이 되는데 화면에서
     * 거짓말을 했다 — 제때 눌러 제대로 모였는데도 숫자가 떴다. 실제로
     * "눌러서 피했는데 데미지가 들어온다"는 보고를 받았고, 계측해 보니 기능이
     * 아니라 설계가 그랬다. 성공했는데 벌을 받으면 다음부터 안 누른다.
     *
     * 모이는 것이 공짜가 되는 건 아니다. 뭉친 직후에는 무게중심이 한 점이라
     * 다음 원형 예고가 통째로 덮는다 — 그래서 아래에서 moveLock을 풀어 곧바로
     * 흩어질 수 있게 한다. 대가는 피해가 아니라 **다음 한 수**가 진다.
     */
    const outside = foes.filter((f) => !inTelegraph(t, f.fx, f.fy, BALANCE.telegraphBodyPad));
    const avoided = outside.length === 0;
    if (!avoided) tally.telegraphsEaten += 1;
    if (overlapping && avoided) tally.vulnOverlapDodged += 1;
    for (const f of outside) {
      damage(f, telegraphHit(f, boss, frac), false);
      fireTelegraphHitFx(f, boss, hue);
    }
    // 뭉침이 끝나면 곧바로 흩어질 수 있어야 한다. 묶어 두면 다음 원형 예고가
    // 무게중심을 노려 통째로 맞고, 그러면 모인 것이 벌이 된다.
    for (const f of foes) f.moveLock = 0;
  } else {
    let caught = 0;
    for (const f of foes) {
      if (!inTelegraph(t, f.fx, f.fy, BALANCE.telegraphBodyPad)) continue;
      caught += 1;
      // 최대 체력 대비 비율이라 웨이브·팀 구성과 무관하게 "뭉치면 아프다"가 성립한다.
      damage(f, telegraphHit(f, boss, frac), false);
      fireTelegraphHitFx(f, boss, hue);
    }
    // 한 마리라도 걸리면 실패로 친다. "몇 마리 맞았나"는 팀 크기에 따라 달라져
    // 판끼리 비교가 안 되지만, "피했나 못 피했나"는 언제나 같은 뜻이다.
    const avoided = caught === 0;
    if (!avoided) tally.telegraphsEaten += 1;
    if (overlapping && avoided) tally.vulnOverlapDodged += 1;
  }
}

/**
 * 순간이동 페이드 세 단계의 길이(ms). 셋을 합치면 순간이동 한 번이 약 1.1초다.
 * `out`·`in`은 render.ts가 알파를 계산할 때도 쓰므로 내보낸다.
 */
export const BLINK_OUT_MS = 350;
const BLINK_GONE_MS = 400;
export const BLINK_IN_MS = 350;

/**
 * 보스의 다음 순간이동을 시작한다.
 *
 * 전에는 좌표를 그 자리에서 바로 바꿨다 — 판정은 맞지만 화면에서는 "그냥 딴 데
 * 가 있네"였다. 지금은 `blink`에 목적지만 적어 두고 **즉시 옮기지 않는다.**
 * 실제 좌표 이동은 부재("gone")가 시작되는 순간 `tickBlink`가 한다 — 근접은
 * 다시 걸어가야 하고, 뒤이어 뜨는 예고의 기준점도 그 새 자리로 바뀐다.
 */
function teleportBoss(boss: Cat, idx: number): void {
  const a = BOSS_ANCHORS[idx % BOSS_ANCHORS.length];
  if (!a) return;
  const to = cellToField("enemy", a.row * BOARD_COLS + a.col);
  if (Math.abs(to.fx - boss.fx) < 0.1 && Math.abs(to.fy - boss.fy) < 0.1) return;

  boss.blink = { phase: "out", ms: BLINK_OUT_MS, to };
  // 사라지는 자리를 표시한다. 나타나는 자리는 실제로 도착하는 순간(`tickBlink`가
  // 좌표를 옮길 때) 표시한다 — 미리 찍으면 아직 오지도 않은 자리가 위험한지
  // 아닌지 먼저 알려주는 꼴이 된다.
  pushFx({
    kind: "ring",
    fx: boss.fx,
    fy: boss.fy,
    tx: 0,
    ty: 0,
    radius: boss.radius,
    angle: 0,
    life: BLINK_OUT_MS + 80,
    color: FX_DANGER,
  });
}

/**
 * 순간이동 페이드를 한 스텝 진행한다.
 *
 * **`stepBattle`의 고정 스텝(`dt`)으로만 불러야** 헤드리스 시뮬과 브라우저가
 * 같은 결과를 낸다 — `performance.now()` 같은 벽시계 값을 쓰면 프레임 간격이
 * 다른 두 환경이 서로 다른 순간에 단계를 넘긴다. `dt`는 `SIM_STEP_MS`(100ms)를
 * 못 넘으므로 한 번의 호출로 최대 한 단계만 넘어간다 — 반복문이 필요 없다.
 *
 * 단계가 바뀔 때 남은 시간을 다음 단계로 carry하지 않는다. 다른 시간 축
 * 상태들(`flash`, `moveLock` 등)과 같은 규칙이고, 순수 연출이라 몇십 ms의
 * 오차는 눈에 띄지 않는다.
 */
function tickBlink(boss: Cat, dt: number): void {
  const b = boss.blink;
  if (!b) return;
  b.ms -= dt;
  if (b.ms > 0) return;
  if (b.phase === "out") {
    b.phase = "gone";
    b.ms = BLINK_GONE_MS;
    // 도착하는 자리를 여기서 표시한다 — 좌표를 옮기는 바로 그 순간이라
    // "사라지는 자리·나타나는 자리 양쪽 표시"라는 원래 의도가 유지된다.
    // 부재("gone")와 페이드인("in")을 합친 시간만큼 살려 둔다.
    boss.fx = b.to.fx;
    boss.fy = b.to.fy;
    pushFx({
      kind: "ring",
      fx: boss.fx,
      fy: boss.fy,
      tx: 0,
      ty: 0,
      radius: boss.radius,
      angle: 0,
      life: BLINK_GONE_MS + BLINK_IN_MS,
      color: FX_DANGER,
    });
  } else if (b.phase === "gone") {
    b.phase = "in";
    b.ms = BLINK_IN_MS;
  } else {
    boss.blink = null;
  }
}

/** 보스의 체력 문턱을 보고 예고를 걸거나 터뜨린다. */
function tickBoss(boss: Cat, foes: Cat[], dt: number, tally: RunState): void {
  if (!boss.alive) return;

  /**
   * 순간이동 페이드가 진행 중이면 그것만 본다.
   *
   * 부재("gone") 동안 예고까지 걸리면 "안 보이는데 장판은 있다"는 모순이
   * 생긴다. 그래서 취약 창·예고 로직 전체를 건너뛴다 — 페이드가 끝나야
   * 비로소 정상적인 보스 로직으로 돌아간다.
   */
  // 취약 창 타이머는 무엇이 진행 중이든 흐른다. blink 분기보다 위에 있는
  // 이유: 아래 조기 return들 뒤에 두면 창이 열린 채 순간이동이 겹칠 때
  // 타이머가 최대 1.1초 얼어붙는다 — 리뷰 실측에서 실제로 잡힌 동결이다.
  if (boss.vulnerableMs > 0) {
    boss.vulnerableMs = Math.max(0, boss.vulnerableMs - dt);
    if (boss.vulnerableMs === 0) boss.strikeCombo = 0;
  }

  if (boss.blink) {
    tickBlink(boss, dt);
    if (boss.blink) return; // 아직 진행 중이면 이번 스텝은 여기서 끝난다.
    // 막 도착했다 — 미뤄 둔 예고를 이제 이 자리에서 건다("연출이 끝난
    // 자리에서 예고"). thresholdIdx는 페이드를 시작할 때부터 그대로였으므로
    // 이 예고가 원래 걸렸어야 할 패턴과 정확히 같다.
    updateBossPhase(boss, bossKit(boss.breed.id));
    boss.telegraph = makeTelegraph(boss, foes, boss.thresholdIdx);
    boss.thresholdIdx += 1;
    return;
  }

  const kit = bossKit(boss.breed.id);

  if (boss.telegraph) {
    boss.telegraph.fuse -= dt;
    if (boss.telegraph.fuse <= 0) {
      fireTelegraph(boss, foes, tally);
      boss.telegraph = null;
    }
    return; // 예고 중에는 다음 문턱을 밟아도 겹쳐 걸지 않는다
  }

  /**
   * 취약 창의 **앞 절반은 순수 연타 타임**이다. 처음 조기 return을 걷어냈을
   * 때는 창을 연 문턱이 소비되지 않은 채 이 검사로 흘러 **창이 열린 지
   * 100ms 만에 예고가 반드시 걸렸다** — 자유 창 시간이 100%에서 15%로
   * 무너졌고(리뷰 실측), 그건 "가끔 오는 진짜 선택"이 아니라 창의 처형이다.
   * 뒷 절반부터만 문턱이 발화하므로 겹침은 사건으로 남고 창은 값을 지킨다.
   */
  if (boss.vulnerableMs > kit.vulnerableMs / 2) return;

  const frac = boss.hp / Math.max(1, boss.maxHp);
  const next = BOSS_THRESHOLDS[boss.thresholdIdx];
  if (next === undefined || frac > next) return;

  // 한 번 걸러 자리를 옮긴 뒤 그 자리에서 예고한다. 순서가 반대면 예고가
  // 뜬 곳과 터지는 곳이 달라져 화면이 거짓말을 한다.
  // 창을 여는 분기가 예고보다 먼저다. 창 전반부는 위의 유예가 예고를 막아
  // 연타 타임을 보장하고, 후반부에 문턱을 밟으면 그때는 겹칠 수 있다 —
  // 그 순간의 버튼은 회피가 먼저다(resolveIntent와 buttonText가 같은 규칙).
  if (!boss.vulnerableUsed && frac <= kit.vulnerableAt) {
    boss.vulnerableUsed = true;
    boss.vulnerableMs = kit.vulnerableMs;
    boss.strikeCombo = 0;
    pushFx({
      kind: "ring",
      fx: boss.fx,
      fy: boss.fy,
      tx: 0,
      ty: 0,
      radius: boss.radius * 1.3,
      angle: 0,
      life: 520,
      color: "#F0BA4A",
    });
    return;
  }

  /**
   * 창이 열려 있는 동안에는 자리를 옮기지 않는다. 옮기면 보스가 화면에서
   * 사라진 채 취약 창만 남아 — 버튼은 "할퀴기!"인데 때릴 몸이 없다 —
   * 리뷰 실측에서 보스전 75.6%가 이 상태를 겪었다.
   *
   * 이건 **연기가 아니라 그 문턱의 순간이동을 건너뛰는 것**이다. 아래
   * `thresholdIdx += 1`은 그대로 실행되므로 다음 기회는 2문턱 뒤다 — 실측으로
   * 전당 순간이동이 무쇠발톱 2.07→1.40회, 살금이 2.71→1.90회(−30%) 줄었다.
   * 그래도 스킵을 택한다: 연기(teleportPending)는 새 상태가 blink·창과 다시
   * 얽혀 방금 닫은 조합을 도로 열고, 살금이 튜닝 이력(bosses.ts)이 경계한
   * 것은 "너무 잦음"(추격전)이지 하한이 아니다. 리듬이 부족해지면 이 가드가
   * 아니라 teleportEvery로 되돌릴 것.
   */
  if (boss.vulnerableMs <= 0 && kit.teleportEvery > 0 && boss.thresholdIdx % kit.teleportEvery === 0) {
    teleportBoss(boss, Math.floor(boss.thresholdIdx / Math.max(1, kit.teleportEvery)));
    // 페이드가 시작됐으면 예고는 그게 끝난 뒤(이 함수 위쪽의 `blink` 분기)에
    // 건다. 목적지가 이미 지금 자리와 같아 `teleportBoss`가 아무 것도 안
    // 했으면(`blink`가 안 생겼으면) 그대로 이어서 평소처럼 예고를 건다.
    if (boss.blink) return;
  }
  updateBossPhase(boss, kit);
  boss.telegraph = makeTelegraph(boss, foes, boss.thresholdIdx);
  boss.thresholdIdx += 1;
}

/** 한 프레임 분량을 고정 스텝으로 시뮬레이션한다. */
export function stepBattle(state: RunState, dtMs: number): void {
  tickEffects(state.ally, dtMs);
  tickEffects(state.enemy, dtMs);
  tickEffects(state.summons, dtMs);

  for (let i = damagePops.length - 1; i >= 0; i--) {
    const p = damagePops[i];
    if (!p) continue;
    p.life -= dtMs;
    if (p.life <= 0) damagePops.splice(i, 1);
  }
  for (let i = shots.length - 1; i >= 0; i--) {
    const s = shots[i];
    if (!s) continue;
    s.life -= dtMs;
    if (s.life <= 0) shots.splice(i, 1);
  }
  for (let i = fxs.length - 1; i >= 0; i--) {
    const f = fxs[i];
    if (!f) continue;
    f.life -= dtMs;
    if (f.life <= 0) fxs.splice(i, 1);
  }

  if (state.phase !== "battle") return;

  // 전투 첫 프레임에 도적이 뛰어든다.

  let remaining = Math.min(dtMs, SIM_STEP_MS * 4); // 탭 복귀 시 폭주 방지
  while (remaining > 0) {
    const step = Math.min(SIM_STEP_MS, remaining);
    remaining -= step;
    state.battleElapsed += step;

    /**
     * 전투를 여는 처리. **첫 스텝이 실제로 돌 때** 한 번만 한다.
     *
     * 전에는 루프 밖에서 `battleElapsed === 0`으로 걸었다. 그런데 `dt`가 0인
     * 프레임이 한 번 오면 `remaining = 0`이라 루프가 한 번도 안 돌고
     * `battleElapsed`가 0에 남는다 — 다음 프레임에 조건이 또 참이 되어 소환이
     * 다시 일어난다(분신 2마리가 4마리가 된다). 브라우저는 타이머 정밀도를
     * 낮출 때 rAF 타임스탬프가 같은 값으로 두 번 올 수 있고, 하네스는 항상
     * 100ms를 넘기므로 이 경로를 못 밟는다.
     *
     * 여기서는 `battleElapsed`가 방금 0에서 올라온 순간에만 참이다.
     *
     * 소환이 도약보다 먼저다. 도약 뒤에 부르면 적진 맨 뒤로 뛴 도적이 '가장
     * 앞선 고양이'가 되어, 분신이 우리 진형이 아니라 적 뒷줄에 생긴다.
     */
    if (state.battleElapsed === step) {
      openingSummons(state);
      assassinLeap(state);
    }

    // 의도는 스텝당 하나만 소비한다. 브라우저(~17ms)와 시뮬(100ms)의 입력
    // 해상도가 달라도 같은 규칙에 묶이도록.
    if (state.pending.length > PENDING_CAP) state.pending.length = PENDING_CAP;
    if (state.actCooldown > 0) state.actCooldown = Math.max(0, state.actCooldown - step);

    /**
     * 쿨다운은 **차지를 쓰는 것에만** 건다. 약점 공격은 연타가 곧 화력이라
     * (창 3초에 최대 30타) 1초를 걸면 3타가 되어 창 자체가 없어진다.
     *
     * 잠긴 동안 들어온 의도는 **버리지 않고 큐에 남긴다.** 처음엔 그냥
     * 흘렸는데, 그러면 누른 것이 소리 없이 사라진다 — 계측에서 회피 성공률이
     * 100%에서 40%로 떨어졌고, 사람 입장에서는 분명히 눌렀는데 맞은 것이다.
     * 남겨 두면 풀리는 순간 나가고, 그 사이 예고가 지나갔으면 `doDodge`가
     * 알아서 아무 일도 안 한다(차지도 안 쓴다).
     */
    const head = state.pending[0];
    const locked =
      state.actCooldown > 0 &&
      head !== undefined &&
      resolveIntent(state, head)?.kind !== "strike";
    const intent = locked ? undefined : resolveIntent(state, state.pending.shift());
    if (intent?.kind === "dodge" && state.dodgeCharges > 0 && doDodge(state)) {
      state.dodgeCharges -= 1;
      state.actCooldown = ACT_COOLDOWN_MS;
    } else if (intent?.kind === "gather" && state.dodgeCharges > 0 && doGather(state)) {
      state.dodgeCharges -= 1;
      state.actCooldown = ACT_COOLDOWN_MS;
    } else if (intent?.kind === "strike") {
      // 약점 공격은 차지를 쓰지 않는다. 창이 열려 있는 3초 자체가 제한이다.
      doStrike(state);
    }

    tickSummons(state, step);
    // 전멸 판정은 **진짜 고양이만** 본다. 분신이 남아 있다고 판이 이어지면
    // 죽은 뒤에 분신이 대신 싸우는 6초가 생긴다.
    const realAllies = livingCats(state.ally);
    const allies = allyBodies(state);
    // 달리기는 타겟팅·공격보다 먼저 처리한다. 이번 스텝의 사거리 판정이
    // **도착한 자리** 기준이라야, 위험 구간을 빠져나온 것이 그 스텝에 반영된다.
    //
    // 양쪽 다 돈다. 개입은 아군만 쓰지만 도적 도약은 적도 하므로, 여기서 적을
    // 빠뜨리면 적 도적이 허공에 멈춘 채로 전투가 끝난다.
    tickDashes(allies, step);
    const foes = foeBodies(state);
    tickDashes(foes, step);
    for (const e of foes) if (e.radius > 0) tickBoss(e, allies, step, state);

    // 양쪽 다 **진짜 고양이만** 센다. 소환수가 남았다고 판이 이어지면
    // 죽은 뒤에 분신이 대신 싸우는 시간이 생긴다.
    const realFoes = livingCats(state.enemy);
    if (realAllies.length === 0 || realFoes.length === 0) {
      finishWave(state, realFoes.length === 0 && realAllies.length > 0);
      return;
    }

    // 쿨다운이 많이 지난 순으로 행동해 동시 공격의 판정 순서를 결정적으로 만든다.
    const actors = [...allies, ...foes].sort(
      (a, b) => a.cooldown - b.cooldown || (a.uid < b.uid ? -1 : 1),
    );

    // 이번 스텝에 각 적이 몇 명에게 찍혔는지. 몰리는 걸 막아 난전이 퍼지게 한다.
    const claimed = new Map<string, number>();

    for (const cat of actors) {
      if (!cat.alive) continue;
      // 기절·빙결 중에는 이동도 공격도 못 한다. 쿨다운도 멈춘다.
      if (cat.stun > 0) continue;
      // 순간이동 페이드 중인 보스는 아무 행동도 안 한다. 흐려지는 동안에도
      // 이동·공격을 계속하면 "사라지고 있는데 여전히 때린다"는 모순이 생긴다.
      if (cat.blink) continue;

      // 적은 분신도 노린다 — 그게 분신의 값이다. 노려지지 않으면 그냥
      // 화면에 있는 장식이고, 맞아 주는 몸이라는 성격이 사라진다.
      // **매번 새로 뽑는다.** `allies`는 이 루프가 돌기 전의 스냅샷이라,
      // 이번 스텝에 죽은 아군이 그 안에 남는다 — `pickTarget`은 alive를
      // 거르지 않으므로 적이 시체를 계속 때린다(화면엔 시체 위로 데미지가
      // 뜨고, 그만큼 적 공격이 통째로 낭비돼 판이 조용히 쉬워진다).
      // 아군 쪽은 원래부터 `livingCats(state.enemy)`를 매번 불렀다.
      const enemies = cat.side === "ally" ? foeBodies(state) : allyBodies(state);
      const target = pickTarget(cat, enemies, claimed);
      /**
       * 예전에는 여기가 `break`였다 — `foes`/`allies`가 실전멸 판정을 통과한
       * 뒤라 항상 후보가 있었으니(전멸이면 이 루프 진입 전에 이미 끝난다)
       * 도달할 일이 없는 자리였다. 지금은 다르다: 남은 적이 순간이동 부재
       * ("gone") 중인 보스 하나뿐이면 `pickTarget`이 아무도 못 찾는다. 그건
       * "적이 없다"가 아니라 "지금은 못 때린다"는 뜻이므로 이 행동자만 쉬고
       * 나머지는 계속 행동해야 한다.
       */
      if (!target) continue;
      // 보스가 지금 무엇을 노리는지는 render가 표식을 그릴 때 읽는다.
      if (cat.side === "enemy" && cat.radius > 0) cat.targetRef = target.uid;
      claimed.set(target.uid, (claimed.get(target.uid) ?? 0) + 1);

      cat.cooldown -= step;

      if (surfaceDistance(cat, target) <= cat.breed.range) {
        if (cat.cooldown <= 0) {
          // 마나가 가득 찼으면 평타 대신 스킬이 나간다.
          // 소환수는 제외한다 — 주인의 스킬이 그대로 복제되면 분신이 화력
          // 증폭 장치가 되고, 그러면 `atk_mul` 유물과 같은 축이 된다.
          const own = cat.side === "ally" ? livingCats(state.ally) : livingCats(state.enemy);
          // 소환수는 `own`에 없다. 주인의 breed를 쓰므로 감싸기·핥아주기의
          // 대상이 될 수 있는데, 6~20초 뒤 사라질 몸을 지키는 것은 낭비다.
          const cast =
            cat.breed.skill !== null &&
            !cat.summon &&
            cat.mana >= MANA_MAX &&
            castSkill(state, cat, target, enemies, own);
          if (!cast) {
            attack(cat, target);
            ricochet(cat, target, enemies);
          }
          // 연격이 쌓이면 다음 공격이 빨라진다
          cat.cooldown += cat.atkInterval / comboSpeed(cat);
        }
      } else {
        stepToward(cat, target, step);
        // 이동 중에도 쿨다운은 돈다. 그래야 도착하자마자 때려서 답답하지 않다.
        // 다만 음수로 쌓이면 도착 즉시 연타가 되므로 0에서 멈춘다.
        if (cat.cooldown < 0) cat.cooldown = 0;
      }
    }

    separate(allies);
    separate(foes);

    if (state.battleElapsed >= battleTimeout(state)) {
      finishWave(state, false, "timeout");
      return;
    }
  }
}
