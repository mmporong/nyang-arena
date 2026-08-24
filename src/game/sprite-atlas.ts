import type { Pose } from "./types.ts";

export const SPRITE_POSES = ["idle", "sleep", "wink", "move", "back", "run"] as const satisfies readonly Pose[];
export const SPRITE_SOURCE_SIZE = 197;
export const SPRITE_CROP = { x: 2, y: 2, w: 192, h: 192 } as const;
export const SPRITE_TOTAL_FRAMES = 31 * SPRITE_POSES.length;

export type SpriteAtlasKey = "base" | "extra";

export interface SpriteAtlasSpec {
  key: SpriteAtlasKey;
  file: string;
  firstId: number;
  lastId: number;
  width: number;
  height: number;
}

export const SPRITE_ATLASES = [
  { key: "base", file: "atlas-base.png", firstId: 1, lastId: 20, width: 1152, height: 3840 },
  { key: "extra", file: "atlas-extra.png", firstId: 21, lastId: 31, width: 1152, height: 2112 },
] as const satisfies readonly SpriteAtlasSpec[];

export interface SpriteFrameRect {
  atlas: SpriteAtlasKey;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

export interface SpriteDrawRect {
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

export function spriteSourceName(id: number, pose: Pose): string {
  return `${String(id).padStart(2, "0")}_${pose}.png`;
}

/** ID 행 × 포즈 열을 manifest 없이 계산한다. */
export function spriteFrameRect(id: number, pose: Pose): SpriteFrameRect | null {
  const atlas = SPRITE_ATLASES.find((candidate) => id >= candidate.firstId && id <= candidate.lastId);
  const poseIndex = SPRITE_POSES.indexOf(pose);
  if (!atlas || poseIndex < 0 || !Number.isInteger(id)) return null;
  return {
    atlas: atlas.key,
    sx: poseIndex * SPRITE_CROP.w,
    sy: (id - atlas.firstId) * SPRITE_CROP.h,
    sw: SPRITE_CROP.w,
    sh: SPRITE_CROP.h,
  };
}

/** 197px 원본에서 (2,2)-(194,194)만 잘라도 불투명 픽셀의 위치를 보존한다. */
export function spriteDrawRect(x: number, y: number, size: number): SpriteDrawRect {
  const scale = size / SPRITE_SOURCE_SIZE;
  return {
    dx: x + SPRITE_CROP.x * scale,
    dy: y + SPRITE_CROP.y * scale,
    dw: SPRITE_CROP.w * scale,
    dh: SPRITE_CROP.h * scale,
  };
}
