import assert from "node:assert/strict";
import { BoundedLru } from "../src/game/lru.ts";
import { fxBufferDimensions } from "../src/game/render.ts";

const cache = new BoundedLru({
  maxEntries: 3,
  maxWeight: 6,
  weight: (value) => value.weight,
});
assert.equal(cache.set("a", { weight: 2 }), true);
assert.equal(cache.set("b", { weight: 2 }), true);
assert.equal(cache.set("c", { weight: 2 }), true);
assert.equal(cache.get("a")?.weight, 2, "get은 a를 최근 사용 항목으로 올려야 한다");
assert.equal(cache.set("d", { weight: 2 }), true);
assert.deepEqual([...cache.keys()], ["c", "a", "d"], "최근 사용한 a 대신 가장 오래된 b를 축출해야 한다");
assert.equal(cache.has("a"), true);
assert.equal(cache.has("b"), false);
assert.equal(cache.size, 3);
assert.equal(cache.weight, 6);
assert.equal(cache.set("oversized", { weight: 7 }), false, "단일 상한 초과 항목을 보관하면 안 된다");
assert.deepEqual([...cache.keys()], ["c", "a", "d"], "거절된 항목이 기존 LRU 순서를 바꾸면 안 된다");
assert.equal(cache.set("a", { weight: 3 }), true);
assert.deepEqual([...cache.keys()], ["d", "a"], "가중치 교체 시에도 오래된 항목부터 축출해야 한다");
assert.equal(cache.weight, 5);

const ordinary = fxBufferDimensions(1280, 800);
assert.deepEqual(
  { width: ordinary.width, height: ordinary.height, pixels: ordinary.pixels },
  { width: 427, height: 267, pixels: 114_009 },
  "일반 viewport의 기존 1/3 FX 해상도를 보존해야 한다",
);
assert.equal(ordinary.scaleX, 1 / 3);
assert.equal(ordinary.scaleY, 1 / 3);
for (const [width, height] of [[5120, 2880], [7680, 4320]]) {
  const dimensions = fxBufferDimensions(width, height);
  assert.ok(dimensions.pixels <= 1_000_000, `${width}x${height} FX 버퍼가 100만 픽셀을 넘었습니다`);
  assert.ok(dimensions.width >= 8 && dimensions.height >= 8);
  assert.ok(dimensions.scaleX > 0 && dimensions.scaleY > 0);
  const sourceRatio = width / height;
  const bufferRatio = dimensions.width / dimensions.height;
  assert.ok(
    Math.abs(bufferRatio - sourceRatio) / sourceRatio < 0.005,
    `${width}x${height} FX 버퍼 비율이 0.5% 넘게 왜곡됐습니다`,
  );
}
assert.throws(() => fxBufferDimensions(0, 800), RangeError);
assert.throws(() => fxBufferDimensions(800, Number.NaN), RangeError);

console.log("render cache tests passed — true LRU · weighted cap · 5K/8K FX budget");
