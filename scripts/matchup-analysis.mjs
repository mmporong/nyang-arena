/** 통제형 일반 웨이브 궁합 관찰의 고정 설계와 순수 계산. */
export const MATCHUP_ROSTER_SETS = Object.freeze([1, 2, 3]);
export const MATCHUP_CHECKPOINTS = Object.freeze([4, 8, 12]);
export const MATCHUP_TEAMS = Object.freeze(["melee", "balanced", "ranged"]);
export const MATCHUP_WAVES = Object.freeze(["mixed", "rush", "snipe"]);
export const MATCHUP_SCENARIO_SEED = 0x4d415443;
export const MATCHUP_COMBAT_COUNT = 81;

const EPSILON = 1e-10;

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function blockKey(row) {
  return `${row.rosterSet}|${row.checkpoint}`;
}

function cellKey(row) {
  return `${row.team}|${row.waveKind}`;
}

export function matchupDesignKey(row) {
  return `${blockKey(row)}|${cellKey(row)}`;
}

/**
 * 한 장면은 한 번만 센다. 같은 시드를 전 장면에 써 seed를 환경 상수로 붙잡고,
 * roster×checkpoint를 확률 표본이나 반복 실험으로 부르지 않는다.
 */
export function buildMatchupDesign() {
  const rows = [];
  for (const rosterSet of MATCHUP_ROSTER_SETS) {
    for (const checkpoint of MATCHUP_CHECKPOINTS) {
      for (const team of MATCHUP_TEAMS) {
        for (const waveKind of MATCHUP_WAVES) {
          rows.push({
            combatId: `r${rosterSet}-w${checkpoint}-${team}-${waveKind}`,
            rosterSet,
            checkpoint,
            team,
            waveKind,
            scenarioSeed: MATCHUP_SCENARIO_SEED,
          });
        }
      }
    }
  }
  return rows;
}

function expectedDesignKeys() {
  return new Set(buildMatchupDesign().map(matchupDesignKey));
}

/** 정확히 3×3 고정 블록 안의 3×3 직교 장면 81개인지 확인한다. */
export function validateMatchupDesign(rows) {
  invariant(Array.isArray(rows), "궁합 설계가 배열이 아니다");
  invariant(rows.length === MATCHUP_COMBAT_COUNT, `궁합 전투 수가 81이 아니다: ${rows.length}`);
  const ids = new Set();
  const keys = new Set();
  const expected = expectedDesignKeys();
  for (const row of rows) {
    invariant(typeof row.combatId === "string" && row.combatId.length > 0, "combatId가 비었다");
    const expectedId = `r${row.rosterSet}-w${row.checkpoint}-${row.team}-${row.waveKind}`;
    invariant(row.combatId === expectedId, `combatId가 장면과 다르다: ${row.combatId} != ${expectedId}`);
    invariant(!ids.has(row.combatId), `combatId 중복: ${row.combatId}`);
    ids.add(row.combatId);
    invariant(row.scenarioSeed === MATCHUP_SCENARIO_SEED, `시나리오 시드가 갈렸다: ${row.combatId}`);
    const key = matchupDesignKey(row);
    invariant(expected.has(key), `사전 등록 밖 장면: ${key}`);
    invariant(!keys.has(key), `장면 중복: ${key}`);
    keys.add(key);
  }
  invariant(keys.size === expected.size, `장면 키 수가 다르다: ${keys.size}/${expected.size}`);
  for (const key of expected) invariant(keys.has(key), `장면 누락: ${key}`);
  return true;
}

/** 회복 전 outcome 하나를 [-1, 1] 여유도로 바꾼다. */
export function marginFromBattleOutcome(outcome) {
  invariant(outcome && typeof outcome === "object", "전투 outcome이 없다");
  invariant(outcome.allyStartHp > 0, "아군 시작 HP가 0이다");
  invariant(outcome.enemyStartHp > 0, "적 시작 HP가 0이다");
  const value = outcome.won
    ? outcome.allyRemainingHp / outcome.allyStartHp
    : -(outcome.enemyRemainingHp / outcome.enemyStartHp);
  invariant(Number.isFinite(value) && value >= -1 - EPSILON && value <= 1 + EPSILON, `여유도 범위 위반: ${value}`);
  return Object.is(value, -0) ? 0 : value;
}

function mean(values) {
  invariant(values.length > 0, "평균낼 값이 없다");
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function validateBalancedRows(rows) {
  invariant(Array.isArray(rows) && rows.length > 0, "궁합 관측이 비었다");
  const seen = new Set();
  const blocks = new Set();
  const cellCounts = new Map();
  const blockCounts = new Map();
  for (const row of rows) {
    invariant(MATCHUP_TEAMS.includes(row.team), `알 수 없는 팀: ${row.team}`);
    invariant(MATCHUP_WAVES.includes(row.waveKind), `알 수 없는 웨이브: ${row.waveKind}`);
    invariant(Number.isFinite(row.margin) && row.margin >= -1 - EPSILON && row.margin <= 1 + EPSILON, `잘못된 margin: ${row.margin}`);
    const design = matchupDesignKey(row);
    invariant(!seen.has(design), `분석 장면 중복: ${design}`);
    seen.add(design);
    const block = blockKey(row);
    const cell = cellKey(row);
    blocks.add(block);
    blockCounts.set(block, (blockCounts.get(block) ?? 0) + 1);
    cellCounts.set(cell, (cellCounts.get(cell) ?? 0) + 1);
  }
  for (const [block, count] of blockCounts) invariant(count === 9, `블록 ${block}가 9장면이 아니다: ${count}`);
  const expectedCellCount = blocks.size;
  invariant(cellCounts.size === 9, `셀 수가 9가 아니다: ${cellCounts.size}`);
  for (const [cell, count] of cellCounts) invariant(count === expectedCellCount, `셀 ${cell} 노출 불균형: ${count}/${expectedCellCount}`);
  return { blockCount: blocks.size, observationsPerCell: expectedCellCount };
}

/**
 * 팀·웨이브 주효과를 뺀 3×3 상호작용 잔차.
 * 고정 장면의 기술통계일 뿐 p값·신뢰구간·모집단 일반화를 만들지 않는다.
 */
export function computeMatchupInteraction(rows) {
  const counts = validateBalancedRows(rows);
  const cells = [];
  for (const team of MATCHUP_TEAMS) {
    for (const waveKind of MATCHUP_WAVES) {
      const values = rows.filter((row) => row.team === team && row.waveKind === waveKind).map((row) => row.margin);
      cells.push({ team, waveKind, count: values.length, meanMargin: mean(values) });
    }
  }
  const teamMeans = Object.fromEntries(
    MATCHUP_TEAMS.map((team) => [team, mean(cells.filter((cell) => cell.team === team).map((cell) => cell.meanMargin))]),
  );
  const waveMeans = Object.fromEntries(
    MATCHUP_WAVES.map((waveKind) => [waveKind, mean(cells.filter((cell) => cell.waveKind === waveKind).map((cell) => cell.meanMargin))]),
  );
  const grandMean = mean(cells.map((cell) => cell.meanMargin));
  const interactions = cells.map((cell) => ({
    ...cell,
    interaction: cell.meanMargin - teamMeans[cell.team] - waveMeans[cell.waveKind] + grandMean,
  }));

  for (const team of MATCHUP_TEAMS) {
    const sum = interactions.filter((cell) => cell.team === team).reduce((acc, cell) => acc + cell.interaction, 0);
    invariant(Math.abs(sum) <= EPSILON, `상호작용 행 합 불변 위반: ${team}=${sum}`);
  }
  for (const waveKind of MATCHUP_WAVES) {
    const sum = interactions.filter((cell) => cell.waveKind === waveKind).reduce((acc, cell) => acc + cell.interaction, 0);
    invariant(Math.abs(sum) <= EPSILON, `상호작용 열 합 불변 위반: ${waveKind}=${sum}`);
  }

  const ordered = [...interactions].sort(
    (a, b) =>
      Math.abs(b.interaction) - Math.abs(a.interaction) ||
      MATCHUP_TEAMS.indexOf(a.team) - MATCHUP_TEAMS.indexOf(b.team) ||
      MATCHUP_WAVES.indexOf(a.waveKind) - MATCHUP_WAVES.indexOf(b.waveKind),
  );
  const dominant = ordered[0];
  return {
    blockCount: counts.blockCount,
    observationsPerCell: counts.observationsPerCell,
    grandMean,
    teamMeans,
    waveMeans,
    cells,
    interactions,
    dominant: {
      team: dominant.team,
      waveKind: dominant.waveKind,
      interaction: dominant.interaction,
      absInteraction: Math.abs(dominant.interaction),
    },
  };
}

function interactionMap(analysis) {
  return new Map(analysis.interactions.map((cell) => [cellKey(cell), cell.interaction]));
}

function sign(value) {
  return Math.abs(value) <= EPSILON ? 0 : Math.sign(value);
}

/** roster 또는 checkpoint 하나를 뺄 때마다 처음부터 다시 계산한다. */
export function matchupLeaveOneOut(rows, full = computeMatchupInteraction(rows)) {
  const roster = MATCHUP_ROSTER_SETS.map((omitted) => ({
    omitted,
    analysis: computeMatchupInteraction(rows.filter((row) => row.rosterSet !== omitted)),
  }));
  const checkpoint = MATCHUP_CHECKPOINTS.map((omitted) => ({
    omitted,
    analysis: computeMatchupInteraction(rows.filter((row) => row.checkpoint !== omitted)),
  }));
  const fullMap = interactionMap(full);
  const variants = [...roster, ...checkpoint].map((entry) => interactionMap(entry.analysis));
  const cells = [];
  for (const team of MATCHUP_TEAMS) {
    for (const waveKind of MATCHUP_WAVES) {
      const key = `${team}|${waveKind}`;
      const value = fullMap.get(key);
      const omittedValues = variants.map((variant) => variant.get(key));
      const direction = sign(value);
      cells.push({
        team,
        waveKind,
        full: value,
        min: Math.min(...omittedValues),
        max: Math.max(...omittedValues),
        directionStable: omittedValues.every((candidate) => sign(candidate) === direction),
      });
    }
  }
  return { roster, checkpoint, cells };
}

export function analyzeMatchupCensus(rows) {
  validateMatchupDesign(rows);
  const full = computeMatchupInteraction(rows);
  const sensitivity = matchupLeaveOneOut(rows, full);
  return {
    combatCount: rows.length,
    blockCount: full.blockCount,
    observationsPerCell: full.observationsPerCell,
    full,
    sensitivity,
    directionStableCells: sensitivity.cells.filter((cell) => cell.directionStable).length,
  };
}
