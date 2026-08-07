import { clearBattleFx, stepBattle } from "./game/battle.ts";
import { computeLayout, hitCell, rectHas, type Layout } from "./game/layout.ts";
import { mapNodeRects, offerRects, render, rerollRect, type DragState } from "./game/render.ts";
import {
  buyOffer,
  chooseNode,
  leaveShop,
  mapStep,
  moveCat,
  newRun,
  rerollOffers,
  startBattle,
  type RunState,
} from "./game/run.ts";
import { openLanes } from "./game/map.ts";
import { loadSprites } from "./game/sprites.ts";
import { loadIcons } from "./game/icons.ts";

const app = document.getElementById("app");
const boot = document.getElementById("boot");
if (!app) throw new Error("#app를 찾을 수 없습니다");

const canvas = document.createElement("canvas");
const ctx = canvas.getContext("2d");
if (!ctx) throw new Error("2D 캔버스를 만들 수 없습니다");
app.appendChild(canvas);

let layout: Layout = computeLayout(800, 600);
let state: RunState = newRun();
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

/**
 * 이 시간 넘게 누르고 있으면 "모여", 그 전에 떼면 "흩어져".
 *
 * 260ms인 이유: 사람의 의도적인 길게 누르기와 빠른 탭을 가르는 경계가 대략
 * 이쯤이다. 더 짧으면 급하게 탭할 때 오인되고, 더 길면 1.2초짜리 예고 안에
 * 반응할 시간이 모자란다.
 */
const HOLD_MS = 260;
let pressStartedAt = 0;
let pressOnButton = false;

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
 * reward를 뺀 이유: 보상 카드 패널이 좁은 화면에서 보드를 덮는데, 그 상태로
 * 보드가 반응하면 고양이를 집으려던 탭이 카드 구매로 새어 들어간다.
 * 흐름은 **지도(길) → 보상(적을 보며 구매) → 준비(배치) → 전투**다.
 */
function canRearrange(): boolean {
  return state.phase === "prepare";
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
      leaveShop(state);
      break;
    case "map":
      break;
    case "gameover":
      clearBattleFx();
      state = newRun();
      break;
  }
}

/** 버튼에서 손을 뗀 순간 탭인지 꾹인지 판정한다. */
function resolveButtonPress(): void {
  if (!pressOnButton) return;
  pressOnButton = false;
  if (state.phase !== "battle" || state.dodgeCharges <= 0) return;
  const held = performance.now() - pressStartedAt;
  markIntervention();
  state.pending.push({ kind: held >= HOLD_MS ? "gather" : "dodge" });
}

canvas.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch {
    // 일부 브라우저는 활성 포인터가 아니면 던진다. 캡처는 편의 기능이므로 무시한다.
  }
  const { x, y } = pointerPos(e);

  // 페이즈가 막 바뀌었으면 이 탭은 이전 화면을 향한 것이다. 버린다.
  if (performance.now() - phaseChangedAt < PHASE_LOCK_MS) return;

  if (rectHas(layout.button, x, y)) {
    if (state.phase === "battle") {
      // 취약 창에는 연타가 곧 화력이므로 누르는 즉시 들어간다.
      const openBoss = state.enemy.some((c) => c?.alive && c.vulnerableMs > 0);
      if (openBoss) {
        markIntervention();
        state.pending.push({ kind: "strike" });
        return;
      }
      // 그 외에는 뗄 때 판정한다. 짧으면 흩어짐, 길면 모임.
      pressStartedAt = performance.now();
      pressOnButton = true;
      return;
    }
    onPrimaryAction();
    return;
  }

  if (state.phase === "map") {
    for (const n of mapNodeRects(layout, state)) {
      if (n.step !== mapStep(state)) continue;
      // 원 안쪽만 받는다. 사각 판정으로 두면 붙어 있는 칸끼리 모서리가 겹친다.
      const cx = n.rect.x + n.rect.w / 2;
      const cy = n.rect.y + n.rect.h / 2;
      if (Math.hypot(x - cx, y - cy) > n.rect.w / 2 + 6) continue;
      if (!chooseNode(state, n.idx)) state.notice = "그 길로는 갈 수 없습니다";
      return;
    }
    return;
  }

  if (state.phase === "reward") {
    if (rectHas(rerollRect(layout), x, y)) {
      rerollOffers(state);
      return;
    }
    const rects = offerRects(layout);
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      const offer = state.offers[i];
      if (r && offer && rectHas(r, x, y)) {
        // buyOffer가 실패 사유별로 notice를 세팅한다. 덮어쓰면 거짓 안내가 뜬다.
        // (보드 만석인데 "생선이 부족합니다"가 뜨던 버그)
        if (buyOffer(state, offer)) state.notice = "";
        else if (state.gold < offer.cost) state.notice = "생선이 부족합니다";
        return;
      }
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
  resolveButtonPress();
  endDrag(e);
});
window.addEventListener("pointercancel", () => {
  // 손가락이 취소되면 의도도 버린다. 어중간하게 흩어지면 오히려 손해다.
  pressOnButton = false;
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
 * 데스크톱에서는 개입을 **두 키로 갈라 준다.**
 *
 * 탭이냐 꾹이냐로 나눈 것은 손가락 하나로 해야 하는 폰의 제약이었다. 키보드가
 * 있으면 그 제약이 없고, 같은 키를 얼마나 오래 눌렀는지로 의도를 가르는 것은
 * 그 자체가 오해의 씨앗이다 — 급하게 누르면 뭉치려던 것이 흩어짐이 된다.
 *
 * 두 경로가 **같은 큐(`state.pending`)로 들어가는 것**이 중요하다. 판정은 전부
 * `stepBattle` 안에서 일어나므로 키보드를 붙여도 헤드리스 시뮬과 갈라지지 않는다.
 *
 *   Space   흩어져 (취약 창에는 약점 공격)
 *   Shift   모여
 *   1 2 3   카드 구매 · R 다시 뽑기 · Enter 다음 단계
 */
function pushIntent(kind: "dodge" | "gather"): void {
  if (state.phase !== "battle") return;
  markIntervention();
  const openBoss = state.enemy.some((c) => c?.alive && c.vulnerableMs > 0);
  if (openBoss) {
    state.pending.push({ kind: "strike" });
    return;
  }
  if (state.dodgeCharges <= 0) return;
  state.pending.push({ kind });
}

window.addEventListener("keydown", (e) => {
  if (e.repeat && e.code !== "Space") return;
  if (performance.now() - phaseChangedAt < PHASE_LOCK_MS) return;

  switch (e.code) {
    case "Space":
      e.preventDefault();
      // 취약 창에는 연타가 곧 화력이라 자동 반복도 그대로 받는다.
      pushIntent("dodge");
      return;
    case "ShiftLeft":
    case "ShiftRight":
      e.preventDefault();
      pushIntent("gather");
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
      if (state.phase === "map") {
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
      if (buyOffer(state, offer)) state.notice = "";
      else if (state.gold < offer.cost) state.notice = "생선이 부족합니다";
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
      offers: state.offers.map((o) => (o ? { label: o.label, cost: o.cost } : null)),
      // 유물은 측정에서 가장 깊은 축이라 밖에서 상태를 볼 수 있어야 한다.
      // 제출용 스크린샷을 "유물을 든 상태"로 잡는 데도 이게 필요했다.
      relics: state.relics.map((r) => r.name),
      allies: state.ally.filter(Boolean).length,
      dodgeCharges: state.dodgeCharges,
      pending: [...state.pending],
      telegraphs: state.enemy.filter((c) => c?.telegraph).map((c) => c!.telegraph!.mode),
      vulnerable: state.enemy.some((c) => c?.alive && c.vulnerableMs > 0),
      button: { ...layout.button },
      pressOnButton,
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
  stepBattle(state, dt);
  render(ctx!, layout, state, drag, hoverCell);
  requestAnimationFrame(frame);
}

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
