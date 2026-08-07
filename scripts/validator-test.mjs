/**
 * 검증기 적대 테스트 — 모델이 규칙을 어겼을 때 실제로 막히는지 증명한다.
 *
 * "LLM이 스키마를 지킬 것"이라고 믿으면 안 된다. scripts/synergy-adversarial.json은
 * 흔한 이탈 유형(없는 트리거, 없는 효과 키, 문자열 수치, 무한대, id 중복,
 * 태그 삽입, 범위 초과)을 모아둔 것이고, 이 테스트는 각각이 폐기되거나
 * 안전한 값으로 눌리는지 확인한다.
 *
 * 실행: npm test
 */
import { readFileSync } from "node:fs";
import { checkRelicTable, RELICS } from "../src/game/relics.ts";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { EFFECT_RANGE, validateAll } from "../src/validate/synergy-schema.ts";
import { BOSSES_PER_STAGE, checkStage, isBossStep, makeStage, STAGE_STEPS } from "../src/game/map.ts";
import { BOSS_BREEDS, bossForIndex } from "../src/game/bosses.ts";
import { bossIndexAt } from "../src/game/run.ts";
import { seedRng } from "../src/game/rng.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(readFileSync(resolve(HERE, "synergy-adversarial.json"), "utf8"));

const { accepted, rejected } = validateAll(raw);

console.log(`적대 입력 ${raw.length}개 → 폐기 ${rejected.length}개, 통과 ${accepted.length}개\n`);
console.log("폐기된 항목:");
for (const r of rejected) {
  const id = typeof r.raw === "object" && r.raw !== null ? r.raw.id : String(r.raw).slice(0, 24);
  console.log(`  ${String(id).padEnd(14)} ${r.reason}`);
}
console.log("\n통과했지만 값이 눌린 항목:");
for (const a of accepted) {
  console.log(`  ${a.id.padEnd(14)} name="${a.name}" ${a.effect.key}=${a.effect.value}`);
}

const failures = [];

// 1) 통과분은 전부 허용 범위 안이어야 한다.
for (const a of accepted) {
  const [lo, hi] = EFFECT_RANGE[a.effect.key];
  if (a.effect.value < lo || a.effect.value > hi) {
    failures.push(`${a.id}: 값 ${a.effect.value}가 범위 [${lo}, ${hi}] 밖`);
  }
}

// 2) 통과분 이름에 꺾쇠가 남아 있으면 안 된다.
for (const a of accepted) {
  if (/[<>]/.test(a.name) || /[<>]/.test(a.desc)) failures.push(`${a.id}: 이름/설명에 꺾쇠 잔존`);
}

// 3) 명백히 불법인 항목은 반드시 폐기돼야 한다.
const mustReject = ["quad_color", "finisher", "9bad_id", "stringy", "no_effect", "nan_value"];
// 같은 id가 두 번 오면 두 번째만 폐기되고 첫 번째는 살아야 한다.
if (accepted.filter((a) => a.id === "dup_id").length !== 1) failures.push("dup_id: 정확히 1개만 통과했어야 함");
const acceptedIds = new Set(accepted.map((a) => a.id));
for (const id of mustReject) {
  if (acceptedIds.has(id)) failures.push(`${id}: 폐기됐어야 하는데 통과함`);
}

// 4) 범위 초과 항목은 폐기가 아니라 클램프여야 한다 (규칙을 잃지 않기 위해).
const clamped = accepted.find((a) => a.id === "overshoot");
if (!clamped) failures.push("overshoot: 클램프되어 통과했어야 함");
else if (clamped.effect.value !== EFFECT_RANGE.atk_mul[1]) {
  failures.push(`overshoot: 상한 ${EFFECT_RANGE.atk_mul[1]}로 눌렸어야 하는데 ${clamped.effect.value}`);
}

if (failures.length > 0) {
  console.log("\n실패:");
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log("\n전부 통과 — 검증기가 적대 입력을 모두 막거나 안전한 값으로 눌렀다.");

/* ------------------------------------------------------------------ */
/* 유물 테이블 계약                                                     */
/* ------------------------------------------------------------------ */

// 유물은 손으로 쓴 상수라 검증기를 만들지 않았다. 대신 되돌리기 쉬운 실수만
// 막는다 — 대가의 부호를 뒤집어 쓰면 불이익이 아니라 강화가 되고, 그건
// 타입 시스템이 잡아 주지 않는다(number는 number다).
const relicProblems = checkRelicTable();
console.log("\n유물 테이블 계약");
if (relicProblems.length === 0) {
  console.log(`  OK   유물 ${RELICS.length}종 — id 중복 없음, 대가는 불이익, 보너스는 이익`);
} else {
  for (const p of relicProblems) console.log(`  실패 ${p}`);
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/* 지도 계약                                                            */
/* ------------------------------------------------------------------ */

/**
 * 지도는 **수렴하는 DAG**다. 갈래는 벌어졌다가 보스에서 하나로 만난다.
 *
 * 트리로 짜면 잎이 기하급수로 늘어 보스를 여럿 둬야 하고, 그물로 짜면 지금
 * 고르는 것이 다음 선택지를 좁힌다는 감각이 사라진다. 그 감각이 지도의 본체다.
 *
 * 생성기가 조용히 망가지면(모든 걸음이 한 갈래가 되거나, 닿을 수 없는 칸이
 * 생기거나) 지도는 화면에만 남고 결정은 사라진다. 눈으로는 잘 안 보이는
 * 고장이라 계약으로 묶는다. 시드를 200개 돌려 전부 검사한다.
 */
const mapFailures = [];
let laneTotal = 0;
let laneSteps = 0;
for (let seed = 1; seed <= 200; seed++) {
  seedRng(seed);
  for (let stage = 1; stage <= 4; stage++) {
    const m = makeStage(stage);
    for (const p of checkStage(m)) mapFailures.push(`시드 ${seed} 스테이지 ${stage}: ${p}`);
    m.steps.forEach((row, i) => {
      if (!isBossStep(i)) { laneTotal += row.length; laneSteps += 1; }
    });
  }
}

// 같은 시드는 같은 지도를 내야 한다. 이게 깨지면 "시드 하나로 판을 재현한다"가 거짓말이 된다.
seedRng(4242);
const mapA = JSON.stringify(makeStage(2));
seedRng(4242);
const mapB = JSON.stringify(makeStage(2));
if (mapA !== mapB) mapFailures.push("같은 시드가 다른 지도를 냈다");

console.log("\n지도 계약");
if (mapFailures.length === 0) {
  console.log(
    `  OK   시드 200 x 스테이지 4 — 보스에서 수렴, 끊긴 선 없음, 닿을 수 없는 칸 없음`,
  );
  console.log(`  OK   갈림길 한 걸음당 평균 ${(laneTotal / laneSteps).toFixed(2)}갈래`);
} else {
  for (const p of mapFailures.slice(0, 10)) console.log(`  실패 ${p}`);
  console.log(`  (총 ${mapFailures.length}건)`);
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/* 보스 신원 계약                                                       */
/* ------------------------------------------------------------------ */

/**
 * 보스의 신원은 **(여정, 걸음)에서만** 나와야 한다.
 *
 * 상점 칸은 걸음만 먹고 웨이브는 안 먹는다. 그래서 신원이 웨이브 번호를 보면
 * 상점을 밟은 판에서 인덱스가 되감기고, **한 여정에 같은 이름의 보스가 두 번**
 * 나온다. 실제로 그랬다 — 스폰은 웨이브를, 지도 라벨은 걸음을, 호버 설명은 또
 * 다른 식을 보고 있었다.
 *
 * 눈으로는 상점을 세 번 밟는 경로를 골라야만 보이는 고장이라 계약으로 묶는다.
 */
const bossFailures = [];

// 종류가 한 여정의 보스 수보다 적으면 애초에 중복을 피할 수 없다.
if (BOSS_BREEDS.length < BOSSES_PER_STAGE) {
  bossFailures.push(`보스 종류 ${BOSS_BREEDS.length}가 한 여정의 보스 수 ${BOSSES_PER_STAGE}보다 적다`);
}

for (let stage = 1; stage <= 8; stage++) {
  const seen = [];
  for (let step = 0; step < STAGE_STEPS; step++) {
    if (!isBossStep(step)) continue;
    /**
     * 같은 (여정, 걸음)인데 웨이브만 다른 상태. 상점을 몇 번 밟았느냐의 차이다.
     * `bossIndexAt`이 웨이브를 읽으면 여기서 값이 갈린다.
     */
    const ids = [1, 4, 9, 17].map((wave) => bossForIndex(bossIndexAt({ map: { stage }, step, wave }, step)).id);
    if (new Set(ids).size !== 1) {
      bossFailures.push(`여정 ${stage} 걸음 ${step}: 웨이브에 따라 보스가 갈린다 (${ids.join("/")})`);
    }
    seen.push(ids[0]);
  }
  if (new Set(seen).size !== seen.length) {
    const names = seen.map((id) => BOSS_BREEDS.find((b) => b.id === id)?.name ?? id);
    bossFailures.push(`여정 ${stage}: 같은 보스가 두 번 나온다 — ${names.join(", ")}`);
  }
}

console.log("\n보스 신원 계약");
if (bossFailures.length === 0) {
  const sample = Array.from({ length: STAGE_STEPS }, (_, i) => i)
    .filter(isBossStep)
    .map((step) => bossForIndex(bossIndexAt({ map: { stage: 1 }, step, wave: 1 }, step)).name);
  console.log(`  OK   여정 8개 — 한 여정에 같은 보스 없음, 웨이브 번호에 안 흔들림`);
  console.log(`  OK   1번째 여정: ${sample.join(" → ")}`);
} else {
  for (const p of bossFailures) console.log(`  실패 ${p}`);
  process.exit(1);
}
