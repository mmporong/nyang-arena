/**
 * 통제형 일반 웨이브 궁합 관찰.
 *
 * 자연 런의 사후 로스터 표는 구매·생존 깊이와 셀 수가 섞인다. 여기서는 사전
 * 등록한 9개 합법 로스터를 세 체크포인트의 세 일반 웨이브에 한 번씩 넣고,
 * 실제 게임 전투 81개를 완전 열거한다. 고정 장면 census이므로 p값이나 표본
 * 독립성을 주장하지 않고, 주효과를 뺀 상호작용 잔차와 leave-one-out만 남긴다.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { stepBattle } from "../src/game/battle.ts";
import { BALANCE } from "../src/game/balance.ts";
import { BREEDS } from "../src/game/breeds.ts";
import {
  buildEnemyWave,
  currentKind,
  makeCat,
  newRun,
  startBattle,
} from "../src/game/run.ts";
import { emptyBoard } from "../src/game/types.ts";
import { rngCalls } from "../src/game/rng.ts";
import { makeBossBot } from "./bot-policy.mjs";
import { evidenceSource, sealEvidence } from "./evidence-source.mjs";
import {
  MATCHUP_CHECKPOINTS,
  MATCHUP_COMBAT_COUNT,
  MATCHUP_ROSTER_SETS,
  MATCHUP_TEAMS,
  MATCHUP_WAVES,
  analyzeMatchupCensus,
  buildMatchupDesign,
  marginFromBattleOutcome,
} from "./matchup-analysis.mjs";

const ROSTER_URL = new URL("./fixtures/matchup-roster-v1.json", import.meta.url);
const ROSTER_SHA256 = "0d46546571ad1b2fe2067a5909aaff6820511b709ab1fe13cac2125060e7450c";
const EVIDENCE_PATH = ".omx/evidence/matchup-space.json";
const DT_MS = 100;
const MAX_TICKS = 200;

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function round(value, digits = 6) {
  return Number(value.toFixed(digits));
}

function roundNumbers(value) {
  if (Array.isArray(value)) return value.map(roundNumbers);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, roundNumbers(child)]));
  }
  return typeof value === "number" && Number.isFinite(value) ? round(value) : value;
}

function breedForRoster(id) {
  const breed = BREEDS.find((candidate) => candidate.id === id);
  invariant(breed, `로스터 품종이 현재 아군 명단에 없다: ${id}`);
  return breed;
}

function rosterTotals(ids) {
  const breeds = ids.map(breedForRoster);
  return {
    units: breeds.length,
    melee: breeds.filter((breed) => breed.kind === "melee").length,
    cost: breeds.reduce((sum, breed) => sum + breed.cost, 0),
    hp: breeds.reduce((sum, breed) => sum + breed.hp, 0),
    dps: breeds.reduce((sum, breed) => sum + (breed.atk * 1000) / breed.atkInterval, 0),
  };
}

/** 매니페스트 내용과 현재 BREEDS가 조금이라도 갈리면 전투 전에 멈춘다. */
export function loadMatchupRosterContract() {
  const parsed = JSON.parse(readFileSync(ROSTER_URL, "utf8"));
  const sha256 = createHash("sha256").update(JSON.stringify(parsed)).digest("hex");
  invariant(sha256 === ROSTER_SHA256, `로스터 매니페스트 SHA 불일치: ${sha256}`);
  invariant(parsed.schema === "matchup-roster-v1", `로스터 스키마 불일치: ${parsed.schema}`);
  invariant(parsed.level === 1, `로스터 레벨이 1이 아니다: ${parsed.level}`);
  invariant(parsed.sets?.length === 3, `로스터 세트가 3개가 아니다: ${parsed.sets?.length}`);
  invariant(parsed.slots?.assignment === "melee-id-asc-front-then-back;ranged-id-asc-back-then-front", "배치 계약이 바뀌었다");
  const occupied = new Set(parsed.slots?.occupied);
  const front = new Set(parsed.slots?.front);
  const back = new Set(parsed.slots?.back);
  invariant(occupied.size === 6 && front.size === 3 && back.size === 3, "점유·앞·뒤 슬롯 수가 6/3/3이 아니다");
  invariant([...front].every((cell) => !back.has(cell)), "앞·뒤 슬롯이 겹친다");
  invariant([...front, ...back].every((cell) => occupied.has(cell)), "앞·뒤 슬롯이 점유 슬롯과 다르다");

  const rosterBreedIds = new Set(parsed.sets.flatMap((set) => MATCHUP_TEAMS.flatMap((team) => set[team] ?? [])));
  const manifestBreedIds = new Set((parsed.breeds ?? []).map((breed) => breed.id));
  invariant(manifestBreedIds.size === parsed.breeds?.length, "매니페스트 품종 id가 중복됐다");
  invariant(
    rosterBreedIds.size === manifestBreedIds.size && [...rosterBreedIds].every((id) => manifestBreedIds.has(id)),
    "로스터에서 쓰는 품종과 봉인한 품종 명단이 다르다",
  );

  for (const expected of parsed.breeds ?? []) {
    const actual = breedForRoster(expected.id);
    for (const [field, value] of Object.entries(expected)) {
      invariant(actual[field] === value, `품종 ${expected.id}의 ${field}가 매니페스트와 다르다: ${actual[field]} != ${value}`);
    }
  }

  const summaries = parsed.sets.map((set, index) => {
    const teams = Object.fromEntries(MATCHUP_TEAMS.map((team) => [team, rosterTotals(set[team] ?? [])]));
    const costs = MATCHUP_TEAMS.map((team) => teams[team].cost);
    const hps = MATCHUP_TEAMS.map((team) => teams[team].hp);
    const dps = MATCHUP_TEAMS.map((team) => teams[team].dps);
    invariant(MATCHUP_TEAMS.every((team) => teams[team].units === 6), `세트 ${index + 1} 유닛 수 불일치`);
    invariant(teams.melee.melee === 4 && teams.balanced.melee === 3 && teams.ranged.melee === 2, `세트 ${index + 1} 팀 성격 불일치`);
    invariant(new Set(costs).size === 1, `세트 ${index + 1} 비용 불일치: ${costs.join("/")}`);
    invariant(new Set(hps).size === 1, `세트 ${index + 1} HP 불일치: ${hps.join("/")}`);
    const dpsMean = dps.reduce((sum, value) => sum + value, 0) / dps.length;
    invariant(dps.every((value) => Math.abs(value - dpsMean) / dpsMean <= 0.05), `세트 ${index + 1} DPS 5% 계약 위반`);
    return { rosterSet: index + 1, teams: roundNumbers(teams) };
  });

  return { manifest: parsed, sha256, summaries };
}

function installRoster(state, ids, slots) {
  state.ally = emptyBoard();
  const free = new Set(slots.occupied);
  const melee = ids.map(breedForRoster).filter((breed) => breed.kind === "melee").sort((a, b) => a.id - b.id);
  const ranged = ids.map(breedForRoster).filter((breed) => breed.kind === "ranged").sort((a, b) => a.id - b.id);
  const place = (breed, order) => {
    const cell = order.find((candidate) => free.has(candidate));
    invariant(cell !== undefined, `로스터 ${breed.id}를 놓을 칸이 없다`);
    free.delete(cell);
    state.ally[cell] = makeCat(breed, "ally", cell);
  };
  for (const breed of melee) place(breed, [...slots.front, ...slots.back]);
  for (const breed of ranged) place(breed, [...slots.back, ...slots.front]);
  invariant(free.size === 0, `로스터 배치 뒤 빈 점유 슬롯이 남았다: ${[...free].join(",")}`);
}

function controlledState(scenario, rosterContract) {
  const state = newRun(scenario.scenarioSeed, { kind: "free", challenge: 0 });
  state.phase = "prepare";
  state.wave = scenario.checkpoint;
  state.step = 0;
  state.nodeKind = "battle";
  state.nodeWave = scenario.waveKind;
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
  const ids = rosterContract.manifest.sets[scenario.rosterSet - 1]?.[scenario.team];
  invariant(Array.isArray(ids), `로스터 세트/팀이 없다: ${scenario.rosterSet}/${scenario.team}`);
  installRoster(state, ids, rosterContract.manifest.slots);
  return state;
}

function runCombat(scenario, rosterContract) {
  const state = controlledState(scenario, rosterContract);
  invariant(currentKind(state) === scenario.waveKind, `웨이브 성격 전이 불일치: ${scenario.combatId}`);
  buildEnemyWave(state);
  const enemyCount = state.enemy.filter(Boolean).length;
  invariant(enemyCount > 0, `적 생성 실패: ${scenario.combatId}`);
  startBattle(state);
  invariant(state.phase === "battle", `전투 시작 실패: ${scenario.combatId}`);
  invariant(state.activeSynergyIds.size === 0 && state.relics.length === 0, `통제 축 오염: ${scenario.combatId}`);
  invariant([...state.ally, ...state.enemy].filter(Boolean).every((cat) => cat.evade === 0), `회피 RNG가 통제 장면에 열렸다: ${scenario.combatId}`);

  const respond = makeBossBot({ read: true });
  const rngCallsAtBattleStart = rngCalls();
  let stepCalls = 0;
  while (state.phase === "battle" && stepCalls < MAX_TICKS) {
    respond(state);
    stepBattle(state, DT_MS);
    stepCalls += 1;
  }
  invariant(state.phase !== "battle", `전투가 ${MAX_TICKS}틱 안에 끝나지 않았다: ${scenario.combatId}`);
  invariant(state.lastBattleOutcome, `회복 전 outcome이 없다: ${scenario.combatId}`);
  invariant(state.phase === (state.lastBattleOutcome.won ? "map" : "gameover"), `종료 phase 불일치: ${scenario.combatId}`);

  const outcome = { ...state.lastBattleOutcome };
  const rngCallsAtEnd = rngCalls();
  return {
    ...scenario,
    allyCount: 6,
    enemyCount,
    stepCalls,
    rngCallsAtBattleStart,
    rngCallsAtEnd,
    rngCallsConsumed: rngCallsAtEnd - rngCallsAtBattleStart,
    path: "newRun>makeCat>buildEnemyWave>startBattle>stepBattle>lastBattleOutcome",
    outcome,
    margin: marginFromBattleOutcome(outcome),
  };
}

function checkpointObservationSummary(observations) {
  return MATCHUP_CHECKPOINTS.map((checkpoint) => {
    const checkpointRows = observations.filter((row) => row.checkpoint === checkpoint);
    return {
      checkpoint,
      fights: checkpointRows.length,
      wins: checkpointRows.filter((row) => row.outcome.won).length,
      cells: MATCHUP_TEAMS.flatMap((team) =>
        MATCHUP_WAVES.map((waveKind) => {
          const rows = checkpointRows.filter((row) => row.team === team && row.waveKind === waveKind);
          return {
            team,
            waveKind,
            fights: rows.length,
            wins: rows.filter((row) => row.outcome.won).length,
            meanMargin: rows.reduce((sum, row) => sum + row.margin, 0) / rows.length,
          };
        }),
      ),
    };
  });
}

function cellObservationSummary(observations, analysis) {
  return analysis.full.interactions.map((cell) => {
    const rows = observations.filter((row) => row.team === cell.team && row.waveKind === cell.waveKind);
    return {
      team: cell.team,
      waveKind: cell.waveKind,
      fights: rows.length,
      wins: rows.filter((row) => row.outcome.won).length,
      meanMargin: cell.meanMargin,
      interaction: cell.interaction,
      meanElapsedMs: rows.reduce((sum, row) => sum + row.outcome.elapsedMs, 0) / rows.length,
    };
  });
}

function conciseSensitivity(analysis) {
  const full = new Map(
    analysis.full.interactions.map((cell) => [`${cell.team}|${cell.waveKind}`, cell.interaction]),
  );
  const omission = (entry) => ({
    omitted: entry.omitted,
    combatCount: entry.analysis.blockCount * 9,
    dominant: entry.analysis.dominant,
    maxAbsDeltaFromFull: Math.max(
      ...entry.analysis.interactions.map((cell) =>
        Math.abs(cell.interaction - full.get(`${cell.team}|${cell.waveKind}`)),
      ),
    ),
  });
  return {
    rosterOmissions: analysis.sensitivity.roster.map(omission),
    checkpointOmissions: analysis.sensitivity.checkpoint.map(omission),
    cells: analysis.sensitivity.cells,
    directionStableCells: analysis.directionStableCells,
  };
}

function printReport(report) {
  console.log(`통제형 일반 웨이브 궁합 — 실제 전투 ${report.design.combatCount}개 · 셀당 ${report.design.observationsPerCell}개`);
  console.log("팀          " + MATCHUP_WAVES.map((wave) => wave.padStart(18)).join(""));
  for (const team of MATCHUP_TEAMS) {
    const cells = MATCHUP_WAVES.map((waveKind) => report.cells.find((cell) => cell.team === team && cell.waveKind === waveKind));
    console.log(
      team.padEnd(12) +
        cells.map((cell) => `${cell.meanMargin.toFixed(3)} / I ${cell.interaction >= 0 ? "+" : ""}${cell.interaction.toFixed(3)}`.padStart(18)).join(""),
    );
  }
  const dominant = report.analysis.dominant;
  console.log(`최대 |I|: ${dominant.team} × ${dominant.waveKind} ${dominant.interaction >= 0 ? "+" : ""}${dominant.interaction.toFixed(3)}`);
  console.log(`체크포인트 승리: ${report.checkpoints.map((row) => `W${row.checkpoint} ${row.wins}/${row.fights}`).join(" · ")}`);
  console.log(`leave-one-out 방향 유지: ${report.sensitivity.directionStableCells}/9셀`);
  console.log("판정 없음 — 고정 81장면의 기술 관찰이며 p값·신뢰구간·자연 런 일반화를 주장하지 않는다");
}

export function runMatchupCensus({ writeEvidence = true, silent = false } = {}) {
  const rosterContract = loadMatchupRosterContract();
  const observations = buildMatchupDesign().map((scenario) => runCombat(scenario, rosterContract));
  invariant(observations.length === MATCHUP_COMBAT_COUNT, `실행 전투 수 불일치: ${observations.length}`);
  const analysis = analyzeMatchupCensus(observations);
  const report = sealEvidence(roundNumbers({
    schema: "matchup-census-v1",
    status: "OBSERVATION_ONLY",
    gate: false,
    decisionEligible: false,
    source: evidenceSource(
      "node --experimental-strip-types scripts/matchup-space.mjs",
      { scenarioSeed: observations[0]?.scenarioSeed, fights: MATCHUP_COMBAT_COUNT },
      0,
    ),
    design: {
      combatCount: MATCHUP_COMBAT_COUNT,
      blockCount: MATCHUP_ROSTER_SETS.length * MATCHUP_CHECKPOINTS.length,
      gridCellCount: MATCHUP_TEAMS.length * MATCHUP_WAVES.length,
      observationsPerCell: MATCHUP_ROSTER_SETS.length * MATCHUP_CHECKPOINTS.length,
      rosterSets: MATCHUP_ROSTER_SETS,
      checkpoints: MATCHUP_CHECKPOINTS,
      teams: MATCHUP_TEAMS,
      waveKinds: MATCHUP_WAVES,
      dtMs: DT_MS,
      maxTicks: MAX_TICKS,
      execution: "sequential; global RNG is reset by newRun before every scene",
      randomization: "none; one fixed seed held across the complete 81-scene census",
      estimand: "matched legal roster package × normal wave kind interaction residual",
      inference: "descriptive only; no p-value, confidence interval, or population claim",
      adjacencyAtk: BALANCE.adjacencyAtk,
      adjacencyMode: "kept as part of the actual roster package; not equalized or attributed to range alone",
      interactionDf: 4,
      syntheticScene: "wave checkpoint with step=0; not a sampled natural-run path",
    },
    rosterManifest: {
      path: "scripts/fixtures/matchup-roster-v1.json",
      sha256: rosterContract.sha256,
      summaries: rosterContract.summaries,
    },
    cells: cellObservationSummary(observations, analysis),
    checkpoints: checkpointObservationSummary(observations),
    analysis: {
      grandMean: analysis.full.grandMean,
      teamMeans: analysis.full.teamMeans,
      waveMeans: analysis.full.waveMeans,
      interactions: analysis.full.interactions,
      dominant: analysis.full.dominant,
    },
    sensitivity: conciseSensitivity(analysis),
    observations,
  }));

  if (writeEvidence) {
    mkdirSync(".omx/evidence", { recursive: true });
    writeFileSync(EVIDENCE_PATH, JSON.stringify(report, null, 2) + "\n");
  }
  if (!silent) printReport(report);
  return report;
}

const invokedUrl = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedUrl === import.meta.url) runMatchupCensus();
