import { clearBattleFx, dualChoiceActive, hazardZones, spawnArrivalFx, spawnLevelUpFx, stepBattle } from "./game/battle.ts";
import { BALANCE } from "./game/balance.ts";
import { computeLayout, hitCell, rectHas, type Layout } from "./game/layout.ts";
import {
  gameoverGeometry,
  mapNodeRects,
  offerRects,
  raidContractRects,
  render,
  rerollRect,
  spawnBuyTween,
  splitButton,
  type DragState,
} from "./game/render.ts";
import {
  buyOffer,
  chooseNode,
  chooseRaidContract,
  chooseSharedRaidContract,
  leaveShop,
  mapStep,
  moveCat,
  newRun,
  nextRunFrom,
  rerollOffers,
  setNotice,
  startBattle,
  type NextChoice,
  type RunState,
} from "./game/run.ts";
import { parseRaidSeed, parseRaidShareCode, raidRiskLabel, raidShareCode } from "./game/raid.ts";
import { RAID_CONTRACT_POOL_STATUS } from "./validate/raid-contract-schema.ts";
import { openLanes } from "./game/map.ts";
import { cellToField, type Intervention } from "./game/types.ts";
import { loadSprites } from "./game/sprites.ts";
import { loadIcons } from "./game/icons.ts";
import {
  createBossSignalObserver,
  playBossSignal,
  playSting,
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

// 계약은 Canvas에 그리지만 의미 구조까지 픽셀에 가두지 않는다. Tab으로 들어오면
// 같은 세 선택지가 실제 버튼으로 나타나고, 스크린리더도 규칙·대응·보상을 읽는다.
const raidA11yControls = document.createElement("section");
raidA11yControls.className = "raid-a11y-controls";
raidA11yControls.hidden = true;
raidA11yControls.setAttribute("aria-label", "악몽 계약 선택");
const raidA11yLead = document.createElement("p");
raidA11yLead.setAttribute("aria-live", "polite");
raidA11yLead.setAttribute("aria-atomic", "true");
raidA11yControls.appendChild(raidA11yLead);
const raidA11yButtons = Array.from({ length: 3 }, (_, index) => {
  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute("aria-keyshortcuts", String(index + 1));
  button.addEventListener("click", () => {
    selectRaidContract(index);
    canvas.focus();
  });
  raidA11yControls.appendChild(button);
  return button;
});
app.appendChild(raidA11yControls);

if (RAID_CONTRACT_POOL_STATUS.usingFallback) {
  console.warn("악몽 계약 출고 풀 거절 — 안전 계약 세 장으로 폴백", RAID_CONTRACT_POOL_STATUS);
}

let layout: Layout = computeLayout(800, 600);
const initialUrl = new URL(location.href);
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

let raidA11ySignature = "";
function syncRaidAccessibility(): void {
  const offers = state.phase === "map" ? state.raidOffers : [];
  const signature = offers.map((contract) => contract.id).join("|");
  if (signature === raidA11ySignature) return;
  raidA11ySignature = signature;

  if (offers.length === 0) {
    if (raidA11yControls.contains(document.activeElement)) canvas.focus();
    raidA11yControls.hidden = true;
    canvas.setAttribute("aria-label", "냥 아레나 게임 화면");
    return;
  }

  raidA11yControls.hidden = false;
  raidA11yLead.textContent = "다음 보스의 악몽 계약 하나를 고르세요. 숫자 1, 2, 3도 사용할 수 있습니다.";
  canvas.setAttribute("aria-label", "악몽 계약 선택 화면. Tab 키로 계약 세 개를 비교할 수 있습니다.");
  raidA11yButtons.forEach((button, index) => {
    const contract = offers[index];
    button.hidden = !contract;
    if (!contract) return;
    button.textContent = `${index + 1}. ${contract.name} · 위험 ${raidRiskLabel(contract.risk)} · 규칙 ${contract.rule} · 대응 ${contract.counter} · 승리 보상 생선 +${contract.rewardFish}`;
  });
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

function cancelDrag(): void {
  drag.active = false;
  drag.fromCell = -1;
  drag.pointerId = -1;
}

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
  // 드래그 중 회전하거나 주소창이 접히면 보드 위치가 통째로 바뀐다.
  // 옛 레이아웃으로 잡은 출발 셀을 새 레이아웃 좌표에 드롭하면 엉뚱한 칸으로 간다.
  cancelDrag();
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
function canRearrange(): boolean {
  return state.phase === "reward" || state.phase === "prepare";
}

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
  state = nextRunFrom(state, choice);
  const url = new URL(location.href);
  url.searchParams.delete("raid");
  history.replaceState(null, "", url);
  playSting("title");
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
  if (!buyOffer(state, offer)) return false;
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

canvas.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  // 브라우저는 사용자 입력 전에 소리를 안 낸다. 이 탭이 그 입력이다.
  unlockAudio();
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch {
    // 일부 브라우저는 활성 포인터가 아니면 던진다. 캡처는 편의 기능이므로 무시한다.
  }
  const { x, y } = pointerPos(e);

  /**
   * 음소거는 페이즈 잠금보다 먼저 본다.
   *
   * 아래 잠금은 "국면이 방금 바뀌었으니 이 탭은 이전 화면을 향한 것"이라는
   * 판단인데, 음소거에는 그 논리가 안 맞는다. 소리를 끄려는 손은 화면이
   * 무엇으로 바뀌었든 소리를 끄려는 손이다. 시끄러워서 누른 버튼이
   * 안 먹으면 그다음은 탭이 닫힌다.
   */
  if (rectHas(layout.mute, x, y)) {
    toggleMute();
    return;
  }

  // 페이즈가 막 바뀌었으면 이 탭은 이전 화면을 향한 것이다. 버린다.
  if (performance.now() - phaseChangedAt < PHASE_LOCK_MS) return;

  // 죽은 화면의 세 갈래(같은 시드 · 오늘의 시드 · 도전 +1). 큰 버튼보다 먼저 본다 —
  // 판 안에 있으므로 겹치지는 않지만, 순서를 정해 두면 나중에 겹쳐도 규칙이 남는다.
  if (state.phase === "gameover") {
    const { choices } = gameoverGeometry(layout, state);
    const pick: NextChoice | null = rectHas(choices.retry, x, y)
      ? "retry"
      : rectHas(choices.daily, x, y)
        ? "daily"
        : rectHas(choices.challenge, x, y)
          ? "challenge"
          : null;
    if (pick) {
      startNextRun(pick);
      return;
    }
  }

  if (rectHas(layout.button, x, y)) {
    if (state.phase === "battle") {
      // 누르는 즉시 들어간다. 뗄 때까지 기다릴 이유가 없어졌다 — 길게 누르기가
      // 뜻하던 것(뭉침)이 사라졌고, 취약 창에서는 연타가 곧 화력이다.
      //
      // **지금은 극성(polarity)만 버튼이 두 짝이다(C1).** `dualChoiceActive`
      // (battle.ts) 하나가 그 기준이다 — 원버튼 폐기가 검토 중이라, 나중에
      // 그 게이트가 넓어지면(모든 예고에서 산개/집결을 직접 고르는 쪽으로)
      // 여기는 손댈 것이 없다. `splitButton`이 render.ts와 같은 값을 내므로
      // 그림과 히트테스트가 어긋나지 않는다. 게이트가 닫혀 있으면 예전처럼
      // `act` 하나뿐.
      if (dualChoiceActive(state)) {
        const [left] = splitButton(layout.button);
        pushIntent(x < left.x + left.w ? "dodge" : "gather", true);
      } else {
        pushIntent("act");
      }
      return;
    }
    onPrimaryAction();
    return;
  }

  if (state.phase === "map") {
    if (state.raidOffers.length > 0) {
      const cards = raidContractRects(layout, state.raidOffers.length);
      for (let i = 0; i < cards.length; i++) {
        const card = cards[i];
        if (card && rectHas(card, x, y)) {
          selectRaidContract(i);
          return;
        }
      }
      return;
    }
    for (const n of mapNodeRects(layout, state)) {
      if (n.step !== mapStep(state)) continue;
      // 원 안쪽만 받는다. 사각 판정으로 두면 붙어 있는 칸끼리 모서리가 겹친다.
      const cx = n.rect.x + n.rect.w / 2;
      const cy = n.rect.y + n.rect.h / 2;
      if (Math.hypot(x - cx, y - cy) > n.rect.w / 2 + 6) continue;
      if (!chooseNode(state, n.idx)) setNotice(state, "그 길로는 갈 수 없어요");
      return;
    }
    return;
  }

  if (state.phase === "reward") {
    if (rectHas(rerollRect(layout), x, y)) {
      rerollOffers(state);
      return;
    }
    /**
     * 카드 자리는 **빈 자리여도 탭을 삼킨다.**
     *
     * 전에는 `offer &&`가 조건에 있어서, 이미 산 자리를 누르면 아래로 흘러
     * 보드 검사에 닿았다. 화면에는 빈 카드 틀이 그려져 있는데 그 위를 누르면
     * 뒤에 있는 고양이가 잡히는 셈이다. 구매·배치가 한 화면이 되면서 그
     * 뒤에 실제로 보드가 있게 됐다.
     */
    const rects = offerRects(layout);
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      if (!r || !rectHas(r, x, y)) continue;
      const offer = state.offers[i];
      // buyOffer가 실패 사유별로 notice를 세팅한다. 덮어쓰면 거짓 안내가 뜬다.
      // (보드 만석인데 "생선이 부족합니다"가 뜨던 버그)
      if (offer && !buyWithFx(offer) && state.gold < offer.cost) {
        setNotice(state, "생선이 조금 모자라요");
      }
      return;
    }

    /**
     * 카드 사이 틈도 삼킨다 — **접힌 구성에서만** 문제가 된다.
     *
     * 접힌 화면에서는 카드 줄이 판 위로 자라므로, 카드 사각형 사이의 빈틈을
     * 누르면 보이지도 않는 판의 고양이가 잡힌다(667x275에서 패널의 5~18%가
     * 그런 자리였다). 세로줄 구성에서는 패널이 판을 아예 안 덮으므로 이
     * 조건이 걸리지 않는다.
     */
    if (!layout.columns) {
      // 카드는 패널 띠 **위로 자란다.** 그래서 패널 사각형만 막으면 카드보다
      // 위쪽의 틈이 그대로 샜다(667x275에서 0.5%). 카드들을 감싸는 상자까지
      // 함께 삼킨다.
      let box = layout.offersPanel ?? null;
      for (const r of rects) {
        if (!r) continue;
        box = box
          ? {
              x: Math.min(box.x, r.x),
              y: Math.min(box.y, r.y),
              w: Math.max(box.x + box.w, r.x + r.w) - Math.min(box.x, r.x),
              h: Math.max(box.y + box.h, r.y + r.h) - Math.min(box.y, r.y),
            }
          : r;
      }
      if (box && rectHas(box, x, y)) return;
    }
  }

  if (!canRearrange()) return;
  // 이미 다른 손가락이 끌고 있으면 새 포인터는 무시한다.
  // 그러지 않으면 두 번째 손가락이 fromCell을 덮어써서, 첫 손가락을 뗄 때
  // 엉뚱한 고양이가 엉뚱한 칸으로 옮겨진다(핀치줌 시도 시 실제로 발생).
  if (drag.active) return;
  const cell = hitCell(layout, "ally", x, y);
  if (cell >= 0 && state.ally[cell]) {
    drag.active = true;
    drag.fromCell = cell;
    drag.x = x;
    drag.y = y;
    drag.pointerId = e.pointerId;
  }
});

canvas.addEventListener("pointermove", (e) => {
  const { x, y } = pointerPos(e);
  if (drag.active) {
    if (e.pointerId !== drag.pointerId) return;
    drag.x = x;
    drag.y = y;
  }
  drag.hoverX = x;
  drag.hoverY = y;
  hoverCell = canRearrange() ? hitCell(layout, "ally", x, y) : -1;
});

function endDrag(e: PointerEvent): void {
  if (!drag.active || e.pointerId !== drag.pointerId) return;
  const { x, y } = pointerPos(e);
  const to = hitCell(layout, "ally", x, y);
  if (to >= 0) moveCat(state, drag.fromCell, to);
  cancelDrag();
}

// 캔버스 밖에서 버튼을 떼면 캔버스에는 pointerup이 오지 않는다.
// setPointerCapture가 실패했을 때(try/catch로 삼킴) 드래그가 영구히 걸린 채
// 유령 고양이가 커서를 따라다니므로, window에서도 받는다.
window.addEventListener("pointerup", (e) => {
  endDrag(e);
});
window.addEventListener("pointercancel", () => {
  cancelDrag();
});
canvas.addEventListener("pointerleave", () => {
  drag.hoverX = -1;
  drag.hoverY = -1;
});
canvas.addEventListener("lostpointercapture", cancelDrag);
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
  state.pending.push(kind === "dodge" || kind === "gather" ? { kind, dual } : { kind });
}

window.addEventListener("keydown", (e) => {
  // 연타를 그대로 받는 것은 취약 창(연타가 곧 화력) 때문이다. G도 같은
  // 이유로 반복을 받는다 — 안 받으면 극성에서 산개(Space)만 연타되고
  // 집결(G)은 꾹 눌러도 한 번만 나가는 비대칭이 생긴다.
  if (e.repeat && e.code !== "Space" && e.code !== "KeyG") return;
  unlockAudio();

  // 음소거는 페이즈 잠금 위에 있다. 탭 쪽과 같은 이유다.
  if (e.code === "KeyM") {
    toggleMute();
    return;
  }
  if (performance.now() - phaseChangedAt < PHASE_LOCK_MS) return;

  switch (e.code) {
    case "Space":
      e.preventDefault();
      // 취약 창에는 연타가 곧 화력이라 자동 반복도 그대로 받는다.
      if (dualChoiceActive(state)) pushIntent("dodge", true);
      else pushIntent("act");
      return;
    case "KeyG":
      e.preventDefault();
      // 게이트가 닫혀 있으면 버튼·Space와 완전히 같은 일(act)을 한다 — 몰라도
      // 손해가 없는 키여야 한다.
      if (dualChoiceActive(state)) pushIntent("gather", true);
      else pushIntent("act");
      return;
    case "Enter":
      if (state.phase !== "battle") onPrimaryAction();
      return;
    case "KeyR":
      if (state.phase === "reward") rerollOffers(state);
      return;
    case "Digit1":
    case "Digit2":
    case "Digit3":
    case "Digit4": {
      const slot = Number(e.code.slice(5)) - 1;
      if (state.phase === "gameover") {
        // 죽은 화면의 세 갈래를 1·2·3으로. 화면의 버튼 순서와 같다. 4는 버튼이
        // 없으므로 아무 일도 안 한다 — 지도 단축키로 새지 않게 여기서 끝낸다.
        const pick = (["retry", "daily", "challenge"] as const)[slot];
        if (pick) startNextRun(pick);
        return;
      }
      if (state.phase === "map") {
        if (state.raidOffers.length > 0) {
          selectRaidContract(slot);
          return;
        }
        // 지도에서는 고를 수 있는 칸만 순서대로 센다. 갈 수 없는 칸을 세면
        // 번호가 화면과 어긍난다.
        const step = mapStep(state);
        const idx = openLanes(state.map, step)[slot];
        if (idx !== undefined) chooseNode(state, idx);
        return;
      }
      if (state.phase !== "reward") return;
      if (slot > 2) return;
      const offer = state.offers[slot];
      if (!offer) return;
      if (!buyWithFx(offer) && state.gold < offer.cost) setNotice(state, "생선이 조금 모자라요");
      return;
    }
  }
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
if (new URLSearchParams(location.search).get("debug") === "1") {
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
      button: { ...layout.button },
    }),
  });
}

let last = 0;
function frame(now: number): void {
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
  const dt = last === 0 ? 16 : Math.min(100, now - last);
  last = now;
  /**
   * 화면 체감용 배속(`BALANCE.battleSpeed`)은 **여기, 실시간 dt에만** 곱한다.
   * `scripts/`의 헤드리스 하네스는 `stepBattle(s, 100)`을 직접 부르므로 이
   * 곱셈을 거치지 않는다 — 그래서 배속을 바꿔도 sim·invariants 수치는
   * 그대로다. 이건 밸런스가 아니라 표현이라는 근거가 바로 이 분리다.
   */
  stepBattle(state, dt * BALANCE.battleSpeed);
  observeBossSignals({
    phase: state.phase,
    zones: hazardZones(state),
    bosses: state.enemy,
  });
  setBed(musicFor(state));
  syncRaidAccessibility();
  render(ctx!, layout, state, drag, hoverCell);
  /**
   * 탭이 숨겨지면 루프를 세운다. 브라우저는 숨은 탭의 rAF를 1fps 안팎으로 줄이는데, 그 틈에
   * `dt`가 100ms로 잘려 게임 시간이 10분의 1 속도로 기어가고 배터리는 계속 쓴다. 세워 두면
   * 돌아왔을 때 떠난 자리에서 그대로 이어진다 — 전투 중에 탭을 바꿔도 판이 흘러가 있지 않다.
   */
  if (document.hidden) {
    paused = true;
    return;
  }
  requestAnimationFrame(frame);
}

let paused = false;
document.addEventListener("visibilitychange", () => {
  setAudioVisibility(document.hidden);
  if (document.hidden || !paused) return;
  paused = false;
  // 떠난 동안의 시간을 한 번에 밀어 넣지 않도록 dt 기준점을 비운다.
  last = 0;
  requestAnimationFrame(frame);
});

async function boot0(): Promise<void> {
  // 둘을 나란히 기다린다. 아이콘은 33KB뿐이라 스프라이트보다 먼저 끝난다.
  await Promise.all([loadSprites(), loadIcons()]);
  resize();
  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", () => setTimeout(resize, 120));
  boot?.classList.add("gone");
  requestAnimationFrame(frame);
}

void boot0();
