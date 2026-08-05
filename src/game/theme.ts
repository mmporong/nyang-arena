/**
 * 시각 토큰과 텍스트 렌더링.
 *
 * 방향: "한밤의 고양이 다방 결투장".
 * 색은 캐릭터 시트 자체에서 가져왔다 — 시트 배경의 베이지(#F0E4D2)와 제목 띠의
 * 테라코타(#B85C38). UI가 아트와 같은 물건에서 나온 것처럼 보이게 하기 위해서다.
 * 이전 팔레트는 남보라 배경에 민트·핑크 네온이었는데, 둥글고 따뜻한 픽셀 고양이와
 * 붙여 놓으면 서로 다른 게임의 부품처럼 보였다.
 *
 * 생선(자원)만 찬 색인 것은 의도적이다. 온기 일색에서 딱 하나 온도를 깨서 자원이
 * 눈에 들어오게 했고, 마침 생선이라 문자 그대로도 맞다.
 */
export const T = {
  ink: "#17110E",
  inkDeep: "#0E0A08",
  floor: "#241A14",
  floorEdge: "rgba(239,224,198,0.10)",
  paper: "#EFE0C6",
  paperDim: "#C9B896",

  ally: "#F4E3C1",
  enemy: "#C24B3A",
  fish: "#6FB6DC",
  gold: "#F0BA4A",

  text: "#F3E8D6",
  muted: "#9C8B76",
  melee: "#E8913C",
  ranged: "#7FBEE0",

  action: "#E8913C",
  actionInk: "#2A1608",
} as const;

/* ------------------------------------------------------------------ */
/* 픽셀 숫자                                                            */
/* ------------------------------------------------------------------ */

/**
 * 5×7 비트맵 글리프. 각 행의 하위 5비트가 한 줄이다.
 *
 * 숫자를 시스템 폰트로 찍으면 안티에일리어싱 때문에 픽셀 고양이 옆에서 흐릿하게
 * 뜬다. 같은 격자에서 그린 숫자가 아트와 한 몸으로 보인다. 한글 픽셀 폰트는
 * 용량이 커서 못 넣으므로(외부 요청 0건 제약), 숫자·기호만 이렇게 그리고
 * 한글은 시스템 폰트에 외곽선을 둘러 쓴다.
 */
const GLYPHS: Record<string, readonly number[]> = {
  "0": [0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e],
  "1": [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e],
  "2": [0x0e, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1f],
  "3": [0x1f, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0e],
  "4": [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02],
  "5": [0x1f, 0x10, 0x1e, 0x01, 0x01, 0x11, 0x0e],
  "6": [0x06, 0x08, 0x10, 0x1e, 0x11, 0x11, 0x0e],
  "7": [0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
  "8": [0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e],
  "9": [0x0e, 0x11, 0x11, 0x0f, 0x01, 0x02, 0x0c],
  L: [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1f],
  V: [0x11, 0x11, 0x11, 0x11, 0x11, 0x0a, 0x04],
  S: [0x0f, 0x10, 0x10, 0x0e, 0x01, 0x01, 0x1e],
  "+": [0x00, 0x04, 0x04, 0x1f, 0x04, 0x04, 0x00],
  "-": [0x00, 0x00, 0x00, 0x1f, 0x00, 0x00, 0x00],
  "/": [0x01, 0x02, 0x02, 0x04, 0x08, 0x08, 0x10],
  "!": [0x04, 0x04, 0x04, 0x04, 0x04, 0x00, 0x04],
  " ": [0, 0, 0, 0, 0, 0, 0],
};

const GLYPH_W = 5;
const GLYPH_H = 7;
/** 글자 사이 빈 열 */
const TRACK = 1;

export function pixelTextWidth(text: string, px: number): number {
  if (text.length === 0) return 0;
  return (text.length * (GLYPH_W + TRACK) - TRACK) * px;
}

export type PixelAlign = "left" | "center" | "right";

/**
 * 픽셀 숫자를 그린다.
 * @param px 픽셀 하나의 크기. 정수로 반올림해야 격자가 흐트러지지 않는다.
 */
export function pixelText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  px: number,
  color: string,
  align: PixelAlign = "left",
  shadow = true,
): void {
  const p = Math.max(1, Math.round(px));
  const w = pixelTextWidth(text, p);
  const h = GLYPH_H * p;
  let cx = align === "center" ? x - w / 2 : align === "right" ? x - w : x;
  cx = Math.round(cx);
  const cy = Math.round(y - h / 2);

  const draw = (ox: number, oy: number, fill: string) => {
    ctx.fillStyle = fill;
    let gx = cx + ox;
    for (const ch of text.toUpperCase()) {
      const g = GLYPHS[ch] ?? GLYPHS["?"] ?? GLYPHS[" "]!;
      for (let row = 0; row < GLYPH_H; row++) {
        const bits = g[row] ?? 0;
        for (let col = 0; col < GLYPH_W; col++) {
          if (bits & (1 << (GLYPH_W - 1 - col))) {
            ctx.fillRect(gx + col * p, cy + oy + row * p, p, p);
          }
        }
      }
      gx += (GLYPH_W + TRACK) * p;
    }
  };

  // 전장 위에 떠도 읽히도록 한 픽셀 아래에 그림자를 깐다.
  if (shadow) draw(0, p, "rgba(12,8,6,0.75)");
  draw(0, 0, color);
}

/* ------------------------------------------------------------------ */
/* 한글 UI 텍스트                                                       */
/* ------------------------------------------------------------------ */

export interface UiTextOpts {
  align?: CanvasTextAlign;
  weight?: number;
  maxWidth?: number;
  /** 전장 위에 그릴 때 켠다. 배경이 복잡해도 글자가 살아남는다. */
  outline?: boolean;
  tracking?: number;
}

const STACK = `"Pretendard", "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", system-ui, sans-serif`;

export function uiText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  color: string,
  opts: UiTextOpts = {},
): void {
  const { align = "left", weight = 600, maxWidth, outline = false, tracking } = opts;
  ctx.font = `${weight} ${Math.round(size)}px ${STACK}`;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  if (tracking !== undefined) ctx.letterSpacing = `${tracking}px`;

  if (outline) {
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(2, size * 0.22);
    ctx.strokeStyle = "rgba(12,8,6,0.85)";
    if (maxWidth !== undefined) ctx.strokeText(text, x, y, maxWidth);
    else ctx.strokeText(text, x, y);
  }

  ctx.fillStyle = color;
  if (maxWidth !== undefined) ctx.fillText(text, x, y, maxWidth);
  else ctx.fillText(text, x, y);

  if (tracking !== undefined) ctx.letterSpacing = "0px";
}

/* ------------------------------------------------------------------ */
/* 도형                                                                 */
/* ------------------------------------------------------------------ */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function roundRect(ctx: CanvasRenderingContext2D, r: Box, radius: number): void {
  const rad = Math.max(0, Math.min(radius, r.w / 2, r.h / 2));
  ctx.beginPath();
  ctx.moveTo(r.x + rad, r.y);
  ctx.arcTo(r.x + r.w, r.y, r.x + r.w, r.y + r.h, rad);
  ctx.arcTo(r.x + r.w, r.y + r.h, r.x, r.y + r.h, rad);
  ctx.arcTo(r.x, r.y + r.h, r.x, r.y, rad);
  ctx.arcTo(r.x, r.y, r.x + r.w, r.y, rad);
  ctx.closePath();
}

/** 아래쪽에 두께를 준 베벨 패널. 모바일 게임 UI의 기본 문법이다. */
export function bevelPanel(
  ctx: CanvasRenderingContext2D,
  r: Box,
  radius: number,
  face: string,
  edge: string,
  depth: number,
): void {
  roundRect(ctx, { ...r, y: r.y + depth }, radius);
  ctx.fillStyle = edge;
  ctx.fill();
  roundRect(ctx, r, radius);
  ctx.fillStyle = face;
  ctx.fill();
}
