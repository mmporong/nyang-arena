import assert from "node:assert/strict";

import { stepBattle } from "../src/game/battle.ts";
import { BREEDS } from "../src/game/breeds.ts";
import { buildEnemyWave, currentKind, makeCat, newRun, startBattle } from "../src/game/run.ts";
import { rngCalls } from "../src/game/rng.ts";
import { emptyBoard } from "../src/game/types.ts";
import { makeBossBot } from "./bot-policy.mjs";
import { verifyEvidenceSeal } from "./evidence-source.mjs";
import {
  MATCHUP_COMBAT_COUNT,
  MATCHUP_SCENARIO_SEED,
  analyzeMatchupCensus,
  buildMatchupDesign,
  computeMatchupInteraction,
  marginFromBattleOutcome,
  matchupLeaveOneOut,
  validateMatchupDesign,
} from "./matchup-analysis.mjs";
import { loadMatchupRosterContract, runMatchupCensus } from "./matchup-space.mjs";

const TEAMS = ["melee", "balanced", "ranged"];
const WAVES = ["mixed", "rush", "snipe"];
const ROSTERS = [1, 2, 3];
const CHECKPOINTS = [4, 8, 12];
const close = (actual, expected, message, tolerance = 1e-10) =>
  assert(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} != ${expected}`);

const expectedKeys = [];
for (const rosterSet of ROSTERS) {
  for (const checkpoint of CHECKPOINTS) {
    for (const team of TEAMS) {
      for (const waveKind of WAVES) expectedKeys.push(`${rosterSet}|${checkpoint}|${team}|${waveKind}`);
    }
  }
}

const design = buildMatchupDesign();
assert.equal(design.length, 81, "3×3×3×3 설계가 81전투가 아니다");
assert.equal(new Set(design.map((row) => row.combatId)).size, 81, "combatId가 유일하지 않다");
assert.deepEqual(
  design.map((row) => `${row.rosterSet}|${row.checkpoint}|${row.team}|${row.waveKind}`),
  expectedKeys,
  "81장면의 순서나 축이 사전 등록과 다르다",
);
assert(design.every((row) => row.scenarioSeed === MATCHUP_SCENARIO_SEED), "시드를 장면마다 바꿔 가짜 반복을 만들었다");
assert.equal(validateMatchupDesign(design), true);

assert.throws(() => validateMatchupDesign(design.slice(1)), /81/, "장면 누락을 허용했다");
assert.throws(
  () => validateMatchupDesign([...design.slice(0, -1), { ...design[0] }]),
  /중복/,
  "장면 중복을 허용했다",
);
assert.throws(
  () => validateMatchupDesign(
    design.map((row, index) => index === 0 ? { ...row, checkpoint: 11, combatId: "r1-w11-melee-mixed" } : row),
  ),
  /사전 등록 밖/,
  "등록하지 않은 체크포인트를 허용했다",
);
assert.throws(
  () => validateMatchupDesign(design.map((row, index) => index === 0 ? { ...row, scenarioSeed: 1 } : row)),
  /시드가 갈렸다/,
  "장면별 seed 선택을 허용했다",
);
assert.throws(
  () => validateMatchupDesign(design.map((row, index) => index === 0 ? { ...row, combatId: "renamed" } : row)),
  /combatId가 장면과 다르다/,
  "장면과 무관한 combatId를 허용했다",
);

close(
  marginFromBattleOutcome({ won: true, allyStartHp: 200, allyRemainingHp: 50, enemyStartHp: 100, enemyRemainingHp: 0 }),
  0.25,
  "승리 margin 공식이 다르다",
);
close(
  marginFromBattleOutcome({ won: false, allyStartHp: 200, allyRemainingHp: 0, enemyStartHp: 100, enemyRemainingHp: 40 }),
  -0.4,
  "패배 margin 공식이 다르다",
);
assert.throws(
  () => marginFromBattleOutcome({ won: true, allyStartHp: 0, allyRemainingHp: 0, enemyStartHp: 100, enemyRemainingHp: 0 }),
  /아군 시작 HP/,
  "분모 0을 허용했다",
);

const teamMain = { melee: 0.06, balanced: -0.01, ranged: -0.05 };
const waveMain = { mixed: -0.04, rush: 0.01, snipe: 0.03 };
const blockMain = (row) => (row.rosterSet - 2) * 0.02 + (row.checkpoint / 4 - 2) * 0.01;
const additive = design.map((row) => ({
  ...row,
  margin: 0.1 + teamMain[row.team] + waveMain[row.waveKind] + blockMain(row),
}));
const additiveAnalysis = computeMatchupInteraction(additive);
for (const cell of additiveAnalysis.interactions) close(cell.interaction, 0, "가산 주효과를 상호작용으로 오인했다");

const nullRows = design.map((row) => ({ ...row, margin: 0.2 + blockMain(row) }));
const nullAnalysis = computeMatchupInteraction(nullRows);
for (const cell of nullAnalysis.interactions) close(cell.interaction, 0, "상수 귀무에서 상호작용을 만들었다");

const knownInteraction = [
  [0.2, -0.1, -0.1],
  [-0.1, 0.2, -0.1],
  [-0.1, -0.1, 0.2],
];
const signalRows = design.map((row) => ({
  ...row,
  margin:
    0.05 +
    teamMain[row.team] +
    waveMain[row.waveKind] +
    blockMain(row) +
    knownInteraction[TEAMS.indexOf(row.team)][WAVES.indexOf(row.waveKind)],
}));
const signal = analyzeMatchupCensus(signalRows);
for (const cell of signal.full.interactions) {
  close(
    cell.interaction,
    knownInteraction[TEAMS.indexOf(cell.team)][WAVES.indexOf(cell.waveKind)],
    `알려진 상호작용 복원 실패 ${cell.team}/${cell.waveKind}`,
  );
}
assert.deepEqual(
  [signal.full.dominant.team, signal.full.dominant.waveKind],
  ["melee", "mixed"],
  "동률 dominant 순서가 결정적이지 않다",
);
assert.equal(signal.sensitivity.roster.length, 3, "roster leave-one-out이 3개가 아니다");
assert.equal(signal.sensitivity.checkpoint.length, 3, "checkpoint leave-one-out이 3개가 아니다");
assert(signal.sensitivity.roster.every((entry) => entry.analysis.blockCount === 6 && entry.analysis.observationsPerCell === 6));
assert(signal.sensitivity.checkpoint.every((entry) => entry.analysis.blockCount === 6 && entry.analysis.observationsPerCell === 6));
assert.equal(signal.directionStableCells, 9, "알려진 상호작용의 방향이 leave-one-out에서 흔들렸다");

const rosterPerturbation = [
  [0.06, -0.03, -0.03],
  [-0.03, 0.06, -0.03],
  [-0.03, -0.03, 0.06],
];
const checkpointPerturbation = [
  [0.06, -0.06, 0],
  [-0.06, 0, 0.06],
  [0, 0.06, -0.06],
];
const rosterWeight = { 1: -0.7, 2: 0.1, 3: 0.6 };
const checkpointWeight = { 4: -0.4, 8: 0.05, 12: 0.35 };
const heterogeneous = design.map((row) => {
  const teamIndex = TEAMS.indexOf(row.team);
  const waveIndex = WAVES.indexOf(row.waveKind);
  return {
    ...row,
    margin:
      0.05 +
      teamMain[row.team] +
      waveMain[row.waveKind] +
      blockMain(row) +
      knownInteraction[teamIndex][waveIndex] +
      rosterWeight[row.rosterSet] * rosterPerturbation[teamIndex][waveIndex] +
      checkpointWeight[row.checkpoint] * checkpointPerturbation[teamIndex][waveIndex],
  };
});
const heterogeneousFull = computeMatchupInteraction(heterogeneous);
const heterogeneousLoo = matchupLeaveOneOut(heterogeneous, heterogeneousFull);
for (const entry of heterogeneousLoo.roster) {
  assert.deepEqual(
    entry.analysis,
    computeMatchupInteraction(heterogeneous.filter((row) => row.rosterSet !== entry.omitted)),
    `roster ${entry.omitted} 제외가 raw 54행에서 재계산되지 않았다`,
  );
}
for (const entry of heterogeneousLoo.checkpoint) {
  assert.deepEqual(
    entry.analysis,
    computeMatchupInteraction(heterogeneous.filter((row) => row.checkpoint !== entry.omitted)),
    `checkpoint ${entry.omitted} 제외가 raw 54행에서 재계산되지 않았다`,
  );
}
assert(
  [...heterogeneousLoo.roster, ...heterogeneousLoo.checkpoint].some((entry) =>
    entry.analysis.interactions.some((cell) => {
      const fullCell = heterogeneousFull.interactions.find(
        (candidate) => candidate.team === cell.team && candidate.waveKind === cell.waveKind,
      );
      return Math.abs(cell.interaction - fullCell.interaction) > 0.005;
    }),
  ),
  "이질적 fixture가 full-result 재사용 변이를 구분하지 못한다",
);

const roster = loadMatchupRosterContract();
assert.equal(roster.sha256, "0d46546571ad1b2fe2067a5909aaff6820511b709ab1fe13cac2125060e7450c");
assert.deepEqual(
  roster.summaries.map((set) => ({
    rosterSet: set.rosterSet,
    cost: TEAMS.map((team) => set.teams[team].cost),
    hp: TEAMS.map((team) => set.teams[team].hp),
    melee: TEAMS.map((team) => set.teams[team].melee),
  })),
  [
    { rosterSet: 1, cost: [22, 22, 22], hp: [700, 700, 700], melee: [4, 3, 2] },
    { rosterSet: 2, cost: [22, 22, 22], hp: [589, 589, 589], melee: [4, 3, 2] },
    { rosterSet: 3, cost: [22, 22, 22], hp: [597, 597, 597], melee: [4, 3, 2] },
  ],
  "로스터 비용·HP·성격 계약이 바뀌었다",
);

function independentCanonicalCombat(scenario) {
  const state = newRun(scenario.scenarioSeed, { kind: "free", challenge: 0 });
  state.phase = "prepare";
  state.wave = scenario.checkpoint;
  state.step = 0;
  state.nodeKind = "battle";
  state.nodeWave = scenario.waveKind;
  state.ally = emptyBoard();
  state.enemy = emptyBoard();
  state.synergies = [];
  state.synergyPool = [];
  state.activeSynergyIds = new Set();
  state.relics = [];
  state.raidOffers = [];
  state.raidContract = null;
  state.raidTargetBossIndex = -1;
  state.lastRaidContract = null;
  state.freeRerolls = 0;
  state.bonusDodge = 0;
  state.pending = [];
  state.summons = [];

  const ids = roster.manifest.sets[scenario.rosterSet - 1][scenario.team];
  const free = new Set(roster.manifest.slots.occupied);
  const breeds = ids.map((id) => BREEDS.find((breed) => breed.id === id));
  assert(breeds.every(Boolean));
  const place = (breed, order) => {
    const cell = order.find((candidate) => free.has(candidate));
    assert.notEqual(cell, undefined);
    free.delete(cell);
    state.ally[cell] = makeCat(breed, "ally", cell);
  };
  for (const breed of breeds.filter((breed) => breed.kind === "melee").sort((a, b) => a.id - b.id)) {
    place(breed, [...roster.manifest.slots.front, ...roster.manifest.slots.back]);
  }
  for (const breed of breeds.filter((breed) => breed.kind === "ranged").sort((a, b) => a.id - b.id)) {
    place(breed, [...roster.manifest.slots.back, ...roster.manifest.slots.front]);
  }

  assert.equal(currentKind(state), scenario.waveKind);
  buildEnemyWave(state);
  const enemyCount = state.enemy.filter(Boolean).length;
  startBattle(state);
  assert.equal(state.phase, "battle");
  const respond = makeBossBot({ read: true });
  const rngCallsAtBattleStart = rngCalls();
  let stepCalls = 0;
  while (state.phase === "battle" && stepCalls < 200) {
    respond(state);
    stepBattle(state, 100);
    stepCalls += 1;
  }
  assert.notEqual(state.phase, "battle");
  assert(state.lastBattleOutcome);
  const outcome = { ...state.lastBattleOutcome };
  const rngCallsAtEnd = rngCalls();
  return {
    enemyCount,
    stepCalls,
    rngCallsAtBattleStart,
    rngCallsAtEnd,
    rngCallsConsumed: rngCallsAtEnd - rngCallsAtBattleStart,
    outcome,
    margin: marginFromBattleOutcome(outcome),
  };
}

const first = runMatchupCensus({ writeEvidence: false, silent: true });
const second = runMatchupCensus({ writeEvidence: false, silent: true });
assert.deepEqual(second, first, "같은 81장면을 다시 실행했을 때 결과나 증거 해시가 달라졌다");
assert.equal(first.design.combatCount, MATCHUP_COMBAT_COUNT);
assert.equal(first.design.blockCount, 9);
assert.equal(first.design.gridCellCount, 9);
assert.equal(first.design.observationsPerCell, 9);
assert.equal(first.observations.length, 81);
assert.equal(new Set(first.observations.map((row) => row.combatId)).size, 81);
assert.equal(first.cells.length, 9);
assert(first.cells.every((cell) => cell.fights === 9), "셀당 전투 수가 9가 아니다");
assert(first.observations.every((row) => row.path === "newRun>makeCat>buildEnemyWave>startBattle>stepBattle>lastBattleOutcome"));
assert(first.observations.every((row) => row.stepCalls > 0 && row.stepCalls <= 200));
assert(first.observations.every((row) => row.outcome.elapsedMs === row.stepCalls * 100));
assert(first.observations.every((row) => row.rngCallsAtEnd >= row.rngCallsAtBattleStart));
assert(first.observations.every((row) => row.rngCallsConsumed === row.rngCallsAtEnd - row.rngCallsAtBattleStart));
assert(first.observations.every((row) => ["victory", "wipe", "timeout"].includes(row.outcome.reason)));
assert(first.observations.every((row) => row.outcome.allyStartHp > 0 && row.outcome.enemyStartHp > 0));
assert(first.observations.every((row) => row.margin >= -1 && row.margin <= 1));
for (const combatId of [
  "r1-w4-melee-mixed",
  "r2-w8-balanced-rush",
  "r3-w12-ranged-snipe",
]) {
  const actual = first.observations.find((row) => row.combatId === combatId);
  assert(actual, `대표 전투가 없다: ${combatId}`);
  const expected = independentCanonicalCombat(actual);
  assert.deepEqual(
    {
      enemyCount: actual.enemyCount,
      stepCalls: actual.stepCalls,
      rngCallsAtBattleStart: actual.rngCallsAtBattleStart,
      rngCallsAtEnd: actual.rngCallsAtEnd,
      rngCallsConsumed: actual.rngCallsConsumed,
      outcome: actual.outcome,
    },
    {
      enemyCount: expected.enemyCount,
      stepCalls: expected.stepCalls,
      rngCallsAtBattleStart: expected.rngCallsAtBattleStart,
      rngCallsAtEnd: expected.rngCallsAtEnd,
      rngCallsConsumed: expected.rngCallsConsumed,
      outcome: expected.outcome,
    },
    `하네스 결과가 독립 실제 엔진 경로와 다르다: ${combatId}`,
  );
  close(actual.margin, expected.margin, `대표 전투 margin이 실제 엔진과 다르다: ${combatId}`, 1e-6);
}
assert.equal(verifyEvidenceSeal(first), true, "궁합 evidence seal이 내용과 일치하지 않는다");
assert(!Object.hasOwn(first.analysis, "pValue"), "고정 census에 p값을 날조했다");
assert(!Object.hasOwn(first.analysis, "confidenceInterval"), "고정 census에 신뢰구간을 날조했다");

console.log(
  "matchup census passed — 81 actual combats · exact roster/grid · interaction/LOO · null/additive/signal · no fake inference",
);
