import assert from "node:assert/strict";

import { stepBattle } from "../src/game/battle.ts";
import { BREEDS } from "../src/game/breeds.ts";
import { emptyBoard } from "../src/game/types.ts";
import { finishWave, makeCat, newRun, startBattle } from "../src/game/run.ts";
import { rngCalls } from "../src/game/rng.ts";

function battleState(seed, allyHp = [100, 50], enemyHp = 40) {
  const state = newRun(seed);
  state.phase = "prepare";
  state.wave = 1;
  state.step = 0;
  state.nodeKind = "battle";
  state.nodeWave = "mixed";
  state.ally = emptyBoard();
  state.enemy = emptyBoard();
  state.synergies = [];
  state.synergyPool = [];
  state.activeSynergyIds = new Set();
  state.relics = [];
  state.raidOffers = [];
  state.raidContract = null;
  state.ally[0] = makeCat(BREEDS[0], "ally", 0);
  state.ally[1] = makeCat(BREEDS[1], "ally", 1);
  state.enemy[0] = makeCat(BREEDS[2], "enemy", 0);
  assert(state.ally[0] && state.ally[1] && state.enemy[0]);
  state.ally[0].hp = allyHp[0];
  state.ally[1].hp = allyHp[1];
  state.enemy[0].hp = enemyHp;
  return state;
}

const victory = battleState(91001);
startBattle(victory);
assert.equal(victory.phase, "battle", "telemetry fixture 전투가 시작되지 않았다");
assert.equal(victory.lastBattleOutcome, null, "새 전투가 이전 결과를 지우지 않았다");
const firstAlly = victory.ally[0];
const removedAlly = victory.ally[1];
const firstEnemy = victory.enemy[0];
assert(firstAlly && removedAlly && firstEnemy);
firstAlly.hp += 999;
victory.ally[1] = null;
const lateAlly = makeCat(BREEDS[3], "ally", 2);
victory.ally[2] = lateAlly;
victory.summons.push(makeCat(BREEDS[4], "ally", 3));
firstEnemy.hp = 20;
victory.battleElapsed = 1234;
const callsBeforeVictory = rngCalls();
finishWave(victory, true);
assert.equal(rngCalls(), callsBeforeVictory, "전투 결과 기록이 난수를 소비했다");
assert.deepEqual(
  victory.lastBattleOutcome,
  {
    won: true,
    reason: "victory",
    elapsedMs: 1234,
    allyStartHp: 150,
    allyRemainingHp: 100,
    enemyStartHp: 40,
    enemyRemainingHp: 20,
  },
  "회복 전 승리 결과가 baseline UID·clamp 계약과 다르다",
);
assert.equal(victory.summons.length, 0, "기존 finishWave의 소환수 정리가 깨졌다");

victory.phase = "prepare";
victory.wave = 1;
victory.step = 0;
victory.nodeKind = "battle";
victory.nodeWave = "mixed";
victory.ally = emptyBoard();
victory.enemy = emptyBoard();
victory.ally[0] = makeCat(BREEDS[3], "ally", 0);
victory.ally[1] = makeCat(BREEDS[4], "ally", 1);
victory.enemy[0] = makeCat(BREEDS[5], "enemy", 0);
const nextAlly = victory.ally[0];
const nextRemovedAlly = victory.ally[1];
const nextEnemy = victory.enemy[0];
assert(nextAlly && nextRemovedAlly && nextEnemy);
nextAlly.hp = 70;
nextRemovedAlly.hp = 20;
nextEnemy.hp = 30;
startBattle(victory);
assert.equal(victory.lastBattleOutcome, null, "다음 전투 시작이 이전 결과를 지우지 않았다");
nextAlly.hp = 35;
victory.ally[1] = null;
nextEnemy.hp = 15;
victory.battleElapsed = 777;
finishWave(victory, true);
assert.deepEqual(
  victory.lastBattleOutcome,
  {
    won: true,
    reason: "victory",
    elapsedMs: 777,
    allyStartHp: 90,
    allyRemainingHp: 35,
    enemyStartHp: 30,
    enemyRemainingHp: 15,
  },
  "두 번째 전투가 첫 전투 기준선을 재사용했다",
);

const routedVictory = battleState(91004, [80, 30], 40);
startBattle(routedVictory);
const routedVictoryEnemy = routedVictory.enemy[0];
assert(routedVictoryEnemy);
routedVictoryEnemy.alive = false;
routedVictoryEnemy.hp = 0;
stepBattle(routedVictory, 100);
assert.deepEqual(
  routedVictory.lastBattleOutcome,
  {
    won: true,
    reason: "victory",
    elapsedMs: 100,
    allyStartHp: 110,
    allyRemainingHp: 110,
    enemyStartHp: 40,
    enemyRemainingHp: 0,
  },
  "stepBattle 승리 종료가 telemetry에 연결되지 않았다",
);
assert.equal(
  Object.prototype.propertyIsEnumerable.call(routedVictory, "lastBattleOutcome"),
  false,
  "채워진 telemetry 결과가 enumerable 속성으로 바뀌었다",
);
assert.equal(
  JSON.stringify(routedVictory).includes("lastBattleOutcome"),
  false,
  "채워진 telemetry 결과가 런 직렬화 형식에 섞였다",
);

const routedWipe = battleState(91005, [100, 50], 40);
startBattle(routedWipe);
for (const ally of routedWipe.ally) {
  if (!ally) continue;
  ally.alive = false;
  ally.hp = 0;
}
stepBattle(routedWipe, 100);
assert.deepEqual(
  routedWipe.lastBattleOutcome,
  {
    won: false,
    reason: "wipe",
    elapsedMs: 100,
    allyStartHp: 150,
    allyRemainingHp: 0,
    enemyStartHp: 40,
    enemyRemainingHp: 40,
  },
  "stepBattle 전멸 종료가 기본 wipe 사유에 연결되지 않았다",
);

const routedTimeout = battleState(91006, [90, 30], 40);
startBattle(routedTimeout);
routedTimeout.battleElapsed = 15_900;
stepBattle(routedTimeout, 100);
assert.deepEqual(
  routedTimeout.lastBattleOutcome,
  {
    won: false,
    reason: "timeout",
    elapsedMs: 16_000,
    allyStartHp: 120,
    allyRemainingHp: 120,
    enemyStartHp: 40,
    enemyRemainingHp: 40,
  },
  "stepBattle 타임아웃 종료가 telemetry에 연결되지 않았다",
);

const timeout = battleState(91002);
startBattle(timeout);
const timeoutAlly = timeout.ally[0];
const timeoutEnemy = timeout.enemy[0];
assert(timeoutAlly && timeoutEnemy);
const timeoutAllyStart = timeout.ally.reduce((sum, cat) => sum + (cat?.hp ?? 0), 0);
const timeoutEnemyStart = timeoutEnemy.hp;
timeoutAlly.hp /= 2;
timeoutEnemy.hp += 999;
timeout.battleElapsed = 16000;
const callsBeforeTimeout = rngCalls();
finishWave(timeout, false, "timeout");
assert.equal(rngCalls(), callsBeforeTimeout, "패배 결과 기록이 난수를 소비했다");
assert.deepEqual(
  timeout.lastBattleOutcome,
  {
    won: false,
    reason: "timeout",
    elapsedMs: 16000,
    allyStartHp: timeoutAllyStart,
    allyRemainingHp: timeoutAlly.hp + (timeout.ally[1]?.hp ?? 0),
    enemyStartHp: timeoutEnemyStart,
    enemyRemainingHp: timeoutEnemyStart,
  },
  "회복 전 패배 결과가 baseline UID·clamp 계약과 다르다",
);
assert.equal(timeout.phase, "gameover", "기존 timeout 패배 전이가 깨졌다");

const noBaseline = newRun(91003);
finishWave(noBaseline, false);
assert.equal(noBaseline.lastBattleOutcome, null, "전투 시작 기준선 없이 결과를 날조했다");
assert.equal(
  Object.prototype.propertyIsEnumerable.call(noBaseline, "lastBattleOutcome"),
  false,
  "telemetry 결과가 enumerable 상태에 섞였다",
);
assert.equal(
  JSON.stringify(noBaseline).includes("lastBattleOutcome"),
  false,
  "telemetry 결과가 런 직렬화 형식을 바꿨다",
);

console.log(
  "battle outcome telemetry passed — 실제 종료 3경로 · 부분 HP 기준선 · UID/clamp · 직렬화/RNG 불개입",
);
