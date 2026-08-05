import { BALANCE } from "./balance.ts";
import { RELICS, type Relic } from "./relics.ts";
import { seedRng, shuffle } from "./rng.ts";
import { BREEDS, breedById } from "./breeds.ts";
import { BOSS_RADIUS, bossForWave } from "./bosses.ts";
import {
  type Intervention,
  BOARD_COLS,
  BOARD_ROWS,
  cellCol,
  CLASS_LABEL,
  cellRow,
  MANA_MAX,
  cellToField,
  emptyBoard,
  livingCats,
  type Board,
  type Breed,
  type Cat,
  type Side,
} from "./types.ts";
import {
  type EffectKey,
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

export type OfferKind = "recruit" | "upgrade" | "replace" | "relic";

export interface Offer {
  kind: OfferKind;
  cost: number;
  /**
   * 카드에 그릴 고양이. 강화면 대상 고양이, 영입·교체면 새로 올 고양이.
   * 예전에는 강화 오퍼에 이게 없어서, 보드가 꽉 차 강화 카드만 남는 순간부터
   * 카드에서 고양이 그림이 통째로 사라졌다.
   */
  breed?: Breed;
  /** upgrade·replace 대상 uid */
  targetUid?: string;
  /** relic 카드가 파는 유물 */
  relic?: Relic;
  label: string;
  /** 카드 두 번째 줄. 무엇을 하는 카드인지 */
  sublabel: string;
}

export interface RunState {
  phase: Phase;
  wave: number;
  gold: number;
  best: number;
  ally: Board;
  enemy: Board;
  synergies: SynergyRule[];
  /** 갱신 때 다시 뽑을 후보 전체 */
  synergyPool: SynergyRule[];
  activeSynergyIds: Set<string>;
  /** 항상 길이 3. 산 자리는 null로 비워 둔다 — 남은 카드가 넓어지지 않게. */
  offers: (Offer | null)[];
  /** 마지막 전투 결과 메시지 */
  notice: string;
  battleElapsed: number;
  /** 이번 런에서 최고 기록을 깼는지. 동점을 갱신으로 표시하지 않기 위해 따로 둔다. */
  recordBroken: boolean;
  /** 마지막 패배 사유. notice는 다른 문구로 덮이므로 따로 보관한다. */
  lossReason: "wipe" | "timeout" | null;
  /** 이 런의 난수 시드. 재현이 필요할 때 이 값만 있으면 된다. */
  seed: number;
  /**
   * 아직 처리되지 않은 플레이어 개입. stepBattle이 스텝당 하나씩 소비한다.
   *
   * 스텝당 하나로 제한하는 이유: 브라우저는 프레임당(~17ms) 들어오고 시뮬은
   * 100ms마다 돌므로, 제한이 없으면 봇이 한 틱에 무한히 밀어 넣어 사람과
   * 전혀 다른 것을 재게 된다.
   */
  pending: Intervention[];
  /** 남은 회피 횟수. 전투마다 초기화된다. */
  dodgeCharges: number;
  /** 이번 런에서 모은 유물. 조건을 채운 것만 보너스가 붙고 대가는 항상 붙는다. */
  relics: Relic[];
}

const BEST_KEY = "nyang-arena.best";
const SYNERGIES_PER_RUN = 3;

/**
 * 목표를 다시 뽑는 주기(웨이브).
 *
 * 5로 둔 이유: 웨이브 성격 주기도 5(마지막이 대장묘)라, 보스를 넘긴 직후에
 * 새 목표가 걸리는 리듬이 된다.
 *
 * 목표가 런 내내 고정이면, 한 번 달성한 뒤로는 배치를 다시 볼 이유가 없다.
 * 주기적으로 갈아주면 그때마다 구성과 배치를 다시 짜게 된다.
 */
const SYNERGY_REFRESH_EVERY = 5;

/**
 * 카드 다시 뽑기 비용.
 *
 * 카드가 세 장뿐이라 수입을 쓸 곳이 없었다. 측정해 보니 웨이브 6부터 잔액이
 * 8 → 14 → 21 → 29로 지수적으로 쌓였다. 리롤은 그 잉여를 선택지로 바꾼다.
 * "이 카드가 별로면 다시 뽑을까"가 매 웨이브 생기는 결정이다.
 */
export const REROLL_COST = 3;

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
  const base = BALANCE.goldBase + wave * BALANCE.goldPerWave;
  // 보스는 벽이 아니라 사건이어야 한다. 넘으면 그만한 보상이 있어야 다음 판을 계속한다.
  return Math.round(waveKind(wave) === "boss" ? base * 1.5 : base);
}

/**
 * 새로 온 고양이를 놓을 자리.
 *
 * 예전에는 빈 칸 중 가장 앞 인덱스에 놓았는데, 5x5에서 그건 뒷줄부터 채운다는
 * 뜻이라 근접이 여섯 칸을 걸어가는 일이 생겼다. 직업에 맞는 열을 먼저 고르고
 * 같은 열이면 가운데 행부터 채운다. 물론 플레이어가 다시 옮길 수 있다.
 */
export function bestFreeCell(board: Board, breed: Breed): number {
  const free: number[] = [];
  board.forEach((c, i) => {
    if (c === null) free.push(i);
  });
  if (free.length === 0) return -1;

  const mid = (BOARD_ROWS - 1) / 2;
  const wantsFront = breed.kind === "melee";
  free.sort((a, b) => {
    const ca = cellCol(a);
    const cb = cellCol(b);
    const colScore = wantsFront ? cb - ca : ca - cb;
    if (colScore !== 0) return colScore;
    return Math.abs(cellRow(a) - mid) - Math.abs(cellRow(b) - mid);
  });
  return free[0] ?? -1;
}

/** 이 웨이브에 데리고 있을 수 있는 고양이 수. 보드 칸이 아니라 이것이 진짜 제한이다. */
export function unitCap(wave: number): number {
  return Math.min(BALANCE.unitCapMax, BALANCE.unitCapBase + Math.floor(wave / BALANCE.unitCapEvery));
}

/** 웨이브를 넘길수록 살아남은 전원이 강해진다. 적의 전체 복리 성장에 대응하는 축. */
export function veterancyScale(wave: number): number {
  return Math.pow(BALANCE.veterancy, wave - 1);
}

/**
 * 웨이브 성격.
 *
 * 예전에는 적 구성이 BREEDS[(w*3+i*5) % 8]로 결정돼 매 웨이브 비슷했다.
 * 그래서 배치를 한 번 정하면 다시 손댈 이유가 없고 싸움 구도가 고정됐다.
 * 성격을 돌려가며 내면 "이번엔 어떻게 맞설까"가 매번 새로 생긴다.
 */
export type WaveKind = "mixed" | "rush" | "snipe" | "boss";

const WAVE_CYCLE: readonly WaveKind[] = ["mixed", "rush", "mixed", "snipe", "boss"];

export function waveKind(wave: number): WaveKind {
  return WAVE_CYCLE[(wave - 1) % WAVE_CYCLE.length] ?? "mixed";
}

export function waveKindInfo(k: WaveKind): { name: string; hint: string } {
  switch (k) {
    case "rush":
      return { name: "돌격대", hint: "전부 근접이다. 앞줄이 버텨야 한다" };
    case "snipe":
      return { name: "저격대", hint: "원거리가 많다. 빨리 붙어야 한다" };
    case "boss":
      return { name: "대장묘", hint: "수는 적지만 한 마리가 아주 강하다" };
    case "mixed":
      return { name: "혼성대", hint: "근접과 원거리가 섞여 있다" };
  }
}

/**
 * 런마다 0으로 되돌린다.
 *
 * uid는 battle.ts에서 **동점 처리 기준**으로 쓰인다 — 타겟 선택, 겹침 분리 축,
 * 행동 순서 셋 다. 그런데 이 카운터가 런 사이에 이어지면 두 번째 런의 고양이가
 * `c51`부터 시작해 문자열 비교 결과가 통째로 달라진다(`"c9" < "c51"`은 거짓).
 * 즉 "결정적으로 만든다"고 적어 둔 코드가 실제로는 프로세스에서 몇 번째 런이냐에
 * 따라 다르게 굴었다. 브라우저에서도 '다시 도전'을 누르면 동점 처리가 바뀐다.
 */
let uidSeq = 0;
function nextUid(): string {
  uidSeq += 1;
  // 자릿수를 맞춰야 문자열 비교가 생성 순서와 일치한다("c10" > "c2"가 되는 걸 막는다).
  return `c${String(uidSeq).padStart(4, "0")}`;
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
  const groups = shuffle([...byTrigger.values()]);
  const out: SynergyRule[] = [];
  const usedEffects = new Set<string>();

  for (const list of groups) {
    if (out.length >= SYNERGIES_PER_RUN) break;
    const shuffled = shuffle([...list]);
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
    radius: 0,
    telegraph: null,
    thresholdIdx: 0,
    moveLock: 0,
    side,
    cell,
    fx,
    fy,
    alive: true,
    pose: side === "ally" ? "idle" : "back",
    poseTimer: 0,
    lunge: 0,
    flash: 0,
    mana: 0,
    manaMax: MANA_MAX,
    castFlash: 0,
    stun: 0,
    dot: null,
    shield: 0,
    speedMul: 1,
    comboTarget: null,
    combo: 0,
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

/**
 * @param seed 없으면 시계에서 뽑는다. 시뮬은 런마다 결정적 시드를 넘겨
 *   같은 명령이 같은 수치를 내게 한다.
 */
export function newRun(seed?: number): RunState {
  const runSeed = seed ?? Date.now();
  seedRng(runSeed);
  uidSeq = 0;
  const pool = resolveSynergyPool();
  const state: RunState = {
    // 시작부터 상점을 연다. 예전에는 생선 8마리를 쥐여 주고 첫 전투가 끝날 때까지
    // 쓸 데가 없었다 — 자원이 있는데 쓸 수 없으면 자원이 아니라 장식이다.
    phase: "reward",
    wave: 1,
    gold: BALANCE.startGold,
    best: loadBest(),
    ally: emptyBoard(),
    enemy: emptyBoard(),
    synergies: pickSynergies(pool),
    synergyPool: pool,
    activeSynergyIds: new Set(),
    offers: [],
    notice: `생선 ${BALANCE.startGold}마리로 시작한다`,
    battleElapsed: 0,
    recordBroken: false,
    lossReason: null,
    seed: runSeed,
    pending: [],
    dodgeCharges: 0,
    relics: [],
  };

  // 시작 3마리. 2마리로 시작하면 웨이브 2를 넘기지 못한다.
  // 근접 둘과 원거리 하나를 섞어서 두 종류를 처음부터 보여준다.
  // 전부 근접으로 시작하면 '뒷줄 원거리' 목표가 1웨이브부터 달성 불가로 보인다.
  // 가운데 줄에 앞·중간·뒤로 하나씩 세운다. 근접이 앞, 원거리가 뒤라는 형태를
  // 보여주되 배치 목표는 한 칸씩 모자라게 둔다(앞줄 근접 1/2, 뒷줄 원거리 1/2).
  // 목표가 처음부터 달성돼 있으면 플레이어가 할 일이 없다.
  // 5x5 가운데 행(row 2)에 뒤·중간·앞으로 하나씩. 근접이 앞, 원거리가 뒤라는
  // 형태를 보여주되 배치 목표는 한 칸씩 모자라게 둔다.
  const starters = [BREEDS[0], BREEDS[3], BREEDS[6]].slice(0, BALANCE.starterCount);
  const startCells = [14, 12, 10];
  starters.forEach((b, i) => {
    if (!b) return;
    const cell = startCells[i] ?? 3 + i;
    state.ally[cell] = makeCat(b, "ally", cell);
  });

  buildEnemyWave(state);
  rollOffers(state);
  return state;
}

const MELEE_IDS = BREEDS.filter((b) => b.kind === "melee").map((b) => b.id);
const RANGED_IDS = BREEDS.filter((b) => b.kind === "ranged").map((b) => b.id);
/**
 * 돌격대는 전사만 낸다.
 *
 * 예전에는 "전부 근접"이라 도적이 섞였는데, 도적은 전투가 시작되자마자 우리
 * 뒷줄로 뛰어든다. 유닛이 셋뿐인 웨이브 2에서 그건 즉사였다(측정: W2에서만 42명).
 * 돌격은 전사가 하는 것이고, 암살자가 하는 건 돌격이 아니다.
 */
const WARRIOR_IDS = BREEDS.filter((b) => b.cls === "warrior").map((b) => b.id);

/**
 * 적 배치 순서.
 *
 * 예전에는 3x3 시절 인덱스(0~8)가 그대로 남아 있었다. 5x5로 바꾼 뒤에도 적이
 * **위쪽 두 행에만** 앉았고 아래 15칸은 한 번도 쓰이지 않았다. 우리 고양이는
 * 다섯 행에 흩어 놓을 수 있는데 적이 두 행에 몰려 있으면 세로 배치가 전투에
 * 거의 영향을 주지 않는다 — 측정된 "배치가 결정이 아니다"의 원인 중 하나다.
 *
 * 열 0이 우리와 가까운 앞줄이다. 행은 중앙(2)에서 바깥으로 퍼뜨려 한 덩어리로
 * 뭉치지 않게 한다. 뭉치면 광역기가 과도하게 잘 맞는다.
 */
const ROW_ORDER = [2, 1, 3, 0, 4] as const;

/** 한 열에 세울 최대 수. 넘기면 세로로 한 줄이 되어 광역기에 통째로 맞는다. */
const PER_COL = 3;

function enemyOrder(kind: WaveKind): number[] {
  const cols = kind === "snipe" ? [4, 3, 2, 1, 0] : [0, 1, 2, 3, 4];
  const near = ROW_ORDER.slice(0, PER_COL); // 중앙 세 행
  const far = ROW_ORDER.slice(PER_COL); // 바깥 두 행
  // 열마다 중앙 세 행을 먼저 채우고 다음 열로 넘어간다 → 두세 열짜리 덩어리가 된다.
  const out = cols.flatMap((c) => near.map((r) => r * BOARD_COLS + c));
  // 그래도 모자라면 바깥 행을 쓴다.
  out.push(...cols.flatMap((c) => far.map((r) => r * BOARD_COLS + c)));

  if (kind === "snipe") {
    // 호위 근접 둘은 앞줄(열 0)에 세워야 원거리가 뒤에서 쏠 수 있다.
    const escorts = [2 * BOARD_COLS + 0, 1 * BOARD_COLS + 0];
    return [...escorts, ...out.filter((c) => !escorts.includes(c))];
  }
  return out;
}

/** 웨이브 성격에 맞는 적 품종 목록을 뽑는다. */
function enemyBreedIds(kind: WaveKind, count: number, wave: number): number[] {
  const pick = (pool: number[], i: number) => pool[(wave * 3 + i * 5) % pool.length] ?? pool[0]!;
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    switch (kind) {
      case "rush":
        out.push(pick(WARRIOR_IDS, i));
        break;
      case "snipe":
        // 호위 근접 둘 + 나머지 원거리. 호위를 하나만 두면 사실상 전부 원거리가 되어
        // 아군 근접이 접근하는 내내 일방적으로 얻어맞는다(측정: 사망의 62%가 이 웨이브).
        out.push(i < 2 ? pick(MELEE_IDS, i) : pick(RANGED_IDS, i));
        break;
      case "boss":
      case "mixed":
        out.push(BREEDS[(wave * 3 + i * 5) % BREEDS.length]?.id ?? 1);
        break;
    }
  }
  return out;
}

/** 웨이브가 오를수록 적이 많아지고 스탯이 커진다. 성격에 따라 수와 배치가 달라진다. */
/**
 * 보스 웨이브: 3x3을 차지하는 한 마리 + 앞줄 호위.
 *
 * 호위를 붙이는 이유는 보스만 있으면 우리 원거리가 사거리 밖에서 할 일이 없기
 * 때문이다. 앞줄에 세워 근접이 먼저 부딪히게 한다.
 */
/**
 * 보스 강도가 첫 보스에서 후반까지 올라가는 정도(0~1).
 *
 * 체력과 광역 피해에 **같은** 램프를 쓴다. 하나만 램프를 걸면 첫 보스가
 * "두껍지만 안 아프다" 또는 "얇지만 즉사"가 되어 둘 다 학습에 나쁘다.
 */
export function bossRamp(wave: number): number {
  return Math.min(1, Math.max(0, (wave - 5) / BALANCE.bossHpRampWaves));
}

function buildBossWave(state: RunState, wave: number, scale: number): void {
  state.enemy = emptyBoard();

  const breed = bossForWave(wave);
  // 보드 한가운데(행 2, 열 2). 반경 1.5라 행 1~3 × 열 1~3을 덮는다.
  const bossCell = 2 * BOARD_COLS + 2;
  const boss = makeCat(breed, "enemy", bossCell);
  boss.radius = BOSS_RADIUS;
  // 첫 보스는 얇게, 후반으로 갈수록 두껍게. 고정 배수는 5웨이브를 벽으로 만든다.
  const ramp = bossRamp(wave);
  const hpMul = BALANCE.bossHpMulFirst + (BALANCE.bossHpMul - BALANCE.bossHpMulFirst) * ramp;
  boss.maxHp = Math.round(boss.maxHp * scale * hpMul);
  boss.hp = boss.maxHp;
  boss.atk = Math.round(boss.atk * scale * BALANCE.bossAtkMul);
  state.enemy[bossCell] = boss;

  const escortCells = ROW_ORDER.map((r) => r * BOARD_COLS + 0);
  const ids = enemyBreedIds("mixed", BALANCE.bossEscortCount, wave);
  for (let i = 0; i < BALANCE.bossEscortCount; i++) {
    const cell = escortCells[i];
    const id = ids[i];
    if (cell === undefined || id === undefined) break;
    const cat = makeCat(breedById(id), "enemy", cell);
    cat.maxHp = Math.round(cat.maxHp * scale);
    cat.hp = cat.maxHp;
    cat.atk = Math.round(cat.atk * scale);
    state.enemy[cell] = cat;
  }
}

export function buildEnemyWave(state: RunState): void {
  const w = state.wave;
  const kind = waveKind(w);
  const scale = Math.pow(BALANCE.enemyScale, w - 1);

  if (kind === "boss") {
    buildBossWave(state, w, scale);
    return;
  }

  let count = Math.min(unitCap(w), Math.ceil(w / BALANCE.enemyCountDivisor));
  let statBoost = 1;
  // 돌격대는 전부 근접이라 우리 원거리에게 일방적으로 씹혔다(사망의 1%).
  // 수나 스탯 대신 발을 빠르게 해서 이름값을 하게 한다 — 뒷줄까지 금방 닿는다.
  const speedMul = kind === "rush" ? 1.45 : 1;
  // 돌격대는 전부 근접이라는 것만으로 이미 다른 문제다. 수까지 늘리면 과했다.
  // 저격대는 원거리가 일방적으로 때리는 구간이 있어 같은 수라도 체감이 세다.
  if (kind === "snipe") count = Math.max(2, count - 1);
  state.enemy = emptyBoard();
  const order = enemyOrder(kind);
  const ids = enemyBreedIds(kind, count, w);

  for (let i = 0; i < count; i++) {
    const cell = order[i];
    const id = ids[i];
    if (cell === undefined || id === undefined) break;
    const breed = breedById(id);
    const cat = makeCat(breed, "enemy", cell);
    cat.maxHp = Math.round(cat.maxHp * scale * statBoost);
    cat.hp = cat.maxHp;
    cat.atk = Math.round(cat.atk * scale * statBoost);
    cat.speedMul = speedMul;
    state.enemy[cell] = cat;
  }
}

/** 시너지 판정용 보드 스냅샷. 배치(열)까지 포함해야 앞줄/뒷줄 조건을 볼 수 있다. */
export function boardUnits(state: RunState): BoardUnit[] {
  return livingCats(state.ally).map((c) => ({
    color: c.breed.color,
    breedId: c.breed.id,
    kind: c.breed.kind,
    col: cellCol(c.cell),
  }));
}

/** 유물 조건을 지금 팀이 채우고 있는가. */
export function relicActive(relic: Relic, cats: Cat[]): boolean {
  const c = relic.condition;
  switch (c.kind) {
    case "class_count":
      return cats.filter((x) => x.breed.cls === c.cls).length >= c.min;
    case "unit_max":
      return cats.length <= c.max;
    case "unit_min":
      return cats.length >= c.min;
    case "level_min":
      return cats.some((x) => x.level >= c.min);
    case "breed_variety":
      return new Set(cats.map((x) => x.breed.id)).size >= c.min;
  }
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

    const apply = (key: EffectKey, value: number) => {
      switch (key) {
        case "atk_mul":
          atk *= value;
          break;
        case "hp_mul":
          maxHp *= value;
          break;
        case "atkspd_mul":
          interval /= value;
          break;
        case "evade_add":
          evade += value;
          break;
      }
    };

    for (const s of state.synergies) {
      if (!state.activeSynergyIds.has(s.id)) continue;
      apply(s.effect.key, s.effect.value);
    }

    // 유물: 대가는 항상, 보너스는 조건을 채웠을 때만.
    // 조건을 못 맞추면 손해만 본다 — 그게 '질렀다'를 만드는 유일한 장치다.
    for (const r of state.relics) {
      apply(r.bane.key, r.bane.value);
      if (relicActive(r, cats)) apply(r.boon.key, r.boon.value);
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
 * 보상 카드 세 장.
 *
 * 보드가 꽉 차면 예전에는 강화 카드만 남았다. 그러면 후반 내내 "숫자 키우기"만
 * 남고 구성에 대한 선택이 사라진다 — 다 배치하고 나면 할 게 없다는 문제의 원인이다.
 * 자리가 없을 때는 **교체** 카드를 낸다. 무엇을 내보낼지가 새로운 결정이 된다.
 */
export const OFFER_SLOTS = 3;

export function rollOffers(state: RunState): void {
  const offers: Offer[] = [];
  const owned = state.ally.filter((c): c is Cat => c !== null);
  // 빈 칸이 아니라 보유 한도로 판단한다. 5x5에는 칸이 늘 남아 있다.
  const hasFreeSlot = owned.length < unitCap(state.wave);
  const pool = shuffle([...BREEDS]);

  if (hasFreeSlot) {
    for (const b of pool.slice(0, 2)) {
      offers.push({
        kind: "recruit",
        cost: b.cost,
        breed: b,
        label: b.name,
        sublabel: `${CLASS_LABEL[b.cls]} 영입`,
      });
    }
  } else {
    // 내보낼 대상은 투자가 가장 적은 고양이로 고정한다.
    // 무작위로 고르면 레벨 높은 애가 후보로 떠서 카드를 아예 안 누르게 된다.
    const weakest = [...owned].sort((a, b) => a.level - b.level || (a.uid < b.uid ? -1 : 1))[0];
    if (weakest) {
      // **교체는 한 장만.**
      //
      // 예전에는 만석일 때 교체 두 장 + 강화 한 장이 나왔다. 교체는 시너지
      // 적합도를 모르면 순손실이라 대부분 안 누르는 카드인데, 그게 후반 오퍼의
      // 절반을 차지해서 살 것이 없어졌다. 그동안 수입은 웨이브에 비례해 3배로
      // 늘어나니 생선이 남을 수밖에 없었다(측정: 후반 오퍼의 53%가 교체).
      //
      // 강화는 비용이 지수라(레벨 5면 17.7, 레벨 7이면 37) 후반 수입을 자연히
      // 흡수한다. 만석 이후의 주력은 강화이고 교체는 갈아타기 선택지로 남긴다.
      const b = pool.find((x) => x.id !== weakest.breed.id);
      if (b) {
        offers.push({
          kind: "replace",
          cost: b.cost,
          breed: b,
          targetUid: weakest.uid,
          label: b.name,
          sublabel: `${weakest.breed.name} 방출`,
        });
      }
    }
  }

  // 남은 칸을 강화로 채운다. 대상은 중복되지 않게 고른다.
  const shuffled = shuffle([...owned]);
  for (const target of shuffled) {
    if (offers.length >= OFFER_SLOTS) break;
    offers.push({
      kind: "upgrade",
      cost: upgradeCost(target.level),
      breed: target.breed,
      targetUid: target.uid,
      label: `${target.breed.name} Lv.${target.level + 1}`,
      sublabel: "강화",
    });
  }

  // 유물을 한 장 섞는다.
  //
  // 웨이브 3부터, 그리고 **세 웨이브에 한 번만** 나온다. 매 웨이브 내면 슬롯
  // 하나를 상시로 먹어 정상 구매를 밀어낸다 — 측정에서 유물을 안 사는 봇의
  // 평균이 12.9에서 8.6으로 떨어졌다. 유물은 가끔 오는 큰 결정이어야 한다.
  if (state.wave >= 3 && state.wave % 3 === 0) {
    const owned = new Set(state.relics.map((r) => r.id));
    const pick = shuffle(RELICS.filter((r) => !owned.has(r.id)))[0];
    if (pick) {
      offers.splice(Math.min(offers.length, 1), 0, {
        kind: "relic",
        cost: pick.cost,
        relic: pick,
        label: pick.name,
        sublabel: pick.want,
      });
    }
  }

  // 슬롯은 늘 세 칸. 모자라면 빈 칸으로 채운다.
  state.offers = Array.from({ length: OFFER_SLOTS }, (_, i) => offers[i] ?? null);
}

export function buyOffer(state: RunState, offer: Offer): boolean {
  if (state.gold < offer.cost) return false;

  if (offer.kind === "relic" && offer.relic) {
    // 같은 유물을 두 번 사면 대가만 두 배가 된다. 이미 있으면 걷어낸다.
    if (state.relics.some((r) => r.id === offer.relic!.id)) {
      state.offers = state.offers.map((o) => (o === offer ? null : o));
      return false;
    }
    state.relics.push(offer.relic);
  } else if (offer.kind === "recruit" && offer.breed) {
    const owned = state.ally.filter((c) => c !== null).length;
    const free = owned < unitCap(state.wave) ? bestFreeCell(state.ally, offer.breed) : -1;
    if (free < 0) {
      // 살 수 없는 카드를 목록에 남겨두면 무한히 재시도된다. 즉시 걷어낸다.
      state.offers = state.offers.map((o) => (o === offer ? null : o));
      state.notice = "더 데리고 있을 수 없습니다";
      return false;
    }
    state.ally[free] = makeCat(offer.breed, "ally", free);
  } else if (offer.kind === "replace" && offer.targetUid && offer.breed) {
    const idx = state.ally.findIndex((c) => c?.uid === offer.targetUid);
    if (idx < 0) {
      state.offers = state.offers.map((o) => (o === offer ? null : o));
      return false;
    }
    // 자리를 그대로 물려받는다. 배치를 다시 짤 필요가 없어 교체가 부담스럽지 않다.
    state.ally[idx] = makeCat(offer.breed, "ally", idx);
  } else if (offer.kind === "upgrade" && offer.targetUid) {
    const cat = state.ally.find((c) => c?.uid === offer.targetUid);
    if (!cat) return false;
    cat.level += 1;
  } else {
    return false;
  }

  state.gold -= offer.cost;
  state.offers = state.offers.map((o) => (o === offer ? null : o));
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

/** 카드를 다시 뽑는다. 생선이 모자라면 아무 일도 없다. */
export function rerollOffers(state: RunState): boolean {
  if (state.gold < REROLL_COST) {
    state.notice = "생선이 부족합니다";
    return false;
  }
  state.gold -= REROLL_COST;
  rollOffers(state);
  state.notice = "";
  return true;
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
  for (const board of [state.ally, state.enemy]) {
    for (const c of board) {
      if (!c) continue;
      c.cooldown = c.atkInterval;
      // 마나와 상태이상은 전투마다 초기화한다. 지난 판의 도트가 남으면 안 된다.
      c.mana = 0;
      c.stun = 0;
      c.dot = null;
      c.shield = 0;
      c.castFlash = 0;
      c.comboTarget = null;
      c.combo = 0;
      c.moveLock = 0;
    }
  }
  // 개입 상태는 전투마다 초기화한다. 남아 있으면 다음 전투 첫 틱에 한꺼번에 터진다.
  state.pending.length = 0;
  state.dodgeCharges = waveKind(state.wave) === "boss" ? BALANCE.dodgeCharges : 0;
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
    c.mana = 0;
    c.stun = 0;
    c.dot = null;
    c.shield = 0;
    c.castFlash = 0;
    const home = cellToField(c.side, c.cell);
    c.fx = home.fx;
    c.fy = home.fy;
  }
  let refreshed = false;
  if ((state.wave - 1) % SYNERGY_REFRESH_EVERY === 0) {
    state.synergies = pickSynergies(state.synergyPool);
    refreshed = true;
  }

  buildEnemyWave(state);
  rollOffers(state);
  applySynergies(state);
  state.phase = "reward";
  state.notice = refreshed
    ? "새 목표가 걸렸습니다"
    : `웨이브 클리어! +${goldForWave(state.wave - 1)}생선`;
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
