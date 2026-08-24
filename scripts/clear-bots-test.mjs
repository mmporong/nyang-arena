import assert from "node:assert/strict";

import { newRun } from "../src/game/run.ts";
import { CLEAR_BASELINE_BOTS, CLEAR_INTEGRATED_BOTS } from "./clear-bots.mjs";
import { evaluateClearCriteria } from "./clear-criteria.mjs";
import { RAID_CONTRACT_POLICIES, walkMap } from "./bot-policy.mjs";

const integratedLabels = {
  "무의식": "보상 큰 계약",
  "기본 봇": "위험 낮은 계약",
  "조건 충족": "팀 읽고 고름",
};

assert.deepEqual(Object.keys(CLEAR_BASELINE_BOTS), Object.keys(integratedLabels), "4축 기준 봇 세 프로필이 바뀌었다");
assert.deepEqual(Object.keys(CLEAR_INTEGRATED_BOTS), Object.keys(integratedLabels), "5축 관찰 봇 세 프로필이 바뀌었다");
for (const [name, bot] of Object.entries(CLEAR_BASELINE_BOTS)) {
  assert.equal(bot.contractLabel, "위험 낮은 계약", `${name}의 4축 기준에서 계약 통제가 풀렸다`);
  assert.equal(bot.contract, RAID_CONTRACT_POLICIES["위험 낮은 계약"], `${name}의 4축 기준 계약 함수가 갈라졌다`);
}
for (const [name, label] of Object.entries(integratedLabels)) {
  const bot = CLEAR_INTEGRATED_BOTS[name];
  assert.equal(bot.contractLabel, label, `${name}의 계약 정책 설명이 실제 함수와 갈라졌다`);
  assert.equal(bot.contract, RAID_CONTRACT_POLICIES[label], `${name}이 명시한 계약 정책을 쓰지 않는다`);
}
assert.equal(
  new Set(Object.values(CLEAR_INTEGRATED_BOTS).map((bot) => bot.contract)).size,
  3,
  "5축 관찰의 세 페르소나가 같은 계약 판단 함수를 공유한다",
);

const contract = ({ id, risk, rewardFish, patterns, phase2Patterns = [] }) => ({
  id,
  name: id,
  rule: "테스트 규칙",
  counter: "테스트 대응",
  risk,
  rewardFish,
  patterns,
  phase2Patterns,
  proofCode: "TEST",
});
const roster = (kind, levels, relicCount = 0) => ({
  ally: levels.map((level) => ({ alive: true, level, breed: { kind } })),
  relics: Array.from({ length: relicCount }, () => ({})),
});

const safePrimaryOffers = [
  contract({ id: "rich_risky", risk: 3, rewardFish: 5, patterns: ["line", "cone", "polarity"] }),
  contract({ id: "poor_safe", risk: 1, rewardFish: 2, patterns: ["line", "cone", "polarity"] }),
];
const safeTieOffers = [
  contract({ id: "safe_poor", risk: 1, rewardFish: 2, patterns: ["line", "cone", "polarity"] }),
  contract({ id: "safe_rich", risk: 1, rewardFish: 5, patterns: ["line", "cone", "polarity"] }),
];
const rewardTieOffers = [
  contract({ id: "rich_risky", risk: 3, rewardFish: 5, patterns: ["line", "cone", "polarity"] }),
  contract({ id: "rich_safe", risk: 1, rewardFish: 5, patterns: ["line", "cone", "polarity"] }),
];
assert.equal(RAID_CONTRACT_POLICIES["첫 카드"](safePrimaryOffers, roster("melee", [1])), 0, "첫 카드 정책이 0번을 고르지 않는다");
assert.equal(RAID_CONTRACT_POLICIES["위험 낮은 계약"](safePrimaryOffers, roster("melee", [1])), 1, "안전 정책이 보상보다 위험을 먼저 보지 않는다");
assert.equal(RAID_CONTRACT_POLICIES["위험 낮은 계약"](safeTieOffers, roster("melee", [1])), 1, "안전 정책이 같은 위험에서 큰 보상을 고르지 않는다");
assert.equal(RAID_CONTRACT_POLICIES["보상 큰 계약"](safePrimaryOffers, roster("melee", [1])), 0, "보상 정책이 위험보다 보상을 먼저 보지 않는다");
assert.equal(RAID_CONTRACT_POLICIES["보상 큰 계약"](rewardTieOffers, roster("melee", [1])), 1, "보상 정책이 같은 보상에서 낮은 위험을 고르지 않는다");

const fitOffers = [
  contract({ id: "gather", risk: 1, rewardFish: 2, patterns: ["gather", "hearth", "seize"] }),
  contract({ id: "spread", risk: 1, rewardFish: 2, patterns: ["stomp", "quake", "sweep"] }),
  contract({ id: "neutral", risk: 1, rewardFish: 3, patterns: ["line", "cone", "polarity"] }),
];
assert.equal(RAID_CONTRACT_POLICIES["팀 읽고 고름"](fitOffers, roster("melee", [1, 1, 1, 1, 1, 1])), 0, "근접 팀이 집결형 계약을 선호하지 않는다");
assert.equal(RAID_CONTRACT_POLICIES["팀 읽고 고름"](fitOffers, roster("ranged", [1, 1, 1, 1, 1, 1])), 1, "원거리 팀이 산개형 계약을 선호하지 않는다");

const riskOffers = [
  contract({ id: "safe_neutral", risk: 1, rewardFish: 2, patterns: ["line", "cone", "polarity"] }),
  contract({ id: "risky_fit", risk: 2, rewardFish: 2, patterns: ["gather", "hearth", "seize"] }),
];
assert.equal(RAID_CONTRACT_POLICIES["팀 읽고 고름"](riskOffers, roster("melee", [1, 1, 1, 1, 1, 1])), 0, "약한 팀이 감당 못 할 위험을 고른다");
assert.equal(RAID_CONTRACT_POLICIES["팀 읽고 고름"](riskOffers, roster("melee", [2, 1, 1, 1, 1, 1])), 1, "강해진 팀이 감당 가능한 맞춤 계약을 고르지 않는다");
assert.equal(RAID_CONTRACT_POLICIES["팀 읽고 고름"](riskOffers, roster("melee", [1, 1, 1, 1, 1, 1], 1)), 1, "유물 전력이 위험 2 감당치에 반영되지 않는다");

const riskThreeOffers = [
  contract({ id: "risk_two_neutral", risk: 2, rewardFish: 2, patterns: ["line", "cone", "polarity"] }),
  contract({ id: "risk_three_fit", risk: 3, rewardFish: 2, patterns: ["gather", "hearth", "seize"] }),
];
assert.equal(RAID_CONTRACT_POLICIES["팀 읽고 고름"](riskThreeOffers, roster("melee", [2, 2, 2, 2, 2, 2])), 0, "전력 12 팀이 위험 3을 감당한다고 본다");
assert.equal(RAID_CONTRACT_POLICIES["팀 읽고 고름"](riskThreeOffers, roster("melee", [3, 2, 2, 2, 2, 2])), 1, "전력 13 팀이 맞춤 위험 3을 고르지 않는다");

const expectedSeedOne = {
  "4축/무의식": "iron_tremor",
  "4축/기본 봇": "iron_tremor",
  "4축/조건 충족": "iron_tremor",
  "5축/무의식": "last_rescue",
  "5축/기본 봇": "iron_tremor",
  "5축/조건 충족": "iron_tremor",
};
const groups = {
  "4축": CLEAR_BASELINE_BOTS,
  "5축": CLEAR_INTEGRATED_BOTS,
};
for (const [group, bots] of Object.entries(groups)) {
  for (const [name, bot] of Object.entries(bots)) {
    const state = newRun(1);
    walkMap(state, bot.map, bot.contract);
    assert.equal(state.raidContract?.id, expectedSeedOne[`${group}/${name}`], `${group}/${name}의 고정 시드 계약 전이가 바뀌었다`);
    assert.equal(state.raidOffers.length, 0, `${group}/${name}의 계약 선택 뒤 제안이 닫히지 않았다`);
  }
}

const exactBoundary = evaluateClearCriteria(
  { runs: 20, counts: [0, 4, 4, 0] },
  { runs: 20, counts: [17, 12, 12, 0] },
);
assert.deepEqual(
  exactBoundary.map(([, passed]) => passed),
  [true, true, true, true, true],
  "정확한 3배·20%·40%p·85% 경계가 부동소수점 오차로 미달 처리됐다",
);
const passed = (index, mindless, skilled) => evaluateClearCriteria(mindless, skilled)[index][1];
const boundaryMindless = { runs: 20, counts: [0, 4, 4, 0] };
const boundarySkilled = { runs: 20, counts: [17, 12, 12, 0] };
assert.equal(passed(0, boundaryMindless, { ...boundarySkilled, counts: [17, 12, 11, 0] }), false, "3배 바로 아래 2.75배가 통과한다");
assert.equal(passed(1, { ...boundaryMindless, counts: [0, 4, 5, 0] }, boundarySkilled), false, "무의식 S3 25%가 20% 상한을 통과한다");
assert.equal(passed(2, boundaryMindless, { ...boundarySkilled, counts: [17, 11, 12, 0] }), false, "S2 격차 35%p가 통과한다");
assert.equal(passed(3, boundaryMindless, { ...boundarySkilled, counts: [17, 12, 11, 0] }), false, "S3 격차 35%p가 통과한다");
assert.equal(passed(4, boundaryMindless, { ...boundarySkilled, counts: [16, 12, 12, 0] }), false, "조건 충족 S1 80%가 통과한다");
assert.equal(passed(0, { runs: 20, counts: [0, 0, 0, 0] }, { runs: 20, counts: [0, 0, 4, 0] }), true, "무의식 0건일 때 조건 S3 20%가 통과하지 않는다");
assert.equal(passed(0, { runs: 20, counts: [0, 0, 0, 0] }, { runs: 20, counts: [0, 0, 3, 0] }), false, "무의식 0건일 때 조건 S3 15%가 통과한다");

console.log("clear bot contract tests passed — 4축 통제 · 5축 의미 · 고정 시드 전이 · 정수 경계 판정");
