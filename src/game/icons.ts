/**
 * 아이콘.
 *
 * 전부 Canvas 2D 패스로 그린다. 외부 요청 0건이 제출 조건이라 아이콘 폰트도
 * SVG 스프라이트도 못 쓴다.
 *
 * 왜 글자 대신 그림인가 — **지도 칸과 자원은 훑어보는 물건**이다. "전투/정예/정찰"
 * 세 낱말은 길이가 같고 첫 글자도 안 겹치지만, 지름 30px 원 안에 넣으면 셋 다
 * 회색 얼룩으로 보인다. 실제로 갈림길에서 무엇과 무엇 중에 고르는지가 한 번에
 * 안 읽혔다. 형태는 크기가 작아져도 실루엣이 남는다.
 *
 * 보스 칸만은 아이콘을 안 쓴다. 거기서 필요한 정보는 "보스"가 아니라 **어느
 * 보스인가**이고(무쇠발톱이냐 살금이냐에 따라 준비가 달라진다), 그건 이름으로만
 * 전달된다.
 *
 * 크기 규약: 모든 아이콘은 `(cx, cy)`를 중심으로 **한 변이 `size`인 정사각형**
 * 안에 들어간다. 호출부가 자리만 정하면 되도록.
 */

/** 획 굵기. 작은 크기에서 선이 사라지지 않도록 바닥을 준다. */
function stroke(ctx: CanvasRenderingContext2D, size: number, color: string, ratio = 0.12): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.2, size * ratio);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
}

/* ------------------------------------------------------------------ */
/* 픽토그램 (외부 에셋)                                                  */
/* ------------------------------------------------------------------ */

/**
 * 흰 실루엣 픽토그램을 색을 입혀 그린다.
 *
 * 직업과 유물은 손으로 그리기에 종류가 너무 많다(4 + 8). 손으로 그린 것들
 * (발톱·별·눈)은 형태가 단순해서 패스로 충분했지만, "매의 눈"과 "무지개 방울"을
 * 구분되게 그리려면 아이콘 하나에 패스 수십 줄이 든다.
 *
 * 원본이 **흰 실루엣 + 투명 배경**이라 `source-in`으로 색을 갈아 끼울 수 있다.
 * 진영색·직업색·켜짐 여부에 따라 같은 그림을 다른 색으로 써야 하므로 이게 중요하다.
 * 색을 입힌 결과는 캔버스에 캐시한다 — 매 프레임 합성하면 60fps에서 낭비다.
 */
const ICON_NAMES = [
  "fish",
  "cls-warrior",
  "cls-rogue",
  "cls-archer",
  "cls-mage",
  "relic-iron_collar",
  "relic-shadow_claw",
  "relic-hawk_eye",
  "relic-stardust_rod",
  "relic-lone_hunter",
  "relic-the_swarm",
  "relic-crown",
  "relic-rainbow_bell",
] as const;

export type IconName = (typeof ICON_NAMES)[number];

const icons = new Map<string, HTMLImageElement>();
const tintCache = new Map<string, HTMLCanvasElement>();

/** 전부 로드될 때까지 기다린다. 한 장 실패해도 게임은 떠야 하므로 폴백이 있다. */
export async function loadIcons(): Promise<void> {
  await Promise.all(
    ICON_NAMES.map(
      (name) =>
        new Promise<void>((resolve) => {
          const img = new Image();
          icons.set(name, img);
          img.onload = () => resolve();
          img.onerror = () => {
            console.warn(`아이콘 로드 실패: ${name}`);
            resolve();
          };
          img.src = `${import.meta.env.BASE_URL}icons/${name}.png`;
        }),
    ),
  );
}

/** 색을 입힌 사본. 원본은 흰색이므로 source-in 한 번이면 된다. */
function tinted(name: IconName, color: string): HTMLCanvasElement | null {
  const img = icons.get(name);
  if (!img || !img.complete || img.naturalWidth === 0) return null;

  const k = `${name}|${color}`;
  const hit = tintCache.get(k);
  if (hit) return hit;

  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const g = c.getContext("2d");
  if (!g) return null;
  g.drawImage(img, 0, 0);
  g.globalCompositeOperation = "source-in";
  g.fillStyle = color;
  g.fillRect(0, 0, c.width, c.height);
  tintCache.set(k, c);
  return c;
}

/**
 * `(cx, cy)`를 중심으로 한 변이 `size`인 정사각형 안에 그린다.
 * @returns 그렸으면 true. false면 호출부가 폴백을 그려야 한다.
 */
export function drawIcon(
  ctx: CanvasRenderingContext2D,
  name: IconName,
  cx: number,
  cy: number,
  size: number,
  color: string,
): boolean {
  const c = tinted(name, color);
  if (!c) return false;
  ctx.drawImage(c, cx - size / 2, cy - size / 2, size, size);
  return true;
}

/**
 * 생선 — 이 게임의 화폐.
 *
 * 숫자 옆에 늘 붙으므로 실루엣이 단순해야 한다. 몸통 하나 + 꼬리 하나 + 눈 하나.
 * 지느러미를 넣었더니 12px에서 몸통과 붙어 그냥 덩어리가 됐다.
 */
export function drawFish(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  color: string,
): void {
  // 아이콘이 있으면 그걸 쓰고, 못 불러왔으면 아래 손그림으로 떨어진다.
  // 자원 표시가 로드 실패로 사라지면 무엇을 살 수 있는지 알 수 없게 된다.
  if (drawIcon(ctx, "fish", cx, cy, size, color)) return;

  const w = size * 0.5;
  const h = size * 0.3;
  ctx.save();

  // 몸통
  ctx.beginPath();
  ctx.ellipse(cx + size * 0.08, cy, w * 0.78, h, 0, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();

  // 꼬리 — 몸통 왼쪽에 붙는 삼각형
  const tailX = cx + size * 0.08 - w * 0.72;
  ctx.beginPath();
  ctx.moveTo(tailX, cy);
  ctx.lineTo(tailX - size * 0.22, cy - h * 0.9);
  ctx.lineTo(tailX - size * 0.22, cy + h * 0.9);
  ctx.closePath();
  ctx.fill();

  // 눈 — 배경색이 아니라 잉크로 뚫는다. 어떤 바탕에 올려도 눈으로 읽힌다.
  ctx.beginPath();
  ctx.arc(cx + size * 0.28, cy - h * 0.22, Math.max(0.8, size * 0.055), 0, Math.PI * 2);
  ctx.fillStyle = "#17110E";
  ctx.fill();

  ctx.restore();
}

/**
 * 발톱 자국 — 평범한 전투.
 *
 * 칼이나 방패를 쓰지 않은 이유는 고양이가 칼을 안 들기 때문이다. 세 줄이
 * 나란히 그어진 형태는 작아져도 "긁혔다"로 읽힌다.
 */
function drawClaw(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  color: string,
): void {
  ctx.save();
  stroke(ctx, size, color, 0.11);
  const len = size * 0.62;
  for (const dx of [-size * 0.22, 0, size * 0.22]) {
    // 가운데 줄만 길다. 셋이 같은 길이면 빗살이 되어 발톱으로 안 읽힌다.
    const l = dx === 0 ? len : len * 0.78;
    ctx.beginPath();
    ctx.moveTo(cx + dx - size * 0.09, cy - l / 2);
    ctx.quadraticCurveTo(cx + dx, cy, cx + dx + size * 0.09, cy + l / 2);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * 별 — 정예.
 *
 * 로그라이크가 정예를 별로 쓰는 관습을 그대로 따른다. 새 기호를 발명하면
 * 처음 보는 사람이 무엇인지 배워야 하는데, 지도는 배우는 자리가 아니다.
 */
function drawStar(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  color: string,
): void {
  const outer = size * 0.42;
  const inner = outer * 0.44;
  ctx.save();
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    // 꼭짓점 하나가 위를 보게 -90도에서 시작한다.
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

/**
 * 눈 — 정찰.
 *
 * 이 칸의 이름은 `shop`이지만 하는 일은 정찰이다(안 싸우고 다음 보스전 회피를
 * 얻는다). 그래서 상점 아이콘이 아니라 **본다**는 뜻의 그림이어야 한다.
 * 가방이나 동전을 그리면 "여기서 산다"로 잘못 읽힌다 — 카드는 어차피 매 걸음
 * 나온다.
 */
function drawEye(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  color: string,
): void {
  const w = size * 0.44;
  const h = size * 0.26;
  ctx.save();
  stroke(ctx, size, color, 0.1);
  ctx.beginPath();
  ctx.moveTo(cx - w, cy);
  ctx.quadraticCurveTo(cx, cy - h * 1.6, cx + w, cy);
  ctx.quadraticCurveTo(cx, cy + h * 1.6, cx - w, cy);
  ctx.closePath();
  ctx.stroke();
  // 동공은 세로로 긴 고양이 눈이다. 원으로 두면 사람 눈이 된다.
  ctx.beginPath();
  ctx.ellipse(cx, cy, Math.max(0.9, size * 0.06), h * 0.72, 0, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

/** 지도 칸 종류별 아이콘. 보스는 이름을 쓰므로 여기에 없다. */
export function drawNodeIcon(
  ctx: CanvasRenderingContext2D,
  kind: "battle" | "elite" | "shop",
  cx: number,
  cy: number,
  size: number,
  color: string,
): void {
  if (kind === "elite") drawStar(ctx, cx, cy, size, color);
  else if (kind === "shop") drawEye(ctx, cx, cy, size, color);
  else drawClaw(ctx, cx, cy, size, color);
}
