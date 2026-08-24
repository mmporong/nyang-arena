/**
 * 악몽 계약 결정 공간.
 *
 * 홀드아웃 시드에서 구매와 전투 중 공개 예고 대응은 고정한다. 비교군은 보상
 * 숫자만 보고 기존 안전 경로·기존 보스 대형을 쓰며, 인지 정책은 카드가 미리
 * 알려 준 위험별 준비 경로·패턴별 대형까지 적용한다. 이 둘이 결과를 가르지
 * 못하면 계약은 게임 규칙이 아니라 보너스 선택창에 불과하다.
 *
 * 실행: npm run contracts [런 수] [시드 오프셋]
 */
import { chooseSharedRaidContract, currentKind, mapStep, newRun, startBattle } from "../src/game/run.ts";
import { stepBattle } from "../src/game/battle.ts";
import { isRaidPrepStep } from "../src/game/map.ts";
import { mkdirSync, writeFileSync } from "node:fs";
import { runSharded } from "./parallel.mjs";
import { evidenceSource, invokedNodeCommand, sealEvidence } from "./evidence-source.mjs";
import { RAID_CONTRACT_POOL } from "../src/validate/raid-contract-schema.ts";
import {
  ARRANGERS,
  BUY_POLICIES,
  leaveShop,
  makeBossBot,
  MAP_POLICIES,
  RAID_CONTRACT_POLICIES,
  shopStep,
  walkMap,
} from "./bot-policy.mjs";

// 300판 블록은 물론 900판 블록도 중앙값이 18/21 사이를 오갔다. 특정 구간에
// 맞춰 밸런스를 바꾸지 않고 서로 겹치지 않는 여섯 블록을 합쳐 1800판에 건다.
const RUNS = Number(process.argv[2] ?? 1800);
const SEED0 = Number(process.argv[3] ?? 10000);
const MAX_WAVE = 60;

/** 계약의 위험/추천 경로를 읽지 않는 기존 게임식 안전 경로. */
function mapWithoutContract(open, row, state) {
  if (isRaidPrepStep(mapStep(state))) {
    return open.find((idx) => row[idx]?.kind === "battle") ?? open[0];
  }
  // 준비 관문 밖에서는 비교군도 같은 일반 지도 정책을 쓴다. 차이는 계약
  // 카드가 알려 준 위험별 경로를 적용했는지에만 남긴다.
  return MAP_POLICIES["읽고 고름"](open, row, { ...state, raidContract: null });
}

function arrangeForContract(state) {
  const contract = state.raidContract;
  if (!contract || state.nodeKind !== "boss") return ARRANGERS["보스 읽고 고름"](state);
  const patterns = [...contract.patterns, ...(contract.phase2Patterns ?? [])];
  const gather = patterns.filter((p) => p === "gather" || p === "hearth" || p === "seize").length;
  const spread = patterns.filter((p) => p === "stomp" || p === "quake" || p === "sweep" || p === "circle").length;
  return gather > spread
    ? ARRANGERS["한 칸에 몰기"](state)
    : ARRANGERS["세로로 분산"](state);
}

const POLICIES = {
  "보상만 봄": {
    contract: RAID_CONTRACT_POLICIES["보상 큰 계약"],
    // 숫자 보상만 보는 기준선은 계약 본문의 패턴/대응 문구를 읽지 않는다.
    // 기존 보스 정체성에 맞춘 대형까지만 쓰게 해야, 계약 대응까지 적용한 뒤
    // "보상만 본다"고 잘못 부르는 오염을 막을 수 있다.
    arrange: ARRANGERS["보스 읽고 고름"],
    map: mapWithoutContract,
    // 전투 중 공개 예고에는 반응한다. 비교에서 빼는 것은 계약 카드가 미리
    // 알려 준 추천 경로와 전용 대형뿐이라, 일부러 못 싸우는 허수아비가 아니다.
    readTelegraphs: true,
  },
  "계약 읽음": {
    contract: RAID_CONTRACT_POLICIES["팀 읽고 고름"],
    arrange: arrangeForContract,
    map: MAP_POLICIES["읽고 고름"],
    readTelegraphs: true,
  },
};

function play(policy, seed) {
  const state = newRun(seed);
  const respond = makeBossBot({ read: policy.readTelegraphs ?? true });
  const shop = { rerolls: 0, lastWave: 0 };
  const chosen = {};
  let bossActive = false;
  let firstTwoTried = 0;
  let firstTwoWon = 0;
  let firstChosen = null;
  const contractPick = policy.contract;

  for (let guard = 0; guard < MAX_WAVE * 4000; guard++) {
    if (state.phase === "gameover") {
      return { wave: state.wave, firstTwoTried, firstTwoWon, chosen, firstChosen, capped: false };
    }
    if (state.phase === "reward") {
      if (shopStep(state, shop, BUY_POLICIES["몰빵 피벗(로스터를 읽음)"]) !== "leave") continue;
      leaveShop(state);
      continue;
    }
    if (state.phase === "map") {
      const before = state.raidContract?.id ?? null;
      // 계약별 홀드아웃의 관측 구간인 첫 두 보스에는 같은 id를 적용한다.
      // 첫 보스만 강제한 뒤 둘째를 다른 계약으로 고르면 `firstTwoBossPass`가
      // 두 계약을 섞는다. 반대로 런 끝까지 같은 계약을 강제하면 실제 제안
      // 순환에는 없는 누적 스트레스가 보상 경제를 지배하므로 두 보스로 닫는다.
      if (
        policy.forcedContractId &&
        firstTwoTried < 2 &&
        state.raidOffers.length > 0 &&
        !chooseSharedRaidContract(state, policy.forcedContractId)
      ) {
        throw new Error(`강제 계약 적용 실패: ${policy.forcedContractId}`);
      }
      walkMap(state, policy.map ?? MAP_POLICIES["읽고 고름"], contractPick);
      const after = state.raidContract?.id ?? null;
      if (after && after !== before) {
        chosen[after] = (chosen[after] ?? 0) + 1;
        if (firstChosen === null) firstChosen = after;
      }
      continue;
    }
    if (state.phase === "prepare") {
      if (state.wave > MAX_WAVE) return { wave: MAX_WAVE, firstTwoTried, firstTwoWon, chosen, firstChosen, capped: true };
      if (currentKind(state) === "boss") {
        bossActive = true;
        if (firstTwoTried < 2) firstTwoTried += 1;
      }
      policy.arrange?.(state);
      startBattle(state);
      if (state.phase !== "battle") return { wave: state.wave, firstTwoTried, firstTwoWon, chosen, firstChosen, capped: false };
      continue;
    }
    respond(state);
    stepBattle(state, 100);
    if (bossActive && state.phase !== "battle") {
      if (state.phase !== "gameover" && firstTwoWon < firstTwoTried && firstTwoTried <= 2) firstTwoWon += 1;
      bossActive = false;
    }
  }
  return { wave: state.wave, firstTwoTried, firstTwoWon, chosen, firstChosen, capped: true };
}

const names = Object.keys(POLICIES);
// 노출 빈도의 영향을 없애려고 출고 6종을 모든 홀드아웃 시드의 첫 두 보스에 각각 강제한다.
// 경로별 RNG 소비가 달라지므로 시드별 순위는 판정하지 않고 독립 표본 평균과
// 95% 구간만 비교한다(map-space의 평균 비교와 같은 원칙).
const forcedNames = RAID_CONTRACT_POOL.map(({ id }) => `강제:${id}`);
const allSharded = await runSharded(
  import.meta.url,
  [...names, ...forcedNames],
  (name, seed) => {
    if (POLICIES[name]) return play(POLICIES[name], seed);
    return play(
      {
        contract: RAID_CONTRACT_POLICIES["팀 읽고 고름"],
        arrange: arrangeForContract,
        forcedContractId: name.slice("강제:".length),
      },
      seed,
    );
  },
  { runs: RUNS, seed0: SEED0 },
);
const sharded = Object.fromEntries(names.map((name) => [name, allSharded[name]]));

const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
const forcedContracts = {};
for (const contract of RAID_CONTRACT_POOL) {
  const rows = allSharded[`강제:${contract.id}`];
  const waves = rows.map(({ wave }) => wave).sort((a, b) => a - b);
  const mean = waves.reduce((sum, wave) => sum + wave, 0) / waves.length;
  const variance = waves.reduce((sum, wave) => sum + (wave - mean) ** 2, 0) / Math.max(1, waves.length - 1);
  const margin = 1.96 * Math.sqrt(variance / waves.length);
  const tried = rows.reduce((sum, row) => sum + row.firstTwoTried, 0);
  const won = rows.reduce((sum, row) => sum + row.firstTwoWon, 0);
  forcedContracts[contract.id] = {
    mean: Number(mean.toFixed(2)),
    median: percentile(waves, 0.5),
    ci95: [Number((mean - margin).toFixed(2)), Number((mean + margin).toFixed(2))],
    firstTwoBossPass: tried > 0 ? Number((won / tried).toFixed(4)) : 0,
  };
}
const summary = {};
console.log(`악몽 계약 홀드아웃 ${RUNS}런 · 시드 ${SEED0 + 1}~${SEED0 + RUNS}`);
console.log("정책          p25  중앙값  p75  평균   첫 두 보스 통과  최다 선택 계약");
for (const name of names) {
  const rows = sharded[name];
  const waves = rows.map(({ wave }) => wave).sort((a, b) => a - b);
  const mean = waves.reduce((sum, wave) => sum + wave, 0) / waves.length;
  const tried = rows.reduce((sum, row) => sum + row.firstTwoTried, 0);
  const won = rows.reduce((sum, row) => sum + row.firstTwoWon, 0);
  const counts = {};
  for (const row of rows) {
    for (const [id, count] of Object.entries(row.chosen)) counts[id] = (counts[id] ?? 0) + count;
  }
  const totalChoices = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const [topId, topCount] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0] ?? ["없음", 0];
  summary[name] = {
    median: percentile(waves, 0.5),
    pass: tried > 0 ? won / tried : 0,
    topPickShare: totalChoices > 0 ? topCount / totalChoices : 1,
  };
  console.log(
    `${name.padEnd(12)} ${String(percentile(waves, 0.25)).padStart(4)} ${String(percentile(waves, 0.5)).padStart(6)} ` +
      `${String(percentile(waves, 0.75)).padStart(4)} ${mean.toFixed(1).padStart(5)}   ` +
      `${((won / Math.max(1, tried)) * 100).toFixed(1).padStart(5)}% (${won}/${tried})   ` +
      `${topId} ${((topCount / Math.max(1, totalChoices)) * 100).toFixed(1)}%`,
  );
}

const blind = summary["보상만 봄"];
const aware = summary["계약 읽음"];
const medianGain = aware.median - blind.median;
const passGain = (aware.pass - blind.pass) * 100;
const depthPass = medianGain >= 1 || passGain >= 5;
const forcedRanking = Object.entries(forcedContracts).sort((a, b) => b[1].mean - a[1].mean);
const [topForcedId, topForced] = forcedRanking[0];
const [runnerUpForcedId, runnerUpForced] = forcedRanking[1];
const forcedMeans = forcedRanking.map(([, row]) => row.mean);
const forcedSpread = Math.max(...forcedMeans) - Math.min(...forcedMeans);
const clearlySeparated = topForced.ci95[0] > runnerUpForced.ci95[1];
const everyForcedPlayable = forcedRanking.every(([, row]) => row.firstTwoBossPass >= 0.7 && row.firstTwoBossPass <= 0.97);
const dominancePass = forcedSpread <= 4 && !clearlySeparated && everyForcedPlayable;
const balancePass = aware.median >= 12 && aware.median <= 20 && aware.pass >= 0.7 && aware.pass <= 0.97;
const gates = { depth: depthPass, dominance: dominancePass, balance: balancePass };
const exitCode = Object.values(gates).every(Boolean) ? 0 : 1;

mkdirSync(".omx/evidence", { recursive: true });
const evidence = sealEvidence({
  source: evidenceSource(
    invokedNodeCommand("scripts/contract-space.mjs"),
    { from: SEED0 + 1, to: SEED0 + RUNS, runs: RUNS },
    exitCode,
  ),
  runs: RUNS,
  seeds: { from: SEED0 + 1, to: SEED0 + RUNS },
  rewardOnly: summary["보상만 봄"],
  contractAware: aware,
  forcedContractHoldout: {
    comparison: "각 계약을 모든 시드의 첫 두 보스에 연속 적용; 평균·95% 구간 비교",
    contracts: forcedContracts,
    top: topForcedId,
    runnerUp: runnerUpForcedId,
    meanSpread: Number(forcedSpread.toFixed(2)),
    topClearlySeparated: clearlySeparated,
    everyContractPlayable: everyForcedPlayable,
  },
  medianGain,
  firstTwoBossGainPct: Number(passGain.toFixed(1)),
  gates,
});
writeFileSync(
  ".omx/evidence/contract-space.json",
  JSON.stringify(evidence, null, 2) + "\n",
);

console.log(`\n깊이: 중앙값 ${medianGain >= 0 ? "+" : ""}${medianGain}웨이브 · 첫 두 보스 ${passGain >= 0 ? "+" : ""}${passGain.toFixed(1)}%p`);
console.log("\n계약별 강제 홀드아웃 — 모든 계약 × 모든 시드의 첫 두 보스, 독립 평균과 95% 구간");
for (const [id, row] of forcedRanking) {
  console.log(`  ${id.padEnd(16)} 평균 ${row.mean.toFixed(2).padStart(5)} · 중앙값 ${String(row.median).padStart(2)} · 95% ${row.ci95[0].toFixed(2)}~${row.ci95[1].toFixed(2)} · 첫 두 보스 ${(row.firstTwoBossPass * 100).toFixed(1)}%`);
}
console.log(`지배 계약 관문: 평균 폭 ${forcedSpread.toFixed(2)} ≤ 4.00 · 1위 ${topForcedId}의 95% 구간이 2위 ${runnerUpForcedId}와 ${clearlySeparated ? "분리됨" : "겹침"} · 전 계약 통과율 70~97% ${everyForcedPlayable ? "충족" : "미달"}`);
console.log(`기준선: 중앙값 ${aware.median} (12~20) · 첫 두 보스 ${(aware.pass * 100).toFixed(1)}% (70~97%)`);

if (!depthPass || !dominancePass || !balancePass) {
  console.error(
    `악몽 계약 판정 실패 — 깊이 ${depthPass ? "PASS" : "FAIL"}, 지배 ${dominancePass ? "PASS" : "FAIL"}, 밸런스 ${balancePass ? "PASS" : "FAIL"}`,
  );
  process.exit(1);
}
console.log("악몽 계약 판정 PASS — 읽는 선택이 결과를 가르고 한 계약이 정답이 되지 않는다");
