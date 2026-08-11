import {
  damagePops,
  fxs,
  POP_LIFE_MS,
  shots,
  SHOT_LIFE_MS,
  skillName,
  type Fx,
} from "./battle.ts";
import { bossForIndex, bossKit, BOSS_THRESHOLDS, SNIPER_BREED } from "./bosses.ts";
import { drawScene, type Scene } from "./backdrop.ts";
import { bossHint, nodeInfo, openLanes, STAGE_STEPS } from "./map.ts";
import { drawFish, drawIcon, drawNodeIcon, drawSpeaker, type IconName } from "./icons.ts";
import { isMuted } from "./audio.ts";
import { cellRect, fieldToScreen, type Layout, type Rect } from "./layout.ts";
import { spriteFor } from "./sprites.ts";
import {
  boardUnits,
  OFFER_SLOTS,
  REROLL_COST,
  unitCap,
  currentKind,
  waveKindInfo,
  mapStep,
  bossIndexAt,
  bossesSeen,
  relicActive,
  type Offer,
  type RunState,
} from "./run.ts";
import { RELICS } from "./relics.ts";

/** 유물 총 종류. 오른쪽 줄이 "몇 개 중 몇 개"를 말하고 칸 높이를 여기서 뽑는다. */
const RELIC_TOTAL = RELICS.length;
import {
  bevelPanel,
  numText,
  numTextHeight,
  numTextWidth,
  roundRect,
  T,
  uiText,
  wrapLines,
} from "./theme.ts";
import {
  effectLabel,
  synergyProgress,
  triggerLabel,
} from "../validate/synergy-schema.ts";
import { PASSIVES, SKILLS } from "./skills.ts";
import {
  BOARD_SIZE,
  CLASS_LABEL,
  livingCats,
  type Cat,
  type ClassKind,
  type Pose,
  type Side,
} from "./types.ts";

/**
 * 셀 대비 고양이 그리기 크기.
 * 작을수록 전장이 넓어 보이고 유닛이 겹칠 일이 줄어든다.
 * 체력바·뱃지는 셀이 아니라 이 크기에 비례시켜야 축소해도 비율이 안 깨진다.
 */
/*
 * 기기별로 조작 안내를 갈라 주던 `HAS_KEYS`는 지웠다. 개입이 버튼 하나가
 * 되면서 안내할 조작 자체가 없어졌다 — 어디서든 "그 버튼을 누른다"가 전부다.
 */

const CAT_SCALE = 0.66;

/** 시너지 트리거마다 고유색. TFT가 특성별로 색을 나누는 것과 같은 이유 — 한눈에 구분되게. */
/**
 * 직업 색. 뱃지와 카드에서 같은 색을 쓴다.
 *
 * 전부 저채도다. 직업은 **정체성**이지 신호가 아니므로 판 위에서 예고와
 * 경쟁하면 안 된다. 특히 궁수는 원래 액션 버튼과 같은 주황이었는데, 주황을
 * 버튼에 양보하고 청동으로 물러났다.
 */
const CLASS_COLOR: Record<ClassKind, string> = {
  warrior: "#C4715A",
  rogue: "#A97CC4",
  archer: "#C9A05C",
  mage: "#6E97C4",
};

/**
 * 직업 아이콘. 7x7 비트맵으로, 각 행의 하위 7비트가 한 줄이다.
 *
 * 전에는 "전·도·궁·법" 한 글자를 시스템 폰트로 뱃지에 찍었다. 지름 20px짜리
 * 원 안의 한글은 획이 뭉개져서, 결국 **색으로만** 구분하게 된다. 그런데 직업색은
 * 저채도로 물러난 상태라 그 색조차 약하다.
 *
 * 도형은 색을 못 봐도 갈린다. 실루엣이 서로 최대한 안 겹치게 골랐다 —
 * 넓은 사다리꼴(방패) · 대각선(단검) · 열린 호(활) · 대칭 십자(별).
 * 무기 고증보다 **7px에서 구분되는가**가 기준이다.
 *
 * 세로줄의 직업 목록은 이걸 안 쓴다(`CLASS_PICTO` 참고). 거기는 20px이라
 * 그림이 들어가지만, 판 위 뱃지는 7~10px이라 실루엣이 뭉갠다. 같은 정보를
 * 두 크기로 보여주는 자리라 **그림도 둘**이어야 한다.
 */
const CLASS_ICON: Record<ClassKind, readonly number[]> = {
  // 방패 — 넓게 시작해 아래로 좁아진다
  warrior: [0x7f, 0x7f, 0x3e, 0x3e, 0x1c, 0x1c, 0x08],
  // 단검 — 오른쪽 위로 뻗는 대각선
  rogue: [0x03, 0x06, 0x0c, 0x18, 0x38, 0x70, 0x20],
  // 활 — 오른쪽으로 열린 호
  archer: [0x38, 0x44, 0x42, 0x42, 0x42, 0x44, 0x38],
  // 별 — 상하좌우 대칭 십자
  mage: [0x08, 0x08, 0x1c, 0x7f, 0x1c, 0x08, 0x08],
};

/** 세로줄 직업 목록용 그림. 판 위 뱃지(7x7 비트맵)와 크기가 달라 따로 둔다. */
const CLASS_PICTO: Record<ClassKind, IconName> = {
  warrior: "cls-warrior",
  rogue: "cls-rogue",
  archer: "cls-archer",
  mage: "cls-mage",
};

/** 뱃지 안에 직업 표식을 그린다. */
function drawClassIcon(
  ctx: CanvasRenderingContext2D,
  cls: ClassKind,
  cx: number,
  cy: number,
  size: number,
  color: string,
): void {
  const rows = CLASS_ICON[cls];
  // 픽셀을 정수로 떨어뜨린다. 소수 크기로 그리면 7px 도형이 흐려져 아이콘의
  // 유일한 장점(또렷함)이 사라진다.
  const p = Math.max(1, Math.round(size / 7));
  const x0 = Math.round(cx - (p * 7) / 2);
  const y0 = Math.round(cy - (p * 7) / 2);
  ctx.fillStyle = color;
  for (let r = 0; r < 7; r++) {
    const bits = rows[r] ?? 0;
    for (let c = 0; c < 7; c++) {
      if (bits & (1 << (6 - c))) ctx.fillRect(x0 + c * p, y0 + r * p, p, p);
    }
  }
}

const TRIGGER_COLOR: Record<string, string> = {
  same_color_3: "#C9A05C",
  same_breed_2: "#A97CC4",
  front_melee_2: "#C4715A",
  back_ranged_2: "#6E97C4",
};

export interface DragState {
  active: boolean;
  fromCell: number;
  x: number;
  y: number;
  /** 드래그를 시작한 포인터. 멀티터치에서 다른 손가락이 끼어드는 걸 막는다. */
  pointerId: number;
  /**
   * 마우스가 지금 있는 자리. 드래그 중이 아니어도 늘 갱신된다.
   *
   * 손가락에는 호버가 없으므로 터치에서는 -1로 남는다. 호버는 **덤**이지
   * 정보를 거기에만 두면 안 된다는 뜻이다 — 지금 지도의 갈래 설명이 요약
   * 줄에도 같이 뜨는 이유다.
   */
  hoverX: number;
  hoverY: number;
}

/* ------------------------------------------------------------------ */
/* 배경과 아레나                                                        */
/* ------------------------------------------------------------------ */

/**
 * 이번 웨이브의 무대.
 *
 * 보스는 자기 무대를 갖는다 — 성격을 공간이 먼저 말하기 때문이다. 정면 대결은
 * 콜로세움, 순간이동은 겹친 지붕, 제자리 원형 장판은 얼어붙은 수면. 나머지
 * 웨이브는 전부 숲이고, 숲만 하루가 흐른다.
 */
function sceneForWave(s: RunState): Scene {
  const boss = s.enemy.find((c) => c?.radius && c.radius > 0 && c.breed.id !== SNIPER_BREED.id);
  if (boss) {
    if (boss.breed.id === 10) return "alley";
    if (boss.breed.id === 11) return "frost";
    return "stone";
  }
  return "forest";
}

/**
 * 하루의 진행. 열 웨이브가 하루다.
 *
 * 웨이브 번호를 그대로 쓰면 판이 길어질수록 영원히 밤이다. 스테이지가 넘어가면
 * 다시 아침으로 돌아와야 "또 하루가 시작됐다"가 읽히고, 그게 곧 진행감이다.
 */
const STAGE_WAVES = 10;
function dayProgress(wave: number): number {
  return ((wave - 1) % STAGE_WAVES) / (STAGE_WAVES - 1);
}

function drawBackground(ctx: CanvasRenderingContext2D, L: Layout, s: RunState): void {
  ctx.fillStyle = T.ink;
  ctx.fillRect(0, 0, L.w, L.h);

  drawScene(ctx, L.w, L.h, sceneForWave(s), dayProgress(s.wave));

  /**
   * 어둠을 세로로 다르게 깐다.
   *
   * 평평하게 덮으면 둘 중 하나를 잃는다 — 옅으면 밝은 하늘 위에서 HUD 글자가
   * 날아가고, 짙으면 씬이 진흙이 된다. 글자가 있는 위아래는 짙게, 판이 있는
   * 가운데는 옅게 두면 씬은 살고 글자는 읽힌다.
   */
  const top = L.notice.y + L.notice.h;
  const bottom = L.offersPanel.y;
  const g = ctx.createLinearGradient(0, 0, 0, L.h);
  g.addColorStop(0, "rgba(9,6,5,0.80)");
  g.addColorStop(Math.max(0.02, Math.min(0.98, top / L.h)), "rgba(9,6,5,0.30)");
  g.addColorStop(Math.max(0.03, Math.min(0.99, bottom / L.h)), "rgba(9,6,5,0.42)");
  g.addColorStop(1, "rgba(9,6,5,0.86)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, L.w, L.h);
}

function arenaBox(L: Layout): Rect {
  const pad = L.cell * 0.34;
  const x = Math.min(L.allyBoard.x, L.enemyBoard.x) - pad;
  // 진영 라벨까지 감싸되 안내 문구 띠는 침범하지 않는다.
  // 클램프가 없으면 패널 윗변이 문구를 가로지른다.
  const y = Math.max(
    Math.min(L.allyBoard.y, L.enemyBoard.y) - pad * 0.5 - L.labelH,
    L.notice.y + L.notice.h,
  );
  const right =
    Math.max(L.allyBoard.x + L.allyBoard.w, L.enemyBoard.x + L.enemyBoard.w) +
    pad;
  const bottom =
    Math.max(L.allyBoard.y + L.allyBoard.h, L.enemyBoard.y + L.enemyBoard.h) +
    pad;
  return { x, y, w: right - x, h: bottom - y };
}


/**
 * 보스 광역기 예고.
 *
 * 보이지 않는 경고는 경고가 아니다. 터지기 전에 어디가 위험한지 보여주고,
 * 남은 시간에 따라 차오르게 해서 "곧 터진다"가 읽히게 한다.
 *
 * 판정은 battle.ts가 정준 좌표에서 하고 여기서는 그리기만 한다. 두 곳에서
 * 따로 계산하면 보이는 곳과 맞는 곳이 갈라진다.
 */
/**
 * 사선 해칭 — "여기서 나가라".
 *
 * 색만으로 신호를 나누면 적록색약에게는 두 예고가 같은 회색 판이 된다. 형태를
 * 하나씩 붙이면 색을 못 봐도 무늬로 갈린다. 호출부에서 예고 모양으로 클립한 뒤
 * 부르므로 여기서는 넉넉한 사각형만 채우면 된다.
 */
function hatch(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  hue: string,
  fill: number,
): void {
  const gap = Math.max(6, Math.min(w, h) * 0.11);
  ctx.save();
  ctx.strokeStyle = `rgba(${hue},${0.16 + fill * 0.3})`;
  ctx.lineWidth = Math.max(1, gap * 0.18);
  ctx.beginPath();
  // 좌상 → 우하 사선. 시작을 -h만큼 당겨야 위쪽 모서리까지 덮인다.
  for (let i = -h; i < w + h; i += gap) {
    ctx.moveTo(x + i, y);
    ctx.lineTo(x + i + h, y + h);
  }
  ctx.stroke();
  ctx.restore();
}

/** 동심원 — "여기로 모여라". 안으로 빨려드는 방향이 무늬에 들어 있다. */
function concentric(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  hue: string,
  fill: number,
): void {
  ctx.save();
  ctx.strokeStyle = `rgba(${hue},${0.22 + fill * 0.34})`;
  ctx.lineWidth = Math.max(1, r * 0.045);
  for (let k = 1; k <= 3; k++) {
    ctx.beginPath();
    ctx.arc(cx, cy, (r * k) / 4, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawTelegraphs(ctx: CanvasRenderingContext2D, L: Layout, s: RunState): void {
  // 예고는 반경이 커서 그냥 그리면 HUD와 하단 UI까지 침범한다. 전장 안으로 자른다.
  const x0 = Math.min(L.allyBoard.x, L.enemyBoard.x);
  const y0 = Math.min(L.allyBoard.y, L.enemyBoard.y);
  const x1 = Math.max(L.allyBoard.x + L.allyBoard.w, L.enemyBoard.x + L.enemyBoard.w);
  const y1 = Math.max(L.allyBoard.y + L.allyBoard.h, L.enemyBoard.y + L.enemyBoard.h);
  const m = L.cell * 0.25;

  for (const c of s.enemy) {
    const tg = c?.telegraph;
    if (!c || !tg) continue;

    // 0 → 1로 차오른다. 다 차면 터진다.
    const fill = 1 - Math.max(0, tg.fuse) / tg.fuseMax;
    const gather = tg.mode === "gather";
    // 나가라는 분홍, 들어와라는 청록. 둘 다 판 위에서 채도를 독점하는 대역이라
    // 진영색·직업색과 밝기에서부터 갈린다.
    const hue = gather ? "43,227,180" : "255,63,110";
    const origin = fieldToScreen(L, tg.fx, tg.fy);
    const pitch = L.cell + L.gap;

    ctx.save();
    ctx.beginPath();
    ctx.rect(x0 - m, y0 - m, x1 - x0 + m * 2, y1 - y0 + m * 2);
    ctx.clip();
    ctx.lineJoin = "round";

    if (tg.shape === "circle") {
      const r = tg.arg * pitch;
      ctx.beginPath();
      ctx.arc(origin.x, origin.y, r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${hue},${0.1 + fill * 0.28})`;
      ctx.fill();
      ctx.strokeStyle = `rgba(${hue},${0.5 + fill * 0.5})`;
      ctx.lineWidth = 2 + fill * 2;
      ctx.stroke();
      // 안쪽에서 차오르는 원. 남은 시간이 한눈에 보인다.
      ctx.beginPath();
      ctx.arc(origin.x, origin.y, r * fill, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${hue},0.22)`;
      ctx.fill();
      if (gather) {
        concentric(ctx, origin.x, origin.y, r, hue, fill);
      } else {
        ctx.save();
        ctx.beginPath();
        ctx.arc(origin.x, origin.y, r, 0, Math.PI * 2);
        ctx.clip();
        hatch(ctx, origin.x - r, origin.y - r, r * 2, r * 2, hue, fill);
        ctx.restore();
      }
    } else {
      // 직선·부채꼴은 방향이 있으므로 화면에서도 같은 방향으로 돌린다.
      const tip = fieldToScreen(L, tg.fx + tg.dirX * tg.reach, tg.fy + tg.dirY * tg.reach);
      const ang = Math.atan2(tip.y - origin.y, tip.x - origin.x);
      const len = Math.hypot(tip.x - origin.x, tip.y - origin.y);

      ctx.translate(origin.x, origin.y);
      ctx.rotate(ang);
      ctx.beginPath();
      if (tg.shape === "line") {
        const half = tg.arg * pitch;
        ctx.rect(0, -half, len, half * 2);
      } else {
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, len, -tg.arg, tg.arg);
        ctx.closePath();
      }
      ctx.fillStyle = `rgba(${hue},${0.1 + fill * 0.26})`;
      ctx.fill();
      ctx.strokeStyle = `rgba(${hue},${0.5 + fill * 0.5})`;
      ctx.lineWidth = 2 + fill * 2;
      ctx.stroke();
      // 방향이 있는 예고는 전부 회피다. 해칭도 같은 규칙을 따른다.
      ctx.save();
      ctx.clip();
      hatch(ctx, -len, -len, len * 2, len * 2, hue, fill);
      ctx.restore();
    }
    ctx.restore();
  }
}

/**
 * 판은 씬 위에 얹히는 반투명 슬랩이다.
 *
 * 불투명하게 채우면 씬이 판 뒤에서만 보여서 액자 속 그림이 된다. 비쳐 보이게
 * 두면 판이 그 무대 **위에** 놓인 것으로 읽히고, 동시에 어둡게 눌러 두므로
 * 판 위의 고양이와 예고는 그대로 또렷하다.
 */
function drawArena(ctx: CanvasRenderingContext2D, L: Layout): void {
  const r = arenaBox(L);
  roundRect(ctx, r, L.cell * 0.22);
  ctx.fillStyle = "rgba(20,13,10,0.62)";
  ctx.fill();
  ctx.strokeStyle = T.floorEdge;
  ctx.lineWidth = 1;
  ctx.stroke();
}

/* ------------------------------------------------------------------ */
/* 상단 HUD                                                             */
/* ------------------------------------------------------------------ */

/**
 * 캡션 위, 숫자 아래. 자원은 글자가 아니라 숫자로 읽힌다.
 *
 * `icon`을 주면 숫자 왼쪽에 그림이 붙는다. 생선은 이 게임에서 유일한 자원이고
 * 카드 비용·리롤 비용·보상까지 전부 같은 단위인데, 화면에서는 그때그때 다른
 * 파란 숫자로만 나타나 같은 물건인 줄 알기 어려웠다. 그림이 그 셋을 묶는다.
 */
function hudChip(
  ctx: CanvasRenderingContext2D,
  box: Rect,
  caption: string,
  value: string,
  color: string,
  align: "left" | "center" | "right",
  icon = false,
): void {
  /**
   * HUD 글자를 키웠다.
   *
   * 크기를 `min(화면폭, 화면높이)`에서 뽑는 값들이라 큰 화면일수록 **판 안에서**
   * 상대적으로 작아졌다. 1669x925에서 캡션이 9px, 생선 그림이 18px이라
   * 자원이 자원으로 안 읽혔다. 자원은 매 걸음 보는 숫자라 한눈에 들어와야 한다.
   */
  const cap = Math.max(11, box.h * 0.30);
  const px = Math.max(3, Math.round(box.h * 0.075));
  const valueY = box.y + box.h * 0.70;
  const iconSize = box.h * 0.62;
  // 그림이 붙으면 숫자와 그림을 합친 덩어리가 정렬 기준을 따라야 한다.
  // 숫자만 정렬하면 가운데 정렬에서 덩어리가 그림 폭만큼 왼쪽으로 밀린다.
  // 그림과 숫자 사이 간격. 0.78이면 붙어 보여서 한 덩어리로 안 읽혔다.
  const gap = icon ? iconSize * 1.15 : 0;
  const anchor =
    align === "left"
      ? box.x
      : align === "right"
        ? box.x + box.w
        : box.x + box.w / 2;
  const x = align === "left" ? anchor + gap : align === "right" ? anchor : anchor + gap / 2;

  uiText(ctx, caption, anchor, box.y + box.h * 0.26, cap, T.muted, {
    align,
    weight: 700,
  });
  numText(ctx, value, x, valueY, px, color, align, false);

  if (icon) {
    const numW = numTextWidth(ctx, value, px);
    // 숫자 덩어리의 왼쪽 끝을 구해 거기서 한 칸 더 왼쪽에 놓는다.
    const numLeft = align === "left" ? x : align === "right" ? x - numW : x - numW / 2;
    drawFish(ctx, numLeft - gap * 0.62, valueY, iconSize, color);
  }
}

function drawHud(ctx: CanvasRenderingContext2D, L: Layout, s: RunState): void {
  const r = L.hud;
  const third = r.w / 3;
  hudChip(
    ctx,
    { x: r.x, y: r.y, w: third, h: r.h },
    "웨이브",
    String(s.wave),
    T.text,
    "left",
  );
  hudChip(
    ctx,
    { x: r.x + third, y: r.y, w: third, h: r.h },
    // 캡션을 비운다. 생선 그림이 곧 이름이라 글자까지 붙이면 같은 말을 두 번 한다.
    "",
    String(s.gold),
    T.fish,
    "center",
    true,
  );
  hudChip(
    ctx,
    { x: r.x + third * 2, y: r.y, w: third, h: r.h },
    "최고 기록",
    s.best > 0 ? String(s.best) : "-",
    T.paperDim,
    "right",
  );
}

/**
 * 음소거 토글.
 *
 * HUD 칩들과 같은 언어로 그린다 — 따로 튀는 위젯을 만들면 게임 화면에
 * 브라우저 UI가 하나 얹힌 것처럼 보인다. 꺼져 있을 때 더 흐리게 두는 이유는
 * **꺼진 상태가 기본으로 보이면 안 되기** 때문이다. 소리가 있다는 걸 모르는
 * 사람이 대부분이므로, 켜져 있을 때 눈에 띄어야 한다.
 */
function drawMute(ctx: CanvasRenderingContext2D, L: Layout, muted: boolean): void {
  const r = L.mute;
  roundRect(ctx, r, r.w * 0.28);
  ctx.fillStyle = "rgba(239,224,198,0.05)";
  ctx.fill();
  ctx.strokeStyle = "rgba(239,224,198,0.10)";
  ctx.lineWidth = 1;
  ctx.stroke();
  drawSpeaker(ctx, r.x + r.w / 2, r.y + r.h / 2, r.w * 0.62, T.text, !muted);
}

/* ------------------------------------------------------------------ */
/* 보드와 고양이                                                        */
/* ------------------------------------------------------------------ */

function drawBoard(
  ctx: CanvasRenderingContext2D,
  L: Layout,
  side: Side,
  accent: string,
  highlightCell: number,
): void {
  for (let i = 0; i < BOARD_SIZE; i++) {
    const cr = cellRect(L, side, i);
    roundRect(ctx, cr, L.cell * 0.16);
    ctx.fillStyle =
      i === highlightCell
        ? "rgba(244,227,193,0.13)"
        : "rgba(239,224,198,0.045)";
    ctx.fill();
    ctx.strokeStyle = i === highlightCell ? accent : "rgba(239,224,198,0.10)";
    ctx.lineWidth = i === highlightCell ? 2.5 : 1;
    ctx.stroke();
  }
}

/**
 * 고양이 하나. 전투 중에는 셀이 아니라 전장 좌표에 그린다.
 *
 * 돌진 연출은 화면 좌표가 아니라 전장 좌표에서 fx를 살짝 밀어 계산한다.
 * 그래야 가로/세로 어느 방향이든 "적 쪽으로 들이받는" 방향이 저절로 맞는다.
 */
/**
 * 취약 창 표시.
 *
 * 이 창은 "지금 때려라"의 유일한 순간인데 알려 주는 것이 버튼 글자뿐이었다.
 * 판을 보다가 버튼을 봐야 알 수 있으니 실제로 놓친다 — 브라우저에서 돌려 보고
 * 알았다. 레이드에서 버스트 창은 언제나 보스 쪽에 뜬다.
 *
 * 고리 하나로 끝낸다. 남은 시간은 고리가 닳는 것으로 보이고, 콤보는 고리의
 * 두께와 맥동 속도로 돌아온다 — 숫자를 하나 더 띄우는 대신 **같은 물건이 두
 * 가지를 말하게** 했다. 콤보 숫자는 버튼에 이미 있다.
 *
 * 붉은 예고(나가라)·푸른 예고(들어와라)와 섞이면 안 되므로 색은 금빛이다.
 */
const VULN_HUE = "255,226,74";

/** 콤보가 쌓일수록 빨리 뛴다. 연타의 보람이 화면에 남는다. */
function vulnerablePulse(cat: Cat, t: number): number {
  const speed = 380 - Math.min(cat.strikeCombo, 12) * 18;
  return 0.5 + 0.5 * Math.sin(t / speed);
}

/**
 * 몸 뒤에 깔리는 맥동.
 *
 * 반경을 스프라이트 안(0.5)으로 묶는 이유는 보스가 판 가장자리 자리에 앉으면
 * 그보다 큰 것은 전부 판을 넘기 때문이다. 예고와 달리 여기는 잘라 주는 경로가
 * 없다. 가장자리 알파가 0이므로 넘더라도 보이지 않는다.
 */
function drawVulnerableGlow(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  cat: Cat,
): void {
  const pulse = vulnerablePulse(cat, performance.now());
  const inner = size * 0.18;
  const outer = size * (0.44 + pulse * 0.06);
  if (!(outer > inner)) return;

  const g = ctx.createRadialGradient(cx, cy, inner, cx, cy, outer);
  g.addColorStop(0, `rgba(${VULN_HUE},${0.26 + pulse * 0.18})`);
  g.addColorStop(1, `rgba(${VULN_HUE},0)`);
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, outer, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();
}

/** 닳아 가는 고리. 12시에서 시계 방향으로 줄어든다. */
function drawVulnerableRing(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  cat: Cat,
): void {
  const max = Math.max(1, bossKit(cat.breed.id).vulnerableMs);
  const left = Math.max(0, Math.min(1, cat.vulnerableMs / max));
  const pulse = vulnerablePulse(cat, performance.now());
  // 보스 반경 1.5칸 안으로 묶는다. 스프라이트가 3.15칸에 그려지므로 0.47이 그 선이다.
  const r = size * 0.47;
  const w = Math.max(3, size * 0.05);

  ctx.save();
  ctx.lineCap = "round";
  // 닳은 자리를 어둡게 남긴다. 얼마나 지났는지도 같이 읽힌다.
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(12,8,6,0.5)";
  ctx.lineWidth = w;
  ctx.stroke();

  const from = -Math.PI / 2;
  ctx.beginPath();
  ctx.arc(cx, cy, r, from, from + Math.PI * 2 * left);
  ctx.strokeStyle = `rgba(${VULN_HUE},${0.75 + pulse * 0.25})`;
  ctx.lineWidth = w * (1 + Math.min(cat.strikeCombo, 12) * 0.04);
  ctx.stroke();
  ctx.restore();
}

/** 고양이 몸 크기. 반경 있는 것(보스·저격수)은 셀 격자를 벗어나 크게 그린다. */
export function catBodySize(L: Layout, radius: number): number {
  return radius > 0 ? L.cell * radius * 2.1 : L.cell * CAT_SCALE;
}

/**
 * 체력 바의 두께와 윗변. **`drawCat`과 프로브가 같은 식을 쓰게** 따로 뺐다.
 *
 * 바를 머리 위로 올렸을 때 "CAT_SCALE이 0.66이라 셀 안에 들어온다"고 적었는데,
 * 그건 `radius === 0`인 일반 고양이에만 해당한다. 반경 있는 유닛은 몸이
 * `cell * radius * 2.1`이라 훨씬 위로 뜬다 — 저격수(반경 0.85)는 중심에서
 * 1.27칸 위였고, 하필 자리가 적 보드 맨 윗줄이라 세로 배치 일곱 기기 전부에서
 * 보드를 넘어 **안내 문구 띠 위에** 그려졌다. 고양이는 HUD보다 나중에
 * 그려지므로 글자를 덮는다. 그때 근거로 든 `npm run probe`는 카드와 줄바꿈만
 * 볼 뿐 이 기하를 아예 안 봤다 — 주장을 뒷받침하지 않는 근거였다.
 *
 * 그래서 둘을 고친다. 띄우는 거리를 **셀 기준으로 고정**하고, 마지막에 보드
 * 위끝으로 한 번 더 자른다. 그리고 이 함수를 `layout-probe`가 직접 불러
 * 기기별로 넘치는지 잰다 — 이제 주장과 근거가 같은 코드를 가리킨다.
 */
export function healthBarGeom(
  L: Layout,
  side: Side,
  radius: number,
  cy: number,
): { bh: number; by: number } {
  const size = catBodySize(L, radius);
  const bh = Math.max(4, size * 0.15);
  const lift = Math.min(size, L.cell * CAT_SCALE);
  const board = side === "ally" ? L.allyBoard : L.enemyBoard;
  const by = Math.max(board.y + 1, cy - size * 0.5 - bh - Math.max(2, lift * 0.06));
  return { bh, by };
}

function drawCat(
  ctx: CanvasRenderingContext2D,
  L: Layout,
  cat: Cat,
  dimmed: boolean,
): void {
  const dir = cat.side === "ally" ? 1 : -1;
  const { x: cx, y: cy } = fieldToScreen(
    L,
    cat.fx + dir * 0.22 * cat.lunge,
    cat.fy,
  );

  // 보스는 반경만큼 크게 그린다. 셀 격자에 얽매이지 않고 3x3을 덮는다.
  const size = catBodySize(L, cat.radius);
  const x = cx - size / 2;
  const y = cy - size / 2 - L.cell * 0.03;

  /**
   * 발밑 표식. 그림자이면서 **진영 표시**다.
   *
   * 전에는 검은 타원 하나였다. 그런데 양쪽이 같은 스프라이트를 쓰고 전투가
   * 시작되면 가운데로 뒤섞이므로, 위치도 스프라이트도 진영을 말해 주지 못했다 —
   * 남는 단서가 판 구석의 작은 "우리 편/상대" 글자뿐이었다.
   *
   * 발밑은 언제나 보이고 유닛끼리 겹쳐도 가려지지 않는 자리다. 여기에 진영색을
   * 넣으면 난전 한가운데서도 내 고양이가 어느 것인지 한눈에 갈린다.
   */
  if (cat.alive) {
    const ally = cat.side === "ally";
    const ring = ally ? T.ally : T.enemy;
    ctx.save();
    ctx.globalAlpha = dimmed ? 0.12 : 0.34;
    ctx.beginPath();
    ctx.ellipse(cx, cy + size * 0.44, size * 0.32, size * 0.11, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#000";
    ctx.fill();
    ctx.globalAlpha = dimmed ? 0.2 : 0.85;
    ctx.beginPath();
    ctx.ellipse(cx, cy + size * 0.44, size * 0.3, size * 0.1, 0, 0, Math.PI * 2);
    ctx.strokeStyle = ring;
    ctx.lineWidth = Math.max(1.5, size * 0.045);
    ctx.stroke();
    // 적은 고리를 점선으로 끊는다. 색을 못 봐도 무늬로 갈린다.
    if (!ally) {
      ctx.globalAlpha = dimmed ? 0.2 : 0.9;
      ctx.beginPath();
      ctx.ellipse(cx, cy + size * 0.44, size * 0.3, size * 0.1, 0, -0.5, 0.5);
      ctx.strokeStyle = T.inkDeep;
      ctx.lineWidth = Math.max(1.5, size * 0.05);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 맥동은 몸 뒤, 고리는 몸 위. 순서를 지켜야 보스가 빛 속에 서 있는 것으로 읽힌다.
  if (cat.alive && cat.vulnerableMs > 0) drawVulnerableGlow(ctx, cx, cy, size, cat);

  ctx.save();
  if (!cat.alive) ctx.globalAlpha = 0.32;
  else if (dimmed) ctx.globalAlpha = 0.35;

  const img = spriteFor(cat.breed.id, cat.pose);
  if (img) {
    if (cat.flash > 0) ctx.filter = "brightness(2.4) saturate(0.6)";
    if (cat.side === "enemy") {
      // 적은 좌우를 뒤집어 **우리 쪽을 보게** 한다. 양쪽이 같은 방향을 보고
      // 있으면 같은 편이 줄 서 있는 것처럼 읽힌다 — 대치라는 것 자체가 전달되지
      // 않는다.
      //
      // save/restore로 감싼다. setTransform으로 되돌리면 main.ts가 걸어 둔
      // 고해상도 배율까지 지워져서 화면 전체가 깨진다.
      ctx.save();
      ctx.translate(cx * 2, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(img, x, y, size, size);
      ctx.restore();
    } else {
      ctx.drawImage(img, x, y, size, size);
    }
    ctx.filter = "none";
  } else {
    ctx.fillStyle = cat.side === "ally" ? T.ally : T.enemy;
    roundRect(ctx, { x, y, w: size, h: size }, size * 0.2);
    ctx.fill();
  }
  ctx.restore();

  if (!cat.alive) return;

  if (cat.vulnerableMs > 0) drawVulnerableRing(ctx, cx, cy, size, cat);

  /**
   * 체력 바 — 셀이 아니라 고양이 크기에 맞추고, **머리 위**에 둔다.
   *
   * 전에는 발밑(cy + size*0.5)에 있었다. 그런데 `drawList`가 y 오름차순으로
   * 그리므로 **앞에 선 고양이가 정확히 그 자리를 덮는다** — 난전이 될수록
   * 뒷줄의 체력이 안 보이고, 하필 발밑 진영 고리와도 겹쳐 둘이 서로를 가렸다.
   * 머리 위는 반대다. 나보다 앞에 선 것은 화면에서 아래에 있으므로 절대
   * 올라오지 않는다. 판에서 유일하게 안 가려지는 자리다.
   *
   * 두께도 올렸다(0.1 → 0.15). 진영을 색으로 말하는 물건이 손톱만 하면
   * 색을 읽기 전에 형체부터 안 보인다.
   */
  const bw = size * 0.88;
  const { bh, by } = healthBarGeom(L, cat.side, cat.radius, cy);
  const bx = cx - bw / 2;
  const frac = Math.max(0, Math.min(1, cat.hp / cat.maxHp));

  roundRect(ctx, { x: bx - 1, y: by - 1, w: bw + 2, h: bh + 2 }, (bh + 2) / 2);
  ctx.fillStyle = "rgba(12,8,6,0.8)";
  ctx.fill();
  roundRect(ctx, { x: bx, y: by, w: Math.max(bh, bw * frac), h: bh }, bh / 2);
  ctx.fillStyle = cat.side === "ally" ? T.ally : T.enemy;
  ctx.fill();

  // 마나 바. 체력 바 바로 아래에 얇게. 가득 차면 스킬이 나간다.
  // 스킬이 없는 고양이(패시브·보스)는 마나가 의미 없으므로 아예 그리지 않는다.
  const my = by + bh + 1.5;
  const mh = Math.max(2, bh * 0.62);
  const mfrac = cat.breed.skill
    ? Math.max(0, Math.min(1, cat.mana / cat.manaMax))
    : -1;
  if (mfrac >= 0) {
    roundRect(
      ctx,
      { x: bx - 1, y: my - 1, w: bw + 2, h: mh + 2 },
      (mh + 2) / 2,
    );
    ctx.fillStyle = "rgba(12,8,6,0.8)";
    ctx.fill();
    if (mfrac > 0) {
      roundRect(
        ctx,
        { x: bx, y: my, w: Math.max(mh, bw * mfrac), h: mh },
        mh / 2,
      );
      ctx.fillStyle = mfrac >= 1 ? T.gold : T.mana;
      ctx.fill();
    }
  }

  // 직업 뱃지
  if (size >= 26) {
    const cls = cat.breed.cls;
    const hue = CLASS_COLOR[cls];
    // 뱃지는 몸이 커져도 같이 커지면 안 된다. 보스에서 지름 3배가 되어 화면을 먹었다.
    // 자리는 몸을 따라가되(size) 크기는 일반 고양이 기준(cell)으로 고정한다.
    const rad = Math.min(size, L.cell * CAT_SCALE) * 0.2;
    const bxc = cx + size * 0.44;
    const byc = cy - size * 0.44;
    ctx.beginPath();
    ctx.arc(bxc, byc, rad, 0, Math.PI * 2);
    ctx.fillStyle = T.inkDeep;
    ctx.fill();
    ctx.strokeStyle = hue;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    drawClassIcon(ctx, cls, bxc, byc, rad * 1.35, hue);
  }

  // 상태이상 — 기절·빙결은 머리에 고리, 지속 피해는 아래에 점
  if (cat.stun > 0) {
    ctx.save();
    ctx.strokeStyle = T.ranged;
    ctx.lineWidth = Math.max(1.5, size * 0.05);
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    // 전에는 머리 **위**(-0.56)였는데 체력 바가 그 자리로 올라왔다. 머리에
    // 얹으면 겹치지 않고, 오히려 기절한 머리 위를 도는 고리로 읽힌다.
    ctx.arc(cx, cy - size * 0.28, size * 0.16, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  if (cat.dot) {
    ctx.save();
    ctx.fillStyle = T.melee;
    ctx.beginPath();
    ctx.arc(
      cx - bw / 2 - size * 0.09,
      by + bh / 2,
      Math.max(2, size * 0.055),
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.restore();
  }

  // 스킬 시전 이름표
  if (cat.castFlash > 0) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, cat.castFlash / 400);
    uiText(
      ctx,
      skillName(cat),
      cx,
      cy - size * 0.78,
      Math.max(10, size * 0.2),
      CLASS_COLOR[cat.breed.cls],
      {
        align: "center",
        weight: 800,
        outline: true,
      },
    );
    ctx.restore();
  }

  // 레벨은 스프라이트 무늬에 묻히지 않게 뱃지 위에 얹는다.
  if (cat.level > 1 && size >= 30) {
    const rad = size * 0.2;
    const lx = cx - size * 0.44;
    const ly = cy - size * 0.44;
    ctx.beginPath();
    ctx.arc(lx, ly, rad, 0, Math.PI * 2);
    ctx.fillStyle = T.inkDeep;
    ctx.fill();
    ctx.strokeStyle = T.gold;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    numText(
      ctx,
      String(cat.level),
      lx,
      ly,
      Math.max(1, rad * 0.24),
      T.gold,
      "center",
      false,
    );
  }
}

/**
 * 스킬 연출. 종류마다 그리는 방식이 다르다 — 무엇이 터졌는지 색과 모양으로 읽힌다.
 * 판정과 완전히 분리돼 있어서 이 함수를 지워도 전투 결과는 같다.
 */
/* ------------------------------------------------------------------ */
/* 연출 — 두 겹                                                         */
/* ------------------------------------------------------------------ */

/**
 * 연출을 두 겹으로 나눈다.
 *
 * - **벡터 겹**은 범위·방향·시간을 말한다. 플레이어가 판단에 쓰는 정보라서
 *   스킬당 하나둘이면 충분하고, 셋을 넘으면 무엇이 범위인지 모르게 된다.
 * - **파티클 겹**은 무게·재질·잔향을 말한다. 판단에는 안 쓰이지만 타격이
 *   타격으로 느껴지게 하는 것이 이쪽이다.
 *
 * 벡터가 문제였던 게 아니라 **어디에 그렸느냐**가 문제였다. 최종 해상도에
 * `arc`를 그리면 안티에일리어싱된 회색 테두리가 생겨서 고양이만 픽셀이고
 * 이펙트는 다른 그림이 된다. 같은 `arc`를 파티클과 같은 저해상도 버퍼에 그리고
 * 통째로 확대하면 계단진 원이 된다 — 코드는 거의 그대로고 그리는 대상만 바뀐다.
 *
 * 부수 효과로 더 싸다. 화면의 1/3 해상도라 픽셀 수가 9분의 1이다.
 *
 * 히트스톱과 화면 흔들림은 넣지 않았다. 히트스톱은 시뮬 타이밍을 건드려
 * 헤드리스 파리티가 깨지고, 흔들림은 판 전체를 움직이므로 예고를 읽는 데
 * 방해가 되는지 측정하기 전에는 넣을 수 없다.
 */
const FX_PIXEL = 3;

let fxBuf: HTMLCanvasElement | null = null;
let fxCtx: CanvasRenderingContext2D | null = null;

interface Particle {
  /** 화면 좌표(px). 버퍼 좌표로 두면 창 크기가 바뀔 때 전부 어긋난다. */
  x: number;
  y: number;
  vx: number;
  vy: number;
  g: number;
  life: number;
  max: number;
  size: number;
  ramp: readonly string[];
  /**
   * 램프 단계 어긋남(0~1).
   *
   * 이게 없으면 한 번에 뿌린 파티클이 **전부 같은 속도로 늙어** 한 순간에는
   * 한 색만 보인다. 램프가 3단이어도 화면에는 단색으로 나온다.
   * 조각마다 단계를 조금씩 밀어 세 색이 늘 같이 보이게 한다.
   */
  jit: number;
}

const particles: Particle[] = [];
/** 이미 파티클을 뿌린 연출. Fx는 렌더러가 소유하지 않으므로 신원으로 기억한다. */
const seeded = new WeakSet<object>();
let fxLast = 0;

/**
 * 색 램프.
 *
 * 알파 페이드 대신 색이 식는다 — 흰빛에서 제 색으로, 다시 어둡게. 연속 투명도는
 * 픽셀 아트에 없는 것이라 그것만으로도 다른 그림처럼 보인다. 벡터 겹의 색에서
 * 자동으로 뽑으므로 두 겹이 어긋날 수 없다.
 */
const rampCache = new Map<string, readonly string[]>();

function hexToRgb(h: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}
function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;
}
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const R = r / 255, G = g / 255, B = b / 255;
  const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
  const l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const sat = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h: number;
  if (mx === R) h = ((G - B) / d + (G < B ? 6 : 0)) / 6;
  else if (mx === G) h = ((B - R) / d + 2) / 6;
  else h = ((R - G) / d + 4) / 6;
  return [h * 360, sat, l];
}
function hslToHex(h: number, s: number, l: number): string {
  const H = ((h % 360) + 360) % 360 / 360;
  if (s === 0) { const v = l * 255; return rgbToHex(v, v, v); }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t0: number): number => {
    let t = t0;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return rgbToHex(f(H + 1 / 3) * 255, f(H) * 255, f(H - 1 / 3) * 255);
}

/** 색상환에서 target 쪽으로 짧은 길을 따라 amount도 만큼 돌린다. */
function towardHue(h: number, target: number, amount: number): number {
  let d = ((target - h + 540) % 360) - 180;
  d = Math.max(-amount, Math.min(amount, d));
  return h + d;
}

/**
 * 색 램프 — **색상 이동(hue shift)**으로 3단을 만든다.
 *
 * 예전에는 `흰색 → 제 색 → 검정`이었다. 3단이긴 했는데 밝은 쪽이 순백이라
 * 채도가 통째로 날아가고 어두운 쪽은 그냥 탁해졌다. 밝기만 움직이면 같은 색의
 * 명암 계단이 되지 입체가 안 생긴다.
 *
 * 픽셀 아트가 쓰는 방식은 **밝은 쪽을 빛의 색으로, 어두운 쪽을 그늘의 색으로**
 * 트는 것이다. 여기서 빛은 골목의 가로등(따뜻한 노랑 45°), 그늘은 밤하늘
 * (차가운 파랑 245°)이다. 배경이 실제로 그 두 색이라 파티클이 장면에 앉는다.
 *
 * 채도는 양끝에서 오히려 **올린다.** 밝게 하면서 채도를 두면 물감이 물에
 * 풀린 것처럼 보이는데, 픽셀 아트의 하이라이트는 색이 옅어지는 게 아니라
 * 더 진해지면서 밝아진다.
 */
function rampFor(color: string): readonly string[] {
  let r = rampCache.get(color);
  if (!r) {
    const [cr, cg, cb] = hexToRgb(color);
    const [h, sat, l] = rgbToHsl(cr, cg, cb);
    // 같은 색의 3단이다. 노랑이면 연한 노랑 · 노랑 · 진한 노랑.
    // 색상은 아주 조금만(6~8도) 튼다 — 완전히 같은 색상으로 밝기만 바꾸면
    // 회색을 섞은 것처럼 보이고, 크게 틀면 다른 색이 된다.
    const hi = hslToHex(towardHue(h, 45, 7), Math.min(1, sat * 1.05 + 0.04), Math.min(0.9, l + 0.2));
    const lo = hslToHex(towardHue(h, 245, 9), Math.min(1, sat * 1.1 + 0.06), Math.max(0.12, l - 0.22));
    r = [hi, color, lo];
    rampCache.set(color, r);
  }
  return r;
}

/** 램프의 밝은 칸·어두운 칸. 벡터 겹이 테두리를 세울 때 쓴다. */
export function rampHi(color: string): string {
  return rampFor(color)[0]!;
}
export function rampLo(color: string): string {
  return rampFor(color)[2]!;
}

/** 각 연출이 뿌리는 파티클. 개수와 방향이 곧 그 스킬의 무게다. */
function seed(f: Fx, x: number, y: number, cell: number): void {
  const ramp = rampFor(f.color);
  const u = cell * 0.02; // 셀 크기에 비례한 속도 단위. 화면이 커도 같게 보인다.
  const push = (n: number, make: (i: number) => Omit<Particle, "ramp" | "jit">): void => {
    for (let i = 0; i < n; i++) particles.push({ ...make(i), ramp, jit: Math.random() * 0.9 });
  };
  const rnd = (a: number, b: number): number => a + Math.random() * (b - a);

  switch (f.kind) {
    case "ring":
      // 넓게 퍼지는 한 방. 바깥으로 고르게 밀린다.
      push(22, (i) => {
        const a = (Math.PI * 2 * i) / 22 + rnd(-0.2, 0.2);
        const sp = rnd(0.7, 1.9) * u;
        return { x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.6, g: u * 0.05, life: 430, max: 430, size: i % 3 ? 1 : 2 };
      });
      break;
    case "frost":
      // 육각 방향으로만 뻗는다. 원이 아니라 결정이라는 것이 방향에서 읽힌다.
      push(24, (i) => {
        const a = (Math.PI * 2 * (i % 6)) / 6 + (i < 12 ? 0 : Math.PI / 6);
        const sp = (0.5 + (i / 24) * 1.3) * u;
        return { x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.7, g: u * 0.03, life: 520, max: 520, size: i % 3 ? 1 : 2 };
      });
      break;
    case "streak":
    case "beam":
      // 방향이 있는 것은 그 방향으로 흐른다.
      push(16, () => {
        const a = Math.atan2(f.ty - f.fy, f.tx - f.fx) + rnd(-0.25, 0.25);
        const sp = rnd(1.0, 2.4) * u;
        return { x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 0, life: 330, max: 330, size: 1 };
      });
      break;
    case "slash":
      push(14, (i) => {
        const a = f.angle + (i / 14) * 1.4;
        const sp = rnd(0.8, 1.6) * u;
        return { x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.55, g: u * 0.06, life: 380, max: 380, size: i % 2 ? 1 : 2 };
      });
      break;
    case "ember":
      // 위로만. 중력이 음수라 떠오른다.
      push(3, () => ({ x: x + rnd(-cell * 0.2, cell * 0.2), y, vx: rnd(-0.1, 0.1) * u, vy: rnd(-0.7, -0.3) * u, g: -u * 0.01, life: 620, max: 620, size: 1 }));
      break;
    case "spark":
      push(8, (i) => {
        const a = (Math.PI * 2 * i) / 8 + rnd(-0.3, 0.3);
        const sp = rnd(0.5, 1.3) * u;
        return { x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - u * 0.3, g: u * 0.09, life: 280, max: 280, size: 1 };
      });
      break;
  }
  // 한 프레임에 스킬이 여럿 터져도 상한을 넘지 않게 한다.
  if (particles.length > 520) particles.splice(0, particles.length - 520);
}

function stepParticles(dt: number): void {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i]!;
    p.life -= dt;
    if (p.life <= 0) {
      particles.splice(i, 1);
      continue;
    }
    p.vy += p.g * dt * 0.06;
    p.x += p.vx * dt * 0.06;
    p.y += p.vy * dt * 0.06;
  }
}

function drawFx(ctx: CanvasRenderingContext2D, L: Layout): void {
  const now = performance.now();
  const dt = Math.min(48, fxLast ? now - fxLast : 16);
  fxLast = now;

  const bw = Math.max(8, Math.round(L.w / FX_PIXEL));
  const bh = Math.max(8, Math.round(L.h / FX_PIXEL));
  if (!fxBuf || fxBuf.width !== bw || fxBuf.height !== bh) {
    fxBuf = document.createElement("canvas");
    fxBuf.width = bw;
    fxBuf.height = bh;
    fxCtx = fxBuf.getContext("2d");
  }
  const b = fxCtx;
  if (!b) return;
  b.setTransform(1, 0, 0, 1, 0, 0);
  b.clearRect(0, 0, bw, bh);
  b.imageSmoothingEnabled = false;

  // 새로 뜬 연출에만 파티클을 뿌린다. Fx는 매 프레임 같은 객체로 남아 있다.
  for (const f of fxs) {
    if (seeded.has(f)) continue;
    seeded.add(f);
    const p = fieldToScreen(L, f.fx, f.fy);
    seed(f, p.x, p.y, L.cell);
  }
  stepParticles(dt);

  drawFxVectors(b, L);

  // 파티클 — 하나가 fillRect 한 번이다. 알파 대신 색 램프로 식는다.
  for (const p of particles) {
    const k = 1 - p.life / p.max;
    const col = p.ramp[Math.min(p.ramp.length - 1, Math.floor(k * p.ramp.length + p.jit))]!;
    b.fillStyle = col;
    b.fillRect(Math.round(p.x / FX_PIXEL), Math.round(p.y / FX_PIXEL), p.size, p.size);
  }

  const prev = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(fxBuf, 0, 0, L.w, L.h);
  ctx.imageSmoothingEnabled = prev;
}

/** 벡터 겹. 좌표와 굵기를 전부 버퍼 배율로 줄여서 저해상도에 그린다. */
/** 투명도를 네 단계로 계단진다. 연속 페이드는 픽셀 아트에 없는 것이다. */
function qa(a: number): number {
  return Math.max(0, Math.ceil(Math.min(1, a) * 4) / 4);
}

function drawFxVectors(ctx: CanvasRenderingContext2D, L: Layout): void {
  const S = 1 / FX_PIXEL;
  const pitch = (L.cell + L.gap) * S;

  for (const f of fxs) {
    const t = 1 - f.life / f.maxLife; // 0 → 1
    const raw = fieldToScreen(L, f.fx, f.fy);
    const p = { x: raw.x * S, y: raw.y * S };
    ctx.save();
    ctx.lineJoin = "miter";
    ctx.lineCap = "butt";

    switch (f.kind) {
      case "ring": {
        ctx.globalAlpha = qa(0.85 * (1 - t) ** 1.4);
        ctx.strokeStyle = f.color;
        ctx.lineWidth = Math.max(1, L.cell * 0.09 * (1 - t * 0.6) * S);
        ctx.beginPath();
        ctx.arc(p.x, p.y, f.radius * pitch * (0.25 + t * 0.85), 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
      case "slash": {
        // 짧은 호가 바깥으로 퍼지며 사라진다
        ctx.globalAlpha = qa(0.95 * (1 - t));
        ctx.strokeStyle = f.color;
        ctx.lineWidth = Math.max(1, L.cell * 0.075 * S);
        const rr = f.radius * pitch * (0.35 + t * 0.55);
        const a0 = f.angle + t * 1.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, rr, a0, a0 + 0.85);
        ctx.stroke();
        break;
      }
      case "beam": {
        const raw2 = fieldToScreen(L, f.tx, f.ty);
        const q = { x: raw2.x * S, y: raw2.y * S };
        ctx.globalAlpha = qa(0.9 * (1 - t) ** 0.7);
        ctx.strokeStyle = f.color;
        ctx.lineWidth = Math.max(1, f.radius * pitch * (1 - t * 0.5));
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(q.x, q.y);
        ctx.stroke();
        break;
      }
      case "streak": {
        // 시작점에서 목표까지 순식간에 지나간 자국
        const raw2 = fieldToScreen(L, f.tx, f.ty);
        const q = { x: raw2.x * S, y: raw2.y * S };
        const head = {
          x: p.x + (q.x - p.x) * Math.min(1, t * 1.8),
          y: p.y + (q.y - p.y) * Math.min(1, t * 1.8),
        };
        ctx.globalAlpha = qa(0.9 * (1 - t));
        ctx.strokeStyle = f.color;
        ctx.lineWidth = Math.max(1, L.cell * 0.1 * S);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(head.x, head.y);
        ctx.stroke();
        break;
      }
      case "spark": {
        // 네 갈래로 튀는 짧은 선
        ctx.globalAlpha = qa(1 - t);
        ctx.strokeStyle = f.color;
        ctx.lineWidth = Math.max(1, L.cell * 0.045 * S);
        const len = f.radius * pitch * (0.25 + t * 0.5);
        for (let i = 0; i < 4; i++) {
          const a = f.angle + (Math.PI / 2) * i;
          ctx.beginPath();
          ctx.moveTo(
            p.x + Math.cos(a) * len * 0.4,
            p.y + Math.sin(a) * len * 0.4,
          );
          ctx.lineTo(p.x + Math.cos(a) * len, p.y + Math.sin(a) * len);
          ctx.stroke();
        }
        break;
      }
      case "ember": {
        // 위로 떠오르며 작아진다
        ctx.globalAlpha = qa(0.9 * (1 - t) ** 1.5);
        ctx.fillStyle = f.color;
        const rise = t * pitch * 0.9;
        ctx.beginPath();
        ctx.arc(
          p.x,
          p.y - rise,
          Math.max(1, f.radius * pitch * (1 - t)),
          0,
          Math.PI * 2,
        );
        ctx.fill();
        break;
      }
      case "frost": {
        // 여섯 갈래 결정. 얼어붙은 대상 위에 오래 남는다
        ctx.globalAlpha = qa(0.8 * (1 - t) ** 0.6);
        ctx.strokeStyle = f.color;
        ctx.lineWidth = Math.max(1, L.cell * 0.04 * S);
        const rr = f.radius * pitch * (0.6 + t * 0.25);
        for (let i = 0; i < 6; i++) {
          const a = f.angle + (Math.PI / 3) * i;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x + Math.cos(a) * rr, p.y + Math.sin(a) * rr);
          ctx.stroke();
        }
        break;
      }
    }
    ctx.restore();
  }
}

/** 원거리 투사체. 피해는 이미 적용됐고 이건 순수 연출이다. */
function drawShots(ctx: CanvasRenderingContext2D, L: Layout): void {
  for (const s of shots) {
    const t = 1 - s.life / SHOT_LIFE_MS;
    const fx = s.fromX + (s.toX - s.fromX) * t;
    const fy = s.fromY + (s.toY - s.fromY) * t;
    const { x, y } = fieldToScreen(L, fx, fy);
    const rad = Math.max(2.5, L.cell * 0.05);
    const color = s.ally ? T.gold : T.enemy;

    const back = fieldToScreen(
      L,
      fx - (s.toX - s.fromX) * 0.14,
      fy - (s.toY - s.fromY) * 0.14,
    );
    ctx.save();
    ctx.globalAlpha = 0.4;
    ctx.strokeStyle = color;
    ctx.lineWidth = rad * 1.2;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(back.x, back.y);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  }
}

function drawPops(ctx: CanvasRenderingContext2D, L: Layout): void {
  for (const p of damagePops) {
    const { x, y } = fieldToScreen(L, p.fx, p.fy);
    const t = 1 - p.life / POP_LIFE_MS;
    ctx.save();
    ctx.globalAlpha = Math.max(0, 1 - t * t);
    // 같은 프레임에 뜬 숫자는 계단으로 민다. 흩뿌리기로는 셋이 겹치면 여전히
    // `72 61`처럼 붙어 읽혔다. 아래·오른쪽으로 미는 것은 위쪽이 보스와 HUD라서다.
    const ox = x + p.step * L.cell * 0.38;
    const oy = y - L.cell * 0.34 - t * L.cell * 0.55 + p.step * L.cell * 0.4;
    if (p.text === "회피") {
      uiText(ctx, "빗나감", ox, oy, Math.max(9, L.cell * 0.16), T.paperDim, {
        align: "center",
        weight: 700,
        outline: true,
      });
    } else {
      // 스킬·치명타만 크고 레몬이다. 판 위에서 레몬이 뜨는 경우는 취약 창과
      // 큰 한 방 둘뿐이라 "지금 뭔가 세게 들어갔다"로 뜻이 통한다.
      numText(
        ctx,
        p.text,
        ox,
        oy,
        Math.max(1, L.cell * (p.crit ? 0.035 : 0.028)),
        p.crit ? T.vuln : "#FFFFFF",
        "center",
        true,
        true,
      );
    }
    ctx.restore();
  }
}

/* ------------------------------------------------------------------ */
/* 진영 표시                                                            */
/* ------------------------------------------------------------------ */

/**
 * 진영 라벨을 아레나 바깥 모서리에 붙인다.
 *
 * 예전에는 각 보드 바로 위에 뒀는데, 근접 유닛이 정확히 그 자리로 걸어 나가
 * "상대" 글자를 덮어버렸다. 유닛이 잘 가지 않는 아레나 가장자리로 옮긴다.
 * 방향을 알려주는 보조 표시이므로 크기도 줄여 조용하게 둔다.
 */
function drawSideLabels(ctx: CanvasRenderingContext2D, L: Layout): void {
  const a = arenaBox(L);
  const fs = Math.min(Math.max(9, L.cell * 0.16), L.labelH * 0.8);
  const inset = L.cell * 0.22;
  const put = (
    x: number,
    y: number,
    text: string,
    color: string,
    align: CanvasTextAlign,
  ) => {
    uiText(ctx, text, x, y, fs, color, {
      align,
      weight: 800,
      outline: true,
    });
  };

  if (L.stacked) {
    put(a.x + inset, a.y + fs * 1.1, "상대", T.enemy, "left");
    put(a.x + inset, a.y + a.h - fs * 1.1, "우리 편", T.ally, "left");
  } else {
    put(a.x + inset, a.y + fs * 1.2, "우리 편", T.ally, "left");
    put(a.x + a.w - inset, a.y + fs * 1.2, "상대", T.enemy, "right");
  }
}

function drawDivider(ctx: CanvasRenderingContext2D, L: Layout): void {
  ctx.save();
  ctx.strokeStyle = "rgba(239,224,198,0.09)";
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 7]);
  ctx.beginPath();
  if (L.stacked) {
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

  // 두 보드 사이가 곧 전선이다.
  const cx = L.stacked
    ? L.allyBoard.x + L.allyBoard.w / 2
    : (L.allyBoard.x + L.allyBoard.w + L.enemyBoard.x) / 2;
  const cy = L.stacked
    ? (L.enemyBoard.y + L.enemyBoard.h + L.allyBoard.y) / 2
    : L.allyBoard.y + L.allyBoard.h / 2;
  const rad = Math.max(10, L.cell * 0.15);
  ctx.beginPath();
  ctx.arc(cx, cy, rad, 0, Math.PI * 2);
  ctx.fillStyle = T.inkDeep;
  ctx.fill();
  ctx.strokeStyle = "rgba(239,224,198,0.16)";
  ctx.lineWidth = 1;
  ctx.stroke();
  numText(
    ctx,
    "VS",
    cx,
    cy,
    Math.max(1, rad * 0.2),
    T.muted,
    "center",
    false,
  );
}

/* ------------------------------------------------------------------ */
/* 하단: 팀 상태 / 보상 카드                                            */
/* ------------------------------------------------------------------ */

/** 다시 뽑기 버튼. 카드 머리줄 오른쪽 끝에 둔다. */
export function rerollRect(L: Layout): Rect {
  const r = L.offerCards;
  if (L.columns) {
    /**
     * 세로줄에서는 카드가 줄을 꽉 채우므로 머리줄도 줄 폭을 그대로 쓴다.
     *
     * 높이를 고정값으로 두면 안 된다 — 844×320 같은 납작한 가로에서 머리줄 띠가
     * 44px뿐인데 버튼이 34px+여백을 먹어 안내 문구 위로 2px 올라탔다.
     * **띠에서 비율로 뽑아야** 화면이 줄어도 안 넘친다.
     */
    const top = L.notice.y + L.notice.h;
    const band = Math.max(1, r.y - top);
    const h = Math.max(22, Math.min(34, band * 0.62));
    return { x: r.x, y: r.y - h - band * 0.16, w: r.w, h };
  }
  const h = Math.max(24, Math.min(34, r.h * 0.13));
  const w = Math.max(88, r.w * 0.28);
  return { x: r.x + r.w - w, y: r.y - h - h * 0.34, w, h };
}

/**
 * 슬롯은 늘 세 칸. 하나를 사도 남은 카드가 넓어지지 않는다.
 *
 * 세로줄에서는 위에서 아래로 쌓고, 접힌 구성에서는 가로로 늘어놓는다.
 * **보이는 곳과 눌리는 곳이 이 함수 하나에서 나온다** — 렌더도 히트테스트도
 * 여기만 부른다. 둘을 따로 계산하면 반드시 갈라진다.
 */
export function offerRects(L: Layout, count: number = OFFER_SLOTS): Rect[] {
  const r = L.offerCards;
  const n = Math.max(1, count);
  const gap = L.offerGap;
  if (L.columns) {
    const ch = (r.h - gap * (n - 1)) / n;
    return Array.from({ length: count }, (_, i) => ({
      x: r.x,
      y: r.y + i * (ch + gap),
      w: r.w,
      h: ch,
    }));
  }
  const cw = (r.w - gap * (n - 1)) / n;
  return Array.from({ length: count }, (_, i) => ({
    x: r.x + i * (cw + gap),
    y: r.y,
    w: cw,
    h: r.h,
  }));
}

/**
 * 보상 단계가 아닐 때 카드 자리를 비워 두면 화면 아래가 휑하다.
 * 대신 팀 구성을 보여준다 — 근접/원거리 균형은 배치를 정할 때 실제로 필요한 정보다.
 */
function drawTeamStrip(
  ctx: CanvasRenderingContext2D,
  L: Layout,
  s: RunState,
): void {
  const r = L.offers;
  const cats = livingCats(s.ally);
  const counts: Record<ClassKind, number> = {
    warrior: 0,
    rogue: 0,
    archer: 0,
    mage: 0,
  };
  for (const c of cats) counts[c.breed.cls] += 1;

  const order: ClassKind[] = ["warrior", "rogue", "archer", "mage"];
  const rows: [string, number, string, IconName | null][] = [
    ...order.map(
      (cls) =>
        [CLASS_LABEL[cls], counts[cls], CLASS_COLOR[cls], CLASS_PICTO[cls]] as
          [string, number, string, IconName | null],
    ),
    // 상대는 직업이 아니라 진영이라 아이콘을 안 붙인다. 붙이면 다섯 줄이
    // 같은 종류의 것으로 읽혀 "우리 넷 + 상대"라는 구분이 사라진다.
    ["상대", livingCats(s.enemy).length, T.enemy, null],
  ];

  if (L.columns) {
    /**
     * 세로줄에서는 **한 줄에 하나씩** — 이름 왼쪽, 수 오른쪽.
     *
     * 가로 띠였을 때는 다섯 칸을 나눠 이름 위·수 아래로 쌓았는데, 그 배치가
     * 화면에서 가장 크고 밝은 물건이 되어 판 위의 예고보다 눈에 먼저 들어왔다
     * (design-brief 4-2가 잡은 위계 역전). 옆으로 나오면서 크기를 줄일 수 있다.
     */
    const rowH = r.h / rows.length;
    const fs = Math.max(10, Math.min(15, rowH * 0.42));
    const px = Math.max(1, rowH * 0.062);
    const iconSize = Math.min(rowH * 0.62, r.w * 0.13);
    rows.forEach(([label, n, hue, icon], i) => {
      const cy = r.y + rowH * (i + 0.5);
      // 아이콘이 있으면 글자를 그만큼 민다. 없는 줄(상대)도 같은 자리에서
      // 시작해야 다섯 줄의 글머리가 어긋나지 않는다.
      const textX = r.x + iconSize * 1.35;
      if (icon) drawIcon(ctx, icon, r.x + iconSize * 0.5, cy, iconSize, n > 0 ? hue : T.muted);
      uiText(ctx, label, textX, cy, fs, T.muted, { align: "left", weight: 700 });
      numText(ctx, String(n), r.x + r.w, cy, px, n > 0 ? hue : T.muted, "right", false);
      if (i < rows.length - 1) {
        const y = Math.round(r.y + rowH * (i + 1)) + 0.5;
        ctx.strokeStyle = "rgba(239,224,198,0.07)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(r.x, y);
        ctx.lineTo(r.x + r.w, y);
        ctx.stroke();
      }
    });
    return;
  }

  const cap = Math.max(9, r.h * 0.17);
  const px = Math.max(2, Math.round(r.h * 0.048));
  const cols = rows.length;
  const cw = r.w / cols;

  rows.forEach(([label, n, hue], i) => {
    const cx = r.x + cw * i + cw / 2;
    uiText(ctx, label, cx, r.y + r.h * 0.3, cap, T.muted, {
      align: "center",
      weight: 700,
    });
    numText(ctx, String(n), cx, r.y + r.h * 0.66, px, hue, "center", false);
  });

  ctx.strokeStyle = "rgba(239,224,198,0.08)";
  ctx.lineWidth = 1;
  for (let i = 1; i < cols; i++) {
    const x = Math.round(r.x + cw * i) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, r.y + r.h * 0.22);
    ctx.lineTo(x, r.y + r.h * 0.82);
    ctx.stroke();
  }
}

/** #RRGGBB → rgba(). 팔레트가 hex라 투명도를 얹으려면 한 번 풀어야 한다. */
function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/**
 * 카드 위 고양이는 살아 있어야 한다 — 위아래로 조금 흔들리고 가끔 눈을 깜빡인다.
 * 위상을 품종마다 어긋나게 준다. 셋이 동시에 깜빡이면 살아 있는 게 아니라 기계로 보인다.
 */
function cardIdle(seed: number, t: number): { pose: Pose; bob: number } {
  const cycle = 2600 + (seed % 5) * 260;
  const p = (t + seed * 430) % cycle;
  return {
    pose: p < 170 ? "wink" : "idle",
    bob: Math.sin((t + seed * 700) / 540),
  };
}

/** 초상 자리. 직업색으로 은은하게 물들이고 그 안에 고양이를 세운다. */
function drawPortraitWell(
  ctx: CanvasRenderingContext2D,
  well: Rect,
  breedId: number,
  seed: number,
  accent: string,
  afford: boolean,
  t: number,
): void {
  // 크기가 0 이하로 들어오면 createRadialGradient가 던지고, 그 예외가 rAF 루프를
  // 끊어 화면이 영구히 굳는다. 안 그리는 편이 낫다.
  if (well.w <= 0 || well.h <= 0) return;

  const rad = Math.min(well.w, well.h) * 0.16;
  roundRect(ctx, well, rad);
  ctx.fillStyle = "rgba(12,8,6,0.5)";
  ctx.fill();

  ctx.save();
  roundRect(ctx, well, rad);
  ctx.clip();
  const cx = well.x + well.w / 2;
  const cy = well.y + well.h * 0.5;
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, well.w * 0.62);
  glow.addColorStop(0, hexA(accent, afford ? 0.3 : 0.1));
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(well.x, well.y, well.w, well.h);

  const { pose, bob } = cardIdle(seed, t);
  const img = spriteFor(breedId, pose);
  // 0.86인 이유: 흔들림 폭(±sz*0.05)까지 우물 안에 들어와야 발이 잘리지 않는다.
  const sz = Math.min(well.w, well.h) * 0.86;
  if (img) {
    ctx.globalAlpha = afford ? 1 : 0.45;
    ctx.drawImage(img, cx - sz / 2, cy - sz / 2 + bob * sz * 0.05, sz, sz);
  }
  ctx.restore();

  roundRect(ctx, well, rad);
  ctx.strokeStyle = afford ? hexA(accent, 0.42) : "rgba(239,224,198,0.10)";
  ctx.lineWidth = 1;
  ctx.stroke();
}

/**
 * 값은 카드 모서리의 뱃지로. 어느 카드가 얼마인지 훑어보기 좋다.
 *
 * **원이 아니라 알약이다.** 생선 그림을 넣으면서 바꿨다 — 원 안에 그림과 숫자를
 * 위아래로 쌓아 봤더니 둘 다 절반 크기가 되어 겹쳐 읽혔다(지름이 22px 남짓이라
 * 애초에 두 물건이 들어갈 자리가 아니었다). 가로로 눕히면 둘 다 제 크기로 선다.
 *
 * 오른쪽 끝은 옛 원의 오른쪽 끝에 그대로 둔다. 호출부 셋이 카드 오른쪽 모서리에서
 * 자리를 잡고 있어서, 기준이 움직이면 그 셋을 다시 맞춰야 한다.
 */
/**
 * 뱃지가 실제로 먹는 폭.
 *
 * 알약이 되면서 폭이 자릿수에 따라 달라진다. 눕힌 카드는 글 오른쪽에 뱃지를
 * 두므로 **글이 자리를 미리 떼야** 하는데, `br * 2.1`처럼 어림하면 두 자리
 * 비용에서 뱃지가 능력 줄을 덮는다(실제로 그랬다).
 */
function costBadgeWidth(ctx: CanvasRenderingContext2D, r: number, cost: number): number {
  const px = Math.max(1, (r * 1.0) / 7);
  return r * 0.88 + r * 1.24 * 0.86 + r * 0.12 + numTextWidth(ctx, String(cost), px);
}

function drawCostBadge(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  cost: number,
  afford: boolean,
): void {
  const hue = afford ? T.fish : T.muted;
  const fish = r * 1.24;
  // 숫자 높이를 뱃지 높이에 맞춘다. 두 자리(유물이 9~12생선)도 같은 크기로 선다 —
  // 옛 원은 자릿수만큼 글자를 줄여야 했지만 알약은 폭이 따라 늘어난다.
  const px = Math.max(1, (r * 1.0) / 7);
  const numW = numTextWidth(ctx, String(cost), px);
  const gap = r * 0.12;
  const padX = r * 0.44;
  const h = r * 2;
  const w = padX * 2 + fish * 0.86 + gap + numW;
  const right = cx + r;
  const box = { x: right - w, y: cy - h / 2, w, h };

  roundRect(ctx, box, h / 2);
  ctx.fillStyle = "rgba(18,12,10,0.94)";
  ctx.fill();
  ctx.strokeStyle = afford ? T.fish : "rgba(239,224,198,0.16)";
  ctx.lineWidth = 2;
  ctx.stroke();

  drawFish(ctx, box.x + padX + fish * 0.43, cy, fish, hue);
  numText(ctx, String(cost), right - padX, cy, px, hue, "right", false);
}

/**
 * 유물 카드.
 *
 * 고양이 카드와 달리 초상이 없다. 대신 **원하는 것과 치르는 것**을 나란히
 * 보여준다 — 유물의 값은 그 둘의 관계에서 나오므로, 사기 전에 둘 다 보이지
 * 않으면 도박이 아니라 그냥 뽑기가 된다.
 */
function drawRelicCard(
  ctx: CanvasRenderingContext2D,
  cr: Rect,
  relic: { name: string; want: string; toll: string },
  cost: number,
  afford: boolean,
  pad: number,
): void {
  const rad = Math.min(cr.w, cr.h) * 0.13;
  bevelPanel(
    ctx,
    cr,
    rad,
    afford ? "rgba(111,182,220,0.12)" : "rgba(239,224,198,0.035)",
    afford ? "rgba(0,0,0,0.35)" : "rgba(0,0,0,0.25)",
    3,
  );
  roundRect(ctx, cr, rad);
  ctx.strokeStyle = afford ? T.fish : "rgba(239,224,198,0.12)";
  ctx.lineWidth = afford ? 2 : 1;
  ctx.stroke();

  const vertical = cr.h >= cr.w * 0.9;
  const cx = cr.x + cr.w / 2;
  const tw = cr.w - pad * 2;
  const fsName = Math.max(12, Math.min(21, cr.w * 0.11));
  const fsBody = Math.max(10, fsName * 0.68);

  const br = Math.max(11, (vertical ? cr.w : cr.h) * (vertical ? 0.105 : 0.17));
  // 세운 카드는 모서리에, 눕힌 카드는 오른쪽 가운데에. 눕힌 카드에서 모서리에
  // 두면 이름 줄과 같은 높이가 되어 알약이 글자를 덮는다.
  drawCostBadge(
    ctx,
    cr.x + cr.w - pad - br,
    vertical ? cr.y + pad + br * 0.9 : cr.y + cr.h / 2,
    br,
    cost,
    afford,
  );

  if (!vertical) {
    const relicTw = tw - costBadgeWidth(ctx, br, cost) - pad * 0.6;
    uiText(ctx, relic.name, cr.x + pad, cr.y + cr.h * 0.32, fsName, afford ? T.text : T.muted, {
      align: "left",
      weight: 800,
      maxWidth: relicTw,
    });
    uiText(ctx, `${relic.want} · ${relic.toll}`, cr.x + pad, cr.y + cr.h * 0.66, fsBody, afford ? T.fish : T.muted, {
      align: "left",
      weight: 600,
      maxWidth: relicTw,
    });
    return;
  }

  let ty = cr.y + cr.h * 0.3;
  uiText(ctx, "유물", cx, ty - fsName * 0.95, fsBody * 0.95, afford ? T.fish : T.muted, {
    align: "center",
    weight: 700,
  });
  uiText(ctx, relic.name, cx, ty, fsName, afford ? T.text : T.muted, {
    align: "center",
    weight: 800,
    maxWidth: tw,
  });

  // 원하는 것 / 치르는 것을 라벨과 함께. 어느 쪽이 이익인지 헷갈리면 안 된다.
  ty += fsName * 0.75 + fsBody;
  for (const [label, text, color] of [
    ["원하는 것", relic.want, afford ? T.fish : T.muted],
    ["치르는 것", relic.toll, afford ? T.enemy : T.muted],
  ] as const) {
    uiText(ctx, label, cx, ty, fsBody * 0.85, "rgba(156,139,118,0.9)", { align: "center", weight: 600 });
    ty += fsBody * 1.15;
    for (const line of wrapLines(ctx, text, fsBody, 700, tw, 2)) {
      uiText(ctx, line, cx, ty, fsBody, color, { align: "center", weight: 700 });
      ty += fsBody * 1.2;
    }
    ty += fsBody * 0.35;
  }
}

function drawOffers(
  ctx: CanvasRenderingContext2D,
  L: Layout,
  s: RunState,
): void {
  const rects = offerRects(L);
  const t = performance.now();

  s.offers.forEach((o: Offer | null, i) => {
    const cr = rects[i];
    if (!cr) return;
    const rad = Math.min(cr.w, cr.h) * 0.13;

    // 산 자리는 비워 둔다. 카드가 사라지면서 남은 것이 넓어지면 손이 헛나간다.
    if (!o) {
      roundRect(ctx, cr, rad);
      ctx.fillStyle = "rgba(239,224,198,0.02)";
      ctx.fill();
      ctx.setLineDash([4, 5]);
      ctx.strokeStyle = "rgba(239,224,198,0.10)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);
      uiText(
        ctx,
        "샀음",
        cr.x + cr.w / 2,
        cr.y + cr.h / 2,
        Math.max(11, cr.w * 0.1),
        "rgba(156,139,118,0.55)",
        {
          align: "center",
          weight: 600,
        },
      );
      return;
    }

    const afford = s.gold >= o.cost;
    // 영입·교체는 그 고양이의 직업색으로. 카드만 봐도 무엇이 오는지 알 수 있다.
    // 유물은 어느 직업에도 속하지 않으므로 생선색으로 따로 세운다.
    const accent = o.kind === "relic" ? T.fish : o.kind === "upgrade" ? T.gold : CLASS_COLOR[o.breed!.cls];

    bevelPanel(
      ctx,
      cr,
      rad,
      afford ? "rgba(239,224,198,0.10)" : "rgba(239,224,198,0.035)",
      afford ? "rgba(0,0,0,0.35)" : "rgba(0,0,0,0.25)",
      3,
    );
    roundRect(ctx, cr, rad);
    ctx.strokeStyle = afford ? accent : "rgba(239,224,198,0.12)";
    ctx.lineWidth = afford ? 2 : 1;
    ctx.stroke();

    // 짧은 변에서 뽑는다. 폭에서만 뽑으면 넓고 낮은 카드에서 여백이 높이를
    // 잡아먹어 우물 크기가 음수가 되고, 그래디언트가 던져 rAF 루프가 죽는다.
    const relicPad = Math.max(5, Math.min(cr.w, cr.h) * 0.07);
    if (o.kind === "relic" && o.relic) {
      drawRelicCard(ctx, cr, o.relic, o.cost, afford, relicPad);
      return;
    }

    // 무엇을 하는 고양이인지 사기 전에 보여준다.
    const skill = o.breed!.skill ? SKILLS[o.breed!.skill] : null;
    const passive = o.breed!.passive ? PASSIVES[o.breed!.passive] : null;
    const abilityName = skill?.name ?? passive?.name ?? "";
    const abilityDesc = skill?.desc ?? passive?.desc ?? "";
    const abilityLine = `${o.sublabel} · ${skill ? "" : "패시브 "}${abilityName}`;
    // 짧은 변에서 뽑는다. 폭에서만 뽑으면 넓고 낮은 카드에서 여백이 높이를
    // 잡아먹어 우물 크기가 음수가 되고, 그래디언트가 던져 rAF 루프가 죽는다.
    const pad = Math.max(5, Math.min(cr.w, cr.h) * 0.07);

    // 세로 카드가 기본. 초상이 위, 글이 아래.
    if (cr.h >= cr.w * 0.9) {
      const well: Rect = {
        x: cr.x + pad,
        y: cr.y + pad,
        w: cr.w - pad * 2,
        h: cr.h * 0.34,
      };
      drawPortraitWell(
        ctx,
        well,
        o.breed!.id,
        o.breed!.id * 7 + i,
        accent,
        afford,
        t,
      );
      const br = Math.max(12, cr.w * 0.105);
      drawCostBadge(ctx, cr.x + cr.w - pad - br, cr.y + pad + br * 0.9, br, o.cost, afford);

      const fsName = Math.max(12, Math.min(22, cr.w * 0.115));
      const fsAbil = fsName * 0.78;
      const fsDesc = Math.max(10, fsName * 0.66);
      const cx = cr.x + cr.w / 2;
      const tw = cr.w - pad * 2;

      let ty = well.y + well.h + Math.max(9, cr.h * 0.05) + fsName * 0.5;
      uiText(ctx, o.label, cx, ty, fsName, afford ? T.text : T.muted, {
        align: "center",
        weight: 800,
        maxWidth: tw,
      });
      ty += fsName * 0.52 + fsAbil * 0.72;
      uiText(ctx, abilityLine, cx, ty, fsAbil, afford ? accent : T.muted, {
        align: "center",
        weight: 700,
        maxWidth: tw,
      });
      ty += fsAbil * 0.6 + fsDesc * 0.9;

      // 설명은 남은 자리만큼만. 카드 밖으로 새면 옆 카드와 겹쳐 읽힌다.
      const room = cr.y + cr.h - pad - ty;
      const lineH = fsDesc * 1.3;
      const maxLines = Math.max(
        1,
        Math.min(3, Math.floor((room + fsDesc * 0.65) / lineH)),
      );
      for (const line of wrapLines(
        ctx,
        abilityDesc,
        fsDesc,
        500,
        tw,
        maxLines,
      )) {
        uiText(ctx, line, cx, ty, fsDesc, afford ? T.paperDim : T.muted, {
          align: "center",
          weight: 500,
        });
        ty += lineH;
      }
      return;
    }

    /**
    /**
     * 카드를 세울 높이가 안 나오는 화면에서는 눕힌다. **두 구역**으로 나눈다.
     *
     *   윗줄  [초상] 이름 / 능력          [비용]
     *   아랫줄 설명 — 카드 폭을 통째로 쓴다
     *
     * 예전에는 셋을 전부 초상 오른쪽 한 칸에 밀어 넣었다. 340px 카드에서 초상
     * 75 + 뱃지 85 + 여백 48이 60%를 먹어 글에 133px밖에 안 남았고, 거기에
     * 41px 글자를 넣으니 축소 한계를 넘어 뱃지 위로 흘렀다.
     *
     * 설명은 원래 문장이라 가장 긴데 가장 좁은 자리를 받고 있었다. 초상 아래
     * 빈 폭이 그대로 남아 있었으므로 거기로 내린다 — **긴 글에 긴 자리를** 준다.
     */
    const br = Math.max(12, cr.h * 0.155);
    const roomy = cr.h >= 84;
    const headH = roomy ? cr.h * 0.58 : cr.h;
    const side = Math.min(headH - pad * 1.4, cr.w * 0.19);
    const well: Rect = { x: cr.x + pad, y: cr.y + pad, w: side, h: side };
    drawPortraitWell(ctx, well, o.breed!.id, o.breed!.id * 7 + i, accent, afford, t);

    const fs = Math.max(13, Math.min(cr.h * 0.2, cr.w * 0.088));
    const textX = well.x + well.w + pad;
    const textW = cr.x + cr.w - pad - costBadgeWidth(ctx, br, o.cost) - pad * 0.7 - textX;

    uiText(ctx, o.label, textX, cr.y + headH * (roomy ? 0.38 : 0.4), fs, afford ? T.text : T.muted, {
      align: "left",
      weight: 800,
      maxWidth: textW,
    });
    /**
     * 능력 줄 앞에 **직업 픽토그램**을 세운다.
     *
     * 카드가 "궁수 영입 · 꿰뚫기"라고 글로만 말하고 있었다. 직업은 이 게임에서
     * 살지 말지를 가르는 첫 정보인데(유물 조건이 전부 직업 수다) 글자 두 자에
     * 실려 있었다. 왼쪽 줄 직업 카운터가 이미 같은 그림을 쓰므로, 카드와 카운터가
     * **같은 기호로 같은 것을 가리키게** 된다 — 새 어휘를 안 늘리고 연결만 짓는다.
     */
    const abilY = cr.y + headH * 0.72;
    const icoS = fs * 0.72;
    const hasCls = drawIcon(ctx, `cls-${o.breed!.cls}` as IconName, textX + icoS * 0.5, abilY, icoS, afford ? accent : T.muted);
    const abilX = textX + (hasCls ? icoS * 1.25 : 0);
    uiText(ctx, abilityLine, abilX, abilY, fs * 0.62, afford ? accent : T.muted, {
      align: "left",
      weight: 700,
      maxWidth: textW - (abilX - textX),
    });

    // 설명은 카드 폭을 다 쓴다. 두 줄까지 접는다.
    if (roomy) {
      const dfs = Math.max(11, fs * 0.58);
      const dw = cr.w - pad * 2;
      let dy = cr.y + headH + dfs * 0.9;
      for (const line of wrapLines(ctx, abilityDesc, dfs, 500, dw, 2)) {
        uiText(ctx, line, cr.x + pad, dy, dfs, afford ? T.paperDim : T.muted, {
          align: "left",
          weight: 500,
        });
        dy += dfs * 1.35;
      }
    }

    drawCostBadge(ctx, cr.x + cr.w - pad - br, cr.y + cr.h / 2, br, o.cost, afford);
  });
}

/**
 * 카드 머리줄 문구.
 *
 * 보유/한도를 먼저 보여주는 이유: 만석이면 영입 카드가 아예 안 나오는데, 그 이유가
 * 화면 어디에도 없으면 "왜 새 고양이가 안 뜨지"로 읽힌다.
 */
function offerHeadline(s: RunState): string {
  const owned = livingCats(s.ally).length;
  const cap = unitCap(s.wave);
  const team = `우리 편 ${owned}/${cap}`;

  if (s.offers.every((o) => o === null)) {
    return `${team} · 다 샀어요 — 자리를 다듬고 ${s.wave === 1 ? "가볼까요" : "다음 걸음으로"}`;
  }
  if (owned >= cap) return `${team} · 자리가 다 찼어요. 강화하거나 바꿔 넣어요`;
  if (s.wave === 1) return `${team} · 쓰고 가도, 그냥 가도 괜찮아요`;
  return `${team} · 생선을 쓸까요, 그냥 갈까요`;
}

/**
 * 보유 유물 — 세로줄 구성의 오른쪽 줄이 상점이 아닐 때 쓰는 자리.
 *
 * 두 문제를 함께 푼다.
 *
 * 1. **배치·전투에서 오른쪽 줄이 통째로 비어** 화면이 왼쪽으로 쏠렸다. 카드가
 *    없는 국면이 판 시간의 대부분인데 그동안 3분의 1이 배경이었다.
 * 2. **유물이 판 중에 안 보였다.** 측정상 이 게임에서 가장 깊은 축인데
 *    (격차 5.1웨이브 · 신탁 격차 5.9) 무엇을 갖고 있는지는 죽어서 부검 화면에
 *    가야 알 수 있었다. 조건이 전부 팀 구성이라 왼쪽 줄의 직업 수와 나란히
 *    놓여야 "지금 켜져 있나"를 읽을 수 있다.
 *
 * 조건 충족 여부를 색과 글자로 함께 낸다 — 켜졌는지가 유물의 전부다.
 */
function drawRelicColumn(
  ctx: CanvasRenderingContext2D,
  L: Layout,
  s: RunState,
  head: Rect,
): void {
  const r = L.offerCards;
  const cats = livingCats(s.ally);

  uiText(ctx, "유물", head.x, head.y + head.h / 2, Math.max(11, Math.min(15, head.h * 0.46)), T.muted, {
    align: "left",
    weight: 800,
  });
  uiText(
    ctx,
    `${s.relics.length}/${RELIC_TOTAL}`,
    head.x + head.w,
    head.y + head.h / 2,
    Math.max(10, Math.min(14, head.h * 0.42)),
    T.muted,
    { align: "right", weight: 700 },
  );

  if (s.relics.length === 0) {
    // 빈 줄을 그냥 두면 고장으로 보인다. 어디서 얻는지를 적어 둔다.
    uiText(ctx, "아직 없어요", r.x + r.w / 2, r.y + r.h * 0.4, Math.max(11, r.w * 0.075), T.muted, {
      align: "center",
      weight: 700,
    });
    uiText(
      ctx,
      "가위눌림을 밀어내면 하나 떨어져요",
      r.x + r.w / 2,
      r.y + r.h * 0.4 + Math.max(16, r.w * 0.1),
      Math.max(10, r.w * 0.058),
      "rgba(156,139,118,0.7)",
      { align: "center", weight: 500, maxWidth: r.w * 0.92 },
    );
    return;
  }

  const gap = Math.max(6, r.w * 0.04);
  // 칸 높이는 유물 수가 아니라 상한에서 뽑는다. 하나 살 때마다 카드가 줄어들면
  // 같은 유물이 판마다 다른 크기로 보인다.
  const rowH = Math.min((r.h - gap * (RELIC_TOTAL - 1)) / RELIC_TOTAL, Math.max(46, r.w * 0.2));

  s.relics.forEach((relic, i) => {
    const on = relicActive(relic, cats);
    const cr: Rect = { x: r.x, y: r.y + i * (rowH + gap), w: r.w, h: rowH };
    if (cr.y + cr.h > r.y + r.h) return;

    roundRect(ctx, cr, cr.h * 0.22);
    ctx.fillStyle = on ? "rgba(240,186,74,0.13)" : "rgba(239,224,198,0.035)";
    ctx.fill();
    ctx.strokeStyle = on ? T.gold : "rgba(239,224,198,0.10)";
    ctx.lineWidth = on ? 2 : 1;
    ctx.stroke();

    const padX = cr.h * 0.24;
    const fs = Math.max(10, cr.h * 0.29);
    // 아이콘은 세로 가운데. 이름·조건 두 줄을 합친 덩어리 옆에 선다.
    const icon = cr.h * 0.52;
    const hasIcon = drawIcon(
      ctx,
      `relic-${relic.id}` as IconName,
      cr.x + padX + icon * 0.5,
      cr.y + cr.h * 0.5,
      icon,
      on ? T.gold : T.muted,
    );
    const textX = cr.x + padX + (hasIcon ? icon * 1.3 : 0);
    uiText(ctx, relic.name, textX, cr.y + cr.h * 0.33, fs, on ? T.text : T.muted, {
      align: "left",
      weight: 800,
      maxWidth: cr.x + cr.w - padX - fs * 2.4 - textX,
    });
    // 켜짐/꺼짐은 색만으로 두지 않는다 — 색맹 대응이고, 조건이 뭔지도 같이 읽혀야 한다.
    uiText(
      ctx,
      on ? "켜짐" : "꺼짐",
      cr.x + cr.w - padX,
      cr.y + cr.h * 0.33,
      fs * 0.82,
      on ? T.gold : "rgba(156,139,118,0.75)",
      { align: "right", weight: 800 },
    );
    uiText(
      ctx,
      on ? relic.toll : `${relic.want} · ${relic.toll}`,
      textX,
      cr.y + cr.h * 0.71,
      fs * 0.76,
      on ? "rgba(156,139,118,0.9)" : T.muted,
      { align: "left", weight: 500, maxWidth: cr.x + cr.w - padX - textX },
    );
  });
}

/** 다시 뽑기 버튼. 두 구성이 같은 그림을 쓰도록 따로 뺐다. */
function drawRerollButton(
  ctx: CanvasRenderingContext2D,
  L: Layout,
  s: RunState,
  rr: Rect,
): void {
  const canRoll = s.gold >= REROLL_COST;
  roundRect(ctx, rr, rr.h * 0.5);
  ctx.fillStyle = canRoll ? "rgba(111,182,220,0.14)" : "rgba(239,224,198,0.04)";
  ctx.fill();
  ctx.strokeStyle = canRoll ? T.fish : "rgba(239,224,198,0.12)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  const rfs = Math.max(10, rr.h * 0.46);
  // 세로줄에서는 버튼이 줄 폭을 다 쓰므로 글자를 가운데로 몬다. 접힌 구성에서는
  // 오른쪽 끝에 붙은 작은 버튼이라 글자를 오른쪽으로 민다.
  const rollPx = Math.max(1, rr.h * 0.09);
  const rollRight = rr.x + rr.w - rr.w * (L.columns ? 0.06 : 0.12);
  const numW = numTextWidth(ctx, String(REROLL_COST), rollPx);
  uiText(
    ctx,
    "다시 뽑기",
    L.columns ? rr.x + rr.w * 0.06 : rr.x + rr.w * 0.42,
    rr.y + rr.h / 2,
    rfs,
    canRoll ? T.text : T.muted,
    { align: L.columns ? "left" : "right", weight: 700 },
  );
  // 값 왼쪽에 생선. 카드 뱃지·HUD와 같은 그림이라 "이것도 생선 값"이 붙는다.
  drawFish(ctx, rollRight - numW - rr.h * 0.34, rr.y + rr.h / 2, rr.h * 0.5, canRoll ? T.fish : T.muted);
  numText(ctx, String(REROLL_COST), rollRight, rr.y + rr.h / 2, rollPx, canRoll ? T.fish : T.muted, "right", false);
}

function drawBottomZone(
  ctx: CanvasRenderingContext2D,
  L: Layout,
  s: RunState,
): void {
  const reward = s.phase === "reward";
  const rr = rerollRect(L);

  if (L.columns) {
    /**
     * 세로줄에서는 **아무것도 덮지 않는다.**
     *
     * 접힌 구성에서는 카드가 판 위로 자라므로 화면을 어둡게 깔아 "지금은 카드를
     * 보는 시간"임을 알렸다. 세로줄에서는 카드가 제 줄에 서 있고, 무엇보다 이제
     * 상점은 **적을 보면서 사는 자리**다 — 판을 어둡게 하면 그 순서를 만든 이유가
     * 사라진다.
     */
    // 오른쪽 줄은 국면에 따라 내용만 바뀌고 자리는 늘 있다 — 상점이면 카드,
    // 아니면 보유 유물. 국면마다 패널이 생겼다 사라지면 화면이 요동친다.
    const p = L.offersPanel;
    roundRect(ctx, p, Math.min(16, p.w * 0.06));
    ctx.fillStyle = "rgba(20,14,11,0.72)";
    ctx.fill();
    ctx.strokeStyle = "rgba(239,224,198,0.08)";
    ctx.lineWidth = 1;
    ctx.stroke();
    // 왼쪽 줄(직업 수 + 목표)은 전투 중에도 남는다. 무엇이 몇 마리 살아 있고
    // 목표를 얼마나 채웠는지가 전투를 보는 정보다. 두 블록을 한 패널로 묶어야
    // 한 덩어리로 읽힌다 — 따로 깔았더니 직업 수만 떠 있는 상자로 보였다.
    const lp = {
      x: L.offers.x - 10,
      y: L.offers.y - 10,
      w: L.offers.w + 20,
      h: L.synergyBar.y + L.synergyBar.h - L.offers.y + 20,
    };
    roundRect(ctx, lp, Math.min(16, lp.w * 0.06));
    ctx.fillStyle = "rgba(20,14,11,0.72)";
    ctx.fill();
    ctx.strokeStyle = "rgba(239,224,198,0.08)";
    ctx.lineWidth = 1;
    ctx.stroke();
    drawTeamStrip(ctx, L, s);
    if (reward) {
      drawRerollButton(ctx, L, s, rr);
      drawOffers(ctx, L, s);
    } else {
      // 카드가 없는 국면(배치·전투·지도)에는 같은 자리에 보유 유물을 세운다.
      drawRelicColumn(ctx, L, s, rr);
    }
    return;
  }

  // 보상 단계에는 카드가 보드 위로 자란다. 그동안 보드는 어차피 만질 수 없으므로
  // 덮는다는 걸 눈에 보이게 해야 한다. (세로줄 구성에서는 아예 안 덮는다 —
  // 구매·배치를 합치면서 그것이 계약이 됐고 npm run probe가 검사한다.)
  const panel: Rect = reward
    ? {
        x: 0,
        y: rr.y - rr.h * 0.7,
        w: L.w,
        h: L.offersPanel.y + L.offersPanel.h - (rr.y - rr.h * 0.7),
      }
    : L.offersPanel;

  if (reward) {
    ctx.fillStyle = "rgba(12,8,6,0.62)";
    ctx.fillRect(0, 0, L.w, L.h);
  }

  ctx.fillStyle = reward ? "rgba(20,14,11,0.96)" : "rgba(20,14,11,0.55)";
  ctx.fillRect(panel.x, panel.y, panel.w, panel.h);

  if (reward) {
    // 보드 한가운데를 직선으로 자르면 고양이가 반토막 나 보인다. 위로 흘려 보낸다.
    const fade = Math.min(64, panel.h * 0.24);
    const g = ctx.createLinearGradient(0, panel.y - fade, 0, panel.y);
    g.addColorStop(0, "rgba(20,14,11,0)");
    g.addColorStop(1, "rgba(20,14,11,0.96)");
    ctx.fillStyle = g;
    ctx.fillRect(0, panel.y - fade, L.w, fade);
  } else {
    ctx.strokeStyle = "rgba(239,224,198,0.09)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, panel.y + 0.5);
    ctx.lineTo(L.w, panel.y + 0.5);
    ctx.stroke();
  }

  if (reward) {
    uiText(
      ctx,
      offerHeadline(s),
      L.offerCards.x,
      rr.y + rr.h / 2,
      Math.max(10, Math.min(15, rr.h * 0.46)),
      T.muted,
      { align: "left", weight: 600 },
    );
    drawRerollButton(ctx, L, s, rr);
    drawOffers(ctx, L, s);
  } else if (s.phase !== "battle") {
    // 전투에는 이 자리를 판에게 넘긴다. 직업 수는 무엇을 살지 정할 때 쓰는
    // 정보라 상점과 배치에서만 필요하고, 전투 중에는 판이 그 자리를 쓴다.
    drawTeamStrip(ctx, L, s);
  }
}

/* ------------------------------------------------------------------ */
/* 시너지 · 버튼 · 안내                                                  */
/* ------------------------------------------------------------------ */

/**
 * 시너지 칩 — 조건, 진행도, 효과를 한 칩에 다 보여준다.
 *
 * 예전에는 조건만 띄웠다. 무엇을 얻는지도, 얼마나 왔는지도 안 보여주니
 * 화면 아래 목표 세 줄이 무슨 뜻인지 알 수 없었다.
 * 네 조건은 전부 동시에 만족할 수 있으므로 셋 다 켜는 것이 실제 목표가 된다.
 */
function drawSynergies(
  ctx: CanvasRenderingContext2D,
  L: Layout,
  s: RunState,
): void {
  const r = L.synergyBar;
  const n = Math.max(1, s.synergies.length);
  const units = boardUnits(s);
  // 세로줄에서는 위아래로 쌓고, 접힌 구성에서는 좌우로 늘어놓는다.
  // 세로줄에서는 `synergyBar`가 이미 칩 셋에 딱 맞게 잡혀 있다(computeLayout).
  // 같은 식을 써야 칩이 패널을 안 넘는다.
  const gap = L.columns ? Math.max(6, r.w * 0.04) : r.w * 0.016;
  const cw = L.columns ? r.w : (r.w - gap * (n - 1)) / n;
  const ch = L.columns ? (r.h - gap * (n - 1)) / n : r.h;

  s.synergies.forEach((syn, i) => {
    const on = s.activeSynergyIds.has(syn.id);
    const hue = TRIGGER_COLOR[syn.trigger] ?? T.gold;
    const { have, need } = synergyProgress(syn.trigger, units);
    const cr: Rect = L.columns
      ? { x: r.x, y: r.y + i * (ch + gap), w: cw, h: ch }
      : { x: r.x + i * (cw + gap), y: r.y, w: cw, h: ch };
    const fs = Math.max(10, cr.h * 0.27);

    roundRect(ctx, cr, cr.h * 0.22);
    ctx.fillStyle = on ? "rgba(240,186,74,0.13)" : "rgba(239,224,198,0.035)";
    ctx.fill();
    ctx.strokeStyle = on ? hue : "rgba(239,224,198,0.10)";
    ctx.lineWidth = on ? 2 : 1;
    ctx.stroke();

    const padX = cr.h * 0.22;
    const inner = cr.w - padX * 2;
    const px = Math.max(1, cr.h * 0.03);
    const prog = `${Math.min(have, need)}/${need}`;

    // 칩이 좁으면 좌우로 나눌 수 없다. 세로 화면에서 글자가 겹치던 문제.
    const wide = cr.w > cr.h * 6;

    if (wide) {
      uiText(
        ctx,
        triggerLabel(syn.trigger),
        cr.x + padX,
        cr.y + cr.h * 0.34,
        fs * 0.86,
        on ? hue : T.muted,
        {
          align: "left",
          weight: 700,
          maxWidth: inner * 0.52,
        },
      );
      numText(
        ctx,
        prog,
        cr.x + padX,
        cr.y + cr.h * 0.72,
        px,
        on ? hue : T.muted,
        "left",
        false,
      );
      uiText(
        ctx,
        syn.name,
        cr.x + cr.w - padX,
        cr.y + cr.h * 0.34,
        fs * 0.86,
        on ? T.text : T.muted,
        {
          align: "right",
          weight: 800,
          maxWidth: inner * 0.45,
        },
      );
      uiText(
        ctx,
        effectLabel(syn.effect),
        cr.x + cr.w - padX,
        cr.y + cr.h * 0.72,
        fs * 0.8,
        on ? T.gold : "rgba(156,139,118,0.6)",
        { align: "right", weight: 600, maxWidth: inner * 0.55 },
      );
      return;
    }

    // 좁은 칩: 두 줄로 확실히 나눈다. 이름(장식)은 뺀다 — 플레이어에게 필요한 건
    // 무엇을 해야 하는가지 시너지의 이름이 아니다.
    // 윗줄: 조건과 진행도. 아랫줄: 얻는 효과.
    uiText(
      ctx,
      triggerLabel(syn.trigger),
      cr.x + padX,
      cr.y + cr.h * 0.32,
      fs * 0.86,
      on ? hue : T.muted,
      {
        align: "left",
        weight: 800,
        maxWidth: inner * 0.68,
      },
    );
    numText(
      ctx,
      prog,
      cr.x + cr.w - padX,
      cr.y + cr.h * 0.32,
      px,
      on ? hue : T.muted,
      "right",
      false,
    );
    uiText(
      ctx,
      effectLabel(syn.effect),
      cr.x + cr.w / 2,
      cr.y + cr.h * 0.72,
      fs * 0.76,
      on ? T.gold : "rgba(156,139,118,0.6)",
      { align: "center", weight: 600, maxWidth: inner },
    );
  });
}

/**
 * 여정 지도 화면.
 *
 * 길은 **왼쪽에서 오른쪽으로** 흐른다. 이 게임은 이제 가로가 기본이고, 가로
 * 화면에서 세로로 흐르는 길은 남는 폭을 또 버린다.
 *
 * 지나온 길은 흐릿하게 남긴다. 어디서 왔는지가 보여야 지금 고르는 것이 어디로
 * 이어지는지도 읽힌다. 갈 수 없는 칸은 선 없이 어둡게 둔다 — 지우면 길이
 * 좁아 보이고, 똑같이 그리면 고를 수 있는 줄 알고 누른다.
 */
/*
 * 칸 안의 표식은 **아이콘**이다(보스만 이름).
 *
 * 예전에는 "전투/정예/정찰"을 글자로 찍었다. 셋은 길이가 같고 지름 30px 원
 * 안에서는 전부 회색 얼룩으로 보여서, 갈림길에서 무엇과 무엇 중에 고르는지가
 * 한 번에 안 읽혔다. 형태는 작아져도 실루엣이 남는다 — icons.ts 참고.
 * 이름이 필요한 곳(호버 설명·갈래 요약)은 `nodeInfo`가 그대로 낸다.
 */

export function mapNodeRects(L: Layout, s: RunState): { rect: Rect; step: number; idx: number }[] {
  const out: { rect: Rect; step: number; idx: number }[] = [];
  const box = mapBox(L);
  const rows = STAGE_STEPS;
  const rh = box.h / rows;
  const r = Math.min(rh * 0.34, box.w * 0.1);
  for (let step = 0; step < rows; step++) {
    const row = s.map.steps[step] ?? [];
    for (let i = 0; i < row.length; i++) {
      const node = row[i]!;
      /**
       * **아래에서 위로 간다.** 0걸음이 맨 아래, 마지막 걸음이 맨 위다.
       *
       * 좌→우였을 때는 여섯 걸음이 화면 폭을 다 먹어 칸이 붙었고, 무엇보다
       * "올라간다"는 감각이 없었다. 이 게임의 한 스테이지는 골목 하나를
       * 거슬러 올라가 끝에 있는 주인을 만나는 일이다. 세로로 세우면 남은
       * 거리가 곧 눈에 남은 높이가 된다.
       */
      const cy = box.y + box.h - rh * (step + 0.5);
      // lane은 격자 줄 번호다. 버려진 칸이 있어도 자리가 유지돼 길이 흔들리지 않는다.
      const cx = box.x + box.w * ((node.lane + 0.5) / 4);
      out.push({ rect: { x: cx - r, y: cy - r, w: r * 2, h: r * 2 }, step, idx: i });
    }
  }
  return out;
}

/**
 * 지도가 서는 자리.
 *
 * 세로로 세우면서 폭이 필요 없어졌다 — 갈래는 최대 넷이라 좁은 기둥으로 충분하다.
 * **판 가운데**에 세워서 다른 국면의 보드와 같은 자리를 쓴다. 화면이 바뀌어도
 * 눈이 같은 곳을 본다.
 */
function mapBox(L: Layout): Rect {
  const top = L.notice.y + L.notice.h + L.scale * 10;
  const bottom = L.button.y - L.scale * 12;
  const h = Math.max(L.scale * 160, bottom - top);
  const w = Math.min(L.w * 0.5, Math.max(L.scale * 260, 320));
  return { x: L.w / 2 - w / 2, y: top, w, h };
}

function drawMap(ctx: CanvasRenderingContext2D, L: Layout, s: RunState, drag: DragState): void {
  if (s.phase !== "map") return;
  /**
   * 지도는 화면을 통째로 가진다.
   *
   * 0.88이었을 때 아래 UI가 비쳐서 직업 카운터·목표 칩·유물 패널의 글자가
   * 지도 선과 겹쳐 읽혔다. 반투명은 "뒤에 뭔가 있다"를 알려 주려던 것인데,
   * 지도를 보는 동안 뒤엣것은 **읽을 필요가 없을 뿐 아니라 읽히면 안 된다**.
   */
  // **알파를 먼저 되돌린다.** 앞 단계가 남긴 globalAlpha가 곱해지면 막이
  // 0.975가 아니라 그 곱만큼만 덮여 아래 UI가 그대로 비친다.
  ctx.globalAlpha = 1;
  ctx.fillStyle = "rgba(10,7,5,0.98)";
  ctx.fillRect(0, 0, L.w, L.h);
  const step = mapStep(s);
  const open = new Set(openLanes(s.map, step));
  const rects = mapNodeRects(L, s);
  const at = (st: number, i: number): Rect | undefined =>
    rects.find((x) => x.step === st && x.idx === i)?.rect;

  // 선 먼저. 칸 아래에 깔려야 칸이 선을 끊는 것처럼 보인다.
  for (let st = 0; st < STAGE_STEPS - 1; st++) {
    const row = s.map.steps[st] ?? [];
    for (let i = 0; i < row.length; i++) {
      const a = at(st, i);
      if (!a) continue;
      for (const t of row[i]!.next) {
        const b = at(st + 1, t);
        if (!b) continue;
        const past = s.map.taken[st] === i;
        const live = st === step - 1 ? past : st < step;
        ctx.strokeStyle = live ? "rgba(244,227,193,0.5)" : "rgba(239,224,198,0.14)";
        ctx.lineWidth = live ? Math.max(2, L.scale * 2.4) : Math.max(1, L.scale * 1.4);
        /**
         * 아래 칸의 위쪽에서 위 칸의 아래쪽으로. 직선이 아니라 **완만한 곡선**이다.
         *
         * 직선으로 이으면 배선도처럼 보인다. 골목길은 꺾이지 곧지 않다.
         * 제어점을 중간 높이에 두고 x는 각 끝의 x를 쓰면, 갈래가 벌어질 때
         * 자연스럽게 휘고 나란한 선끼리도 서로 다른 곡률을 갖는다.
         */
        const ax = a.x + a.w / 2;
        const ay = a.y;
        const bx = b.x + b.w / 2;
        const by = b.y + b.h;
        const my = (ay + by) / 2;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.bezierCurveTo(ax, my, bx, my, bx, by);
        ctx.stroke();
      }
    }
  }

  /**
   * 마우스가 올라간 칸.
   *
   * 고를 수 있는 칸만 반응한다. 못 가는 칸이 커지면 갈 수 있는 줄 알고 누르게
   * 되고, 그건 호버가 정보를 주는 게 아니라 거짓말을 하는 것이다.
   */
  let hovered = -1;
  if (drag.hoverX >= 0) {
    for (const { rect, step: st, idx } of rects) {
      if (st !== step || !open.has(idx)) continue;
      const dx = drag.hoverX - (rect.x + rect.w / 2);
      const dy = drag.hoverY - (rect.y + rect.h / 2);
      if (Math.hypot(dx, dy) <= rect.w / 2 + 6) {
        hovered = idx;
        break;
      }
    }
  }

  for (const { rect, step: st, idx } of rects) {
    const node = s.map.steps[st]?.[idx];
    if (!node) continue;
    const taken = s.map.taken[st] === idx;
    const here = st === step;
    const pickable = here && open.has(idx);
    const done = st < step;
    const hot = here && idx === hovered;

    const hue =
      node.kind === "boss" ? T.enemy
      : node.kind === "elite" ? T.vuln
      : node.kind === "shop" ? T.fish
      : T.ally;
    // 고를 수 있는 칸만 살아 있다. 나머지는 지도의 배경이다.
    const alpha = pickable ? 1 : taken ? 0.62 : done ? 0.26 : 0.46;

    // 올라간 칸은 조금 커진다. 크기 변화가 색 변화보다 먼저 눈에 띈다.
    const grow = hot ? rect.w * 0.09 : 0;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(rect.x + rect.w / 2, rect.y + rect.h / 2, rect.w / 2 + grow, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(14,10,8,0.92)";
    ctx.fill();
    ctx.strokeStyle = hot ? "#FFFFFF" : hue;
    ctx.lineWidth = hot ? Math.max(3, L.scale * 3.4) : pickable ? Math.max(2, L.scale * 2.6) : Math.max(1, L.scale * 1.4);
    ctx.stroke();
    // 보스 칸만 **이름**을 보여준다. 어떤 보스가 오는지가 곧 무엇을 준비할지를
    // 정하는데, 지금까지 그 정보가 화면에 없었다.
    //
    // 신원은 `bossIndexAt`에서만 나온다. 예전에는 현재 걸음 기준으로 "앞으로
    // 만날 보스가 몇 번째인가"를 세어 라벨을 붙였는데, 그러면 **지나간 보스 칸이
    // 다음 보스 이름으로 바뀌어** 한 지도에 같은 이름이 둘 뜬다.
    if (node.kind === "boss") {
      const name = bossForIndex(bossIndexAt(s, st)).name;
      const weight = pickable ? 800 : 400;
      /**
       * 아이콘은 원 **안**, 이름은 원 **아래**.
       *
       * 예전에는 이름을 원 안에 넣었다. 세 글자(살금이)와 네 글자(무쇠발톱)가
       * 섞여 있어 네 글자는 원에 맞추느라 작아졌고, 그러면서 보스 칸만 아이콘이
       * 없어 다른 칸들과 다른 언어를 썼다. 이름을 밖으로 내면 둘 다 풀린다 —
       * 아이콘이 계열을 지키고, 이름은 원 크기와 무관하게 읽힌다.
       */
      drawNodeIcon(
        ctx,
        "boss",
        rect.x + rect.w / 2,
        rect.y + rect.h / 2,
        (rect.w + grow * 2) * 0.68,
        hot ? T.paper : hue,
      );
      const fs = Math.max(10, rect.w * 0.3);
      uiText(
        ctx,
        name,
        rect.x + rect.w / 2,
        rect.y + rect.h + fs * 0.95,
        fs,
        hot ? T.paper : hue,
        { align: "center", weight, outline: true },
      );
    } else {
      drawNodeIcon(
        ctx,
        node.kind,
        rect.x + rect.w / 2,
        rect.y + rect.h / 2,
        (rect.w + grow * 2) * 0.72,
        hot ? T.paper : hue,
      );
    }
    ctx.restore();

    // 고를 수 있는 칸은 맥동한다. 여섯 칸 중 어디를 눌러야 하는지가 한눈에 보인다.
    if (pickable) {
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 260);
      ctx.save();
      ctx.beginPath();
      ctx.arc(rect.x + rect.w / 2, rect.y + rect.h / 2, rect.w / 2 + L.scale * 4, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,255,255,${0.12 + pulse * 0.28})`;
      ctx.lineWidth = Math.max(1.5, L.scale * 1.8);
      ctx.stroke();
      ctx.restore();
    }
  }

  const cur = s.map.steps[step] ?? [];
  const kinds = [...new Set(cur.filter((_, i) => open.has(i)).map((n) => n.kind))];
  // 올라간 칸이 있으면 그 칸의 설명을, 없으면 갈래 요약을 준다. 터치에는
  // 호버가 없으므로 요약이 늘 남아 있어야 한다.
  const hotNode = hovered >= 0 ? cur[hovered] : undefined;
  // 보스 칸에 올리면 그 보스가 무엇을 하는지 알려준다. 정답이 아니라 성질이다.
  // 라벨과 **같은 인덱스**를 써야 한다. 이름은 살금이인데 설명은 무쇠발톱이
  // 나오던 자리다 — 여기만 앞의 보스 수를 안 세고 있었다.
  const bossLine =
    hotNode?.kind === "boss" ? bossHint(bossForIndex(bossIndexAt(s, step)).id) : null;
  // 커서까지 바뀌어야 "누를 수 있다"가 끝까지 전달된다. 캔버스 게임은 이걸
  // 안 하면 그림처럼 보인다.
  ctx.canvas.style.cursor = hovered >= 0 ? "pointer" : "default";
  const info = hotNode ? nodeInfo(hotNode.kind) : null;
  uiText(
    ctx,
    bossLine
      ? bossLine
      : info
      ? `${info.name} — ${info.hint}`
      : `${s.map.stage}번째 밤 · ${step + 1}/${STAGE_STEPS} — ${kinds.map((k) => nodeInfo(k).name).join(" 또는 ")}`,
    L.w / 2,
    mapBox(L).y - L.scale * 6,
    L.scale * 13,
    T.paperDim,
    { align: "center", weight: 400 },
  );
}

export function buttonText(s: RunState): string {
  switch (s.phase) {
    case "prepare":
      return "싸우러 가기";
    case "battle": {
      // 보스전에는 이 자리가 개입 버튼이다. 전투 중 죽어 있던 공간을 재사용하므로
      // 세로 레이아웃 예산이 늘지 않는다.
      //
      // 버튼은 하나이고 상황에 따라 역할만 바뀐다 — 취약 창이 열리면 약점 공격,
      // 평소엔 회피. 조작을 늘리지 않고 레이드의 두 국면을 넣는 방법이다.
      const open = s.enemy.find((c) => c?.alive && c.vulnerableMs > 0);
      if (open) return open.strikeCombo > 0 ? `할퀴기!  x${open.strikeCombo}` : "할퀴기!";
      if (s.dodgeCharges <= 0) return "전투 중";
      // 쿨다운 중에는 남은 시간을 그대로 보여준다. 잠긴 이유를 안 보여주면
      // 그냥 안 먹는 버튼으로 읽힌다 — 예전에 실제로 그 보고를 받았다.
      if (s.actCooldown > 0) return `${(s.actCooldown / 1000).toFixed(1)}초`;
      // 버튼 하나가 상황에 맞게 일하므로 조작을 설명할 것이 없어졌다. 남는 것은
      // **몇 번 남았나**뿐이다. 전에는 `Space 흩어져 · Shift 뭉쳐 6`이었는데
      // 상자를 넘쳤고, 넘치지 않았더라도 1.2초 안에 읽을 분량이 아니었다.
      return `대응  ${s.dodgeCharges}`;
    }
    case "reward":
      // 상점 다음은 배치다. 정찰 칸만은 싸우지 않으므로 다시 지도로 간다.
      return s.nodeKind === "shop" ? "길 고르기" : "싸우러 가기";
    case "map":
      return "길을 고르세요";
    case "gameover":
      return "다시 도전";
  }
}

function drawButton(
  ctx: CanvasRenderingContext2D,
  L: Layout,
  s: RunState,
): void {
  const r = L.button;
  const openBoss = s.enemy.some((c) => c?.alive && c.vulnerableMs > 0);

  /**
   * 전투 중 버튼은 **반응할 것이 있을 때만** 살아 있다.
   *
   * 개입은 예고가 떠 있는 1.2초 안에서만 일한다. 그 밖에서 누르면 큐에도 안
   * 들어가고 차지도 안 줄고 아무 일도 안 일어나는데, 버튼은 내내 같은 주황으로
   * 눌러 달라는 얼굴을 하고 있었다. 그래서 "버튼이 고장 났다"로 읽혔다 —
   * 실제로 그 보고를 받았고, 계측해 보니 기능은 멀쩡했다.
   *
   * 말로 설명하는 대신 버튼이 스스로 때를 알린다. 죽어 있으면 누를 때가 아니고,
   * 살아나면 지금이다. 무엇을 눌러야 하는지는 여전히 장판 색이 말한다 —
   * 버튼까지 정답을 알려주면 읽을 이유가 사라진다.
   */
  const armed =
    (s.phase !== "battle" && s.phase !== "map") ||
    openBoss ||
    (s.dodgeCharges > 0 && s.actCooldown <= 0 && s.enemy.some((c) => c?.telegraph));
  const idle = !armed;
  const face = idle ? "rgba(239,224,198,0.07)" : T.action;
  const edge = idle ? "rgba(0,0,0,0.3)" : "#A85E1E";

  bevelPanel(
    ctx,
    r,
    r.h * 0.26,
    face,
    edge,
    idle ? 2 : Math.max(3, r.h * 0.08),
  );

  // 살아난 순간을 놓치지 않게 테두리가 한 번 밝아진다. 예고는 1.2초뿐이다.
  if (armed && s.phase === "battle") {
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 150);
    ctx.save();
    roundRect(ctx, r, r.h * 0.26);
    ctx.strokeStyle = `rgba(255,255,255,${0.18 + pulse * 0.3})`;
    ctx.lineWidth = Math.max(2, r.h * 0.05);
    ctx.stroke();
    ctx.restore();
  }

  if (!idle) {
    // 위쪽 하이라이트. 눌리는 물건처럼 보이게 하는 최소한의 장치.
    roundRect(
      ctx,
      {
        x: r.x + r.w * 0.06,
        y: r.y + r.h * 0.13,
        w: r.w * 0.88,
        h: r.h * 0.22,
      },
      r.h * 0.11,
    );
    ctx.fillStyle = "rgba(255,255,255,0.16)";
    ctx.fill();
  }

  // maxWidth를 넘긴다. 없으면 uiText가 줄이지 않아 긴 글이 상자 밖으로 샌다 —
  // 실제로 `Space 흩어져 · Shift 뭉쳐 6`이 버튼 오른쪽으로 삐져나와 있었다.
  uiText(
    ctx,
    buttonText(s),
    r.x + r.w / 2,
    r.y + r.h / 2,
    Math.max(15, r.h * 0.36),
    idle ? T.muted : T.actionInk,
    {
      align: "center",
      weight: 800,
      maxWidth: r.w * 0.86,
    },
  );
}

/**
 * 안내 띠. 준비 단계에서는 이번 상대의 성격을 알려준다.
 * 무엇이 오는지 모르면 배치를 바꿀 이유가 없다.
 */
/**
 * 방금 깎인 체력이 따라오는 양(chip damage).
 *
 * 막대가 즉시 줄면 "얼마나 들어갔는지"가 안 보인다. 흰 꼬리가 0.4초쯤 늦게
 * 따라오면 한 방의 크기가 눈에 남는다. uid로 기억하되 보스는 한 번에 하나라
 * 이 맵은 항목 두엇을 넘지 않는다.
 */
const chipTrail = new Map<string, number>();

/**
 * 보스 전용 체력 배너.
 *
 * 일반 고양이와 같은 언어(더 넓은 막대)로는 "레이드가 시작됐다"가 전달되지
 * 않는다. 자리·두께·눈금 셋을 다르게 해서 다른 물건으로 만든다.
 *
 * 자리는 안내 문구 띠를 그대로 쓴다. 보스전 중에는 그 띠가 어차피 비어 있고
 * (안내는 배치 단계에만 뜬다), 새 자리를 떼면 판이 줄어 셀이 작아진다.
 *
 * 눈금은 `BOSS_THRESHOLDS` 그 자체다. 광역기가 나가는 지점이 화면에 없으면
 * 플레이어는 "왜 갑자기 터졌는지"를 배울 수 없다. 지나간 문턱은 흔적만 남기고,
 * 다음 문턱만 레몬으로 도드라진다 — 알아야 할 것은 언제나 다음 하나뿐이다.
 */
function drawBossBanner(
  ctx: CanvasRenderingContext2D,
  L: Layout,
  boss: Cat,
): void {
  const r = L.notice;
  const sniper = boss.breed.id === SNIPER_BREED.id;
  // 저격수는 미니 보스다. 위계를 크기로 표현한다 — 같은 배너, 낮은 높이, 눈금 없음.
  const h = r.h * (sniper ? 0.72 : 1);
  const y = r.y + (r.h - h) / 2;
  const pad = h * 0.16;

  bevelPanel(ctx, { x: r.x, y, w: r.w, h }, h * 0.22, "rgba(14,10,8,0.82)", "rgba(0,0,0,0.5)", 2);

  // 왼쪽 — 이름과 격
  const nameSize = Math.max(10, h * 0.34);
  uiText(ctx, boss.breed.name, r.x + pad * 1.4, y + h * 0.36, nameSize, T.text, {
    align: "left",
    weight: 800,
  });
  uiText(
    ctx,
    sniper ? "설핏 든 것" : "되풀이되는 것",
    r.x + pad * 1.4,
    y + h * 0.72,
    nameSize * 0.72,
    T.enemy,
    { align: "left", weight: 700 },
  );

  // 오른쪽 — 남은 페이즈. 숫자 하나로 "얼마나 남았나"가 잡힌다.
  const left = sniper ? 0 : Math.max(0, BOSS_THRESHOLDS.length - boss.thresholdIdx);
  const rightW = sniper ? pad : h * 1.5;
  if (!sniper) {
    numText(
      ctx,
      `${left}/${BOSS_THRESHOLDS.length}`,
      r.x + r.w - pad * 1.4,
      y + h * 0.5,
      Math.max(1, h * 0.055),
      left <= 1 ? T.vuln : T.paperDim,
      "right",
    );
  }

  // 가운데 — 막대. 일반 고양이 체력바가 5px 남짓이므로 여기서 확실히 두껍게.
  const barX = r.x + Math.max(r.w * 0.24, h * 4.4);
  const barW = r.x + r.w - rightW - pad - barX;
  const barH = h * 0.42;
  const barY = y + (h - barH) / 2;
  if (barW <= 4) return;

  const frac = Math.max(0, Math.min(1, boss.hp / boss.maxHp));
  const prev = chipTrail.get(boss.uid) ?? frac;
  // 위로는 즉시 따라붙고(부활·회복) 아래로만 천천히 따라온다.
  const chip = frac > prev ? frac : prev + (frac - prev) * 0.08;
  chipTrail.set(boss.uid, chip);

  roundRect(ctx, { x: barX, y: barY, w: barW, h: barH }, barH * 0.3);
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fill();

  // 방금 깎인 양이 흰 꼬리로 남는다.
  if (chip > frac + 0.002) {
    roundRect(ctx, { x: barX, y: barY, w: barW * chip, h: barH }, barH * 0.3);
    ctx.fillStyle = "rgba(255,255,255,0.16)";
    ctx.fill();
  }
  roundRect(ctx, { x: barX, y: barY, w: Math.max(barH * 0.6, barW * frac), h: barH }, barH * 0.3);
  ctx.fillStyle = T.bossHp;
  ctx.fill();

  if (!sniper) {
    for (const t of BOSS_THRESHOLDS) {
      const tx = Math.round(barX + barW * t);
      const passed = frac <= t;
      // 다음에 올 문턱 하나만 레몬으로 세운다. 여섯을 다 세우면 아무것도 안 보인다.
      const next = !passed && BOSS_THRESHOLDS.filter((v) => v < frac)[0] === t;
      ctx.fillStyle = next
        ? T.vuln
        : passed
          ? "rgba(239,224,198,0.42)"
          : "rgba(239,224,198,0.18)";
      const tw = next ? 2 : 1;
      const th = next ? barH : barH * 0.7;
      ctx.fillRect(tx - tw / 2, barY + (barH - th) / 2, tw, th);
    }
  }

  // 퍼센트는 막대 안 오른쪽 끝에. 숫자를 밖에 두면 자리를 또 뗀다.
  numText(
    ctx,
    `${Math.round(frac * 100)}%`,
    barX + barW - barH * 0.4,
    barY + barH / 2,
    Math.max(1, barH * 0.11),
    T.paper,
    "right",
  );
}

function drawNotice(
  ctx: CanvasRenderingContext2D,
  L: Layout,
  s: RunState,
): void {
  if (s.phase === "gameover") return;
  // 보스가 살아 있으면 이 띠는 배너에 넘긴다. 안내는 배치 단계 것이라 겹치지 않는다.
  const boss = s.enemy.find((c) => c?.alive && c.radius > 0);
  if (s.phase === "battle" && boss) {
    drawBossBanner(ctx, L, boss);
    return;
  }
  const r = L.notice;
  const size = Math.max(11, r.h * 0.56);
  const cy = r.y + r.h / 2;

  /**
   * 이번에 싸울 상대의 성격을 알린다.
   *
   * **구매·배치를 합치면서 이 배너가 통째로 사라졌었다.** 조건이
   * `phase === "prepare"`뿐이었는데 UI가 그 화면을 안 그리게 됐기 때문이다.
   * 하필 이 게임이 파는 것이 "무엇과 싸울지 알고 산다"이고, 그 '무엇'을 글로
   * 말해 주는 자리가 여기 하나뿐이었다 — 기능을 합치면서 그 근거를 없앤 셈이다.
   *
   * 정찰 칸은 안 싸우므로 뺀다. `s.notice`가 있으면(정예 경고 등) 그쪽이
   * 이긴다 — 성격은 매 걸음 같은 자리에 뜨지만 안내는 그때만 뜨므로,
   * 겹치면 드문 쪽이 더 알릴 것이 있다.
   */
  const showsKind =
    s.phase === "prepare" || (s.phase === "reward" && s.nodeKind !== "shop" && !s.notice);
  if (showsKind) {
    // 웨이브 번호가 아니라 **고른 칸**이 성격을 정한다. `waveKind(s.wave)`를
    // 쓰던 동안 상점을 밟은 판에서 배너가 실제 적과 다른 이름을 달고 있었다.
    const info = waveKindInfo(currentKind(s));
    const nameW = ctx.measureText(info.name).width;
    uiText(
      ctx,
      info.name,
      L.w / 2 - nameW * 0.5 - r.h * 0.2,
      cy,
      size,
      T.action,
      {
        align: "right",
        weight: 800,
      },
    );
    uiText(ctx, info.hint, L.w / 2 - nameW * 0.5, cy, size * 0.94, T.paperDim, {
      align: "left",
      weight: 600,
    });
    return;
  }

  if (!s.notice) return;
  uiText(ctx, s.notice, L.w / 2, cy, size, T.paperDim, {
    align: "center",
    weight: 600,
  });
}

function drawGameOver(
  ctx: CanvasRenderingContext2D,
  L: Layout,
  s: RunState,
): void {
  if (s.phase !== "gameover") return;
  ctx.fillStyle = "rgba(14,10,8,0.86)";
  ctx.fillRect(0, 0, L.w, L.h);

  /**
   * 부검을 판 하나에 담는다.
   *
   * 처음엔 화면 한가운데 글자만 얹었더니 아래 시너지 바와 직업 카운터가 어둠막
   * 너머로 비쳐 글자와 겹쳤다. 읽어야 할 것과 이미 끝난 것이 같은 자리에서
   * 싸우면 둘 다 안 읽힌다. 판을 깔아 안팎을 가른다.
   */
  const lines =
    (s.lossReason === "timeout" || s.killer ? 1 : 0) + (s.telegraphsSeen > 0 ? 1 : 0) + 1;
  const panelW = Math.min(L.w * 0.86, L.scale * 560);
  const panelH = L.scale * 174 + lines * L.scale * 20;
  // 버튼 위로만 쓴다. 아래로 내려가면 유일한 행동이 판에 깔린다.
  const top = Math.max(L.scale * 10, (L.button.y - panelH) / 2);
  const panel = { x: L.w / 2 - panelW / 2, y: top, w: panelW, h: panelH };
  bevelPanel(ctx, panel, L.scale * 12, "rgba(20,14,11,0.94)", "rgba(0,0,0,0.6)", 2);

  const cy = panel.y + L.scale * 76;
  const px = Math.max(3, Math.round(L.scale * 9));
  const num = String(s.wave);
  // 라벨 자리를 숫자의 **실제 높이**에서 뽑는다. 상수로 두면 화면 배율이 바뀔 때
  // "도달"과 "웨이브"가 숫자 위로 올라탄다(1280x800에서 실제로 그랬다).
  const numH = numTextHeight(px);
  const gap = L.scale * 12;

  uiText(ctx, "도달", L.w / 2, cy - numH / 2 - gap, L.scale * 15, T.muted, {
    align: "center",
    weight: 800,
  });
  numText(ctx, num, L.w / 2, cy, px, T.paper, "center", false);
  uiText(ctx, "웨이브", L.w / 2, cy + numH / 2 + gap, L.scale * 16, T.muted, {
    align: "center",
    weight: 800,
  });

  /**
   * 부검.
   *
   * 숫자 하나로 끝나면 12분을 쓰고도 "다음엔 뭘 다르게 하지"에 답이 없다.
   * 세 줄만 준다 — **무엇에 막혔는가 · 예고를 얼마나 읽었는가 · 어떤 팀이었는가.**
   * 측정상 가장 큰 결정 축이 개입이고 판이 끝나는 이유의 41%가 보스라서,
   * 그 둘이 첫 두 줄이다. 더 얹으면 읽히지 않는다.
   */
  let ly = cy + numH / 2 + gap * 2.6;
  const line = (text: string, color: string, weight = 400): void => {
    uiText(ctx, text, L.w / 2, ly, L.scale * 13, color, { align: "center", weight });
    ly += L.scale * 20;
  };

  if (s.lossReason === "timeout") {
    line("시간이 다 됐어요 · 화력이 조금 모자랐어요", T.enemy, 800);
  } else if (s.killer) {
    const hp = Math.round(s.killer.hpFrac * 100);
    line(
      s.killer.boss
        ? `${s.killer.name}에게 막혔어요 · 체력 ${hp}%를 남기고`
        : `${s.killer.name} 무리에게 당했어요`,
      T.enemy,
      800,
    );
  }

  // 예고 성적. 보스를 한 번도 안 만난 판에는 뜨지 않는다 — 없는 얘기를 하면
  // 화면만 길어진다.
  if (s.telegraphsSeen > 0) {
    const eaten = s.telegraphsEaten;
    const read = s.telegraphsSeen - eaten;
    const rate = Math.round((read / s.telegraphsSeen) * 100);
    line(
      `예고 ${s.telegraphsSeen}번 중 ${read}번 피함 (${rate}%)`,
      rate >= 70 ? T.gather : rate >= 40 ? T.paperDim : T.danger,
      800,
    );
  }

  // 살아남은 고양이가 아니라 **데리고 있던** 고양이를 센다. 전멸한 판에서
  // livingCats를 쓰면 전부 0이 떠서 어떤 팀이었는지가 사라진다.
  const cats = s.ally.filter((c): c is Cat => c !== null);
  const by = { warrior: 0, rogue: 0, archer: 0, mage: 0 };
  for (const c of cats) by[c.breed.cls] += 1;
  const team = `전${by.warrior} 도${by.rogue} 궁${by.archer} 법${by.mage}`;
  line(s.relics.length > 0 ? `${team} · ${s.relics.map((r) => r.name).join(" · ")}` : team, T.muted);

  /**
   * 최고 기록 대비 막대.
   *
   * "12웨이브"는 잘한 건지 못한 건지 알 수 없는 숫자다. 자기 최고 기록 옆에
   * 놓으면 그때서야 뜻이 생긴다 — 거의 다 왔는지, 한참 못 미쳤는지.
   */
  const goal = Math.max(s.best, s.wave, 1);
  const bw = Math.min(L.w * 0.5, L.scale * 320);
  const bh = Math.max(6, L.scale * 9);
  const bx = L.w / 2 - bw / 2;
  const byy = ly + L.scale * 6;
  roundRect(ctx, { x: bx, y: byy, w: bw, h: bh }, bh / 2);
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.fill();
  roundRect(ctx, { x: bx, y: byy, w: Math.max(bh, (bw * s.wave) / goal), h: bh }, bh / 2);
  ctx.fillStyle = s.recordBroken ? T.gold : T.ally;
  ctx.fill();
  // 최고 기록 눈금. 갱신한 판에는 내가 그 눈금이므로 그리지 않는다.
  if (!s.recordBroken && s.best > 0) {
    const tx = bx + (bw * s.best) / goal;
    ctx.fillStyle = T.gold;
    ctx.fillRect(tx - 1, byy - bh * 0.35, 2, bh * 1.7);
  }

  uiText(
    ctx,
    s.recordBroken ? "최고 기록 갱신" : `최고 기록 ${s.best}웨이브`,
    L.w / 2,
    byy + bh + L.scale * 14,
    L.scale * 14,
    s.recordBroken ? T.gold : T.muted,
    { align: "center", weight: 800 },
  );
}

/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* 막 — 판·여정의 경계에서 한 번 나왔다 사라지는 화면                     */
/* ------------------------------------------------------------------ */

/**
 * 전환 막.
 *
 * 지금까지 판이 시작되는지, 여정이 넘어가는지, 보스를 넘었는지가 화면에서
 * 구분되지 않았다. 상점 → 지도 → 배치 → 전투가 같은 무게로 이어져서 **어디가
 * 마디인지**가 없었다. 마디가 없으면 12분이 한 덩어리로 느껴진다.
 *
 * 막은 렌더러만 안다. `RunState`에 넣지 않은 이유는 헤드리스 시뮬이 이걸 알
 * 필요가 없어서다 — 연출은 판정과 분리한다는 이 저장소의 규칙 그대로다.
 * 대신 상태의 **변화를 렌더러가 관찰**해서 스스로 띄운다.
 */
interface Curtain {
  title: string;
  sub: string;
  life: number;
  max: number;
}

const CURTAIN_MS = 1500;
let curtain: Curtain | null = null;
let curtainAt = 0;
/** 무엇이 바뀌었는지 알려면 직전 값을 들고 있어야 한다. */
let seenSeed = -1;
let seenStage = -1;
let seenBosses = -1;

function raise(title: string, sub: string): void {
  curtain = { title, sub, life: CURTAIN_MS, max: CURTAIN_MS };
}

/** 상태의 변화를 보고 막을 올린다. 게임 코드는 이걸 모른다. */
function watchTransitions(s: RunState): void {
  const bosses = bossesSeen(s);

  if (s.seed !== seenSeed) {
    // 새 판. 시드가 곧 판의 신원이다.
    seenSeed = s.seed;
    seenStage = s.map.stage;
    seenBosses = bosses;
    raise("냥 아레나", "집사님, 오늘 밤도 잘 부탁해요");
    return;
  }
  // 보스를 넘은 것이 먼저다. 넘는 순간 여정도 함께 바뀌는 경우가 있는데,
  // 그때 여정 안내만 뜨면 방금 해낸 일이 화면에서 사라진다.
  if (bosses > seenBosses) {
    seenBosses = bosses;
    seenStage = s.map.stage;
    raise("악몽을 밀어냈어요", `${s.wave - 1}웨이브까지 잘 버텼어요`);
    return;
  }
  if (s.map.stage !== seenStage) {
    seenStage = s.map.stage;
    raise(`${s.map.stage}번째 밤`, "여섯 걸음 안에 악몽이 둘 있어요");
  }
}

/**
 * 막을 그린다. 들어올 때 빠르고 나갈 때 느리다 — 정보는 즉시 주고,
 * 사라지는 것은 눈이 따라올 수 있게.
 */
function drawCurtain(ctx: CanvasRenderingContext2D, L: Layout): void {
  if (!curtain) return;
  const now = performance.now();
  const dt = curtainAt ? Math.min(48, now - curtainAt) : 16;
  curtainAt = now;
  curtain.life -= dt;
  if (curtain.life <= 0) {
    curtain = null;
    return;
  }

  const t = 1 - curtain.life / curtain.max; // 0 → 1
  // 앞 12%에 들어오고, 뒤 35%에 나간다.
  const alpha = t < 0.12 ? t / 0.12 : t > 0.65 ? 1 - (t - 0.65) / 0.35 : 1;
  const a = Math.max(0, Math.min(1, alpha));

  ctx.save();
  ctx.globalAlpha = a;
  ctx.fillStyle = "rgba(9,6,5,0.9)";
  ctx.fillRect(0, 0, L.w, L.h);

  const cy = L.h / 2;
  // 위아래 선. 글자만 있으면 떠 있는 자막처럼 보인다.
  const lw = Math.min(L.w * 0.6, L.scale * 420);
  ctx.strokeStyle = `rgba(244,227,193,${0.35 * a})`;
  ctx.lineWidth = Math.max(1, L.scale * 1.5);
  for (const dy of [-L.scale * 40, L.scale * 40]) {
    ctx.beginPath();
    ctx.moveTo(L.w / 2 - lw / 2, cy + dy);
    ctx.lineTo(L.w / 2 + lw / 2, cy + dy);
    ctx.stroke();
  }

  uiText(ctx, curtain.title, L.w / 2, cy - L.scale * 8, L.scale * 30, T.paper, {
    align: "center",
    weight: 800,
  });
  uiText(ctx, curtain.sub, L.w / 2, cy + L.scale * 20, L.scale * 14, T.paperDim, {
    align: "center",
    weight: 400,
  });
  ctx.restore();
}

export function render(
  ctx: CanvasRenderingContext2D,
  L: Layout,
  s: RunState,
  drag: DragState,
  hoverCell: number,
): void {
  drawBackground(ctx, L, s);
  drawArena(ctx, L);
  drawHud(ctx, L, s);
  drawMute(ctx, L, isMuted());

  drawDivider(ctx, L);
  drawSideLabels(ctx, L);
  drawBoard(ctx, L, "ally", T.ally, hoverCell);
  drawBoard(ctx, L, "enemy", T.enemy, -1);
  drawTelegraphs(ctx, L, s);

  // 화면 아래쪽 고양이가 위에 그려지도록 y로 정렬한다.
  // 전투 중에는 양쪽이 뒤섞이므로 이게 없으면 겹칠 때 앞뒤가 뒤집혀 보인다.
  const drawList: { cat: Cat; y: number; dimmed: boolean }[] = [];
  for (let i = 0; i < BOARD_SIZE; i++) {
    const e = s.enemy[i];
    if (e)
      drawList.push({
        cat: e,
        y: fieldToScreen(L, e.fx, e.fy).y,
        dimmed: false,
      });
    const a = s.ally[i];
    if (a) {
      drawList.push({
        cat: a,
        y: fieldToScreen(L, a.fx, a.fy).y,
        dimmed: drag.active && drag.fromCell === i,
      });
    }
  }
  drawList.sort((p, q) => p.y - q.y);
  for (const d of drawList) drawCat(ctx, L, d.cat, d.dimmed);

  drawFx(ctx, L);
  drawShots(ctx, L);

  // 드래그 중인 고양이는 손가락을 따라다닌다.
  if (drag.active) {
    const cat = s.ally[drag.fromCell];
    if (cat) {
      const size = L.cell * CAT_SCALE;
      const img = spriteFor(cat.breed.id, "move");
      ctx.save();
      ctx.globalAlpha = 0.95;
      if (img)
        ctx.drawImage(img, drag.x - size / 2, drag.y - size / 2, size, size);
      ctx.restore();
    }
  }

  drawPops(ctx, L);
  drawBottomZone(ctx, L, s);
  drawSynergies(ctx, L, s);
  drawMap(ctx, L, s, drag);
  drawNotice(ctx, L, s);
  // 부검을 먼저 깔고 버튼을 그 위에 올린다. 순서가 반대면 전면 어둠막이 버튼까지
  // 덮어서, 유일하게 누를 수 있는 물건이 비활성처럼 보였다.
  drawGameOver(ctx, L, s);
  drawButton(ctx, L, s);
  // 막은 맨 위다. 아래에 무엇이 있든 전환이 전환으로 읽혀야 한다.
  watchTransitions(s);
  drawCurtain(ctx, L);
}
