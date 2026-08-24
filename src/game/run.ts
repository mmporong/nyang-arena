import { BALANCE } from "./balance.ts";
import { RELICS, type Relic } from "./relics.ts";
import {
  BOSSES_PER_STAGE,
  bossOrdinalInStage,
  isBossStep,
  isRaidPrepStep,
  makeStage,
  openLanes,
  STAGE_STEPS,
  type NodeKind,
  type StageMap,
} from "./map.ts";
import { mixSeed, seedRng, shuffle } from "./rng.ts";
import { BREEDS, NIGHTMARE_BREEDS, breedById } from "./breeds.ts";
import { BOSS_BREEDS, BOSS_RADIUS, bossForIndex, bossKit, SNIPER_BREED, SNIPER_RADIUS } from "./bosses.ts";
import { raidContractById, raidContractOffers, raidPrepRoute } from "./raid.ts";
import type { RaidContract } from "../validate/raid-contract-schema.ts";
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
  type Difficulty,
  type EffectKey,
  isTriggered,
  PRESET_SYNERGIES,
  scaleEffectForDifficulty,
  TRIGGERS,
  triggerDifficulty,
  type Trigger,
  validateAll,
  type BoardUnit,
  type SynergyRule,
} from "../validate/synergy-schema.ts";
// import attribute를 붙여야 Vite와 Node 양쪽에서 같은 모듈이 로드된다.
// (밸런스 하네스가 이 모듈을 Node에서 직접 임포트한다)
import generated from "../data/synergies.json" with { type: "json" };

export type Phase = "prepare" | "battle" | "reward" | "map" | "gameover";

/**
 * `notice`의 성격. 지금은 "보스 처치"만 다르게 그린다(render.ts의 drawNotice).
 *
 * 문구 접두("보스 처치!"로 시작하는지)로 갈랐다면 나중에 카피를 다듬을 때
 * 이 스타일이 아무 신호 없이 빠진다. 필드를 따로 둬서 문구와 스타일을 분리한다.
 */
export type NoticeKind = "normal" | "boss";

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
  /** notice의 성격. `setNotice`가 항상 같이 정한다. */
  noticeKind: NoticeKind;
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
  /**
   * 개입 버튼이 다시 살아나기까지 남은 시간(ms).
   *
   * 연타로 자원이 새지는 않지만(달리는 중인 고양이는 다시 세지 않는다) 버튼이
   * 무한히 눌리면 무엇을 눌렀는지가 손에 안 남는다. 한 번 누르면 잠깐 잠긴다.
   *
   * **약점 공격에는 안 걸린다.** 취약 창은 연타가 곧 화력이라(창 3초에 최대
   * 30타) 1초를 걸면 3타가 되어 창 자체가 무의미해진다. 잠기는 것은 차지를
   * 쓰는 회피·뭉침뿐이다.
   */
  actCooldown: number;
  /** 이번 런에서 모은 유물. 조건을 채운 것만 보너스가 붙고 대가는 항상 붙는다. */
  relics: Relic[];
  /** 보스를 이겨 다음 보상 화면에서 전용 유물 드래프트를 먼저 열어야 하는가. */
  relicDraftPending: boolean;
  /** 현재 보상 카드 세 장이 일반 상점이 아니라 유물 택1 묶음인가. */
  relicDraftActive: boolean;
  /**
   * 이번 전투에만 존재하는 소환수. 전투가 끝나면 통째로 비운다.
   *
   * **보드가 아니라 여기 산다.** 아군 보드에 넣으면 보유 한도(10)를 먹고,
   * 강화 대상으로 잡히고, 시너지·유물 조건 집계에 섞이고, 전멸 판정을
   * 막는다 — `livingCats(state.ally)`를 부르는 곳이 게임과 하네스를 합쳐
   * 24군데다. 전투 계산만 `allyBodies()`로 명시적으로 합친다.
   */
  summons: Cat[];

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
   * 취약 창이 열린 채로 예고가 터진 횟수, 그리고 그중 실제로 피한 횟수.
   *
   * `battle.ts`의 tickBoss가 취약 창 동안에도 문턱 예고를 계속 진행하게
   * 되면서([2]) 회피/집결과 약점 공격이 같은 순간에 부딪힐 수 있게 됐다.
   * 얼마나 자주 겹치고 그때 얼마나 지켜냈는지가 이 축의 값을 재는 숫자다 —
   * 판정에는 관여하지 않는 순수 부검용 카운터다.
   */
  vulnOverlapSeen: number;
  vulnOverlapDodged: number;
  /**
   * 극성(polarity)에서 플레이어가 회피 대신 **집결을 직접 골랐던** 횟수(C1).
   *
   * 자동(`act`)은 극성을 늘 산개로 근사하므로 이 카운터를 안 늘린다 — 화면·
   * 키보드가 `dodge`·`gather`를 직접 큐에 넣을 때만 는다(`resolveIntent`).
   * 0보다 크다는 것 자체가 "수동 선택이 실제로 쓰였다"는 증거이고, 그
   * 전후로 `telegraphsEaten`이 얼마나 갈리는지를 견줘 수동 선택의 값을 잰다.
   */
  polarityChoices: number;
  /**
   * 표식(seize, US-403)이 걸린 횟수와 그중 구원에 성공한 횟수.
   *
   * 구원 성공률(`seizeRescued / seizeMarked`)이 이 기믹의 값을 재는 숫자다.
   * `battle.ts`의 `makeTelegraph`가 표식을 걸 때 `seizeMarked`를,
   * `fireTelegraph`의 seize 분기가 구원에 성공했을 때만 `seizeRescued`를
   * 늘린다 — 표식냥이 판정 전에 다른 이유로 죽으면 분모만 늘고 분자는 안
   * 늘어 "구원 못 함"으로 잡힌다(의도된 계산이다).
   */
  seizeMarked: number;
  seizeRescued: number;
  /**
   * 최종 국면(finalPhase, US-404)을 이미 한 번 썼는가.
   *
   * 서리귀는 스테이지 3뿐 아니라 테마 순환상 6·9…에서도 다시 스테이지
   * 우두머리로 선다(`scripts/invariants.mjs`의 SNAP 계약 참고) — 이 문이
   * 없으면 "지는 것이 연출"이 서리귀를 만날 때마다 반복돼 첫 등장의 무게가
   * 사라진다. `battle.ts`의 `finalPhaseEligible`이 트리거 **시작 시점**에
   * 바로 참으로 올려, 같은 판에서 다시는 열리지 않는다.
   */
  finalPhaseUsed: boolean;

  /** 현재 여정 지도. stage·step·wave의 정합은 invariants가 매 전이에서 검사한다. */
  map: StageMap;
  /**
   * 지도에서 몇 번째 걸음인가(0..STAGE_STEPS-1).
   *
   * `wave`에서 뽑던 것을 갈라냈다. **wave는 난이도 시계이자 점수**고
   * **step은 지도 위의 위치**다. 전투는 승리할 때, 정찰은 선택 즉시 wave를
   * 하나 넘긴다. 둘을 따로 둬야 지도 위치와 난이도 시계가 각자의 이유로 움직인다.
   */
  step: number;
  /** 이번 걸음에 고른 칸의 성격. 적 편성과 회피 횟수가 이걸 본다. */
  nodeKind: NodeKind | null;
  nodeWave: WaveKind | null;
  /** 첫 화면과 보스 처치 직후에 고를, 다음 보스의 검증된 계약 세 장. */
  raidOffers: readonly RaidContract[];
  /** 다음 보스에 적용할 계약. 일반전 사이에도 유지되어 구매·배치의 근거가 된다. */
  raidContract: RaidContract | null;
  /** 계약을 선택할 때 고정한 대상 보스 인덱스. 다른 보스에 잘못 적용되지 않게 한다. */
  raidTargetBossIndex: number;
  /** 가장 최근에 끝난 보스 계약. 승리 뒤 계약을 비워도 부검·기록에 남긴다. */
  lastRaidContract: RaidContract | null;
  /** 이번 런에서 계약 보스를 이긴 횟수와 그로 얻은 추가 생선. */
  raidContractsWon: number;
  raidBonusFish: number;
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
  /** 마지막에 나를 막은 것. 보스면 이름과 남은 체력이 함께 뜬다. */
  killer: { name: string; hpFrac: number; boss: boolean } | null;
  /**
   * 이 판의 종류. 죽은 화면의 세 버튼(같은 시드 · 오늘의 시드 · 도전 +1)이
   * 고른다. 하네스는 전부 `free`다.
   */
  kind: RunKind;
  /** 도전 단계. 0이면 기본. 적 스탯 배수 = 1 + challengeStep × 단계. */
  challenge: number;
  /** 오늘의 시드 판이면 그 날짜(YYYY-MM-DD, 기기 시간). 기록 키로 쓴다. */
  dailyKey: string | null;
  /**
   * 이 판의 종류 기준 최고 기록 — 오늘의 시드는 그 날짜, 도전은 그 단계, 나머지는
   * `best`와 같다. HUD와 죽은 화면의 막대가 이 값을 잣대로 쓴다.
   */
  modeBest: number;
  /** 이 판에서 만난 보스·정예 이름. 도감용 — 판정 불개입. */
  bossesMet: string[];
}

/**
 * 판의 종류.
 *
 * - `free`: 새 시드. 시계에서 뽑는다(기본)
 * - `retry`: 직전 판과 같은 시드. 지도·시너지·첫 카드가 같으므로 "운이 아니라
 *   내 선택 탓"을 확인하는 자리다
 * - `daily`: 날짜에서 뽑은 시드. 같은 날에는 누구나 같은 판을 받는다 — 서버 없이
 *   성립하는 비동기 경쟁이다(리더보드는 없다, 기록은 기기에만 남는다)
 * - `challenge`: 단계만큼 적이 센 판. 파워 해금 대신 제약을 더해 재진입을 만든다
 */
export type RunKind = "free" | "retry" | "daily" | "challenge";

export interface NewRunOptions {
  kind?: RunKind;
  challenge?: number;
  dailyKey?: string | null;
}

const BEST_KEY = "nyang-arena.best";
/** JSON `{ [YYYY-MM-DD]: 최고 웨이브 }` */
const DAILY_KEY = "nyang-arena.daily";
/** JSON `{ [단계]: 최고 웨이브 }` */
const CHALLENGE_KEY = "nyang-arena.challenge";
/** JSON `Codex` — 데리고 있던 고양이·모은 유물·만난 보스의 누적 */
const CODEX_KEY = "nyang-arena.codex";
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

/**
 * 영입 비용. 팀이 판의 수용력을 넘어서면 오른다.
 *
 * 강화(`upgradeCost`)와 대칭을 맞춘 것이다 — 한쪽만 지수면 그쪽이 늘 진다.
 * 근거는 `balance.ts`의 `recruitFreeUpTo` 주석에 있다.
 */
export function recruitCost(base: number, owned: number): number {
  const over = Math.max(0, owned - BALANCE.recruitFreeUpTo);
  return Math.round(base * Math.pow(BALANCE.recruitGrowth, over));
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
 * 예전에는 적 구성이 BREEDS[(w*3+i*5) % 길이]로만 결정돼 매 웨이브 비슷했다.
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
 * **웨이브 번호는 여기에 못 들어온다.** 정찰도 난이도 시계를 넘기므로 현재는
 * step과 함께 움직이지만, 전투 성격의 출처는 플레이어가 고른 지도 칸이어야 한다.
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

export interface RaidBossTarget {
  stage: number;
  step: number;
  index: number;
  name: string;
}

/** 지금 위치에서 다음으로 만날 보스. 스테이지 경계도 넘겨 계산한다. */
export function nextRaidBossTarget(state: Pick<RunState, "map" | "step">): RaidBossTarget {
  let stage = state.map.stage;
  let step = state.step;
  while (step < STAGE_STEPS && !isBossStep(step)) step += 1;
  if (step >= STAGE_STEPS) {
    stage += 1;
    step = 0;
    while (!isBossStep(step)) step += 1;
  }
  const index = (stage - 1) * BOSSES_PER_STAGE + bossOrdinalInStage(step);
  return { stage, step, index, name: bossForIndex(index).name };
}

/** 다음 보스의 세 계약을 열되, 이미 선택했거나 열려 있으면 난수를 다시 굴리지 않는다. */
export function openNextRaidContracts(state: RunState): void {
  if (state.raidContract || state.raidOffers.length > 0) return;
  const target = nextRaidBossTarget(state);
  state.raidTargetBossIndex = target.index;
  state.raidOffers = raidContractOffers(state.seed, target.index);
}

/** 화면과 헤드리스가 함께 쓰는 계약 선택 전이. */
export function chooseRaidContract(state: RunState, idx: number): boolean {
  if (state.phase !== "map") return false;
  const contract = state.raidOffers[idx];
  if (!contract) return false;
  state.raidContract = contract;
  state.raidTargetBossIndex = nextRaidBossTarget(state).index;
  state.raidOffers = [];
  setNotice(state, `${contract.name} — ${nextRaidBossTarget(state).name}에게 추가 생선 +${contract.rewardFish}`);
  return true;
}

/** 공유 URL이 가리킨 첫 계약. 출고 풀의 id만 허용하고 첫 보스에 고정한다. */
export function chooseSharedRaidContract(state: RunState, id: string): boolean {
  if (state.phase !== "map") return false;
  const contract = raidContractById(id);
  if (!contract) return false;
  state.raidContract = contract;
  state.raidTargetBossIndex = nextRaidBossTarget(state).index;
  state.raidOffers = [];
  setNotice(state, `공유 악몽 ${contract.name} — 같은 규칙으로 도전합니다`);
  return true;
}

/** 현재 전투 보스에 실제로 적용 가능한 계약만 돌려준다. */
export function activeRaidContract(state: RunState): RaidContract | null {
  if (state.nodeKind !== "boss" || !state.raidContract) return null;
  return state.raidTargetBossIndex === bossIndexAt(state) ? state.raidContract : null;
}

/** 현재 계약 보스 두 걸음 전의 추천 경로를 실제로 밟았는가. */
export function raidPrepMatched(state: RunState): boolean {
  const contract = state.raidContract;
  const prepStep = state.step - 2;
  if (!contract || prepStep < 0 || !isRaidPrepStep(prepStep)) return false;
  const picked = state.map.taken[prepStep];
  if (picked === undefined || picked < 0) return false;
  return state.map.steps[prepStep]?.[picked]?.kind === raidPrepRoute(contract);
}

/** 계약 위험과 준비 경로 일치 여부를 함께 반영한 보스 체력·광역 피해 배수. */
export function raidBossPower(state: RunState, breedId: number): number {
  const contract = activeRaidContract(state);
  const power = bossKit(breedId, contract).power;
  return contract && !raidPrepMatched(state) ? power * BALANCE.contractMismatchPower : power;
}

/**
 * 정찰 칸이 다음 계약 보스에 가져갈 회피 횟수.
 *
 * 위험한 계약일수록 예고가 세고 길어지는데 모든 정찰이 회피를 주면, 계약을
 * 읽든 말든 지도에서 할 일이 같았다. 그래서 카드가 숨 돌리기를 지시하는
 * 고위험 계약에서만 기본 2 + 계약 대비 1, 합계 3회를 준다. 나머지는 0이다.
 */
export function scoutDodgeReward(state: RunState): number {
  const matched = state.raidContract && raidPrepRoute(state.raidContract) === "shop";
  return matched ? BALANCE.scoutDodgeBonus + BALANCE.contractPrepDodge : 0;
}

/** 이 런에서 지금까지 만난 보스 수. 난이도 램프가 이걸 본다. */
export function bossesSeen(state: RunState): number {
  /**
   * **넘은 것만 센다.** 보스 걸음에 **도착한 순간** 넘은 것으로 세면 싸우기도 전에
   * "악몽을 밀어냈어요" 막이 올라갔다. 걸음은 칸을 고를 때 오르므로, 지나간 보스는
   * `현재 걸음보다 앞의 보스 걸음`이다. 주기는 `map.ts`의 `BOSS_STEPS`가 유일한 출처다 —
   * 예전에는 여기만 `2`와 `5`를 손으로 들고 있어 주기를 바꾸면 조용히 어긋났다.
   */
  let done = 0;
  for (let i = 0; i < state.step; i++) if (isBossStep(i)) done += 1;
  return (state.map.stage - 1) * BOSSES_PER_STAGE + done;
}

/**
 * 안내 문구를 세팅한다. **종류(`noticeKind`)를 항상 함께 정한다.**
 *
 * 산발적으로 `state.notice = ...`만 쓰면 이전에 뜬 보스 배너의 종류가 다음
 * 안내에 그대로 남는다 — 문구는 바뀌었는데 스타일만 이전 것을 입는 식으로
 * 깨진다. main.ts도 안내를 세팅할 때는 이 함수를 쓴다.
 */
export function setNotice(state: RunState, text: string, kind: NoticeKind = "normal"): void {
  state.notice = text;
  state.noticeKind = kind;
}

/**
 * 지도에서 한 칸을 고른다.
 *
 * 상점 칸은 싸우지 않으므로 그 자리에서 보상을 주고 곧장 상점 화면으로 간다.
 * 그래도 **웨이브는 하나 지나간다** — 그게 상점의 대가다. 적은 웨이브마다
 * 복리로 세지므로, 힘을 사는 동안 상대도 세진다.
 */
export function chooseNode(state: RunState, idx: number): boolean {
  // 계약 카드가 열려 있는 동안 지도 클릭은 뒤로 새지 않는다.
  if (state.raidOffers.length > 0) return false;
  const step = mapStep(state);
  if (!openLanes(state.map, step).includes(idx)) return false;
  const node = state.map.steps[step]?.[idx];
  if (!node) return false;

  // 저장 데이터나 테스트 픽스처에서 계약이 빠졌더라도 보스를 기본 규칙으로
  // 조용히 시작하지 않는다. 검증된 세 장을 다시 열어 같은 전이를 복구한다.
  if (node.kind === "boss" && (!state.raidContract || state.raidTargetBossIndex !== bossIndexAt(state))) {
    state.raidContract = null;
    state.raidOffers = [];
    openNextRaidContracts(state);
    return false;
  }

  state.map.taken[step] = idx;
  state.nodeKind = node.kind;
  state.nodeWave = node.wave;

  if (node.kind === "shop") {
    // 싸우지 않고 힘만 사는 자리. 생선과 무료 재추첨을 주고 웨이브를 넘긴다.
    state.gold += BALANCE.shopNodeGold;
    state.freeRerolls += 1;
    // 환전되지 않는 자원. 이것 때문에 이 길을 고르는 것이지 생선 때문이 아니다.
    const dodgeReward = scoutDodgeReward(state);
    // 여러 숨 돌리기를 밟아도 중첩하지 않는다. 다음 보스용 준비는 가장 좋은
    // 하나만 남겨, 경로를 순회해 회피를 무한히 저축하는 전략을 막는다.
    state.bonusDodge = Math.max(state.bonusDodge, dodgeReward);
    // 싸우지 않아도 시간은 흐른다. 웨이브를 그대로 두면 적 성장도 멈춰 정찰이
    // 생선·재추첨·회피를 공짜로 얻는 고정 정답이 된다. 한 웨이브를 넘겨 다음
    // 적을 강하게 만드는 것이 전투를 피한 대가다.
    state.wave += 1;
    state.step += 1;
    syncStage(state);
    rollOffers(state);
    state.phase = "reward";
    setNotice(state, dodgeReward > 0
      ? `계약 정찰 완료 — 생선·다시 뽑기 · 다음 보스 회피 +${dodgeReward}`
      : "정찰 완료 — 생선과 다시 뽑기로 한 걸음 대비했어요");
    return true;
  }

  /**
   * **고른 뒤에** 상대를 만들고, 그 상대를 보면서 산다.
   *
   * 한 걸음의 순서가 길 → 적 → 준비(구매·배치)다. 예전에는 구매가 맨 앞이었는데,
   * 그러면 **무엇과 싸울지 모르는 채로** 사게 된다. 저격대가 오는데 원거리를
   * 사고, 돌격대가 오는데 앞줄이 비는 일이 그래서 생겼다. 상대를 먼저 보여
   * 주면 같은 카드가 판마다 다른 값을 갖는다.
   */
  buildEnemyWave(state);
  rollOffers(state);
  state.phase = "reward";
  // 길목은 안내를 비운다. 매 걸음 같은 말이 뜨면 글자가 배경이 되고,
  // 그러면 정작 알려야 할 때(정예·경고) 아무도 안 읽는다.
  const unpreparedBoss = node.kind === "boss" && activeRaidContract(state) && !raidPrepMatched(state);
  setNotice(
    state,
    unpreparedBoss
      ? `계약 대비가 어긋났어요 · 이번 보스 강도 +${Math.round((BALANCE.contractMismatchPower - 1) * 100)}%`
      : node.kind === "elite"
        ? "만만치 않아요. 이기면 유물을 남기고 가요"
        : "",
  );
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
  if (state.relicDraftActive) {
    // 건너뛰어도 원래 상점은 사라지지 않는다. 택1 묶음만 닫고 같은 화면에
    // 일반 영입·강화 카드를 연 뒤, 다음 입력에서 기존 경로 전이를 수행한다.
    state.relicDraftActive = false;
    rollOffers(state);
    setNotice(state, "유물은 건너뛰었어요 · 일반 준비를 이어갑니다");
    return;
  }
  if (state.nodeKind === "shop") {
    // 정찰은 전투 없이 걸음과 난이도 시계를 함께 넘겼다. 다음 갈림길로.
    state.phase = "map";
    setNotice(state, "");
    return;
  }
  state.phase = "prepare";
  // 이 안내는 이제 화면에 거의 안 뜬다 — UI가 구매·배치를 한 화면으로 합치면서
  // 준비 화면에서 멈추지 않기 때문이다. 헤드리스에서는 여전히 이 자리를 지난다.
  setNotice(state, "");
}

/** 스테이지 경계를 넘었으면 새 지도를 만든다. */
export function syncStage(state: RunState): void {
  if (state.step < STAGE_STEPS) return;
  state.step = 0;
  state.map = makeStage(state.map.stage + 1, state.seed);
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

/**
 * 목표 셋을 고른다. 트리거당 하나가 아니라 **난이도당 하나**로 뽑는다.
 *
 * 난이도는 `triggerDifficulty`의 **실측 라벨**이 정한다 — 계산 모형을 두 번
 * 세웠는데 두 번 다 실측이 부정해서 라벨을 측정에 직접 묶었다(그 이력이
 * `synergy-schema.ts`의 주석에 있다). 쉬움은 배치 2마리·같은 품종 2, 중간은
 * 배치 3마리, 어려움은 같은 색 3이다. 등급에 트리거가 여럿이면 판마다
 * 무작위로 하나를 고른다.
 *
 * 효과 크기도 `scaleEffectForDifficulty`로 난이도에 비례하게 다시 잰다 — 쉬운
 * 목표가 어려운 목표와 보상이 같으면 굳이 어려운 쪽을 볼 이유가 없다.
 */
function pickSynergies(pool: SynergyRule[]): SynergyRule[] {
  const byTrigger = new Map<Trigger, SynergyRule[]>();
  for (const r of pool) {
    const list = byTrigger.get(r.trigger) ?? [];
    list.push(r);
    byTrigger.set(r.trigger, list);
  }

  const byDifficulty = new Map<Difficulty, Trigger[]>();
  for (const t of TRIGGERS) {
    if (!byTrigger.has(t)) continue; // 이 트리거의 후보가 풀에 없으면 등급 자체가 못 뽑힌다
    const d = triggerDifficulty(t);
    const list = byDifficulty.get(d) ?? [];
    list.push(t);
    byDifficulty.set(d, list);
  }

  const out: SynergyRule[] = [];
  const usedEffects = new Set<string>();
  const usedFamilies = new Set<string>();

  for (const difficulty of ["easy", "medium", "hard"] as const) {
    // 같은 배치 축이 두 등급에 걸쳐 뜨면 안 된다 — "뒷줄 원거리 1/2"와
    // "뒷줄 원거리 1/3"이 나란히 뜬 판이 실제로 나왔다(영상 프레임에서 발견).
    // 라벨이 같아 난이도만 다른 복제로 읽히고, 세 목표가 다 달라야 한다는
    // 취지가 무너진다. 트리거의 계열(front_melee/back_ranged/...)로 겹침을 막는다.
    const family = (t: Trigger) => t.replace(/_\d+$/, "");
    const triggers = shuffle([...(byDifficulty.get(difficulty) ?? [])]);
    for (const t of triggers) {
      if (usedFamilies.has(family(t))) continue;
      const candidates = shuffle([...(byTrigger.get(t) ?? [])]);
      // 효과까지 겹치면 세 목표가 전부 "공격 속도"인 판이 나와 선택의 맛이 사라진다.
      // 아직 안 쓴 효과를 우선하고, 없으면 아무거나 쓴다.
      const pick = candidates.find((r) => !usedEffects.has(r.effect.key)) ?? candidates[0];
      if (!pick) continue;
      usedEffects.add(pick.effect.key);
      usedFamilies.add(family(t));
      out.push({ ...pick, effect: scaleEffectForDifficulty(pick.effect, difficulty) });
      break;
    }
  }

  // 풀이 특정 트리거를 아예 못 채운 예외적인 경우를 대비한 보루. 세 등급을
  // 다 못 채웠으면 남은 후보로 채운다(AC-12: 데이터가 비어도 게임은 돌아야 한다).
  if (out.length < SYNERGIES_PER_RUN) {
    const chosenIds = new Set(out.map((r) => r.id));
    const rest = shuffle(pool.filter((r) => !chosenIds.has(r.id)));
    for (const r of rest) {
      if (out.length >= SYNERGIES_PER_RUN) break;
      out.push({ ...r, effect: scaleEffectForDifficulty(r.effect, triggerDifficulty(r.trigger)) });
    }
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
    sizeMul: 1,
    summon: null,
    taunt: false,
  };
}

/**
 * 소환수의 성격. **주인 대비 배수로만 적는다** — 절대 수치로 적으면 웨이브가
 * 오를수록 소환수가 상대적으로 약해져서 후반에 있으나 마나가 된다.
 */
export interface SummonSpec {
  readonly id: string;
  readonly label: string;
  readonly atkMul: number;
  readonly hpMul: number;
  /** 몸·겹침 크기. 판이 좁아서 이 값이 곧 밀도다. */
  readonly sizeMul: number;
  readonly lifeMs: number;
  /** 한 번에 몇 마리 */
  readonly count: number;
  /**
   * 세우면서 두를 보호막(최대 체력 대비). 없으면 안 두른다.
   *
   * 전에는 `castSkill`이 `spec.id === "bulwark"`로 갈랐다. 그러면 새
   * 사양을 더할 때 전투 코드도 같이 고쳐야 한다는 것이 타입에 안 드러난다.
   */
  readonly shieldFrac?: number;
  /** 적이 이것을 먼저 노리는가. `Cat.taunt` 참고 */
  readonly taunt?: boolean;
}

/**
 * 분신. 주인과 **같은 그림**이라 새 스프라이트가 필요 없다 — 시트 20장이
 * 아군 8·악몽 8·보스 4로 이미 소진돼 있고, 21번째 행은 시트에 없다.
 * 화면에서는 알파로 갈라낸다(`render.ts`의 `drawCat`).
 *
 * **수치는 쓸어서 정했고, 그 결과가 포화였다.** 마릿수 2→3, 체력 0.25→0.5,
 * 수명 6초→600초를 조합해 아홉 가지를 재니 전부 +0.3~+1.1웨이브 안에
 * 들어왔다. 손잡이를 어느 쪽으로 돌려도 값이 안 늘어난다 — 분신은 맞아
 * 주는 몸이라 적의 공격 횟수가 상한이고, 그 상한은 분신 수와 무관하다.
 * 그중 가장 나은 조합(2마리·체력 0.5·20초, +1.11)을 쓴다.
 *
 * 워크래프트의 미러 이미지와 같은 성격이다: 화력은 거의 없고 대신 맞아 준다.
 * 공격력을 30%로 둔 것은 분신이 화력 증폭이 되면 안 되기 때문이다 — 그러면
 * `atk_mul` 유물과 같은 축이 되고, 유물 축이 안 벌어지는 그 이유를 반복한다.
 * 분신의 값은 **적의 공격을 나눠 받는 것**이지 더 때리는 것이 아니다.
 */
export const MIRROR_IMAGE: SummonSpec = {
  id: "mirror",
  label: "분신",
  atkMul: 0.3,
  hpMul: 0.5,
  sizeMul: 0.62,
  lifeMs: 20000,
  count: 2,
};

/**
 * 새끼 고양이. 분신보다 작고 오래 간다.
 *
 * 크기는 밀도에서 나온 값이다. 10마리일 때 최근접 거리가 1.05(분리 목표
 * 1.0)였으므로 같은 크기의 몸을 더 얹을 자리가 없다. 0.48짜리 둘은 사이가
 * 0.48칸이면 되고 보통 고양이와는 0.74칸이라, 지금 밀도 안에 들어간다.
 */
export const KITTEN: SummonSpec = {
  id: "kitten",
  label: "새끼",
  atkMul: 0.45,
  hpMul: 0.35,
  sizeMul: 0.48,
  lifeMs: 9000,
  count: 1,
};

/**
 * 소환사가 부르는 셋. **셋 다 몸을 내보내지만 값이 어디에 있는지가 다르다.**
 *
 * 유물이 주는 분신·새끼와 겹치지 않게 잡았다. 그쪽은 스탯 유물과 다른 축을
 * 만들려는 것이라 화력이 거의 없는 반면, 이쪽은 **직업의 본체**라 이 셋이
 * 곧 소환사의 화력이자 내구다. 그래서 소환사 본인의 DPS를 여덟 직업 중
 * 가장 낮게 잡았다(22~25) — 몸을 대신 내보내는 값을 거기서 치른다.
 */

/** 떼부르기 — 작은 것 셋. 숫자로 민다. 광역기 한 방에 같이 녹는다. */
export const SWARM_PACK: SummonSpec = {
  id: "swarm",
  label: "떼",
  atkMul: 0.32,
  hpMul: 0.18,
  sizeMul: 0.42,
  lifeMs: 7000,
  count: 3,
};

/** 버팀목 — 큰 것 하나. 오래 서서 맞아 준다(시전 시 보호막도 함께 걸린다). */
export const BULWARK_UNIT: SummonSpec = {
  id: "bulwark",
  label: "버팀",
  atkMul: 0.5,
  hpMul: 0.9,
  sizeMul: 0.9,
  lifeMs: 11000,
  count: 1,
  shieldFrac: 0.5,
};

/**
 * 미끼 — 때리지는 못하고 **적의 눈을 끈다.**
 *
 * 공격력을 거의 0으로 둔 것이 핵심이다. 화력이 붙으면 그냥 몸 하나 더가 되어
 * 떼부르기·버팀목과 같은 축이 된다. 이 소환수의 값은 **적의 공격 대상을
 * 바꾸는 것** 하나뿐이고, 그래서 도발이 꺼지면 아무 값이 없다.
 *
 * 체력은 버팀목보다 낮다. 오래 버티는 것은 버팀목의 몫이고, 이쪽은 짧게
 * 시선을 훔쳐 그 사이에 우리 뒷줄이 때린다.
 */
export const LURE_UNIT: SummonSpec = {
  id: "lure",
  label: "미끼",
  atkMul: 0.12,
  hpMul: 0.55,
  sizeMul: 0.8,
  lifeMs: 8000,
  count: 1,
  taunt: true,
};

/**
 * 소환수를 만든다. 주인 옆에 선다.
 *
 * 자리는 주인 좌표에서 살짝 밀어 놓기만 한다 — 정확한 배치는 `separate()`가
 * 하고, 판 밖으로 나가는 것도 거기서 막힌다(`clampToField`).
 */
export function makeSummon(owner: Cat, spec: SummonSpec, index: number): Cat {
  const cat = makeCat(owner.breed, owner.side, owner.cell, owner.level);
  const angle = (Math.PI * 2 * (index + 0.5)) / Math.max(1, spec.count);
  cat.maxHp = Math.max(1, Math.round(owner.maxHp * spec.hpMul));
  cat.hp = cat.maxHp;
  cat.atk = Math.max(1, Math.round(owner.atk * spec.atkMul));
  cat.atkInterval = owner.atkInterval;
  cat.evade = owner.evade;
  // 주인의 이동 속도를 따라간다. 지금은 아군에 speedMul을 거는 것이 없어
  // 항상 1이지만, 나중에 생기면 분신만 뒤처지는 것이 조용한 어긋남이 된다.
  cat.speedMul = owner.speedMul;
  cat.sizeMul = spec.sizeMul;
  cat.taunt = spec.taunt === true;
  cat.summon = { ownerUid: owner.uid, lifeMs: spec.lifeMs };
  cat.fx = owner.fx + Math.cos(angle) * 0.7;
  cat.fy = owner.fy + Math.sin(angle) * 0.7;
  cat.pose = owner.pose;
  // 소환수는 스킬을 안 쓴다. 마나를 채워 두면 주인의 스킬이 복제돼 화력이
  // 통째로 두 배가 된다 — 분신은 맞아 주는 몸이지 화력이 아니다.
  cat.mana = 0;
  cat.cooldown = owner.atkInterval;
  return cat;
}

export function loadBest(): number {
  const v = Number(storageGet(BEST_KEY));
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/** 사파리 프라이빗 모드 등에서 저장이 실패해도 게임 진행에는 영향 없다(`storageSet`). */
function saveBest(v: number): void {
  storageSet(BEST_KEY, String(v));
}

/*
 * 기기에 남는 기록 — 전부 `localStorage`이고, 없거나 막혀 있으면(노드 하네스,
 * 프라이빗 모드) 조용히 빈 값을 쓴다. 네트워크는 여전히 0건이다.
 */
function storageGet(key: string): string | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(key, value);
  } catch {
    /* 저장 실패는 게임 진행에 영향 없음 */
  }
}

function loadJson<T>(key: string, fallback: T): T {
  const raw = storageGet(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 기기 시간 기준 오늘(YYYY-MM-DD). 오늘의 시드 키이자 표시 문구다. */
export function dailyKeyToday(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * 날짜 → 시드. FNV-1a로 문자열을 32비트로 접고 `mixSeed`로 한 번 더 흩는다.
 * 같은 날짜면 어느 기기에서나 같은 값이므로, 같은 날에는 모두 같은 판을 받는다.
 */
export function dailySeed(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return mixSeed(h >>> 0, 7);
}

export function loadDailyBest(key: string): number {
  const all = loadJson<unknown>(DAILY_KEY, {});
  const v = isRecord(all) ? all[key] : undefined;
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
}

function saveDailyBest(key: string, v: number): void {
  const loaded = loadJson<unknown>(DAILY_KEY, {});
  const all: Record<string, unknown> = isRecord(loaded) ? loaded : {};
  all[key] = v;
  storageSet(DAILY_KEY, JSON.stringify(all));
}

export function loadChallengeBest(level: number): number {
  const all = loadJson<unknown>(CHALLENGE_KEY, {});
  const v = isRecord(all) ? all[String(level)] : undefined;
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
}

function saveChallengeBest(level: number, v: number): void {
  const loaded = loadJson<unknown>(CHALLENGE_KEY, {});
  const all: Record<string, unknown> = isRecord(loaded) ? loaded : {};
  all[String(level)] = v;
  storageSet(CHALLENGE_KEY, JSON.stringify(all));
}

/** 도감 — 정보 해금이지 파워 해금이 아니다. 본 것이 쌓일 뿐 게임은 안 바뀐다. */
export interface Codex {
  breeds: number[];
  relics: string[];
  bosses: string[];
}

export const CODEX_TOTALS = {
  breeds: BREEDS.length,
  relics: RELICS.length,
  // 우두머리 셋 + 정예(외눈이)
  bosses: BOSS_BREEDS.length + 1,
} as const;

export function loadCodex(): Codex {
  const loaded = loadJson<unknown>(CODEX_KEY, {});
  const c = isRecord(loaded) ? loaded : {};
  return {
    breeds: Array.isArray(c.breeds) ? c.breeds.filter((v): v is number => typeof v === "number") : [],
    relics: Array.isArray(c.relics) ? c.relics.filter((v): v is string => typeof v === "string") : [],
    bosses: Array.isArray(c.bosses) ? c.bosses.filter((v): v is string => typeof v === "string") : [],
  };
}

/** 판이 끝날 때 도감을 갱신한다. 판정에는 관여하지 않는다. 최근 판 목록은 소비처가 없어 뺐다(2026-08-23). */
function recordRun(state: RunState): void {
  const codex = loadCodex();
  const breeds = new Set(codex.breeds);
  for (const c of state.ally) if (c) breeds.add(c.breed.id);
  const relics = new Set(codex.relics);
  for (const r of state.relics) relics.add(r.id);
  const bosses = new Set(codex.bosses);
  for (const b of state.bossesMet) bosses.add(b);
  storageSet(
    CODEX_KEY,
    JSON.stringify({ breeds: [...breeds], relics: [...relics], bosses: [...bosses] } satisfies Codex),
  );
}

/**
 * 판이 끝났을 때 기록을 갱신한다.
 *
 * 기록은 판의 종류별로 따로 남는다. 도전 판은 적이 세므로 전체 최고를 건드리지
 * 않고(같은 잣대가 아니다) 그 단계의 기록만 본다. 오늘의 시드는 기본 난이도라
 * 전체 최고와 그날 기록을 둘 다 본다.
 */
function recordOutcome(state: RunState): void {
  if (state.challenge === 0 && state.wave > state.best) {
    state.best = state.wave;
    state.recordBroken = true;
    saveBest(state.best);
  }
  if (state.kind === "daily" && state.dailyKey) {
    if (state.wave > state.modeBest) {
      state.modeBest = state.wave;
      state.recordBroken = true;
      saveDailyBest(state.dailyKey, state.wave);
    }
  } else if (state.kind === "challenge") {
    if (state.wave > state.modeBest) {
      state.modeBest = state.wave;
      state.recordBroken = true;
      saveChallengeBest(state.challenge, state.wave);
    }
  } else {
    state.modeBest = state.best;
  }
  recordRun(state);
}

/** 만난 보스·정예를 도감용으로 적어 둔다. 같은 이름은 한 번만. */
function metBoss(state: RunState, name: string): void {
  if (!state.bossesMet.includes(name)) state.bossesMet.push(name);
}

/** 도전 단계의 적 스탯 배수. 0단계는 1이라 하네스 수치가 그대로다. */
function challengeMul(state: RunState): number {
  return 1 + BALANCE.challengeStep * state.challenge;
}

export type NextChoice = "again" | "retry" | "daily" | "challenge";

/**
 * 죽은 화면에서 고른 다음 판.
 *
 * - `again`(큰 버튼·Space·Enter): 같은 종류로 한 판 더 — 기본은 새 시드, 오늘의
 *   시드는 그대로 오늘의 시드, 도전은 같은 단계
 * - `retry`: 같은 시드. 오늘의 시드·도전 판은 **종류를 유지한다** — 그날/그 단계의
 *   기록 잣대가 그대로여야 "같은 판을 더 멀리 갔다"가 기록에 남는다. 기본 판만 `retry`다
 * - `daily`: 오늘의 시드
 * - `challenge`: 지금 단계 + 1, 새 시드
 */
export function nextRunFrom(s: RunState, choice: NextChoice): RunState {
  switch (choice) {
    case "retry":
      return newRun(s.seed, {
        kind: s.kind === "daily" ? "daily" : s.kind === "challenge" ? "challenge" : "retry",
        challenge: s.challenge,
        dailyKey: s.dailyKey,
      });
    case "daily": {
      const key = dailyKeyToday();
      return newRun(dailySeed(key), { kind: "daily", dailyKey: key });
    }
    case "challenge":
      return newRun(undefined, { kind: "challenge", challenge: s.challenge + 1 });
    case "again":
    default:
      if (s.kind === "daily" && s.dailyKey) return newRun(dailySeed(s.dailyKey), { kind: "daily", dailyKey: s.dailyKey });
      if (s.challenge > 0) return newRun(undefined, { kind: "challenge", challenge: s.challenge });
      return newRun();
  }
}

/**
 * @param seed 없으면 시계에서 뽑는다. 시뮬은 런마다 결정적 시드를 넘겨
 *   같은 명령이 같은 수치를 내게 한다.
 */
export function newRun(seed?: number, opts: NewRunOptions = {}): RunState {
  const runSeed = seed ?? Date.now();
  const kind: RunKind = opts.kind ?? "free";
  const challenge = Math.max(0, Math.floor(opts.challenge ?? 0));
  const dailyKey = kind === "daily" ? (opts.dailyKey ?? dailyKeyToday()) : null;
  seedRng(runSeed);
  uidSeq = 0;
  const pool = resolveSynergyPool();
  const state: RunState = {
    /**
     * **지도부터 연다.**
     *
     * 예전에는 상점에서 시작했다. 생선 8마리를 쥐여 주고 첫 전투가 끝날 때까지
     * 쓸 데가 없던 것보다는 나았지만, 무엇과 싸울지 모르는 채로 사는 것은
     * 마찬가지였다. 이제 한 걸음의 순서는 **길 → 적 → 준비(구매·배치)**이고,
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
    noticeKind: "normal",
    battleElapsed: 0,
    recordBroken: false,
    lossReason: null,
    telegraphsSeen: 0,
    telegraphsEaten: 0,
    vulnOverlapSeen: 0,
    vulnOverlapDodged: 0,
    polarityChoices: 0,
    seizeMarked: 0,
    seizeRescued: 0,
    finalPhaseUsed: false,
    map: makeStage(1, runSeed),
    step: 0,
    nodeKind: null,
    nodeWave: null,
    raidOffers: [],
    raidContract: null,
    raidTargetBossIndex: -1,
    lastRaidContract: null,
    raidContractsWon: 0,
    raidBonusFish: 0,
    freeRerolls: 0,
    bonusDodge: 0,
    killer: null,
    kind,
    challenge,
    dailyKey,
    modeBest:
      kind === "daily" && dailyKey
        ? loadDailyBest(dailyKey)
        : kind === "challenge"
          ? loadChallengeBest(challenge)
          : loadBest(),
    bossesMet: [],
    seed: runSeed,
    pending: [],
    dodgeCharges: 0,
    actCooldown: 0,
    relics: [],
    relicDraftPending: false,
    relicDraftActive: false,
    summons: [],
  };

  // 판의 종류는 첫 문구가 말한다. 도전은 무엇이 달라졌는지, 오늘의 시드는 왜
  // 같은 판인지를 한 줄로 — 설명 화면을 따로 두지 않는다.
  if (kind === "daily" && dailyKey) {
    setNotice(state, `오늘의 시드 ${dailyKey} — 오늘은 누구나 같은 판이다`);
  } else if (kind === "challenge") {
    setNotice(state, `도전 ${challenge} — 적이 ${Math.round(BALANCE.challengeStep * challenge * 100)}% 세다`);
  } else if (kind === "retry") {
    setNotice(state, "같은 시드 — 판은 그대로, 선택만 바꿀 수 있다");
  }

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

  // 제출 버전의 차별점은 첫 화면에서 보인다. 첫 보스까지 기다리지 않고 지금
  // 계약을 고르게 하되, 실제 적용은 targetBossIndex가 같은 보스에서만 한다.
  openNextRaidContracts(state);

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
/**
 * 적을 뽑는 풀들. **`enemyBreedIds`가 나머지 연산에 쓰는 모듈러스 전부**를
 * 내보낸다 — 계약 검사가 이 길이들과 보폭이 서로소인지 단언한다.
 *
 * 전체 명단 길이만 검사했다가 이 셋을 놓쳤다. 검사는 초록인데 돌격 웨이브가
 * 굳어 있었다.
 */
export const MELEE_IDS = NIGHTMARE_BREEDS.filter((b) => b.kind === "melee").map((b) => b.id);
export const RANGED_IDS = NIGHTMARE_BREEDS.filter((b) => b.kind === "ranged").map((b) => b.id);
/**
 * 돌격대는 전사만 낸다.
 *
 * 예전에는 "전부 근접"이라 도적이 섞였는데, 도적은 전투가 시작되자마자 우리
 * 뒷줄로 뛰어든다. 유닛이 셋뿐인 웨이브 2에서 그건 즉사였다(측정: W2에서만 42명).
 * 돌격은 전사가 하는 것이고, 암살자가 하는 건 돌격이 아니다.
 */
export const WARRIOR_IDS = NIGHTMARE_BREEDS.filter((b) => b.cls === "warrior").map((b) => b.id);

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

/**
 * 웨이브·자리 보폭. **둘 다 명단 길이와 서로소여야 한다.**
 *
 * 적 구성은 `(wave*WAVE_STRIDE + i*UNIT_STRIDE) % 길이`로 정한다. 웨이브
 * 보폭이 길이와 서로소가 아니면 오프셋이 일부 값만 돌고, 그만큼 웨이브
 * 종류가 줄어든다.
 *
 * 실제로 밟았다. 명단을 8종에서 12종으로 늘렸을 때 보폭이 3이라
 * `gcd(3,12)=3` — 오프셋이 {0,3,6,9} 넷만 돌아 **웨이브 구성이 4웨이브마다
 * 반복됐다.** 8종일 때는 `gcd(3,8)=1`이라 여덟 개가 다 돌았으므로, 명단을
 * 늘렸을 뿐인데 다양성이 절반이 된 것이다. 도달 웨이브 중앙값도 11에서 9로
 * 내려갔는데 **원인은 새 고양이의 스킬이 아니라 이 주기였다** — 회복
 * 배수를 0으로 낮춰도 수치가 그대로였던 것으로 확인했다.
 *
 * 명단 길이와 서로소인 값 중 서로 다른 둘을 골랐다. 11은 소환사를 적에게도
 * 주려다 악몽 명단이 15종이 됐을 때 잡은 값이다 — `gcd(5,15)=5`라 5는
 * 무효였고 계약 검사가 잡았다. 적 소환사를 되물린 뒤 악몽은 12종이라
 * 5도 다시 유효하지만, 되돌리면 웨이브 구성이 통째로 다시 섞여 방금 잰
 * 수치가 전부 무효가 된다. 11도 12와 서로소이므로 그대로 둔다. 둘이 같으면 자리 i의 적이
 * 웨이브 w+i의 첫 적과 늘 같아져 구성이 대각선으로 밀리기만 한다.
 *
 * `npm test`의 명단 계약이 서로소 여부를 단언한다 — 명단 길이를 또 바꾸면
 * 여기서 걸린다.
 */
export const WAVE_STRIDE = 7;
export const UNIT_STRIDE = 11;

/** 웨이브 성격에 맞는 적 품종 목록을 뽑는다. */
function enemyBreedIds(kind: WaveKind, count: number, wave: number): number[] {
  // **여기도 같은 보폭을 쓴다.** 전에는 3/5가 박혀 있었고, 품종을 12종으로
  // 늘리면서 직업 풀 길이가 전사 2→3 · 근접 4→6 · 원거리 4→6이 됐다.
  // `gcd(3,3)=3`이라 돌격 웨이브는 **웨이브 항이 통째로 사라져** 전 구간이
  // 한 가지 구성으로 굳었고, 저격은 짝/홀 두 가지만 돌았다. `boss`/`mixed`만
  // 상수로 갈고 이쪽을 놓쳤던 것이다 — 같은 결함을 한 경로만 고쳤다.
  const pick = (pool: number[], i: number) =>
    pool[(wave * WAVE_STRIDE + i * UNIT_STRIDE) % pool.length] ?? pool[0]!;
  const out: number[] = [];
  /** 보스 호위에서 이미 쓴 직업. 같은 직업이 겹치는 것을 막는다. */
  const seenCls = new Set<string>();
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
      case "mixed": {
        const n = NIGHTMARE_BREEDS.length;
        const base = (wave * WAVE_STRIDE + i * UNIT_STRIDE) % n;
        // **보스 호위는 직업이 겹치지 않게 한다.**
        //
        // 그냥 뽑으면 둘 다 도적이 나올 수 있고, 도적은 전투 첫 프레임에
        // 우리 뒷줄로 뛰어든다(`assassinLeap`). 웨이브 3의 첫 보스에서
        // 실제로 그랬다 — 400판 중 125판이 거기서 끝났고(31%) 호위는
        // 매번 뜬눈이+멍울이였다. 명단이 8종일 때는 같은 자리가 전사+
        // 마법사라 우연히 괜찮았을 뿐, 제약이 없다는 것은 그때도 같았다.
        //
        // 이미 뽑은 직업을 피해 한 칸씩 민다. 한 바퀴를 다 돌아도 못 피하면
        // 원래 자리를 쓴다 — 직업 수보다 호위가 많으면 겹칠 수밖에 없다.
        let idx = base;
        if (kind === "boss") {
          for (let step = 0; step < n; step++) {
            const cand = NIGHTMARE_BREEDS[(base + step) % n];
            if (cand && !seenCls.has(cand.cls)) {
              idx = (base + step) % n;
              break;
            }
          }
        }
        const b = NIGHTMARE_BREEDS[idx];
        // 쓰기도 읽기와 같은 조건 안에 둔다. 한쪽만 가드 밖에 있으면, 나중에
        // 분산을 무조건 적용으로 바꿀 때 mixed 웨이브가 조용히 달라진다.
        if (b && kind === "boss") seenCls.add(b.cls);
        out.push(b?.id ?? 20);
        break;
      }
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
  metBoss(state, breed.name);
  // 보드 한가운데(행 2, 열 2). 반경 1.5라 행 1~3 × 열 1~3을 덮는다.
  const bossCell = 2 * BOARD_COLS + 2;
  const boss = makeCat(breed, "enemy", bossCell);
  boss.radius = BOSS_RADIUS;
  // 낳는 순간 위상을 박는다 — step은 finishWave가 올리므로 나중엔 못 믿는다.
  boss.stageBoss = bossOrdinalInStage(state.step) > 0;
  // 첫 보스는 얇게, 후반으로 갈수록 두껍게. 고정 배수는 5웨이브를 벽으로 만든다.
  const ramp = bossRampFor(state);
  const hpMul =
    (BALANCE.bossHpMulFirst + (BALANCE.bossHpMul - BALANCE.bossHpMulFirst) * ramp) *
    raidBossPower(state, breed.id);
  boss.maxHp = Math.round(boss.maxHp * scale * hpMul);
  boss.hp = boss.maxHp;
  // 평타도 체력과 같은 램프를 탄다. 고정값이면 첫 보스가 벽이 되고, 그러면
  // 탱킹을 살리려던 것이 판을 끝내 버린다.
  const atkMul = BALANCE.bossAtkMulFirst + (BALANCE.bossAtkMul - BALANCE.bossAtkMulFirst) * ramp;
  boss.atk = Math.round(boss.atk * scale * atkMul);
  state.enemy[bossCell] = boss;

  const escortCells = ROW_ORDER.map((r) => r * BOARD_COLS + 0);
  // **"boss"로 부른다.** 예전엔 "mixed"였는데, 그러면 호위 직업이
  // 아무 제약 없이 뽑혀 둘 다 도적이 되는 판이 생긴다.
  const ids = enemyBreedIds("boss", BALANCE.bossEscortCount, wave);
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
  const scale = Math.pow(BALANCE.enemyScale, w - 1) * challengeMul(state);

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
    metBoss(state, SNIPER_BREED.name);
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
    // 배치를 읽는 조건. 앞/뒤 정의는 시너지와 같은 것을 쓴다 —
    // 열 0이 뒷줄, 마지막 열이 앞줄(적에게 가까운 쪽).
    case "front_melee":
      return cats.filter((x) => cellCol(x.cell) === BOARD_COLS - 1 && x.breed.kind === "melee").length >= c.min;
    case "back_ranged":
      return cats.filter((x) => cellCol(x.cell) === 0 && x.breed.kind === "ranged").length >= c.min;
    case "row_spread":
      return new Set(cats.map((x) => cellRow(x.cell))).size >= c.min;
  }
}

/** 상하좌우에 붙은 같은 직업 우리 편 수. 인접 보너스·배치 화면 표시·배치 하네스가 쓴다. */
export function sameClassNeighbors(board: Board, cat: Cat): number {
  // `cat.cell`은 moveCat이 유지한다. 어긋나 있으면(방어) 선형 탐색으로 되찾는다.
  const cell = board[cat.cell] === cat ? cat.cell : board.indexOf(cat);
  if (cell < 0) return 0;
  const row = Math.floor(cell / BOARD_COLS);
  const col = cell % BOARD_COLS;
  let n = 0;
  for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
    const r = row + dr;
    const c = col + dc;
    if (r < 0 || c < 0 || c >= BOARD_COLS || r * BOARD_COLS + c >= board.length) continue;
    const other = board[r * BOARD_COLS + c];
    if (other && other.alive && other.breed.cls === cat.breed.cls) n += 1;
  }
  return n;
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
      if (r.boon && relicActive(r, cats)) apply(r.boon.key, r.boon.value);
    }

    // 인접 보너스 — 같은 직업이 상하좌우로 붙어 있으면 공격이 오른다(2026-08-23 채택).
    // 우리 편만(적은 자동 배치라 결정이 아니다). 상수가 0이면 곱이 1이다.
    if (BALANCE.adjacencyAtk > 0) {
      const n = sameClassNeighbors(state.ally, cat);
      atk *= 1 + BALANCE.adjacencyAtk * Math.min(BALANCE.adjacencyMax, n);
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
  if (state.relicDraftPending) {
    state.relicDraftPending = false;
    const ownedRelics = new Set(state.relics.map((relic) => relic.id));
    const picks = shuffle(RELICS.filter((relic) => !ownedRelics.has(relic.id))).slice(0, OFFER_SLOTS);
    if (picks.length === OFFER_SLOTS) {
      // 보스 직후의 유물 선택을 지도 칸의 종류나 wave 증가 순서에 기대면
      // 일반/정예에는 뜨고 정찰에는 안 뜨는 식으로 갈라진다. pending 사건을
      // 첫 보상 화면이 소비하게 해 세 경로가 정확히 같은 선택권을 받는다.
      state.relicDraftActive = true;
      state.offers = picks.map((relic) => ({
        kind: "relic",
        cost: relic.cost,
        relic,
        label: relic.name,
        sublabel: relic.want,
      }));
      return;
    }
  }

  state.relicDraftActive = false;
  const offers: Offer[] = [];
  const owned = state.ally.filter((c): c is Cat => c !== null);
  // 빈 칸이 아니라 보유 한도로 판단한다. 5x5에는 칸이 늘 남아 있다.
  const hasFreeSlot = owned.length < unitCap(state.wave);
  const pool = shuffle([...BREEDS]);

  if (hasFreeSlot) {
    for (const b of pool.slice(0, 2)) {
      offers.push({
        kind: "recruit",
        cost: recruitCost(b.cost, owned.length),
        breed: b,
        label: b.name,
        // 값이 왜 올랐는지 카드가 말해야 한다. 아무 설명 없이 4가 13이 되면
        // 그냥 이상한 가격이지, 결정이 아니다.
        sublabel:
          owned.length > BALANCE.recruitFreeUpTo
            ? `${CLASS_LABEL[b.cls]} 데려오기 · 자리가 좁아 비싸요`
            : `${CLASS_LABEL[b.cls]} 데려오기`,
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
      setNotice(state, "자리가 다 찼어요");
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
  const completedRelicDraft = state.relicDraftActive && offer.kind === "relic";
  // 유물 세 장은 드래프트다. 하나를 고른 뒤 다른 유물까지 연달아 사면
  // "택1"이 아니라 할인 상점이 되므로 같은 묶음의 유물 카드를 모두 닫는다.
  state.offers = state.offers.map((o) =>
    o === offer || (offer.kind === "relic" && o?.kind === "relic") ? null : o,
  );
  applySynergies(state);
  if (completedRelicDraft) {
    // 택1을 끝낸 즉시 같은 보상 화면에 원래 영입·강화 세 장을 연다. 유물
    // 드래프트가 보스 전후의 일반 구매 기회를 빼앗지 않게 하는 핵심 전이다.
    state.relicDraftActive = false;
    rollOffers(state);
  }
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
  if (state.relicDraftActive) {
    setNotice(state, "유물은 하나를 고르거나 건너뛰세요");
    return false;
  }
  // 상점 칸이 준 무료 횟수를 먼저 쓴다. 생선을 아끼는 게 아니라 카드를 더
  // 보라고 준 것이므로, 있을 때 안 쓰면 그 보상이 사라진 것과 같다.
  if (state.freeRerolls > 0) {
    state.freeRerolls -= 1;
    rollOffers(state);
    setNotice(state, "");
    return true;
  }
  if (state.gold < REROLL_COST) {
    setNotice(state, "생선이 조금 모자라요");
    return false;
  }
  state.gold -= REROLL_COST;
  rollOffers(state);
  setNotice(state, "");
  return true;
}

export function startBattle(state: RunState): void {
  // 전투는 준비 국면에서만 시작한다. 보상 화면의 유물 드래프트를 건너뛸 때
  // `leaveShop`은 일반 카드 세 장을 열고 reward에 남는데, 같은 버튼 호출이
  // 이어서 여기까지 들어오더라도 준비 구매를 통째로 건너뛰면 안 된다.
  if (state.phase !== "prepare") return;
  if (livingCats(state.ally).length === 0) {
    setNotice(state, "한 마리는 세워주세요");
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
      // 달리던 목표도 지운다. `state.pending`과 같은 부류다 — 지난 전투에서
      // 시킨 것이 남으면 새 전투 첫 틱에 터진다. 여기서는 배치한 자리를 떠나
      // 지난 판의 좌표로 뛰어가고, moveLock은 방금 0으로 밀렸으므로 걸음까지
      // 겹쳐 한 스텝에 열 배로 움직인다.
      c.dash = null;
      c.vulnerableMs = 0;
      c.strikeCombo = 0;
      c.vulnerableUsed = false;
    }
  }
  // 개입 상태는 전투마다 초기화한다. 남아 있으면 다음 전투 첫 틱에 한꺼번에 터진다.
  state.pending.length = 0;
  state.actCooldown = 0;
  // 소환수는 전투 밖에서 존재하지 않는다. 남겨 두면 다음 판을 지난 판의
  // 분신과 함께 시작하고, 그 분신은 이미 사라진 주인을 uid로 가리킨다.
  state.summons.length = 0;
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
  setNotice(state, "");
}

export function finishWave(state: RunState, won: boolean, reason: "wipe" | "timeout" = "wipe"): void {
  // 소환수는 전투 안에서만 산다. `startBattle`에서만 비우면 보상·지도
  // 화면 내내 지난 판의 분신이 남는다(불변식 검사에서 678회 걸렸다).
  state.summons.length = 0;
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
    recordOutcome(state);
    setNotice(state, `악몽 깊이 ${state.wave} 도달`);
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
      setNotice(state, `정예 격파 — ${pick.name}`);
    }
  }
  /**
   * 보스 처치 보너스. 정예가 유물을 남기듯 보스는 생선을 더 남긴다.
   *
   * `goldForWave`가 이미 얹은 보스 배수(1.5)와는 다른 축이다 — 그건 "이 웨이브의
   * 성격"이 매기는 값이고, 이건 "보스를 넘겼다"는 사건 자체가 매기는 값이다.
   * `state.nodeKind`를 wave 증가 전에 미리 `kind`로 잡아 뒀으므로 여기서 그대로 쓴다.
   */
  // 걸음 서수가 위상을 가른다 — 0이면 중간보스, 그 뒤는 스테이지 우두머리.
  // step은 아래에서 +1 되기 전이므로 아직 이 보스전의 걸음이다.
  const stageBoss = kind === "boss" && bossOrdinalInStage(state.step) > 0;
  const finishedContract = kind === "boss" ? activeRaidContract(state) : null;
  const bossBonus = kind === "boss"
    ? Math.round(
        (BALANCE.goldBase + state.wave * BALANCE.goldPerWave) *
          (stageBoss ? BALANCE.stageBossKillBonusMul : BALANCE.bossKillBonusMul),
      )
    : 0;
  if (bossBonus > 0) state.gold += bossBonus;
  const contractBonus = finishedContract?.rewardFish ?? 0;
  if (contractBonus > 0) {
    state.gold += contractBonus;
    state.raidBonusFish += contractBonus;
    state.raidContractsWon += 1;
    state.lastRaidContract = finishedContract;
  }
  state.wave += 1;
  state.step += 1;
  // 걸음이 한 바퀴 돌았으면 새 지도를 만든다.
  syncStage(state);
  state.nodeKind = null;
  state.nodeWave = null;
  if (kind === "boss") {
    state.raidContract = null;
    state.raidTargetBossIndex = -1;
    // 다음에 어떤 지도 칸을 골라도 첫 보상 화면이 같은 유물 택1을 연다.
    // `wave % 3` 같은 시간 조건은 정찰이 wave를 먼저 올리는 탓에 경로별로
    // 드래프트가 사라졌으므로, 보스 승리라는 사건 자체를 상태로 넘긴다.
    state.relicDraftPending = true;
    state.relicDraftActive = false;
  }
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
  if (kind === "boss") openNextRaidContracts(state);
  // 보스 처치가 가장 큰 사건이므로 목표 갱신 안내보다 우선한다. 그 무게는
  // 문구가 아니라 noticeKind로 전달한다 — render.ts가 "boss"만 금색으로 키워 그린다.
  if (bossBonus > 0) {
    // HUD의 "+N" 팝업은 웨이브 수입까지 합친 값이라 이 알림과 수가 다르다.
    // "보너스"를 박아 서로 다른 것을 세고 있음을 문구가 직접 말하게 한다.
    setNotice(
      state,
      `${stageBoss ? "우두머리 격파" : "보스 처치"}! 보너스 +${bossBonus}${contractBonus > 0 ? ` · 계약 +${contractBonus}` : ""}`,
      "boss",
    );
  } else if (refreshed) {
    setNotice(state, "새 목표가 생겼어요");
  } else {
    setNotice(
      state,
      `한 걸음 넘었어요 · 생선 +${goldForWave(state.wave - 1, kind === "elite" ? "snipe" : kind === "boss" ? "boss" : null)}`,
    );
  }
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
