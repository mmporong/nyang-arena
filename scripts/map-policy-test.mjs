/**
 * 악몽 계약 → 준비 경로의 결정적 계약.
 *
 * 전체 런은 경로마다 RNG 소비가 달라져 같은 시드 짝비교가 아니다. 여기서는
 * 한 번의 선택과 한 번의 보상만 고정해 브라우저와 봇이 같은 규칙을 쓰는지
 * 검증한다.
 */
import assert from "node:assert/strict";
import { BALANCE } from "../src/game/balance.ts";
import { chooseNode, finishWave, newRun, scoutDodgeReward } from "../src/game/run.ts";
import { makeStage, openLanes } from "../src/game/map.ts";
import { raidContractById, raidPrepRoute } from "../src/game/raid.ts";
import { MAP_POLICIES } from "./bot-policy.mjs";

const contracts = {
  1: raidContractById("falling_floor"),
  2: raidContractById("split_night"),
  3: raidContractById("spreading_dark"),
};
for (const risk of [1, 2, 3]) assert.ok(contracts[risk], `위험 ${risk} 계약이 없다`);

const row = [
  { kind: "battle" },
  { kind: "elite" },
  { kind: "shop" },
];
const open = [0, 1, 2];

for (const risk of [1, 2, 3]) {
  const state = newRun(8000 + risk);
  state.raidOffers = [];
  state.raidContract = contracts[risk];
  state.step = 0; // 계약 직후 준비 관문
  const idx = MAP_POLICIES["읽고 고름"](open, row, state);
  assert.equal(row[idx]?.kind, raidPrepRoute(contracts[risk]), `위험 ${risk} 추천 경로 불일치`);
}

// 실제 생성 지도에서도 두 계약 준비 관문마다 세 경로가 전부 열린다.
for (let seed = 1; seed <= 300; seed++) {
  const map = makeStage(1, seed);
  for (const step of [0, 3]) {
    if (step === 3) map.taken[2] = 0;
    const kinds = new Set(openLanes(map, step).map((idx) => map.steps[step]?.[idx]?.kind));
    for (const kind of ["battle", "elite", "shop"]) {
      assert.ok(kinds.has(kind), `시드 ${seed} · 준비 ${step}: ${kind} 경로가 닫혔다`);
    }
  }
}

// 준비 관문이 아닌 일반 갈림길에서는 선호 칸이 없어도 열린 칸만 반환한다.
{
  const state = newRun(8100);
  state.raidOffers = [];
  state.raidContract = contracts[3];
  state.step = 1;
  const idx = MAP_POLICIES["읽고 고름"]([0, 1], row, state);
  assert.ok(idx === 0 || idx === 1, "닫힌 정찰 칸을 골랐다");
}

// 중간의 정예는 보장 유물을 얻는다. 낮음은 기존 일반 전투 보상, 높음은 아래
// 정찰 보상을 쓰므로 인위적인 네 번째 자원을 만들지 않는다.
{
  const state = newRun(8201);
  state.raidOffers = [];
  state.raidContract = contracts[2];
  state.step = 1;
  state.nodeKind = "elite";
  state.nodeWave = "snipe";
  const before = state.relics.length;
  finishWave(state, true);
  assert.equal(state.relics.length, before + 1, "위험 2 정예가 보장 유물을 주지 않았다");
  assert.equal(state.bonusDodge, 0, "위험 2 정예에 회피를 중복 지급했다");
}

// 회피는 고위험 계약의 대응 자원이다. 낮은 계약이 정찰을 골라도 공짜 회피는 없다.
{
  const low = newRun(8301);
  low.raidOffers = [];
  low.raidContract = contracts[1];
  const high = newRun(8303);
  high.raidOffers = [];
  high.raidContract = contracts[3];
  assert.equal(scoutDodgeReward(low), 0);
  assert.equal(
    scoutDodgeReward(high),
    BALANCE.scoutDodgeBonus + BALANCE.contractPrepDodge,
  );
}

// 정찰 준비는 가장 좋은 한 번만 남고 여러 칸을 순회해 중첩할 수 없다.
{
  const state = newRun(8403);
  state.raidOffers = [];
  state.raidContract = contracts[3];
  state.step = 1;
  state.map.taken[0] = 0;
  state.map.steps[0][0].next = [0];
  state.map.steps[1] = [{ kind: "shop", wave: "mixed", lane: 0, next: [0] }];
  state.bonusDodge = 9;
  assert.equal(chooseNode(state, 0), true, "정찰 픽스처 진입 실패");
  assert.equal(state.bonusDodge, 9, "기존보다 낮은 정찰 준비가 중첩됐다");
}

console.log(
  `맵 정책 계약 PASS — 낮음→일반 전투, 중간→보장 유물, 높음→정찰 회피 +${BALANCE.scoutDodgeBonus + BALANCE.contractPrepDodge}`,
);
