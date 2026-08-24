/**
 * 계약 준비 관문이 실제 지도 전이와 보스 결과에 닿는가?
 *
 * 위험 1/2/3의 추천 칸은 생성 지도에서 항상 열려야 하고, 실제
 * `chooseNode → leaveShop → startBattle/finishWave` 경로로 각각 생선·유물·회피를
 * 전달해야 한다. 고위험 정찰은 같은 경로를 밟은 뒤 회피 보너스만 제거한
 * 반사실과 비교해 보스 통과율 차이도 별도로 잰다.
 */
import { stepBattle } from "../src/game/battle.ts";
import { mkdirSync, writeFileSync } from "node:fs";
import {
  chooseNode,
  chooseSharedRaidContract,
  currentKind,
  finishWave,
  leaveShop,
  mapStep,
  newRun,
  scoutDodgeReward,
  startBattle,
} from "../src/game/run.ts";
import { openLanes } from "../src/game/map.ts";
import { raidContractById, raidPrepRoute } from "../src/game/raid.ts";
import { ARRANGERS, BUY_POLICIES, makeBossBot, shopStep } from "./bot-policy.mjs";
import { evidenceSource, invokedNodeCommand, sealEvidence } from "./evidence-source.mjs";

const RUNS = Number(process.argv[2] ?? 300);
const contracts = [
  raidContractById("falling_floor"),
  raidContractById("split_night"),
  raidContractById("spreading_dark"),
].filter(Boolean);

function openNodeOfKind(state, kind) {
  const step = mapStep(state);
  const row = state.map.steps[step] ?? [];
  return openLanes(state.map, step).find((idx) => row[idx]?.kind === kind);
}

/** 실제 첫 준비 칸을 밟아 위험별 자원이 상태에 들어오는지 본다. */
function exercisePrep(seed, contract) {
  const state = newRun(seed);
  if (!chooseSharedRaidContract(state, contract.id)) throw new Error(`계약 적용 실패: ${contract.id}`);
  const route = raidPrepRoute(contract);
  const idx = openNodeOfKind(state, route);
  if (idx === undefined) return { accessible: false, delivered: false, won: false };

  const before = { gold: state.gold, relics: state.relics.length, dodge: state.bonusDodge };
  if (!chooseNode(state, idx)) throw new Error(`준비 경로 진입 실패: ${contract.id}`);
  let won = true;
  if (state.phase === "reward") {
    leaveShop(state);
    // 전투 승패 난수만 제거하고 실제 국면 전이는 생략하지 않는다. 준비에서
    // 전투로 못 넘어가는 회귀도 이 관문이 잡아야 하므로 startBattle을 반드시
    // 통과한 뒤, 실제 전투가 호출하는 같은 finishWave 승리 경로를 사용한다.
    if (state.phase === "prepare") {
      startBattle(state);
      if (state.phase !== "battle") {
        throw new Error(`준비→전투 전이 실패: ${contract.id}`);
      }
      finishWave(state, true);
    }
  }
  const delivered = route === "battle"
    ? won && state.gold > before.gold
    : route === "elite"
      ? won && state.relics.length === before.relics + 1
      : state.bonusDodge === scoutDodgeReward(state) && state.bonusDodge > before.dodge;
  return { accessible: true, delivered, won };
}

/**
 * 고위험 계약의 실제 정찰→일반전→보스 경로. 두 조건은 같은 경로·구매·대형을
 * 쓰고 보스 시작 직전 정찰 회피를 유지할지 제거할지만 다르다.
 */
function fightFirstBoss(seed, contract, prepared) {
  const state = newRun(seed);
  if (!chooseSharedRaidContract(state, contract.id)) throw new Error(`계약 적용 실패: ${contract.id}`);
  const respond = makeBossBot();
  const shop = { rerolls: 0, lastWave: 0 };
  let bossStarted = false;

  for (let guard = 0; guard < 12000; guard++) {
    if (state.phase === "gameover") return false;
    if (bossStarted && state.phase !== "battle") return true;
    if (state.phase === "reward") {
      if (shopStep(state, shop, BUY_POLICIES["몰빵 피벗(로스터를 읽음)"]) !== "leave") continue;
      leaveShop(state);
      continue;
    }
    if (state.phase === "map") {
      const step = mapStep(state);
      const wanted = step === 0 ? raidPrepRoute(contract) : step === 1 ? "battle" : "boss";
      const idx = openNodeOfKind(state, wanted) ?? openLanes(state.map, step)[0];
      if (idx === undefined || !chooseNode(state, idx)) throw new Error(`시드 ${seed}: ${step}걸음 진입 실패`);
      continue;
    }
    if (state.phase === "prepare") {
      if (currentKind(state) === "boss") {
        bossStarted = true;
        if (!prepared) state.bonusDodge = 0;
      }
      ARRANGERS["보스 읽고 고름"]?.(state);
      startBattle(state);
      continue;
    }
    respond(state);
    stepBattle(state, 100);
  }
  throw new Error(`시드 ${seed}: 첫 보스 가드 초과`);
}

const routeEvidence = {};
console.log(`계약 준비 실제 전이 ${RUNS}시드 × 위험 3단계`);
console.log("위험  경로       접근       보상 전달");
for (const contract of contracts) {
  let accessible = 0;
  let delivered = 0;
  for (let i = 1; i <= RUNS; i++) {
    const result = exercisePrep(contract.risk * 100000 + i, contract);
    if (result.accessible) accessible += 1;
    if (result.delivered) delivered += 1;
  }
  routeEvidence[contract.id] = {
    risk: contract.risk,
    route: raidPrepRoute(contract),
    accessible,
    delivered,
  };
  console.log(
    `${contract.risk}     ${raidPrepRoute(contract).padEnd(8)} ${((accessible / RUNS) * 100).toFixed(1).padStart(6)}%   ${((delivered / RUNS) * 100).toFixed(1).padStart(6)}%`,
  );
}

const high = contracts.find((contract) => contract.risk === 3);
if (!high) throw new Error("고위험 계약이 없다");
let baseWon = 0;
let prepWon = 0;
for (let i = 1; i <= RUNS; i++) {
  const seed = 300000 + i;
  if (fightFirstBoss(seed, high, false)) baseWon += 1;
  if (fightFirstBoss(seed, high, true)) prepWon += 1;
}
const basePct = (baseWon / RUNS) * 100;
const prepPct = (prepWon / RUNS) * 100;
const gain = prepPct - basePct;
console.log(`\n고위험 실제 경로 보스 통과: ${basePct.toFixed(1)}% → ${prepPct.toFixed(1)}% (${gain >= 0 ? "+" : ""}${gain.toFixed(1)}%p)`);

const accessPass = Object.values(routeEvidence).every((row) => row.accessible === RUNS);
const deliveryPass = Object.values(routeEvidence).every((row) => row.delivered === RUNS);
const outcomePass = gain >= 1 && prepWon > baseWon;
const gates = { access: accessPass, delivery: deliveryPass, outcome: outcomePass };
const exitCode = Object.values(gates).every(Boolean) ? 0 : 1;
mkdirSync(".omx/evidence", { recursive: true });
const evidence = sealEvidence({
  source: evidenceSource(
    invokedNodeCommand("scripts/map-prep-space.mjs"),
    {
      routeRuns: [1, 2, 3].map((risk) => ({
        risk,
        from: risk * 100000 + 1,
        to: risk * 100000 + RUNS,
        runs: RUNS,
      })),
      outcome: { from: 300001, to: 300000 + RUNS, runs: RUNS },
    },
    exitCode,
  ),
  runs: RUNS,
  routes: routeEvidence,
  highRiskOutcome: {
    contractId: high.id,
    unpreparedPassPct: Number(basePct.toFixed(1)),
    preparedPassPct: Number(prepPct.toFixed(1)),
    gainPct: Number(gain.toFixed(1)),
  },
  gates,
});
writeFileSync(
  ".omx/evidence/map-prep.json",
  JSON.stringify(evidence, null, 2) + "\n",
);
if (!accessPass || !deliveryPass || !outcomePass) {
  console.error(`맵 준비 판정 실패 — 접근 ${accessPass}, 보상 ${deliveryPass}, 결과 ${outcomePass}`);
  process.exit(1);
}
console.log("맵 준비 판정 PASS — 세 경로가 항상 열리고 실제 보상과 보스 결과에 닿는다");
