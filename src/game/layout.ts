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
/** 목표(시너지)도 늘 셋. `pickSynergies`가 세 개를 뽑는다. 같은 이유로 여기 둔다. */
const SYNERGY_SLOTS = 3;

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
  /**
   * 정보와 카드를 판 양옆 **세로줄**에 세우는가.
   *
   * 가로 화면이 넉넉할 때만 참이다. 좁은 가로(667x375 같은 폰 가로)에서는
   * 줄을 세울 폭이 없어 세로 화면과 같은 구성으로 접는다.
   */
  columns: boolean;
  /**
   * 판이 세로 구성(적 위·우리 아래)인가.
   *
   * 원칙은 언제나 참이다. 두 판을 쌓을 높이가 없어 셀이 손가락보다 작아지는
   * 화면(667×275 같은 납작한 가로)에서만 거짓이 되어 좌우로 눕는다.
   */
  stacked: boolean;
  scale: number;
  hud: Rect;
  /**
   * 음소거 토글. HUD 오른쪽 끝에서 자리를 뗀다.
   *
   * 캔버스 위에 떠 있게 두지 않고 레이아웃이 자리를 갖는 이유는, 떠 있는
   * 물건은 화면 비율이 바뀔 때마다 무언가를 덮기 때문이다. 여기 있으면
   * HUD 칩 셋이 그만큼 좁아질 뿐 겹칠 일이 없다.
   */
  mute: Rect;
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
  /** 팀 요약(직업 카운터) 자리. 세로줄에서는 왼쪽 줄 위쪽이다. */
  offers: Rect;
  /** 보상 단계의 카드 영역. 세로줄에서는 오른쪽 줄, 아니면 offers 위로 자란다. */
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
 * **판은 언제나 세로 구성이다** — 적이 위, 우리 편이 아래.
 *
 * 예전에는 가로에서 좌우로 놓았다. 그러면 남는 폭을 판이 쓰긴 하는데, 화면마다
 * 진영의 방향이 달라져 같은 게임이 두 개가 된다. 세로에서 익힌 "위가 적"이
 * 가로에서는 "오른쪽이 적"이 되고, 그 사이에 배치 감각이 옮겨지지 않는다.
 * 세로 하나로 고정하면 판은 좁아지지만 판을 읽는 법은 하나가 된다.
 *
 * 남는 가로 폭은 **세로줄 둘**이 쓴다(TFT가 정보를 판 옆에 세우는 것과 같다).
 * 왼쪽은 팀 상태 — 직업 수와 시너지 진행도. 오른쪽은 상점 카드.
 *
 * 이 구성이 푸는 문제가 둘이다.
 *
 * 1. 1280×800에서 판이 화면의 24.9%뿐이고 아래 정보 띠가 세로의 39%였다.
 *    **가장 중요한 신호가 가장 좁은 자리에** 있었다. 정보를 옆으로 보내면
 *    세로는 통째로 판의 것이 된다.
 * 2. 상점에서 카드가 판을 덮고 있었다. 길을 고른 뒤 **적을 보면서 사는** 순서로
 *    바뀌면서 그건 그냥 고장이 됐다 — 보라고 만든 것을 가리고 있으니.
 *    카드가 오른쪽 줄에 서면 덮을 일이 없다.
 *
 * 줄을 세울 폭이 없는 화면(폰 가로, 세로 화면)에서는 예전 구성으로 접는다.
 * 거기서는 카드가 여전히 판 위로 자라고, `shop` 인자가 국면에 따라 아래 띠의
 * 높이를 가른다.
 */
export function computeLayout(w: number, h: number, shop = true): Layout {
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

  // 음소거는 손가락으로 눌러야 하므로 HUD가 얇아져도 32px 아래로는 안 간다.
  const muteS = Math.round(Math.max(32, Math.min(hudH, 40)));
  const muteGap = Math.round(pad * 0.5);
  const hud: Rect = { x: pad, y: pad, w: w - pad * 2 - muteS - muteGap, h: hudH };
  const mute: Rect = {
    x: w - pad - muteS,
    y: pad + Math.round((hudH - muteS) / 2),
    w: muteS,
    h: muteS,
  };
  const bottomY = h - pad - btnH;

  /**
   * 세로줄을 세울 수 있는가.
   *
   * 줄 하나가 168px 아래로 내려가면 카드에 이름·능력·설명이 안 들어가고,
   * 가운데에 판 두 장이 설 폭(320px)이 안 남으면 판이 줄보다 좁아진다.
   * 둘 중 하나라도 못 지키면 접는다 — 폰 가로(667×375)가 여기 걸린다.
   */
  const COL_MIN_W = 168;
  const colW = Math.round(Math.min(340, Math.max(COL_MIN_W, w * 0.26)));
  const colGap = Math.round(pad * 1.2);
  const columns = !portrait && colW >= COL_MIN_W && w - (pad + colW + colGap) * 2 >= 320;

  const button: Rect = {
    x: portrait || !columns ? pad : pad + colW + colGap,
    y: bottomY,
    w: portrait || !columns ? w - pad * 2 : w - (pad + colW + colGap) * 2,
    h: btnH,
  };

  // 보스전에는 이 띠가 보스 전용 체력 배너가 된다. 배너 안에 이름·막대·남은
  // 페이즈가 한 줄로 들어가야 해서 안내 문구만 있을 때보다 조금 두껍다.
  // 좁은 화면(tight)에서는 그대로 두는데, 거기서는 배너도 같이 줄어든다.
  const noticeH = Math.round(Math.max(tight ? 13 : 24, Math.min(w, h) * (tight ? 0.045 : 0.055)));
  const notice: Rect = { x: pad, y: hud.y + hud.h, w: w - pad * 2, h: noticeH };

  // 보드 위 진영 라벨("우리 편"/"상대")이 안내 문구와 겹치지 않도록 자리를 뗀다.
  const labelH = Math.round(Math.max(tight ? 9 : 14, Math.min(w, h) * 0.032));

  const cardGap = Math.max(6, Math.round(Math.min(w, h) * 0.016));
  const fieldTop = notice.y + notice.h + labelH;

  let synergyBar: Rect;
  let offers: Rect;
  let offerCards: Rect;
  let offersPanel: Rect;
  let roomy: boolean;
  let fieldBottom: number;
  let fieldLeft: number;
  let fieldW: number;

  if (columns) {
    /**
     * 세로줄 구성. 판은 가운데를 통째로 쓰고 정보는 옆으로 나간다.
     *
     * 두 줄 다 위에서 아래로 흐른다 — 왼쪽은 **내 팀이 지금 어떤가**(직업 수 →
     * 목표 진행도), 오른쪽은 **무엇을 살 수 있나**(다시 뽑기 → 카드 셋).
     * 읽는 순서가 곧 결정하는 순서다.
     */
    const colTop = fieldTop;
    const colBottom = bottomY - pad * 0.6;
    const colH = Math.max(120, colBottom - colTop);
    const rightX = w - pad - colW;

    /**
     * 직업 카운터 다섯 줄. 목표 칩은 그 아래.
     *
     * 둘 다 **필요한 만큼만** 쓰고 남는 높이는 비운다. 줄을 꽉 채우려고 늘렸더니
     * 칩 하나가 120px이 되어 화면에서 가장 큰 물건이 됐다 — design-brief 4-2가
     * 잡은 "참고 정보가 주인공보다 크다"를 세로줄에서 그대로 재현한 셈이다.
     */
    const stripH = Math.round(Math.min(colH * 0.3, Math.max(110, colW * 0.62)));
    const stripGap = Math.round(pad * 0.9);
    offers = { x: pad, y: colTop, w: colW, h: stripH };

    /**
     * 목표 칩은 **필요한 만큼만** 차지한다. 남는 높이는 비운다.
     *
     * 칩 크기를 여기서 정하는 이유는 렌더가 아니라 레이아웃이 패널의 끝을 알아야
     * 하기 때문이다. 줄 높이를 그대로 주면 패널이 화면 바닥까지 늘어져 빈 상자가
     * 된다. `drawSynergies`가 같은 식을 쓴다 — 둘이 갈라지면 칩이 패널을 넘는다.
     */
    const barAvail = colH - stripH - stripGap;
    const chipGap = Math.max(6, colW * 0.04);
    const chipH = Math.max(
      52,
      Math.min(colW * 0.23, (barAvail - chipGap * (SYNERGY_SLOTS - 1)) / SYNERGY_SLOTS),
    );
    const barH2 = Math.min(barAvail, chipH * SYNERGY_SLOTS + chipGap * (SYNERGY_SLOTS - 1));
    synergyBar = { x: pad, y: colTop + stripH + stripGap, w: colW, h: barH2 };

    // 오른쪽 줄 위쪽은 머리줄(안내 한 줄 + 다시 뽑기) 몫으로 뗀다.
    const head = Math.round(Math.max(34, Math.min(48, colH * 0.1)));
    offerCards = { x: rightX, y: colTop + head, w: colW, h: colH - head };
    offersPanel = {
      x: rightX - pad * 0.5,
      y: colTop - pad * 0.4,
      w: colW + pad,
      h: colH + pad * 0.8,
    };
    // 카드가 판을 덮지 않는다. 보상 단계가 모달이 될 일이 없다.
    roomy = true;
    fieldBottom = colBottom;
    fieldLeft = pad + colW + colGap;
    fieldW = w - fieldLeft * 2;
  } else {
    /**
     * 접힌 구성(세로 화면·폰 가로). 정보가 판 아래에 띠로 쌓인다.
     *
     * 카드는 `offers` 띠에서 **위로만** 자라 보상 단계에 판을 덮는다. 덮어도 되는
     * 이유는 `main.ts`의 `canRearrange()`가 `prepare`에서만 참이라 그동안 판이
     * 입력을 안 받기 때문이다. 이 불변식이 깨지면 카드가 탭을 가로챈다.
     * 단, HUD와 안내 문구는 절대 덮지 않는다. `npm run probe`가 둘 다 검사한다.
     */
    synergyBar = { x: pad, y: bottomY - barH - pad * 0.6, w: w - pad * 2, h: barH };

    // 높이를 cell이 아니라 min(w,h)에서 뽑는다. cell 계산이 이 값에 의존하므로
    // cell 기반으로 잡으면 순환이 생긴다.
    const offersH = Math.round(Math.max(tight ? 52 : 64, Math.min(w, h) * 0.135));
    offers = { x: pad, y: synergyBar.y - pad * 0.6 - offersH, w: w - pad * 2, h: offersH };

    const offersPadding = offersH * 0.18;
    offersPanel = { x: 0, y: offers.y - offersPadding * 1.6, w, h: offersH + offersPadding * 2.6 };

    const cardW = Math.min(CARD_MAX_W, (offers.w - cardGap * (OFFER_SLOTS - 1)) / OFFER_SLOTS);
    const offersBottom = offers.y + offers.h;
    // 위로 쓸 수 있는 높이. 안내 문구 아래까지만 쓰고, 그중 HEAD_BAND는 카드
    // 머리줄 몫으로 뗀다. 빼먹으면 다시 뽑기가 안내 문구 위로 올라탄다.
    const HEAD_BAND = 46;
    const ceilH = offersBottom - (notice.y + notice.h) - HEAD_BAND;

    if (ceilH >= cardW * 0.9) {
      const cardH = Math.min(cardW * CARD_ASPECT, ceilH);
      const rowW = cardW * OFFER_SLOTS + cardGap * (OFFER_SLOTS - 1);
      offerCards = {
        x: Math.round(w / 2 - rowW / 2),
        y: Math.round(offersBottom - cardH),
        w: Math.round(rowW),
        h: Math.round(cardH),
      };
    } else {
      // 세울 높이가 없으면 눕힌다. 폭을 다 써야 이름·능력·설명이 들어간다.
      offerCards = { ...offers };
    }

    // 짧은 가로 화면(667×275)은 크롬만으로 256px를 먹어 판에 19px밖에 안 남는다.
    // 그런 화면에서는 보상 단계를 모달로 취급한다.
    const MIN_BOARD_H = 150;
    roomy = offersPanel.y - pad * 0.5 - fieldTop >= MIN_BOARD_H;
    // 카드가 없는 국면에서는 판이 시너지 바까지 내려간다. 세로에서는 원래도 판이
    // 넓어서 이 전환이 오히려 화면을 요동치게 만들므로 가로에서만 가른다.
    const expand = !shop && !portrait;
    fieldBottom = expand || !roomy ? synergyBar.y - pad * 0.6 : offersPanel.y - pad * 0.5;
    fieldLeft = pad;
    fieldW = w - pad * 2;
  }

  const fieldH = Math.max(80, fieldBottom - fieldTop);
  /** 두 보드 사이 간격. 셀 사이 간격보다 훨씬 커야 진영이 구분된다. */
  const midGap = Math.round(Math.min(w, h) * (Math.min(w, h) < 420 ? 0.05 : 0.09));
  const gapRatio = 0.12;
  const colsDen = BOARD_COLS + (BOARD_COLS - 1) * gapRatio;
  const rowsDen = BOARD_ROWS + (BOARD_ROWS - 1) * gapRatio;

  /**
   * 판은 **위가 적, 아래가 우리 편**이 원칙이다.
   *
   * 예전에는 가로에서 좌우로 놓았다. 화면 방향이 진영의 방향을 바꾸면 같은
   * 게임이 두 개가 되고, 세로에서 익힌 배치 감각이 가로로 안 옮겨진다.
   *
   * 다만 **두 판을 위아래로 세울 높이가 없으면 물러난다.** 5x5 둘을 쌓으려면
   * 세로로 열 줄이 필요한데, 275px 높이의 가로 창에서는 셀이 10px가 되어
   * 손가락으로 집을 수 없다(측정: 667×275에서 10px, 1200×300에서 15px).
   * 원칙을 지키려다 판을 못 쓰게 만드는 것보다, 그런 화면에서만 눕히는 편이 낫다.
   */
  const STACK_FLOOR = 24;
  const stackedHalf = (fieldH - midGap) / 2;
  const stackedCell = Math.floor(Math.min(fieldW / colsDen, stackedHalf / rowsDen));
  const sideHalf = (fieldW - midGap) / 2;
  const sideCell = Math.floor(Math.min(sideHalf / colsDen, fieldH / rowsDen));
  const stacked = stackedCell >= STACK_FLOOR || stackedCell >= sideCell;

  const cell = stacked ? stackedCell : sideCell;
  const bw = cell * BOARD_COLS + cell * gapRatio * (BOARD_COLS - 1);
  const bh = cell * BOARD_ROWS + cell * gapRatio * (BOARD_ROWS - 1);

  let enemyBoard: Rect;
  let allyBoard: Rect;
  if (stacked) {
    const cx = fieldLeft + fieldW / 2 - bw / 2;
    enemyBoard = { x: cx, y: fieldTop, w: bw, h: bh };
    allyBoard = { x: cx, y: fieldBottom - bh, w: bw, h: bh };

    /**
     * **세로줄을 판에 붙인다. 세로줄 구성일 때만이다.**
     *
     * `stacked`는 세로 화면에서도 참이고, 거기서 이 사각형들은 화면 폭을 다
     * 쓰는 **아래 띠**다. 구분 없이 옮겼더니 프로브가 다섯 기기에서 실패했다 —
     * 폭 전체를 쓰던 띠가 세로줄 폭으로 줄어 카드가 판을 덮었다.
     *
     * 두 줄은 화면 가장자리(`pad`)에 고정돼 있었고 판은 남은 폭 가운데에 섰다.
     * 판이 대개 그 폭보다 훨씬 좁아서 1280px 화면에서 왼쪽 줄과 판 사이가
     * 170px 비었다 — 화면에서 가장 넓은 것이 아무것도 없는 자리였다.
     *
     * 판을 기준으로 양옆에 붙이면 셋이 한 덩어리로 읽히고, 남는 폭은 바깥으로
     * 밀려 여백이 된다. 여백은 가운데가 아니라 가장자리에 있어야 한다.
     *
     * 화면 밖으로는 안 나간다. 판이 넓은 화면에서는 원래 자리(`pad`)로 되돌아온다.
     */
    if (columns) {
      const hug = Math.round(colGap * 1.1);
      const leftX = Math.max(pad, Math.round(cx - hug - colW));
      const rightX2 = Math.min(w - pad - colW, Math.round(cx + bw + hug));
      offers = { ...offers, x: leftX };
      synergyBar = { ...synergyBar, x: leftX };
      offerCards = { ...offerCards, x: rightX2 };
      offersPanel = { ...offersPanel, x: rightX2 - pad * 0.5 };
    }
  } else {
    const cy = fieldTop + fieldH / 2 - bh / 2;
    const mid = fieldLeft + fieldW / 2;
    allyBoard = { x: mid - midGap / 2 - bw, y: cy, w: bw, h: bh };
    enemyBoard = { x: mid + midGap / 2, y: cy, w: bw, h: bh };
  }

  return {
    w,
    h,
    portrait,
    columns,
    stacked,
    scale,
    hud,
    mute,
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
 * fx는 "적 쪽으로" 향하는 축이고 **언제나 화면 y축**이다(위쪽이 적). 판을 세로
 * 구성으로 고정하면서 가로용 분기가 없어졌다 — 예전에는 가로에서 fx가 화면
 * x축이었고, 그래서 같은 코드가 화면 방향에 따라 다른 그림을 냈다.
 *
 * **보드는 전치된다** — 열(col)이 세로로 늘어서고 행(row)이 가로로 늘어선다.
 * 이렇게 하지 않으면 "적에게 가까운 열이 앞줄"이라는 규칙이 깨지고, 유닛이
 * 움직이기 시작하면 그 불일치가 바로 눈에 띈다(옆으로 붙어야 하는데 위로 걸어감).
 *
 * 두 보드 사이 구간은 선형 보간한다. 근접 유닛이 그 사이를 가로질러 걸어간다.
 */
export function fieldToScreen(L: Layout, fx: number, fy: number): { x: number; y: number } {
  const pitch = L.cell + L.gap;
  const half = L.cell / 2;

  // 아군 앞줄과 적 앞줄의 화면 위치. 그 사이는 선형 보간한다.
  const allyEnd = L.stacked ? L.allyBoard.y + half : L.allyBoard.x + half + ALLY_FRONT_FX * pitch;
  const enemyStart = L.stacked
    ? L.enemyBoard.y + half + ALLY_FRONT_FX * pitch
    : L.enemyBoard.x + half;

  let axis: number;
  if (fx <= ALLY_FRONT_FX) {
    axis = L.stacked
      ? L.allyBoard.y + half + (ALLY_FRONT_FX - fx) * pitch
      : L.allyBoard.x + half + fx * pitch;
  } else if (fx >= ENEMY_FRONT_FX) {
    axis = L.stacked
      ? L.enemyBoard.y + half + (ENEMY_FRONT_FX + ALLY_FRONT_FX - fx) * pitch
      : L.enemyBoard.x + half + (fx - ENEMY_FRONT_FX) * pitch;
  } else {
    const t = (fx - ALLY_FRONT_FX) / (ENEMY_FRONT_FX - ALLY_FRONT_FX);
    axis = allyEnd + (enemyStart - allyEnd) * t;
  }

  const cross = L.stacked ? L.allyBoard.x + half + fy * pitch : L.allyBoard.y + half + fy * pitch;
  return L.stacked ? { x: cross, y: axis } : { x: axis, y: cross };
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
