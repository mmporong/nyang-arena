import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [slice, recolor, pkgText] = await Promise.all([
  readFile(new URL("./slice-sprites.py", import.meta.url), "utf8"),
  readFile(new URL("./recolor-sprites.py", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8"),
]);
const pkg = JSON.parse(pkgText);

assert.match(slice, /TemporaryDirectory[\s\S]+written != 120[\s\S]+actual != expected[\s\S]+os\.replace/u);
assert.match(slice, /bbox is None[\s\S]+raise RuntimeError/u);
assert.match(slice, /opaque < [^\n]+[\s\S]+raise RuntimeError\(f"저불투명 셀/u);
assert.match(slice, /bbox != \(2, 2, 194, 194\)[\s\S]+raise RuntimeError/u);

assert.match(recolor, /TemporaryDirectory[\s\S]+written != 66[\s\S]+actual != expected[\s\S]+os\.replace/u);
assert.match(recolor, /not src_path\.is_file\(\)[\s\S]+raise RuntimeError\(f"리컬러 원본 누락/u);
assert.match(recolor, /src\.size != \(197, 197\) or src\.mode != "RGBA"[\s\S]+raise RuntimeError/u);

assert.equal(pkg.scripts.slice, "npm run sprites:rebuild");
assert.equal(pkg.scripts.recolor, "python3 scripts/recolor-sprites.py && npm run atlas");
assert.equal(
  pkg.scripts["sprites:rebuild"],
  "python3 scripts/slice-sprites.py && python3 scripts/recolor-sprites.py && npm run atlas",
);
assert.equal((pkg.scripts["sprites:rebuild"].match(/npm run atlas/gu) ?? []).length, 1, "중간 stale atlas를 만들면 안 된다");

console.log("sprite pipeline contract PASS — fail-closed staging 120/66 · one final atlas generation");
