import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { bossForIndex, bossKit, raidRiskPower } from "../src/game/bosses.ts";
import { BALANCE } from "../src/game/balance.ts";
import { breedById } from "../src/game/breeds.ts";
import { openLanes } from "../src/game/map.ts";
import { stepBattle } from "../src/game/battle.ts";
import {
  activeRaidContract,
  bossIndexAt,
  chooseNode,
  chooseRaidContract,
  chooseSharedRaidContract,
  finishWave,
  leaveShop,
  mapStep,
  makeCat,
  newRun,
  raidBossPower,
  raidPrepMatched,
  startBattle,
} from "../src/game/run.ts";
import {
  parseRaidSeed,
  parseRaidShareCode,
  raidContractOffers,
  raidPrepRoute,
  raidShareCode,
} from "../src/game/raid.ts";
import { RAID_CONTRACT_POOL } from "../src/validate/raid-contract-schema.ts";
import {
  ARRANGERS,
  BUY_POLICIES,
  makeBossBot,
  MAP_POLICIES,
  RAID_CONTRACT_POLICIES,
  shopStep,
  walkMap,
} from "./bot-policy.mjs";

function seedTestCat(state, cell = 12) {
  state.ally[cell] = makeCat(breedById(1), "ally", cell);
}

function chooseBattleNode(state) {
  const step = mapStep(state);
  const row = state.map.steps[step] ?? [];
  const open = openLanes(state.map, step);
  const idx = open.find((candidate) => row[candidate]?.kind === "battle") ?? open[0];
  assert.notEqual(idx, undefined, `걸음 ${step}: 열린 칸이 있어야 한다`);
  assert.equal(chooseNode(state, idx), true, `걸음 ${step}: 칸 선택 실패`);
}

function reachFirstBoss(state) {
  while (state.step < 2) {
    chooseBattleNode(state);
    finishWave(state, true);
  }
  const bossIdx = openLanes(state.map, state.step)[0];
  assert.notEqual(bossIdx, undefined, "첫 보스 칸이 열려야 한다");
  assert.equal(chooseNode(state, bossIdx), true, "첫 보스 칸 선택 실패");
}

const seed = 424242;

// 카드 문구와 실행 배열은 같은 대응을 말해야 한다. 패턴만 바꾸고 카피를
// 그대로 두면 플레이어가 산개/집결 중 틀린 행동을 학습한다.
const mirrorHunt = RAID_CONTRACT_POOL.find(({ id }) => id === "mirror_hunt");
assert(mirrorHunt, "거울 사냥 계약이 출고 풀에 있어야 한다");
assert.equal(
  [...mirrorHunt.patterns, ...(mirrorHunt.phase2Patterns ?? [])].includes("polarity"),
  true,
  "거울 사냥 실행 배열에 극성이 있어야 한다",
);
assert.equal(mirrorHunt.patterns.includes("hearth"), true, "거울 사냥 전반에 구원로가 있어야 한다");
assert.equal(mirrorHunt.patterns.includes("seize"), true, "거울 사냥 전반에 집결 표식이 있어야 한다");
assert.equal(mirrorHunt.phase2Patterns?.includes("circle"), true, "거울 사냥 후반에 원형 장판이 있어야 한다");
assert.match(mirrorHunt.rule, /극성/);
assert.match(mirrorHunt.rule, /구원로/);
assert.match(mirrorHunt.rule, /원형 장판/);
assert.match(mirrorHunt.counter, /모여/);
assert.match(mirrorHunt.counter, /밖으로/);

assert.equal(parseRaidSeed("424242"), seed, "십진 데모 시드를 읽어야 한다");
assert.equal(parseRaidSeed(" 424242 "), seed, "시드 양끝 공백은 무시해야 한다");
assert.equal(parseRaidSeed("FFFFFFFF"), null, "십진수가 아닌 시드를 허용했다");
assert.equal(parseRaidSeed("4294967296"), null, "32비트 초과 데모 시드를 허용했다");
assert.equal(parseRaidSeed("-1"), null, "음수 데모 시드를 허용했다");
assert.equal(parseRaidSeed("4e2"), null, "지수 표기 데모 시드를 허용했다");
assert.equal(parseRaidSeed("9".repeat(2000)), null, "초장문 데모 시드를 허용했다");
const first = newRun(seed);
const second = newRun(seed);

assert.equal(first.phase, "map");
assert.equal(first.raidOffers.length, 3, "첫 화면에 계약 세 장이 열려야 한다");
assert.equal(new Set(first.raidOffers.map(({ id }) => id)).size, 3, "제안 세 장은 서로 달라야 한다");
assert.deepEqual(
  first.raidOffers.map(({ id }) => id),
  second.raidOffers.map(({ id }) => id),
  "같은 시드의 첫 계약 제안과 순서는 같아야 한다",
);
assert.deepEqual(
  raidContractOffers(seed, 0).map(({ id }) => id),
  raidContractOffers(seed, 0).map(({ id }) => id),
  "독립 계약 추첨도 결정적이어야 한다",
);

// 카드가 열려 있으면 뒤의 지도를 누를 수 없다.
const firstMapIdx = openLanes(first.map, first.step)[0];
assert.notEqual(firstMapIdx, undefined);
assert.equal(chooseNode(first, firstMapIdx), false, "계약 선택 전 지도 입력이 새면 안 된다");

assert.equal(chooseRaidContract(first, 0), true);
seedTestCat(first);
const picked = first.raidContract;
assert(picked, "선택한 계약이 상태에 남아야 한다");
assert.equal(first.raidOffers.length, 0);
assert.equal(chooseRaidContract(first, 0), false, "반복 숫자 입력으로 계약이 바뀌면 안 된다");
assert.equal(chooseRaidContract(first, -1), false, "음수 카드 인덱스를 허용했다");
assert.equal(chooseRaidContract(first, 99), false, "범위 밖 카드 인덱스를 허용했다");
assert.equal(activeRaidContract(first), null, "일반전에는 다음 보스 계약이 적용되면 안 된다");

const code = raidShareCode(first.seed, picked.id);
const parsed = parseRaidShareCode(code);
assert.deepEqual(parsed, { seed: seed >>> 0, contractId: picked.id }, "공유 코드가 시드와 계약을 보존해야 한다");
assert.equal(parseRaidShareCode("NA1-!!!-delete_board"), null, "깨진 공유 코드는 거절해야 한다");
assert.equal(parseRaidShareCode("NA1-ZZZZZZZ-split_night"), null, "32비트 초과 seed를 허용했다");
assert.equal(parseRaidShareCode("NA1-93CI-../../secret"), null, "경로형 계약 id를 허용했다");
assert.equal(parseRaidShareCode("NA1-93CI-갈라진밤"), null, "Unicode 계약 id를 허용했다");
assert.equal(parseRaidShareCode(`NA1-93CI-${"a".repeat(2000)}`), null, "초장문 공유 코드를 허용했다");
assert.equal(parseRaidShareCode(null), null, "빈 공유 코드를 허용했다");
const shared = newRun(parsed.seed);
assert.equal(chooseSharedRaidContract(shared, parsed.contractId), true);
assert.equal(shared.raidContract?.id, picked.id, "공유 런이 같은 첫 계약을 적용해야 한다");

const invalidPolicy = newRun(seed);
assert.throws(
  () => walkMap(invalidPolicy, MAP_POLICIES["읽고 고름"], () => 999),
  /유효하지 않은 인덱스/,
  "측정 봇이 잘못된 계약 정책을 첫 카드로 대체하면 안 된다",
);

function reachHighRiskBoss(prepRoute) {
  const state = newRun(7007);
  seedTestCat(state);
  assert.equal(chooseSharedRaidContract(state, "spreading_dark"), true);
  const step = mapStep(state);
  const row = state.map.steps[step] ?? [];
  const prepIdx = openLanes(state.map, step).find((candidate) => row[candidate]?.kind === prepRoute);
  assert.notEqual(prepIdx, undefined, `${prepRoute} 준비 경로가 열려야 한다`);
  assert.equal(chooseNode(state, prepIdx), true);
  if (prepRoute === "shop") leaveShop(state);
  else finishWave(state, true);
  while (state.step < 2) {
    chooseBattleNode(state);
    finishWave(state, true);
  }
  const bossIdx = openLanes(state.map, state.step)[0];
  assert.notEqual(bossIdx, undefined);
  assert.equal(chooseNode(state, bossIdx), true);
  return state;
}

const prepared = reachHighRiskBoss(raidPrepRoute({ risk: 3 }));
assert.equal(raidPrepMatched(prepared), true, "추천 이중 고리가 계약 대비로 기록되어야 한다");
const preparedBoss = bossForIndex(bossIndexAt(prepared));
const preparedPower = bossKit(preparedBoss.id, activeRaidContract(prepared)).power;
assert.equal(raidBossPower(prepared, preparedBoss.id), preparedPower, "추천 경로는 계약 보스 강도를 더 올리면 안 된다");
leaveShop(prepared);
startBattle(prepared);
assert.equal(
  prepared.dodgeCharges,
  BALANCE.dodgeCharges + BALANCE.scoutDodgeBonus + BALANCE.contractPrepDodge,
  "고위험 추천 정찰은 보스 회피를 모두 전달해야 한다",
);

const unprepared = reachHighRiskBoss("battle");
assert.equal(raidPrepMatched(unprepared), false, "다른 경로를 추천 대비로 인정하면 안 된다");
const unpreparedBoss = bossForIndex(bossIndexAt(unprepared));
const unpreparedPower = bossKit(unpreparedBoss.id, activeRaidContract(unprepared)).power;
assert.equal(
  raidBossPower(unprepared, unpreparedBoss.id),
  unpreparedPower * BALANCE.contractMismatchPower,
  "추천 경로를 무시한 계약 보스는 체력·광역 피해가 더 세야 한다",
);
leaveShop(unprepared);
startBattle(unprepared);
assert.equal(
  unprepared.dodgeCharges,
  BALANCE.dodgeCharges,
  "추천 경로 불일치는 입력 자원을 빼앗지 않고 보스 강도로만 반영해야 한다",
);

reachFirstBoss(first);
const active = activeRaidContract(first);
assert.equal(active?.id, picked.id, "대상 보스에서만 선택 계약이 활성화되어야 한다");
const breed = bossForIndex(bossIndexAt(first));
const baseKit = bossKit(breed.id);
const kit = bossKit(breed.id, active);
const riskMul = raidRiskPower(picked.risk);
assert.equal(kit.power, baseKit.power * riskMul, "위험도가 체력·광역 피해 power에 반영되어야 한다");
assert.deepEqual(kit.patterns, picked.patterns, "계약 patterns가 기본 보스 배열을 교체해야 한다");
assert.deepEqual(
  kit.phase2Patterns,
  picked.phase2Patterns ?? picked.patterns,
  "계약 후반 배열이 우두머리 페이즈 2에 적용되어야 한다",
);

finishWave(first, true);
assert.equal(first.raidContractsWon, 1, "계약 보스 승리 횟수가 기록되어야 한다");
assert.equal(first.raidBonusFish, picked.rewardFish, "승리할 때만 계약 추가 생선을 얻어야 한다");
assert.equal(first.lastRaidContract?.id, picked.id, "완료 계약이 부검 기록에 남아야 한다");
assert.equal(first.raidContract, null, "끝난 계약은 다음 보스에 재사용되면 안 된다");
assert.equal(first.raidOffers.length, 3, "보스 승리 직후 다음 계약 세 장이 열려야 한다");
assert.equal(first.relicDraftPending, true, "보스 승리 뒤 다음 보상에 유물 드래프트가 예약되어야 한다");

// 브라우저의 기본 버튼은 reward에서 leaveShop→startBattle을 연달아 부른다.
// 유물 건너뛰기는 드래프트만 닫고 일반 카드 세 장을 보여 줘야 하며, 같은
// 입력이 전투 시작까지 새면 플레이어가 구매·배치를 통째로 잃는다.
assert.equal(chooseRaidContract(first, 0), true, "다음 보스 계약을 골라야 한다");
chooseBattleNode(first);
assert.equal(first.phase, "reward");
assert.equal(first.relicDraftActive, true, "첫 보상 화면이 유물 드래프트여야 한다");
assert.equal(first.offers.filter((offer) => offer?.kind === "relic").length, 3, "유물 세 장이 보여야 한다");
leaveShop(first);
assert.equal(first.phase, "reward", "유물 건너뛰기는 일반 보상 화면에 남아야 한다");
assert.equal(first.relicDraftActive, false);
assert.equal(first.offers.some((offer) => offer?.kind !== "relic"), true, "일반 카드가 이어져야 한다");
startBattle(first);
assert.equal(first.phase, "reward", "같은 건너뛰기 입력으로 전투까지 시작하면 안 된다");
leaveShop(first);
assert.equal(first.phase, "prepare");
startBattle(first);
assert.equal(first.phase, "battle", "다음 기본 입력에서만 전투가 시작되어야 한다");

const loss = newRun(seed);
assert.equal(chooseRaidContract(loss, 0), true);
reachFirstBoss(loss);
finishWave(loss, false);
assert.equal(loss.phase, "gameover");
assert.equal(loss.raidBonusFish, 0, "패배한 계약은 보상을 주면 안 된다");
assert.equal(loss.raidContractsWon, 0);
assert.equal(loss.raidContract?.id, picked.id, "실패 계약은 부검을 위해 남아야 한다");

function deterministicSummary(runSeed) {
  const state = newRun(runSeed);
  const respond = makeBossBot();
  const shop = { rerolls: 0, lastWave: 0 };
  for (let guard = 0; guard < 60 * 4000 && state.phase !== "gameover"; guard++) {
    if (state.phase === "map") {
      walkMap(state, MAP_POLICIES["읽고 고름"], RAID_CONTRACT_POLICIES["팀 읽고 고름"]);
    } else if (state.phase === "reward") {
      if (shopStep(state, shop, BUY_POLICIES["몰빵 피벗(로스터를 읽음)"]) === "leave") leaveShop(state);
    } else if (state.phase === "prepare") {
      ARRANGERS["보스 읽고 고름"]?.(state);
      startBattle(state);
    } else {
      respond(state);
      stepBattle(state, 100);
    }
  }
  return {
    wave: state.wave,
    phase: state.phase,
    gold: state.gold,
    stage: state.map.stage,
    step: state.step,
    raidContractsWon: state.raidContractsWon,
    raidBonusFish: state.raidBonusFish,
    lastRaidContract: state.lastRaidContract?.id ?? null,
    relics: state.relics.map(({ id }) => id).sort(),
    ally: state.ally.filter(Boolean).map((cat) => ({ breed: cat.breed.id, level: cat.level, cell: cat.cell })),
  };
}

const summaryA = deterministicSummary(seed);
const summaryB = deterministicSummary(seed);
assert.deepEqual(summaryA, summaryB, "같은 시드·정책의 최종 요약이 달라졌다");
const summaryHash = createHash("sha256").update(JSON.stringify(summaryA)).digest("hex");

console.log(
  `악몽 계약 흐름 PASS — 첫 화면 3장 · 공유 ${code} · ${breed.name} 패턴 교체 · 승리 +${picked.rewardFish} / 패배 +0 · 최종 ${summaryHash.slice(0, 12)}`,
);
