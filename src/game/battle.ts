import { cellCol, cellRow, livingCats, type Cat, type Side } from "./types.ts";
import { finishWave, type RunState } from "./run.ts";

/** 고정 시뮬레이션 스텝. 프레임레이트와 무관하게 전투 결과가 재현된다. */
export const SIM_STEP_MS = 100;
/**
 * 교착 방지 상한. 이 시간을 넘기면 패배로 처리한다.
 *
 * 처음에는 남은 체력 비율로 판정했는데, 탱키하고 회피 높은 조합이 아무도 죽이지
 * 못한 채 매 웨이브 타임아웃 승리를 가져가며 런이 끝나지 않았다(시뮬 15%가 60웨이브
 * 상한에 도달). 전투는 3~5초에 끝나도록 설계했으므로 12초는 충분히 관대하다.
 */
const BATTLE_TIMEOUT_MS = 12_000;

const POSE_WINK_MS = 500;
const POSE_MOVE_MS = 260;
const FLASH_MS = 160;

/** 렌더러가 셀 좌표로 환산해 띄우는 1회성 연출. */
export interface DamagePop {
  cell: number;
  side: Side;
  text: string;
  /** 남은 수명(ms). 렌더러가 상승 오프셋과 알파를 여기서 계산한다. */
  life: number;
  maxLife: number;
  crit: boolean;
  /** 같은 칸에 동시에 뜬 숫자가 완전히 겹치지 않도록 흩뜨리는 값 */
  jitter: number;
}

export const POP_LIFE_MS = 700;

export const damagePops: DamagePop[] = [];

let popSeq = 0;

function pop(target: Cat, text: string, crit: boolean): void {
  // 같은 고양이에게 팝업이 쌓이면 숫자가 겹쳐 읽을 수 없다.
  if (damagePops.length > 24) damagePops.shift();
  damagePops.push({
    cell: target.cell,
    side: target.side,
    text,
    life: POP_LIFE_MS,
    maxLife: POP_LIFE_MS,
    crit,
    jitter: ((popSeq++ % 3) - 1) * 0.22,
  });
}

/**
 * 앞줄 우선 타겟팅.
 * 아군은 적 보드의 왼쪽 열(col 0)부터, 적은 아군 보드의 오른쪽 열(col 2)부터 노린다.
 * 같은 열 안에서는 공격자와 행이 가까운 쪽을 먼저 친다.
 */
export function pickTarget(attacker: Cat, foes: Cat[]): Cat | null {
  if (foes.length === 0) return null;
  const frontFirst = attacker.side === "ally";
  const myRow = cellRow(attacker.cell);

  let best: Cat | null = null;
  let bestKey = Number.POSITIVE_INFINITY;

  for (const f of foes) {
    const col = cellCol(f.cell);
    const colRank = frontFirst ? col : 2 - col;
    const rowDist = Math.abs(cellRow(f.cell) - myRow);
    const key = colRank * 10 + rowDist;
    if (key < bestKey) {
      bestKey = key;
      best = f;
    }
  }
  return best;
}

function attack(attacker: Cat, target: Cat): void {
  attacker.pose = "move";
  attacker.poseTimer = POSE_MOVE_MS;
  attacker.lunge = 1;

  if (Math.random() < target.evade) {
    pop(target, "회피", false);
    return;
  }

  target.hp -= attacker.atk;
  target.flash = FLASH_MS;
  // 절대값(>=40)으로 잡으면 웨이브 7쯤부터 모든 타격이 crit이 되어 강조가 무의미해진다.
  // 대상 최대 체력 대비로 잡아야 "한 방이 컸다"는 신호가 유지된다.
  pop(target, String(attacker.atk), attacker.atk >= target.maxHp * 0.35);

  if (target.hp <= 0) {
    target.hp = 0;
    target.alive = false;
    target.pose = "sleep";
    target.poseTimer = 0;
    attacker.pose = "wink";
    attacker.poseTimer = POSE_WINK_MS;
  }
}


function tickPoses(cats: (Cat | null)[], dt: number): void {
  for (const c of cats) {
    if (!c) continue;
    if (c.flash > 0) c.flash = Math.max(0, c.flash - dt);
    if (c.lunge > 0) c.lunge = Math.max(0, c.lunge - dt / POSE_MOVE_MS);
    if (!c.alive) {
      c.pose = "sleep";
      continue;
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

/** 한 프레임 분량을 고정 스텝으로 나눠 시뮬레이션한다. */
export function stepBattle(state: RunState, dtMs: number): void {
  tickPoses(state.ally, dtMs);
  tickPoses(state.enemy, dtMs);

  for (const pop of damagePops) pop.life -= dtMs;
  for (let i = damagePops.length - 1; i >= 0; i--) {
    const p = damagePops[i];
    if (p && p.life <= 0) damagePops.splice(i, 1);
  }

  if (state.phase !== "battle") return;

  let remaining = Math.min(dtMs, SIM_STEP_MS * 4); // 탭 복귀 시 폭주 방지
  while (remaining > 0) {
    const step = Math.min(SIM_STEP_MS, remaining);
    remaining -= step;
    state.battleElapsed += step;

    const allies = livingCats(state.ally);
    const foes = livingCats(state.enemy);

    if (allies.length === 0 || foes.length === 0) {
      finishWave(state, foes.length === 0 && allies.length > 0);
      return;
    }

    // 공격 순서는 쿨다운이 많이 지난 순. 동시 공격의 판정 순서를 결정적으로 만든다.
    const actors = [...allies, ...foes].sort((a, b) => a.cooldown - b.cooldown);
    for (const cat of actors) {
      if (!cat.alive) continue;
      cat.cooldown -= step;
      if (cat.cooldown > 0) continue;

      const targets = cat.side === "ally" ? livingCats(state.enemy) : livingCats(state.ally);
      const target = pickTarget(cat, targets);
      if (!target) break;

      attack(cat, target);
      cat.cooldown += cat.atkInterval;
    }

    if (state.battleElapsed >= BATTLE_TIMEOUT_MS) {
      state.notice = "시간 초과";
      finishWave(state, false);
      return;
    }
  }
}
