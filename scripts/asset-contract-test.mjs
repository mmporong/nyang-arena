import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { drawIcon, ICON_NAMES } from "../src/game/icons.ts";
import {
  SPRITE_ATLASES,
  SPRITE_CROP,
  SPRITE_POSES,
  SPRITE_SOURCE_SIZE,
  spriteFrameRect,
  spriteSourceName,
} from "../src/game/sprite-atlas.ts";
import { decodePng, validateSourcePng } from "./sprite-atlas.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ICON_DIR = join(ROOT, "public", "icons");
const BGM_DIR = join(ROOT, "public", "bgm");
const SPRITE_DIR = join(ROOT, "public", "sprites");
const SPRITE_SOURCE_DIR = join(ROOT, "assets", "sprites-src");
const ICON_SOURCE = join(ROOT, "src", "game", "icons.ts");

/** UI 아이콘은 공개 재배포 가능한 자체 Canvas 경로만 허용한다. */
const expectedIcons = [
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
].sort();
const actualIconFiles = existsSync(ICON_DIR) ? readdirSync(ICON_DIR).sort() : [];
assert.deepEqual(actualIconFiles, [], "public/icons에는 외부 아이콘 파일이 없어야 한다");

const source = readFileSync(ICON_SOURCE, "utf8");
assert.deepEqual(
  [...ICON_NAMES].sort(),
  expectedIcons,
  "Canvas 논리 아이콘 목록은 정확히 17종이어야 한다",
);

for (const forbidden of [
  [/(?<![A-Za-z])new\s+Image\s*\(/, "DOM Image"],
  [/createElement\s*\(\s*["']canvas["']\s*\)/, "임시 Canvas"],
  [/OffscreenCanvas/, "OffscreenCanvas"],
  [/drawImage\s*\(/, "bitmap drawImage"],
  [/source-in/, "bitmap tint 합성"],
  [/["'`]\/icons\//, "아이콘 URL"],
  [/(?<![A-Za-z])fetch\s*\(/, "네트워크 fetch"],
  [/XMLHttpRequest/, "XMLHttpRequest"],
]) {
  assert.doesNotMatch(source, forbidden[0], `icons.ts에는 ${forbidden[1]} 경로가 없어야 한다`);
}

class FakeCanvasContext {
  constructor(cx = 0, cy = 0, size = 0) {
    this.cx = cx;
    this.cy = cy;
    this.size = size;
    this.depth = 0;
    this.operations = 0;
    this.finiteNumbers = true;
    this.maxExtent = 0;
  }

  record(...args) {
    this.operations += 1;
    this.finiteNumbers &&= args.filter((value) => typeof value === "number").every(Number.isFinite);
  }

  recordPoint(x, y) {
    this.record(x, y);
    if (this.size <= 0) return;
    const half = this.size * 0.5;
    this.maxExtent = Math.max(this.maxExtent, Math.abs(x - this.cx) / half, Math.abs(y - this.cy) / half);
  }

  save() { this.depth += 1; this.record(); }
  restore() { this.depth -= 1; assert.ok(this.depth >= 0, "restore가 save보다 먼저 호출됐다"); this.record(); }
  beginPath() { this.record(); }
  closePath() { this.record(); }
  fill() { this.record(); }
  stroke() { this.record(); }
  arc(x, y, radius, ...args) {
    this.record(...args);
    this.recordPoint(x - radius, y - radius);
    this.recordPoint(x + radius, y + radius);
  }
  ellipse(x, y, radiusX, radiusY, rotation, ...args) {
    this.record(...args);
    const xRadius = Math.hypot(radiusX * Math.cos(rotation), radiusY * Math.sin(rotation));
    const yRadius = Math.hypot(radiusX * Math.sin(rotation), radiusY * Math.cos(rotation));
    this.recordPoint(x - xRadius, y - yRadius);
    this.recordPoint(x + xRadius, y + yRadius);
  }
  fillRect(x, y, width, height) { this.recordPoint(x, y); this.recordPoint(x + width, y + height); }
  lineTo(x, y) { this.recordPoint(x, y); }
  moveTo(x, y) { this.recordPoint(x, y); }
  quadraticCurveTo(controlX, controlY, x, y) {
    this.recordPoint(controlX, controlY);
    this.recordPoint(x, y);
  }
}

for (const name of expectedIcons) {
  for (const size of [6.3, 7.2, 12, 32]) {
    const ctx = new FakeCanvasContext(50, 50, size);
    assert.equal(drawIcon(ctx, name, 50, 50, size, "#ffffff"), true, `${name} ${size}px를 그려야 한다`);
    assert.equal(ctx.depth, 0, `${name} ${size}px의 save/restore가 균형이어야 한다`);
    assert.ok(ctx.operations > 2, `${name} ${size}px가 실제 Canvas 명령을 실행해야 한다`);
    assert.equal(ctx.finiteNumbers, true, `${name} ${size}px가 NaN/Infinity 좌표를 만들면 안 된다`);
    assert.ok(ctx.maxExtent <= 1 + 1e-9, `${name} ${size}px 경로가 size 정사각형을 벗어나면 안 된다`);
  }
}

const invalidCtx = new FakeCanvasContext();
assert.equal(drawIcon(invalidCtx, "unknown-icon", 0, 0, 16, "#fff"), false, "알 수 없는 아이콘은 폴백해야 한다");
assert.equal(drawIcon(invalidCtx, "fish", 0, 0, Number.NaN, "#fff"), false, "잘못된 크기는 폴백해야 한다");
assert.equal(invalidCtx.operations, 0, "폴백 경로는 Canvas 상태를 바꾸면 안 된다");

/** 트랙 B 산출물은 31 ID × 6포즈, 197×197 RGBA 셀을 하나도 빠뜨리면 안 된다. */
const expectedBgm = [
  "boss.mp3",
  "boss.ogg",
  "outro.mp3",
  "outro.ogg",
  "prepare.mp3",
  "prepare.ogg",
  "title.mp3",
  "title.ogg",
];
const bgmEntries = readdirSync(BGM_DIR, { withFileTypes: true });
assert.ok(bgmEntries.every((entry) => entry.isFile()), "public/bgm에는 파일 외 항목이 없어야 한다");
assert.deepEqual(bgmEntries.map((entry) => entry.name).sort(), expectedBgm, "public/bgm은 승인된 8개 트랙만 포함해야 한다");

const expectedSprites = [];
for (let id = 1; id <= 31; id += 1) {
  for (const pose of SPRITE_POSES) expectedSprites.push(spriteSourceName(id, pose));
}
expectedSprites.sort();
const sourceEntries = readdirSync(SPRITE_SOURCE_DIR, { withFileTypes: true });
assert.ok(sourceEntries.every((entry) => entry.isFile()), "assets/sprites-src에는 파일 외 항목이 없어야 한다");
const actualSources = sourceEntries.map((entry) => entry.name).sort();
assert.deepEqual(actualSources, expectedSprites, "source는 31 ID × 6포즈가 정확히 있어야 한다");

const sourceDigest = createHash("sha256");
const decodedSources = new Map();
let sourceBytes = 0;
for (const name of actualSources) {
  const encoded = readFileSync(join(SPRITE_SOURCE_DIR, name));
  const decoded = validateSourcePng(encoded, name);
  assert.equal(decoded.width, SPRITE_SOURCE_SIZE);
  assert.equal(decoded.height, SPRITE_SOURCE_SIZE);
  decodedSources.set(name, decoded);
  sourceDigest.update(name).update("\0").update(encoded);
  sourceBytes += encoded.length;
}

const publicEntries = readdirSync(SPRITE_DIR, { withFileTypes: true });
assert.ok(publicEntries.every((entry) => entry.isFile()), "public/sprites에는 atlas 파일만 있어야 한다");
assert.deepEqual(publicEntries.map((entry) => entry.name).sort(), SPRITE_ATLASES.map((atlas) => atlas.file).sort());

let atlasBytes = 0;
let atlasDecodedBytes = 0;
for (const atlas of SPRITE_ATLASES) {
  const encoded = readFileSync(join(SPRITE_DIR, atlas.file));
  // decodePng가 signature·모든 chunk CRC·형식·payload 길이를 함께 검증한다.
  const decoded = decodePng(encoded, atlas.file);
  assert.equal(decoded.width, atlas.width, `${atlas.file} width`);
  assert.equal(decoded.height, atlas.height, `${atlas.file} height`);
  assert.ok(atlas.width < 4096 && atlas.height < 4096, `${atlas.file}은 4096 미만이어야 한다`);
  for (let id = atlas.firstId; id <= atlas.lastId; id += 1) {
    for (const pose of SPRITE_POSES) {
      const frame = spriteFrameRect(id, pose);
      assert.ok(frame && frame.atlas === atlas.key);
      const source = decodedSources.get(spriteSourceName(id, pose));
      for (let y = 0; y < SPRITE_CROP.h; y += 1) {
        const sourceStart = ((y + SPRITE_CROP.y) * source.width + SPRITE_CROP.x) * 4;
        const atlasStart = ((frame.sy + y) * decoded.width + frame.sx) * 4;
        assert.deepEqual(
          decoded.data.subarray(atlasStart, atlasStart + SPRITE_CROP.w * 4),
          source.data.subarray(sourceStart, sourceStart + SPRITE_CROP.w * 4),
          `${atlas.file}/${id}/${pose} 픽셀`,
        );
      }
    }
  }
  atlasBytes += encoded.length;
  atlasDecodedBytes += decoded.data.length;
}
const legacyDecodedBytes = actualSources.length * SPRITE_SOURCE_SIZE * SPRITE_SOURCE_SIZE * 4;
assert.ok(atlasDecodedBytes < legacyDecodedBytes, "atlas decoded payload가 legacy보다 작아야 한다");

console.log(
  `asset contract passed — 아이콘 ${expectedIcons.length}종 · BGM ${bgmEntries.length}개 · source ${actualSources.length}장/${sourceBytes} bytes/${sourceDigest.digest("hex").slice(0, 16)} · atlas 2장/${atlasBytes} bytes · decoded ${legacyDecodedBytes}→${atlasDecodedBytes}`,
);
