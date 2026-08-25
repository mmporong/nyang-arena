/**
 * 시각 토큰과 텍스트 렌더링.
 *
 * 방향: "달빛 아래 색이 번지는 악몽 다방".
 * 인디고·플럼 공간 위에 코랄 조명, 시안 달빛, 크림 종이를 얹는다. 캐릭터의
 * 따뜻함은 유지하되 거의 검은 갈색 면이 전체 화면을 먹지 않게 색상 층을 넓혔다.
 *
 * 생선(자원)만 찬 색인 것은 의도적이다. 온기 일색에서 딱 하나 온도를 깨서 자원이
 * 눈에 들어오게 했고, 마침 생선이라 문자 그대로도 맞다.
 */
import type { CatColor } from "./types.ts";

/**
 * 색 역할표.
 *
 * 원칙 하나로 정리했다 — **신호는 채도를 독점하고, 정체성은 색상만 갖는다.**
 *
 * 전에는 회피 예고가 `#C24B3A`로 적 진영색과 **같은 값**이었고, 뭉침 예고
 * `#6FB6DC`는 마법사 직업색이자 화폐색과 같은 값이었다. 판 위에서 0.5초 안에
 * 탭이냐 꾹이냐를 정해야 하는데 같은 색이 세 군데서 다른 말을 하고 있었다.
 *
 * 그래서 색을 겹치지 않게 민 것이 아니라 **밝기와 채도를 갈랐다.** 판 위에서
 * 고채도·고명도는 신호 셋만 쓴다. 진영·직업·화폐는 전부 채도를 낮춰 배경 쪽으로
 * 물러난다. 액션 버튼만 예외인데, 그건 판 밖에 있어서 신호와 공간이 갈린다.
 *
 * 색맹 대응이 덤으로 붙는다 — 세 신호는 형태로도 다르다(위험은 사선 해칭,
 * 집합은 동심원, 취약은 채워진 고리). `drawTelegraphs`를 볼 것.
 */
export const T = {
  ink: "#120E2A",
  inkDeep: "#09071C",
  floor: "#211743",
  floorEdge: "rgba(255,241,214,0.18)",
  paper: "#FFF1D6",
  paperDim: "#D7C4DE",

  // 신호 — 판 위에서 채도를 독점한다.
  danger: "#FF3F6E",
  gather: "#2BE3B4",
  vuln: "#FFE24A",

  // 진영 — 저채도. 신호가 뜨면 확실히 뒤로 물러나야 한다.
  ally: "#FFE3A3",
  enemy: "#FF7B74",
  /** 보스 체력. 적 계열이되 한 단계 밝다 — 배너에만 뜨므로 판 위 신호와 공간이 갈린다. */
  bossHp: "#FF766D",

  // 화폐 — HUD와 상점에만. 판 위에는 안 나온다.
  fish: "#65D9FF",
  gold: "#FFD166",
  /** 마나. 생선색을 판 위에 올리면 뭉침 신호와 겹치므로 저채도 슬레이트로 뺐다. */
  mana: "#7898C8",

  text: "#FFF7E8",
  muted: "#B9A7C9",
  // 상태 표식은 정체성이지 신호가 아니다. 직업색 대역을 그대로 쓴다.
  melee: "#D7A860",
  ranged: "#7FB7E8",

  /** 판 밖 유일한 고채도 주황. 버튼은 신호와 경쟁하지 않는다. */
  action: "#FF8A4C",
  actionInk: "#2B1027",
} as const;

/**
 * 스테이지 테마가 잔몹에 얹는 색조 팔레트.
 *
 * **CatColor의 화면색 사전이 아니다** — `tintForEnemy`는 고양이 자기 색을
 * 보지 않고 `breedId % 팔레트길이`로 고른다. CatColor 키를 빌린 것은
 * recolor-sprites.py의 색 이름과 어휘를 맞추기 위해서일 뿐이므로, "같은 색
 * 시너지 칩을 이걸로 칠하자" 같은 재사용을 하면 실제 스프라이트 색과
 * 갈라진다(리뷰 경고). 값의 색상각은 recolor의 HSL hue와 ±6° 안에서 맞다.
 */
export const STAGE_TINT: Partial<Record<CatColor, string>> = {
  orange: "#F2823C",
  crimson: "#C63B3B",
  gold: "#E8B23C",
  // 리컬러 스프라이트의 hue(보라 0.75, 연두 0.28)와 맞춰야 실루엣과 칩이 갈라지지 않는다.
  purple: "#8F4DB8",
  green: "#55A84C",
  // 얼음 성채는 리컬러 hue navy≈0.61·teal≈0.47을 써서 얼음과 죽음의 대비를 유지한다.
  navy: "#526DB8",
  teal: "#43B7A8",
};

/* ------------------------------------------------------------------ */
/* 숫자                                                                 */
/* ------------------------------------------------------------------ */

/**
 * 숫자·기호를 **UI 폰트로** 그린다.
 *
 * 예전에는 5×7 비트맵 글리프를 손으로 찍었다. 픽셀 고양이와 한 격자에서 나온
 * 물건처럼 보이게 하려던 것인데, 대가가 컸다. 글리프 집합이 닫혀 있어
 * `0-9 L V S + - / ! %`밖에 못 찍었고(없는 글자는 조용히 빈칸이 됐다), 카드
 * 비용·시너지 진행도·보스 퍼센트처럼 **작게 뜨는 숫자**가 저해상도에서 뭉갰다.
 * 무엇보다 같은 줄에 한글은 시스템 폰트, 숫자는 비트맵이라 두 글꼴이 부딪혔다.
 *
 * `px` 인자는 옛 글리프의 픽셀 하나 크기를 그대로 받는다. 호출부 열세 곳이 전부
 * 그 단위로 크기를 맞춰 두었으므로, 단위를 바꾸면 그 열세 곳을 눈으로 다시
 * 맞춰야 한다. 안에서 폰트 크기로 환산해 **보이는 높이를 유지**한다.
 */
/** 옛 글리프의 행 수. 보이는 높이를 맞추는 기준이다. */
const GLYPH_H = 7;
/**
 * 폰트의 숫자 높이 ÷ em.
 *
 * 산세리프 숫자는 대문자 높이와 같고 그게 대략 0.72em이다. 이 값으로 나눠야
 * 폰트 크기가 옛 글리프와 같은 높이를 낸다.
 */
const NUM_CAP_RATIO = 0.72;

/** 옛 px 단위를 폰트 크기로. 레이아웃 계산이 이걸 쓴다. */
export function numTextSize(px: number): number {
  return (GLYPH_H * px) / NUM_CAP_RATIO;
}

/** 그려질 숫자의 높이. 라벨 자리를 이 값에서 뽑는 곳이 있다. */
export function numTextHeight(px: number): number {
  return GLYPH_H * px;
}

/**
 * 그려질 숫자의 폭.
 *
 * 옛 비트맵은 글자 수 × 고정 폭이라 계산으로 나왔지만 비례 폰트는 재야 한다.
 * **`numText`와 같은 폰트로 재야** 아이콘 자리가 숫자와 안 갈린다.
 */
export function numTextWidth(ctx: CanvasRenderingContext2D, text: string, px: number): number {
  ctx.font = fontOf(numTextSize(px), 800);
  return ctx.measureText(text).width;
}

export type NumAlign = "left" | "center" | "right";

/**
 * @param px 옛 글리프의 픽셀 하나 크기. `numTextSize`로 환산된다.
 * @param outline 사방 외곽선. 밝은 털 위에 뜨는 피해 숫자용이다 — 아래 그림자
 *   하나로는 흰 고양이 위에서 흰 숫자가 그대로 사라진다.
 */
export function numText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  px: number,
  color: string,
  align: NumAlign = "left",
  shadow = true,
  outline = false,
): void {
  const size = numTextSize(px);
  // 숫자는 늘 굵게. 자원·비용·진행도라 옆의 한글 라벨보다 앞에 서야 한다.
  const opts: UiTextOpts = { align, weight: 800, outline };

  // 외곽선은 uiText가 처리한다. 그림자는 그 아래 한 겹으로만 깐다.
  if (!outline && shadow) {
    uiText(ctx, text, x, y + Math.max(1, size * 0.06), size, "rgba(12,8,6,0.75)", {
      align,
      weight: 800,
    });
  }
  uiText(ctx, text, x, y, size, color, opts);
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
}

const STACK = `"Maplestory", "Malgun Gothic", "Apple SD Gothic Neo", system-ui, sans-serif`;

/**
 * 타이포 규칙을 한 곳에서 강제한다.
 *
 * **무게는 400과 800 둘뿐이다. 그 사이는 크기로 가른다.** 600과 700이 섞여
 * 있으면 이름과 부제가 같은 소리를 내고, 위계가 무게가 아니라 우연이 된다.
 * 호출부를 서른 곳 고치는 대신 여기서 두 단으로 눌러 버린다.
 *
 * 크기는 4의 배수로 떨어뜨린다. 스프라이트가 4px 격자에 찍혀 있는데 글자만
 * 13.5px이면 둘이 같은 물건으로 안 보인다 — 안티에일리어싱된 회색 획이 뜬다.
 *
 * `uiText`와 `wrapLines`가 **같은 함수**를 쓰는 것이 중요하다. 한쪽만 스냅하면
 * 재는 폭과 그리는 폭이 갈려서 글자가 상자를 넘는다.
 */
function fontOf(size: number, weight: number): string {
  const w = weight >= 700 ? 800 : 400;
  // 12px 미만은 격자에 맞출 여유가 없다. 거기서 반올림하면 읽을 수 없게 커지거나 작아진다.
  const s = size >= 12 ? Math.max(12, Math.round(size / 4) * 4) : Math.round(size);
  return `${w} ${s}px ${STACK}`;
}

/**
 * 주어진 폭에 들어가는 글자 크기를 돌려준다.
 *
 * `uiText`의 `maxWidth`는 캔버스가 글자를 **가로로 눌러서** 맞추므로 4글자 이름이
 * 25% 납작해진다. 지도 보스 칸에서 실제로 그랬다 — 원 지름이 110px인데 "무쇠발톱"이
 * 37px로 148px를 먹어 원 밖으로 넘쳤다. 크기를 줄이면 자형이 안 망가진다.
 */
export function fitTextSize(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  size: number,
  weight = 400,
): number {
  if (maxWidth <= 0) return size;
  ctx.font = fontOf(size, weight);
  const w = ctx.measureText(text).width;
  return w <= maxWidth || w === 0 ? size : size * (maxWidth / w);
}

export function uiText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  color: string,
  opts: UiTextOpts = {},
): void {
  const { align = "left", weight = 400, maxWidth, outline = false } = opts;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";

  /**
   * **`fillText`의 maxWidth를 그대로 쓰면 안 된다.**
   *
   * 그 인자는 줄바꿈이 아니라 **가로 압축**이다. 자리가 절반이면 글자를 절반
   * 폭으로 눌러 버리고, 한글은 그렇게 눌리면 획이 겹쳐 읽을 수가 없다.
   * 좁은 화면 상점 카드에서 이름이 세로 막대처럼 뭉개진 것이 이것 때문이었다
   * (폭 70px에 34px 글자를 넣고 있었다).
   *
   * 그래서 **들어갈 때까지 글자 크기를 줄인다.** 압축도 생략도 하지 않는다 —
   * 눌린 글자는 못 읽고, 잘린 글자는 무슨 능력인지 알 수 없다. 카드에 적힌
   * 내용이 곧 살지 말지의 근거이므로 끝까지 보여야 한다.
   *
   * 그래도 안 들어가면 그건 글자 문제가 아니라 **자리 문제**다. 그때는
   * layout.ts가 칸을 넓혀야 하지 여기서 글을 버릴 일이 아니다.
   */
  const shown = text;
  let fs = size;
  if (maxWidth !== undefined && maxWidth > 0) {
    ctx.font = fontOf(fs, weight);
    if (ctx.measureText(shown).width > maxWidth) {
      const floor = Math.max(8, size * 0.45);
      while (fs > floor) {
        fs -= 1;
        ctx.font = fontOf(fs, weight);
        if (ctx.measureText(shown).width <= maxWidth) break;
      }
    }
  }
  ctx.font = fontOf(fs, weight);

  if (outline) {
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(2, fs * 0.22);
    ctx.strokeStyle = "rgba(12,8,6,0.85)";
    ctx.strokeText(shown, x, y);
  }

  ctx.fillStyle = color;
  ctx.fillText(shown, x, y);
}

/**
 * 정해진 폭에 맞춰 줄을 나눈다. 카드 설명처럼 길이를 미리 알 수 없는 글에 쓴다.
 *
 * 한국어는 어절 단위로 끊는다. 한 어절이 통째로 넘치거나 줄 수가 모자라면
 * 말줄임으로 끝낸다 — 잘린 글이 잘린 줄 모르게 두는 것보다 낫다.
 */
export function wrapLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  size: number,
  weight: number,
  maxWidth: number,
  maxLines: number,
): string[] {
  ctx.font = fontOf(size, weight);
  const fits = (s: string) => ctx.measureText(s).width <= maxWidth;

  /** 폭을 넘는 줄을 말줄임으로 줄인다. 마지막 줄만이 아니라 어느 줄이든 넘칠 수 있다. */
  const clip = (s: string) => {
    if (fits(s)) return s;
    let out = s;
    while (out.length > 1 && !fits(`${out}…`)) out = out.slice(0, -1);
    return `${out}…`;
  };

  const lines: string[] = [];
  let cur = "";
  let dropped = false;

  for (const word of text.split(" ").filter(Boolean)) {
    const next = cur ? `${cur} ${word}` : word;
    if (!cur || fits(next)) {
      cur = next;
      continue;
    }
    if (lines.length + 1 >= maxLines) {
      dropped = true;
      break;
    }
    lines.push(clip(cur));
    cur = word;
  }
  if (cur) lines.push(cur);

  const last = lines.length - 1;
  if (last >= 0 && (dropped || !fits(lines[last]!))) {
    let s = lines[last]!;
    while (s.length > 1 && !fits(`${s}…`)) s = s.slice(0, -1);
    lines[last] = `${s}…`;
  }
  return lines;
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
