/** 제출 폼에 붙일 문안·링크·썸네일·데모 영상의 기계 검증. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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

const demoUrl = textBlock(
  /### 데모 영상 링크[^\n]*\n\s*```text\s*\n([\s\S]*?)\n```/,
  "데모 영상 링크",
);
assert.equal(
  demoUrl,
  "https://mmporong.github.io/nyang-arena/submission-gameplay.mp4",
  "데모 영상 URL이 Pages 공개 경로가 아니다",
);

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

const demoPath = "public/submission-gameplay.mp4";
const demo = readFileSync(demoPath);
const demoSize = statSync(demoPath).size;
assert.equal(demo.subarray(4, 8).toString("ascii"), "ftyp", "데모 영상이 MP4 컨테이너가 아니다");
assert.ok(demo.includes(Buffer.from("avc1")), "데모 영상에 H.264 트랙이 없다");
assert.ok(demo.includes(Buffer.from("mp4a")), "데모 영상에 AAC 트랙이 없다");
assert.ok(demoSize >= 1024 * 1024, `데모 영상이 실제 플레이 분량보다 지나치게 작다 (${demoSize})`);
assert.ok(demoSize <= 100 * 1024 * 1024, `데모 영상이 100MB를 넘는다 (${demoSize})`);
assert.equal(demo.includes(Buffer.from("NOT FOR SUBMISSION")), false, "데모 영상에 프리비즈 표식이 남았다");

const probeResult = spawnSync(
  "ffprobe",
  [
    "-v", "error", "-count_frames",
    "-show_entries",
    "format=duration:stream=codec_type,codec_name,pix_fmt,width,height,r_frame_rate,avg_frame_rate,nb_read_frames,sample_rate,channels",
    "-of", "json", "--", demoPath,
  ],
  { encoding: "utf8", windowsHide: true, timeout: 15_000 },
);
assert.equal(probeResult.error, undefined, `ffprobe를 실행하지 못했다: ${probeResult.error?.message}`);
assert.equal(probeResult.status, 0, `ffprobe가 데모 영상을 읽지 못했다: ${probeResult.stderr}`);
const probe = JSON.parse(probeResult.stdout);
const duration = Number(probe.format?.duration);
const video = probe.streams?.filter((stream) => stream.codec_type === "video") ?? [];
const audio = probe.streams?.filter((stream) => stream.codec_type === "audio") ?? [];
assert.ok(duration >= 30 && duration <= 180, `데모 영상 길이가 30~180초가 아니다 (${duration})`);
assert.equal(video.length, 1, `데모 영상 트랙이 정확히 1개가 아니다 (${video.length})`);
assert.equal(audio.length, 1, `데모 오디오 트랙이 정확히 1개가 아니다 (${audio.length})`);
assert.equal(video[0].codec_name, "h264", `데모 영상 코덱이 H.264가 아니다 (${video[0].codec_name})`);
assert.equal(video[0].width, 1280, `데모 영상 폭이 1280이 아니다 (${video[0].width})`);
assert.equal(video[0].height, 720, `데모 영상 높이가 720이 아니다 (${video[0].height})`);
assert.equal(video[0].pix_fmt, "yuv420p", `데모 영상 픽셀 형식이 yuv420p가 아니다 (${video[0].pix_fmt})`);
assert.equal(video[0].r_frame_rate, "30/1", `데모 영상 선언 프레임률이 30fps가 아니다 (${video[0].r_frame_rate})`);
assert.equal(video[0].avg_frame_rate, "30/1", `데모 영상 평균 프레임률이 30fps가 아니다 (${video[0].avg_frame_rate})`);
assert.ok(
  Math.abs(Number(video[0].nb_read_frames) - Math.round(duration * 30)) <= 1,
  `데모 영상 프레임 수가 CFR30 길이와 맞지 않는다 (${video[0].nb_read_frames}/${duration})`,
);
assert.equal(audio[0].codec_name, "aac", `데모 오디오 코덱이 AAC가 아니다 (${audio[0].codec_name})`);
assert.equal(audio[0].sample_rate, "48000", `데모 오디오가 48kHz가 아니다 (${audio[0].sample_rate})`);
assert.equal(audio[0].channels, 2, `데모 오디오가 스테레오가 아니다 (${audio[0].channels}ch)`);

const decodeResult = spawnSync(
  "ffmpeg",
  ["-v", "error", "-xerror", "-err_detect", "explode", "-i", demoPath, "-map", "0:v:0", "-map", "0:a:0", "-f", "null", process.platform === "win32" ? "NUL" : "/dev/null"],
  { encoding: "utf8", windowsHide: true, maxBuffer: 4 * 1024 * 1024, timeout: 120_000 },
);
assert.equal(decodeResult.error, undefined, `ffmpeg를 실행하지 못했다: ${decodeResult.error?.message}`);
assert.equal(decodeResult.status, 0, `데모 영상 전체 디코딩에 실패했다: ${decodeResult.stderr}`);

// 후보 커밋은 현재 제품의 수치·성능 증거까지 엄격히 검증하되, 그 커밋의 CI가
// 성공한 뒤에만 최종 배포 metadata를 적을 수 있다. 후보와 최종 마커를 분리해
// CI head가 자기 자신의 아직 존재하지 않는 run id를 요구하는 순환을 끊는다.
const finalEvidenceRequired = doc.includes("<!-- SUBMISSION_EVIDENCE_REQUIRED -->");
const candidateEvidenceRequired = doc.includes("<!-- SUBMISSION_EVIDENCE_CANDIDATE -->");
assert.equal(
  finalEvidenceRequired || candidateEvidenceRequired,
  true,
  "제출 문안에 후보 또는 최종 증거 마커가 없다",
);
assert.equal(
  finalEvidenceRequired && candidateEvidenceRequired,
  false,
  "제출 문안에 후보·최종 증거 마커가 동시에 있다",
);
if (finalEvidenceRequired || candidateEvidenceRequired) {
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
  assert.equal(
    release.status,
    finalEvidenceRequired ? "released" : "candidate",
    "문안 마커와 출고 manifest 상태가 다르다",
  );
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

  if (finalEvidenceRequired) {
    const evidenceCommit = /게임 출고 기준 증거·배포 커밋: `([0-9a-f]{40})`/.exec(doc)?.[1];
    assert.ok(evidenceCommit, "게임 출고 증거·배포 커밋을 찾지 못했다");
    assert.equal(evidenceCommit, release.evidenceCommit, "문서와 출고 manifest의 증거 커밋이 다르다");
    assert.notEqual(release.evidenceCommit, release.gameProductCommit, "제품과 증거 커밋은 분리되어야 한다");
    assert.equal(release.ci?.headSha, release.evidenceCommit, "CI HEAD가 출고 증거 커밋과 다르다");
    assert.equal(release.ci?.workflow, "Deploy to GitHub Pages", "출고 CI workflow가 배포 관문이 아니다");
    assert.equal(release.ci?.status, "completed", "출고 CI가 완료 상태가 아니다");
    assert.equal(release.ci?.conclusion, "success", "출고 CI가 성공 상태가 아니다");
    assert.equal(
      release.ci?.url,
      `https://github.com/mmporong/nyang-arena/actions/runs/${release.ci?.runId}`,
      "출고 CI URL과 run id가 다르다",
    );
    assert.ok(doc.includes(release.ci.url), "문서의 GitHub Actions 링크가 출고 manifest와 다르다");
  } else {
    assert.equal(release.evidenceCommit, null, "후보 manifest가 검증 전 evidence commit을 주장한다");
    assert.equal(release.ci, null, "후보 manifest가 검증 전 CI 성공을 주장한다");
    assert.ok(doc.includes("출고 후보 CI: 대기"), "후보 문안이 CI 대기 상태를 명시하지 않는다");
  }
}

console.log(
  `제출 문안 PASS — 제목 ${titleChars}/80자 · 소개 ${descriptionChars}/200자 · Codex ${codexProcessChars}/5000자 · 공유 ${share} · 썸네일 ${width}x${height} ${(size / 1024).toFixed(1)}KB · 영상 ${(demoSize / 1024 / 1024).toFixed(1)}MB`,
);
