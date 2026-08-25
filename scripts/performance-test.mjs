#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const EXPECTED_AXIS_HASHES = Object.freeze({
  sim: "9923da2d285fca10375b29b1b28f3b0ae01128dc0183c1923809703df917c75a",
  decisions: "e1f895bbdb7b57e1b8e06ea429e49b428149d68fce6649187e1075f78a3cc71c",
  placement: "c49c6584f6c41b91878860b207ec71e5c35d0ad7cb99b73a6a041095d72dbdee",
  intervention: "14f86439199653bfe33b908b56fe1237ce2c24b42ba7bf62e73824c4d8884a83",
  map: "7f5e709b5fde25df82066b95cf6ffc394ee0130f54015e6013d6416cef0d0119",
  relics: "7d73a3fba5773aa20c10e6e0e22a53187907c216f3c19bd5cb3a6eca9013b7b1",
});
const EXPECTED_NORMALIZED_METRICS_HASH = "ae2c9e24581ae743ccf95922e14b5d8df340137b32f20815fc55644341c2591e";
const VOLATILE_METRIC_KEYS = new Set([
  "source",
  "evidenceSha256",
  "head",
  "tree",
  "dirty",
  "node",
  "sha256",
  "logShaMatches",
  "generatedFrom",
  "build",
]);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: options.capture ? "utf8" : undefined,
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    windowsHide: true,
    env: options.env ?? process.env,
  });
  if (options.capture) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
  }
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${command} ${args.join(" ")} 실패 (${result.status})`);
  return options.capture ? `${result.stdout ?? ""}${result.stderr ?? ""}` : "";
}

function git(args) {
  const result = spawnSync("git", args, { cwd: ROOT, encoding: "utf8", windowsHide: true });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `git ${args.join(" ")} 실패`);
  return result.stdout.trim();
}

function npmRun(name) {
  const npmCli = process.env.npm_execpath;
  if (npmCli) return run(process.execPath, [npmCli, "run", "--silent", name]);
  return run(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "--silent", name]);
}

function commandPath(name) {
  const finder = process.platform === "win32" ? "where.exe" : "which";
  const result = spawnSync(finder, [name], { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) return null;
  return result.stdout.split(/\r?\n/u).map((line) => line.trim()).find(Boolean) ?? null;
}

function firstExisting(candidates) {
  for (const candidate of candidates.filter(Boolean)) {
    const absolute = resolve(candidate);
    if (existsSync(absolute)) return absolute;
    const discovered = commandPath(candidate);
    if (discovered) return discovered;
  }
  return null;
}

function browserPaths() {
  const chromeCandidates = [process.env.NYANG_CHROME, process.env.CHROME_BIN];
  const edgeCandidates = [process.env.NYANG_EDGE, process.env.EDGE_BIN];
  if (process.platform === "win32") {
    for (const base of [process.env.LOCALAPPDATA, process.env.ProgramFiles, process.env["ProgramFiles(x86)"]]) {
      if (!base) continue;
      chromeCandidates.push(join(base, "Google", "Chrome", "Application", "chrome.exe"));
      edgeCandidates.push(join(base, "Microsoft", "Edge", "Application", "msedge.exe"));
    }
    chromeCandidates.push("chrome.exe");
    edgeCandidates.push("msedge.exe");
  } else {
    chromeCandidates.push("google-chrome", "google-chrome-stable", "chromium", "chromium-browser");
    edgeCandidates.push("microsoft-edge", "microsoft-edge-stable");
  }
  const chrome = firstExisting(chromeCandidates);
  const edge = firstExisting(edgeCandidates);
  assert.ok(chrome, "Chrome 실행 파일이 없어 성능 평가를 닫힌 상태로 실패합니다");
  assert.ok(edge, "Edge 실행 파일이 없어 성능 평가를 닫힌 상태로 실패합니다");
  assert.notEqual(resolve(chrome), resolve(edge), "Chrome과 Edge가 같은 실행 파일로 해석됐습니다");
  return { chrome, edge };
}

function parseTaggedJson(output, tag) {
  const lines = output.split(/\r?\n/u).filter((line) => line.startsWith(`${tag} `));
  assert.equal(lines.length, 1, `${tag}가 정확히 한 줄이어야 합니다 (${lines.length})`);
  return JSON.parse(lines[0].slice(tag.length + 1));
}

function runBrowser(browserPath) {
  const output = run(process.execPath, [join(ROOT, "scripts", "browser-runtime-test.mjs")], {
    capture: true,
    env: { ...process.env, NYANG_BROWSER: browserPath },
  });
  const performance = parseTaggedJson(output, "PERFORMANCE_RESULT");
  const cache = parseTaggedJson(output, "CACHE_RESULT");
  assert.equal(performance.browser, basename(browserPath), "성능 결과의 브라우저 실행 파일이 다릅니다");
  assert.equal(cache.browser, basename(browserPath), "캐시 결과의 브라우저 실행 파일이 다릅니다");
  return { performance, cache };
}

function stripVolatile(value) {
  if (Array.isArray(value)) return value.map(stripVolatile);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().filter((key) => !VOLATILE_METRIC_KEYS.has(key))
        .map((key) => [key, stripVolatile(value[key])]),
    );
  }
  return value;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function verifySixAxes(head, tree) {
  const manifestPath = join(ROOT, ".omx", "evidence", "verify-6axis", "manifest.tsv");
  const [header, ...lines] = readFileSync(manifestPath, "utf8").trim().split(/\r?\n/u);
  assert.equal(header, "axis\tstatus\texit_code\tcommand\tseeds\thead\ttree\tdirty\tnode\tsha256");
  const rows = Object.fromEntries(lines.map((line) => {
    const [axis, status, exitCode, command, seeds, rowHead, rowTree, dirty, node, hash] = line.split("\t");
    return [axis, { status, exitCode, command, seeds, head: rowHead, tree: rowTree, dirty, node, hash }];
  }));
  assert.deepEqual(Object.keys(rows), Object.keys(EXPECTED_AXIS_HASHES), "6축 manifest 순서·구성이 다릅니다");
  for (const [axis, expectedHash] of Object.entries(EXPECTED_AXIS_HASHES)) {
    const row = rows[axis];
    assert.equal(row.status, "PASS", `${axis} 축이 PASS가 아닙니다`);
    assert.equal(row.exitCode, "0", `${axis} 축 종료 코드가 0이 아닙니다`);
    assert.equal(row.head, head, `${axis} 축 HEAD provenance가 다릅니다`);
    assert.equal(row.tree, tree, `${axis} 축 tree provenance가 다릅니다`);
    assert.equal(row.dirty, "false", `${axis} 축이 dirty 상태에서 측정됐습니다`);
    assert.equal(row.node, process.version, `${axis} 축 Node 버전이 다릅니다`);
    assert.equal(row.hash, expectedHash, `${axis} 축 raw hash가 기준선과 다릅니다`);
  }
  return rows;
}

function verifyMetrics(head) {
  const metrics = JSON.parse(readFileSync(join(ROOT, "docs", "generated", "metrics-current.json"), "utf8"));
  assert.equal(metrics.generatedFrom?.head, head, "metrics HEAD provenance가 현재 제품 커밋과 다릅니다");
  assert.equal(metrics.generatedFrom?.dirty, false, "metrics가 dirty 상태에서 생성됐습니다");
  assert.equal(metrics.generatedFrom?.reproducible, true, "metrics reproducible 판정이 false입니다");
  assert.equal(metrics.verification?.provenanceMatches, true, "metrics provenance 판정이 불일치합니다");
  assert.equal(metrics.verification?.allSixPassed, true, "metrics 6축 판정이 실패했습니다");
  const payload = stripVolatile({
    structure: metrics.structure,
    distribution: metrics.distribution,
    session: metrics.session,
    waveKinds: metrics.waveKinds,
    balance: metrics.balance,
    verification: metrics.verification,
    observations: metrics.observations,
    openIssues: metrics.openIssues,
  });
  const normalizedHash = sha256(JSON.stringify(payload));
  assert.equal(normalizedHash, EXPECTED_NORMALIZED_METRICS_HASH, "normalized metrics hash가 기준선과 다릅니다");
  return normalizedHash;
}

const packageJson = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
assert.deepEqual(Object.keys(packageJson.dependencies ?? {}), [], "런타임 dependencies가 0이 아닙니다");
assert.equal(git(["status", "--porcelain", "--untracked-files=all"]), "", "성능 평가는 clean 제품 커밋에서만 실행할 수 있습니다");
const head = git(["rev-parse", "HEAD"]);
const tree = git(["rev-parse", "HEAD^{tree}"]);
const browsers = browserPaths();

npmRun("performance:observer:test");
npmRun("render:cache:test");
npmRun("build");
const chrome = runBrowser(browsers.chrome);
const edge = runBrowser(browsers.edge);
npmRun("runtime:network:test");
npmRun("invariants");
npmRun("contract:test");
npmRun("contracts");
npmRun("measure:all");

const axes = verifySixAxes(head, tree);
const normalizedMetricsHash = verifyMetrics(head);
const evidencePath = join(ROOT, ".omx", "evidence", "performance-g005", head, "result.json");
mkdirSync(dirname(evidencePath), { recursive: true });
const result = {
  schema: 1,
  generatedAt: new Date().toISOString(),
  head,
  tree,
  node: process.version,
  constraints: { runtimeDependencies: 0, externalNetwork: 0, canvas2d: true },
  browsers: { chrome, edge },
  verification: {
    axes: Object.fromEntries(Object.entries(axes).map(([axis, row]) => [axis, row.hash])),
    normalizedMetricsHash,
    allSixPassed: true,
    provenanceMatches: true,
  },
};
const temporaryPath = `${evidencePath}.tmp-${process.pid}`;
writeFileSync(temporaryPath, `${JSON.stringify(result, null, 2)}\n`);
renameSync(temporaryPath, evidencePath);

console.log(
  `performance gate passed — Chrome p95 ${chrome.performance.frameWorkMs.p95Ms.toFixed(2)}ms · Edge p95 ${edge.performance.frameWorkMs.p95Ms.toFixed(2)}ms · 6축/metrics 불변 · ${evidencePath}`,
);
