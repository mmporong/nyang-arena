/** 제출 폼에 붙일 문안·링크·썸네일의 기계 검증. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { parseRaidShareCode } from "../src/game/raid.ts";

const doc = readFileSync("docs/openai-builders.md", "utf8");

function textBlock(pattern, label) {
  const value = pattern.exec(doc)?.[1]?.trim();
  assert.ok(value, `${label} 코드 블록을 찾지 못했다`);
  return value;
}

const title = textBlock(/### 게임 제목[^\n]*\n\s*```text\s*\n([\s\S]*?)\n```/, "80자 게임 제목");
// 공식 폼의 maxlength/counter와 같은 JavaScript UTF-16 code unit 길이를 쓴다.
const titleChars = title.length;
assert.ok(titleChars <= 80, `게임 제목이 ${titleChars}자다 (상한 80)`);

const description = textBlock(/### 게임 소개[^\n]*\n\s*```text\s*\n([\s\S]*?)\n```/, "200자 게임 소개");
const descriptionChars = description.length;
assert.ok(descriptionChars <= 200, `게임 소개가 ${descriptionChars}자다 (상한 200)`);

const playableUrl = textBlock(
  /### 플레이 가능한 게임 링크[^\n]*\n\s*```text\s*\n([\s\S]*?)\n```/,
  "플레이 가능한 게임 링크",
);
assert.equal(playableUrl, "https://mmporong.github.io/nyang-arena/", "플레이 URL이 공개 게임 빌드가 아니다");

const thumbnailPath = textBlock(/### 게임 썸네일[^\n]*\n\s*```text\s*\n([\s\S]*?)\n```/, "게임 썸네일");
assert.equal(thumbnailPath, "docs/thumbnail.png", "썸네일 경로는 저장소 상대경로여야 한다");

const codexProcess = textBlock(
  /### Codex와 함께 게임을 만든 과정[^\n]*\n\s*```text\s*\n([\s\S]*?)\n```/,
  "5,000자 Codex 과정",
);
const codexProcessChars = codexProcess.length;
assert.ok(codexProcessChars <= 5_000, `Codex 과정이 ${codexProcessChars}자다 (상한 5,000)`);

const share = textBlock(
  /영상에서 사용할 결정적 공유 코드:[^\n]*\n\s*```text\s*\n([\s\S]*?)\n```/,
  "3분 데모 공유 코드",
);
assert.ok(share && parseRaidShareCode(share), "3분 데모 공유 코드가 유효하지 않다");

const png = readFileSync(thumbnailPath);
assert.equal(png.subarray(1, 4).toString("ascii"), "PNG", "썸네일이 PNG가 아니다");
const width = png.readUInt32BE(16);
const height = png.readUInt32BE(20);
assert.ok(Math.abs(width / height - 16 / 9) < 0.001, `썸네일이 16:9가 아니다 (${width}x${height})`);
const size = statSync(thumbnailPath).size;
assert.ok(size <= 10 * 1024 * 1024, `썸네일이 10MB를 넘는다 (${size})`);

// 최종 문안이 검증 완료를 주장하는 순간부터 저장된 재현 증거도 함께 통과해야 한다.
// 작업 중 문안은 이 마커를 넣지 않아도 되지만, 제출본은 문구만 앞서갈 수 없다.
if (doc.includes("<!-- SUBMISSION_EVIDENCE_REQUIRED -->")) {
  const metrics = JSON.parse(readFileSync("docs/generated/metrics-current.json", "utf8"));
  const performance = JSON.parse(readFileSync("docs/generated/performance-current.json", "utf8"));
  const release = JSON.parse(readFileSync("docs/generated/submission-release.json", "utf8"));
  assert.equal(metrics.generatedFrom?.reproducible, true, "제출 문안이 완료를 주장하지만 metrics가 재현 불가다");
  assert.equal(metrics.verification?.allSixPassed, true, "제출 문안이 완료를 주장하지만 6축이 PASS가 아니다");
  assert.equal(metrics.verification?.provenanceMatches, true, "제출 문안이 완료를 주장하지만 provenance가 불일치다");
  assert.equal(performance.constraints?.runtimeDependencies, 0, "런타임 의존성이 0이 아니다");
  assert.equal(performance.constraints?.externalNetwork, 0, "외부 네트워크 요청이 0이 아니다");
  assert.equal(performance.constraints?.canvas2d, true, "Canvas 2D 출고 조건이 깨졌다");
  assert.equal(release.schema, 1, "제출 출고 manifest schema가 다르다");
  assert.equal(release.gameProductCommit, performance.productCommit, "출고 manifest와 성능 제품 커밋이 다르다");
  assert.equal(release.publicBuild?.url, playableUrl, "출고 manifest와 플레이 URL이 다르다");

  const rawHashes = Object.fromEntries(metrics.verification.sixAxis.map(({ axis, sha256 }) => [axis, sha256]));
  assert.deepEqual(rawHashes, performance.verification.sixAxisRawHashes, "6축 원시 해시가 성능 출고 증거와 다르다");

  const omittedMetricKeys = new Set([
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
  const normalizeMetrics = (value) => {
    if (Array.isArray(value)) return value.map(normalizeMetrics);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((key) => !omittedMetricKeys.has(key))
        .map((key) => [key, normalizeMetrics(value[key])]),
    );
  };
  const normalizedPayload = normalizeMetrics({
    structure: metrics.structure,
    distribution: metrics.distribution,
    session: metrics.session,
    waveKinds: metrics.waveKinds,
    balance: metrics.balance,
    verification: metrics.verification,
    observations: metrics.observations,
    openIssues: metrics.openIssues,
  });
  const normalizedMetricsHash = createHash("sha256").update(JSON.stringify(normalizedPayload)).digest("hex");
  assert.equal(
    normalizedMetricsHash,
    performance.verification.normalizedMetricsHash,
    "정규화 metrics hash가 성능 출고 증거와 다르다",
  );

  for (const [name, evidence] of Object.entries({
    contracts: metrics.verification?.raidContracts,
    mapPreparation: metrics.verification?.mapPreparation,
    mapSpace: metrics.verification?.mapSpace,
  })) {
    assert.equal(evidence?.source?.exitCode, 0, `${name} 증거 종료 코드가 0이 아니다`);
    assert.ok(Object.values(evidence?.gates ?? {}).every((value) => value === true), `${name} gate가 전부 PASS가 아니다`);
  }

  const requireCurrentCopy = (text, label) => {
    assert.ok(doc.includes(text), `${label} 최신 수치가 제출 문안에 없다: ${text}`);
  };
  requireCurrentCopy(`게임 출고 기준 제품 커밋: \`${release.gameProductCommit}\``, "게임 출고 제품 커밋");
  requireCurrentCopy(normalizedMetricsHash, "정규화 metrics SHA-256");
  requireCurrentCopy(
    `도달 웨이브 중앙값 ${metrics.distribution.median}, ${metrics.generatedFrom.maxWave}웨이브 상한 도달 ${metrics.distribution.hitMaxWave}건`,
    "전체 런 분포",
  );
  const contracts = metrics.verification.raidContracts;
  requireCurrentCopy(
    `계약-aware 중앙값 ${contracts.contractAware.median}, 보상-only ${contracts.rewardOnly.median}`,
    "계약 중앙값",
  );
  requireCurrentCopy(
    `첫 두 보스 ${(contracts.contractAware.pass * 100).toFixed(1)}% 대 ${(contracts.rewardOnly.pass * 100).toFixed(1)}%`,
    "계약 통과율",
  );
  const highRisk = metrics.verification.mapPreparation.highRiskOutcome;
  requireCurrentCopy(
    `고위험 준비 경로 ${highRisk.unpreparedPassPct.toFixed(1)}%→${highRisk.preparedPassPct.toFixed(1)}%`,
    "고위험 준비",
  );
  const mapSpace = metrics.verification.mapSpace;
  requireCurrentCopy(
    `지도 읽기 ${mapSpace.readMean.toFixed(1)} 대 무작위 ${mapSpace.randomMean.toFixed(1)}`,
    "지도 정책",
  );
  requireCurrentCopy(
    `Chrome p95 ${performance.browsers.chrome.frameWorkP95Ms.toFixed(2)}ms, Edge p95 ${performance.browsers.edge.frameWorkP95Ms.toFixed(2)}ms`,
    "브라우저 성능",
  );
  requireCurrentCopy(
    `Chrome/Edge 장기 프레임 ${performance.browsers.chrome.longFrameCount}/${performance.browsers.edge.longFrameCount}건`,
    "브라우저 장기 프레임",
  );
  requireCurrentCopy(
    `런타임 의존성 ${performance.constraints.runtimeDependencies}개, 외부 네트워크 요청 ${performance.constraints.externalNetwork}건, Canvas 2D 유지`,
    "런타임 출고 조건",
  );

  const evidenceCommit = /게임 출고 기준 증거·배포 커밋: `([0-9a-f]{40})`/.exec(doc)?.[1];
  assert.ok(evidenceCommit, "게임 출고 증거·배포 커밋을 찾지 못했다");
  assert.equal(evidenceCommit, release.evidenceCommit, "문서와 출고 manifest의 증거 커밋이 다르다");
  assert.notEqual(release.evidenceCommit, release.gameProductCommit, "제품과 증거 커밋은 분리되어야 한다");
  assert.equal(release.ci?.headSha, release.evidenceCommit, "CI HEAD가 출고 증거 커밋과 다르다");
  assert.equal(release.ci?.status, "completed", "출고 CI가 완료 상태가 아니다");
  assert.equal(release.ci?.conclusion, "success", "출고 CI가 성공 상태가 아니다");
  assert.equal(
    release.ci?.url,
    `https://github.com/mmporong/nyang-arena/actions/runs/${release.ci?.runId}`,
    "출고 CI URL과 run id가 다르다",
  );
  assert.ok(doc.includes(release.ci.url), "문서의 GitHub Actions 링크가 출고 manifest와 다르다");
}

console.log(
  `제출 문안 PASS — 제목 ${titleChars}/80자 · 소개 ${descriptionChars}/200자 · Codex ${codexProcessChars}/5000자 · 공유 ${share} · 썸네일 ${width}x${height} ${(size / 1024).toFixed(1)}KB`,
);
