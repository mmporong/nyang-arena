import { damagePops, stepBattle } from "./game/battle.ts";
import { computeLayout, hitCell, rectHas, type Layout } from "./game/layout.ts";
import { offerRects, render, type DragState } from "./game/render.ts";
import { buyOffer, moveCat, newRun, startBattle, type RunState } from "./game/run.ts";
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
      state.notice = "배치를 정하고 전투를 시작하세요";
      break;
    case "gameover":
      damagePops.length = 0;
      state = newRun();
      break;
  }
}

canvas.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch {
    // 일부 브라우저는 활성 포인터가 아니면 던진다. 캡처는 편의 기능이므로 무시한다.
  }
  const { x, y } = pointerPos(e);

  if (rectHas(layout.button, x, y)) {
    onPrimaryAction();
    return;
  }

  if (state.phase === "reward") {
    const rects = offerRects(layout, state.offers.length);
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
window.addEventListener("pointerup", endDrag);
window.addEventListener("pointercancel", cancelDrag);
canvas.addEventListener("lostpointercapture", cancelDrag);
canvas.addEventListener("contextmenu", (e) => e.preventDefault());

let last = 0;
function frame(now: number): void {
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
