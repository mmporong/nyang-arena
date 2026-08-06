import { BALANCE } from "./balance.ts";
import { BOSS_ANCHORS, BOSS_THRESHOLDS, bossKit, TELEGRAPH_FUSE_MS } from "./bosses.ts";
import { rng } from "./rng.ts";
import {
  BOARD_COLS,
  BOARD_ROWS,
  cellRow,
  cellToField,
  fieldDistance,
  livingCats,
  surfaceDistance,
  MANA_MAX,
  type Cat,
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
import { bossRamp, finishWave, waveKind, type RunState } from "./run.ts";

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

function battleTimeout(wave: number): number {
  return waveKind(wave) === "boss" ? BOSS_TIMEOUT_MS : BATTLE_TIMEOUT_MS;
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
 * 위험 구간 밖의 가장 가까운 자리를 찾는다.
 *
 * 각도와 거리를 고정 격자로 훑는다 — 난수를 쓰면 같은 시드에서도 회피 결과가
 * 갈려 개입의 값을 잴 수 없다.
 */
function safeSpot(cat: Cat, zones: Telegraph[]): { fx: number; fy: number } | null {
  const risky = (fx: number, fy: number) => zones.some((z) => inTelegraph(z, fx, fy));
  if (!risky(cat.fx, cat.fy)) return null; // 안전하면 움직이지 않는다

  for (let ring = 1; ring <= 7; ring++) {
    const r = ring * 0.55;
    for (let a = 0; a < 12; a++) {
      const ang = (a / 12) * Math.PI * 2;
      const fx = cat.fx + Math.cos(ang) * r;
      const fy = cat.fy + Math.sin(ang) * r;
      // 보드 밖으로 도망가지는 못한다. 피할 자리가 없으면 맞는 게 맞다.
      if (fy < -0.3 || fy > BOARD_ROWS - 1 + 0.3 || fx < -0.3) continue;
      if (!risky(fx, fy)) return { fx, fy };
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
    if (inTelegraph(target, c.fx, c.fy)) continue;
    // 장판 중심 쪽으로 당긴다. 가장자리에 걸치면 판정이 아슬아슬해지므로
    // 반경의 60% 안쪽으로 넣는다.
    const dx = target.fx - c.fx;
    const dy = target.fy - c.fy;
    const d = Math.hypot(dx, dy) || 1;
    const pull = Math.max(0, d - target.arg * 0.6);
    c.fx += (dx / d) * pull;
    c.fy += (dy / d) * pull;
    c.moveLock = DODGE_LOCK_MS;
    moved = true;
    pushFx({ kind: "spark", fx: c.fx, fy: c.fy, tx: 0, ty: 0, radius: 0.5, angle: 0, life: 260, color: "#6E97C4" });
  }
  return moved;
}

/** 위험 구간 안의 아군을 빼낸다. 실제로 누군가 빠져나왔을 때만 참을 돌려준다. */
function doDodge(state: RunState): boolean {
  const zones: Telegraph[] = [];
  for (const e of state.enemy) if (e?.telegraph) zones.push(e.telegraph);
  if (zones.length === 0) return false;

  let moved = false;
  for (const c of livingCats(state.ally)) {
    const spot = safeSpot(c, zones);
    if (!spot) continue;
    c.fx = spot.fx;
    c.fy = spot.fy;
    c.moveLock = DODGE_LOCK_MS;
    moved = true;
    pushFx({ kind: "spark", fx: c.fx, fy: c.fy, tx: 0, ty: 0, radius: 0.5, angle: 0, life: 260, color: "#F3E8D6" });
  }
  return moved;
}

/** 목표 쪽으로 이동. 사거리 바로 안쪽까지만 간다. */
function stepToward(cat: Cat, target: Cat, stepMs: number): void {
  if (cat.moveLock > 0) return; // 회피 직후에는 제자리를 지킨다
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
    }
  }
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
      c.fx = to.fx;
      c.fy = to.fy;
      c.pose = "run";
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
function fireTelegraph(boss: Cat, foes: Cat[], wave: number, tally: RunState): void {
  const t = boss.telegraph;
  if (!t) return;
  tally.telegraphsSeen += 1;
  const ramp = bossRamp(wave);
  const frac =
    (BALANCE.telegraphDmgFirst + (BALANCE.telegraphDmg - BALANCE.telegraphDmgFirst) * ramp) *
    bossKit(boss.breed.id).power;
  if (t.mode === "gather") {
    // **절반 이상**이 들어와야 나눠진다. 한 마리만으로 성립하면 근접이 보스로
    // 걸어가다 우연히 지나가는 것만으로 충족되어, 모이라는 요구가 요구가 아니게
    // 된다. WoW의 soak도 "충분히 안 들어오면 치명적"이라는 같은 규칙을 쓴다.
    const inside = foes.filter((f) => inTelegraph(t, f.fx, f.fy));
    const need = Math.max(2, Math.ceil(foes.length / 2));
    if (inside.length < need) {
      tally.telegraphsEaten += 1;
      const miss = frac * BALANCE.gatherMissMul;
      for (const f of foes) damage(f, Math.max(1, Math.round(f.maxHp * miss)), false);
    } else {
      const share = frac / inside.length;
      for (const f of inside) damage(f, Math.max(1, Math.round(f.maxHp * share)), false);
    }
    // 뭉침이 끝나면 곧바로 흩어질 수 있어야 한다. 묶어 두면 다음 원형 예고가
    // 무게중심을 노려 통째로 맞고, 그러면 모인 것이 벌이 된다.
    for (const f of foes) f.moveLock = 0;
  } else {
    let caught = 0;
    for (const f of foes) {
      if (!inTelegraph(t, f.fx, f.fy)) continue;
      caught += 1;
      // 최대 체력 대비 비율이라 웨이브·팀 구성과 무관하게 "뭉치면 아프다"가 성립한다.
      damage(f, Math.max(1, Math.round(f.maxHp * frac)), false);
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
function tickBoss(boss: Cat, foes: Cat[], dt: number, wave: number, tally: RunState): void {
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
      fireTelegraph(boss, foes, wave, tally);
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
    const intent = state.pending.shift();
    if (intent?.kind === "dodge" && state.dodgeCharges > 0 && doDodge(state)) {
      state.dodgeCharges -= 1;
    } else if (intent?.kind === "gather" && state.dodgeCharges > 0 && doGather(state)) {
      state.dodgeCharges -= 1;
    } else if (intent?.kind === "strike") {
      // 약점 공격은 차지를 쓰지 않는다. 창이 열려 있는 3초 자체가 제한이다.
      doStrike(state);
    }

    const allies = livingCats(state.ally);
    for (const e of livingCats(state.enemy)) if (e.radius > 0) tickBoss(e, allies, step, state.wave, state);
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

    if (state.battleElapsed >= battleTimeout(state.wave)) {
      finishWave(state, false, "timeout");
      return;
    }
  }
}
