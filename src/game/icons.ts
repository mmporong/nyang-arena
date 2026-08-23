/**
 * 아이콘.
 *
 * 로컬 PNG 픽토그램과 Canvas 2D 패스를 함께 쓴다. 외부 요청 0건이 제출 조건이라
 * 아이콘 폰트나 원격 SVG는 쓰지 않는다.
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
const BITMAP_ICON_NAMES = [
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

/** 외부 출처가 필요 없는 손그림 아이콘. 작은 크기에서도 윤곽이 갈리게 선으로 그린다. */
const CODE_ICON_NAMES = [
  "cls-summoner",
  "relic-mirror_charm",
  "relic-kitten_basket",
  "relic-hollow_bell",
] as const;

type BitmapIconName = (typeof BITMAP_ICON_NAMES)[number];
type CodeIconName = (typeof CODE_ICON_NAMES)[number];
export type IconName = BitmapIconName | CodeIconName;

const icons = new Map<string, HTMLImageElement>();
const tintCache = new Map<string, HTMLCanvasElement>();

/** 전부 로드될 때까지 기다린다. 한 장 실패해도 게임은 떠야 하므로 폴백이 있다. */
export async function loadIcons(): Promise<void> {
  await Promise.all(
    BITMAP_ICON_NAMES.map(
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
function tinted(name: BitmapIconName, color: string): HTMLCanvasElement | null {
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

function isCodeIconName(name: IconName): name is CodeIconName {
  return (
    name === "cls-summoner" ||
    name === "relic-mirror_charm" ||
    name === "relic-kitten_basket" ||
    name === "relic-hollow_bell"
  );
}

/** 소환사 — 소환진과 그 둘레에 나타나는 세 존재. */
function drawSummonerIcon(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  color: string,
): void {
  const u = size / 20;
  ctx.save();
  stroke(ctx, size, color, 0.105);

  ctx.beginPath();
  ctx.arc(cx, cy, u * 5.1, 0, Math.PI * 2);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy, u * 2.15, -Math.PI * 0.2, Math.PI * 1.25);
  ctx.stroke();

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(cx, cy - u * 8.3);
  ctx.arc(cx, cy - u * 6.9, u * 1.4, -Math.PI / 2, Math.PI * 1.5);
  ctx.moveTo(cx - u * 5.9, cy + u * 5.5);
  ctx.arc(cx - u * 4.8, cy + u * 4.6, u * 1.4, Math.PI * 0.8, Math.PI * 2.8);
  ctx.moveTo(cx + u * 5.9, cy + u * 5.5);
  ctx.arc(cx + u * 4.8, cy + u * 4.6, u * 1.4, Math.PI * 0.2, Math.PI * 2.2);
  ctx.fill();
  ctx.restore();
}

/** 거울 부적 — 세로 거울과 손잡이, 반사광 한 줄. */
function drawMirrorIcon(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  color: string,
): void {
  const u = size / 20;
  ctx.save();
  stroke(ctx, size, color, 0.11);
  ctx.beginPath();
  ctx.ellipse(cx, cy - u * 1.8, u * 5.2, u * 6.6, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx, cy + u * 4.9);
  ctx.lineTo(cx, cy + u * 8.1);
  ctx.moveTo(cx - u * 2.2, cy + u * 8.1);
  ctx.lineTo(cx + u * 2.2, cy + u * 8.1);
  ctx.moveTo(cx - u * 2.7, cy - u * 4.2);
  ctx.lineTo(cx + u * 1.2, cy - u * 6.1);
  ctx.stroke();
  ctx.restore();
}

/** 새끼 바구니 — 귀가 솟은 고양이 머리와 짜임 바구니. */
function drawKittenBasketIcon(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  color: string,
): void {
  const u = size / 20;
  ctx.save();
  stroke(ctx, size, color, 0.105);

  ctx.beginPath();
  ctx.moveTo(cx - u * 4.8, cy - u * 1.4);
  ctx.lineTo(cx - u * 4.2, cy - u * 6.8);
  ctx.lineTo(cx - u * 1.2, cy - u * 4.5);
  ctx.quadraticCurveTo(cx, cy - u * 5.2, cx + u * 1.2, cy - u * 4.5);
  ctx.lineTo(cx + u * 4.2, cy - u * 6.8);
  ctx.lineTo(cx + u * 4.8, cy - u * 1.4);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(cx - u * 7.2, cy - u * 1.2);
  ctx.lineTo(cx - u * 5.7, cy + u * 7.2);
  ctx.lineTo(cx + u * 5.7, cy + u * 7.2);
  ctx.lineTo(cx + u * 7.2, cy - u * 1.2);
  ctx.closePath();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - u * 6.2, cy + u * 2.1);
  ctx.lineTo(cx + u * 6.2, cy + u * 2.1);
  ctx.stroke();
  ctx.restore();
}

/** 빈 방울 — 속이 열린 종 몸체와 분리된 추. */
function drawHollowBellIcon(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  color: string,
): void {
  const u = size / 20;
  ctx.save();
  stroke(ctx, size, color, 0.11);
  ctx.beginPath();
  ctx.moveTo(cx - u * 6.7, cy + u * 4.2);
  ctx.quadraticCurveTo(cx - u * 4.8, cy + u * 1.1, cx - u * 4.8, cy - u * 2.3);
  ctx.quadraticCurveTo(cx - u * 4.8, cy - u * 7.1, cx, cy - u * 7.1);
  ctx.quadraticCurveTo(cx + u * 4.8, cy - u * 7.1, cx + u * 4.8, cy - u * 2.3);
  ctx.quadraticCurveTo(cx + u * 4.8, cy + u * 1.1, cx + u * 6.7, cy + u * 4.2);
  ctx.closePath();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - u * 7.6, cy + u * 4.2);
  ctx.lineTo(cx + u * 7.6, cy + u * 4.2);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy + u * 7.1, u * 1.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawCodeIcon(
  ctx: CanvasRenderingContext2D,
  name: CodeIconName,
  cx: number,
  cy: number,
  size: number,
  color: string,
): void {
  if (name === "cls-summoner") drawSummonerIcon(ctx, cx, cy, size, color);
  else if (name === "relic-mirror_charm") drawMirrorIcon(ctx, cx, cy, size, color);
  else if (name === "relic-kitten_basket") drawKittenBasketIcon(ctx, cx, cy, size, color);
  else drawHollowBellIcon(ctx, cx, cy, size, color);
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
  if (isCodeIconName(name)) {
    drawCodeIcon(ctx, name, cx, cy, size, color);
    return true;
  }
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
 * 스피커 — 음소거 토글.
 *
 * 켜짐과 꺼짐이 **같은 자리에서 다른 형태**여야 한다. 색만 바꾸면 어두운
 * 화면에서 둘이 구분되지 않고, 특히 소리를 안 켠 사람은 비교 대상이 없어
 * 지금 상태가 뭔지 알 수 없다. 꺼짐에는 사선을 긋는다 — 세계 공통이고,
 * 형태가 달라지므로 흘긋 봐도 갈린다.
 */
export function drawSpeaker(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  color: string,
  on: boolean,
): void {
  const u = size * 0.5;
  ctx.save();
  // 꺼짐은 **색이 아니라 투명도**로 낮춘다. 흐린 색으로 칠했더니 어두운 바탕에서
  // 형태가 통째로 사라져, 무엇이 꺼졌는지도 안 보였다.
  if (!on) ctx.globalAlpha = 0.62;
  ctx.fillStyle = color;

  // 몸통 — 작은 사각형에 붙은 나팔
  ctx.beginPath();
  ctx.moveTo(cx - u * 0.62, cy - u * 0.24);
  ctx.lineTo(cx - u * 0.3, cy - u * 0.24);
  ctx.lineTo(cx + u * 0.06, cy - u * 0.62);
  ctx.lineTo(cx + u * 0.06, cy + u * 0.62);
  ctx.lineTo(cx - u * 0.3, cy + u * 0.24);
  ctx.lineTo(cx - u * 0.62, cy + u * 0.24);
  ctx.closePath();
  ctx.fill();

  if (on) {
    // 음파 두 줄. 하나면 먼지처럼 보이고 셋이면 이 크기에서 뭉친다.
    stroke(ctx, size, color, 0.09);
    for (const r of [u * 0.42, u * 0.72]) {
      ctx.beginPath();
      ctx.arc(cx + u * 0.14, cy, r, -Math.PI / 3, Math.PI / 3);
      ctx.stroke();
    }
  } else {
    /**
     * 사선은 **아이콘을 가로질러야** 한다. 옆에 그으면 음소거가 아니라
     * 스피커 옆의 흠집으로 보인다(실제로 그렇게 나왔다).
     *
     * 몸통과 같은 색이라 겹치는 구간이 사라지므로 아래에 잉크를 한 번 깔아
     * 홈을 판다. 어떤 바탕에 올려도 선이 끊기지 않는다 — 눈을 뚫는 방식과 같다.
     */
    ctx.beginPath();
    ctx.moveTo(cx - u * 0.66, cy - u * 0.66);
    ctx.lineTo(cx + u * 0.74, cy + u * 0.74);
    stroke(ctx, size, "#17110E", 0.17);
    ctx.stroke();
    stroke(ctx, size, color, 0.085);
    ctx.stroke();
  }
  ctx.restore();
}

/** 지도 칸 종류별 아이콘. 보스는 이름을 쓰므로 여기에 없다. */
/**
 * 고양이 발바닥. 지도 아이콘 계열의 뿌리다.
 *
 * @param claws 발톱을 세울지. 같은 발바닥의 '더 센 것'을 뜻한다.
 */
function drawPaw(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  color: string,
  claws = false,
): void {
  const u = size / 20;
  ctx.fillStyle = color;
  // 손바닥 — 아래쪽이 넓은 물방울
  ctx.beginPath();
  ctx.ellipse(cx, cy + u * 3.2, u * 5.6, u * 4.6, 0, 0, Math.PI * 2);
  ctx.fill();
  // 발가락 넷. 가운데 둘이 높고 바깥 둘이 낮다.
  const toes: [number, number, number][] = [
    [-6.0, -2.2, 2.0],
    [-2.2, -5.2, 2.2],
    [2.2, -5.2, 2.2],
    [6.0, -2.2, 2.0],
  ];
  for (const [tx, ty, tr] of toes) {
    ctx.beginPath();
    ctx.ellipse(cx + tx * u, cy + ty * u, tr * u, tr * 1.15 * u, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  if (!claws) return;
  // 발톱 — 발가락 위로 뻗는 삼각. 같은 기호의 위계를 형태로 만든다.
  for (const [tx, ty, tr] of toes) {
    const x = cx + tx * u;
    const y = cy + ty * u - tr * 1.15 * u;
    ctx.beginPath();
    ctx.moveTo(x - tr * 0.5 * u, y + u * 0.4);
    ctx.lineTo(x, y - u * 3.4);
    ctx.lineTo(x + tr * 0.5 * u, y + u * 0.4);
    ctx.closePath();
    ctx.fill();
  }
}

/** 생선뼈 — 숨 돌리기. 아무것도 안 오는 자리라는 뜻이다. */
function drawBone(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  color: string,
): void {
  const u = size / 20;
  ctx.strokeStyle = color;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(1.4, u * 1.5);
  // 등뼈
  ctx.beginPath();
  ctx.moveTo(cx - u * 7, cy);
  ctx.lineTo(cx + u * 5.5, cy);
  ctx.stroke();
  // 갈비 셋
  for (const gx of [-3.6, -0.6, 2.4]) {
    ctx.beginPath();
    ctx.moveTo(cx + gx * u, cy - u * 3.4);
    ctx.lineTo(cx + gx * u, cy + u * 3.4);
    ctx.stroke();
  }
  // 꼬리
  ctx.beginPath();
  ctx.moveTo(cx + u * 5.5, cy);
  ctx.lineTo(cx + u * 8.2, cy - u * 3.4);
  ctx.moveTo(cx + u * 5.5, cy);
  ctx.lineTo(cx + u * 8.2, cy + u * 3.4);
  ctx.stroke();
  // 머리
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx - u * 7.6, cy, u * 1.5, 0, Math.PI * 2);
  ctx.fill();
}

/** 왕관 — 보스. 발바닥 위에 얹힌다. */
function drawCrown(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  color: string,
): void {
  const u = size / 20;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(cx - u * 6, cy + u * 2.6);
  ctx.lineTo(cx - u * 7, cy - u * 3.4);
  ctx.lineTo(cx - u * 3, cy + u * 0.2);
  ctx.lineTo(cx, cy - u * 4.6);
  ctx.lineTo(cx + u * 3, cy + u * 0.2);
  ctx.lineTo(cx + u * 7, cy - u * 3.4);
  ctx.lineTo(cx + u * 6, cy + u * 2.6);
  ctx.closePath();
  ctx.fill();
}

/**
 * 지도 칸 아이콘.
 *
 * **발바닥 하나로 위계를 만든다.** 길목은 맨발바닥, 텃세는 발톱을 세운 같은
 * 발바닥, 보스는 왕관을 얹은 발바닥. 색이나 글자를 안 읽어도 **형태만으로**
 * 어디가 험한지 알 수 있다 — 지도를 훑는 3초 동안 필요한 건 그것뿐이다.
 *
 * 쉼터만 계열 밖의 생선뼈다. 싸우지 않는 유일한 칸이라 **다른 종류의 일**이고,
 * 그것이 형태에서도 갈려야 한다.
 *
 * 예전에는 세로선 셋(전투)·눈(쉼터)·별(정예)이었다. 셋이 서로 무관한 기호라
 * 무엇이 더 센지 형태로 알 수 없었고, 세로선 셋은 아예 뜻이 없었다.
 */
export function drawNodeIcon(
  ctx: CanvasRenderingContext2D,
  kind: "battle" | "elite" | "shop" | "boss",
  cx: number,
  cy: number,
  size: number,
  color: string,
): void {
  if (kind === "shop") drawBone(ctx, cx, cy, size, color);
  else if (kind === "boss") {
    drawPaw(ctx, cx, cy + size * 0.1, size * 0.82, color, true);
    drawCrown(ctx, cx, cy - size * 0.42, size * 0.72, color);
  } else drawPaw(ctx, cx, cy, size, color, kind === "elite");
}
