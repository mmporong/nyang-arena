import {
  SPRITE_ATLASES,
  SPRITE_POSES,
  type SpriteAtlasKey,
  type SpriteFrameRect,
  spriteFrameRect,
} from "./sprite-atlas.ts";
import type { Pose } from "./types.ts";

export interface SpriteFrame extends SpriteFrameRect {
  image: HTMLImageElement;
}

export interface SpriteStatusSnapshot {
  state: "idle" | "loading" | "ready" | "degraded" | "timed-out";
  settled: boolean;
  requestedAtlases: number;
  readyAtlases: readonly SpriteAtlasKey[];
  failedAtlases: readonly SpriteAtlasKey[];
  timedOutAtlases: readonly SpriteAtlasKey[];
  frameDescriptors: number;
  fallbackFrames: number;
}

export interface SpriteLoaderOptions {
  timeoutMs?: number;
  createImage?: () => HTMLImageElement;
  setTimer?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
  warn?: (message: string) => void;
}

type AtlasLoadState = "idle" | "loading" | "ready" | "failed" | "timed-out";
const BASE_URL = import.meta.env?.BASE_URL ?? "/";

interface AtlasRecord {
  image: HTMLImageElement | null;
  state: AtlasLoadState;
}

export function createSpriteLoader(options: SpriteLoaderOptions = {}) {
  const timeoutMs = options.timeoutMs ?? 8_000;
  const createImage = options.createImage ?? (() => new Image());
  const setTimer = options.setTimer ?? ((callback, delay) => setTimeout(callback, delay));
  const clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer));
  const warn = options.warn ?? ((message) => console.warn(message));
  const records = new Map<SpriteAtlasKey, AtlasRecord>(
    SPRITE_ATLASES.map((atlas) => [atlas.key, { image: null, state: "idle" }]),
  );
  const frameCache: (SpriteFrame | undefined)[][] = Array.from({ length: 32 }, () => []);
  let loadPromise: Promise<void> | null = null;

  function cacheAtlasFrames(atlas: (typeof SPRITE_ATLASES)[number], image: HTMLImageElement): void {
    for (let id = atlas.firstId; id <= atlas.lastId; id += 1) {
      for (let poseIndex = 0; poseIndex < SPRITE_POSES.length; poseIndex += 1) {
        const rect = spriteFrameRect(id, SPRITE_POSES[poseIndex]!);
        if (rect) frameCache[id]![poseIndex] = Object.freeze({ image, ...rect });
      }
    }
  }

  function snapshot(): Readonly<SpriteStatusSnapshot> {
    const readyAtlases: SpriteAtlasKey[] = [];
    const failedAtlases: SpriteAtlasKey[] = [];
    const timedOutAtlases: SpriteAtlasKey[] = [];
    let loading = false;
    let requestedAtlases = 0;
    for (const atlas of SPRITE_ATLASES) {
      const state = records.get(atlas.key)!.state;
      if (state !== "idle") requestedAtlases += 1;
      if (state === "ready") readyAtlases.push(atlas.key);
      else if (state === "failed") failedAtlases.push(atlas.key);
      else if (state === "timed-out") timedOutAtlases.push(atlas.key);
      else if (state === "loading") loading = true;
    }
    const settled = requestedAtlases === SPRITE_ATLASES.length && !loading;
    const frameDescriptors = SPRITE_ATLASES
      .filter((atlas) => readyAtlases.includes(atlas.key))
      .reduce((sum, atlas) => sum + (atlas.lastId - atlas.firstId + 1) * SPRITE_POSES.length, 0);
    const state = requestedAtlases === 0 ? "idle"
      : !settled ? "loading"
        : timedOutAtlases.length > 0 ? "timed-out"
          : failedAtlases.length > 0 ? "degraded"
            : "ready";
    return Object.freeze({
      state,
      settled,
      requestedAtlases,
      readyAtlases: Object.freeze(readyAtlases),
      failedAtlases: Object.freeze(failedAtlases),
      timedOutAtlases: Object.freeze(timedOutAtlases),
      frameDescriptors,
      fallbackFrames: 31 * SPRITE_POSES.length - frameDescriptors,
    });
  }

  function loadAtlas(atlas: (typeof SPRITE_ATLASES)[number]): Promise<void> {
    const record = records.get(atlas.key)!;
    const image = createImage();
    record.image = image;
    record.state = "loading";
    return new Promise((resolveLoad) => {
      let done = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const finish = (state: Exclude<AtlasLoadState, "idle" | "loading">, message?: string) => {
        if (done) return;
        done = true;
        if (timer !== null) clearTimer(timer);
        image.onload = null;
        image.onerror = null;
        record.state = state;
        if (state === "ready") cacheAtlasFrames(atlas, image);
        if (message) warn(message);
        resolveLoad();
      };
      timer = setTimer(() => {
        finish("timed-out", `스프라이트 atlas 시간 초과: ${atlas.file}`);
      }, timeoutMs);
      // 테스트용 타이머가 동기 실행되어 이미 종료했다면 handler/src를 남기지 않는다.
      if (done) {
        if (timer !== null) clearTimer(timer);
        return;
      }
      image.onload = () => {
        if (image.naturalWidth !== atlas.width || image.naturalHeight !== atlas.height) {
          finish(
            "failed",
            `스프라이트 atlas 크기 불일치: ${atlas.file} (${image.naturalWidth}×${image.naturalHeight})`,
          );
          return;
        }
        finish("ready");
      };
      image.onerror = () => finish("failed", `스프라이트 atlas 로드 실패: ${atlas.file}`);
      // 두 분기를 literal로 고정해 정적 네트워크 gate도 허용 URL을 증명한다.
      if (atlas.key === "base") image.src = `${BASE_URL}sprites/atlas-base.png`;
      else image.src = `${BASE_URL}sprites/atlas-extra.png`;
    });
  }

  function load(): Promise<void> {
    if (!loadPromise) loadPromise = Promise.all(SPRITE_ATLASES.map(loadAtlas)).then(() => undefined);
    return loadPromise;
  }

  function frameFor(breedId: number, pose: Pose): SpriteFrame | null {
    const poseIndex = SPRITE_POSES.indexOf(pose);
    if (!Number.isInteger(breedId) || breedId < 1 || breedId >= frameCache.length || poseIndex < 0) return null;
    return frameCache[breedId]![poseIndex] ?? null;
  }

  return { load, frameFor, status: snapshot } as const;
}

const runtimeLoader = createSpriteLoader();

export function spriteFor(breedId: number, pose: Pose): SpriteFrame | null {
  return runtimeLoader.frameFor(breedId, pose);
}

export function loadSprites(): Promise<void> {
  return runtimeLoader.load();
}

export function spriteStatus(): Readonly<SpriteStatusSnapshot> {
  return runtimeLoader.status();
}
