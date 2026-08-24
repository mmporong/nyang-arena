import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { SPRITE_ATLASES, SPRITE_CROP, SPRITE_SOURCE_SIZE } from "../src/game/sprite-atlas.ts";
import {
  buildAtlas,
  decodePng,
  encodePng,
  generateAtlases,
  MAX_PNG_DIMENSION,
  pngChunk,
  validateSourcePng,
} from "./sprite-atlas.mjs";

const SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex");

function predictor(type, left, up, upLeft) {
  if (type === 0) return 0;
  if (type === 1) return left;
  if (type === 2) return up;
  if (type === 3) return Math.floor((left + up) / 2);
  const estimate = left + up - upLeft;
  const dl = Math.abs(estimate - left);
  const du = Math.abs(estimate - up);
  const dul = Math.abs(estimate - upLeft);
  return dl <= du && dl <= dul ? left : du <= dul ? up : upLeft;
}

function pngWithFilter(width, height, rgba, filterType) {
  const stride = width * 4;
  const filtered = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (stride + 1);
    filtered[rowOffset] = filterType;
    for (let x = 0; x < stride; x += 1) {
      const current = rgba[y * stride + x];
      const left = x >= 4 ? rgba[y * stride + x - 4] : 0;
      const up = y > 0 ? rgba[(y - 1) * stride + x] : 0;
      const upLeft = y > 0 && x >= 4 ? rgba[(y - 1) * stride + x - 4] : 0;
      filtered[rowOffset + 1 + x] = (current - predictor(filterType, left, up, upLeft)) & 0xff;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([SIGNATURE, pngChunk("IHDR", ihdr), pngChunk("IDAT", deflateSync(filtered)), pngChunk("IEND")]);
}

const tiny = Buffer.from(Array.from({ length: 4 * 3 * 4 }, (_, index) => (index * 47 + 13) & 0xff));
for (let filter = 0; filter <= 4; filter += 1) {
  assert.deepEqual(decodePng(pngWithFilter(4, 3, tiny, filter), `filter${filter}`).data, tiny, `filter ${filter}`);
}

const deterministicA = encodePng({ width: 4, height: 3, data: tiny });
const deterministicB = encodePng({ width: 4, height: 3, data: tiny });
assert.deepEqual(deterministicA, deterministicB, "adaptive encode는 결정적이어야 한다");

const badSignature = Buffer.from(deterministicA);
badSignature[0] ^= 0xff;
assert.throws(() => decodePng(badSignature), /signature/u);
const badCrc = Buffer.from(deterministicA);
badCrc[29] ^= 0x01;
assert.throws(() => decodePng(badCrc), /CRC/u);
assert.throws(() => decodePng(deterministicA.subarray(0, deterministicA.length - 3)), /잘림|누락/u);

function hostilePng(width, height, filtered) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([SIGNATURE, pngChunk("IHDR", ihdr), pngChunk("IDAT", deflateSync(filtered)), pngChunk("IEND")]);
}

assert.throws(
  () => decodePng(hostilePng(MAX_PNG_DIMENSION + 1, 1, Buffer.alloc(0)), "oversized"),
  /dimension 상한/u,
);
assert.throws(
  () => decodePng(hostilePng(1, 1, Buffer.alloc(6)), "inflate-bomb"),
  /inflate 실패/u,
  "예상 decoded 길이를 넘는 inflate 출력을 제한해야 한다",
);
assert.throws(
  () => encodePng({ width: MAX_PNG_DIMENSION + 1, height: 1, data: Buffer.alloc(0) }),
  /dimension 상한/u,
);

function sourceFixture(left = SPRITE_CROP.x) {
  const data = Buffer.alloc(SPRITE_SOURCE_SIZE * SPRITE_SOURCE_SIZE * 4);
  for (let y = SPRITE_CROP.y; y < SPRITE_CROP.y + SPRITE_CROP.h; y += 1) {
    for (let x = left; x < SPRITE_CROP.x + SPRITE_CROP.w; x += 1) {
      const offset = (y * SPRITE_SOURCE_SIZE + x) * 4;
      data.set([(x * 3) & 0xff, (y * 5) & 0xff, (x + y) & 0xff, 255], offset);
    }
  }
  return encodePng({ width: SPRITE_SOURCE_SIZE, height: SPRITE_SOURCE_SIZE, data });
}

const validSource = sourceFixture();
validateSourcePng(validSource, "valid.png");
assert.throws(() => validateSourcePng(sourceFixture(3), "bbox.png"), /alpha bbox/u);

const base = SPRITE_ATLASES[0];
const built = await buildAtlas(base, async () => validSource);
assert.equal(built.frames, 120);
assert.equal(built.width, 1152);
assert.equal(built.height, 3840);
assert.ok(built.data.some((byte) => byte !== 0), "atlas 셀이 비면 안 된다");
await assert.rejects(
  buildAtlas(base, async (name) => {
    if (name === "20_run.png") throw new Error("missing source");
    return validSource;
  }),
  /20_run\.png 처리 실패/u,
);
await assert.rejects(
  buildAtlas(base, async (name) => (name === "03_wink.png" ? sourceFixture(3) : validSource)),
  /03_wink\.png 처리 실패/u,
);

{
  const writes = [];
  await assert.rejects(
    generateAtlases({
      write: true,
      outputDir: "virtual-output",
      readSource: async (name) => {
        if (name === "21_idle.png") throw new Error("second atlas source missing");
        return validSource;
      },
      writeOutput: async (...args) => writes.push(args),
    }),
    /21_idle\.png 처리 실패/u,
  );
  assert.equal(writes.length, 0, "두 atlas 메모리 생성 전 기존 산출물을 쓰면 안 된다");
}

console.log("sprite atlas hostile PASS — filters0..4 · CRC/truncation/bounds/inflate cap · atomic pair · deterministic encode");
