import assert from "node:assert/strict";

import { BALANCE } from "../src/game/balance.ts";
import {
  FX_CAP,
  POP_CAP,
  SHOT_CAP,
  clearBattleFx,
  combatFeedbackObservation,
  damagePops,
  fxs,
  shots,
  spawnArrivalFx,
  stepBattle,
} from "../src/game/battle.ts";
import { BREEDS, NIGHTMARE_BREEDS } from "../src/game/breeds.ts";
import { combatStatusVisuals, combatVectorProgress } from "../src/game/render.ts";
import { makeCat, newRun, startBattle } from "../src/game/run.ts";

let seed = 950_000;

function activeBreed(skill) {
  const breed = BREEDS.find((candidate) => candidate.skill === skill);
  assert(breed, `${skill} 품종을 찾지 못했습니다`);
  return breed;
}

function prepareScene(casterBreed, { hurtAlly = false, enemyCount = 4 } = {}) {
  clearBattleFx();
  const state = newRun(seed++);
  state.phase = "prepare";
  state.ally.fill(null);
  state.enemy.fill(null);
  state.summons.length = 0;

  const caster = makeCat(casterBreed, "ally", 12);
  const helperBreed = BREEDS.find((breed) => breed.id === 1) ?? BREEDS[0];
  assert(helperBreed, "보조 아군 품종이 없습니다");
  const helper = makeCat(helperBreed, "ally", 13);
  state.ally[12] = caster;
  state.ally[13] = helper;

  const enemies = [];
  for (let i = 0; i < enemyCount; i++) {
    const breed = NIGHTMARE_BREEDS[i % NIGHTMARE_BREEDS.length];
    assert(breed, `적 품종 ${i}를 찾지 못했습니다`);
    const enemy = makeCat(breed, "enemy", 10 + i);
    enemy.cooldown = 100_000;
    enemy.evade = 0;
    state.enemy[10 + i] = enemy;
    enemies.push(enemy);
  }

  startBattle(state);
  assert.equal(state.phase, "battle", "전투 진입에 실패했습니다");
  // 첫 스텝 전용 도약/분신은 이 테스트의 스킬·평타 피드백과 무관하므로 건너뛴다.
  state.battleElapsed = 100;
  caster.fx = 4;
  caster.fy = 2;
  caster.cooldown = 0;
  helper.fx = 3.7;
  helper.fy = 2.55;
  helper.cooldown = 100_000;
  helper.hp = hurtAlly ? Math.max(1, Math.floor(helper.maxHp * 0.35)) : helper.maxHp;
  enemies.forEach((enemy, index) => {
    enemy.fx = 4.45 + (index % 2) * 0.18;
    enemy.fy = 1.75 + Math.floor(index / 2) * 0.32;
    enemy.cooldown = 100_000;
  });

  return { state, caster, helper, enemies };
}

function runBasic(kind, miss = false) {
  const breed = kind === "melee"
    ? BREEDS.find((candidate) => candidate.passive === "combo")
    : BREEDS.find((candidate) => candidate.passive === "ricochet");
  assert(breed, `${kind} 평타 품종을 찾지 못했습니다`);
  const scene = prepareScene(breed, { enemyCount: 1 });
  scene.caster.mana = 0;
  scene.enemies[0].evade = miss ? 1 : 0;
  stepBattle(scene.state, 100);
  return scene;
}

assert.equal(BALANCE.battleSpeed, 0.5, "브라우저 전투 배율은 정확히 0.5여야 합니다");

const EXPECTED_ACTIVE_SKILLS = [
  "bulwark",
  "ember",
  "frost_nova",
  "gouge",
  "guard",
  "lure",
  "mend",
  "pierce",
  "shadow_strike",
  "shockwave",
  "swarm",
  "volley",
  "whirlwind",
];
const activeSkills = [...new Set(BREEDS.map((breed) => breed.skill).filter((skill) => skill !== null))].sort();
assert.deepEqual(activeSkills, EXPECTED_ACTIVE_SKILLS, "액티브 스킬 13종 계약이 바뀌었습니다");

const melee = runBasic("melee");
let observation = combatFeedbackObservation(melee.state);
assert.equal(observation.totals.attacks.melee, 1, "근접 평타가 관찰되지 않았습니다");
assert(observation.totals.hits.damage >= 1, "근접 피해가 관찰되지 않았습니다");
assert(fxs.some((fx) => fx.kind === "impact" && fx.impact === "hit"), "근접 충돌 X가 생성되지 않았습니다");
assert(damagePops.some((pop) => /^\d+$/.test(pop.text)), "근접 피해 숫자가 생성되지 않았습니다");

const ranged = runBasic("ranged");
observation = combatFeedbackObservation(ranged.state);
assert.equal(observation.totals.attacks.ranged, 1, "원거리 평타가 관찰되지 않았습니다");
assert(shots.some((shot) => shot.hit), "원거리 hit tracer가 생성되지 않았습니다");
assert(fxs.some((fx) => fx.kind === "impact" && fx.impact === "hit"), "원거리 충돌 X가 생성되지 않았습니다");

const rangedMiss = runBasic("ranged", true);
observation = combatFeedbackObservation(rangedMiss.state);
assert.equal(observation.totals.hits.miss, 1, "빗나감 판정이 관찰되지 않았습니다");
assert(shots.some((shot) => !shot.hit), "빗나감 tracer가 결과를 보존하지 않았습니다");
assert(!fxs.some((fx) => fx.kind === "impact" && fx.impact === "hit"), "빗나감에 충돌광이 생성됐습니다");
assert(damagePops.some((pop) => pop.text === "빗나감"), "빗나감 문구가 생성되지 않았습니다");

const meleeMiss = runBasic("melee", true);
observation = combatFeedbackObservation(meleeMiss.state);
assert.equal(observation.totals.hits.miss, 1, "근접 빗나감 판정이 관찰되지 않았습니다");
assert(fxs.some((fx) => fx.kind === "impact" && fx.impact === "miss"), "근접 빗나감 갈라진 선이 없습니다");

const skillSignatures = new Map();
for (const skill of activeSkills) {
  const scene = prepareScene(activeBreed(skill), { hurtAlly: skill === "mend" });
  scene.caster.mana = scene.caster.manaMax;
  stepBattle(scene.state, 100);
  const skillObservation = combatFeedbackObservation(scene.state);
  assert.equal(skillObservation.totals.skills[skill], 1, `${skill} 시전이 관찰되지 않았습니다`);
  assert(fxs.length > 0, `${skill} 시각 피드백이 비었습니다`);
  const signature = fxs
    .map((fx) => [fx.kind, fx.impact ?? "", fx.status ?? "", fx.radius.toFixed(2), fx.label ?? ""].join(":"))
    .sort()
    .join("|");
  skillSignatures.set(skill, signature);
}
assert.equal(skillSignatures.size, activeSkills.length, "일부 액티브 스킬이 테스트에서 누락됐습니다");
assert.equal(new Set(skillSignatures.values()).size, activeSkills.length, "서로 다른 스킬 피드백 문법이 겹칩니다");

const guard = prepareScene(activeBreed("guard"));
guard.caster.mana = guard.caster.manaMax;
stepBattle(guard.state, 100);
assert(guard.caster.shield > 0 && guard.helper.shield > 0, "보호막 상태가 실제 대상에게 적용되지 않았습니다");
assert(combatStatusVisuals(guard.caster).some((status) => status.kind === "shield"), "보호막 유지 마커가 없습니다");
assert(fxs.some((fx) => fx.kind === "status" && fx.status === "shield" && !fx.ending), "보호막 적용 피드백이 없습니다");

clearBattleFx();
guard.caster.cooldown = 0;
guard.caster.mana = guard.caster.manaMax;
stepBattle(guard.state, 100);
assert(!fxs.some((fx) => fx.kind === "status" && fx.status === "shield" && !fx.ending),
  "보호막 값이 그대로인데 적용 피드백이 반복됐습니다");

const shielded = guard.caster;
const shieldBreaker = guard.enemies[0];
guard.state.ally.fill(null);
guard.state.ally[12] = shielded;
guard.state.enemy.fill(null);
guard.state.enemy[10] = shieldBreaker;
shielded.cooldown = 100_000;
shielded.hp = shielded.maxHp;
shieldBreaker.fx = shielded.fx + 0.1;
shieldBreaker.fy = shielded.fy;
shieldBreaker.cooldown = 0;
shieldBreaker.mana = 0;
shieldBreaker.atk = shielded.shield + 1;
clearBattleFx();
stepBattle(guard.state, 100);
assert.equal(shielded.shield, 0, "보호막이 실제 타격으로 파괴되지 않았습니다");
assert(fxs.some((fx) => fx.kind === "status" && fx.status === "shield" && fx.ending && fx.label === "보호막 파괴"),
  "보호막 파괴 피드백이 없습니다");

const stun = prepareScene(activeBreed("shockwave"));
stun.caster.mana = stun.caster.manaMax;
stepBattle(stun.state, 100);
assert(stun.enemies.some((enemy) => enemy.stun > 0), "기절 상태가 적용되지 않았습니다");
assert(stun.enemies.some((enemy) => combatStatusVisuals(enemy).some((status) => status.kind === "stun")), "기절 유지 마커가 없습니다");
assert(fxs.some((fx) => fx.kind === "status" && fx.status === "stun"), "기절 적용 피드백이 없습니다");

for (const enemy of stun.enemies) enemy.stun = 999_999;
stun.caster.cooldown = 0;
stun.caster.mana = stun.caster.manaMax;
clearBattleFx();
stepBattle(stun.state, 100);
assert(!fxs.some((fx) => fx.kind === "status" && fx.status === "stun" && !fx.ending),
  "더 긴 기절이 유지 중인데 적용 피드백이 반복됐습니다");

const stunned = stun.enemies[0];
stun.state.phase = "prepare";
stunned.stun = 100;
clearBattleFx();
stepBattle(stun.state, 100);
assert.equal(stunned.stun, 0, "기절 시간이 끝나지 않았습니다");
assert(fxs.some((fx) => fx.kind === "status" && fx.status === "stun" && fx.ending && fx.label === "기절 해제"),
  "기절 해제 피드백이 없습니다");

const dot = prepareScene(activeBreed("ember"));
dot.caster.mana = dot.caster.manaMax;
stepBattle(dot.state, 100);
assert(dot.enemies.some((enemy) => enemy.dot), "지속 피해 상태가 적용되지 않았습니다");
assert(dot.enemies.some((enemy) => combatStatusVisuals(enemy).some((status) => status.kind === "dot")), "지속 피해 유지 마커가 없습니다");
assert(fxs.some((fx) => fx.kind === "status" && fx.status === "dot"), "지속 피해 적용 피드백이 없습니다");

const burning = dot.enemies.find((enemy) => enemy.dot);
assert(burning, "지속 피해 비교 대상이 없습니다");
dot.state.phase = "prepare";
burning.maxHp = 1_000;
burning.hp = 1_000;
burning.shield = 0;
burning.alive = true;
burning.dot = { dps: 20, remain: 1_000 };
clearBattleFx();
for (let i = 0; i < 120; i++) stepBattle(dot.state, 1_000 / 120, 0);
const fineFrameHp = burning.hp;
assert.equal(fineFrameHp, 980, "60fps 반속 DoT가 100ms 틱 열 번을 적용하지 않았습니다");
assert.equal(burning.dot, null, "60fps 반속 DoT가 만료되지 않았습니다");
assert(fxs.some((fx) => fx.kind === "status" && fx.status === "dot" && fx.ending && fx.label === "지속 피해 종료"),
  "지속 피해 종료 피드백이 없습니다");

burning.hp = 1_000;
burning.alive = true;
burning.dot = { dps: 20, remain: 1_000 };
clearBattleFx();
for (let i = 0; i < 10; i++) stepBattle(dot.state, 100, 0);
assert.equal(burning.hp, fineFrameHp, "60fps 반속 DoT와 헤드리스 100ms DoT 피해가 다릅니다");
assert.equal(burning.dot, null, "헤드리스 100ms DoT가 만료되지 않았습니다");

const mend = prepareScene(activeBreed("mend"), { hurtAlly: true });
const hpBefore = mend.helper.hp;
mend.caster.mana = mend.caster.manaMax;
stepBattle(mend.state, 100);
assert(mend.helper.hp > hpBefore, "회복이 실제 체력에 적용되지 않았습니다");
assert(damagePops.some((pop) => pop.heal && pop.text.startsWith("+")), "회복 숫자 피드백이 없습니다");

// 브라우저의 두 시간축 계약: 유닛 flash는 반속 판정 시간, transient는 실시간으로 줄어든다.
const timing = runBasic("melee");
const target = timing.enemies[0];
const impact = fxs.find((fx) => fx.kind === "impact");
assert(impact, "시간축 검사용 impact가 없습니다");
const flashBefore = target.flash;
const impactBefore = impact.life;
timing.state.phase = "prepare";
stepBattle(timing.state, 50, 100);
assert.equal(target.flash, Math.max(0, flashBefore - 50), "유닛 피격 flash가 판정 시간으로 줄지 않았습니다");
assert.equal(impact.life, impactBefore - 100, "transient FX가 실시간 표현 시간으로 줄지 않았습니다");
assert.notEqual(combatVectorProgress(180, 360, false), combatVectorProgress(90, 360, false),
  "일반 모션의 벡터 진행률이 수명에 반응하지 않습니다");
assert.equal(combatVectorProgress(180, 360, true), combatVectorProgress(90, 360, true),
  "모션 축소에서 충돌·상태 벡터 기하가 움직입니다");

const maxLife = Math.max(
  0,
  ...fxs.map((fx) => fx.life),
  ...shots.map((shot) => shot.life),
  ...damagePops.map((pop) => pop.life),
);
stepBattle(timing.state, 0, maxLife + 1);
assert.equal(fxs.length, 0, "FX가 TTL 뒤 남았습니다");
assert.equal(shots.length, 0, "tracer가 TTL 뒤 남았습니다");
assert.equal(damagePops.length, 0, "피드백 문구가 TTL 뒤 남았습니다");

clearBattleFx();
for (let i = 0; i < FX_CAP * 2; i++) spawnArrivalFx(i % 5, Math.floor(i / 5) % 5);
assert.equal(fxs.length, FX_CAP, `FX 큐가 상한에서 봉인되지 않았습니다 (${fxs.length}/${FX_CAP})`);

const queueBreed = BREEDS.find((breed) => breed.passive === "ricochet");
assert(queueBreed, "큐 상한 검사용 원거리 품종이 없습니다");
const queueScene = prepareScene(queueBreed, { enemyCount: 1 });
const queueTarget = queueScene.enemies[0];
queueTarget.maxHp = 1_000_000;
queueTarget.hp = 1_000_000;
queueScene.caster.atk = 1;
clearBattleFx();
for (let i = 0; i < Math.max(POP_CAP, SHOT_CAP) * 2; i++) {
  queueScene.caster.cooldown = 0;
  queueScene.caster.mana = 0;
  stepBattle(queueScene.state, 100, 0);
}
assert.equal(damagePops.length, POP_CAP, `피해 팝업 큐가 실제 공격 상한에서 봉인되지 않았습니다 (${damagePops.length}/${POP_CAP})`);
assert.equal(shots.length, SHOT_CAP, `tracer 큐가 실제 공격 상한에서 봉인되지 않았습니다 (${shots.length}/${SHOT_CAP})`);

clearBattleFx();
observation = combatFeedbackObservation();
assert.deepEqual(observation.totals.attacks, { melee: 0, ranged: 0 }, "clearBattleFx가 공격 누적값을 초기화하지 않았습니다");
assert.equal(observation.active.fxs.count + observation.active.shots.count + observation.active.pops.count, 0, "clearBattleFx 뒤 transient가 남았습니다");

console.log(`combat-feedback PASS · speed ×${BALANCE.battleSpeed} · ${activeSkills.length} skills · attack/hit/status/TTL/caps sealed`);
