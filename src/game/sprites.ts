import { BREEDS, NIGHTMARE_BREEDS } from "./breeds.ts";
import { BOSS_BREEDS, SNIPER_BREED } from "./bosses.ts";
import type { Pose } from "./types.ts";

const POSES: Pose[] = ["idle", "sleep", "wink", "move", "back", "run"];

const cache = new Map<string, HTMLImageElement>();

function key(breedId: number, pose: Pose): string {
  return `${String(breedId).padStart(2, "0")}_${pose}`;
}

function url(k: string): string {
  // BASE_URL은 dev에서 "/", 빌드에서 "/nyang-arena/"가 된다.
  return `${import.meta.env.BASE_URL}sprites/${k}.png`;
}

export function spriteFor(breedId: number, pose: Pose): HTMLImageElement | null {
  const img = cache.get(key(breedId, pose));
  return img && img.complete && img.naturalWidth > 0 ? img : null;
}

/** 우리 8종 + 악몽 8종 + 보스. 전부 로드될 때까지 기다렸다가 게임을 시작한다. */
export async function loadSprites(): Promise<void> {
  const jobs: Promise<void>[] = [];

  for (const breed of [...BREEDS, ...NIGHTMARE_BREEDS, ...BOSS_BREEDS, SNIPER_BREED]) {
    for (const pose of POSES) {
      const k = key(breed.id, pose);
      const img = new Image();
      cache.set(k, img);
      jobs.push(
        new Promise<void>((resolve) => {
          img.onload = () => resolve();
          // 한 장 실패해도 게임은 떠야 한다. 렌더러가 폴백 도형을 그린다.
          img.onerror = () => {
            console.warn(`스프라이트 로드 실패: ${k}`);
            resolve();
          };
          img.src = url(k);
        }),
      );
    }
  }

  await Promise.all(jobs);
}
