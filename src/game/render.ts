import { damagePops, POP_LIFE_MS } from "./battle.ts";
import { cellRect, type Layout, type Rect } from "./layout.ts";
import { spriteFor } from "./sprites.ts";
import type { Offer, RunState } from "./run.ts";
import { BOARD_SIZE, type Cat } from "./types.ts";

const C = {
  bg0: "#191527",
  bg1: "#0f0d17",
  panel: "rgba(255,255,255,0.05)",
  panelEdge: "rgba(255,255,255,0.12)",
  text: "#ece7f7",
  muted: "#9d94b8",
  ally: "#6ee7a8",
  enemy: "#f2798d",
  gold: "#f5c451",
  on: "#ffd76e",
} as const;

export interface DragState {
  active: boolean;
  fromCell: number;
  x: number;
  y: number;
  /** 드래그를 시작한 포인터. 멀티터치에서 다른 손가락이 끼어드는 걸 막는다. */
  pointerId: number;
}

function roundRect(ctx: CanvasRenderingContext2D, r: Rect, radius: number): void {
  const rad = Math.min(radius, r.w / 2, r.h / 2);
  ctx.beginPath();
  ctx.moveTo(r.x + rad, r.y);
  ctx.arcTo(r.x + r.w, r.y, r.x + r.w, r.y + r.h, rad);
  ctx.arcTo(r.x + r.w, r.y + r.h, r.x, r.y + r.h, rad);
  ctx.arcTo(r.x, r.y + r.h, r.x, r.y, rad);
  ctx.arcTo(r.x, r.y, r.x + r.w, r.y, rad);
  ctx.closePath();
}

function label(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  color: string,
  align: CanvasTextAlign = "left",
  weight = 600,
  /** 넘치면 가로로 압축한다. 검증기가 16자까지 허용하므로 칩 폭을 넘길 수 있다. */
  maxWidth?: number,
): void {
  ctx.font = `${weight} ${Math.round(size)}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  if (maxWidth !== undefined) ctx.fillText(text, x, y, maxWidth);
  else ctx.fillText(text, x, y);
}

function drawBackground(ctx: CanvasRenderingContext2D, L: Layout): void {
  const g = ctx.createLinearGradient(0, 0, 0, L.h);
  g.addColorStop(0, C.bg0);
  g.addColorStop(1, C.bg1);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, L.w, L.h);
}

function drawHud(ctx: CanvasRenderingContext2D, L: Layout, s: RunState): void {
  const r = L.hud;
  const fs = Math.max(15, r.h * 0.36);
  const mid = r.y + r.h / 2;

  label(ctx, `웨이브 ${s.wave}`, r.x + 4, mid, fs * 1.1, C.text, "left", 700);
  label(ctx, `🐟 ${s.gold}`, r.x + r.w / 2, mid, fs, C.gold, "center", 700);
  label(ctx, s.best > 0 ? `최고 ${s.best}` : "최고 —", r.x + r.w - 4, mid, fs, C.muted, "right");
}

function drawBoard(
  ctx: CanvasRenderingContext2D,
  L: Layout,
  board: Rect,
  accent: string,
  highlightCell: number,
): void {
  for (let i = 0; i < BOARD_SIZE; i++) {
    const cr = cellRect(board, L.cell, L.gap, i);
    roundRect(ctx, cr, L.cell * 0.14);
    ctx.fillStyle = i === highlightCell ? "rgba(255,255,255,0.14)" : C.panel;
    ctx.fill();
    ctx.strokeStyle = i === highlightCell ? accent : C.panelEdge;
    ctx.lineWidth = i === highlightCell ? 2.5 : 1;
    ctx.stroke();
  }
}

/** 공격 돌진 방향. 가로면 상대 보드 쪽 x, 세로면 상대 보드 쪽 y. */
function lungeOffset(L: Layout, cat: Cat, amount: number): { dx: number; dy: number } {
  const dist = L.cell * 0.22 * amount;
  if (L.portrait) return { dx: 0, dy: cat.side === "ally" ? -dist : dist };
  return { dx: cat.side === "ally" ? dist : -dist, dy: 0 };
}

function drawCat(
  ctx: CanvasRenderingContext2D,
  L: Layout,
  cat: Cat,
  cr: Rect,
  dimmed: boolean,
): void {
  const { dx, dy } = lungeOffset(L, cat, cat.lunge);
  const size = L.cell * 0.88;
  const x = cr.x + (L.cell - size) / 2 + dx;
  const y = cr.y + (L.cell - size) / 2 + dy - L.cell * 0.04;

  ctx.save();
  if (!cat.alive) ctx.globalAlpha = 0.4;
  else if (dimmed) ctx.globalAlpha = 0.35;

  const img = spriteFor(cat.breed.id, cat.pose);
  if (img) {
    if (cat.flash > 0) ctx.filter = "brightness(2.6)";
    ctx.drawImage(img, x, y, size, size);
    ctx.filter = "none";
  } else {
    // 스프라이트 로드 실패 시 폴백 — 게임이 멈추지는 않게 한다.
    ctx.fillStyle = cat.side === "ally" ? C.ally : C.enemy;
    roundRect(ctx, { x, y, w: size, h: size }, size * 0.2);
    ctx.fill();
  }
  ctx.restore();

  if (!cat.alive) return;

  // 체력 바
  const bw = L.cell * 0.72;
  const bh = Math.max(4, L.cell * 0.06);
  const bx = cr.x + (L.cell - bw) / 2;
  const by = cr.y + L.cell - bh - L.cell * 0.03;
  const frac = Math.max(0, Math.min(1, cat.hp / cat.maxHp));

  roundRect(ctx, { x: bx, y: by, w: bw, h: bh }, bh / 2);
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fill();
  roundRect(ctx, { x: bx, y: by, w: Math.max(bh, bw * frac), h: bh }, bh / 2);
  ctx.fillStyle = cat.side === "ally" ? C.ally : C.enemy;
  ctx.fill();

  if (cat.level > 1) {
    label(ctx, `Lv${cat.level}`, cr.x + L.cell * 0.06, cr.y + L.cell * 0.12, L.cell * 0.15, C.on, "left", 700);
  }
}

function drawPops(ctx: CanvasRenderingContext2D, L: Layout): void {
  for (const p of damagePops) {
    const board = p.side === "ally" ? L.allyBoard : L.enemyBoard;
    const cr = cellRect(board, L.cell, L.gap, p.cell);
    const t = 1 - p.life / POP_LIFE_MS;
    ctx.save();
    ctx.globalAlpha = Math.max(0, 1 - t * t);
    label(
      ctx,
      p.text,
      cr.x + L.cell / 2 + p.jitter * L.cell,
      cr.y + L.cell * 0.34 - t * L.cell * 0.4,
      L.cell * (p.crit ? 0.26 : 0.2),
      p.text === "회피" ? C.muted : p.crit ? C.gold : "#ffffff",
      "center",
      800,
    );
    ctx.restore();
  }
}

function drawSynergies(ctx: CanvasRenderingContext2D, L: Layout, s: RunState): void {
  const r = L.synergyBar;
  const n = Math.max(1, s.synergies.length);
  const gap = r.w * 0.015;
  const cw = (r.w - gap * (n - 1)) / n;
  const fs = Math.max(11, r.h * 0.3);

  s.synergies.forEach((syn, i) => {
    const on = s.activeSynergyIds.has(syn.id);
    const cr: Rect = { x: r.x + i * (cw + gap), y: r.y, w: cw, h: r.h };
    roundRect(ctx, cr, r.h * 0.28);
    ctx.fillStyle = on ? "rgba(255,215,110,0.16)" : "rgba(255,255,255,0.04)";
    ctx.fill();
    ctx.strokeStyle = on ? C.on : C.panelEdge;
    ctx.lineWidth = on ? 2 : 1;
    ctx.stroke();

    const inner = cr.w * 0.9;
    label(ctx, syn.name, cr.x + cr.w / 2, cr.y + r.h * 0.34, fs, on ? C.on : C.muted, "center", 700, inner);
    label(ctx, triggerText(syn.trigger), cr.x + cr.w / 2, cr.y + r.h * 0.7, fs * 0.82, C.muted, "center", 500, inner);
  });
}

function triggerText(t: string): string {
  switch (t) {
    case "same_color_3":
      return "같은 색 3";
    case "same_breed_2":
      return "같은 품종 2";
    case "all_different_5":
      return "전부 다른 색 5";
    default:
      return t;
  }
}

export function offerRects(L: Layout, count: number): Rect[] {
  const r = L.offers;
  const n = Math.max(1, count);
  const gap = r.w * 0.02;
  const cw = (r.w - gap * (n - 1)) / n;
  return Array.from({ length: count }, (_, i) => ({
    x: r.x + i * (cw + gap),
    y: r.y,
    w: cw,
    h: r.h,
  }));
}

function drawOffers(ctx: CanvasRenderingContext2D, L: Layout, s: RunState): void {
  if (s.phase !== "reward" || s.offers.length === 0) return;
  const rects = offerRects(L, s.offers.length);
  const fs = Math.max(12, L.offers.h * 0.22);

  // 좁은 화면에서는 카드가 보드를 덮으므로 화면 전체를 눌러 모달로 읽히게 한다.
  // (그동안 보드 입력은 canRearrange가 막는다)
  if (!L.roomy) {
    ctx.fillStyle = "rgba(10,8,16,0.55)";
    ctx.fillRect(0, 0, L.w, L.h);
  }
  const pad = L.offers.h * 0.18;
  const back = L.offersPanel;
  ctx.fillStyle = "rgba(12,10,20,0.96)";
  ctx.fillRect(back.x, back.y, back.w, back.h);
  ctx.strokeStyle = "rgba(255,255,255,0.10)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, back.y + 0.5);
  ctx.lineTo(L.w, back.y + 0.5);
  ctx.stroke();
  label(ctx, "생선을 쓰거나, 그냥 다음 웨이브로", L.w / 2, back.y + pad * 0.85, fs * 0.82, C.muted, "center", 500);

  s.offers.forEach((o: Offer, i) => {
    const cr = rects[i];
    if (!cr) return;
    const afford = s.gold >= o.cost;
    roundRect(ctx, cr, cr.h * 0.18);
    ctx.fillStyle = afford ? "rgba(110,231,168,0.12)" : "rgba(255,255,255,0.03)";
    ctx.fill();
    ctx.strokeStyle = afford ? C.ally : C.panelEdge;
    ctx.lineWidth = afford ? 2 : 1;
    ctx.stroke();

    if (o.breed) {
      const img = spriteFor(o.breed.id, "wink");
      const sz = cr.h * 0.62;
      if (img) ctx.drawImage(img, cr.x + cr.w / 2 - sz / 2, cr.y + cr.h * 0.06, sz, sz);
    }
    label(ctx, o.label, cr.x + cr.w / 2, cr.y + cr.h * 0.78, fs, afford ? C.text : C.muted, "center", 700, cr.w * 0.92);
    label(ctx, `🐟 ${o.cost}`, cr.x + cr.w / 2, cr.y + cr.h * 0.94, fs * 0.85, afford ? C.gold : C.muted, "center");
  });
}

export function buttonText(s: RunState): string {
  switch (s.phase) {
    case "prepare":
      return "전투 시작";
    case "battle":
      return "전투 중…";
    case "reward":
      return "다음 웨이브";
    case "gameover":
      return "다시 도전";
  }
}

function drawButton(ctx: CanvasRenderingContext2D, L: Layout, s: RunState): void {
  const r = L.button;
  const idle = s.phase === "battle";
  roundRect(ctx, r, r.h * 0.28);
  ctx.fillStyle = idle ? "rgba(255,255,255,0.06)" : C.ally;
  ctx.fill();
  label(
    ctx,
    buttonText(s),
    r.x + r.w / 2,
    r.y + r.h / 2,
    Math.max(15, r.h * 0.38),
    idle ? C.muted : "#0f2018",
    "center",
    800,
  );
}

function drawNotice(ctx: CanvasRenderingContext2D, L: Layout, s: RunState): void {
  if (!s.notice || s.phase === "gameover") return;
  const r = L.notice;
  label(ctx, s.notice, L.w / 2, r.y + r.h / 2, Math.max(12, r.h * 0.62), C.muted, "center", 600);
}

/**
 * 두 보드 사이 구분선.
 * 라벨과 간격만으로는 3×3 두 개가 6×3 한 판으로 읽힌다는 피드백이 있었다.
 */
function drawDivider(ctx: CanvasRenderingContext2D, L: Layout): void {
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.10)";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 8]);
  ctx.beginPath();
  if (L.portrait) {
    const y = Math.round((L.enemyBoard.y + L.enemyBoard.h + L.allyBoard.y) / 2) + 0.5;
    ctx.moveTo(L.allyBoard.x, y);
    ctx.lineTo(L.allyBoard.x + L.allyBoard.w, y);
  } else {
    const x = Math.round((L.allyBoard.x + L.allyBoard.w + L.enemyBoard.x) / 2) + 0.5;
    ctx.moveTo(x, L.allyBoard.y - L.labelH);
    ctx.lineTo(x, L.allyBoard.y + L.allyBoard.h);
  }
  ctx.stroke();
  ctx.restore();

  const cx = L.portrait
    ? L.w / 2
    : (L.allyBoard.x + L.allyBoard.w + L.enemyBoard.x) / 2;
  const cy = L.portrait
    ? (L.enemyBoard.y + L.enemyBoard.h + L.allyBoard.y) / 2
    : L.allyBoard.y + L.allyBoard.h / 2;
  const rad = Math.max(11, L.cell * 0.16);
  ctx.beginPath();
  ctx.arc(cx, cy, rad, 0, Math.PI * 2);
  ctx.fillStyle = C.bg1;
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.stroke();
  label(ctx, "VS", cx, cy, rad * 0.95, C.muted, "center", 800);
}

/** 진영 라벨. 두 보드가 하나의 격자로 읽히는 걸 막는다. */
function drawSideLabels(ctx: CanvasRenderingContext2D, L: Layout): void {
  const fs = Math.min(Math.max(11, L.cell * 0.17), L.labelH * 0.9);
  const put = (board: Rect, text: string, color: string) => {
    label(ctx, text, board.x + 2, board.y - L.labelH / 2, fs, color, "left", 700);
  };
  put(L.allyBoard, "우리 편", C.ally);
  put(L.enemyBoard, "상대", C.enemy);
}

function drawGameOver(ctx: CanvasRenderingContext2D, L: Layout, s: RunState): void {
  if (s.phase !== "gameover") return;
  ctx.fillStyle = "rgba(10,8,16,0.78)";
  ctx.fillRect(0, 0, L.w, L.h);
  const cy = L.h / 2;
  label(ctx, `${s.wave}웨이브 도달`, L.w / 2, cy - L.scale * 30, L.scale * 46, C.text, "center", 800);
  label(
    ctx,
    s.recordBroken ? "최고 기록 갱신!" : `최고 기록 ${s.best}웨이브`,
    L.w / 2,
    cy + L.scale * 14,
    L.scale * 20,
    s.recordBroken ? C.on : C.muted,
    "center",
    600,
  );
}

export function render(
  ctx: CanvasRenderingContext2D,
  L: Layout,
  s: RunState,
  drag: DragState,
  hoverCell: number,
): void {
  drawBackground(ctx, L);
  drawHud(ctx, L, s);

  const canDrag = s.phase === "prepare" || s.phase === "reward";
  drawDivider(ctx, L);
  drawSideLabels(ctx, L);
  drawBoard(ctx, L, L.allyBoard, C.ally, canDrag ? hoverCell : -1);
  drawBoard(ctx, L, L.enemyBoard, C.enemy, -1);

  for (let i = 0; i < BOARD_SIZE; i++) {
    const e = s.enemy[i];
    if (e) drawCat(ctx, L, e, cellRect(L.enemyBoard, L.cell, L.gap, i), false);
  }
  for (let i = 0; i < BOARD_SIZE; i++) {
    const a = s.ally[i];
    if (a) drawCat(ctx, L, a, cellRect(L.allyBoard, L.cell, L.gap, i), drag.active && drag.fromCell === i);
  }

  // 드래그 중인 고양이는 손가락을 따라다닌다.
  if (drag.active) {
    const cat = s.ally[drag.fromCell];
    if (cat) {
      const size = L.cell * 0.9;
      const img = spriteFor(cat.breed.id, "move");
      ctx.save();
      ctx.globalAlpha = 0.92;
      if (img) ctx.drawImage(img, drag.x - size / 2, drag.y - size / 2, size, size);
      ctx.restore();
    }
  }

  drawPops(ctx, L);
  drawOffers(ctx, L, s);
  drawSynergies(ctx, L, s);
  drawButton(ctx, L, s);
  drawNotice(ctx, L, s);
  drawGameOver(ctx, L, s);
}
