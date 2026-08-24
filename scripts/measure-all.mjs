#!/usr/bin/env node
/**
 * 결정 축 6개를 같은 Node 런타임으로 끝까지 실행하고 증거를 봉인한다.
 *
 * Windows에서 `bash scripts/measure-all.sh`를 호출하면 WSL의 node가 선택될 수
 * 있다. 부모 Node로 npm CLI를 직접 실행하고 그 Node 디렉터리를 PATH 맨 앞에
 * 두어, 각 package script도 반드시 같은 런타임을 상속하게 한다.
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";

const AXES = Object.freeze([
  ["sim", "1..300"],
  ["decisions", "1..300"],
  ["placement", "1..1200"],
  ["intervention", "1..300"],
  ["map", "prep:1..300;policy-space:1..1500"],
  ["relics", "1..2000"],
]);
const OBSERVATIONS = Object.freeze(["gold", "clear"]);
const EVIDENCE_DIR = ".omx/evidence/verify-6axis";
const MANIFEST = join(EVIDENCE_DIR, "manifest.tsv");
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const requiredNode = `v${packageJson.engines?.node ?? ""}`;

if (process.version !== requiredNode) {
  console.error(`Node 버전 불일치 — 필요 ${requiredNode}, 현재 ${process.version}`);
  process.exit(1);
}

const npmCli = process.env.npm_execpath;
if (!npmCli) {
  console.error("npm 실행 경로가 없다. `npm run measure:all`로 실행할 것.");
  process.exit(1);
}

const childEnv = { ...process.env };
const pathKey = Object.keys(childEnv).find((key) => key.toLowerCase() === "path") ?? "PATH";
childEnv[pathKey] = `${dirname(process.execPath)}${delimiter}${childEnv[pathKey] ?? ""}`;

const childNode = spawnSync("node", ["--version"], {
  env: childEnv,
  encoding: "utf8",
  windowsHide: true,
});
if (childNode.status !== 0 || childNode.stdout.trim() !== process.version) {
  console.error(
    `자식 Node 고정 실패 — 부모 ${process.version}, 자식 ${childNode.stdout.trim() || "실행 불가"}`,
  );
  process.exit(1);
}

function git(args) {
  const result = spawnSync("git", args, { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} 실패`);
  return result.stdout.trim();
}

/** npm script의 화면 출력과 원시 로그를 같은 실행에서 함께 만든다. */
function runNpmScript(name) {
  return new Promise((resolve) => {
    const chunks = [];
    const child = spawn(process.execPath, [npmCli, "run", "--silent", name], {
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    child.stdout.on("data", (chunk) => {
      chunks.push(Buffer.from(chunk));
      process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      chunks.push(Buffer.from(chunk));
      process.stderr.write(chunk);
    });
    child.on("error", (error) => {
      const chunk = Buffer.from(`${error.stack ?? error.message}\n`);
      chunks.push(chunk);
      process.stderr.write(chunk);
    });
    child.on("close", (code) => resolve({ code: code ?? 1, output: Buffer.concat(chunks) }));
  });
}

mkdirSync(EVIDENCE_DIR, { recursive: true });
const head = git(["rev-parse", "HEAD"]);
const tree = git(["rev-parse", "HEAD^{tree}"]);
const dirty = git(["status", "--porcelain", "--untracked-files=all"]) !== "";
writeFileSync(
  MANIFEST,
  "axis\tstatus\texit_code\tcommand\tseeds\thead\ttree\tdirty\tnode\tsha256\n",
);

const failed = [];
for (const [axis, seeds] of AXES) {
  console.log(`\n──────── ${axis} ────────`);
  const result = await runNpmScript(axis);
  const status = result.code === 0 ? "PASS" : "FAIL";
  if (result.code !== 0) failed.push(axis);
  const logPath = join(EVIDENCE_DIR, `${axis}.log`);
  writeFileSync(logPath, result.output);
  const sha256 = createHash("sha256").update(result.output).digest("hex");
  const row = [
    axis,
    status,
    result.code,
    `npm run --silent ${axis}`,
    seeds,
    head,
    tree,
    dirty,
    process.version,
    sha256,
  ].join("\t");
  writeFileSync(MANIFEST, `${row}\n`, { flag: "a" });
}

for (const observation of OBSERVATIONS) {
  console.log(`\n──────── ${observation} (관측) ────────`);
  const result = await runNpmScript(observation);
  if (result.code !== 0) console.warn("  (관측 스크립트 실패 — 판정에는 안 들어간다)");
}

console.log("\n──────── metrics ────────");
const metrics = await runNpmScript("metrics");
if (metrics.code !== 0) failed.push("metrics");

console.log();
if (failed.length === 0) {
  console.log(`관문 통과 — 결정 축 ${AXES.length}개가 전부 기준 안`);
  process.exit(0);
}
console.error(`관문 미달 ${failed.length}건: ${failed.join(" ")}`);
console.error("  (측정은 전부 돌았다. 위의 각 축 판정 줄을 볼 것)");
process.exit(1);
