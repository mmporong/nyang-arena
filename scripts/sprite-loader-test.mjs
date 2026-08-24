import assert from "node:assert/strict";
import { spriteDrawRect, spriteFrameRect } from "../src/game/sprite-atlas.ts";
import { createSpriteLoader } from "../src/game/sprites.ts";

function fakeEnvironment() {
  const images = [];
  const timers = new Map();
  let timerId = 0;
  return {
    images,
    timers,
    options: {
      timeoutMs: 25,
      warn: () => undefined,
      createImage: () => {
        const image = { src: "", naturalWidth: 0, naturalHeight: 0, complete: false, onload: null, onerror: null };
        images.push(image);
        return image;
      },
      setTimer: (callback) => {
        timerId += 1;
        timers.set(timerId, callback);
        return timerId;
      },
      clearTimer: (id) => timers.delete(id),
    },
  };
}

function succeed(image, width, height) {
  image.naturalWidth = width;
  image.naturalHeight = height;
  image.complete = true;
  image.onload();
}

{
  const env = fakeEnvironment();
  const loader = createSpriteLoader(env.options);
  const first = loader.load();
  const second = loader.load();
  assert.equal(first, second, "여러 load 호출은 같은 singleton job이어야 한다");
  assert.equal(env.images.length, 2, "Image singleton은 atlas당 하나여야 한다");
  assert.deepEqual(env.images.map((image) => image.src), [
    "/sprites/atlas-base.png",
    "/sprites/atlas-extra.png",
  ]);
  assert.equal(loader.status().state, "loading");
  succeed(env.images[0], 1152, 3840);
  succeed(env.images[1], 1152, 2112);
  await first;
  const readyStatus = loader.status();
  assert.ok(Object.isFrozen(readyStatus) && Object.isFrozen(readyStatus.readyAtlases), "status snapshot은 읽기 전용이어야 한다");
  assert.deepEqual(readyStatus, {
    state: "ready",
    settled: true,
    requestedAtlases: 2,
    readyAtlases: ["base", "extra"],
    failedAtlases: [],
    timedOutAtlases: [],
    frameDescriptors: 186,
    fallbackFrames: 0,
  });
  const stableFrame = loader.frameFor(31, "run");
  assert.equal(stableFrame?.image, env.images[1]);
  assert.equal(loader.frameFor(31, "run"), stableFrame, "같은 key는 동일 descriptor 객체를 반환해야 한다");
  assert.ok(Object.isFrozen(stableFrame), "frame descriptor는 읽기 전용이어야 한다");
  await loader.load();
  assert.equal(env.images.length, 2, "settled 뒤에도 새 요청을 만들면 안 된다");
}

{
  const env = fakeEnvironment();
  const loader = createSpriteLoader(env.options);
  const job = loader.load();
  succeed(env.images[0], 1152, 3840);
  env.images[1].onerror();
  await job;
  assert.equal(env.images[0].onload, null);
  assert.equal(env.images[0].onerror, null);
  assert.equal(env.images[1].onload, null);
  assert.equal(env.images[1].onerror, null);
  assert.equal(loader.status().state, "degraded");
  assert.equal(loader.status().frameDescriptors, 120);
  assert.equal(loader.status().fallbackFrames, 66);
  assert.equal(loader.frameFor(21, "idle"), null);
  assert.ok(loader.frameFor(20, "run"));
}

{
  const images = [];
  const cleared = [];
  const loader = createSpriteLoader({
    timeoutMs: 1,
    warn: () => undefined,
    createImage: () => {
      const image = { src: "", naturalWidth: 0, naturalHeight: 0, onload: null, onerror: null };
      images.push(image);
      return image;
    },
    setTimer: (callback) => {
      callback();
      return 77;
    },
    clearTimer: (timer) => cleared.push(timer),
  });
  await loader.load();
  assert.equal(loader.status().state, "timed-out", "동기 timeout도 TDZ 없이 종료해야 한다");
  assert.deepEqual(images.map((image) => image.src), ["", ""], "동기 종료 뒤 네트워크 요청을 만들면 안 된다");
  assert.ok(images.every((image) => image.onload === null && image.onerror === null), "동기 종료 뒤 handler가 남으면 안 된다");
  assert.deepEqual(cleared, [77, 77]);
}

{
  const env = fakeEnvironment();
  const loader = createSpriteLoader(env.options);
  const job = loader.load();
  succeed(env.images[0], 1151, 3840);
  succeed(env.images[1], 1152, 2112);
  await job;
  assert.equal(loader.status().state, "degraded");
  assert.deepEqual(loader.status().failedAtlases, ["base"]);
  assert.equal(loader.status().frameDescriptors, 66);
}

{
  const env = fakeEnvironment();
  const loader = createSpriteLoader(env.options);
  const job = loader.load();
  const lateLoad = env.images[0].onload;
  const timeout = [...env.timers.values()][0];
  timeout();
  succeed(env.images[1], 1152, 2112);
  await job;
  assert.equal(loader.status().state, "timed-out");
  assert.deepEqual(loader.status().timedOutAtlases, ["base"]);
  env.images[0].naturalWidth = 1152;
  env.images[0].naturalHeight = 3840;
  lateLoad();
  assert.equal(loader.status().state, "timed-out", "timeout 뒤 late load는 무시해야 한다");
  assert.equal(loader.status().frameDescriptors, 66);
}

assert.deepEqual(spriteFrameRect(1, "idle"), { atlas: "base", sx: 0, sy: 0, sw: 192, sh: 192 });
assert.deepEqual(spriteFrameRect(20, "run"), { atlas: "base", sx: 960, sy: 3648, sw: 192, sh: 192 });
assert.deepEqual(spriteFrameRect(21, "idle"), { atlas: "extra", sx: 0, sy: 0, sw: 192, sh: 192 });
assert.deepEqual(spriteFrameRect(31, "run"), { atlas: "extra", sx: 960, sy: 1920, sw: 192, sh: 192 });
assert.equal(spriteFrameRect(0, "idle"), null);
assert.deepEqual(spriteDrawRect(10, 20, 197), { dx: 12, dy: 22, dw: 192, dh: 192 });

console.log("sprite loader hostile PASS — singleton/error/timeout(sync 포함)/late-load/handler cleanup/wrong-size/mapping/draw rect");
