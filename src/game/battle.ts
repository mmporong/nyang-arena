import { BALANCE } from "./balance.ts";
import {
  BOSS_ANCHORS,
  BOSS_BREEDS,
  BOSS_THRESHOLDS,
  bossKit,
  CREEP_DMG_MUL,
  CREEP_IDLE_DESPAWN_MS,
  CREEP_RADIUS_STEPS,
  CREEP_TICK_MS,
  FINAL_CHANNEL_MS,
  FINAL_HEAL_FRAC,
  FINAL_MIN_HP_FRAC,
  FINAL_VULNERABLE_MS,
  SEIZE_ADJACENT_RADIUS,
  SEIZE_FAIL_FRAC,
  SEIZE_FUSE_MS,
  SEIZE_GATHER_RADIUS,
  SEIZE_KNOCKBACK,
  SWEEP_DMG_MUL,
  SWEEP_FUSE_MS,
  SWEEP_WAVE_ROWS,
  TELEGRAPH_FUSE_MS,
  type BossKit,
} from "./bosses.ts";
import { mixSeed, rng } from "./rng.ts";
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
  type CreepZone,
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
  activeRaidContract,
  bossRampFor,
  currentKind,
  finishWave,
  KITTEN,
  makeSummon,
  MIRROR_IMAGE,
  raidBossPower,
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
 * 상주 장판(creep). 발동 후에도 사라지지 않는 예고 하나당 원소 하나다.
 *
 * `fxs`·`damagePops`·`shots`와 같은 모듈 전역 배열이지만 **연출이 아니라
 * 판정 상태다** — 피해·성장이 이 배열의 원소를 직접 읽고 고친다. 그래서
 * 저 셋과 달리 아무 데서나 비워도 되는 게 아니라, **전투가 끝나는 바로 그
 * 순간**(`stepBattle`의 두 `finishWave` 호출 지점) 명시적으로 비운다 —
 * "상주 장판이 전투 종료 후 남지 않는다"를 invariants가 그 즉시 검사할 수
 * 있어야 하기 때문이다. `clearBattleFx`에도 넣어 두는 것은 전체 런 재시작
 * (다시 도전) 경로에 대한 이중 안전장치일 뿐, 주된 보장은 아니다.
 */
export const creepZones: CreepZone[] = [];

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
  creepZones.length = 0;
  clearSweepQueue();
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
  /**
   * 최종 국면(finalPhase, US-404) 채널 동안은 **무적**이다. `tickFinalPhase`
   * 주석이 "예고도 공격도 멈춘다"고 약속하는데, 그 약속을 코드로 지키는
   * 자리가 여기다 — 보스를 스턴시켜도(`startFinalPhase`) 보스 자신의 행동만
   * 멎을 뿐, 아군의 평타·스킬·DoT는 계속 boss를 때린다. 실측으로 채널 진입
   * 후 96.6%(기준 봇)·77.6%(입력 잠금만 지킨 정책)가 채널 도중 보스가
   * 죽어 연출이 아예 재생되지 않았다 — "무적"이 주석에만 있고 코드에는
   * 없었던 것이다. 여기서 막으면 doStrike(잔여 vulnerableMs 틈)까지 포함해
   * 보스로 가는 모든 피해 경로가 한 번에 잠긴다.
   */
  if (target.finalPhase?.stage === "channel") return;
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
    // 표식은 살아 있는 구조 대상에게만 의미가 있다. 다음 tickEffects까지
    // 미루면 한 스텝 동안 `alive=false && seized=true`가 관측되어 렌더와
    // 불변식이 갈리므로 사망 전이 안에서 원자적으로 끝낸다.
    target.seized = false;
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
    // 극성(polarity)의 두 번째 동시 예고도 같은 이유로 지운다 — 안 지우면
    // 죽은 보스 밑에 반쪽 장판이 남는다.
    target.telegraph2 = null;
    target.blink = null;
    target.vulnerableMs = 0;
    target.vulnerableCharges = 0;
    // 최종 국면(finalPhase, US-404) 도중 보스가 죽으면(마지막 취약 창에서
    // 흔히 일어난다 — 그게 이 국면의 성공 조건이다) `tickBoss`가 다시는
    // 이 상태를 안 건드리므로 여기서 지운다. 안 지우면 죽은 보스가 화면을
    // 계속 어둡게 누르고, 다음 전투까지 "전투 밖에 최종 국면이 남았다"로 샌다.
    target.finalPhase = null;
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

  /**
   * 절반(half) 장판은 고리 탐색 대신 **경계를 최단 거리로 넘는 좌표를 직접
   * 계산한다.** 아래 고리 탐색의 상한은 반경 4.95칸(ring 9 × 0.55)인데,
   * 절반 장판은 판 전체(`FIELD_MAX_FX`)를 가르는 경계라 위험 쪽 깊숙이 선
   * 고양이가 넘어야 할 거리가 그보다 클 수 있다 — 실측(리뷰 (f))으로 위험
   * 반쪽이 아군 홈 쪽일 때 산개 성공률이 0%였다. 방향(`dirX` 부호)이 이미
   * 정해져 있으니 거리와 무관하게 경계 바로 너머 한 점으로 곧장 갈 수 있다
   * — `doGather`가 gather 반쪽을 넘을 때 쓰는 것과 같은 계산이다. 그 점이
   * 다른 장판(creep 등)과 겹쳐 다시 위험하면 아래 고리 탐색으로 넘어간다.
   */
  for (const z of zones) {
    if (z.shape !== "half") continue;
    // 이 반쪽이 실제로 이 고양이를 위협할 때만 지름길을 쓴다. 가드가 없으면
    // 고양이가 이미 안전한 반쪽에 서 있어도(위협은 creep/sweep 등 다른
    // 장판인데) 무관한 half 경계로 원거리 순간이동을 시켜버린다 — 진짜
    // 위협에 맞춘 고리 탐색을 건너뛰고 엉뚱한 자리로 보내는 셈이다.
    if (!inTelegraph(z, cat.fx, cat.fy, BALANCE.telegraphBodyPad)) continue;
    const fx = z.dirX >= 0 ? z.fx - DODGE_MARGIN : z.fx + DODGE_MARGIN;
    const fy = cat.fy;
    if (onBoard(fx, fy) && !risky(fx, fy)) return { fx, fy };
  }

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

export function vulnerableWindowBoss(state: RunState): Cat | undefined {
  return state.enemy.find(
    (c) =>
      c?.alive &&
      c.radius > 0 &&
      c.vulnerableMs > 0 &&
      c.finalPhase?.stage !== "channel" &&
      !(c.blink && c.blink.phase === "gone"),
  ) ?? undefined;
}

function strikeTarget(state: RunState): Cat | undefined {
  const boss = vulnerableWindowBoss(state);
  return boss && boss.vulnerableCharges > 0 ? boss : undefined;
}

/**
 * 지금 결정타가 실제로 성립하는가.
 *
 * 전투 판정·버튼 얼굴·포인터/키 입력이 이 한 문을 공유한다. 살아 있고 판에
 * 존재하는 보스의 취약 창이어야 하며, 최종 채널·순간이동 부재 중에는 닫힌다.
 * 창 전용 기회가 남아 있을 때만 열린다. 전투 전체 회피 차지는 결정타 접근권을
 * 늘리지 않는다.
 */
export function strikeUsable(state: RunState): boolean {
  return strikeTarget(state) !== undefined;
}

/**
 * 원버튼 `act`가 지금 실제로 낼 행동. 입력 반복 게이트와 전투 소비가 이 판정을
 * 공유해야, 상주 장판이 있는 취약 창처럼 `hazardsActive`와 보스 예고가 다른
 * 상태에서도 키 얼굴과 실제 행동이 갈라지지 않는다.
 */
export function actIntentKind(state: RunState): Intervention["kind"] {
  const defense = defenseIntentKind(state);
  if (defense) return defense;
  return strikeUsable(state) ? "strike" : "dodge";
}

/** 원버튼 act가 지금 실제로 결과를 낼 수 있는가. 입력과 버튼이 공유한다. */
export function actUsable(state: RunState): boolean {
  const defense = defenseIntentKind(state);
  if (defense === "gather") return defenseResourceAvailable(state);
  if (defense === "dodge") return dodgeUsable(state);
  return strikeUsable(state);
}

/**
 * 결정타. 창 전용 기회 하나를 최대 체력 7% 피해로 바꾼다.
 *
 * 성공한 타격만 기회를 소비하고 전투 전체 회피 차지는 건드리지 않는다. 속도
 * 연타 보상이 아니므로 별도 행동 쿨다운을 걸지 않는다.
 */
function doStrike(state: RunState): boolean {
  if (!strikeUsable(state)) return false;
  const boss = strikeTarget(state);
  if (!boss) return false;

  boss.vulnerableCharges -= 1;
  damage(boss, Math.max(1, Math.round(boss.maxHp * BALANCE.strikeFrac)), false);
  const used = BALANCE.vulnerableChargesPerWindow - boss.vulnerableCharges;
  pushFx({
    kind: "slash",
    fx: boss.fx,
    fy: boss.fy,
    tx: 0,
    ty: 0,
    radius: boss.radius * 0.8,
    angle: (used % 6) * 0.5,
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
 *
 * **`mode`로 걸러야 한다.** 극성(polarity)에서는 avoid 반쪽이 `telegraph`
 * (주 필드)를 차지하고 gather 원은 `telegraph2`에 담긴다 — `e.telegraph`만
 * 보면 극성일 때 늘 avoid 반쪽을 "모일 자리"로 착각해 아군을 위험 한가운데로
 * 끌고 간다. 일반 gather 패턴(예: hearth)은 `telegraph`가 이미 gather이므로
 * 그대로 걸린다.
 *
 * **gather 장판은 항상 원형(circle)이다.** 극성의 gather 반쪽도 예전엔 절반
 * (half) 모양이어서 여기 전용 분기가 있었는데, 그 절반이 avoid의 정확한
 * 여집합이라 "avoid 밖으로 나가기"와 "gather 안으로 들어가기"가 같은
 * 목적지를 가리켰다 — 산개·집결·자동 세 정책이 항상 같은 결과를 냈다(리뷰
 * (d) 실측). 지금은 gather를 안전 반쪽 한가운데의 작은 원으로 만들어서
 * (`makeTelegraph`의 polarity 분기) 항상 이 원형 경로 하나만 탄다.
 */
function doGather(state: RunState): boolean {
  const zones: Telegraph[] = [];
  for (const e of state.enemy) {
    if (e?.telegraph?.mode === "gather") zones.push(e.telegraph);
    if (e?.telegraph2?.mode === "gather") zones.push(e.telegraph2);
  }
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
 * 지금 판 위에 있는 위험 전부 — 보스 telegraph·telegraph2 ∪ 상주 장판(creep)
 * ∪ 순차 스윕(sweep) 대기열.
 *
 * **"위험이 있는가"를 묻는 자리는 전부 이거 하나만 써야 한다.** creep과
 * sweep은 `state.enemy[].telegraph`에 안 산다 — creep은 발동 뒤 독립된
 * 장판으로 눌러앉고(`creepZones`), sweep은 문턱 하나가 5행을 예약해 자기
 * 큐(`sweepZones`)로 돈다. `s.enemy.some(c => c?.telegraph)`만 보는 사본이
 * 하나라도 있으면 그 사본은 creep·sweep이 떠 있는 동안 "위험 없음"으로
 * 잘못 읽는다 — 그 사본이 봇이면 안 피하고, 그 사본이 측정 하네스면
 * "게임이 어려워졌다"와 "봇이 눈이 멀었다"를 구분할 수 없게 된다(2차 반려
 * 진단). `scripts/`의 각 하네스·`render.ts`의 버튼 활성 판정이 전부 이
 * 함수를 부른다.
 */
export function hazardZones(state: RunState): Telegraph[] {
  const zones: Telegraph[] = [];
  for (const c of state.enemy) {
    if (c?.telegraph) zones.push(c.telegraph);
    if (c?.telegraph2) zones.push(c.telegraph2);
  }
  zones.push(...creepZones, ...sweepZones);
  return zones;
}

/** `hazardZones`가 하나라도 있는가. 봇·하네스가 "지금 반응할 게 있나"를 묻는 자리. */
export function hazardsActive(state: RunState): boolean {
  return hazardZones(state).length > 0;
}

/** 지금 청록 예고에 실제로 들어가야 하는 아군이 있는가. 판정만 하고 움직이지 않는다. */
function gatherActionNeeded(state: RunState): boolean {
  const zones: Telegraph[] = [];
  for (const e of state.enemy) {
    if (e?.telegraph?.mode === "gather") zones.push(e.telegraph);
    if (e?.telegraph2?.mode === "gather") zones.push(e.telegraph2);
  }
  const target = zones[0];
  if (!target) return false;

  for (const c of allyBodies(state)) {
    if (c.dash || inTelegraph(target, c.fx, c.fy, BALANCE.telegraphBodyPad)) continue;
    const dx = target.fx - c.fx;
    const dy = target.fy - c.fy;
    const d = Math.hypot(dx, dy) || 1;
    const pull = Math.max(0, d - target.arg * 0.6);
    const tx = c.fx + (dx / d) * pull;
    const ty = c.fy + (dy / d) * pull;
    if (dashMs(c, tx, ty) <= target.fuse) return true;
  }
  return false;
}

/** 지금 붉은 위험에서 실제로 빠져나올 수 있는 아군이 있는가. 판정만 하고 움직이지 않는다. */
function dodgeActionNeeded(state: RunState): boolean {
  const zones = hazardZones(state).filter((zone) => zone.mode === "avoid");
  if (zones.length === 0) return false;
  const creepSet = new Set<Telegraph>(creepZones);
  const timed = zones.filter((zone) => !creepSet.has(zone));
  const fuse = timed.length > 0 ? Math.min(...timed.map((zone) => zone.fuse)) : CREEP_TICK_MS;
  for (const c of allyBodies(state)) {
    if (c.dash) continue;
    const spot = safeSpot(c, zones);
    if (spot && dashMs(c, spot.fx, spot.fy) <= fuse) return true;
  }
  return false;
}

/**
 * 위험의 존재가 아니라 **지금 필요한 방어 행동**을 돌려준다.
 *
 * 상주 장판은 모두가 빠져나온 뒤에도 잠시 남는다. 그때 단순히
 * `hazardsActive`를 보면 안전한 취약 창의 결정타까지 막히므로, 실제로 이동할
 * 아군이 있을 때만 방어가 공격보다 앞선다.
 */
export function defenseIntentKind(state: RunState): "dodge" | "gather" | null {
  const primary = state.enemy.find((c) => c?.alive && c.telegraph)?.telegraph;
  if (primary?.mode === "gather" && gatherActionNeeded(state)) return "gather";
  if (primary?.mode === "avoid" && dodgeActionNeeded(state)) return "dodge";
  // 보스 telegraph 밖에 사는 creep·sweep도 실제 점유 중이면 방어한다.
  if (dodgeActionNeeded(state)) return "dodge";
  return null;
}

function defenseResourceAvailable(state: RunState): boolean {
  return (vulnerableWindowBoss(state)?.vulnerableCharges ?? 0) > 0 || state.dodgeCharges > 0;
}

/** 성공한 방어가 창 기회를 먼저, 없으면 전투 전체 회피를 소비한다. */
function spendDefenseCharge(state: RunState): boolean {
  const boss = vulnerableWindowBoss(state);
  if (boss && boss.vulnerableCharges > 0) {
    boss.vulnerableCharges -= 1;
    return true;
  }
  if (state.dodgeCharges <= 0) return false;
  state.dodgeCharges -= 1;
  return true;
}

/**
 * 지금 회피/집결을 눌러 실제로 값을 볼 수 있는가 — **차지가 0이어도 참일 수
 * 있다.** 순차 스윕(sweep)의 두 번째 파동은 첫 파동에서 이미 차지를 냈으면
 * (`sweepBurstCharged`) 차지 없이도 공짜로 넘어간다("개입 1회로 연쇄
 * 전체를 넘긴다", 리뷰 (ㄷ)) — `stepBattle`의 소비 지점이 그 예외를 안다.
 *
 * **화면(render.ts의 버튼 활성 판정)과 측정 하네스(bot-policy.mjs 등)가
 * 전부 이 함수 하나로 "지금 눌러야 하는가"를 물어야 한다.** `state.
 * dodgeCharges > 0`만 보는 사본이 하나라도 남으면, 두 번째 파동이 뜬
 * 순간 버튼이 "전투 중"으로 죽어 보이거나(사람이 안 누른다) 봇이 아예
 * 큐에 안 넣어서(실측: 봇이 이 사본을 쓰는 채로는 SWEEP_DMG_MUL을 1.0으로
 * 되돌린 뒤 sim 중앙값이 10에서 안 올랐다) `stepBattle`의 무료 통로가
 * 있으나 마나가 된다.
 */
export function dodgeUsable(state: RunState): boolean {
  return defenseResourceAvailable(state) || sweepDodgeFree(state);
}

/**
 * 극성(polarity)이 지금 판 위에 떠 있는가.
 *
 * `telegraph2`가 있는 예고는 극성뿐이다 — `assignTelegraph`가 두 필드를 항상
 * 같이 채우고 같이 비우므로 이 필드 하나로 충분하다. 화면(버튼·키보드)과
 * `resolveIntent`가 "지금 버튼을 가를지"를 같은 기준으로 물어야 어긋나지
 * 않으므로 여기서 한 번만 정의하고 내보낸다.
 */
export function polarityActive(state: RunState): boolean {
  return state.enemy.some((c) => c?.alive && c.telegraph2);
}

/**
 * 버튼을 산개/집결 두 갈래로 가를지 정하는 **단일 게이트**.
 *
 * 지금은 극성(polarity)일 때만 참이다 — 반반 장판은 어느 쪽으로 가도 판의
 * 절반은 위험해서 자동 판단이 정의상 불가능한 유일한 경우이기 때문이다.
 *
 * **원버튼 폐기가 검토 중이다.** 모든 예고에서 산개/집결을 직접 고르게
 * 하기로 정해지면 이 함수 하나만(예: `state.enemy.some((c) => c?.alive &&
 * c.telegraph)`로) 바꾸면 된다 — 화면(render.ts의 버튼 분할·main.ts의
 * 클릭·키 라우팅)과 `resolveIntent`의 부검 카운터가 전부 이 함수 하나만
 * 보고 있어서, 그 순간 다른 곳을 손댈 필요가 없다. `polarityActive`를
 * 그대로 쓰지 않고 감싸는 이유가 이것이다 — 게이트의 조건과 "극성이란
 * 무엇인가"는 지금은 같은 말이지만 앞으로 갈라질 수 있는 별개의 질문이다.
 */
export function dualChoiceActive(state: RunState): boolean {
  return polarityActive(state);
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
 * 개입의 값을 재는 데 쓴다 — **그리고 극성일 때 화면·키보드도 이 경로로
 * 산개/집결을 직접 박아 넣는다(C1).** `act`만 아래에서 산개로 근사한다:
 * `doDodge`는 avoid 반쪽(`telegraph`)만 피하고 `doGather`는 gather
 * 반쪽(`mode==="gather"`인 쪽, 극성이면 `telegraph2`)만 노리므로, 사람이
 * 고른 대로 정확히 다른 동작이 나간다. 여기서 또 무엇을 할지 고치면
 * 화면이 이미 고른 것을 뒤집는 꼴이라 손대지 않는다.
 *
 * **우선순위: 예고가 활성이면 회피/집결이 결정타를 이긴다.**
 * `tickBoss`가 취약 창 **후반부**에는 문턱 예고를 허용하므로([2]), 창이
 * 열린 중에도 예고가 뜰 수 있다 — 그 순간은 몸을 지키는 쪽이 급하다.
 * 예고가 없을 때만 취약 창을 본다. 겹칠 때 이 우선순위 때문에 그 스텝은
 * 회피/집결로 소비되고 결정타는 못 나간다 — 취약 창이 열려도 남은 차지를
 * 공격과 방어 중 어디에 쓸지 고르게 된다(부검은 `vulnOverlapSeen`·
 * `vulnOverlapDodged`).
 */
function resolveIntent(state: RunState, intent: Intervention | undefined): Intervention | undefined {
  // 순수 함수로 둔다. **부검 카운터(`polarityChoices`)를 여기서 늘리지 않는다** —
  // `stepBattle`이 쿨다운에 막힌 큐 머리를 "strike인지만" 보려고 이 함수를
  // 스텝마다 다시 부르는데(`locked` 판정), 여기서 부작용을 내면 아직 큐에서
  // 안 빠져나온 같은 입력이 잠긴 동안 매 스텝 또 세어진다(실측: 입력 1회에
  // +9). 실제로 소비된(큐에서 빠져나온) 시점에만 `stepBattle`이 직접 센다.
  if (intent?.kind !== "act") return intent;
  return { kind: actIntentKind(state) };
}

/**
 * 입력 시점의 act 의미를 고정해 큐에 넣는다.
 *
 * 회피 쿨다운 동안 원본 `act`를 그대로 보관하면, 눌렀을 때는 방어였던 입력이
 * 소비될 때 취약 창 결정타로 재해석될 수 있다. 극성의 `dual`을 입력 순간에
 * 스냅샷하는 것과 같은 이유로 행동 종류도 여기서 한 번만 정한다. 브라우저와
 * 측정 봇이 모두 이 함수를 써야 정책 사본이 생기지 않는다.
 */
export function queueIntervention(state: RunState, intent: Intervention): void {
  const resolved = resolveIntent(state, intent);
  if (resolved) state.pending.push(resolved);
}

/** 위험 구간 안의 아군을 빼낸다. 실제로 누군가 빠져나왔을 때만 참을 돌려준다. */
function doDodge(state: RunState): boolean {
  const bossZones: Telegraph[] = [];
  for (const e of state.enemy) if (e?.telegraph) bossZones.push(e.telegraph);
  // 상주 장판(creep)도 피해야 할 구역이다 — battle.ts만의 별도 배열이라
  // `state.enemy`를 도는 위 루프엔 안 걸린다. `resolveIntent`는 이미 보스
  // 예고가 없으면 기본으로 dodge를 고르므로, 여기 넣는 것만으로 "creep만
  // 떠 있을 때 act를 누르면 빠져나온다"가 공짜로 성립한다.
  //
  // 순차 스윕(sweep) 대기열도 같은 이유로 넣는다 — 큐가 도는 동안
  // `boss.telegraph`는 계속 null이라(`makeTelegraph`의 sweep 분기 참고)
  // 위 루프엔 절대 안 걸리지만, 실제로 판 위에서 지금 켜져 있는 행은
  // 회피해야 할 진짜 위험이다.
  const zones: Telegraph[] = [...bossZones, ...creepZones, ...sweepZones];
  if (zones.length === 0) return false;

  /**
   * 남은 도화선. 여럿이면 가장 먼저 터지는 것에 맞춘다.
   *
   * **"언제 터지는지"가 있는 예고에서만 뽑는다** — 보스 예고와 sweep 둘 다
   * `fuse`가 실제 발동까지 남은 시간이다. creep은 다르다: `fuse`가 "다음
   * 성장 틱까지"라 700ms마다 0 근처로 떨어진다 — 그걸 이 최소값에 섞으면
   * 진짜 예고를 피하는 중에도 유예가 거의 0이 되어 "제때 못 나갔다"로
   * 오판된다(도착해도 `moved`가 안 켜진다). creep만 떠 있을 때는 터지는
   * 시점이 없으므로 "닿을 수 있으면 무조건 시도"가 맞는 규칙이라, creep
   * 자신의 틱 주기를 넉넉한 유예로 대신 쓴다.
   */
  const timedZones = [...bossZones, ...sweepZones];
  const fuse = timedZones.length > 0 ? Math.min(...timedZones.map((z) => z.fuse)) : CREEP_TICK_MS;
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
/**
 * 판의 오른쪽 끝. `clampToField`와 `safeSpot`이 같은 값을 봐야 한다.
 *
 * render.ts도 극성(polarity)의 절반 예고를 그릴 때 같은 값이 필요해
 * 내보낸다 — 화면의 사각형 경계와 판정의 경계가 다른 수식이면 반드시
 * 갈린다.
 */
export const FIELD_MAX_FX = ENEMY_FRONT_FX + BOARD_COLS - 1;

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
      // 표식(seize)이 걸린 채로 죽으면 판정도 못 받고 마커만 시체 위에
      // 영원히 남는다 — 죽음도 "표식의 역할이 끝났다"는 뜻이므로 지운다.
      if (c.seized) c.seized = false;
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
/**
 * 만들어진 예고. **`secondary`가 있는 건 극성(polarity)뿐이다.**
 *
 * `boss.telegraph`(하나)로는 극성의 "동시에 두 존"을 못 담아서, 만드는
 * 쪽을 쌍으로 돌려주고 붙이는 쪽(`tickBoss`)이 `telegraph`·`telegraph2`에
 * 나눠 담는다. 나머지 모든 패턴은 `secondary: null`이라 기존 흐름과
 * 다르지 않다.
 */
interface MadeTelegraph {
  primary: Telegraph;
  secondary: Telegraph | null;
}

/**
 * 극성(polarity) gather 원의 반경(칸).
 *
 * 리뷰 권고 범위(1.2~1.5) 안에서 1.3을 골랐다 — 안전 반쪽 한가운데(splitX의
 * 절반쯤 더 간 자리)까지 모여야 하므로 몸 하나 겨우 들어가는 크기(0.5 이하)면
 * 여럿이 부대끼다 밀려나고, 반쪽을 거의 다 덮는 크기(2.5 이상)면 다시 "아무
 * 데나 서 있으면 된다"로 물러나 산개와 구분이 사라진다. `pol-choice.mjs`
 * 재실측으로 세 정책(산개/집결/자동)이 실제로 갈리는지 확인할 것 — 갈리지
 * 않으면 이 값을 더 줄여 목적지를 더 좁고 멀게 만드는 것이 1순위 손잡이다.
 */
const POLARITY_GATHER_RADIUS = 1.3;

function makeTelegraph(boss: Cat, foes: Cat[], idx: number, tally: RunState): MadeTelegraph | null {
  if (foes.length === 0) return null;
  const kit = bossKit(boss.breed.id, activeRaidContract(tally));
  const patterns = boss.phase2 === true && kit.phase2Patterns !== undefined ? kit.phase2Patterns : kit.patterns;
  const pattern = patterns[idx % patterns.length]!;

  if (pattern === "creep") {
    /**
     * 성장형 장판(파멸의 오마주). 경고 반경이 첫 성장 단계(0.9칸)와 같다 —
     * 발동하는 순간 바로 그 크기의 원형이 `fireTelegraph`에서 상주 장판으로
     * 눌러앉기 때문이다(`resident: true`). 조준은 기존 circle과 같은 무게중심.
     */
    const c = centroid(foes);
    return {
      primary: {
        shape: "circle",
        mode: "avoid",
        fx: c.fx,
        fy: c.fy,
        dirX: 0,
        dirY: 0,
        arg: CREEP_RADIUS_STEPS[0],
        reach: 0,
        fuse: TELEGRAPH_FUSE_MS,
        fuseMax: TELEGRAPH_FUSE_MS,
        resident: true,
      },
      secondary: null,
    };
  }

  if (pattern === "sweep") {
    /**
     * 순차 스윕(안전지대 춤의 오마주). 행 0→4가 차례로 켜진다.
     *
     * **문턱 하나가 5행을 통째로 예약한다** — `enqueueSweep`이 5행을
     * `sweepPendingRows`에 한 번에 채우고, 그 뒤로는 `tickSweepQueue`가
     * `stepBattle`에서 매 스텝 독립적으로 진행한다(`creepZones`와 같은
     * "모듈 배열 + dt 진행" 전례). 예전엔 문턱 하나가 행 하나만 걸고 "다음은
     * 몇 행인가"를 보스(`sweepRow`)에 남겨서, 다음 sweep 문턱이 패턴 순환을
     * 한 바퀴 돌아 다시 걸릴 때까지 이어지지 않았다 — 실측(리뷰 sweep-chain)
     * 으로 한 보스전에서 행 0·1만, 간격 16초였다. "행이 차례로 켜진다"는
     * 설계와 달리 사실상 두 번 따로 뜨는 원형 예고에 가까웠다.
     *
     * `boss.telegraph`는 여기서 안 채운다(`null` 반환) — 스윕은 이제
     * `boss.telegraph`가 아니라 `sweepZones`에 산다. 문턱 자체는 그대로
     * 소비되므로(`tickBoss`의 `thresholdIdx += 1`은 안 건드린다) 보스는 다음
     * 문턱을 향해 계속 나아가고, 스윕 큐는 그와 무관하게 스스로 다 돈다.
     */
    enqueueSweep(boss);
    return null;
  }

  if (pattern === "polarity") {
    /**
     * 극성(타디우스 오마주). 판을 좌/우로 가른 절반은 회피(`shape: "half"`,
     * 경계 fx·dirX 부호가 안쪽 방향)해야 하고, 안전한 반쪽 **한가운데의 작은
     * 원**(`shape: "circle"`)까지 모여야 온전히 산다. 둘 다 같은 도화선으로
     * 동시에 걸었다가 동시에 터뜨린다(`tickBoss`가 `telegraph2`의 fuse를
     * `telegraph`에 맞춰 그대로 따라가게 한다).
     *
     * **gather 반경은 avoid의 여집합이 되면 안 된다.** 처음엔 gather도
     * avoid의 정확한 여집합(half)이었다 — 판정상 "avoid 밖으로 나가기"와
     * "gather 안으로 들어가기"가 완전히 같은 목적지였으므로, 산개·집결·
     * 자동(act) 세 정책이 전부 같은 결과를 냈다(리뷰 (d) 실측,
     * `pol-choice.mjs`: 세 정책 모두 100%). 원을 **작게** 만들어도(다음
     * 시도) 반경으로 고정한 자리는 여전히 "그 반쪽 아무 데나 서 있으면
     * 되는 산개"의 진부분집합일 뿐이라 관계가 안 바뀐다(리뷰 C2 지적) —
     * **위치 자체가 산개와 달라야 한다.**
     *
     * **원 중심을 팀 무게중심을 안전 반쪽에 사영한 자리로 잡는다.** 팀이
     * 이미 안전 쪽에 있으면(무게중심이 안전 반쪽) 원이 지금 서 있는 자리
     * 근처에 생겨 집결이 싸지고, 위험 쪽에 있거나 딱 걸쳐 있으면 원이
     * 경계 바로 안쪽(`DODGE_MARGIN`)에 생겨 산개(경계만 넘으면 끝)보다
     * 더 멀리 모이라고 요구한다 — 팀 대형에 따라 "이번엔 산개가 싼가
     * 집결이 싼가"가 실제로 갈린다.
     *
     * **방향은 시드로 결정한다, `rng()`는 안 쓴다.** 예전엔 `idx % 2`였는데,
     * 무쇠발톱의 `phase2Patterns`(`bosses.ts`)에서 "polarity"가 걸리는 idx는
     * 항상 3 mod 4(3, 7, 11 …)로 고정이라 `%2`가 매번 같은 값을 냈다 — 실측
     * 334/334판이 전부 같은 방향(avoid가 오른쪽)이었다(리뷰 B1). `mixSeed`
     * (rng.ts)로 시드·웨이브·이 문턱의 idx를 섞으면 공유 `rng()` 스트림을
     * 안 태우고도(다른 계통의 소비 순서에 영향 없이) 판마다, 그리고 한 판
     * 안에서 극성이 여러 번 걸리면 그때마다 결정적으로 방향이 갈린다.
     *
     * 경계는 **아군 보드 절반(fx 2)이 아니라 판 전체의 절반**이다. 근접은
     * 실제로 붙어 싸우는 동안 fx가 6~9까지 나가므로(sweep의 reach와 같은
     * 함정), 아군 보드로 좁히면 근접 팀은 늘 한쪽에만 몰려 판단이 사라진다.
     * `FIELD_MAX_FX`가 판의 오른쪽 끝이라 그 절반이 자연스러운 중앙선이다.
     */
    const splitX = FIELD_MAX_FX / 2;
    const avoidLeft = (mixSeed(mixSeed(tally.seed, tally.wave), idx) & 1) === 0;
    const avoidHalf: Telegraph = {
      shape: "half",
      mode: "avoid",
      fx: splitX,
      fy: 0,
      dirX: avoidLeft ? -1 : 1,
      dirY: 0,
      arg: 0,
      reach: 0,
      fuse: TELEGRAPH_FUSE_MS,
      fuseMax: TELEGRAPH_FUSE_MS,
    };

    // 예고 생성 시점(도화선이 켜지는 순간) 팀 무게중심 → 안전 반쪽으로 사영.
    const center = centroid(foes);
    const safeSign = avoidLeft ? 1 : -1; // 안전 반쪽이 있는 방향(avoid의 반대)
    const boundary = splitX + safeSign * DODGE_MARGIN;
    const projectedX = safeSign > 0 ? Math.max(center.fx, boundary) : Math.min(center.fx, boundary);
    // 원이 판을 넘어가지 않게 반경만큼 안쪽으로 눌러 담는다.
    const gatherFx = Math.max(
      POLARITY_GATHER_RADIUS,
      Math.min(FIELD_MAX_FX - POLARITY_GATHER_RADIUS, projectedX),
    );
    const gatherFy = Math.max(0, Math.min(BOARD_ROWS - 1, center.fy));

    const gatherCircle: Telegraph = {
      shape: "circle",
      mode: "gather",
      fx: gatherFx,
      fy: gatherFy,
      dirX: 0,
      dirY: 0,
      arg: POLARITY_GATHER_RADIUS,
      reach: 0,
      fuse: TELEGRAPH_FUSE_MS,
      fuseMax: TELEGRAPH_FUSE_MS,
    };
    return { primary: avoidHalf, secondary: gatherCircle };
  }

  if (pattern === "seize") {
    /**
     * 표식(seize, 발키르 오마주, US-403). 무작위 아군 1마리에 표식을 걸고
     * (`Cat.seized`), 보스가 동시에 구원 원(gather)을 함께 깐다. 원 자체는
     * 여느 gather 원과 똑같이 그려지고 똑같이 `doGather`를 태운다 —
     * **집결 버튼을 억지로 새로 만들지 않는다**는 원칙이 여기서 그대로
     * 성립한다. 다른 점은 판정뿐이다: `fireTelegraph`의 seize 분기가 이
     * 존이 터지는 순간 **표식이 걸린 그 한 마리만** 채점한다(`Telegraph.
     * seize`가 그 갈림길이다) — 나머지 팀은 이 예고에 안 걸린다.
     *
     * 표식 대상은 결정적 시드로 고른다(`rng()` 대신 `mixSeed`) — 극성의
     * 방향과 같은 이유다. 같은 시드는 항상 같은 아군을 표식한다.
     *
     * **소환수는 후보에서 뺀다.** 실측(`w3-lab.mjs`)으로 표식의 24%가
     * 소환수에 붙었다 — 6~20초면 알아서 사라질 몸에 "구원해야 할 표식"을
     * 거는 것은 판단을 요구하는 게 아니라 헛일이다(구원해도 곧 사라지고,
     * 실패해도 대가가 가짜다). `f.summon`이 채워져 있으면 소환수다
     * (`types.ts` `Cat.summon`).
     */
    const alive = foes.filter((f) => f.alive && !f.summon);
    if (alive.length === 0) return null;
    const pick = mixSeed(mixSeed(tally.seed, tally.wave), idx) % alive.length;
    const marked = alive[pick]!;
    marked.seized = true;
    tally.seizeMarked += 1;

    const c = centroid(foes);
    // 모이기(gather) 패턴과 같은 편향 비율 — 팀 쪽으로 살짝 당겨서 도착
    // 자체가 몇 걸음은 되게 한다(0.25는 위 `mode === "gather"` 분기와 같은 값).
    const GATHER_BIAS = 0.25;
    return {
      primary: {
        shape: "circle",
        mode: "gather",
        fx: c.fx + (boss.fx - c.fx) * GATHER_BIAS,
        fy: c.fy + (boss.fy - c.fy) * GATHER_BIAS,
        dirX: 0,
        dirY: 0,
        arg: SEIZE_GATHER_RADIUS,
        reach: 0,
        fuse: SEIZE_FUSE_MS,
        fuseMax: SEIZE_FUSE_MS,
        seize: true,
      },
      secondary: null,
    };
  }

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
      primary: {
        ...base,
        fx: c.fx,
        fy: midY,
        dirX: 0,
        dirY: 0,
        // 화톳불은 모이기와 같은 이유로 넓다 — 모이라고 해 놓고 못 모이면 벌이다.
        arg: pattern === "hearth" ? 1.9 : 1.5,
        reach: 0,
      },
      secondary: null,
    };
  }

  if (pattern === "stomp") {
    return {
      primary: { ...base, fx: boss.fx, fy: boss.fy, dirX: 0, dirY: 0, arg: 2.4, reach: 0 },
      secondary: null,
    };
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
      primary: {
        ...base,
        fx: c.fx + (boss.fx - c.fx) * GATHER_BIAS,
        fy: c.fy + (boss.fy - c.fy) * GATHER_BIAS,
        dirX: 0,
        dirY: 0,
        // 흩어짐 원형(1.6)보다 넓다. 모이라고 해 놓고 못 모이면 규칙이 아니라 벌이다.
        arg: 1.9,
        reach: 0,
      },
      secondary: null,
    };
  }

  if (shape === "circle") {
    const c = centroid(foes);
    return {
      primary: { ...base, fx: c.fx, fy: c.fy, dirX: 0, dirY: 0, arg: 1.6, reach: 0 },
      secondary: null,
    };
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
    primary: {
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
    },
    secondary: null,
  };
}

/** 이 좌표가 예고 범위 안인가. 판정은 전부 정준 좌표에서 한다. */
/**
 * `pad` — 판정에 더하는 몸 반경(칸). 피해·회피·모임이 전부 같은 값을 넘겨야
 * 화면과 판정이 같은 말을 한다. 기본 0은 측정 스크립트용(중심점 기준).
 */
export function inTelegraph(t: Telegraph, fx: number, fy: number, pad = 0): boolean {
  if (t.shape === "half") {
    /**
     * 좌/우 절반(극성 전용). `t.fx`가 경계, `dirX`의 부호가 "안쪽" 방향이다.
     * 다른 모양처럼 거리·각도로 재는 게 아니라 부호 하나로 끝나서 다른
     * 분기보다 먼저 걸러낸다.
     *
     * 판 전체(`FIELD_MAX_FX`)로 자른다 — **아군 보드(0..4)로 좁히면 안
     * 된다.** 근접은 실제로 붙어 싸우는 동안 fx가 6~9(적 진영 근처)까지
     * 나가는데, 거기서 늘 `false`가 나오면 흩어짐이 근접을 절대 못
     * 잡거나(안 걸린 것으로 읽힘) 모임이 근접을 늘 잘못 잡는다(판 밖이라
     * 항상 "안에 없음") — 실측으로 sweep(같은 함정)이 근접 팀에서 40시드
     * 내내 한 번도 안 걸렸다.
     */
    if (fx < -0.5 || fx > FIELD_MAX_FX + 0.5) return false;
    return t.dirX >= 0 ? fx >= t.fx - pad : fx <= t.fx + pad;
  }
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

/**
 * 예고 `t`를 터뜨린다. **어느 필드(`telegraph`·`telegraph2`)의 것인지는
 * 호출부가 정한다** — 극성(polarity)이 동시에 두 존을 터뜨려야 해서
 * `boss.telegraph`를 직접 읽던 예전 방식으로는 두 번째 존을 못 다뤘다.
 *
 * `dmgMul` — 기본 1(보통 예고). `tickSweepQueue`가 `SWEEP_DMG_MUL`을 넘긴다 —
 * sweep은 한 문턱이 700ms 간격으로 5행을 잇달아 터뜨리는데, 예고 회피 실패의
 * 기본 피해(`telegraphHit`)는 최대체력 비율이라 한 번만으로도 사실상 즉사라서
 * (`bosses.ts`의 `SWEEP_DMG_MUL` 주석 참고) 그 배율을 5번 반복하면 자원
 * (회피 차지 2·쿨다운 1초)이 못 버틴다.
 *
 * `countOverlap` — 기본 true. sweep 한 파동은 여러 행(zone)을 **같은
 * `boss.vulnerableMs` 값으로 한 틱에 몰아서** 터뜨린다(`tickSweepQueue`) —
 * 취약 창 겹침은 실제로는 "이 파동 동안 한 번" 벌어진 일인데, 행마다
 * `fireTelegraph`를 부르면 같은 겹침을 행 수만큼(최대 5) 중복으로 센다.
 * `tickSweepQueue`가 파동의 첫 행에만 true를, 나머지엔 false를 넘겨서
 * `vulnOverlapSeen`·`vulnOverlapDodged`가 파동당 1회로 clamp되게 한다(두 파동이 한 창에 들면 2 — 5보다 낫지만 완전한 창 단위는 아니다).
 */
function fireTelegraph(
  boss: Cat,
  foes: Cat[],
  tally: RunState,
  t: Telegraph,
  dmgMul: number = 1,
  countOverlap: boolean = true,
): void {
  // 극성(polarity)은 이 함수가 avoid·gather 반쪽마다 한 번씩, 같은 틱에
  // 두 번 불린다(tickBoss) — 그래서 극성 하나가 telegraphsSeen을 2 올린다.
  // "예고 하나 = telegraphsSeen 1"이 다른 패턴과는 맞지만 극성만 어긋나므로,
  // 부검 화면에서 극성이 유난히 자주 뜬 것처럼 보일 수 있다는 것을 이 숫자를
  // 읽을 때 감안할 것 — 판정(telegraphsEaten 분모·분자 짝)은 그대로 맞다.
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
  const overlapping = boss.vulnerableMs > 0 && countOverlap;
  if (overlapping) tally.vulnOverlapSeen += 1;
  const ramp = bossRampFor(tally);
  const frac =
    (BALANCE.telegraphDmgFirst + (BALANCE.telegraphDmg - BALANCE.telegraphDmgFirst) * ramp) *
    raidBossPower(tally, boss.breed.id) *
    dmgMul;
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

  if (t.seize === true) {
    /**
     * 표식(seize) 심판 — 이 존은 팀 전체가 아니라 표식이 걸린 아군 **한
     * 마리만** 가른다. `doGather`(청록 규칙)는 이 존도 여느 gather 원과
     * 똑같이 취급해 팀 전체를 원 쪽으로 밀어 주지만, 살고 죽는 것은 표식냥
     * 하나에 달려 있다.
     *
     * 구원 판정은 **발동 시점 1회, dt 결정적**이다 — 도화선이 다 되는 이
     * 순간에만 묻는다. 두 갈래로 산다: (a) 표식 시점 보스가 함께 깐 구원
     * 원 안에 있거나, (b) 아군 누군가와 인접하면(뭉친 대형이면 원까지
     * 안 가도 된다) 구원이다.
     */
    const marked = foes.find((f) => f.seized === true);
    if (marked) marked.seized = false; // 표식의 역할은 여기서 끝난다 — 성패와 무관하게 지운다.
    if (marked && marked.alive) {
      const rescued =
        inTelegraph(t, marked.fx, marked.fy, BALANCE.telegraphBodyPad) ||
        foes.some((f) => f !== marked && f.alive && fieldDistance(marked, f) <= SEIZE_ADJACENT_RADIUS);
      if (overlapping && rescued) tally.vulnOverlapDodged += 1;
      if (rescued) tally.seizeRescued += 1;
      if (!rescued) {
        tally.telegraphsEaten += 1;
        damage(marked, Math.max(1, Math.round(marked.maxHp * SEIZE_FAIL_FRAC)), false);
        fireTelegraphHitFx(marked, boss, hue);
        // 넉백 — 보스 반대 방향으로 밀린다. 플레이어 행동이 아니라 피격
        // 반응이라 dash(startDash)가 아니라 좌표를 바로 옮긴다.
        const away = Math.atan2(marked.fy - boss.fy, marked.fx - boss.fx) || 0;
        marked.fx += Math.cos(away) * SEIZE_KNOCKBACK;
        marked.fy += Math.sin(away) * SEIZE_KNOCKBACK;
        clampToField(marked);
      }
    }
    return; // 아래의 전원 채점(avoid/gather 공용 분기)은 타지 않는다.
  }

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
    /**
     * 뭉침이 끝나면 곧바로 흩어질 수 있어야 한다. 묶어 두면 다음 원형 예고가
     * 무게중심을 노려 통째로 맞고, 그러면 모인 것이 벌이 된다.
     *
     * **극성(polarity)의 gather 반쪽에서는 이 리셋을 건너뛴다.** `t`가
     * `boss.telegraph2`(=이 존의 짝인 avoid 반쪽이 방금 같은 틱에 먼저
     * 터졌다는 뜻)이면, 전원 리셋이 **avoid 쪽이 붙잡아 둔 유닛의 moveLock도
     * 같이 지운다** — 실제 피해 판정은 이미 끝난 뒤라 안전하지만(avoid의
     * fireTelegraph가 이 함수보다 먼저, 리셋 전 좌표로 이미 판정했다), 리셋
     * 직후 같은 틱 안에서 그 유닛이 걸어 나가 "터지자마자 도로 움직인다"는
     * 부자연스러운 그림이 된다(측정 스크립트가 이걸 회피 실패로 오인한 적이
     * 있다). 극성은 애초에 "뭉쳐서 무게중심이 한 점"이 되는 패턴이 아니라
     * 판 전체에 흩어진 채로 반을 가르는 패턴이라, 원래 리셋의 전제(다음
     * 원형 예고가 뭉친 무게중심을 노린다)가 성립하지 않는다.
     */
    if (t !== boss.telegraph2) {
      for (const f of foes) f.moveLock = 0;
    }
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

  // creep 패턴은 첫 발동을 여느 circle avoid와 똑같이 맞고(위에서 이미
  // 처리됐다), 그 뒤에 사라지는 대신 상주 장판으로 눌러앉는다.
  if (t.resident) spawnCreepZone(boss, t);
}

/**
 * 상주 장판을 낳는다. `t`의 발동 시점 반경·위치를 그대로 이어받아
 * `CREEP_RADIUS_STEPS[0]`부터 자라기 시작한다.
 *
 * 틱당 피해는 **보스 공격력의 절반을 고정값으로** 굳혀서(`CREEP_DMG_MUL`)
 * 스폰 시점 한 번만 계산한다 — 보스가 나중에 죽어도(장판은 남을 수 있다)
 * 피해가 사라진 보스를 다시 참조할 필요가 없다.
 */
function spawnCreepZone(boss: Cat, t: Telegraph): void {
  const zone: CreepZone = {
    shape: "circle",
    mode: "avoid",
    fx: t.fx,
    fy: t.fy,
    dirX: 0,
    dirY: 0,
    arg: CREEP_RADIUS_STEPS[0],
    reach: 0,
    // 다음 성장 틱까지. 렌더가 이 값으로 맥동을 그린다(`fuseMax` 대비 `fuse`).
    fuse: CREEP_TICK_MS,
    fuseMax: CREEP_TICK_MS,
    idleMs: 0,
    stepIdx: 0,
    tickDamage: Math.max(1, Math.round(boss.atk * CREEP_DMG_MUL)),
  };
  creepZones.push(zone);
}

/**
 * 상주 장판을 dt만큼 진행한다. `stepBattle`의 고정 스텝으로만 불러야
 * 헤드리스 시뮬과 브라우저가 같은 결과를 낸다 — 다른 시간축 상태들과 같은
 * 규칙이다.
 *
 * 무점유 소멸은 **매 프레임** 잰다(1.4초 연속 무점유). 성장/피해는 **틱
 * 경계에서만** 잰다(700ms마다, 그 순간 점유 중이어야 발동). 둘을 한
 * 타이머로 합치면 "700ms짜리 창 안에서 잠깐 비었다 다시 찼다"가 소멸로
 * 오판된다 — 실제 점유는 계속되고 있는데도.
 */
function tickCreepZones(allies: Cat[], dt: number): void {
  for (let i = creepZones.length - 1; i >= 0; i--) {
    const z = creepZones[i];
    if (!z) continue;
    const occupied = allies.some((a) => inTelegraph(z, a.fx, a.fy, BALANCE.telegraphBodyPad));

    if (occupied) z.idleMs = 0;
    else z.idleMs += dt;
    if (z.idleMs >= CREEP_IDLE_DESPAWN_MS) {
      creepZones.splice(i, 1);
      continue;
    }

    z.fuse -= dt;
    if (z.fuse > 0) continue;
    // 남은 시간을 다음 틱으로 넘기지 않는다 — 다른 고정 스텝 타이머들과
    // 같은 규칙이고, dt가 700ms를 넘을 일이 없어(SIM_STEP_MS=100) 오차가
    // 쌓이지 않는다.
    z.fuse = CREEP_TICK_MS;
    if (!occupied) continue; // 비어 있으면 자라지도, 때리지도 않는다

    for (const a of allies) {
      if (!inTelegraph(z, a.fx, a.fy, BALANCE.telegraphBodyPad)) continue;
      damage(a, z.tickDamage, false);
      // 장판 중심에서 밀려난 방향으로 튄다. `fireTelegraphHitFx`는 보스
      // 좌표가 필요해 재사용할 수 없다 — 장판은 발동 뒤 보스와 독립이다.
      const away = Math.atan2(a.fy - z.fy, a.fx - z.fx);
      pushFx({ kind: "spark", fx: a.fx, fy: a.fy, tx: 0, ty: 0, radius: 0.6, angle: away, life: 260, color: FX_DANGER });
    }
    if (z.stepIdx < CREEP_RADIUS_STEPS.length - 1) {
      z.stepIdx += 1;
      z.arg = CREEP_RADIUS_STEPS[z.stepIdx]!;
      pushFx({ kind: "ring", fx: z.fx, fy: z.fy, tx: 0, ty: 0, radius: z.arg, angle: 0, life: 420, color: FX_DANGER });
    }
  }
}

/**
 * 순차 스윕(sweep) 대기열. `creepZones`와 같은 전례 — 모듈 전역 배열 + dt 진행.
 *
 * **행 0→4 순차 대신 두 파동이다(원본 헤이건의 "안전지대 춤" 문법 — 리뷰
 * (ㄷ)).** 어느 행이 어느 파동에 속하는지는 `bosses.ts`의 `SWEEP_WAVE_ROWS`가
 * 정한다(현재: 첫 파동 [1,3] → 둘째 파동 [0,4] — US-401, 그 파일 주석의
 * 실측 표 참고). 한 파동 안의 행들은
 * **같은 도화선을 공유**하므로(`advanceSweepQueue`가 한꺼번에 만든다)
 * `fuse`/`fuseMax`가 항상 같은 값이라 렌더의 "차오르는 정도"(`fill`)가
 * 음수가 되는 일이 없다 — 예전(행 하나씩) 설계가 "한 번에 하나만" 담아야
 * 했던 이유가 이 파동 단위 구조에서는 사라진다.
 *
 * **왜 5행 순차를 버렸는가.** 예전 설계(행마다 700ms 간격으로 순차 점멸)는
 * 한 번의 문턱이 최대 5번의 개별 회피를 요구했는데, `ACT_COOLDOWN_MS`(1초)
 * ·`dodgeCharges`(보스전당 2회)라는 이 게임의 공용 자원 예산으로는 완벽하게
 * 반응해도 행마다 매번 새로 피할 수단이 없었다(실측: 하네스 실명을 걷어낸
 * 뒤에도 sim 중앙값이 회복되지 않았다 — 진짜 난이도였다). 파동을 둘로
 * 묶으면 문턱 하나가 요구하는 **몸의 이동**은 최대 2회로 줄고, 각 파동의
 * 도화선을 넉넉히(`SWEEP_FUSE_MS`) 잡으면 1초 쿨다운 뒤에도 다음 파동을
 * 받을 여유가 남는다.
 *
 * **"개입 1회로 연쇄 전체를 넘긴다"는 자원(차지)에서도 그대로다.** 두 파동은
 * 서로 다른 행을 가르지만(홀수↔짝수) 같은 하나의 "안전지대 춤" 기믹이다 —
 * 그래서 한 스윕 문턱 안에서 **차지는 첫 회피 한 번만 쓴다**
 * (`sweepBurstCharged`, `stepBattle`의 소비 지점 참고). 두 번째 파동도
 * 몸은 다시 옮겨야 하지만(행이 바뀌었으니) 그 대가로 차지를 또 내지 않는다
 * — 안 그러면 무쇠발톱의 나머지 패턴(quake·gather·cone)과 차지를 다투다
 * 보스전 하나에서 사실상 못 넘는 문턱이 남는다(실측: 이 예외 없이 SWEEP_
 * DMG_MUL을 1.0으로 되돌리자 sim 중앙값이 9로 떨어졌다 — 파동 자체는
 * 이제 잘 피해지는데, 그 두 번째 파동에 쓸 차지가 다른 패턴에 이미
 * 바닥났던 것이다).
 */
export const sweepZones: Telegraph[] = [];
/** 아직 켜지 않은 파동. 각 원소가 그 파동에 속한 행 번호들이다. */
const sweepPendingWaves: number[][] = [];
/** 지금 도는 스윕을 낸 보스. `fireTelegraph`가 피해 계산에 `boss.atk`를 쓴다. */
let sweepBoss: Cat | null = null;
/**
 * 지금 도는 스윕 문턱에서 이미 차지를 한 번 썼는가. `enqueueSweep`(새 문턱)
 * 에서 `false`로 돌아가고, `stepBattle`이 첫 성공 회피에서 `true`로 올린다
 * — 그 뒤로는 두 번째 파동을 피해도 차지·쿨다운을 또 안 쓴다. `stepBattle`
 * 안에서만 읽고 쓰므로 내보내지 않는다.
 */
let sweepBurstCharged = false;

/**
 * 순차 스윕의 두 번째 파동이 이미 지불한 한 번의 방어 개입을 재사용하는가.
 * 입력 활성화·실제 소비·시각/접근성 라벨이 이 판정 하나를 공유해야 화면이
 * 남은 차지를 보여 주면서 실제로는 무료로 처리하는 모순이 생기지 않는다.
 */
export function sweepDodgeFree(state: RunState): boolean {
  const bossTelegraphUp = state.enemy.some((c) => c?.alive && (c.telegraph || c.telegraph2));
  return sweepZones.length > 0 && sweepBurstCharged && !bossTelegraphUp;
}

/**
 * 문턱 하나가 파동 두 개(홀수 행 묶음 → 짝수 행 묶음)를 한 번에 예약한다.
 * 실제로 켜는 것은 `advanceSweepQueue`이고, 이후 진행은 `tickSweepQueue`가
 * 보스의 다음 판단과 무관하게 스스로 돈다 — 예전엔 문턱 하나가 행 하나만
 * 걸고 다음 sweep 문턱이 패턴 순환을 한 바퀴 돌아 다시 걸릴 때까지
 * 기다렸다(실측 16초 간격, 리뷰 sweep-chain).
 */
function enqueueSweep(boss: Cat): void {
  sweepBoss = boss;
  sweepBurstCharged = false; // 새 문턱 — 이번 스윕은 아직 차지를 안 썼다
  sweepPendingWaves.length = 0;
  for (const wave of SWEEP_WAVE_ROWS) sweepPendingWaves.push([...wave]);
  sweepZones.length = 0;
  advanceSweepQueue();
}

/** 대기 중인 다음 파동을 켠다. 이미 파동이 떠 있거나 남은 파동이 없으면 아무 일도 안 한다. */
function advanceSweepQueue(): void {
  if (sweepZones.length > 0) return;
  const wave = sweepPendingWaves.shift();
  if (wave === undefined) return;
  for (const row of wave) {
    sweepZones.push({
      shape: "line",
      mode: "avoid",
      fx: -0.5,
      fy: row,
      dirX: 1,
      dirY: 0,
      // 행 간격이 1칸이라 살짝 넘치게 잡아야 경계에 걸친 몸도 확실히 걸린다.
      arg: 0.55,
      // 아군 보드(0..4)만 덮으면 안 된다 — 근접은 실제로 붙어 싸우는 동안
      // fx가 6~9(적 진영 근처)까지 나간다. 기존 line 패턴과 같은 관례로 판
      // 전체를 덮는다.
      reach: FIELD_MAX_FX + 1,
      fuse: SWEEP_FUSE_MS,
      fuseMax: SWEEP_FUSE_MS,
    });
  }
}

/**
 * 스윕 대기열을 dt만큼 진행한다. `tickCreepZones`와 같은 자리(`stepBattle`)
 * 에서 매 스텝 불린다 — 보스의 `tickBoss` 사이클과 무관하게 스스로 돈다.
 *
 * 한 파동에 속한 행들은 도화선을 공유하므로 맨 앞 원소의 `fuse`만 보고
 * 다 같이 깎는다 — `advanceSweepQueue`가 전부 같은 값으로 만들었으므로
 * 어느 것을 대표로 봐도 같다. 파동이 터지면(행 전부) `fireTelegraph`를
 * 그대로 불러 다른 avoid 예고와 판정·연출이 완전히 같고, 곧바로 다음
 * 파동을 켠다.
 */
function tickSweepQueue(allies: Cat[], tally: RunState, dt: number): void {
  if (sweepZones.length === 0) return;
  if (!sweepBoss || !sweepBoss.alive) {
    // 낸 보스가 죽거나 사라지면 큐를 접는다 — 죽은 보스의 공격력을 다시
    // 참조할 수 없고, 안 그러면 유령 예고가 남는다.
    clearSweepQueue();
    return;
  }
  for (const z of sweepZones) z.fuse -= dt;
  if (sweepZones[0]!.fuse > 0) return;
  // 파동의 첫 행에서만 취약 겹침을 센다 — 나머지 행은 같은 겹침의 중복이다.
  let firstRow = true;
  for (const z of sweepZones) {
    fireTelegraph(sweepBoss, allies, tally, z, SWEEP_DMG_MUL, firstRow);
    firstRow = false;
  }
  sweepZones.length = 0;
  advanceSweepQueue();
}

/**
 * 스윕 대기열을 통째로 비운다. `creepZones.length = 0`과 같은 자리(전투
 * 종료·재시작)에서 같이 부른다 — invariants가 "전투 밖에는 안 남는다"를
 * 그 즉시 검사할 수 있어야 한다.
 */
function clearSweepQueue(): void {
  sweepZones.length = 0;
  sweepPendingWaves.length = 0;
  sweepBoss = null;
  sweepBurstCharged = false;
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

/** `makeTelegraph`의 결과를 `telegraph`·`telegraph2`에 나눠 담는다. */
function assignTelegraph(boss: Cat, made: MadeTelegraph | null): void {
  boss.telegraph = made?.primary ?? null;
  boss.telegraph2 = made?.secondary ?? null;
}

/**
 * 최종 국면(finalPhase, US-404) 대상 조건.
 *
 * **스테이지 3 우두머리(서리귀, id 11)에게만, 게임 전체에서 1회만** 참이다.
 * `state.finalPhaseUsed`가 문을 지킨다 — 서리귀는 테마 순환상 스테이지
 * 3·6·9…에서도 다시 스테이지 우두머리로 선다(`scripts/invariants.mjs`의
 * SNAP 계약 참고)이지만, 이 연출은 그중 **맨 처음 한 번**만 켜져야 "지는
 * 것이 연출"이 매 서리귀 우두머리전마다 반복되는 상투적인 것으로 안 변한다.
 *
 * 마지막 문턱(`BOSS_THRESHOLDS`의 끝, 0.1)을 그대로 재사용한다 — "체력이
 * 10% 이하"라는 새 매직넘버를 따로 안 만든다.
 */
function finalPhaseEligible(boss: Cat, state: RunState): boolean {
  if (state.finalPhaseUsed) return false;
  if (boss.stageBoss !== true || boss.breed.id !== 11) return false;
  const last = BOSS_THRESHOLDS[BOSS_THRESHOLDS.length - 1]!;
  return boss.hp / Math.max(1, boss.maxHp) <= last;
}

/**
 * 최종 국면을 연다 — 채널 시작.
 *
 * 진행 중이던 위협을 전부 지운다. 채널이 전 아군을 빈사(hp 1)로 만드는데,
 * 그 순간 상주 장판(creep)·순차 스윕(sweep)이 살아 있으면 그대로 죽는다 —
 * "지는 것이 연출"이지 "빈사인데 또 맞아서 진짜로 죽는 것"이 아니므로
 * 안전을 여기서 보장한다.
 */
function startFinalPhase(boss: Cat, foes: Cat[], state: RunState): void {
  state.finalPhaseUsed = true;
  // 정상 취약 창 도중 10% 문턱을 넘겼다면 남은 창 기회도 함께 닫는다.
  boss.vulnerableMs = 0;
  boss.vulnerableCharges = 0;
  /**
   * 공격 정지 — 새 "멈춤" 상태를 만드는 대신 기존 스턴 필드를 그대로 쓴다.
   * tickEffects가 매 스텝 이 값을 깎아 주므로 여기서 따로 셀 필요가 없다.
   *
   * **보스만 재우면 안 된다.** 보스 웨이브는 앞줄 호위 둘을 늘 데리고
   * 나온다(`buildBossWave`, `BALANCE.bossEscortCount`) — 우두머리도 예외가
   * 아니다. `state.enemy`(보드) 뿐 아니라 **적 쪽 소환수**(`state.summons`,
   * side==="enemy")도 재운다 — 지금 악몽 명단엔 소환사가 없어 실제로는
   * 안 생기지만, `damage()`의 채널 무적 가드와 짝을 맞춰 "채널 동안 보스로
   * 가는 공격 경로가 하나도 없다"를 코드가 구조적으로 보장하게 한다.
   */
  for (const c of state.enemy) {
    if (c && c.alive) c.stun = Math.max(c.stun, FINAL_CHANNEL_MS);
  }
  for (const c of state.summons) {
    if (c.alive && c.side === "enemy") c.stun = Math.max(c.stun, FINAL_CHANNEL_MS);
  }
  creepZones.length = 0;
  clearSweepQueue();
  /**
   * 채널 직전 체력을 스냅샷한 뒤 빈사(hp 1)로 낮춘다. 스냅샷이 있어야 채널이
   * 끝날 때 "원래보다 나빠지지 않는다"(hp = max(직전 hp, maxHp×60%))는
   * 회복 공식을 지킬 수 있다 — 실측에서 이미 60% 넘게 살아 있던 아군의
   * 53.5%가 고정 60%로 되레 깎였었다.
   *
   * `c.dot = null`도 여기서 함께 지운다 — DoT는 `damage()`를 거치므로
   * 채널 무적 가드가 막아 주지만(위 참고), 그 전에 이미 걸려 있던 DoT를
   * 안 지우면 tickEffects가 매 스텝 `damage(c, slice, false)`를 불러서
   * **아군 쪽 hp 1**을 즉사시킨다 — 보스 무적과 별개로 아군은 원래부터
   * damage()가 그대로 통과한다. 강제 재현으로 5마리 전멸까지 갔었다.
   */
  const preHp = new Map<string, number>();
  for (const c of foes) {
    if (!c.alive) continue;
    preHp.set(c.uid, c.hp);
    c.hp = 1; // 사망이 아니라 빈사 — damage()를 거치지 않고 직접 대입한다.
    c.dot = null;
  }
  boss.finalPhase = { stage: "channel", remainMs: FINAL_CHANNEL_MS, totalMs: FINAL_CHANNEL_MS, preHp };
  // 기존 페이즈 전환 연출(phaseShift)을 그대로 재사용한다 — 새 Fx 종류를
  // 만들지 않는다. render.ts가 이 kind를 이미 충격파 링과 플래시로 그린다.
  pushFx({
    kind: "phaseShift",
    fx: boss.fx,
    fy: boss.fy,
    tx: 0,
    ty: 0,
    radius: boss.radius * 1.8,
    angle: 0,
    life: FINAL_CHANNEL_MS,
    color: "#F0BA4A",
  });
}

/**
 * 최종 국면 진행 — 채널(무적) → 회복 + 마지막 취약 창.
 *
 * `open` 단계의 실제 카운트다운은 이 함수가 안 잰다 — `tickBoss` 맨 위의
 * 공용 `vulnerableMs` 감소 로직이 이미 돌고 있으므로 그걸 그대로 빌려
 * 쓴다(창이 닫히는 순간만 여기서 감지해 `finalPhase`를 지운다). 두 타이머를
 * 따로 세면 반드시 어긋난다.
 */
function tickFinalPhase(boss: Cat, foes: Cat[], dt: number): void {
  const fp = boss.finalPhase;
  if (!fp) return;

  if (fp.stage === "channel") {
    fp.remainMs = Math.max(0, fp.remainMs - dt);
    if (fp.remainMs > 0) return;

    /**
     * 채널이 끝났다 — 전 아군을 "빈사에서 끌어올리되 원래보다 나빠지지
     * 않게" 회복시킨다. `hp = max(채널 직전 hp, maxHp×60%)`다 — 고정
     * `1 + maxHp×60%`였을 때는 채널 직전에 이미 60%를 넘게 살아 있던
     * 아군의 절반 이상이 되레 손해를 봤다(실측 53.5%). `fp.preHp`가
     * `startFinalPhase`가 남긴 그 직전 값이다.
     */
    for (const c of foes) {
      if (!c.alive) continue;
      const before = c.hp;
      const preChannelHp = fp.preHp.get(c.uid) ?? 0;
      const target = Math.max(preChannelHp, Math.round(c.maxHp * FINAL_HEAL_FRAC));
      c.hp = Math.min(c.maxHp, Math.max(c.hp, target));
      const got = Math.round(c.hp - before);
      if (got > 0) {
        pop(c, `+${got}`, false, true);
        pushFx({ kind: "ring", fx: c.fx, fy: c.fy, tx: 0, ty: 0, radius: 0.9, angle: 0, life: 420, color: FX_GATHER });
      }
    }

    /**
     * 마지막 창이 최소 8%를 실제로 요구하게 만든다. 발동 문턱이 10%에
     * 걸려 있어도 그 순간 hp가 훨씬 낮게(때로는 1~2%) 잡히는 판이
     * 실측에서 흔했다 — 그러면 입력이 전혀 없어도 1.4초 만에 창이
     * 끝나 "마지막 창"이라는 이름값을 못 한다. 바닥만 올리고 천장은
     * 안 건드린다(`Math.max`) — 이미 8% 넘게 남아 있으면 그대로 둔다.
     */
    boss.hp = Math.max(boss.hp, Math.round(boss.maxHp * FINAL_MIN_HP_FRAC));

    // 마지막 취약 창 — 새 타이머가 아니라 기존 vulnerableMs를 그대로 연다.
    // 창 타이머·결정타 사용 횟수·버튼 판정은 평소 취약 창과 같은 공용
    // 경로를 재사용한다(resolveIntent·strikeUsable·buttonText).
    boss.vulnerableUsed = true;
    boss.vulnerableMs = FINAL_VULNERABLE_MS;
    boss.vulnerableCharges = BALANCE.vulnerableChargesPerWindow;
    fp.stage = "open";
    pushFx({ kind: "ring", fx: boss.fx, fy: boss.fy, tx: 0, ty: 0, radius: boss.radius * 1.3, angle: 0, life: 520, color: "#F0BA4A" });
    return;
  }

  // stage === "open" — 창이 닫혔는지만 본다(카운트다운 자체는 위에서 말한
  // 공용 로직 몫). 닫혔는데 아직 안 죽었으면 전투를 다시 이어 간다 —
  // `finalPhase`를 지우면 다음 tickBoss 호출부터 평소 문턱 로직이 이어받아
  // 보스가 남은 체력으로 다시 싸운다(`thresholdIdx`는 이 국면 내내 그대로였다).
  if (boss.vulnerableMs <= 0) boss.finalPhase = null;
}

/**
 * 최종 국면 채널이 지금 진행 중인가 — render.ts의 버튼 잠금과 화면 어두워짐이
 * 같은 기준을 봐야 한다. `open`(마지막 취약 창) 단계는 잠그지 않는다 — 그
 * 때는 평소 취약 창과 똑같이 결정타 선택이 버튼의 일이다.
 */
export function finalPhaseChannelActive(state: RunState): boolean {
  return state.enemy.some((c) => c?.alive && c.finalPhase?.stage === "channel");
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
    if (boss.vulnerableMs === 0) boss.vulnerableCharges = 0;
  }

  /**
   * US-404 최종 국면 — 한 번 시작되면 이것만 본다. blink·telegraph·문턱
   * 로직보다 앞에 둬야 "채널 동안 아무 일도 안 일어난다"가 실제로 지켜진다.
   */
  if (boss.finalPhase) {
    tickFinalPhase(boss, foes, dt);
    return;
  }

  if (boss.blink) {
    tickBlink(boss, dt);
    if (boss.blink) return; // 아직 진행 중이면 이번 스텝은 여기서 끝난다.
    // 막 도착했다 — 미뤄 둔 예고를 이제 이 자리에서 건다("연출이 끝난
    // 자리에서 예고"). thresholdIdx는 페이드를 시작할 때부터 그대로였으므로
    // 이 예고가 원래 걸렸어야 할 패턴과 정확히 같다.
    updateBossPhase(boss, bossKit(boss.breed.id, activeRaidContract(tally)));
    assignTelegraph(boss, makeTelegraph(boss, foes, boss.thresholdIdx, tally));
    boss.thresholdIdx += 1;
    return;
  }

  const kit = bossKit(boss.breed.id, activeRaidContract(tally));

  if (boss.telegraph) {
    boss.telegraph.fuse -= dt;
    // 극성(polarity)의 두 번째 존은 같은 도화선을 그대로 따라간다 — 독립
    // 타이머를 두면 반쪽만 먼저 터지는 순간이 생겨 "동시에 뜬 것"이 아니게 된다.
    if (boss.telegraph2) boss.telegraph2.fuse = boss.telegraph.fuse;
    if (boss.telegraph.fuse <= 0) {
      fireTelegraph(boss, foes, tally, boss.telegraph);
      if (boss.telegraph2) fireTelegraph(boss, foes, tally, boss.telegraph2);
      boss.telegraph = null;
      boss.telegraph2 = null;
    }
    return; // 예고 중에는 다음 문턱을 밟아도 겹쳐 걸지 않는다
  }

  /**
   * 순차 스윕(sweep) 대기열이 이 보스 몫으로 아직 돌고 있으면 다음 문턱을
   * 안 밟는다. sweep은 `boss.telegraph`를 안 채우므로(B3) 바로 위의
   * `if (boss.telegraph)` 가드가 못 잡는데, 그대로 두면 스윕이 진행되는
   * 동안에도 보스가 계속 다음 문턱을 넘겨 **다른 패턴(quake·gather·cone)의
   * 회피 요구까지 겹쳐 쌓는다** — 스윕 자체는 자원(차지)을 아끼도록 고쳐도
   * (`sweepBurstCharged`), 같은 자원을 노리는 경쟁자가 그 사이에 더 늘면
   * 소용이 없다(실측: 이 가드 없이는 스윕이 뜨는 동안 gather가 겹쳐 걸려
   * 남은 차지를 gather가 먼저 가져갔다 — SWEEP_DMG_MUL을 1.0으로 되돌린
   * 뒤 sim 중앙값이 10에서 더 안 올랐다). "안전지대 춤 하나가 끝나야
   * 비로소 다음 것" — 원본 헤이건의 리듬과도 맞다.
   */
  if (sweepBoss === boss && (sweepZones.length > 0 || sweepPendingWaves.length > 0)) return;

  /**
   * US-404 최종 국면 진입 시점. **취약 창 반절 가드보다 먼저 본다.**
   * 처음엔 그 가드 뒤에 뒀는데, hp가 취약 창 전반부(결정타 유예라 문턱
   * 검사 자체가 막힌 구간) 안에서 10% 밑으로 떨어지면 그 창이 끝나거나
   * 후반부에 들 때까지 감지가 늦어졌다 — 실측(`w3-lab.mjs`)으로 발동
   * 시점 hp% p50이 4.4%까지 밀렸다(문턱은 10%인데). `boss.telegraph`
   * 가드·스윕 가드는 그대로 남긴다 — 진행 중이던 예고·스윕은 안 잘라먹는다,
   * 최종 국면은 **문턱 판단이 열리는 자리**에서만 끼어든다.
   */
  if (finalPhaseEligible(boss, tally)) {
    startFinalPhase(boss, foes, tally);
    return;
  }

  /**
   * 취약 창의 **앞 절반은 결정타 선택 유예 구간**이다. 처음 조기 return을 걷어냈을
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
  // 결정타를 고를 시간을 보장하고, 후반부에 문턱을 밟으면 그때는 겹칠 수 있다 —
  // 그 순간의 버튼은 회피가 먼저다(resolveIntent와 buttonText가 같은 규칙).
  if (!boss.vulnerableUsed && frac <= kit.vulnerableAt) {
    boss.vulnerableUsed = true;
    boss.vulnerableMs = kit.vulnerableMs;
    boss.vulnerableCharges = BALANCE.vulnerableChargesPerWindow;
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
   * 사라진 채 취약 창만 남아 — 버튼은 "결정타"인데 때릴 몸이 없다 —
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
  assignTelegraph(boss, makeTelegraph(boss, foes, boss.thresholdIdx, tally));
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
     * 쿨다운은 회피·집결에만 건다. 결정타도 차지를 쓰지만 창당 두 번으로
     * 제한되고, 남은 차지를 피해로 바꾸는 선택 자체에 새 쿨다운은 없다.
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
    /**
     * 부검용 카운터 — 큐에서 실제로 빠져나온(=소비된) 명시적 산개/집결 중
     * **넣는 순간** 게이트가 열려 있었던 것만 센다.
     *
     * `!locked`가 "이번 스텝에 `head`가 실제로 `shift()`됐다"는 뜻이다(같은
     * 참조이므로 `head`를 그대로 봐도 된다). 게이트가 열려 있었는지는
     * `head.dual`(=`Intervention.dual`, main.ts가 넣는 순간 채운다)로 본다
     * — 소비 시점에 `dualChoiceActive(state)`를 다시 물으면, 쿨다운에
     * 막혀 늦게 소비되는 사이 극성이 이미 꺼져 있을 수 있어 분명히 골랐는데도
     * 안 세어진다(실측: seed 4에서 입력 1회가 +0으로 셌다). `dual`은 사람이
     * 직접 넣을 때만 채워지고(main.ts) 측정 봇(`bot-policy.mjs`)의 직접
     * dodge/gather에는 없으므로, 봇 입력은 여기서 자동으로 빠진다.
     */
    if (!locked && (head?.kind === "dodge" || head?.kind === "gather") && head.dual === true) {
      state.polarityChoices += 1;
    }
    /**
     * 순차 스윕(sweep)만 예외 — 한 문턱의 두 파동(홀수 행→짝수 행)은 같은
     * 하나의 "안전지대 춤" 기믹이라, 첫 파동에서 이미 차지를 냈으면 두
     * 번째 파동은 몸을 다시 옮겨도 차지·쿨다운을 또 안 문다("개입 1회로
     * 연쇄 전체를 넘긴다", 리뷰 (ㄷ)). `dodgeUsable`(위)이 그 무료 통로를
     * 대신 열어 준다 — 차지가 이미 0이어도 이 예외가 적용돼야 두 번째
     * 파동을 실제로 피할 수 있다(차지 게이트 `state.dodgeCharges > 0`만
     * 보면 첫 파동이 마지막 남은 차지를 썼을 때 두 번째 파동은 몸을 움직일
     * 방법조차 없어진다).
     */
    // 무료 통로는 **위험이 sweep뿐일 때**만. doDodge는 모든 존을 한 번에
    // 처리하므로, 이 한정이 없으면 sweep 중에 뜬 보스 예고까지 공짜·무쿨다운
    // 으로 피하는 길이 열린다(리뷰 A6 — 현재 킷 배치에선 미발현이지만
    // sweep과 다른 예고를 같은 킷에 넣는 순간 터진다).
    const sweepFree = sweepDodgeFree(state);
    if (intent?.kind === "dodge" && dodgeUsable(state) && doDodge(state)) {
      if (sweepFree) {
        // 공짜 — 이미 이 스윕 문턱에서 차지를 썼다.
      } else {
        // dodgeUsable이 자원을 확인한 뒤 doDodge가 성공했으므로 반드시 하나를
        // 소비한다. 취약 창이면 local, 아니면 global이다.
        if (spendDefenseCharge(state)) {
          state.actCooldown = ACT_COOLDOWN_MS;
          if (sweepZones.length > 0) sweepBurstCharged = true;
        }
      }
    } else if (intent?.kind === "gather" && defenseResourceAvailable(state) && doGather(state)) {
      if (spendDefenseCharge(state)) state.actCooldown = ACT_COOLDOWN_MS;
    } else if (intent?.kind === "strike") {
      // 성공한 결정타의 창 기회 소비는 doStrike가 타격과 함께 원자적으로
      // 처리한다. 결정타는 actCooldown을 새로 걸지 않는다.
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
    // 상주 장판(creep)은 특정 보스에 안 묶인다 — 보스가 순간이동하거나
    // 죽어도 그 자리에 남아 있어야 하므로 tickBoss 루프 밖에서 따로 돈다.
    tickCreepZones(allies, step);
    // 순차 스윕(sweep) 대기열도 같은 이유로 tickBoss 루프 밖에서 돈다 —
    // boss.telegraph가 계속 null인 채로(makeTelegraph의 sweep 분기 참고)
    // 5행이 이어져야 하므로 보스의 다음 문턱 판단과 무관해야 한다.
    tickSweepQueue(allies, state, step);
    /**
     * 표식(seize)의 짝인 구원 원이 사라지면(주로 그 보스가 죽었을 때) 표식만
     * 혼자 남는다 — `damage()`는 죽은 보스의 `telegraph`는 지우지만 아군
     * 쪽 상태(`seized`)는 모른다(보스 하나만 받는 함수라 아군 목록이 없다).
     * 매 스텝 여기서 짝이 아직 살아 있는지 확인해, 끊어졌으면 마저 지운다 —
     * 정상 종료(도화선이 다 됨)는 `fireTelegraph`의 seize 분기가 이미
     * 지우므로 여기서는 대부분 조용한 no-op이다.
     */
    if (!foes.some((e) => e.telegraph?.seize === true)) {
      for (const a of allies) if (a.seized) a.seized = false;
    }

    // 양쪽 다 **진짜 고양이만** 센다. 소환수가 남았다고 판이 이어지면
    // 죽은 뒤에 분신이 대신 싸우는 시간이 생긴다.
    const realFoes = livingCats(state.enemy);
    if (realAllies.length === 0 || realFoes.length === 0) {
      // 전투 종료 — 상주 장판·스윕 대기열은 이 전투 안에서만 산다. invariants가
      // "전투 밖에는 남지 않는다"를 그 즉시 검사할 수 있어야 하므로 finishWave보다
      // 먼저 비운다.
      creepZones.length = 0;
      clearSweepQueue();
      /**
       * 최종 국면(finalPhase)도 같은 이유로 여기서 지운다. **보스가 죽지
       * 않고도** 이 전투가 끝날 수 있다 — 마지막 취약 창(open)이 열린 채로
       * 아군이 전멸하면(팀이 아주 얇을 때 실제로 일어난다: 실측으로 20/20
       * 시드에서 재현됐다) `damage()`의 죽음 경로를 안 타므로 `finalPhase`가
       * 안 지워진 채로 `gameover`에 넘어간다.
       */
      for (const e of state.enemy) if (e) e.finalPhase = null;
      // 타임아웃 분기와 대칭 — 패배(전멸) 경로도 표식을 남기지 않는다.
      for (const a of allyBodies(state)) a.seized = false;
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
      creepZones.length = 0; // 위 승패 분기와 같은 이유
      clearSweepQueue();
      for (const e of state.enemy) if (e) e.finalPhase = null; // 위와 같은 이유
      // 표식도 지운다 — 패배 경로는 finishWave가 아군 리셋 전에 빠져나가므로
      // 여기서 안 지우면 게임오버 화면에 표식 마커가 유령처럼 남는다(리뷰 재현).
      for (const a of allyBodies(state)) a.seized = false;
      finishWave(state, false, "timeout");
      return;
    }
  }
}
