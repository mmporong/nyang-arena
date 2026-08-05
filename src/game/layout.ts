import {
  ALLY_FRONT_FX,
  BOARD_COLS,
  BOARD_ROWS,
  cellToField,
  ENEMY_FRONT_FX,
  type Side,
} from "./types.ts";

/** 카드 폭 상한과 세로 비율. 넓은 화면에서 카드가 현수막처럼 늘어나는 걸 막는다. */
const CARD_MAX_W = 192;
const CARD_ASPECT = 1.28;
/** 슬롯은 늘 세 칸. run.ts의 OFFER_SLOTS와 같은 값이어야 한다(레이아웃→런 의존을 안 만들려고 여기 둔다). */
const OFFER_SLOTS = 3;

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
  /** 보상 단계의 카드 영역. offers 위로 자라며 보드를 덮는다. */
  offerCards: Rect;
  offerGap: number;
  /** 카드 뒤 패널. 카드보다 위아래로 더 뻗는다. */
  offersPanel: Rect;
  /** 보드가 카드 패널 위로 올라가 항상 보이는지. false면 보상 단계가 모달이다. */
  roomy: boolean;
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
  const pad = Math.round(Math.min(w, h) * (Math.min(w, h) < 420 ? 0.022 : 0.03));

  // 보드가 5x5가 되면서 세로로 10줄이 필요하다. 작은 화면에서는 크롬 최소 높이를
  // 낮춰 보드에 자리를 넘긴다. 버튼만은 손가락 크기 아래로 내리지 않는다.
  const tight = Math.min(w, h) < 420;
  const hudH = Math.round(Math.max(tight ? 34 : 44, Math.min(w, h) * 0.09));
  // 시너지 칩은 폭이 좁으면 두 줄이 되므로 세로 화면에서만 바를 키운다.
  // 가로에서는 칩이 넓어 한 줄로 들어가고, 짧은 가로 화면은 그 1px이 아쉽다.
  const barFloor = portrait ? 34 : tight ? 26 : 34;
  const barH = Math.round(Math.max(barFloor, Math.min(w, h) * 0.07));
  const btnH = Math.round(Math.max(tight ? 42 : 46, Math.min(w, h) * 0.09));

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

  const noticeH = Math.round(Math.max(tight ? 13 : 20, Math.min(w, h) * 0.045));
  const notice: Rect = { x: pad, y: hud.y + hud.h, w: w - pad * 2, h: noticeH };

  // 보드 위 진영 라벨("우리 편"/"상대")이 안내 문구와 겹치지 않도록 자리를 뗀다.
  const labelH = Math.round(Math.max(tight ? 9 : 14, Math.min(w, h) * 0.032));

  /**
   * 보상 카드 영역.
   *
   * 높이를 cell이 아니라 min(w,h)에서 뽑는 이유: cell 계산이 이 값에 의존하므로
   * cell 기반으로 잡으면 순환이 생긴다. 아래 roomy 판정이 이 높이를 쓴다.
   */
  const offersH = Math.round(Math.max(tight ? 52 : 64, Math.min(w, h) * 0.135));
  const offers: Rect = {
    x: pad,
    y: synergyBar.y - pad * 0.6 - offersH,
    w: w - pad * 2,
    h: offersH,
  };
  // 렌더러가 카드 뒤에 까는 패널. 카드보다 위아래로 더 뻗으므로 레이아웃이 알아야 한다.
  const offersPadding = offersH * 0.18;
  const offersPanel: Rect = {
    x: 0,
    y: offers.y - offersPadding * 1.6,
    w,
    h: offersH + offersPadding * 2.6,
  };

  /**
   * 실제 카드가 그려지는 자리.
   *
   * offers는 준비 단계의 팀 요약 띠이자 카드의 아래쪽 기준선이고, offerCards는
   * 보상 단계에서만 쓰는 카드 영역이다. 카드가 카드로 보이려면 폭을 제한하고
   * 세로로 세워야 하는데, 그 높이를 보드 예산에 넣으면 보드가 절반이 된다.
   * 그래서 위로만 자라게 하고 보상 단계에는 보드를 덮는다 — 그동안 보드는
   * 어차피 만질 수 없다(main.ts canRearrange는 prepare 단계에서만 참).
   */
  const cardGap = Math.max(6, Math.round(Math.min(w, h) * 0.016));
  const cardW = Math.min(CARD_MAX_W, (offers.w - cardGap * (OFFER_SLOTS - 1)) / OFFER_SLOTS);
  const offersBottom = offers.y + offers.h;
  /**
   * 위로 쓸 수 있는 높이. 안내 문구 아래까지만 쓰고, 그중 HEAD_BAND는 카드 머리줄
   * (안내 한 줄 + 다시 뽑기 버튼) 몫으로 뗀다. 이걸 빼먹으면 좁은 화면에서
   * 다시 뽑기 버튼이 안내 문구 위로 올라타 글자가 겹친다.
   */
  const HEAD_BAND = 46;
  const ceilH = offersBottom - (notice.y + notice.h) - HEAD_BAND;

  let offerCards: Rect;
  if (ceilH >= cardW * 0.9) {
    // 카드를 세울 수 있다. 폭을 제한하고 가운데로 모은다.
    const cardH = Math.min(cardW * CARD_ASPECT, ceilH);
    const rowW = cardW * OFFER_SLOTS + cardGap * (OFFER_SLOTS - 1);
    offerCards = {
      x: Math.round(w / 2 - rowW / 2),
      y: Math.round(offersBottom - cardH),
      w: Math.round(rowW),
      h: Math.round(cardH),
    };
  } else {
    // 세울 높이가 없으면 눕힌다. 이때는 폭을 다 써야 이름·능력·설명이 들어간다.
    offerCards = { ...offers };
  }

  const fieldTop = notice.y + notice.h + labelH;

  /**
   * 여유가 있으면 카드 패널 위로 보드를 올려 항상 보이게 하고, 없으면 보드가
   * 패널 아래로 들어가게 둔다.
   *
   * 짧은 가로 화면(예: 667×275)은 HUD·안내·시너지·버튼만으로 256px를 먹어서
   * 카드 자리를 떼면 보드에 19px밖에 안 남는다. 그런 화면에서는 보상 단계를
   * 모달로 취급한다 — 가려도 되지만, 대신 그동안 보드 입력을 막아야 한다
   * (canRearrange가 prepare 페이즈에서만 참인 이유).
   */
  const MIN_BOARD_H = 150;
  const roomy = offersPanel.y - pad * 0.5 - fieldTop >= MIN_BOARD_H;
  const fieldBottom = roomy ? offersPanel.y - pad * 0.5 : synergyBar.y - pad * 0.6;
  const fieldH = Math.max(80, fieldBottom - fieldTop);
  const fieldW = w - pad * 2;
  /** 두 보드 사이 간격. 셀 사이 간격보다 훨씬 커야 진영이 구분된다. */
  const midGap = Math.round(Math.min(w, h) * (Math.min(w, h) < 420 ? 0.05 : 0.09));

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
    offerCards,
    offerGap: cardGap,
    offersPanel,
    roomy,
  };
}

/**
 * 전투 좌표(fx, fy) → 화면 좌표.
 *
 * fx는 "적 쪽으로" 향하는 축이다. 가로에서는 화면 x축(오른쪽이 적), 세로에서는
 * 화면 y축(위쪽이 적)에 대응한다. 그래서 **세로에서는 보드가 전치된다** —
 * 열(col)이 세로로 늘어서고 행(row)이 가로로 늘어선다.
 *
 * 이렇게 하지 않으면 "적에게 가까운 열이 앞줄"이라는 규칙이 세로에서 깨진다.
 * 유닛이 실제로 이동하기 시작하면 그 불일치가 바로 눈에 띈다(옆으로 붙어야
 * 하는데 위로 걸어감).
 *
 * 두 보드 사이 구간은 선형 보간한다. 근접 유닛이 그 사이를 가로질러 걸어간다.
 */
export function fieldToScreen(L: Layout, fx: number, fy: number): { x: number; y: number } {
  const pitch = L.cell + L.gap;
  const half = L.cell / 2;

  // 적 진영 축(fx) 위의 화면 위치
  // 아군 앞줄과 적 앞줄의 화면 위치. 그 사이는 선형 보간한다.
  const allyEnd = L.portrait ? L.allyBoard.y + half : L.allyBoard.x + half + ALLY_FRONT_FX * pitch;
  const enemyStart = L.portrait
    ? L.enemyBoard.y + half + ALLY_FRONT_FX * pitch
    : L.enemyBoard.x + half;

  let axis: number;
  if (fx <= ALLY_FRONT_FX) {
    axis = L.portrait
      ? L.allyBoard.y + half + (ALLY_FRONT_FX - fx) * pitch
      : L.allyBoard.x + half + fx * pitch;
  } else if (fx >= ENEMY_FRONT_FX) {
    axis = L.portrait
      ? L.enemyBoard.y + half + (ENEMY_FRONT_FX + ALLY_FRONT_FX - fx) * pitch
      : L.enemyBoard.x + half + (fx - ENEMY_FRONT_FX) * pitch;
  } else {
    const t = (fx - ALLY_FRONT_FX) / (ENEMY_FRONT_FX - ALLY_FRONT_FX);
    axis = allyEnd + (enemyStart - allyEnd) * t;
  }

  // 진영과 나란한 축(fy)
  const cross = L.portrait ? L.allyBoard.x + half + fy * pitch : L.allyBoard.y + half + fy * pitch;

  return L.portrait ? { x: cross, y: axis } : { x: axis, y: cross };
}

/** 셀 하나가 차지하는 화면 사각형. 배치와 전투 렌더가 같은 변환을 쓰도록 묶어 둔다. */
export function cellRect(L: Layout, side: Side, index: number): Rect {
  const { fx, fy } = cellToField(side, index);
  const { x, y } = fieldToScreen(L, fx, fy);
  return { x: x - L.cell / 2, y: y - L.cell / 2, w: L.cell, h: L.cell };
}

/**
 * 좌표가 어느 셀 위인지. 보드 밖이면 -1.
 *
 * 판정 영역을 셀 간격의 절반만큼 넓힌다. 5x5에서는 셀이 작아지는데, 눈에 보이는
 * 사각형만 받으면 손가락으로 집기 어렵다. 칸끼리 맞닿게 만들어 빈틈을 없앤다.
 */
export function hitCell(L: Layout, side: Side, x: number, y: number): number {
  const pad = L.gap / 2;
  for (let i = 0; i < BOARD_COLS * BOARD_ROWS; i++) {
    const r = cellRect(L, side, i);
    if (rectHas({ x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 }, x, y)) return i;
  }
  return -1;
}
