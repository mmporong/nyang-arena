import { fieldDistance, livingCats, MANA_MAX, type Cat } from "./types.ts";
import { runSkill, SKILLS } from "./skills.ts";
import { finishWave, type RunState } from "./run.ts";

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

/** 전사가 피격 한 번에 얻는 마나 */
const MANA_ON_HIT_WARRIOR = 11;

/** 렌더러가 화면 좌표로 옮겨 띄우는 1회성 연출. */
export interface DamagePop {
  fx: number;
  fy: number;
  text: string;
  life: number;
  crit: boolean;
  /** 같은 자리에 뜬 숫자가 완전히 겹치지 않도록 흩뜨리는 값 */
  jitter: number;
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

/** 스킬 발동 순간의 파문. 시전자 위치에 잠깐 원이 퍼진다. */
export interface Burst {
  fx: number;
  fy: number;
  radius: number;
  life: number;
  ally: boolean;
}
export const BURST_LIFE_MS = 320;
export const bursts: Burst[] = [];

/** 렌더러가 시전 이름표를 그릴 때 쓴다. */
export function skillName(cat: Cat): string {
  return SKILLS[cat.breed.skill].name;
}

let popSeq = 0;

function pop(target: Cat, text: string, crit: boolean): void {
  if (damagePops.length > 16) damagePops.shift();
  damagePops.push({
    fx: target.fx,
    fy: target.fy,
    text,
    life: POP_LIFE_MS,
    crit,
    jitter: ((popSeq++ % 3) - 1) * 0.22,
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
  if (target.breed.cls === "warrior") {
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

  if (bursts.length > 12) bursts.shift();
  bursts.push({
    fx: caster.fx,
    fy: caster.fy,
    radius: caster.breed.kind === "melee" ? 1.6 : 0.9,
    life: BURST_LIFE_MS,
    ally: caster.side === "ally",
  });

  for (const s of res.shots) {
    if (shots.length > 32) shots.shift();
    shots.push({
      fromX: caster.fx,
      fromY: caster.fy,
      toX: s.fx,
      toY: s.fy,
      life: SHOT_LIFE_MS,
      ally: caster.side === "ally",
    });
  }

  for (const h of res.hits) {
    if (!h.target.alive) continue;
    damage(h.target, caster.atk * h.mul, true);
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

  if (Math.random() < target.evade) {
    pop(target, "빗나감", false);
    return;
  }

  damage(target, attacker.atk, attacker.atk >= target.maxHp * 0.35);
  if (!target.alive) {
    attacker.pose = "wink";
    attacker.poseTimer = POSE_WINK_MS;
  }
}

/** 목표 쪽으로 이동. 사거리 바로 안쪽까지만 간다. */
function stepToward(cat: Cat, target: Cat, stepMs: number): void {
  const dx = target.fx - cat.fx;
  const dy = target.fy - cat.fy;
  const d = Math.hypot(dx, dy);
  if (d <= 1e-6) return;

  const want = cat.breed.moveSpeed * (stepMs / 1000);
  // 지나쳐 들어가면 다음 틱에 뒤로 밀렸다 앞으로 갔다 하며 떤다.
  const travel = Math.min(want, Math.max(0, d - cat.breed.range * 0.95));
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
      if (d >= SEPARATION) continue;
      // 정확히 겹쳤으면 uid 순서로 축을 갈라 결정적으로 만든다.
      const nx = d > 1e-6 ? dx / d : a.uid < b.uid ? 1 : -1;
      const ny = d > 1e-6 ? dy / d : 0;
      const push = (SEPARATION - d) * 0.5;
      a.fx -= nx * push;
      a.fy -= ny * push;
      b.fx += nx * push;
      b.fy += ny * push;
    }
  }
}

function tickEffects(cats: (Cat | null)[], dt: number): void {
  for (const c of cats) {
    if (!c) continue;
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
  for (let i = bursts.length - 1; i >= 0; i--) {
    const b = bursts[i];
    if (!b) continue;
    b.life -= dtMs;
    if (b.life <= 0) bursts.splice(i, 1);
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

      if (fieldDistance(cat, target) <= cat.breed.range) {
        if (cat.cooldown <= 0) {
          // 마나가 가득 찼으면 평타 대신 스킬이 나간다.
          if (cat.mana >= MANA_MAX) {
            const own = cat.side === "ally" ? livingCats(state.ally) : livingCats(state.enemy);
            castSkill(cat, target, enemies, own);
          } else {
            attack(cat, target);
          }
          cat.cooldown += cat.atkInterval;
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

    if (state.battleElapsed >= BATTLE_TIMEOUT_MS) {
      finishWave(state, false, "timeout");
      return;
    }
  }
}
