import { BALANCE } from "./balance.ts";
import { BREEDS, breedById } from "./breeds.ts";
import {
  BOARD_SIZE,
  cellCol,
  cellToField,
  emptyBoard,
  livingCats,
  type Board,
  type Breed,
  type Cat,
  type Side,
} from "./types.ts";
import {
  isTriggered,
  PRESET_SYNERGIES,
  validateAll,
  type BoardUnit,
  type SynergyRule,
} from "../validate/synergy-schema.ts";
// import attribute를 붙여야 Vite와 Node 양쪽에서 같은 모듈이 로드된다.
// (밸런스 하네스가 이 모듈을 Node에서 직접 임포트한다)
import generated from "../data/synergies.json" with { type: "json" };

export type Phase = "prepare" | "battle" | "reward" | "gameover";

export interface Offer {
  kind: "recruit" | "upgrade";
  cost: number;
  breed?: Breed;
  /** upgrade일 때 대상 고양이 uid */
  targetUid?: string;
  label: string;
}

export interface RunState {
  phase: Phase;
  wave: number;
  gold: number;
  best: number;
  ally: Board;
  enemy: Board;
  synergies: SynergyRule[];
  activeSynergyIds: Set<string>;
  offers: Offer[];
  /** 마지막 전투 결과 메시지 */
  notice: string;
  battleElapsed: number;
  /** 이번 런에서 최고 기록을 깼는지. 동점을 갱신으로 표시하지 않기 위해 따로 둔다. */
  recordBroken: boolean;
  /** 마지막 패배 사유. notice는 다른 문구로 덮이므로 따로 보관한다. */
  lossReason: "wipe" | "timeout" | null;
}

const BEST_KEY = "nyang-arena.best";
const SYNERGIES_PER_RUN = 3;

/**
 * 레벨당 성장은 지수여야 한다.
 * 적은 웨이브마다 복리로 성장하는데 플레이어만 선형으로 크면 몇 웨이브 안에
 * 반드시 따라잡힌다. 실제로 선형 성장 버전은 웨이브 2에서 전멸했다.
 */
export function levelScale(level: number): number {
  return Math.pow(BALANCE.levelScale, level - 1);
}

export function upgradeCost(level: number): number {
  return Math.round(BALANCE.upgradeCostBase * Math.pow(BALANCE.upgradeCostGrowth, level - 1));
}

export function goldForWave(wave: number): number {
  return Math.round(BALANCE.goldBase + wave * BALANCE.goldPerWave);
}

/** 웨이브를 넘길수록 살아남은 전원이 강해진다. 적의 전체 복리 성장에 대응하는 축. */
export function veterancyScale(wave: number): number {
  return Math.pow(BALANCE.veterancy, wave - 1);
}

let uidSeq = 0;
function nextUid(): string {
  uidSeq += 1;
  return `c${uidSeq}`;
}

/**
 * 런에 쓸 시너지 풀을 결정한다.
 * 빌드타임 생성분(synergies.json)을 검증기에 통과시키고, 통과분이 부족하면
 * 프리셋으로 채운다. AC-12: 생성 데이터가 비어도 게임은 정상 동작해야 한다.
 */
export function resolveSynergyPool(): SynergyRule[] {
  const { accepted } = validateAll(generated);
  if (accepted.length >= SYNERGIES_PER_RUN) return accepted;
  const byId = new Map(accepted.map((r) => [r.id, r]));
  for (const p of PRESET_SYNERGIES) if (!byId.has(p.id)) byId.set(p.id, p);
  return [...byId.values()];
}

function pickSynergies(pool: SynergyRule[]): SynergyRule[] {
  // 트리거가 겹치면 한 조합으로 여러 개가 동시에 켜져 밸런스가 무너진다.
  // 트리거당 최대 1개만 뽑는다.
  const byTrigger = new Map<string, SynergyRule[]>();
  for (const r of pool) {
    const list = byTrigger.get(r.trigger) ?? [];
    list.push(r);
    byTrigger.set(r.trigger, list);
  }
  // 트리거가 4종이고 한 판에 3개만 쓰므로, 그룹 순서를 섞어야 판마다 다른 조합이 나온다.
  const groups = [...byTrigger.values()].sort(() => Math.random() - 0.5);
  const out: SynergyRule[] = [];
  const usedEffects = new Set<string>();

  for (const list of groups) {
    if (out.length >= SYNERGIES_PER_RUN) break;
    const shuffled = [...list].sort(() => Math.random() - 0.5);
    // 효과까지 겹치면 세 목표가 전부 "공격 속도"인 판이 나와 선택의 맛이 사라진다.
    // 아직 안 쓴 효과를 우선하고, 없으면 아무거나 쓴다.
    const pick = shuffled.find((r) => !usedEffects.has(r.effect.key)) ?? shuffled[0];
    if (!pick) continue;
    usedEffects.add(pick.effect.key);
    out.push(pick);
  }
  return out;
}

export function makeCat(breed: Breed, side: Side, cell: number, level = 1): Cat {
  const scale = levelScale(level);
  const maxHp = Math.round(breed.hp * scale);
  const { fx, fy } = cellToField(side, cell);
  return {
    uid: nextUid(),
    breed,
    level,
    maxHp,
    hp: maxHp,
    atk: Math.round(breed.atk * scale),
    atkInterval: breed.atkInterval,
    evade: 0,
    cooldown: breed.atkInterval,
    side,
    cell,
    fx,
    fy,
    alive: true,
    pose: side === "ally" ? "idle" : "back",
    poseTimer: 0,
    lunge: 0,
    flash: 0,
  };
}

export function loadBest(): number {
  try {
    const v = Number(localStorage.getItem(BEST_KEY));
    return Number.isFinite(v) && v > 0 ? v : 0;
  } catch {
    return 0;
  }
}

function saveBest(v: number): void {
  try {
    localStorage.setItem(BEST_KEY, String(v));
  } catch {
    /* 사파리 프라이빗 모드 등에서 실패해도 게임 진행에는 영향 없음 */
  }
}

export function newRun(): RunState {
  const pool = resolveSynergyPool();
  const state: RunState = {
    phase: "prepare",
    wave: 1,
    gold: BALANCE.startGold,
    best: loadBest(),
    ally: emptyBoard(),
    enemy: emptyBoard(),
    synergies: pickSynergies(pool),
    activeSynergyIds: new Set(),
    offers: [],
    notice: "근접은 앞줄, 원거리는 뒷줄",
    battleElapsed: 0,
    recordBroken: false,
    lossReason: null,
  };

  // 시작 3마리. 2마리로 시작하면 웨이브 2를 넘기지 못한다.
  // 근접 둘과 원거리 하나를 섞어서 두 종류를 처음부터 보여준다.
  // 전부 근접으로 시작하면 '뒷줄 원거리' 목표가 1웨이브부터 달성 불가로 보인다.
  // 가운데 줄에 앞·중간·뒤로 하나씩 세운다. 근접이 앞, 원거리가 뒤라는 형태를
  // 보여주되 배치 목표는 한 칸씩 모자라게 둔다(앞줄 근접 1/2, 뒷줄 원거리 1/2).
  // 목표가 처음부터 달성돼 있으면 플레이어가 할 일이 없다.
  const starters = [BREEDS[0], BREEDS[3], BREEDS[1]].slice(0, BALANCE.starterCount);
  const startCells = [5, 4, 3];
  starters.forEach((b, i) => {
    if (!b) return;
    const cell = startCells[i] ?? 3 + i;
    state.ally[cell] = makeCat(b, "ally", cell);
  });

  buildEnemyWave(state);
  rollOffers(state);
  return state;
}

/** 웨이브가 오를수록 적이 많아지고 스탯이 ×1.25^(wave-1)로 커진다. */
export function buildEnemyWave(state: RunState): void {
  const w = state.wave;
  const scale = Math.pow(BALANCE.enemyScale, w - 1);
  const count = Math.min(BOARD_SIZE, Math.ceil(w / BALANCE.enemyCountDivisor));

  state.enemy = emptyBoard();
  // 앞줄(플레이어와 마주보는 열)부터 채워 전투가 빨리 붙게 한다.
  const order = [0, 3, 6, 1, 4, 7, 2, 5, 8];
  for (let i = 0; i < count; i++) {
    const cell = order[i];
    if (cell === undefined) break;
    const breed = BREEDS[(w * 3 + i * 5) % BREEDS.length];
    if (!breed) continue;
    const cat = makeCat(breed, "enemy", cell);
    cat.maxHp = Math.round(cat.maxHp * scale);
    cat.hp = cat.maxHp;
    cat.atk = Math.round(cat.atk * scale);
    state.enemy[cell] = cat;
  }
}

/** 아군 보드 구성으로 활성 시너지를 판정하고 스탯에 반영한다. */
/** 시너지 판정용 보드 스냅샷. 배치(열)까지 포함해야 앞줄/뒷줄 조건을 볼 수 있다. */
export function boardUnits(state: RunState): BoardUnit[] {
  return livingCats(state.ally).map((c) => ({
    color: c.breed.color,
    breedId: c.breed.id,
    kind: c.breed.kind,
    col: cellCol(c.cell),
  }));
}

export function applySynergies(state: RunState): void {
  const cats = livingCats(state.ally);
  const units = boardUnits(state);

  state.activeSynergyIds = new Set(
    state.synergies.filter((s) => isTriggered(s.trigger, units)).map((s) => s.id),
  );

  for (const cat of cats) {
    // 항상 기본값에서 다시 계산한다. 배치를 바꿀 때마다 배수가 누적되면 안 된다.
    const scale = levelScale(cat.level) * veterancyScale(state.wave);
    let maxHp = cat.breed.hp * scale;
    let atk = cat.breed.atk * scale;
    let interval = cat.breed.atkInterval;
    let evade = 0;

    for (const s of state.synergies) {
      if (!state.activeSynergyIds.has(s.id)) continue;
      switch (s.effect.key) {
        case "atk_mul":
          atk *= s.effect.value;
          break;
        case "hp_mul":
          maxHp *= s.effect.value;
          break;
        case "atkspd_mul":
          interval /= s.effect.value;
          break;
        case "evade_add":
          evade += s.effect.value;
          break;
      }
    }

    const ratio = cat.maxHp > 0 ? cat.hp / cat.maxHp : 1;
    cat.maxHp = Math.round(maxHp);
    cat.hp = Math.max(1, Math.round(cat.maxHp * ratio));
    cat.atk = Math.round(atk);
    cat.atkInterval = Math.round(interval);
    cat.evade = Math.min(0.6, evade);
  }
}

/**
 * 보드가 꽉 찼는데 영입 카드를 계속 내밀면, 눌러도 아무 일이 안 일어나고
 * 이유도 보이지 않는다. 자리가 없으면 강화만 제시한다.
 */
export function rollOffers(state: RunState): void {
  const offers: Offer[] = [];
  const owned = state.ally.filter((c): c is Cat => c !== null);
  const hasFreeSlot = state.ally.some((c) => c === null);

  if (hasFreeSlot) {
    // 조건이 전부 "모으면 좋은" 방향이라, 영입이 시너지를 깨뜨리는 경우가 없다.
    // (예전 all_different_5는 반대라서 영입 후보를 걸러내야 했다)
    const pool = [...BREEDS].sort(() => Math.random() - 0.5).slice(0, 2);
    for (const b of pool) {
      offers.push({ kind: "recruit", cost: b.cost, breed: b, label: `${b.name} 영입` });
    }
  }

  // 남은 칸을 강화로 채운다. 대상은 중복되지 않게 고른다.
  const shuffled = [...owned].sort(() => Math.random() - 0.5);
  for (const target of shuffled) {
    if (offers.length >= 3) break;
    offers.push({
      kind: "upgrade",
      cost: upgradeCost(target.level),
      targetUid: target.uid,
      label: `${target.breed.name} Lv.${target.level + 1}`,
    });
  }

  state.offers = offers;
}

export function buyOffer(state: RunState, offer: Offer): boolean {
  if (state.gold < offer.cost) return false;

  if (offer.kind === "recruit" && offer.breed) {
    const free = state.ally.findIndex((c) => c === null);
    if (free < 0) {
      // 살 수 없는 카드를 목록에 남겨두면 무한히 재시도된다. 즉시 걷어낸다.
      state.offers = state.offers.filter((o) => o !== offer);
      state.notice = "보드가 꽉 찼습니다";
      return false;
    }
    state.ally[free] = makeCat(offer.breed, "ally", free);
  } else if (offer.kind === "upgrade" && offer.targetUid) {
    const cat = state.ally.find((c) => c?.uid === offer.targetUid);
    if (!cat) return false;
    cat.level += 1;
  } else {
    return false;
  }

  state.gold -= offer.cost;
  state.offers = state.offers.filter((o) => o !== offer);
  applySynergies(state);
  return true;
}

/** 모든 고양이를 자기 셀 위치로 되돌린다. */
export function resetPositions(state: RunState): void {
  for (const board of [state.ally, state.enemy]) {
    for (const c of board) {
      if (!c) continue;
      const { fx, fy } = cellToField(c.side, c.cell);
      c.fx = fx;
      c.fy = fy;
    }
  }
}

export function startBattle(state: RunState): void {
  if (livingCats(state.ally).length === 0) {
    state.notice = "고양이를 최소 한 마리는 배치해야 합니다";
    return;
  }
  applySynergies(state);
  // 지난 전투에서 걸어나간 위치를 배치한 셀로 되돌린다. 이걸 빼먹으면
  // 다음 웨이브가 적진 한복판에서 시작한다.
  resetPositions(state);
  for (const c of state.ally) if (c) c.cooldown = c.atkInterval;
  for (const c of state.enemy) if (c) c.cooldown = c.atkInterval;
  state.battleElapsed = 0;
  state.phase = "battle";
  state.notice = "";
}

export function finishWave(state: RunState, won: boolean, reason: "wipe" | "timeout" = "wipe"): void {
  if (!won) {
    state.lossReason = reason;
    state.phase = "gameover";
    if (state.wave > state.best) {
      state.best = state.wave;
      state.recordBroken = true;
      saveBest(state.best);
    }
    state.notice = `${state.wave}웨이브 도달`;
    return;
  }

  state.gold += goldForWave(state.wave);
  state.wave += 1;
  // 죽은 고양이도 포함해 전원 완전 회복시킨다.
  // 사망에 영구 손실을 붙이면 한 번 밀린 판이 회복 불가능해져 재도전 동기가 죽는다.
  // 난이도는 적 성장 곡선으로만 조절한다. 이 전제로 밸런스를 측정했으므로
  // 여기에 생존 조건을 넣으려면 npm run sim 재측정이 필요하다.
  for (const c of state.ally) {
    if (!c) continue;
    c.alive = true;
    c.hp = c.maxHp;
    c.pose = "idle";
    c.poseTimer = 0;
    c.lunge = 0;
    c.flash = 0;
    const home = cellToField(c.side, c.cell);
    c.fx = home.fx;
    c.fy = home.fy;
  }
  buildEnemyWave(state);
  rollOffers(state);
  applySynergies(state);
  state.phase = "reward";
  state.notice = `웨이브 클리어! +${goldForWave(state.wave - 1)}생선`;
}

export function moveCat(state: RunState, from: number, to: number): void {
  if (from === to) return;
  const a = state.ally[from] ?? null;
  const b = state.ally[to] ?? null;
  state.ally[from] = b;
  state.ally[to] = a;
  if (a) {
    a.cell = to;
    const f = cellToField(a.side, to);
    a.fx = f.fx;
    a.fy = f.fy;
  }
  if (b) {
    b.cell = from;
    const f = cellToField(b.side, from);
    b.fx = f.fx;
    b.fy = f.fy;
  }
  applySynergies(state);
}

export function breedFor(id: number): Breed {
  return breedById(id);
}
