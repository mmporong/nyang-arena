/**
 * 아이콘.
 *
 * 모든 픽토그램을 Canvas 2D 패스로 그린다. 이미지 요청, 아이콘 폰트, 원격 SVG가
 * 없어서 로딩 실패와 외부 에셋 권리 문제 없이 같은 의미를 독립적인 실루엣으로
 * 새로 표현한다.
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
/* 픽토그램 (Canvas 2D 자체 경로)                                      */
/* ------------------------------------------------------------------ */

export const ICON_NAMES = [
  "fish",
  "cls-warrior",
  "cls-rogue",
  "cls-archer",
  "cls-mage",
  "cls-summoner",
  "relic-iron_collar",
  "relic-shadow_claw",
  "relic-hawk_eye",
  "relic-stardust_rod",
  "relic-lone_hunter",
  "relic-the_swarm",
  "relic-crown",
  "relic-rainbow_bell",
  "relic-mirror_charm",
  "relic-kitten_basket",
  "relic-hollow_bell",
] as const;

export type IconName = (typeof ICON_NAMES)[number];

/** 기존 부팅 계약을 유지하되 Canvas 경로만 쓰므로 파일 요청 없이 즉시 끝난다. */
export function loadIcons(): Promise<void> {
  return Promise.resolve();
}

type IconDrawer = (
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  color: string,
) => void;

/** 생선 경로. drawIcon과 drawFish가 함께 써도 재귀하지 않는다. */
function drawFishPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, color: string): void {
  const w = size * 0.5;
  const h = size * 0.3;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(cx + size * 0.08, cy, w * 0.78, h, 0, 0, Math.PI * 2);
  ctx.fill();
  const tailX = cx + size * 0.08 - w * 0.72;
  ctx.beginPath();
  ctx.moveTo(tailX, cy);
  ctx.lineTo(tailX - size * 0.22, cy - h * 0.9);
  ctx.lineTo(tailX - size * 0.22, cy + h * 0.9);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#17110E";
  ctx.beginPath();
  ctx.arc(cx + size * 0.28, cy - h * 0.22, Math.max(0.8, size * 0.055), 0, Math.PI * 2);
  ctx.fill();
}

/** 전사 — 닫힌 방패와 비스듬한 검. */
function drawWarriorIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, color: string): void {
  const u = size / 20;
  stroke(ctx, size, color, 0.1);
  ctx.beginPath();
  ctx.moveTo(cx - u * 6.5, cy - u * 6);
  ctx.lineTo(cx, cy - u * 8);
  ctx.lineTo(cx + u * 6.5, cy - u * 6);
  ctx.lineTo(cx + u * 5.2, cy + u * 2.5);
  ctx.quadraticCurveTo(cx, cy + u * 8.5, cx - u * 5.2, cy + u * 2.5);
  ctx.closePath();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - u * 3.8, cy + u * 5.5);
  ctx.lineTo(cx + u * 6.5, cy - u * 5.5);
  ctx.moveTo(cx + u * 2.5, cy - u * 5.4);
  ctx.lineTo(cx + u * 6.6, cy - u * 1.4);
  ctx.stroke();
}

/** 도적 — 가드가 선명한 단일 대각 단검. */
function drawRogueIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, color: string): void {
  const u = size / 20;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(cx - u * 7.5, cy + u * 7.5);
  ctx.lineTo(cx + u * 6.8, cy - u * 7.7);
  ctx.lineTo(cx + u * 3.7, cy + u * 1.1);
  ctx.closePath();
  ctx.fill();
  stroke(ctx, size, color, 0.13);
  ctx.beginPath();
  ctx.moveTo(cx - u * 5, cy + u * 1.2);
  ctx.lineTo(cx + u * 0.2, cy + u * 6);
  ctx.stroke();
}

/** 궁수 — 열린 활, 시위, 한 발의 화살. */
function drawArcherIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, color: string): void {
  const u = size / 20;
  stroke(ctx, size, color, 0.1);
  ctx.beginPath();
  ctx.arc(cx - u * 1.5, cy, u * 7, -Math.PI * 0.52, Math.PI * 0.52);
  ctx.moveTo(cx - u * 1.9, cy - u * 7);
  ctx.lineTo(cx + u * 2.2, cy);
  ctx.lineTo(cx - u * 1.9, cy + u * 7);
  ctx.moveTo(cx - u * 6.5, cy);
  ctx.lineTo(cx + u * 7.5, cy);
  ctx.moveTo(cx + u * 7.5, cy);
  ctx.lineTo(cx + u * 4.7, cy - u * 2.2);
  ctx.moveTo(cx + u * 7.5, cy);
  ctx.lineTo(cx + u * 4.7, cy + u * 2.2);
  ctx.stroke();
}

/** 마법사 — 뾰족 모자 아래 오브와 광점. */
function drawMageIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, color: string): void {
  const u = size / 20;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(cx - u * 6.5, cy + u * 2);
  ctx.lineTo(cx + u * 1.5, cy - u * 8);
  ctx.lineTo(cx + u * 4.5, cy + u * 2);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx - u * 1, cy + u * 3, u * 7, u * 1.6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx + u * 5.5, cy - u * 4.5, u * 1.6, 0, Math.PI * 2);
  ctx.fill();
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
}

/** 무쇠 목줄 — 위가 열린 굵은 U자 링과 잠금쇠. */
function drawIronCollarIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, color: string): void {
  const u = size / 20;
  stroke(ctx, size, color, 0.2);
  ctx.beginPath();
  ctx.arc(cx, cy - u * 1.2, u * 6.5, 0, Math.PI);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fillRect(cx - u * 2.2, cy + u * 3.6, u * 4.4, u * 4.2);
}

/** 그림자 발톱 — 발바닥과 세 개의 평행 발톱. */
function drawShadowClawIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, color: string): void {
  const u = size / 20;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(cx - u * 3.5, cy + u * 4.2, u * 3.8, u * 3, -0.35, 0, Math.PI * 2);
  ctx.fill();
  stroke(ctx, size, color, 0.14);
  ctx.beginPath();
  ctx.moveTo(cx - u * 2.2, cy + u * 0.8);
  ctx.lineTo(cx + u * 4.8, cy - u * 6.2);
  ctx.moveTo(cx + u * 0.6, cy + u * 2.8);
  ctx.lineTo(cx + u * 7.1, cy - u * 3.7);
  ctx.moveTo(cx + u * 2.8, cy + u * 5.2);
  ctx.lineTo(cx + u * 8, cy);
  ctx.stroke();
}

/** 매의 눈 — 닫힌 눈 윤곽과 큰 동공. */
function drawHawkEyeIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, color: string): void {
  const u = size / 20;
  stroke(ctx, size, color, 0.11);
  ctx.beginPath();
  ctx.moveTo(cx - u * 8, cy);
  ctx.quadraticCurveTo(cx, cy - u * 7, cx + u * 8, cy);
  ctx.quadraticCurveTo(cx, cy + u * 7, cx - u * 8, cy);
  ctx.closePath();
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, u * 2.8, 0, Math.PI * 2);
  ctx.fill();
}

function drawStarPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number): void {
  ctx.moveTo(cx, cy - radius);
  ctx.lineTo(cx + radius * 0.28, cy - radius * 0.28);
  ctx.lineTo(cx + radius, cy);
  ctx.lineTo(cx + radius * 0.28, cy + radius * 0.28);
  ctx.lineTo(cx, cy + radius);
  ctx.lineTo(cx - radius * 0.28, cy + radius * 0.28);
  ctx.lineTo(cx - radius, cy);
  ctx.lineTo(cx - radius * 0.28, cy - radius * 0.28);
  ctx.closePath();
}

/** 별가루 지팡이 — 대각 봉과 끝의 별. */
function drawStardustRodIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, color: string): void {
  const u = size / 20;
  stroke(ctx, size, color, 0.15);
  ctx.beginPath();
  ctx.moveTo(cx - u * 6.5, cy + u * 7.5);
  ctx.lineTo(cx + u * 3.2, cy - u * 3.2);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  drawStarPath(ctx, cx + u * 4.5, cy - u * 4.8, u * 4.2);
  ctx.fill();
}

function drawCatToken(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, color: string): void {
  const u = size / 20;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(cx - u * 4.5, cy - u * 1.2);
  ctx.lineTo(cx - u * 3.6, cy - u * 6.2);
  ctx.lineTo(cx - u * 0.8, cy - u * 3.9);
  ctx.lineTo(cx + u * 3.6, cy - u * 6.2);
  ctx.lineTo(cx + u * 4.5, cy - u * 1.2);
  ctx.quadraticCurveTo(cx, cy + u * 3.4, cx - u * 4.5, cy - u * 1.2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx, cy + u * 5, u * 5.7, u * 3.5, 0, 0, Math.PI * 2);
  ctx.fill();
}

/** 외로운 사냥꾼 — 단일 머리와 몸. */
function drawLoneHunterIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, color: string): void {
  drawCatToken(ctx, cx, cy, size, color);
}

/** 무리 — 고리 없이 붙어 있는 세 머리와 몸. */
function drawSwarmIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, color: string): void {
  drawCatToken(ctx, cx, cy - size * 0.12, size * 0.58, color);
  drawCatToken(ctx, cx - size * 0.27, cy + size * 0.2, size * 0.48, color);
  drawCatToken(ctx, cx + size * 0.27, cy + size * 0.2, size * 0.48, color);
}

/** 왕관 유물 — 지도 보스 왕관과 같은 문법. */
function drawRelicCrownIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, color: string): void {
  drawCrown(ctx, cx, cy, size, color);
}

/** 무지개 방울 — 채운 종 위의 중첩 아치. */
function drawRainbowBellIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, color: string): void {
  const u = size / 20;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(cx - u * 5.5, cy + u * 6.5);
  ctx.quadraticCurveTo(cx - u * 4.2, cy + u * 2, cx - u * 4.2, cy - u * 1.2);
  ctx.quadraticCurveTo(cx - u * 4.2, cy - u * 5.2, cx, cy - u * 5.2);
  ctx.quadraticCurveTo(cx + u * 4.2, cy - u * 5.2, cx + u * 4.2, cy - u * 1.2);
  ctx.quadraticCurveTo(cx + u * 4.2, cy + u * 2, cx + u * 5.5, cy + u * 6.5);
  ctx.closePath();
  ctx.fill();
  stroke(ctx, size, color, 0.09);
  ctx.beginPath();
  ctx.arc(cx, cy - u * 2, u * 7.5, Math.PI * 1.08, Math.PI * 1.92);
  ctx.moveTo(cx - u * 5.6, cy - u * 2.8);
  ctx.arc(cx, cy - u * 2.8, u * 5.6, Math.PI, Math.PI * 2);
  ctx.stroke();
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
}

const ICON_DRAWERS = {
  fish: drawFishPath,
  "cls-warrior": drawWarriorIcon,
  "cls-rogue": drawRogueIcon,
  "cls-archer": drawArcherIcon,
  "cls-mage": drawMageIcon,
  "cls-summoner": drawSummonerIcon,
  "relic-iron_collar": drawIronCollarIcon,
  "relic-shadow_claw": drawShadowClawIcon,
  "relic-hawk_eye": drawHawkEyeIcon,
  "relic-stardust_rod": drawStardustRodIcon,
  "relic-lone_hunter": drawLoneHunterIcon,
  "relic-the_swarm": drawSwarmIcon,
  "relic-crown": drawRelicCrownIcon,
  "relic-rainbow_bell": drawRainbowBellIcon,
  "relic-mirror_charm": drawMirrorIcon,
  "relic-kitten_basket": drawKittenBasketIcon,
  "relic-hollow_bell": drawHollowBellIcon,
} satisfies Record<IconName, IconDrawer>;

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
  if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(size) || size <= 0) return false;
  const drawer = ICON_DRAWERS[name as keyof typeof ICON_DRAWERS];
  if (!drawer) return false;

  ctx.save();
  try {
    drawer(ctx, cx, cy, size, color);
  } finally {
    ctx.restore();
  }
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
  ctx.save();
  drawFishPath(ctx, cx, cy, size, color);
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
    ctx.beginPath();
    ctx.arc(cx + u * 0.14, cy, u * 0.42, -Math.PI / 3, Math.PI / 3);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx + u * 0.14, cy, u * 0.72, -Math.PI / 3, Math.PI / 3);
    ctx.stroke();
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
function drawPawToe(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  u: number,
  tx: number,
  ty: number,
  tr: number,
): void {
  ctx.beginPath();
  ctx.ellipse(cx + tx * u, cy + ty * u, tr * u, tr * 1.15 * u, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawPawClaw(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  u: number,
  tx: number,
  ty: number,
  tr: number,
): void {
  const x = cx + tx * u;
  const y = cy + ty * u - tr * 1.15 * u;
  ctx.beginPath();
  ctx.moveTo(x - tr * 0.5 * u, y + u * 0.4);
  ctx.lineTo(x, y - u * 3.4);
  ctx.lineTo(x + tr * 0.5 * u, y + u * 0.4);
  ctx.closePath();
  ctx.fill();
}

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
  drawPawToe(ctx, cx, cy, u, -6, -2.2, 2);
  drawPawToe(ctx, cx, cy, u, -2.2, -5.2, 2.2);
  drawPawToe(ctx, cx, cy, u, 2.2, -5.2, 2.2);
  drawPawToe(ctx, cx, cy, u, 6, -2.2, 2);
  if (!claws) return;
  // 발톱 — 발가락 위로 뻗는 삼각. 같은 기호의 위계를 형태로 만든다.
  drawPawClaw(ctx, cx, cy, u, -6, -2.2, 2);
  drawPawClaw(ctx, cx, cy, u, -2.2, -5.2, 2.2);
  drawPawClaw(ctx, cx, cy, u, 2.2, -5.2, 2.2);
  drawPawClaw(ctx, cx, cy, u, 6, -2.2, 2);
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
  // 갈비 셋. 프레임마다 임시 배열을 만들지 않도록 한 경로에 잇는다.
  ctx.beginPath();
  ctx.moveTo(cx - u * 3.6, cy - u * 3.4);
  ctx.lineTo(cx - u * 3.6, cy + u * 3.4);
  ctx.moveTo(cx - u * 0.6, cy - u * 3.4);
  ctx.lineTo(cx - u * 0.6, cy + u * 3.4);
  ctx.moveTo(cx + u * 2.4, cy - u * 3.4);
  ctx.lineTo(cx + u * 2.4, cy + u * 3.4);
  ctx.stroke();
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
