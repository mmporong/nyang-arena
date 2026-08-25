/** 취약 창 local budget 계약 검사. 실행: npm run strike:test */
import assert from "node:assert/strict";
import { BALANCE } from "../src/game/balance.ts";
import { clearBattleFx, creepZones, queueIntervention, stepBattle } from "../src/game/battle.ts";
import { breedById } from "../src/game/breeds.ts";
import { BOSS_BREEDS } from "../src/game/bosses.ts";
import { isBossStep, STAGE_STEPS } from "../src/game/map.ts";
import { buildEnemyWave, currentKind, makeCat, newRun, startBattle } from "../src/game/run.ts";
import { buttonText } from "../src/game/render.ts";
import { emptyBoard } from "../src/game/types.ts";
import { leaveShop, makeBossBot, VULNERABLE_CASH_OUT_MS, walkMap } from "./bot-policy.mjs";

const STEP_MS = 16;
let passed = 0;
let failed = 0;
function test(name, run) {
  try { run(); passed += 1; console.log(`  OK   ${name}`); }
  catch (error) { failed += 1; console.error(`  실패 ${name}`); console.error(`       ${error.message}`); }
}

function bossFight(seed = 1, open = true) {
  clearBattleFx();
  const state = newRun(seed);
  let bossStep = 0;
  for (let i = 0; i < STAGE_STEPS; i += 1) if (isBossStep(i)) { bossStep = i; break; }
  state.step = bossStep; state.wave = bossStep + 1;
  walkMap(state); state.raidContract = null; state.raidTargetBossIndex = -1;
  // 전투 단위 픽스처도 빈 팀으로 상점을 이탈할 수 없다는 첫 영입 계약을 지킨다.
  state.ally[0] = makeCat(breedById(1), "ally", 0);
  leaveShop(state);
  if (currentKind(state) !== "boss") throw new Error("보스 걸음을 만들지 못했다");
  state.ally = emptyBoard();
  [10, 11, 12, 16, 6].forEach((cell, i) => { state.ally[cell] = makeCat(breedById((i % 8) + 1), "ally", cell); });
  buildEnemyWave(state); startBattle(state);
  const boss = state.enemy.find((cat) => cat?.alive && cat.radius > 0);
  if (!boss) throw new Error("보스를 찾지 못했다");
  for (const ally of state.ally) if (ally) ally.cooldown = Number.MAX_SAFE_INTEGER;
  boss.telegraph = null; boss.telegraph2 = null; boss.blink = null; boss.finalPhase = null;
  boss.thresholdIdx = 999; boss.vulnerableUsed = open; boss.vulnerableMs = open ? 5000 : 0;
  boss.vulnerableCharges = open ? 2 : 0; boss.hp = boss.maxHp;
  state.dodgeCharges = 2; state.actCooldown = 0; state.pending.length = 0;
  return { state, boss };
}
function press(state, kind = "act") { state.pending.push({ kind }); stepBattle(state, STEP_MS); }
const STRIKE_FRAC = 0.07;
function strikeDamage(boss) { return Math.max(1, Math.round(boss.maxHp * STRIKE_FRAC)); }
function avoidTelegraph(target, arg = 0.75) {
  return { shape: "circle", mode: "avoid", fx: target.fx, fy: target.fy, dirX: 0, dirY: 0, arg, reach: 0, fuse: 1200, fuseMax: 1200 };
}

console.log("취약 창 local budget 검사\n");

test("정상 취약 창이 열리면 local 기회가 정확히 2가 된다", () => {
  const { state, boss } = bossFight(1, false); state.finalPhaseUsed = true; boss.thresholdIdx = 0; boss.hp = 1;
  stepBattle(state, STEP_MS); assert.equal(boss.vulnerableCharges, 2);
});
test("최종 채널이 끝나 마지막 취약 창이 열리면 local 기회가 정확히 2가 된다", () => {
  const { state, boss } = bossFight(2, false);
  boss.finalPhase = { stage: "channel", remainMs: 1, totalMs: 2500, preHp: new Map() }; state.finalPhaseUsed = true;
  stepBattle(state, STEP_MS); assert.equal(boss.vulnerableCharges, 2);
});
test("첫 결정타는 local 기회 하나만 소비한다", () => {
  const { state, boss } = bossFight(3); press(state); assert.equal(boss.vulnerableCharges, 1);
});
test("첫 결정타는 global 회피 차지를 바꾸지 않는다", () => {
  const { state } = bossFight(4); press(state); assert.equal(state.dodgeCharges, 2);
});
test("첫 결정타는 보스 최대 체력의 정확히 7% 피해를 준다", () => {
  assert.equal(BALANCE.strikeFrac, STRIKE_FRAC);
  const { state, boss } = bossFight(5); const before = boss.hp; press(state); assert.equal(before - boss.hp, strikeDamage(boss));
});
test("두 번째 결정타까지 누적 피해가 정확히 14%다", () => {
  const { state, boss } = bossFight(6); const before = boss.hp; press(state); press(state); assert.equal(before - boss.hp, strikeDamage(boss) * 2);
});
test("두 번째 결정타는 마지막 local 기회를 소비한다", () => {
  const { state, boss } = bossFight(7); press(state); press(state); assert.equal(boss.vulnerableCharges, 0);
});
test("local 기회가 0이면 세 번째 결정타는 피해를 주지 않는다", () => {
  const { state, boss } = bossFight(8); press(state); press(state); const before = boss.hp; press(state); assert.equal(boss.hp, before);
});
test("local 기회가 0인 세 번째 입력은 global 차지로 fallback하지 않는다", () => {
  const { state } = bossFight(9); state.dodgeCharges = 7; press(state); press(state); press(state); assert.equal(state.dodgeCharges, 7);
});
test("global 차지가 0이어도 local 기회가 있으면 결정타가 성공한다", () => {
  const { state, boss } = bossFight(10); state.dodgeCharges = 0; const before = boss.hp; press(state); assert.equal(before - boss.hp, strikeDamage(boss));
});
test("취약 창 자연 종료 시 남은 local 기회는 0으로 소멸한다", () => {
  const { state, boss } = bossFight(11); boss.vulnerableMs = 1; stepBattle(state, STEP_MS); assert.equal(boss.vulnerableCharges, 0);
});
test("취약 창 자연 종료는 global 차지를 반환하거나 늘리지 않는다", () => {
  const { state, boss } = bossFight(12); press(state); boss.vulnerableMs = 1; stepBattle(state, STEP_MS); assert.equal(state.dodgeCharges, 2);
});
test("종료 직전 스텝의 결정타는 피해를 먼저 적용한다", () => {
  const { state, boss } = bossFight(13); boss.vulnerableMs = 1; const before = boss.hp; press(state); assert.equal(before - boss.hp, strikeDamage(boss));
});
test("종료 직전 결정타 뒤 같은 스텝에서 local 잔량은 소멸한다", () => {
  const { state, boss } = bossFight(14); boss.vulnerableMs = 1; press(state); assert.equal(boss.vulnerableCharges, 0);
});
test("정상 창에서 최종 채널로 넘어가면 local 잔량이 소멸한다", () => {
  const { state, boss } = bossFight(15); const frost = BOSS_BREEDS.find((breed) => breed.id === 11);
  if (!frost) throw new Error("최종 국면 보스 픽스처가 없다");
  boss.breed = frost; boss.stageBoss = true; boss.hp = Math.max(strikeDamage(boss) + 1, Math.floor(boss.maxHp * 0.09));
  press(state); assert.equal(boss.finalPhase?.stage, "channel"); assert.equal(boss.vulnerableCharges, 0);
});
test("최종 채널 진입은 global 차지를 바꾸지 않는다", () => {
  const { state, boss } = bossFight(16); const frost = BOSS_BREEDS.find((breed) => breed.id === 11);
  if (!frost) throw new Error("최종 국면 보스 픽스처가 없다");
  boss.breed = frost; boss.stageBoss = true; boss.hp = Math.max(strikeDamage(boss) + 1, Math.floor(boss.maxHp * 0.09));
  press(state); assert.equal(state.dodgeCharges, 2);
});
test("최종 채널 중 결정타는 local 기회를 소비하지 않는다", () => {
  const { state, boss } = bossFight(17); boss.finalPhase = { stage: "channel", remainMs: 2000, totalMs: 2500, preHp: new Map() };
  press(state, "strike"); assert.equal(boss.vulnerableCharges, 2);
});
test("순간이동 부재 중 결정타는 local 기회를 소비하지 않는다", () => {
  const { state, boss } = bossFight(18); boss.blink = { phase: "gone", ms: 1000, to: { fx: boss.fx, fy: boss.fy } };
  press(state, "strike"); assert.equal(boss.vulnerableCharges, 2);
});
test("순간이동 부재 중 남은 local 기회를 소진으로 표시하지 않는다", () => {
  const { state, boss } = bossFight(181); state.dodgeCharges = 0;
  boss.blink = { phase: "gone", ms: 1000, to: { fx: boss.fx, fy: boss.fy } };
  assert.equal(buttonText(state), "…");
});
test("붉은 예고가 실제 아군을 위협하면 act는 결정타보다 방어를 우선한다", () => {
  const { state, boss } = bossFight(19); const target = state.ally.find((cat) => cat?.alive); if (!target) throw new Error("회피 대상 아군이 없다");
  boss.telegraph = avoidTelegraph(target); const before = boss.hp; press(state); assert.equal(boss.hp, before);
});
test("위협 중 우선 실행된 방어는 local 기회 하나를 소비한다", () => {
  const { state, boss } = bossFight(20); const target = state.ally.find((cat) => cat?.alive); if (!target) throw new Error("회피 대상 아군이 없다");
  boss.telegraph = avoidTelegraph(target); press(state); assert.equal(boss.vulnerableCharges, 1);
});
test("입력 때 방어였던 act는 지연 중 취약 창이 열려도 결정타로 바뀌지 않는다", () => {
  const { state, boss } = bossFight(201, false);
  const target = state.ally.find((cat) => cat?.alive);
  if (!target) throw new Error("지연 방어 대상 아군이 없다");
  boss.vulnerableUsed = true;
  boss.telegraph = avoidTelegraph(target);
  state.actCooldown = 500;
  queueIntervention(state, { kind: "act" });
  assert.equal(state.pending[0]?.kind, "dodge", "입력 시점 방어 의도가 큐에 고정되지 않았다");

  boss.telegraph = null;
  boss.vulnerableMs = 5000;
  boss.vulnerableCharges = 2;
  state.actCooldown = 0;
  const beforeHp = boss.hp;
  stepBattle(state, STEP_MS);
  assert.deepEqual(
    { hp: boss.hp, local: boss.vulnerableCharges, queued: state.pending.length },
    { hp: beforeHp, local: 2, queued: 0 },
  );
});
test("기준 보스 봇은 취약 창보다 실제 방어를 우선한다", () => {
  const { state, boss } = bossFight(202);
  const target = state.ally.find((cat) => cat?.alive);
  if (!target) throw new Error("봇 방어 대상 아군이 없다");
  boss.telegraph = avoidTelegraph(target);
  const respond = makeBossBot();
  respond(state);
  respond(state);
  respond(state);
  assert.equal(state.pending[0]?.kind, "dodge");
});
test("기준 보스 봇은 pending에 같은 방어가 있으면 중복 큐잉하지 않는다", () => {
  const { state, boss } = bossFight(203);
  const target = state.ally.find((cat) => cat?.alive);
  if (!target) throw new Error("봇 중복 방어 대상 아군이 없다");
  boss.telegraph = avoidTelegraph(target);
  const respond = makeBossBot();
  for (let i = 0; i < 8; i += 1) respond(state);
  assert.deepEqual(state.pending.map((intent) => intent.kind), ["dodge"]);
});
test("기준 보스 봇은 정상 창 첫 공격 뒤 둘째 기회를 마지막 유예까지 보존한다", () => {
  const { state, boss } = bossFight(204);
  const respond = makeBossBot();
  respond(state);
  stepBattle(state, STEP_MS);
  boss.vulnerableMs = VULNERABLE_CASH_OUT_MS + 1;
  respond(state);
  const beforeBoundary = state.pending.length;
  boss.vulnerableMs = VULNERABLE_CASH_OUT_MS;
  respond(state);
  assert.deepEqual(
    { localAfterFirst: boss.vulnerableCharges, beforeBoundary, atBoundary: state.pending[0]?.kind },
    { localAfterFirst: 1, beforeBoundary: 0, atBoundary: "strike" },
  );
});
test("기준 보스 봇은 최종 취약 창의 두 기회를 즉시 피니시에 쓴다", () => {
  const { state, boss } = bossFight(205);
  boss.finalPhase = { stage: "open", remainMs: 0, totalMs: 2500, preHp: new Map() };
  boss.hp = Math.max(1, Math.round(boss.maxHp * 0.08));
  const respond = makeBossBot();
  respond(state);
  stepBattle(state, STEP_MS);
  respond(state);
  stepBattle(state, STEP_MS);
  assert.equal(boss.alive, false);
});
test("안전한 상주 장판만 남아 있으면 act는 결정타를 실행한다", () => {
  const { state, boss } = bossFight(21);
  creepZones.push({ ...avoidTelegraph({ fx: -100, fy: -100 }, 0.2), idleMs: 0, stepIdx: 0, tickDamage: 1 });
  const before = boss.hp; press(state); assert.equal(before - boss.hp, strikeDamage(boss));
});
test("위험한 상주 장판 안에 아군이 있으면 act는 결정타보다 방어를 우선한다", () => {
  const { state, boss } = bossFight(22); const target = state.ally.find((cat) => cat?.alive); if (!target) throw new Error("상주 장판 대상 아군이 없다");
  creepZones.push({ ...avoidTelegraph(target), idleMs: 0, stepIdx: 0, tickDamage: 1 });
  const before = boss.hp; press(state); assert.equal(boss.hp, before);
});
test("기존 act 쿨다운 중에도 결정타는 성공한다", () => {
  const { state, boss } = bossFight(23); state.actCooldown = 500; const before = boss.hp; press(state); assert.equal(before - boss.hp, strikeDamage(boss));
});
test("결정타는 기존 act 쿨다운을 시간 경과만큼만 줄인다", () => {
  const { state } = bossFight(24); state.actCooldown = 500; press(state); assert.equal(state.actCooldown, 500 - STEP_MS);
});
test("최종 취약 창의 두 결정타가 보스를 끝낸다", () => {
  const { state, boss } = bossFight(25, false); boss.finalPhase = { stage: "channel", remainMs: 1, totalMs: 2500, preHp: new Map() };
  state.finalPhaseUsed = true; boss.hp = 1; stepBattle(state, STEP_MS); press(state); press(state); assert.equal(boss.alive, false);
});
test("결정타로 보스가 죽으면 local 기회가 0이 된다", () => {
  const { state, boss } = bossFight(26); boss.hp = strikeDamage(boss); press(state); assert.equal(boss.vulnerableCharges, 0);
});
test("전투 패배로 종료되면 남은 local 기회가 0이 된다", () => {
  const { state, boss } = bossFight(27);
  for (const ally of state.ally) if (ally) { ally.hp = 0; ally.alive = false; }
  stepBattle(state, STEP_MS);
  assert.equal(boss.vulnerableCharges, 0);
});

console.log(`\n${failed === 0 ? `전부 통과 — local budget 계약 ${passed}건` : `${failed}건 실패 · ${passed}건 통과`}`);
process.exit(failed === 0 ? 0 : 1);
