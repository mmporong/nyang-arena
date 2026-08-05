import { BOARD_COLS, BOARD_ROWS, cellCol, cellRow } from "./types.ts";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Layout {
  w: number;
  h: number;
  portrait: boolean;
  scale: number;
  hud: Rect;
  /** 안내 문구 전용 띠. 보드와 겹치지 않도록 레이아웃에서 자리를 뗀다. */
  notice: Rect;
  allyBoard: Rect;
  enemyBoard: Rect;
  cell: number;
  gap: number;
  /** 보드 위 진영 라벨이 차지하는 높이 */
  labelH: number;
  synergyBar: Rect;
  button: Rect;
  offers: Rect;
}

export function rectHas(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

/**
 * 가로에서는 두 보드를 좌우로, 세로에서는 위아래로 놓는다.
 * 세로에서 좌우 배치를 유지하면 셀이 손가락보다 작아져 드래그가 불가능해진다.
 */
export function computeLayout(w: number, h: number): Layout {
  const portrait = h > w * 1.05;
  const scale = Math.min(w / 900, h / 600);
  const pad = Math.round(Math.min(w, h) * 0.03);

  const hudH = Math.round(Math.max(44, Math.min(w, h) * 0.09));
  const barH = Math.round(Math.max(34, Math.min(w, h) * 0.07));
  const btnH = Math.round(Math.max(46, Math.min(w, h) * 0.09));

  const hud: Rect = { x: pad, y: pad, w: w - pad * 2, h: hudH };
  const bottomY = h - pad - btnH;
  const button: Rect = {
    x: portrait ? pad : w / 2 - Math.min(240, w * 0.3),
    y: bottomY,
    w: portrait ? w - pad * 2 : Math.min(480, w * 0.6),
    h: btnH,
  };
  const synergyBar: Rect = {
    x: pad,
    y: bottomY - barH - pad * 0.6,
    w: w - pad * 2,
    h: barH,
  };

  const noticeH = Math.round(Math.max(20, Math.min(w, h) * 0.045));
  const notice: Rect = { x: pad, y: hud.y + hud.h, w: w - pad * 2, h: noticeH };

  // 보드 위 진영 라벨("우리 편"/"상대")이 안내 문구와 겹치지 않도록 자리를 뗀다.
  const labelH = Math.round(Math.max(14, Math.min(w, h) * 0.032));
  const fieldTop = notice.y + notice.h + labelH;
  const fieldBottom = synergyBar.y - pad * 0.6;
  const fieldH = Math.max(80, fieldBottom - fieldTop);
  const fieldW = w - pad * 2;
  /** 두 보드 사이 간격. 셀 사이 간격보다 훨씬 커야 진영이 구분된다. */
  const midGap = Math.round(Math.min(w, h) * 0.09);

  let cell: number;
  let allyBoard: Rect;
  let enemyBoard: Rect;
  const gapRatio = 0.12;

  if (portrait) {
    // 위: 적, 아래: 아군. 사이에 간격을 둔다.
    const half = (fieldH - midGap) / 2;
    cell = Math.floor(
      Math.min(fieldW / (BOARD_COLS + (BOARD_COLS - 1) * gapRatio), half / (BOARD_ROWS + (BOARD_ROWS - 1) * gapRatio)),
    );
    const bw = cell * BOARD_COLS + cell * gapRatio * (BOARD_COLS - 1);
    const bh = cell * BOARD_ROWS + cell * gapRatio * (BOARD_ROWS - 1);
    const cx = w / 2 - bw / 2;
    enemyBoard = { x: cx, y: fieldTop, w: bw, h: bh };
    allyBoard = { x: cx, y: fieldBottom - bh, w: bw, h: bh };
  } else {
    const half = (fieldW - midGap) / 2;
    cell = Math.floor(
      Math.min(half / (BOARD_COLS + (BOARD_COLS - 1) * gapRatio), fieldH / (BOARD_ROWS + (BOARD_ROWS - 1) * gapRatio)),
    );
    const bw = cell * BOARD_COLS + cell * gapRatio * (BOARD_COLS - 1);
    const bh = cell * BOARD_ROWS + cell * gapRatio * (BOARD_ROWS - 1);
    const cy = fieldTop + fieldH / 2 - bh / 2;
    allyBoard = { x: w / 2 - midGap / 2 - bw, y: cy, w: bw, h: bh };
    enemyBoard = { x: w / 2 + midGap / 2, y: cy, w: bw, h: bh };
  }

  const offers: Rect = {
    x: pad,
    y: synergyBar.y - Math.max(70, cell * 0.9) - pad * 0.6,
    w: w - pad * 2,
    h: Math.max(70, cell * 0.9),
  };

  return {
    w,
    h,
    portrait,
    scale,
    hud,
    notice,
    allyBoard,
    enemyBoard,
    cell,
    gap: cell * gapRatio,
    labelH,
    synergyBar,
    button,
    offers,
  };
}

export function cellRect(board: Rect, cell: number, gap: number, index: number): Rect {
  return {
    x: board.x + cellCol(index) * (cell + gap),
    y: board.y + cellRow(index) * (cell + gap),
    w: cell,
    h: cell,
  };
}

/** 좌표가 어느 셀 위인지. 보드 밖이면 -1. */
export function hitCell(board: Rect, cell: number, gap: number, x: number, y: number): number {
  for (let i = 0; i < BOARD_COLS * BOARD_ROWS; i++) {
    if (rectHas(cellRect(board, cell, gap, i), x, y)) return i;
  }
  return -1;
}
