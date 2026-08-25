/** ImageGen으로 만든 로컬 픽셀 아트를 안전하게 그리는 공용 경계. */

const ATLAS_COLS = 4;
const ATLAS_ROWS = 4;

export type GeneratedAtlasId =
  | "generated-icon-atlas"
  | "generated-combat-atlas"
  | "generated-magic-atlas"
  | "generated-defense-atlas"
  | "generated-ui-atlas";

function loadedImage(id: string): HTMLImageElement | null {
  if (typeof document === "undefined") return null;
  const image = document.getElementById(id);
  return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0
    ? image
    : null;
}

/**
 * 4×4 생성 아틀라스의 한 칸을 그린다.
 *
 * @returns 아직 로드되지 않았으면 false. 호출부는 기존 Canvas 도형으로 폴백한다.
 */
export function drawGeneratedAtlasCellFrom(
  ctx: CanvasRenderingContext2D,
  atlasId: GeneratedAtlasId,
  index: number,
  cx: number,
  cy: number,
  size: number,
  alpha = 1,
  rotation = 0,
): boolean {
  const image = loadedImage(atlasId);
  if (!image || index < 0 || index >= ATLAS_COLS * ATLAS_ROWS || size <= 0) return false;
  const sw = image.naturalWidth / ATLAS_COLS;
  const sh = image.naturalHeight / ATLAS_ROWS;
  const col = index % ATLAS_COLS;
  const row = Math.floor(index / ATLAS_COLS);
  ctx.save();
  ctx.globalAlpha *= Math.max(0, Math.min(1, alpha));
  ctx.imageSmoothingEnabled = false;
  if (rotation !== 0) {
    ctx.translate(cx, cy);
    ctx.rotate(rotation);
    ctx.drawImage(image, col * sw, row * sh, sw, sh, -size / 2, -size / 2, size, size);
  } else {
    ctx.drawImage(image, col * sw, row * sh, sw, sh, cx - size / 2, cy - size / 2, size, size);
  }
  ctx.restore();
  return true;
}

/** 기존 장식 아틀라스 호출부의 호환 경계. */
export function drawGeneratedAtlasCell(
  ctx: CanvasRenderingContext2D,
  index: number,
  cx: number,
  cy: number,
  size: number,
  alpha = 1,
  rotation = 0,
): boolean {
  return drawGeneratedAtlasCellFrom(ctx, "generated-icon-atlas", index, cx, cy, size, alpha, rotation);
}

/** 화면 비율을 유지하며 생성 배경을 cover 방식으로 합성한다. */
export function drawGeneratedBackground(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  alpha: number,
): boolean {
  const image = loadedImage("dreamscape-bg");
  if (!image || w <= 0 || h <= 0) return false;
  const scale = Math.max(w / image.naturalWidth, h / image.naturalHeight);
  const sw = w / scale;
  const sh = h / scale;
  const sx = (image.naturalWidth - sw) / 2;
  const sy = (image.naturalHeight - sh) / 2;
  ctx.save();
  // 배경은 호출 전에 남은 알파와 곱하지 않는다. 반투명 절차 씬의 알파가 새
  // 이미지까지 먹으면 두 배경이 겹쳐 달이 두 개 보인다.
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image, sx, sy, sw, sh, 0, 0, w, h);
  ctx.restore();
  return true;
}
