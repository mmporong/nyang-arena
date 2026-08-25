import {
  clearBattleFx,
  combatFeedbackObservation,
  hazardZones,
  queueIntervention,
  spawnArrivalFx,
  spawnFxStressFixture,
  spawnLevelUpFx,
  stepBattle,
} from "./game/battle.ts";
import { BALANCE } from "./game/balance.ts";
import {
  dispatchGameInput,
  executeGameInputAction,
  type GameInputEffects,
  type GameInputDispatch,
  type GameInputEvent,
} from "./game/input.ts";
import {
  activateBoardCell,
  boardCellPositionLabel,
  cancelBoardPickup,
  deriveAccessibilityModel,
  deriveBattleAlert,
  derivePoliteAnnouncement,
} from "./game/accessibility.ts";
import {
  createAccessibilityDomBridge,
  isNativeInteractiveTarget,
} from "./game/accessibility-dom.ts";
import { computeLayout, type Layout } from "./game/layout.ts";
import {
  captureMapChoiceFeedback,
  clearOfferPurchaseFailure,
  render,
  renderCacheObservation,
  spriteFallbackDrawCount,
  spawnBuyTween,
  spawnMapChoiceFeedback,
  spawnNextRunFeedback,
  spawnOfferPurchaseFailure,
  spawnRerollFeedback,
  setRaidContractFocusIndex,
  type DragState,
} from "./game/render.ts";
import { backdropCacheObservation } from "./game/backdrop.ts";
import { createFramePerformanceObserver } from "./game/performance.ts";
import {
  buyOffer,
  chooseNode,
  chooseRaidContract,
  chooseSharedRaidContract,
  leaveShop,
  moveCat,
  newRun,
  nextRunFrom,
  rerollOffers,
  setNotice,
  startBattle,
  type NextChoice,
  type RunState,
} from "./game/run.ts";
import { parseRaidSeed, parseRaidShareCode, raidShareCode } from "./game/raid.ts";
import { nodeInfo } from "./game/map.ts";
import { RAID_CONTRACT_POOL_STATUS } from "./validate/raid-contract-schema.ts";
import { cellToField, type Intervention } from "./game/types.ts";
import { loadSprites, spriteStatus } from "./game/sprites.ts";
import { loadIcons } from "./game/icons.ts";
import {
  createBossSignalObserver,
  isMuted,
  playBossSignal,
  setAudioVisibility,
  setBed,
  toggleMute,
  unlockAudio,
} from "./game/audio.ts";

const app = document.getElementById("app");
const boot = document.getElementById("boot");
if (!app) throw new Error("#app를 찾을 수 없습니다");

const canvas = document.createElement("canvas");
const ctx = canvas.getContext("2d");
if (!ctx) throw new Error("2D 캔버스를 만들 수 없습니다");
canvas.tabIndex = 0;
canvas.setAttribute("role", "application");
canvas.setAttribute("aria-label", "냥 아레나 게임 화면");
app.appendChild(canvas);

if (RAID_CONTRACT_POOL_STATUS.usingFallback) {
  console.warn("악몽 계약 출고 풀 거절 — 안전 계약 세 장으로 폴백", RAID_CONTRACT_POOL_STATUS);
}

let layout: Layout = computeLayout(800, 600);
const initialUrl = new URL(location.href);
const debugEnabled = initialUrl.searchParams.get("debug") === "1";
const framePerformance = debugEnabled ? createFramePerformanceObserver() : null;
const initialRaidRaw = initialUrl.searchParams.get("raid");
const initialSeedRaw = initialUrl.searchParams.get("seed");
const initialRaid = parseRaidShareCode(initialRaidRaw);
const initialSeed = initialRaid?.seed ?? parseRaidSeed(initialSeedRaw);
let state: RunState = newRun(initialSeed ?? undefined);
if (initialRaid) {
  chooseSharedRaidContract(state, initialRaid.contractId);
  // 공유 주소가 우선한다. 두 시드 표현을 남겨 모순된 링크를 만들지 않는다.
  if (initialSeedRaw) {
    initialUrl.searchParams.delete("seed");
    history.replaceState(null, "", initialUrl);
  }
} else if (initialRaidRaw) {
  // 잘못된 공유 코드는 새 런으로 안전하게 폴백하고 주소에서도 걷어 낸다.
  initialUrl.searchParams.delete("raid");
  history.replaceState(null, "", initialUrl);
}
if (initialSeedRaw && parseRaidSeed(initialSeedRaw) === null) {
  initialUrl.searchParams.delete("seed");
  history.replaceState(null, "", initialUrl);
}
const drag: DragState = { active: false, fromCell: -1, x: 0, y: 0, pointerId: -1, hoverX: -1, hoverY: -1 };
let hoverCell = -1;

interface RuntimeObservation {
  assetsReady: boolean;
  booted: boolean;
  frameCount: number;
  paused: boolean;
  lastDt: number;
  lastBattleDt: number;
  totalBattleRawMs: number;
  totalBattleAppliedMs: number;
  resumeFirstDt: number | null;
  resizeCount: number;
  orientationCount: number;
  visibilityCount: number;
  resumeCount: number;
  actionCounts: Record<string, number>;
  lastInput: Readonly<Record<string, unknown>> | null;
  lastResize: Readonly<{
    width: number;
    height: number;
    dpr: number;
    backingWidth: number;
    backingHeight: number;
  }> | null;
}

// `?debug=1` 하네스가 읽는 관찰값이다. 판정에는 들어가지 않으며 기본 URL에는
// 노출되지 않는다. 객체는 이 모듈만 쓰고, 창에는 매번 복사본만 건넨다.
const runtimeObservation: RuntimeObservation = {
  assetsReady: false,
  booted: false,
  frameCount: 0,
  paused: document.hidden,
  lastDt: 0,
  lastBattleDt: 0,
  totalBattleRawMs: 0,
  totalBattleAppliedMs: 0,
  resumeFirstDt: null,
  resizeCount: 0,
  orientationCount: 0,
  visibilityCount: 0,
  resumeCount: 0,
  actionCounts: {},
  lastInput: null,
  lastResize: null,
};

/**
 * 페이즈가 바뀐 시각. 전환 직후 짧게 입력을 잠근다.
 *
 * 전멸이나 보스 처치는 stepBattle 루프 **안에서** 일어나므로, 회피를 연타하던
 * 손가락의 다음 탭이 이미 gameover가 된 화면에 도착한다. 그러면 그 탭이
 * newRun()을 불러 도달 웨이브 화면을 보기도 전에 런이 사라지고, 보스 처치
 * 직후라면 1.5배 보상 상점을 통째로 건너뛴다.
 *
 * 히트테스트를 페이즈로 분기해도 못 막는다 — 탭이 도착한 시점에는 이미
 * 페이즈가 바뀌어 있다. 시간으로 막아야 한다.
 */
let phaseChangedAt = 0;
let lastPhase: RunState["phase"] = state.phase;
const observeBossSignals = createBossSignalObserver(playBossSignal);

/* ------------------------------------------------------------------ */
/* 계측                                                                 */
/* ------------------------------------------------------------------ */

/**
 * 실제 플레이 시간을 잰다.
 *
 * 지금까지 "한 판 12분"이라고 써 왔는데 **근거가 없었다.** 헤드리스 시뮬은
 * 웨이브 수만 세고, 사람이 상점에서 고민하는 시간이나 배치를 만지는 시간은
 * 세지 않는다. 외부 검토가 이걸 P1으로 잡았다 — 측정 안 된 숫자를 공개 문서에
 * 적고 있었다.
 *
 * 네트워크는 쓰지 않는다. 브라우저 안에 쌓고 사람이 꺼내 간다.
 * `window.nyangTelemetry()`가 JSON을 돌려준다.
 */
interface Telemetry {
  startedAt: number;
  endedAt: number | null;
  wave: number;
  /** 첫 보스전에 들어간 시각(판 시작 기준 ms). 심사자가 핵심을 보기까지의 시간. */
  firstBossAt: number | null;
  /** 첫 개입(회피·모임·약점)까지. 이게 곧 "게임이 시작된 순간"이다. */
  firstInterventionAt: number | null;
  /** 첫 화면의 계약을 고르기까지 걸린 시간. 5초 비교 목표의 실제 플레이 근거. */
  firstContractAt: number | null;
  /** 국면별 누적 시간(ms). 어디에 시간을 쓰는지가 여기서 드러난다. */
  phaseMs: Record<string, number>;
}

let telem: Telemetry = freshTelemetry();
const finished: Telemetry[] = [];
let phaseEnteredAt = performance.now();

function freshTelemetry(): Telemetry {
  return {
    startedAt: performance.now(),
    endedAt: null,
    wave: 1,
    firstBossAt: null,
    firstInterventionAt: null,
    firstContractAt: null,
    phaseMs: { prepare: 0, battle: 0, reward: 0, map: 0, gameover: 0 },
  };
}

/** 국면이 끝날 때 그 국면에 머문 시간을 더한다. */
function closePhase(now: number, phase: string): void {
  telem.phaseMs[phase] = (telem.phaseMs[phase] ?? 0) + (now - phaseEnteredAt);
  phaseEnteredAt = now;
}

function markIntervention(): void {
  if (telem.firstInterventionAt === null) {
    telem.firstInterventionAt = Math.round(performance.now() - telem.startedAt);
  }
}

function syncRaidUrl(): void {
  // 공유 코드는 첫 보스 계약을 재현하는 NA1 포맷이다. 이후 보스 계약으로
  // 주소를 덮어쓰면 새 탭에서 그 계약이 첫 보스에 적용되어 의미가 달라진다.
  if (!state.raidContract || state.raidTargetBossIndex !== 0) return;
  const url = new URL(location.href);
  url.searchParams.delete("seed");
  url.searchParams.set("raid", raidShareCode(state.seed, state.raidContract.id));
  history.replaceState(null, "", url);
}

function selectRaidContract(idx: number): boolean {
  if (!chooseRaidContract(state, idx)) return false;
  if (telem.firstContractAt === null) {
    telem.firstContractAt = Math.round(performance.now() - telem.startedAt);
  }
  syncRaidUrl();
  return true;
}

let boardFocusIndex = Math.max(0, state.ally.findIndex(Boolean));
let boardPickedFrom: number | null = null;
let battleAlertIdentity: string | null = null;
let accessibilityAnnouncementSequence = 0;

function accessibilityPhaseKey(): string {
  return deriveAccessibilityModel(state, isMuted(), {
    boardFocusIndex,
    pickedFrom: boardPickedFrom,
    stacked: layout.stacked,
  }).phaseKey;
}

const accessibilityBridge = createAccessibilityDomBridge(app, {
  activate(control) {
    routeInput({ kind: "direct-action", action: control.action });
    syncAccessibility();
  },
  focus(control) {
    setRaidContractFocusIndex(control?.action.kind === "raid-contract" ? control.action.index : -1);
  },
  boardFocus(index) {
    if (boardFocusIndex === index) return;
    boardFocusIndex = index;
    syncAccessibility();
  },
  boardActivate(index) {
    const before = boardPickedFrom;
    const activation = activateBoardCell(state, index, boardPickedFrom);
    if (activation.action) {
      const outcome = routeInput({ kind: "direct-action", action: activation.action });
      boardPickedFrom = outcome.action.kind === "move-cat" ? activation.pickedFrom : before;
    } else {
      boardPickedFrom = activation.pickedFrom;
      if (before === null && boardPickedFrom !== null) {
        const cat = state.ally[boardPickedFrom];
        if (cat) announceAccessibilityResult(`${cat.breed.name} 집음. 옮길 칸을 고르세요.`);
      } else if (before !== null && boardPickedFrom === null) {
        announceAccessibilityResult("배치 선택을 취소했습니다.");
      }
    }
    syncAccessibility();
  },
  boardCancel() {
    if (boardPickedFrom === null) return;
    boardPickedFrom = cancelBoardPickup();
    announceAccessibilityResult("배치 선택을 취소했습니다.");
    syncAccessibility();
  },
});

function announceAccessibilityResult(text: string, previousPhaseKey: string | null = null): void {
  const current = derivePoliteAnnouncement(state);
  const nextModel = deriveAccessibilityModel(state, isMuted(), {
    boardFocusIndex,
    pickedFrom: boardPickedFrom,
    stacked: layout.stacked,
  });
  const message = previousPhaseKey !== null && previousPhaseKey !== nextModel.phaseKey
    ? `${text} 다음: ${nextModel.title}. ${nextModel.description}`
    : text;
  accessibilityAnnouncementSequence += 1;
  accessibilityBridge.announcePolite({
    signature: `action:${accessibilityAnnouncementSequence}:${current.signature}`,
    text: message,
  });
  // 다음 rAF의 일반 상태 공지가 방금의 구체적인 결과를 덮지 않게 현재 상태를 소비한다.
  accessibilityBridge.consumePolite(current);
}

function syncAccessibility(): void {
  if (state.phase !== "reward" && state.phase !== "prepare") boardPickedFrom = null;
  if (boardPickedFrom !== null && !state.ally[boardPickedFrom]) boardPickedFrom = null;
  const model = deriveAccessibilityModel(state, isMuted(), {
    boardFocusIndex,
    pickedFrom: boardPickedFrom,
    stacked: layout.stacked,
  });
  if (canvas.getAttribute("aria-label") !== model.canvasLabel) canvas.setAttribute("aria-label", model.canvasLabel);
  accessibilityBridge.sync(model);
  accessibilityBridge.announcePolite(derivePoliteAnnouncement(state));

  const alert = deriveBattleAlert(state, battleAlertIdentity);
  if (alert) {
    accessibilityBridge.announceAlert(alert);
    battleAlertIdentity = alert.activeIdentity;
  } else if (state.phase !== "battle") {
    battleAlertIdentity = null;
  }
}

Object.defineProperty(window, "nyangTelemetry", {
  value: () => ({
    current: { ...telem, elapsedMs: Math.round(performance.now() - telem.startedAt) },
    finished,
    // 사람이 바로 읽을 수 있는 요약. 판이 여럿 쌓여야 뜻이 생긴다.
    summary:
      finished.length === 0
        ? "아직 끝난 판이 없다"
        : (() => {
            const durs = finished.map((t) => (t.endedAt ?? 0) - t.startedAt).sort((a, b) => a - b);
            const p = (q: number) => Math.round(durs[Math.min(durs.length - 1, Math.floor(durs.length * q))]! / 1000);
            const firstBoss = finished.map((t) => t.firstBossAt).filter((v): v is number => v !== null);
            return {
              runs: finished.length,
              durationSec: { p50: p(0.5), p90: p(0.9), max: p(1) },
              firstBossSec: firstBoss.length
                ? Math.round(firstBoss.reduce((a, b) => a + b, 0) / firstBoss.length / 1000)
                : null,
            };
          })(),
  }),
});
const PHASE_LOCK_MS = 350;

/*
 * 탭/꾹을 가르던 `HOLD_MS`와 누름 상태는 지웠다. 개입이 버튼 하나가 되면서
 * "얼마나 오래 눌렀나"가 아무 뜻도 갖지 않게 됐다.
 */

function resize(): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = app!.clientWidth;
  const h = app!.clientHeight;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx!.imageSmoothingEnabled = false;
  layout = computeLayout(w, h, state.phase !== "battle");
  if (debugEnabled) {
    runtimeObservation.resizeCount += 1;
    runtimeObservation.lastResize = {
      width: w,
      height: h,
      dpr,
      backingWidth: canvas.width,
      backingHeight: canvas.height,
    };
  }
  // 드래그 중 회전하거나 주소창이 접히면 보드 위치가 통째로 바뀐다.
  // 옛 레이아웃으로 잡은 출발 셀을 새 레이아웃 좌표에 드롭하면 엉뚱한 칸으로 간다.
  routeInput({ kind: "resize" });
}

function pointerPos(e: PointerEvent): { x: number; y: number } {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

/**
 * 배치를 바꿀 수 있는 페이즈.
 *
 * **구매와 배치를 한 화면으로 합쳤다.** 전에는 흐름이 지도 → 보상(구매) →
 * 준비(배치) → 전투였는데, 둘을 가른 이유가 설계가 아니라 레이아웃이었다 —
 * 좁은 화면에서 카드가 판을 덮으므로 그동안 판이 입력을 안 받게 해 둔 것이다.
 * 폰을 배제하면서 그 제약이 사라졌다. 데스크톱(세로줄 구성)에서는 카드가
 * 판을 **0% 덮는다**(기기별 실측은 `npm run probe`).
 *
 * 합치는 것이 낫다고 본 이유는 화면 수가 아니라 **결정의 순서**다. 무엇을
 * 살지와 어디에 놓을지는 같은 판단의 앞뒤인데, 화면이 갈려 있으면 카드를
 * 고를 때 보드를 못 보고 보드를 만질 때 카드를 못 본다. 유물이 배치 조건을
 * 갖게 되면서(`relics.ts`) 그 둘은 더 붙었다 — "앞줄에 근접 셋"을 요구하는
 * 유물을 살지 말지는 지금 보드를 봐야 정할 수 있다.
 *
 * `prepare`는 국면 기계에 남는다. UI는 이제 그 화면을 안 그리지만(보상에서
 * 바로 전투로 넘어간다) `startBattle` 직전의 자리로서 실재하고, 무엇보다
 * 헤드리스 하네스 열여섯 개가 그 전이를 기준으로 계측한다.
 */
function onPrimaryAction(): void {
  switch (state.phase) {
    case "prepare":
      startBattle(state);
      break;
    case "battle":
      break;
    case "reward":
      // 전이는 run.ts가 갖는다. 여기 인라인으로 두면 측정 스크립트와 갈라진다.
      // 정찰 칸은 싸우지 않는다 — leaveShop이 지도로 보낸다. 나머지는 준비를
      // 거쳐 전투로 가는데, 구매와 배치가 한 화면이 됐으므로 그 준비 화면에서
      // 멈출 이유가 없다. 여기서 바로 넘긴다.
      //
      // 판단 기준을 `phase`가 아니라 `nodeKind`로 두는 것은 취향이 아니다 —
      // switch가 이미 phase를 "reward"로 좁혀 놔서 leaveShop 뒤의 phase를
      // 읽으면 타입이 그럴 리 없다고 한다.
      {
        const fights = state.nodeKind !== "shop";
        leaveShop(state);
        if (fights) startBattle(state);
      }
      break;
    case "map":
      break;
    case "gameover":
      startNextRun("again");
      break;
  }
}

/**
 * 죽은 화면에서 다음 판으로. 어느 갈래든(큰 버튼·세 버튼·키) 여기를 지난다.
 * 새 판의 막이 오른다. 첫 부팅 때는 아직 잠겨 있어 안 울리고, 여기서부터는
 * 울린다 — 소리는 사용자 입력 없이 못 낸다.
 */
function startNextRun(choice: NextChoice): void {
  clearBattleFx();
  runtimeObservation.lastBattleDt = 0;
  runtimeObservation.totalBattleRawMs = 0;
  runtimeObservation.totalBattleAppliedMs = 0;
  state = nextRunFrom(state, choice);
  const url = new URL(location.href);
  url.searchParams.delete("raid");
  history.replaceState(null, "", url);
  spawnNextRunFeedback(choice);
}

/**
 * 지금 깔릴 곡.
 *
 * `setBed`는 같은 곡을 다시 부르면 아무 일도 안 하므로 **매 프레임 불러도
 * 된다.** 그래서 여기에는 "국면이 바뀌었나"를 기억하는 코드가 없다. 그 기억을
 * 여기에 또 두면 언젠가 `state`와 갈라진다.
 *
 * 일반 전투에 전용 곡이 없는 것은 의도다 — 측정해 보니 3~4초다. 3초짜리 곡은
 * 곡이 아니고, 매 걸음 음악이 바뀌면 판이 토막 난다. 준비곡이 그대로 흐른다.
 */
function musicFor(s: RunState): "prepare" | "boss" | "outro" {
  if (s.phase === "gameover") return "outro";
  if (s.phase === "battle" && s.nodeKind === "boss") return "boss";
  return "prepare";
}

/**
 * 개입은 **버튼 하나**다.
 *
 * 전에는 짧게 누르면 흩어짐, 길게 누르면 뭉침이었다(키보드로는 Space/Shift).
 * 손가락 하나로 해야 하는 화면의 제약에서 나온 설계인데, 그 제약을 마우스와
 * 키보드가 있는 자리에까지 물려줄 이유가 없었고 무엇보다 **1.2초 안에 조작
 * 방식까지 고르라는 것은 이 게임이 요구할 만한 판단이 아니었다.**
 *
 * 무엇을 할지는 `stepBattle`의 `resolveIntent`가 정한다. 화면에서 한 번,
 * 거기서 또 한 번 고르면 브라우저와 헤드리스 시뮬이 갈라진다.
 */



/**
 * 산 것이 판 어디에 나타났는지 알린다.
 *
 * 카드를 누르면 생선이 줄고 카드가 사라지는데, 정작 **무엇이 어디에 생겼는지**는
 * 보드를 뒤져야 알 수 있었다. 사기 전후의 보드를 견줘서 달라진 칸을 찾고 그
 * 자리에서 터뜨린다 — `buyOffer`가 어느 칸을 골랐는지 밖에서 다시 계산하지
 * 않으므로, 배치 규칙이 바뀌어도 이 코드는 안 따라 바뀐다.
 *
 * 연출 전용이다. 판정에는 관여하지 않으므로 헤드리스 시뮬과 갈라지지 않는다.
 */
function buyWithFx(offer: NonNullable<RunState["offers"][number]>): boolean {
  const before = state.ally.map((c) => (c ? { uid: c.uid, level: c.level } : null));
  // buyOffer가 성공하면 이 슬롯을 null로 비운다. 트윈이 어디서 출발했는지는
  // 그 전에 잡아 둬야 한다.
  const slot = state.offers.indexOf(offer);
  if (!buyOffer(state, offer)) {
    if (slot >= 0 && state.gold < offer.cost) spawnOfferPurchaseFailure(slot, offer);
    return false;
  }
  clearOfferPurchaseFailure();
  setNotice(state, "");
  // 유물처럼 보드 칸이 안 바뀌는 구매도 있다 — 그런 카드는 보드 한가운데를
  // 향해 날아간다(spawnBuyTween이 처리한다).
  let landedCell: number | null = null;
  state.ally.forEach((c, i) => {
    if (!c) return;
    const was = before[i];
    const { fx, fy } = cellToField("ally", i);
    if (!was || was.uid !== c.uid) {
      spawnArrivalFx(fx, fy);
      landedCell = i;
    } else if (c.level > was.level) {
      spawnLevelUpFx(fx, fy, c.level);
      landedCell = i;
    }
  });
  if (slot >= 0) spawnBuyTween(offer, slot, landedCell);
  return true;
}

/** 지도 전이는 즉시 적용하고, 성공한 선택의 위치만 렌더 전용으로 남긴다. */
function chooseNodeWithFeedback(idx: number): boolean {
  const feedback = captureMapChoiceFeedback(layout, state, idx);
  if (!chooseNode(state, idx)) {
    setNotice(state, "그 길로는 갈 수 없어요");
    return false;
  }
  if (feedback) spawnMapChoiceFeedback(feedback);
  return true;
}

/** 무료·유료 규칙은 run.ts에 맡기고 실제 결과와 일치하는 피드백만 낸다. */
function rerollWithFeedback(): boolean {
  const success = rerollOffers(state);
  if (success) clearOfferPurchaseFailure();
  spawnRerollFeedback(success);
  return success;
}

const inputEffects: GameInputEffects = {
  mute: () => {
    const muted = toggleMute();
    announceAccessibilityResult(muted ? "효과음을 껐습니다." : "효과음을 켰습니다.");
  },
  primary: () => {
    const previousPhaseKey = accessibilityPhaseKey();
    const previousPhase = state.phase;
    onPrimaryAction();
    if (previousPhaseKey !== accessibilityPhaseKey()) {
      const result = previousPhaseKey === "reward:relics"
        ? "유물을 건너뛰었습니다."
        : previousPhase === "gameover"
          ? "새 런을 시작했습니다."
          : state.phase === "battle"
            ? "전투를 시작했습니다."
            : "다음 길로 이동했습니다.";
      announceAccessibilityResult(result, previousPhaseKey);
    }
  },
  intent: pushIntent,
  runChoice: (choice) => {
    const previousPhaseKey = accessibilityPhaseKey();
    startNextRun(choice);
    const label = choice === "retry"
      ? "같은 시드로 다시 도전합니다."
      : choice === "daily"
        ? "오늘의 시드를 시작합니다."
        : choice === "challenge"
          ? "다음 도전 단계를 시작합니다."
          : "새 런을 시작합니다.";
    announceAccessibilityResult(label, previousPhaseKey);
  },
  raidContract: (index) => {
    const previousPhaseKey = accessibilityPhaseKey();
    const contract = state.raidOffers[index];
    if (selectRaidContract(index) && contract) {
      announceAccessibilityResult(
        `계약 선택: ${contract.name}. 승리 보상 생선 +${contract.rewardFish}.`,
        previousPhaseKey,
      );
    }
  },
  mapNode: (index) => {
    const previousPhaseKey = accessibilityPhaseKey();
    const node = state.map.steps[state.step]?.[index];
    const info = node ? nodeInfo(node.kind) : null;
    if (chooseNodeWithFeedback(index)) {
      announceAccessibilityResult(
        `경로 확정: ${info?.name ?? "다음 길"}. ${state.notice}`.trim(),
        previousPhaseKey,
      );
    } else {
      announceAccessibilityResult(state.notice || "그 길로는 갈 수 없습니다.");
    }
  },
  reroll: () => {
    const success = rerollWithFeedback();
    announceAccessibilityResult(success ? "새 제안을 가져왔습니다." : state.notice || "다시 뽑을 수 없습니다.");
  },
  offer: (index) => {
    const previousPhaseKey = accessibilityPhaseKey();
    const offer = state.offers[index];
    if (!offer) return;
    const success = buyWithFx(offer);
    if (!success && state.gold < offer.cost) setNotice(state, "생선이 조금 모자라요");
    announceAccessibilityResult(
      success
        ? `${offer.kind === "upgrade" ? "강화" : "구매"} 완료: ${offer.label}.`
        : state.notice || `${offer.label}을 선택할 수 없습니다.`,
      previousPhaseKey,
    );
  },
  moveCat: (from, to) => {
    const cat = state.ally[from];
    moveCat(state, from, to);
    if (cat && from !== to) {
      announceAccessibilityResult(`${cat.breed.name} 배치 완료. ${boardCellPositionLabel(to, layout.stacked)}.`);
    }
  },
};

/** DOM 이벤트는 좌표만 정규화하고, 실제 입력 정책은 Node 테스트와 같은 경계를 지난다. */
function routeInput(event: GameInputEvent): GameInputDispatch {
  // resize는 입력 정책을 정리하는 내부 신호다. 사용자가 실제로 누른 마지막
  // 키·포인터를 덮지 않아 CDP가 DOM 입력 경계를 그대로 확인할 수 있게 한다.
  if (
    debugEnabled
    && event.kind !== "resize"
    && event.kind !== "pointer-move"
    && event.kind !== "lost-pointer-capture"
  ) {
    runtimeObservation.lastInput = { ...event };
  }
  const outcome = dispatchGameInput(
    {
      state,
      layout,
      drag,
      phaseLocked: performance.now() - phaseChangedAt < PHASE_LOCK_MS,
    },
    event,
  );
  Object.assign(drag, outcome.drag);
  if (outcome.hoverCell !== undefined) hoverCell = outcome.hoverCell;
  if (outcome.unlockAudio) unlockAudio();
  if (outcome.action.kind !== "none") {
    runtimeObservation.actionCounts[outcome.action.kind] = (runtimeObservation.actionCounts[outcome.action.kind] ?? 0) + 1;
  }
  executeGameInputAction(outcome.action, inputEffects);
  return outcome;
}

canvas.addEventListener("pointerdown", (e) => {
  const { x, y } = pointerPos(e);
  if (routeInput({ kind: "pointer-down", pointerId: e.pointerId, x, y }).preventDefault) e.preventDefault();
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch {
    // 일부 브라우저는 활성 포인터가 아니면 던진다. 캡처는 편의 기능이므로 무시한다.
  }
});

canvas.addEventListener("pointermove", (e) => {
  routeInput({ kind: "pointer-move", pointerId: e.pointerId, ...pointerPos(e) });
});

// 캔버스 밖에서 버튼을 떼면 캔버스에는 pointerup이 오지 않는다.
// setPointerCapture가 실패했을 때도 window 경계가 소유 포인터의 drop을 마무리한다.
window.addEventListener("pointerup", (e) => {
  routeInput({ kind: "pointer-up", pointerId: e.pointerId, ...pointerPos(e) });
});
window.addEventListener("pointercancel", (e) => routeInput({ kind: "pointer-cancel", pointerId: e.pointerId }));
canvas.addEventListener("pointerleave", () => routeInput({ kind: "pointer-leave" }));
canvas.addEventListener("lostpointercapture", (e) => routeInput({ kind: "lost-pointer-capture", pointerId: e.pointerId }));
canvas.addEventListener("contextmenu", (e) => e.preventDefault());

/* ------------------------------------------------------------------ */
/* 키보드                                                               */
/* ------------------------------------------------------------------ */

/**
 * 개입 키는 평소 **하나**다. 버튼과 완전히 같은 일을 한다.
 *
 * 전에는 Space가 흩어짐, Shift가 뭉침이었다. 조작을 둘로 가른 것은 무엇을
 * 할지를 사람이 고르게 하려는 설계였는데, 1.2초짜리 예고 안에서 **장판 색을
 * 읽고 + 맞는 키를 고르는** 두 가지를 동시에 요구하는 셈이었다. 색을 읽는
 * 것까지는 이 게임이 요구할 만하지만 키를 고르는 것은 아니다.
 *
 * 무엇을 할지는 `stepBattle`의 `resolveIntent`가 정한다. 여기서 한 번,
 * 거기서 또 한 번 고르면 브라우저와 헤드리스 시뮬이 갈라진다 — 이 게임의
 * 모든 수치가 둘이 같은 코드를 돈다는 전제 위에 있다.
 *
 * **지금은 극성(polarity)에서만 예외로 키가 둘이다(C1) — `dualChoiceActive`
 * (battle.ts) 하나가 그 기준이다.** 반반 장판은 흩어짐이 아니라 "어느
 * 반쪽으로 가는가"를 사람이 정해야 하는데, 자동은 정의상 그걸 못 고른다
 * (어느 쪽이 급한지는 판 상황이 아니라 취향·팀 배치가 정한다). 그래도
 * 여전히 손가락 하나, 눈치 하나 — 새로 배울 것은 "지금 두 갈래 상황이다"와
 * "G가 반대쪽이다" 뿐이다. **G는 게이트가 닫혀 있을 때 Space·버튼과 똑같이
 * act를 넣는다** — 눌러도 손해가 없으므로 몰라도 되는 키다.
 *
 * **원버튼 폐기가 검토 중이다.** `dualChoiceActive`가 넓어지면(모든 예고에서
 * 산개/집결을 직접 고르는 쪽으로) Space·G의 분기는 그대로 두고 게이트
 * 함수만 고치면 된다 — 여기 두 케이스가 이미 그 조건 하나만 본다.
 *
 *   Space           회피/산개 (게이트가 닫혀 있으면 예고 자동 대응 · 취약 창이면 약점 공격)
 *   G               집결 (게이트가 열려 있을 때만 산개와 갈라진다 · 닫혀 있으면 Space와 동일)
 *   1 2 3           카드 구매 · R 다시 뽑기 · Enter 다음 단계
 */
/**
 * `dual` — 이 입력이 극성(polarity) 같은 두 갈래 게이트가 열린 동안 사람이
 * 직접 고른 것이라는 표시(`Intervention.dual`, types.ts). `polarityChoices`
 * 부검 카운터가 **넣는 이 순간**의 게이트 상태를 그대로 들고 가도록 큐에
 * 실어 보낸다 — 소비되는 시점에 다시 물으면 쿨다운에 막혀 늦게 소비될 때
 * 예고가 이미 꺼져 있어 분명히 골랐는데도 안 세어진다.
 */
function pushIntent(kind: Intervention["kind"] = "act", dual = false): void {
  if (state.phase !== "battle") return;
  markIntervention();
  queueIntervention(state, kind === "dodge" || kind === "gather" ? { kind, dual } : { kind });
}

window.addEventListener("keydown", (e) => {
  // 자동 반복·phase lock·음소거 우선순위는 포인터와 같은 production 경계가 정한다.
  // 네이티브 버튼이 자체 click으로 바꾸는 Enter/Space만 제외한다. 숫자·R·G·M까지
  // 막으면 패널에 포커스가 있는 동안 화면에 적힌 단축키가 전부 죽는다.
  if (e.defaultPrevented) return;
  if (isNativeInteractiveTarget(e.target) && (e.key === "Enter" || e.code === "Space")) return;
  if (routeInput({ kind: "key-down", code: e.code, repeat: e.repeat }).preventDefault) e.preventDefault();
});


/**
 * `?debug=1`일 때만 런 상태를 창에 노출한다.
 *
 * 캔버스 게임은 밖에서 들여다볼 구멍이 없어서, 버그를 잡을 때마다 픽셀 색을
 * 세어 상태를 추측하게 된다. 그러다 "회피 버튼이 안 먹는다"를 진단하는 데
 * 세 번을 헛돌았다. 읽기 전용 구멍 하나면 끝날 일이었다.
 *
 * 기본 경로에는 없다 — 플래그가 없으면 아무것도 붙지 않으므로 출고 빌드의
 * 동작과 크기에 영향이 없다.
 */
if (debugEnabled) {
  Object.defineProperty(window, "nyang", {
    get: () => ({
      phase: state.phase,
      wave: state.wave,
      gold: state.gold,
      step: state.step,
      stage: state.map.stage,
      lanes: (state.map.steps[state.step] ?? []).map((n) => n.kind),
      nodeKind: state.nodeKind,
      raidOffers: state.raidOffers.map((contract) => ({
        id: contract.id,
        name: contract.name,
        risk: contract.risk,
        rewardFish: contract.rewardFish,
      })),
      raidContract: state.raidContract
        ? {
            id: state.raidContract.id,
            name: state.raidContract.name,
            share: raidShareCode(state.seed, state.raidContract.id),
          }
        : null,
      raidContractPool: RAID_CONTRACT_POOL_STATUS,
      offers: state.offers.map((o) => (o ? { label: o.label, cost: o.cost } : null)),
      relicDraft: { pending: state.relicDraftPending, active: state.relicDraftActive },
      // 유물은 측정에서 가장 깊은 축이라 밖에서 상태를 볼 수 있어야 한다.
      // 제출용 스크린샷을 "유물을 든 상태"로 잡는 데도 이게 필요했다.
      relics: state.relics.map((r) => r.name),
      allies: state.ally.filter(Boolean).length,
      /**
       * 아군의 전장 좌표와 달리는 중인지 여부.
       *
       * 개입이 순간이동인지 달리기인지는 **스크린샷으로 판정할 수 없다.**
       * CDP 캡처 한 장에 200ms쯤 걸려서, 40ms 간격으로 찍어 달라고 해도
       * 실제로는 대시가 끝난 뒤의 장면만 남는다. 숫자로 재야 한다.
       */
      allyPos: state.ally
        .filter((c): c is NonNullable<typeof c> => c !== null && c.alive)
        .map((c) => ({ x: Math.round(c.fx * 100) / 100, y: Math.round(c.fy * 100) / 100, dash: c.dash !== null })),
      dodgeCharges: state.dodgeCharges,
      pending: [...state.pending],
      telegraphs: state.enemy.filter((c) => c?.telegraph).map((c) => c!.telegraph!.mode),
      vulnerable: state.enemy.some((c) => c?.alive && c.vulnerableMs > 0),
      battleElapsedMs: state.battleElapsed,
      combat: {
        speed: BALANCE.battleSpeed,
        battleElapsedMs: state.battleElapsed,
        timing: {
          rawActiveMs: runtimeObservation.totalBattleRawMs,
          appliedMs: runtimeObservation.totalBattleAppliedMs,
          lastRawDt: runtimeObservation.lastDt,
          lastBattleDt: runtimeObservation.lastBattleDt,
        },
        ...combatFeedbackObservation(state),
      },
      button: { ...layout.button },
      runtime: {
        ...runtimeObservation,
        actionCounts: { ...runtimeObservation.actionCounts },
        lastInput: runtimeObservation.lastInput ? { ...runtimeObservation.lastInput } : null,
        lastResize: runtimeObservation.lastResize ? { ...runtimeObservation.lastResize } : null,
        sprites: spriteStatus(),
        spriteFallbackDraws: spriteFallbackDrawCount(),
        accessibility: accessibilityBridge.observation(),
      },
    }),
  });
  Object.defineProperty(window, "nyangPerformance", {
    get: () => ({
      frames: framePerformance!.snapshot(),
      caches: {
        backdrop: backdropCacheObservation(),
        ...renderCacheObservation(),
      },
    }),
  });
  Object.defineProperty(window, "nyangQa", {
    value: Object.freeze({
      startFxStress: () => {
        clearBattleFx();
        framePerformance!.clear();
        return spawnFxStressFixture();
      },
      stopFxStress: () => {
        clearBattleFx();
        framePerformance!.clear();
      },
    }),
  });
}

let last = 0;
let rafId: number | null = null;
let awaitingResumeFrame = false;

/** 실행 가능한 동안 rAF를 정확히 하나만 예약한다. */
function scheduleFrame(): void {
  if (!runtimeObservation.booted || runtimeObservation.paused || rafId !== null) return;
  rafId = requestAnimationFrame(frame);
}

function frame(now: number): void {
  const workStartedAt = framePerformance ? performance.now() : 0;
  // 이 콜백이 소비한 예약을 먼저 비운다. 이후 경로는 scheduleFrame 하나만 쓴다.
  rafId = null;
  // visibilitychange와 같은 태스크 경계에서 이미 실행 대기 중이던 콜백도
  // 판정·렌더 전에 멈춘다. 숨은 탭은 단 한 스텝도 진행하지 않는다.
  if (document.hidden || runtimeObservation.paused) {
    runtimeObservation.paused = true;
    last = 0;
    return;
  }
  if (state.phase !== lastPhase) {
    // 카드가 뜨고 지는 국면에서 아래 띠의 높이가 달라진다. 그때만 판을 다시
    // 잡는다 — 전투 중에 다시 잡으면 유닛이 눈앞에서 크기가 변한다.
    const wasBattle = lastPhase === "battle";
    closePhase(now, lastPhase);
    if (state.phase === "battle" && telem.firstBossAt === null && state.enemy.some((c) => c?.radius && c.radius > 0)) {
      telem.firstBossAt = Math.round(now - telem.startedAt);
    }
    telem.wave = state.wave;
    if (state.phase === "gameover") {
      telem.endedAt = now;
      finished.push(telem);
      // 다음 판은 '다시 도전'을 누른 순간부터가 아니라 여기서부터 잰다.
      // 죽은 화면을 보는 시간은 판이 아니다.
    } else if (lastPhase === "gameover") {
      telem = freshTelemetry();
      phaseEnteredAt = now;
    }
    lastPhase = state.phase;
    phaseChangedAt = now;
    if (wasBattle !== (state.phase === "battle")) resize();
  }
  const rawDt = last === 0 ? 16 : now - last;
  const dt = Math.min(100, rawDt);
  last = now;
  if (debugEnabled) {
    runtimeObservation.frameCount += 1;
    runtimeObservation.lastDt = dt;
  }
  if (debugEnabled && awaitingResumeFrame) {
    runtimeObservation.resumeFirstDt = dt;
    awaitingResumeFrame = false;
  }
  /**
   * 화면 체감용 배속(`BALANCE.battleSpeed`)은 **여기, 실시간 dt에만** 곱한다.
   * `scripts/`의 헤드리스 하네스는 `stepBattle(s, 100)`을 직접 부르므로 이
   * 곱셈을 거치지 않는다 — 그래서 배속을 바꿔도 sim·invariants 수치는
   * 그대로다. 이건 밸런스가 아니라 표현이라는 근거가 바로 이 분리다.
   */
  const battleActive = state.phase === "battle";
  const battleDt = dt * BALANCE.battleSpeed;
  if (debugEnabled) {
    runtimeObservation.lastBattleDt = battleActive ? battleDt : 0;
    if (battleActive) {
      runtimeObservation.totalBattleRawMs += dt;
      runtimeObservation.totalBattleAppliedMs += battleDt;
    }
  }
  // 판정은 반속, 순수 transient feedback은 실시간 수명으로 흘려 잔상 과밀을 막는다.
  stepBattle(state, battleDt, dt);
  observeBossSignals({
    phase: state.phase,
    zones: hazardZones(state),
    bosses: state.enemy,
  });
  setBed(musicFor(state));
  syncAccessibility();
  render(ctx!, layout, state, drag, hoverCell, performance.now() - phaseChangedAt < PHASE_LOCK_MS);
  framePerformance?.observe({
    phase: state.phase,
    frameWorkMs: performance.now() - workStartedAt,
    rafTimestampMs: now,
  });
  /**
   * 탭이 숨겨지면 루프를 세운다. 브라우저는 숨은 탭의 rAF를 1fps 안팎으로 줄이는데, 그 틈에
   * `dt`가 100ms로 잘려 게임 시간이 10분의 1 속도로 기어가고 배터리는 계속 쓴다. 세워 두면
   * 돌아왔을 때 떠난 자리에서 그대로 이어진다 — 전투 중에 탭을 바꿔도 판이 흘러가 있지 않다.
   */
  scheduleFrame();
}

document.addEventListener("visibilitychange", () => {
  if (debugEnabled) runtimeObservation.visibilityCount += 1;
  setAudioVisibility(document.hidden);
  if (document.hidden) {
    runtimeObservation.paused = true;
    // 이미 큐에 든 프레임도 취소해 숨은 탭에서 상태가 한 번 더 흐르는 경주를 막는다.
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = null;
    last = 0;
    return;
  }
  if (!runtimeObservation.paused) return;
  runtimeObservation.paused = false;
  if (debugEnabled) {
    runtimeObservation.resumeCount += 1;
    awaitingResumeFrame = true;
  }
  // 떠난 동안의 시간을 한 번에 밀어 넣지 않도록 첫 복귀 프레임은 16ms로 고정한다.
  last = 0;
  scheduleFrame();
});

async function boot0(): Promise<void> {
  // atlas는 느리거나 하나가 실패해도 첫 지도를 막지 않는다. 아이콘 계약만
  // 먼저 확정하고, sprite job의 settled 여부는 debug 관찰값으로 따로 남긴다.
  void loadSprites().then(() => {
    if (debugEnabled) runtimeObservation.assetsReady = true;
  });
  await loadIcons();
  resize();
  window.addEventListener("resize", resize);
  let orientationTimer: number | null = null;
  const onOrientationChange = () => {
    // 표준 이벤트와 구형 이벤트가 함께 오면 하나의 회전으로 합친다. Screen
    // Orientation API가 없는 브라우저도 window 이벤트만으로 같은 resize를 탄다.
    if (orientationTimer === null && debugEnabled) runtimeObservation.orientationCount += 1;
    if (orientationTimer !== null) clearTimeout(orientationTimer);
    orientationTimer = window.setTimeout(() => {
      orientationTimer = null;
      resize();
    }, 120);
  };
  window.addEventListener("orientationchange", onOrientationChange);
  screen.orientation?.addEventListener("change", onOrientationChange);
  boot?.classList.add("gone");
  runtimeObservation.booted = true;
  runtimeObservation.paused = document.hidden;
  scheduleFrame();
}

void boot0();
