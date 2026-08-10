import { BALANCE } from "./balance.ts";
import { RELICS, type Relic } from "./relics.ts";
import {
  BOSSES_PER_STAGE,
  bossOrdinalInStage,
  isBossStep,
  makeStage,
  openLanes,
  STAGE_STEPS,
  type NodeKind,
  type StageMap,
} from "./map.ts";
import { seedRng, shuffle } from "./rng.ts";
import { BREEDS, NIGHTMARE_BREEDS, breedById } from "./breeds.ts";
import { BOSS_RADIUS, bossForIndex, bossKit, SNIPER_BREED, SNIPER_RADIUS } from "./bosses.ts";
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

export type Phase = "prepare" | "battle" | "reward" | "map" | "gameover";

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

  /**
   * 부검용 기록.
   *
   * 죽는 화면이 숫자 하나로 끝나면 12분을 쓰고도 "다음엔 뭘 다르게 하지"에
   * 답이 안 나온다. 이 게임에서 가장 큰 결정 축이 개입(+27%p)이므로 예고
   * 성적이 첫 줄이고, 판이 끝나는 이유의 41%가 보스이므로 누구에게 막혔는지가
   * 둘째 줄이다.
   */
  telegraphsSeen: number;
  telegraphsEaten: number;

  /**
   * 여정 지도.
   *
   * 걸음 번호를 따로 두지 않는다 — `wave`에서 뽑는다. 둘을 각각 들고 있으면
   * 언젠가 어긋나고, 어긋나면 보스가 지도에 없는 자리에서 튀어나온다.
   * 그래서 걸음 = (wave-1) % STAGE_STEPS, 스테이지 = floor((wave-1)/6)+1이다.
   */
  map: StageMap;
  /**
   * 지도에서 몇 번째 걸음인가(0..STAGE_STEPS-1).
   *
   * `wave`에서 뽑던 것을 갈라냈다. **wave는 싸운 횟수**(난이도 시계이자 점수)고
   * **step은 지도 위의 위치**다. 상점 칸은 걸음만 먹고 웨이브는 안 먹는다 —
   * 붙여 두면 상점이 위험 없이 점수를 올려서 언제나 최선이 된다(측정에서
   * 상점 몰빵이 전투만보다 1.3웨이브 앞섰다. 그건 선택이 아니라 정답이다).
   */
  step: number;
  /** 이번 걸음에 고른 칸의 성격. 적 편성과 회피 횟수가 이걸 본다. */
  nodeKind: NodeKind | null;
  nodeWave: WaveKind | null;
  /** 상점 노드가 주는 무료 재추첨. 생선을 안 쓰고 카드를 더 본다. */
  freeRerolls: number;
  /**
   * 다음 보스전에서만 쓰는 여분 회피.
   *
   * 지도가 결정이 아니었던 이유는 자원이 생선 하나뿐이라 모든 선택이 "더 벌까
   * 덜 쓸까"로 수렴했기 때문이다. 이건 **생선으로 바꿀 수 없고** 다음 보스가
   * 지나면 사라진다 — 환전도 저축도 안 되는 자원이라야 경로가 산수가 아닌
   * 판단이 된다.
   */
  bonusDodge: number;
  /** 다음 카드 묶음에 유물을 반드시 한 장 섞는다. 정예 보상. */
  forceRelic: boolean;
  /** 마지막에 나를 막은 것. 보스면 이름과 남은 체력이 함께 뜬다. */
  killer: { name: string; hpFrac: number; boss: boolean } | null;
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

export function goldForWave(wave: number, kind: WaveKind | null = null): number {
  const base = BALANCE.goldBase + wave * BALANCE.goldPerWave;
  // 보스는 벽이 아니라 사건이어야 한다. 넘으면 그만한 보상이 있어야 다음 판을 계속한다.
  if (kind === "boss") return Math.round(base * 1.5);
  // 정예(저격대)는 통과율이 낮다. 위험을 산 값을 해야 고르는 이유가 생긴다.
  if (kind === "snipe") return Math.round(base * BALANCE.eliteGoldMul);
  return Math.round(base);
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

/* 웨이브 번호로 성격을 정하던 `WAVE_CYCLE`은 지웠다. 이유는 `currentKind` 참고. */

/**
 * 지금 걸음과 스테이지. `wave` 하나에서 뽑는다.
 *
 * 걸음 번호를 따로 들고 있으면 언젠가 어긋나고, 어긋나면 보스가 지도에 없는
 * 자리에서 튀어나온다. 파생값으로 두면 그 버그가 애초에 존재할 수 없다.
 */
export function mapStep(state: RunState): number {
  return state.step;
}

/**
 * 이번 전투의 성격.
 *
 * 보스 자리는 걸음이 정하고(세 걸음마다), 나머지 걸음의 성격은 고른 칸에서 온다.
 *
 * **웨이브 번호는 여기에 못 들어온다.** 상점 칸이 걸음만 먹고 웨이브는 안 먹으므로
 * 둘은 반드시 갈라지고, 갈라지면 보스가 지도에 없는 자리에서 튀어나온다.
 * 이 게임에서 "지금 무엇과 싸우는가"의 유일한 답이 이 함수다.
 */
export function currentKind(state: RunState): WaveKind {
  if (isBossStep(state.step)) return "boss";
  return state.nodeWave ?? "mixed";
}

/**
 * 지금 걸음에 설 보스가 이 런에서 몇 번째인가 (0부터).
 *
 * **보스 신원의 유일한 출처다.** 예전에는 셋이 따로 계산했다 —
 * 스폰은 `bossIndexForWave(wave)`, 지도 라벨은 `bossesSeen(s) + 앞의 보스 수 - 1`,
 * 호버 설명은 `bossesSeen(s)`. 상점을 세 번 밟은 여정에서 웨이브가 걸음보다
 * 뒤처져 스폰 인덱스가 되감겼고, **한 여정에 무쇠발톱이 두 번 나왔다.**
 * 지나간 보스 칸의 라벨도 걸음이 진행되면 다음 보스 이름으로 바뀌어 있었다.
 */
export function bossIndexAt(state: RunState, step: number = state.step): number {
  return (state.map.stage - 1) * BOSSES_PER_STAGE + Math.max(0, bossOrdinalInStage(step));
}

/** 이 런에서 지금까지 만난 보스 수. 난이도 램프가 이걸 본다. */
export function bossesSeen(state: RunState): number {
  const perStage = 2;
  /**
   * **넘은 것만 센다.** 보스는 2·5걸음인데 `>=`로 세면 그 칸에 **도착한 순간**
   * 넘은 것으로 계산돼, 싸우기도 전에 "악몽을 밀어냈어요" 막이 올라갔다.
   * 걸음은 칸을 고를 때 오르므로, 지나간 것은 `> 보스 걸음`이다.
   */
  const done = state.step > 5 ? 2 : state.step > 2 ? 1 : 0;
  return (state.map.stage - 1) * perStage + done;
}

/**
 * 지도에서 한 칸을 고른다.
 *
 * 상점 칸은 싸우지 않으므로 그 자리에서 보상을 주고 곧장 상점 화면으로 간다.
 * 그래도 **웨이브는 하나 지나간다** — 그게 상점의 대가다. 적은 웨이브마다
 * 복리로 세지므로, 힘을 사는 동안 상대도 세진다.
 */
export function chooseNode(state: RunState, idx: number): boolean {
  const step = mapStep(state);
  if (!openLanes(state.map, step).includes(idx)) return false;
  const node = state.map.steps[step]?.[idx];
  if (!node) return false;

  state.map.taken[step] = idx;
  state.nodeKind = node.kind;
  state.nodeWave = node.wave;

  if (node.kind === "shop") {
    // 싸우지 않고 힘만 사는 자리. 생선과 무료 재추첨을 주고 웨이브를 넘긴다.
    state.gold += BALANCE.shopNodeGold;
    state.freeRerolls += 1;
    // 환전되지 않는 자원. 이것 때문에 이 길을 고르는 것이지 생선 때문이 아니다.
    state.bonusDodge += BALANCE.scoutDodgeBonus;
    // 걸음만 먹고 웨이브는 그대로다. 보스는 같은 걸음에 오므로 **덜 싸운 팀으로**
    // 보스를 만나게 된다 — 그게 안 싸우고 얻는 것의 대가다.
    state.step += 1;
    syncStage(state);
    rollOffers(state);
    state.phase = "reward";
    state.notice = "쉬어 가는 길이에요 — 생선과 다시 뽑기를 챙겼어요";
    return true;
  }

  /**
   * **고른 뒤에** 상대를 만들고, 그 상대를 보면서 산다.
   *
   * 한 걸음의 순서가 길 → 적 → 구매 → 배치다. 예전에는 구매가 맨 앞이었는데,
   * 그러면 **무엇과 싸울지 모르는 채로** 사게 된다. 저격대가 오는데 원거리를
   * 사고, 돌격대가 오는데 앞줄이 비는 일이 그래서 생겼다. 상대를 먼저 보여
   * 주면 같은 카드가 판마다 다른 값을 갖는다.
   */
  buildEnemyWave(state);
  rollOffers(state);
  state.phase = "reward";
  // 길목은 안내를 비운다. 매 걸음 같은 말이 뜨면 글자가 배경이 되고,
  // 그러면 정작 알려야 할 때(정예·경고) 아무도 안 읽는다.
  state.notice = node.kind === "elite" ? "만만치 않아요. 이기면 유물을 남기고 가요" : "";
  return true;
}

/**
 * 상점을 나선다.
 *
 * 정찰 칸은 싸우지 않으므로 다시 지도로 돌아가고, 나머지는 배치로 간다.
 * **브라우저와 측정 하네스가 같은 함수를 부른다** — 이 전이를 main.ts에
 * 인라인으로 두었더니 스크립트가 옛 순서를 재고 있던 적이 있다(bot-policy의
 * walkMap 주석 참고). 국면 전이는 전부 여기 있어야 한다.
 */
export function leaveShop(state: RunState): void {
  if (state.phase !== "reward") return;
  if (state.nodeKind === "shop") {
    // 정찰은 걸음만 먹었다(chooseNode에서 이미 step을 넘겼다). 다음 갈림길로.
    state.phase = "map";
    state.notice = "";
    return;
  }
  state.phase = "prepare";
  state.notice = "근접은 앞줄, 원거리는 뒷줄";
}

/** 스테이지 경계를 넘었으면 새 지도를 만든다. */
export function syncStage(state: RunState): void {
  if (state.step < STAGE_STEPS) return;
  state.step = 0;
  state.map = makeStage(state.map.stage + 1);
}

export function waveKindInfo(k: WaveKind): { name: string; hint: string } {
  switch (k) {
    case "rush":
      return { name: "달려드는 것들", hint: "전부 발로 달려들어요" };
    case "snipe":
      return { name: "멀리서 노리는 것들", hint: "떨어져서 노려요. 빨리 붙는 게 좋아요" };
    case "boss":
      return { name: "대장묘", hint: "수는 적지만 하나가 아주 무서워요" };
    case "mixed":
      return { name: "뒤섞인 것들", hint: "앞뒤가 고루 섞여 있어요" };
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
    vulnerableMs: 0,
    strikeCombo: 0,
    vulnerableUsed: false,
    moveLock: 0,
    dash: null,
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
    /**
     * **지도부터 연다.**
     *
     * 예전에는 상점에서 시작했다. 생선 8마리를 쥐여 주고 첫 전투가 끝날 때까지
     * 쓸 데가 없던 것보다는 나았지만, 무엇과 싸울지 모르는 채로 사는 것은
     * 마찬가지였다. 이제 한 걸음의 순서는 **길 → 적 → 구매 → 배치**이고,
     * 첫 걸음이라고 예외를 두면 그 판만 순서가 다르다.
     *
     * 첫 걸음이 전부 전투라 고를 것이 없어 보이지만, 어느 갈래로 가느냐가
     * 다음 걸음의 선택지를 정한다(`openLanes`). 빈 선택이 아니다.
     */
    phase: "map",
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
    telegraphsSeen: 0,
    telegraphsEaten: 0,
    map: makeStage(1),
    step: 0,
    nodeKind: null,
    nodeWave: null,
    freeRerolls: 0,
    bonusDodge: 0,
    forceRelic: false,
    killer: null,
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

  // 적도 카드도 여기서 만들지 않는다. `chooseNode`가 길을 고른 뒤에 만든다 —
  // 시작 화면이 지도이므로 그 전에 만들어 두면 고르기 전에 정해진 상대가 된다.
  return state;
}

/*
 * 적 명단은 전부 `NIGHTMARE_BREEDS`에서 온다. 우리 고양이와 한 마리도 겹치지 않는다.
 *
 * 그 배열은 `BREEDS`와 index별로 직업·스탯·스킬이 같게 맞춰져 있으므로, 아래
 * 세 풀도 예전과 같은 순서·같은 스탯이 된다 — 바뀌는 것은 누구로 보이는가뿐이다.
 */
const MELEE_IDS = NIGHTMARE_BREEDS.filter((b) => b.kind === "melee").map((b) => b.id);
const RANGED_IDS = NIGHTMARE_BREEDS.filter((b) => b.kind === "ranged").map((b) => b.id);
/**
 * 돌격대는 전사만 낸다.
 *
 * 예전에는 "전부 근접"이라 도적이 섞였는데, 도적은 전투가 시작되자마자 우리
 * 뒷줄로 뛰어든다. 유닛이 셋뿐인 웨이브 2에서 그건 즉사였다(측정: W2에서만 42명).
 * 돌격은 전사가 하는 것이고, 암살자가 하는 건 돌격이 아니다.
 */
const WARRIOR_IDS = NIGHTMARE_BREEDS.filter((b) => b.cls === "warrior").map((b) => b.id);

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
        out.push(NIGHTMARE_BREEDS[(wave * 3 + i * 5) % NIGHTMARE_BREEDS.length]?.id ?? 20);
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
 * **보스 순번으로 잰다.** 웨이브로 재면 주기를 바꿀 때마다 어긋난다 — 보스를
 * 5웨이브마다에서 3웨이브마다로 옮겼더니 첫 보스가 3웨이브에 서면서 후반용
 * 배수를 그대로 맞아 통과율이 40%로 떨어졌다.
 *
 * 체력·평타·광역 피해가 **같은 램프**를 써야 한다. 하나만 램프를 걸면 첫 보스가
 * "두껍지만 안 아프다" 또는 "얇지만 즉사"가 되어 둘 다 학습에 나쁘다. 그런데
 * 실제로 갈라져 있었다 — 체력은 `bossRamp(wave)`(첫 보스 0), 광역은
 * `bossesSeen`(첫 보스 0.125)을 보고 있었다. `bossesSeen`은 지금 서 있는 보스도
 * "만났다"고 세므로 보스 자리에서 한 칸 앞선다. 순번 자체를 쓰면 첫 보스가
 * 정확히 0이고, 그게 `bossHpMulFirst`·`telegraphDmgFirst`가 가정하는 값이다.
 */
export function bossRampFor(state: RunState, step: number = state.step): number {
  return Math.min(1, bossIndexAt(state, step) / BALANCE.bossRampCount);
}

function buildBossWave(state: RunState, wave: number, scale: number): void {
  state.enemy = emptyBoard();

  const breed = bossForIndex(bossIndexAt(state));
  // 보드 한가운데(행 2, 열 2). 반경 1.5라 행 1~3 × 열 1~3을 덮는다.
  const bossCell = 2 * BOARD_COLS + 2;
  const boss = makeCat(breed, "enemy", bossCell);
  boss.radius = BOSS_RADIUS;
  // 첫 보스는 얇게, 후반으로 갈수록 두껍게. 고정 배수는 5웨이브를 벽으로 만든다.
  const ramp = bossRampFor(state);
  const hpMul = (BALANCE.bossHpMulFirst + (BALANCE.bossHpMul - BALANCE.bossHpMulFirst) * ramp) * bossKit(breed.id).power;
  boss.maxHp = Math.round(boss.maxHp * scale * hpMul);
  boss.hp = boss.maxHp;
  // 평타도 체력과 같은 램프를 탄다. 고정값이면 첫 보스가 벽이 되고, 그러면
  // 탱킹을 살리려던 것이 판을 끝내 버린다.
  const atkMul = BALANCE.bossAtkMulFirst + (BALANCE.bossAtkMul - BALANCE.bossAtkMulFirst) * ramp;
  boss.atk = Math.round(boss.atk * scale * atkMul);
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
  // 지도에서 고른 칸이 성격을 정한다. 보스 자리만 웨이브 번호가 정한다.
  const kind = currentKind(state);
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

  // 저격 웨이브에는 저격수 하나를 뒷줄 가운데 세운다.
  //
  // 이 웨이브는 통과율로는 두 번째 벽이었는데(88%) 플레이어가 할 수 있는 게
  // 없었다 — 원거리가 많아 일방적으로 맞는 구간일 뿐이었다. 저격수가 서면
  // 세 웨이브 뒤에 올 보스의 동작(예고 → 회피)을 낮은 대가로 먼저 가르친다.
  if (kind === "snipe") {
    const cell = 2 * BOARD_COLS + (BOARD_COLS - 1);
    const sniper = makeCat(SNIPER_BREED, "enemy", cell);
    sniper.radius = SNIPER_RADIUS;
    sniper.maxHp = Math.round(sniper.maxHp * scale * BALANCE.sniperHpMul);
    sniper.hp = sniper.maxHp;
    sniper.atk = Math.round(sniper.atk * scale);
    state.enemy[cell] = sniper;
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
        sublabel: `${CLASS_LABEL[b.cls]} 데려오기`,
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
          sublabel: `${weakest.breed.name} 내보내기`,
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
      // 강화는 생선을 먹여서 크는 것이다. '강화'는 시스템 말이고, 화면에서
      // 하는 일은 밥을 주는 것이다.
      sublabel: "밥 주기",
    });
  }

  // 유물을 한 장 섞는다.
  //
  // 웨이브 3부터, 그리고 **세 웨이브에 한 번만** 나온다. 매 웨이브 내면 슬롯
  // 하나를 상시로 먹어 정상 구매를 밀어낸다 — 측정에서 유물을 안 사는 봇의
  // 평균이 12.9에서 8.6으로 떨어졌다. 유물은 가끔 오는 큰 결정이어야 한다.
  // 정예를 넘었으면 주기와 무관하게 한 장 낸다. 그게 정예를 고르는 이유다.
  if (state.forceRelic || (state.wave >= 3 && state.wave % 3 === 0)) {
    state.forceRelic = false;
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
      state.notice = "자리가 다 찼어요";
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
  // 상점 칸이 준 무료 횟수를 먼저 쓴다. 생선을 아끼는 게 아니라 카드를 더
  // 보라고 준 것이므로, 있을 때 안 쓰면 그 보상이 사라진 것과 같다.
  if (state.freeRerolls > 0) {
    state.freeRerolls -= 1;
    rollOffers(state);
    state.notice = "";
    return true;
  }
  if (state.gold < REROLL_COST) {
    state.notice = "생선이 조금 모자라요";
    return false;
  }
  state.gold -= REROLL_COST;
  rollOffers(state);
  state.notice = "";
  return true;
}

export function startBattle(state: RunState): void {
  if (livingCats(state.ally).length === 0) {
    state.notice = "한 마리는 세워주세요";
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
      c.vulnerableMs = 0;
      c.strikeCombo = 0;
      c.vulnerableUsed = false;
    }
  }
  // 개입 상태는 전투마다 초기화한다. 남아 있으면 다음 전투 첫 틱에 한꺼번에 터진다.
  state.pending.length = 0;
  const wk = currentKind(state);
  state.dodgeCharges =
    wk === "boss" ? BALANCE.dodgeCharges : wk === "snipe" ? BALANCE.sniperDodgeCharges : 0;
  if (wk === "boss" && state.bonusDodge > 0) {
    // 얹고 곧바로 비운다. 다음 보스까지 들고 가면 저축이 되고, 저축되는 자원은
    // 결국 생선과 같은 성질이 된다.
    state.dodgeCharges += state.bonusDodge;
    state.bonusDodge = 0;
  }
  state.battleElapsed = 0;
  state.phase = "battle";
  state.notice = "";
}

export function finishWave(state: RunState, won: boolean, reason: "wipe" | "timeout" = "wipe"): void {
  if (!won) {
    state.lossReason = reason;
    state.phase = "gameover";
    // 살아남은 적 중 가장 위협적인 것 — 보스가 있으면 보스, 없으면 체력이
    // 가장 많이 남은 쪽. 이 판을 끝낸 것이 무엇인지가 부검의 첫 문장이다.
    const alive = livingCats(state.enemy);
    const boss = alive.find((c) => c.radius > 0);
    const worst = boss ?? [...alive].sort((a, b) => b.hp / b.maxHp - a.hp / a.maxHp)[0];
    state.killer = worst
      ? { name: worst.breed.name, hpFrac: worst.hp / worst.maxHp, boss: worst.radius > 0 }
      : null;
    if (state.wave > state.best) {
      state.best = state.wave;
      state.recordBroken = true;
      saveBest(state.best);
    }
    state.notice = `${state.wave}웨이브 도달`;
    return;
  }

  const kind = state.nodeKind;
  state.gold += goldForWave(state.wave, currentKind(state));
  /**
   * 정예를 넘으면 **유물을 그 자리에서 준다.**
   *
   * 처음엔 다음 카드 묶음에 유물을 한 장 끼우게 했는데, 측정에서 정예 몰빵이
   * 전투만과 같은 자리(11.1 vs 11.2)에 도착했다. 이유는 카드가 유물이어도
   * **살 수 있는 유물이 아니었기** 때문이다 — 생선이 모자라거나 조건을 못 채워
   * 그냥 지나가는 카드가 됐다. 위험은 실제인데 보상은 확률이었다.
   *
   * 조건을 이미 채운 것부터 준다. 남는 게 없으면 아무거나 — 유물은 대가가
   * 늘 붙으므로 공짜라고 순수 이득이 아니다.
   */
  if (kind === "elite") {
    const owned = new Set(state.relics.map((r) => r.id));
    const pool = RELICS.filter((r) => !owned.has(r.id));
    const cats = livingCats(state.ally);
    const fit = pool.filter((r) => relicActive(r, cats));
    const pick = shuffle(fit.length > 0 ? fit : pool)[0];
    if (pick) {
      state.relics.push(pick);
      state.notice = `정예 격파 — ${pick.name}`;
    }
  }
  state.wave += 1;
  state.step += 1;
  // 걸음이 한 바퀴 돌았으면 새 지도를 만든다.
  syncStage(state);
  state.nodeKind = null;
  state.nodeWave = null;
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

  // 적도 카드도 여기서 만들지 않는다.
  //
  // 순서가 거꾸로였다 — 전투가 끝나자마자 다음 적을 만들어 두고, 그 뒤에 지도를
  // 고르게 했다. 그러면 **무엇을 골라도 이미 정해진 적과 싸운다.** 정예를 골랐는데
  // 평범한 무리가 나오고, 배치 화면에서 본 적이 실제로 나올 적이 아니었다.
  //
  // 둘 다 `chooseNode`가 만든다. 골라야 상대가 정해지고, 상대를 보고 산 다음,
  // 산 것을 배치한다.
  applySynergies(state);
  state.phase = "map";
  state.notice = refreshed
    ? "새 목표가 생겼어요"
    : `한 걸음 넘었어요 · 생선 +${goldForWave(state.wave - 1, kind === "elite" ? "snipe" : kind === "boss" ? "boss" : null)}`;
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
