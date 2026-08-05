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
const drag: DragState = { active: false, fromCell: -1, x: 0, y: 0 };
let hoverCell = -1;

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
}

function pointerPos(e: PointerEvent): { x: number; y: number } {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function canRearrange(): boolean {
  return state.phase === "prepare" || state.phase === "reward";
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
        if (!buyOffer(state, offer)) state.notice = "생선이 부족합니다";
        else state.notice = "";
        return;
      }
    }
  }

  if (!canRearrange()) return;
  const cell = hitCell(layout.allyBoard, layout.cell, layout.gap, x, y);
  if (cell >= 0 && state.ally[cell]) {
    drag.active = true;
    drag.fromCell = cell;
    drag.x = x;
    drag.y = y;
  }
});

canvas.addEventListener("pointermove", (e) => {
  const { x, y } = pointerPos(e);
  if (drag.active) {
    drag.x = x;
    drag.y = y;
  }
  hoverCell = canRearrange() ? hitCell(layout.allyBoard, layout.cell, layout.gap, x, y) : -1;
});

function endDrag(e: PointerEvent): void {
  if (!drag.active) return;
  const { x, y } = pointerPos(e);
  const to = hitCell(layout.allyBoard, layout.cell, layout.gap, x, y);
  if (to >= 0) moveCat(state, drag.fromCell, to);
  drag.active = false;
  drag.fromCell = -1;
}

canvas.addEventListener("pointerup", endDrag);
canvas.addEventListener("pointercancel", (e) => {
  drag.active = false;
  drag.fromCell = -1;
  void e;
});
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
