import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  raidContractPoolStatus,
  RAID_PATTERN_TOKENS,
  RAID_CONTRACT_POOL,
  RAID_REWARD_RANGE,
  RAID_RISK_RANGE,
  resolveRaidContractPool,
  validateRaidContract,
  validateRaidContracts,
} from "../src/validate/raid-contract-schema.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const candidates = readJson(resolve(HERE, "raid-contract-candidates.json"));
const hostile = readJson(resolve(HERE, "raid-contract-adversarial.json"));
const shipped = readJson(resolve(ROOT, "src/data/raid-contracts.json"));

const accepted = validateRaidContracts(candidates);
assert.equal(accepted.rejected.length, 0, "출고 후보에 거절 항목이 없어야 한다");
assert.equal(accepted.accepted.length, 6, "출고 계약은 정확히 6개여야 한다");
assert.deepEqual(shipped, accepted.accepted, "출고 JSON은 후보 검증 결과와 같아야 한다");
assert.deepEqual(RAID_CONTRACT_POOL, shipped, "런타임 풀은 출고 JSON의 검증 결과여야 한다");
assert(Object.isFrozen(RAID_CONTRACT_POOL), "런타임 풀 배열은 변경 불가능해야 한다");
for (const contract of RAID_CONTRACT_POOL) {
  assert(Object.isFrozen(contract), `${contract.id}: 런타임 계약 객체가 동결되지 않음`);
  assert(Object.isFrozen(contract.patterns), `${contract.id}: patterns가 동결되지 않음`);
  if (contract.phase2Patterns) {
    assert(Object.isFrozen(contract.phase2Patterns), `${contract.id}: phase2Patterns가 동결되지 않음`);
  }
}

const firstPass = validateRaidContracts(hostile);
const secondPass = validateRaidContracts(hostile);
assert.deepEqual(firstPass, secondPass, "동일 입력의 검증 결과는 결정적이어야 한다");

const rejectedReasons = firstPass.rejected.map(({ reason }) => reason);
assert(rejectedReasons.some((reason) => reason.includes("허용되지 않은 패턴: laser_beam")), "금지 토큰 거절 누락");
assert(rejectedReasons.some((reason) => reason.includes("허용되지 않은 패턴: half")), "극성 전용 half 직접 사용 거절 누락");
assert(rejectedReasons.some((reason) => reason.includes("id 중복: duplicate_contract")), "중복 id 거절 누락");
assert(rejectedReasons.some((reason) => reason.includes("patterns가 최소 3개보다 적음")), "짧거나 빈 patterns 거절 누락");
assert(rejectedReasons.some((reason) => reason.includes("phase2Patterns에 허용되지 않은 패턴")), "금지 후반 토큰 거절 누락");
assert(rejectedReasons.some((reason) => reason.includes("새니타이즈 후 비었음")), "빈 문구 거절 누락");

const clamped = firstPass.accepted.find(({ id }) => id === "clamped_numbers");
assert(clamped, "범위 초과 수치 후보는 안전하게 클램프되어 통과해야 한다");
assert.equal(clamped.risk, RAID_RISK_RANGE[1]);
assert.equal(clamped.rewardFish, RAID_REWARD_RANGE[1]);

for (const contract of [...accepted.accepted, ...firstPass.accepted]) {
  assert(contract.risk >= RAID_RISK_RANGE[0] && contract.risk <= RAID_RISK_RANGE[1]);
  assert(contract.rewardFish >= RAID_REWARD_RANGE[0] && contract.rewardFish <= RAID_REWARD_RANGE[1]);
  for (const token of [...contract.patterns, ...(contract.phase2Patterns ?? [])]) {
    assert(RAID_PATTERN_TOKENS.includes(token), `${contract.id}: 출고 불가 토큰 ${token}`);
  }
}

// UltraQA: 파일 JSON으로 표현하기 어렵거나 크기가 큰 입력도 같은 경계를 지난다.
assert.equal(validateRaidContracts({ contracts: [] }).accepted.length, 0, "최상위 객체를 배열로 오인했다");
assert.match(validateRaidContracts({ contracts: [] }).rejected[0]?.reason ?? "", /최상위 값이 배열이 아님/);
assert.equal(
  validateRaidContract({
    ...candidates[0],
    id: "../../secret",
  }).ok,
  false,
  "경로형 id를 허용했다",
);
assert.equal(validateRaidContract({ ...candidates[0], risk: Number.POSITIVE_INFINITY }).ok, false, "Infinity 위험 허용");
assert.equal(validateRaidContract({ ...candidates[0], rewardFish: Number.NaN }).ok, false, "NaN 보상 허용");
assert.equal(validateRaidContract({ ...candidates[0], name: "🐱" }).ok, false, "한 코드포인트 이름 허용");
assert.equal(validateRaidContract({ ...candidates[0], name: "🐱별" }).ok, true, "두 코드포인트 이름 거절");

for (const incompleteShipment of [
  candidates.slice(0, 5),
  [...candidates.slice(0, 5), { ...candidates[5], name: "X" }],
  [...candidates, { ...candidates[0], id: "seventh_contract" }],
]) {
  const fallback = resolveRaidContractPool(incompleteShipment);
  assert(fallback.length >= 3, "원자적 폴백은 첫 화면 3장을 보장해야 한다");
  assert(fallback.every(({ id }) => id.startsWith("safe_")), "부분 출고 풀이 런타임에 섞였다");
  assert(Object.isFrozen(fallback), "폴백 풀 배열은 변경 불가능해야 한다");
  const status = raidContractPoolStatus(incompleteShipment);
  assert.equal(status.usingFallback, true, "불완전 출고의 폴백 상태를 숨겼다");
  assert.equal(status.expected, 6);
  assert.ok(status.accepted !== 6 || status.rejected.length > 0, "폴백 원인이 상태에 남지 않았다");
}
assert.equal(raidContractPoolStatus(shipped).valid, true, "정상 출고 풀이 폴백으로 표시됐다");

const unicode = validateRaidContract({
  ...candidates[0],
  id: "unicode_trim",
  name: `<고\u202E양>${"🐱".repeat(20)}`,
  rule: `\u0000<script>${"가".repeat(80)}`,
  counter: `\u2066${"나".repeat(80)}>` ,
  proofCode: "UNICODE-1",
});
assert.equal(unicode.ok, true, "Unicode 초장문은 안전하게 정리해 채택해야 한다");
if (unicode.ok) {
  assert.equal([...unicode.contract.name].length <= 7, true, "이름 코드포인트 상한 위반");
  assert.equal([...unicode.contract.rule].length <= 34, true, "규칙 코드포인트 상한 위반");
  assert.equal([...unicode.contract.counter].length <= 34, true, "대응 코드포인트 상한 위반");
  assert.doesNotMatch(
    `${unicode.contract.name}${unicode.contract.rule}${unicode.contract.counter}`,
    /[<>\u0000-\u001f\u007f\u202e\u2066]/iu,
    "제어문자·방향 제어·꺾쇠가 남았다",
  );
}

console.log(`악몽 계약 검증 PASS — 출고 ${accepted.accepted.length}, 적대 거절 ${firstPass.rejected.length}, 수치 클램프 2`);
