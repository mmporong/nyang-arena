/** 제출 폼에 붙일 문안·링크·썸네일의 기계 검증. */
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { parseRaidShareCode } from "../src/game/raid.ts";

const doc = readFileSync("docs/openai-builders.md", "utf8");
const description = /### 게임 소개[^\n]*\n\s*```text\s*\n([\s\S]*?)\n```/.exec(doc)?.[1]?.trim();
assert.ok(description, "200자 게임 소개 코드 블록을 찾지 못했다");
const descriptionChars = [...description].length;
assert.ok(descriptionChars <= 200, `게임 소개가 ${descriptionChars}자다 (상한 200)`);
assert.match(doc, /https:\/\/mmporong\.github\.io\/nyang-arena\//, "공개 플레이 URL이 없다");

const share = /NA1-[0-9A-Z]+-[a-z0-9_]+/.exec(doc)?.[0];
assert.ok(share && parseRaidShareCode(share), "3분 데모 공유 코드가 유효하지 않다");

const png = readFileSync("docs/thumbnail.png");
assert.equal(png.subarray(1, 4).toString("ascii"), "PNG", "썸네일이 PNG가 아니다");
const width = png.readUInt32BE(16);
const height = png.readUInt32BE(20);
assert.ok(Math.abs(width / height - 16 / 9) < 0.001, `썸네일이 16:9가 아니다 (${width}x${height})`);
const size = statSync("docs/thumbnail.png").size;
assert.ok(size <= 10 * 1024 * 1024, `썸네일이 10MB를 넘는다 (${size})`);

// 최종 문안이 검증 완료를 주장하는 순간부터 저장된 재현 증거도 함께 통과해야 한다.
// 작업 중 문안은 이 마커를 넣지 않아도 되지만, 제출본은 문구만 앞서갈 수 없다.
if (doc.includes("<!-- SUBMISSION_EVIDENCE_REQUIRED -->")) {
  const metrics = JSON.parse(readFileSync("docs/generated/metrics-current.json", "utf8"));
  assert.equal(metrics.generatedFrom?.reproducible, true, "제출 문안이 완료를 주장하지만 metrics가 재현 불가다");
  assert.equal(metrics.verification?.allSixPassed, true, "제출 문안이 완료를 주장하지만 6축이 PASS가 아니다");
  assert.equal(metrics.verification?.provenanceMatches, true, "제출 문안이 완료를 주장하지만 provenance가 불일치다");
  for (const [name, evidence] of Object.entries({
    contracts: metrics.verification?.raidContracts,
    mapPreparation: metrics.verification?.mapPreparation,
    mapSpace: metrics.verification?.mapSpace,
  })) {
    assert.equal(evidence?.source?.exitCode, 0, `${name} 증거 종료 코드가 0이 아니다`);
    assert.ok(Object.values(evidence?.gates ?? {}).every((value) => value === true), `${name} gate가 전부 PASS가 아니다`);
  }
}

console.log(
  `제출 문안 PASS — 소개 ${descriptionChars}/200자 · 공유 ${share} · 썸네일 ${width}x${height} ${(size / 1024).toFixed(1)}KB`,
);
