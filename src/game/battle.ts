import { BALANCE } from "./balance.ts";
import { BOSS_ANCHORS, BOSS_THRESHOLDS, bossKit, TELEGRAPH_FUSE_MS } from "./bosses.ts";
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
import { bossRampFor, currentKind, finishWave, type RunState } from "./run.ts";

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
  | "frost"; // 얼음 결정 (빙결)

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

function pop(target: Cat, text: string, crit: boolean): void {
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
    const crowd = claimed?.get(f.uid) ?? 0;
    const score = fieldDistance(attacker, f) + crowd * CROWD_PENALTY;
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
  let left = Math.round(amount);
  if (target.shield > 0) {
    const absorbed = Math.min(target.shield, left);
    target.shield -= absorbed;
    left -= absorbed;
  }
  if (left <= 0) {
    pop(target, "막힘", false);
    return;
  }
  target.hp -= left;
  target.flash = FLASH_MS;

  // 전사는 맞을 때도 마나가 찬다.
  // 측정해 보니 전사 스킬이 원거리의 3~6분의 1밖에 안 나갔다. 4번 때려야 하는데
  // 걸어가는 시간까지 있어서다. TFT도 탱커에게 피격 마나를 주는데, 앞에서
  // 두들겨 맞는 역할이 곧 마나 엔진이 되므로 정체성과도 맞는다.
  // 쓸 스킬이 없으면 채워 봐야 쓸 데가 없다. 보스는 전사이면서 스킬이 없어서
  // 마나바가 가득 찬 채로 영원히 떠 있었다.
  if (target.breed.cls === "warrior" && target.breed.skill) {
    target.mana = Math.min(MANA_MAX, target.mana + MANA_ON_HIT_WARRIOR);
  }
  pop(target, String(left), crit);
  if (target.hp <= 0) {
    target.hp = 0;
    target.alive = false;
    target.pose = "sleep";
    target.poseTimer = 0;
    // 죽으면 달리기도 끝난다. `tickDashes`는 살아 있는 것만 도는 탓에, 여기서
    // 안 지우면 목표가 시체에 붙어 다음 전투까지 따라간다.
    target.dash = null;
  }
}

/**
 * 스킬 발동. 마나가 가득 찬 순간 평타 대신 이것이 나간다.
 *
 * 결과 계산은 skills.ts가 하고 여기서는 적용과 연출만 한다. 그래야 브라우저와
 * 헤드리스 시뮬이 같은 판정을 쓴다.
 */
function castSkill(caster: Cat, target: Cat, foes: Cat[], allies: Cat[]): void {
  const res = runSkill(caster, target, foes, allies);

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
      color: CLASS_FX[caster.breed.cls] ?? "#FFFFFF",
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
}

/** 직업별 이펙트 색 */
const CLASS_FX: Record<string, string> = {
  warrior: "#FF9E5A",
  rogue: "#D98BE8",
  archer: "#FFC46B",
  mage: "#8FD4FF",
};

/** 스킬마다 다른 연출을 뿌린다. 무엇이 터졌는지 색과 모양으로 구분되게. */
function spawnSkillFx(caster: Cat, target: Cat, res: SkillResult): void {
  const color = CLASS_FX[caster.breed.cls] ?? "#FFFFFF";
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
      color: CLASS_FX["archer"] ?? "#FFC46B",
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
  const risky = (fx: number, fy: number) => zones.some((z) => inTelegraph(z, fx, fy));
  if (!risky(cat.fx, cat.fy)) return null; // 안전하면 움직이지 않는다

  const onBoard = (fx: number, fy: number) =>
    fy >= -0.3 && fy <= BOARD_ROWS - 1 + 0.3 && fx >= -0.3;

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
  const boss = state.enemy.find((c) => c?.alive && c.radius > 0 && c.vulnerableMs > 0);
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
  for (const c of livingCats(state.ally)) {
    // 흩어짐과 같은 이유. 달리는 중인 고양이는 이미 대답한 것이다.
    if (c.dash) continue;
    if (inTelegraph(target, c.fx, c.fy)) continue;
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
 */
function resolveIntent(state: RunState, intent: Intervention | undefined): Intervention | undefined {
  if (intent?.kind !== "act") return intent;
  if (state.enemy.some((c) => c?.alive && c.vulnerableMs > 0)) return { kind: "strike" };
  const tg = state.enemy.find((c) => c?.telegraph)?.telegraph;
  if (!tg) return { kind: "dodge" }; // 예고가 없으면 doDodge가 알아서 아무 일도 안 한다
  return tg.mode === "gather" ? { kind: "gather" } : { kind: "dodge" };
}

/** 위험 구간 안의 아군을 빼낸다. 실제로 누군가 빠져나왔을 때만 참을 돌려준다. */
function doDodge(state: RunState): boolean {
  const zones: Telegraph[] = [];
  for (const e of state.enemy) if (e?.telegraph) zones.push(e.telegraph);
  if (zones.length === 0) return false;

  // 남은 도화선. 여럿이면 가장 먼저 터지는 것에 맞춘다.
  const fuse = Math.min(...zones.map((z) => z.fuse));
  let moved = false;
  for (const c of livingCats(state.ally)) {
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
  cat.pose = "run";
  cat.poseTimer = 0;
}

/** 같은 편끼리 뭉치지 않도록 살짝 밀어낸다. 길찾기가 아니라 겹침 방지다. */
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
      const minD = SEPARATION + a.radius + b.radius;
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
function clampToField(c: Cat): void {
  const maxX = ENEMY_FRONT_FX + BOARD_COLS - 1;
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
        color: CLASS_FX["rogue"] ?? "#D98BE8",
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
        color: CLASS_FX["rogue"] ?? "#D98BE8",
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
 * 문턱 번호에 따라 예고를 만든다.
 *
 * 원형은 **무게중심**을 노린다. 흩어져 있으면 한가운데가 비어 아무도 안 맞고,
 * 뭉쳐 있으면 통째로 맞는다.
 *
 * 뭉침(gather)은 보스와 아군 사이에 선다. 이미 서 있는 자리에 그리면 공짜가
 * 되므로, 근접은 뒤로 원거리는 앞으로 와야 닿는 지점에 둔다.
 */
function makeTelegraph(boss: Cat, foes: Cat[], idx: number): Telegraph | null {
  if (foes.length === 0) return null;
  const kit = bossKit(boss.breed.id);
  const pattern = kit.patterns[idx % kit.patterns.length]!;
  const mode: TelegraphMode = pattern === "gather" ? "gather" : "avoid";
  const shape: TelegraphShape = pattern === "gather" ? "circle" : pattern;
  const base = { shape, mode, fuse: TELEGRAPH_FUSE_MS, fuseMax: TELEGRAPH_FUSE_MS };

  if (mode === "gather") {
    const c = centroid(foes);
    return {
      ...base,
      fx: (c.fx + boss.fx) / 2,
      fy: (c.fy + boss.fy) / 2,
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
    arg: shape === "line" ? 0.75 : 0.7,
    reach: shape === "line" ? 14 : 5.5,
  };
}

/** 이 좌표가 예고 범위 안인가. 판정은 전부 정준 좌표에서 한다. */
export function inTelegraph(t: Telegraph, fx: number, fy: number): boolean {
  const rx = fx - t.fx;
  const ry = fy - t.fy;
  if (t.shape === "circle") return Math.hypot(rx, ry) <= t.arg;

  const along = rx * t.dirX + ry * t.dirY;
  if (along < 0 || along > t.reach) return false;
  if (t.shape === "line") return Math.abs(rx * t.dirY - ry * t.dirX) <= t.arg;

  // 부채꼴: 시작점에 붙어 있으면 각도가 의미 없으므로 무조건 맞는다.
  const d = Math.hypot(rx, ry);
  if (d < 1e-6) return true;
  return Math.acos(Math.min(1, Math.max(-1, along / d))) <= t.arg;
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

function fireTelegraph(boss: Cat, foes: Cat[], tally: RunState): void {
  const t = boss.telegraph;
  if (!t) return;
  tally.telegraphsSeen += 1;
  const ramp = bossRampFor(tally);
  const frac =
    (BALANCE.telegraphDmgFirst + (BALANCE.telegraphDmg - BALANCE.telegraphDmgFirst) * ramp) *
    bossKit(boss.breed.id).power;
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
    const outside = foes.filter((f) => !inTelegraph(t, f.fx, f.fy));
    if (outside.length > 0) tally.telegraphsEaten += 1;
    for (const f of outside) damage(f, telegraphHit(f, boss, frac), false);
    // 뭉침이 끝나면 곧바로 흩어질 수 있어야 한다. 묶어 두면 다음 원형 예고가
    // 무게중심을 노려 통째로 맞고, 그러면 모인 것이 벌이 된다.
    for (const f of foes) f.moveLock = 0;
  } else {
    let caught = 0;
    for (const f of foes) {
      if (!inTelegraph(t, f.fx, f.fy)) continue;
      caught += 1;
      // 최대 체력 대비 비율이라 웨이브·팀 구성과 무관하게 "뭉치면 아프다"가 성립한다.
      damage(f, telegraphHit(f, boss, frac), false);
    }
    // 한 마리라도 걸리면 실패로 친다. "몇 마리 맞았나"는 팀 크기에 따라 달라져
    // 판끼리 비교가 안 되지만, "피했나 못 피했나"는 언제나 같은 뜻이다.
    if (caught > 0) tally.telegraphsEaten += 1;
  }
  pushFx({
    kind: "ring",
    fx: t.shape === "circle" ? t.fx : t.fx + t.dirX * t.reach * 0.4,
    fy: t.shape === "circle" ? t.fy : t.fy + t.dirY * t.reach * 0.4,
    tx: 0,
    ty: 0,
    radius: t.shape === "circle" ? t.arg : 1.4,
    angle: 0,
    life: 420,
    color: t.mode === "gather" ? FX_GATHER : FX_DANGER,
  });
}

/**
 * 보스를 다음 자리로 옮긴다.
 *
 * 근접은 다시 걸어가야 하고, 뒤이어 뜨는 예고의 기준점도 바뀐다. 전투 전에
 * 한 번 정한 배치가 끝까지 유효하지 않게 만드는 장치다.
 */
function teleportBoss(boss: Cat, idx: number): void {
  const a = BOSS_ANCHORS[idx % BOSS_ANCHORS.length];
  if (!a) return;
  const to = cellToField("enemy", a.row * BOARD_COLS + a.col);
  if (Math.abs(to.fx - boss.fx) < 0.1 && Math.abs(to.fy - boss.fy) < 0.1) return;

  // 사라지는 자리와 나타나는 자리 양쪽에 표시한다. 둘 다 없으면 순간이동이
  // "갑자기 딴 데 있네"로만 읽히고 무슨 일이 일어났는지 전달되지 않는다.
  for (const at of [{ fx: boss.fx, fy: boss.fy }, to]) {
    pushFx({
      kind: "ring",
      fx: at.fx,
      fy: at.fy,
      tx: 0,
      ty: 0,
      radius: boss.radius,
      angle: 0,
      life: 420,
      color: FX_DANGER,
    });
  }
  boss.fx = to.fx;
  boss.fy = to.fy;
}

/** 보스의 체력 문턱을 보고 예고를 걸거나 터뜨린다. */
function tickBoss(boss: Cat, foes: Cat[], dt: number, tally: RunState): void {
  if (!boss.alive) return;
  const kit = bossKit(boss.breed.id);

  // 취약 창이 열려 있는 동안에는 예고를 걸지 않는다. 이 3초가 플레이어의 차례다.
  if (boss.vulnerableMs > 0) {
    boss.vulnerableMs = Math.max(0, boss.vulnerableMs - dt);
    if (boss.vulnerableMs === 0) boss.strikeCombo = 0;
    return;
  }

  if (boss.telegraph) {
    boss.telegraph.fuse -= dt;
    if (boss.telegraph.fuse <= 0) {
      fireTelegraph(boss, foes, tally);
      boss.telegraph = null;
    }
    return; // 예고 중에는 다음 문턱을 밟아도 겹쳐 걸지 않는다
  }

  const frac = boss.hp / Math.max(1, boss.maxHp);
  const next = BOSS_THRESHOLDS[boss.thresholdIdx];
  if (next === undefined || frac > next) return;

  // 한 번 걸러 자리를 옮긴 뒤 그 자리에서 예고한다. 순서가 반대면 예고가
  // 뜬 곳과 터지는 곳이 달라져 화면이 거짓말을 한다.
  // 취약 창은 문턱보다 먼저 본다. 여기서 예고를 걸면 창과 겹쳐 회피와 공격을
  // 동시에 요구하게 되고, 버튼이 하나라 둘 다 못 한다.
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

  if (kit.teleportEvery > 0 && boss.thresholdIdx % kit.teleportEvery === 0) {
    teleportBoss(boss, Math.floor(boss.thresholdIdx / Math.max(1, kit.teleportEvery)));
  }
  boss.telegraph = makeTelegraph(boss, foes, boss.thresholdIdx);
  boss.thresholdIdx += 1;
}

/** 한 프레임 분량을 고정 스텝으로 시뮬레이션한다. */
export function stepBattle(state: RunState, dtMs: number): void {
  tickEffects(state.ally, dtMs);
  tickEffects(state.enemy, dtMs);

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
  if (state.battleElapsed === 0) assassinLeap(state);

  let remaining = Math.min(dtMs, SIM_STEP_MS * 4); // 탭 복귀 시 폭주 방지
  while (remaining > 0) {
    const step = Math.min(SIM_STEP_MS, remaining);
    remaining -= step;
    state.battleElapsed += step;

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

    const allies = livingCats(state.ally);
    // 달리기는 타겟팅·공격보다 먼저 처리한다. 이번 스텝의 사거리 판정이
    // **도착한 자리** 기준이라야, 위험 구간을 빠져나온 것이 그 스텝에 반영된다.
    //
    // 양쪽 다 돈다. 개입은 아군만 쓰지만 도적 도약은 적도 하므로, 여기서 적을
    // 빠뜨리면 적 도적이 허공에 멈춘 채로 전투가 끝난다.
    tickDashes(allies, step);
    tickDashes(livingCats(state.enemy), step);
    for (const e of livingCats(state.enemy)) if (e.radius > 0) tickBoss(e, allies, step, state);
    const foes = livingCats(state.enemy);

    if (allies.length === 0 || foes.length === 0) {
      finishWave(state, foes.length === 0 && allies.length > 0);
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

      const enemies = cat.side === "ally" ? livingCats(state.enemy) : livingCats(state.ally);
      const target = pickTarget(cat, enemies, claimed);
      if (!target) break;
      claimed.set(target.uid, (claimed.get(target.uid) ?? 0) + 1);

      cat.cooldown -= step;

      if (surfaceDistance(cat, target) <= cat.breed.range) {
        if (cat.cooldown <= 0) {
          // 마나가 가득 찼으면 평타 대신 스킬이 나간다.
          if (cat.breed.skill && cat.mana >= MANA_MAX) {
            const own = cat.side === "ally" ? livingCats(state.ally) : livingCats(state.enemy);
            castSkill(cat, target, enemies, own);
          } else {
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
