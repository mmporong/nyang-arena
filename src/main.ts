import { clearBattleFx, stepBattle } from "./game/battle.ts";
import { computeLayout, hitCell, rectHas, type Layout } from "./game/layout.ts";
import { offerRects, render, rerollRect, type DragState } from "./game/render.ts";
import { buyOffer, moveCat, newRun, rerollOffers, startBattle, type RunState } from "./game/run.ts";
import { loadSprites } from "./game/sprites.ts";

const app = document.getElementById("app");
const boot = document.getElementById("boot");
if (!app) throw new Error("#app를 찾을 수 없습니다");

const canvas = document.createElement("canvas");
const ctx = canvas.getContext("2d");
if (!ctx) throw new Error("2D 캔버스를 만들 수 없습니다");
app.appendChild(canvas);

let layout: Layout = computeLayout(800, 600);
let state: RunState = newRun();
const drag: DragState = { active: false, fromCell: -1, x: 0, y: 0, pointerId: -1 };
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
  layout = computeLayout(w, h);
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
 * 흐름은 전투 → 보상(구매) → 준비(배치) → 전투다.
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
      state.phase = "prepare";
      state.notice = "근접은 앞줄, 원거리는 뒷줄";
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
canvas.addEventListener("lostpointercapture", cancelDrag);
canvas.addEventListener("contextmenu", (e) => e.preventDefault());

let last = 0;
function frame(now: number): void {
  if (state.phase !== lastPhase) {
    lastPhase = state.phase;
    phaseChangedAt = now;
  }
  const dt = last === 0 ? 16 : Math.min(100, now - last);
  last = now;
  stepBattle(state, dt);
  render(ctx!, layout, state, drag, hoverCell);
  requestAnimationFrame(frame);
}

async function boot0(): Promise<void> {
  await loadSprites();
  resize();
  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", () => setTimeout(resize, 120));
  boot?.classList.add("gone");
  requestAnimationFrame(frame);
}

void boot0();
