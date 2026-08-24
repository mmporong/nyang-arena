import { constants as zlibConstants, deflateSync, inflateSync } from "node:zlib";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SPRITE_ATLASES,
  SPRITE_CROP,
  SPRITE_POSES,
  SPRITE_SOURCE_SIZE,
  spriteSourceName,
} from "../src/game/sprite-atlas.ts";

const PNG_SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex");
export const MAX_PNG_DIMENSION = 4095;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_SOURCE_DIR = join(ROOT, "assets", "sprites-src");
export const DEFAULT_OUTPUT_DIR = join(ROOT, "public", "sprites");

const CRC_TABLE = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

export function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function pngChunk(type, payload = Buffer.alloc(0)) {
  const typeBytes = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(payload.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, payload])));
  return Buffer.concat([length, typeBytes, payload, checksum]);
}

function paeth(a, b, c) {
  const estimate = a + b - c;
  const da = Math.abs(estimate - a);
  const db = Math.abs(estimate - b);
  const dc = Math.abs(estimate - c);
  return da <= db && da <= dc ? a : db <= dc ? b : c;
}

export function decodePng(buffer, label = "PNG") {
  if (!Buffer.isBuffer(buffer)) throw new Error(`${label}: Buffer가 아니다`);
  if (buffer.length < PNG_SIGNATURE.length || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error(`${label}: PNG signature 불일치`);
  }
  let offset = 8;
  let ihdr = null;
  const idat = [];
  let ended = false;
  while (offset < buffer.length) {
    if (offset + 12 > buffer.length) throw new Error(`${label}: chunk header 잘림`);
    const length = buffer.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > buffer.length) throw new Error(`${label}: chunk payload 잘림`);
    const typeBytes = buffer.subarray(offset + 4, offset + 8);
    const type = typeBytes.toString("ascii");
    const payload = buffer.subarray(offset + 8, offset + 8 + length);
    const expectedCrc = buffer.readUInt32BE(offset + 8 + length);
    const actualCrc = crc32(Buffer.concat([typeBytes, payload]));
    if (actualCrc !== expectedCrc) throw new Error(`${label}: ${type} CRC 불일치`);
    if (type === "IHDR") {
      if (ihdr || length !== 13) throw new Error(`${label}: 잘못된 IHDR`);
      ihdr = Buffer.from(payload);
    } else if (type === "IDAT") {
      if (!ihdr) throw new Error(`${label}: IHDR 전 IDAT`);
      idat.push(Buffer.from(payload));
    } else if (type === "IEND") {
      if (length !== 0) throw new Error(`${label}: 잘못된 IEND`);
      ended = true;
      offset = end;
      break;
    }
    offset = end;
  }
  if (!ihdr || !ended || idat.length === 0) throw new Error(`${label}: 필수 PNG chunk 누락`);
  if (offset !== buffer.length) throw new Error(`${label}: IEND 뒤 데이터가 있다`);
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const [bitDepth, colorType, compression, filter, interlace] = ihdr.subarray(8);
  if (width === 0 || height === 0) throw new Error(`${label}: 빈 PNG`);
  if (width > MAX_PNG_DIMENSION || height > MAX_PNG_DIMENSION) {
    throw new Error(`${label}: PNG dimension 상한 ${MAX_PNG_DIMENSION} 초과`);
  }
  if (bitDepth !== 8 || colorType !== 6 || compression !== 0 || filter !== 0 || interlace !== 0) {
    throw new Error(`${label}: 8-bit RGBA non-interlaced PNG만 허용`);
  }
  const stride = width * 4;
  const rgbaLength = stride * height;
  const filteredLength = (stride + 1) * height;
  if (![stride, rgbaLength, filteredLength].every(Number.isSafeInteger)) {
    throw new Error(`${label}: decoded payload 크기가 안전 정수 범위를 벗어났다`);
  }
  let filtered;
  try {
    filtered = inflateSync(Buffer.concat(idat), { maxOutputLength: filteredLength });
  } catch (error) {
    throw new Error(`${label}: IDAT inflate 실패`, { cause: error });
  }
  if (filtered.length !== filteredLength) throw new Error(`${label}: decoded payload 길이 불일치`);
  const rgba = Buffer.alloc(rgbaLength);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1);
    const filterType = filtered[rowStart];
    if (filterType > 4) throw new Error(`${label}: 지원하지 않는 filter ${filterType}`);
    for (let x = 0; x < stride; x += 1) {
      const raw = filtered[rowStart + 1 + x];
      const left = x >= 4 ? rgba[y * stride + x - 4] : 0;
      const up = y > 0 ? rgba[(y - 1) * stride + x] : 0;
      const upLeft = y > 0 && x >= 4 ? rgba[(y - 1) * stride + x - 4] : 0;
      const predictor = filterType === 0 ? 0
        : filterType === 1 ? left
          : filterType === 2 ? up
            : filterType === 3 ? Math.floor((left + up) / 2)
              : paeth(left, up, upLeft);
      rgba[y * stride + x] = (raw + predictor) & 0xff;
    }
  }
  return { width, height, data: rgba };
}

function filterRow(row, previous, type) {
  const out = Buffer.alloc(row.length);
  let score = 0;
  for (let x = 0; x < row.length; x += 1) {
    const left = x >= 4 ? row[x - 4] : 0;
    const up = previous ? previous[x] : 0;
    const upLeft = previous && x >= 4 ? previous[x - 4] : 0;
    const predictor = type === 0 ? 0
      : type === 1 ? left
        : type === 2 ? up
          : type === 3 ? Math.floor((left + up) / 2)
            : paeth(left, up, upLeft);
    const value = (row[x] - predictor) & 0xff;
    out[x] = value;
    score += value < 128 ? value : 256 - value;
  }
  return { type, out, score };
}

export function encodePng({ width, height, data }) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error("PNG encode dimensions가 잘못됐다");
  }
  if (width > MAX_PNG_DIMENSION || height > MAX_PNG_DIMENSION) {
    throw new Error(`PNG encode dimension 상한 ${MAX_PNG_DIMENSION} 초과`);
  }
  const stride = width * 4;
  const rgbaLength = stride * height;
  const filteredLength = (stride + 1) * height;
  if (![stride, rgbaLength, filteredLength].every(Number.isSafeInteger)) {
    throw new Error("PNG encode payload 크기가 안전 정수 범위를 벗어났다");
  }
  if (!Buffer.isBuffer(data) || data.length !== rgbaLength) {
    throw new Error("PNG encode RGBA payload 길이가 잘못됐다");
  }
  const filtered = Buffer.alloc(filteredLength);
  for (let y = 0; y < height; y += 1) {
    const row = data.subarray(y * stride, (y + 1) * stride);
    const previous = y > 0 ? data.subarray((y - 1) * stride, y * stride) : null;
    let best = filterRow(row, previous, 0);
    for (let type = 1; type <= 4; type += 1) {
      const candidate = filterRow(row, previous, type);
      if (candidate.score < best.score) best = candidate;
    }
    const offset = y * (stride + 1);
    filtered[offset] = best.type;
    best.out.copy(filtered, offset + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const compressed = deflateSync(filtered, { level: 9, strategy: zlibConstants.Z_DEFAULT_STRATEGY });
  return Buffer.concat([PNG_SIGNATURE, pngChunk("IHDR", ihdr), pngChunk("IDAT", compressed), pngChunk("IEND")]);
}

export function alphaBounds({ width, height, data }) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] === 0) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

export function validateSourcePng(buffer, name) {
  const decoded = decodePng(buffer, name);
  if (decoded.width !== SPRITE_SOURCE_SIZE || decoded.height !== SPRITE_SOURCE_SIZE) {
    throw new Error(`${name}: ${SPRITE_SOURCE_SIZE}×${SPRITE_SOURCE_SIZE}가 아니다`);
  }
  const bbox = alphaBounds(decoded);
  if (!bbox || bbox.x !== SPRITE_CROP.x || bbox.y !== SPRITE_CROP.y || bbox.w !== SPRITE_CROP.w || bbox.h !== SPRITE_CROP.h) {
    throw new Error(`${name}: alpha bbox가 (2,2)-(194,194)가 아니다 (${JSON.stringify(bbox)})`);
  }
  return decoded;
}

export async function buildAtlas(spec, readSource) {
  const atlas = Buffer.alloc(spec.width * spec.height * 4);
  let frames = 0;
  for (let id = spec.firstId; id <= spec.lastId; id += 1) {
    for (let poseIndex = 0; poseIndex < SPRITE_POSES.length; poseIndex += 1) {
      const pose = SPRITE_POSES[poseIndex];
      const name = spriteSourceName(id, pose);
      let source;
      try {
        source = validateSourcePng(await readSource(name), name);
      } catch (error) {
        throw new Error(`atlas ${spec.key}: ${name} 처리 실패`, { cause: error });
      }
      const destinationX = poseIndex * SPRITE_CROP.w;
      const destinationY = (id - spec.firstId) * SPRITE_CROP.h;
      for (let y = 0; y < SPRITE_CROP.h; y += 1) {
        const sourceStart = ((y + SPRITE_CROP.y) * source.width + SPRITE_CROP.x) * 4;
        const destinationStart = ((destinationY + y) * spec.width + destinationX) * 4;
        source.data.copy(atlas, destinationStart, sourceStart, sourceStart + SPRITE_CROP.w * 4);
      }
      frames += 1;
    }
  }
  const expectedFrames = (spec.lastId - spec.firstId + 1) * SPRITE_POSES.length;
  if (frames !== expectedFrames) throw new Error(`atlas ${spec.key}: 빈 셀이 있다`);
  return { width: spec.width, height: spec.height, data: atlas, frames };
}

export async function generateAtlases({
  sourceDir = DEFAULT_SOURCE_DIR,
  outputDir = DEFAULT_OUTPUT_DIR,
  write = false,
  readSource = (name) => readFile(join(sourceDir, name)),
  readOutput = (path) => readFile(path),
  writeOutput = (path, data) => writeFile(path, data),
} = {}) {
  // 두 atlas가 모두 완성되기 전에는 기존 산출물을 건드리지 않는다.
  const prepared = [];
  for (const spec of SPRITE_ATLASES) {
    const atlas = await buildAtlas(spec, readSource);
    const encoded = encodePng(atlas);
    const output = join(outputDir, spec.file);
    prepared.push({ spec, atlas, encoded, output });
  }
  if (write) await mkdir(outputDir, { recursive: true });
  const results = [];
  for (const { spec, atlas, encoded, output } of prepared) {
    if (write) {
      await writeOutput(output, encoded);
    } else {
      let existing;
      try {
        existing = await readOutput(output);
      } catch (error) {
        throw new Error(`${spec.file}: 생성물이 없다. npm run atlas를 실행하세요`, { cause: error });
      }
      if (!existing.equals(encoded)) throw new Error(`${spec.file}: source와 결정적으로 일치하지 않는다`);
    }
    results.push({
      spec,
      bytes: encoded.length,
      frames: atlas.frames,
      sha256: createHash("sha256").update(encoded).digest("hex"),
    });
  }
  return results;
}

async function cli() {
  const option = process.argv[2];
  if (option !== "--write" && option !== "--check") {
    throw new Error("사용법: node --experimental-strip-types scripts/sprite-atlas.mjs --write|--check");
  }
  const results = await generateAtlases({ write: option === "--write" });
  const action = option === "--write" ? "generated" : "checked";
  console.log(
    `sprite atlases ${action} — ${results.map(({ spec, frames, bytes, sha256 }) => `${spec.file} ${frames} frames/${bytes} bytes/${sha256.slice(0, 12)}`).join(" · ")}`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await cli();
