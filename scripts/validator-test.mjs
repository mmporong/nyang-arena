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
import { BREEDS, NIGHTMARE_BREEDS } from "../src/game/breeds.ts";
import { bossIndexAt, WAVE_STRIDE, UNIT_STRIDE, WARRIOR_IDS, MELEE_IDS, RANGED_IDS } from "../src/game/run.ts";
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
    const m = makeStage(stage, seed);
    for (const p of checkStage(m)) mapFailures.push(`시드 ${seed} 스테이지 ${stage}: ${p}`);
    m.steps.forEach((row, i) => {
      if (!isBossStep(i)) { laneTotal += row.length; laneSteps += 1; }
    });
  }
}

// 같은 시드는 같은 지도를 내야 한다. 이게 깨지면 "시드 하나로 판을 재현한다"가 거짓말이 된다.
seedRng(4242);
const mapA = JSON.stringify(makeStage(2, 4242));
seedRng(4242);
const mapB = JSON.stringify(makeStage(2, 4242));
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

/**
 * 악몽 명단이 우리 명단과 index별로 맞물려 있는가.
 *
 * `enemyBreedIds`가 `(wave*3 + i*5) % 길이`로 뽑으므로, i번째끼리 직업·스탯·스킬이
 * 같아야 웨이브 구성이 명단을 가르기 전과 동일하게 유지된다. 이 계약은 지금
 * 주석에만 적혀 있었는데, 주석은 새 품종을 끼워 넣는 사람을 못 막는다.
 *
 * `cost`와 `color`는 일부러 뺐다. 둘 다 아군 전용 경로(`rollOffers`,
 * `boardUnits`)에서만 읽히고 적 쪽에는 쓰이지 않는다 — 악몽은 cost 0이고
 * 삼색이 자리에는 삼색 스프라이트가 없어 주황이다.
 */
const MIRROR = ["cls", "kind", "hp", "atk", "atkInterval", "range", "moveSpeed", "manaPerAttack", "skill", "passive"];
const mirrorFailures = [];
/**
 * **보폭이 명단 길이와 서로소인가.**
 *
 * 적 구성은 `(wave*WAVE_STRIDE + i*UNIT_STRIDE) % 길이`로 정한다. 서로소가
 * 아니면 오프셋이 일부 값만 돌아 웨이브 종류가 줄어든다 — 8종에서 12종으로
 * 늘렸을 때 보폭 3이 `gcd(3,12)=3`이라 구성이 4웨이브마다 반복됐고, 명단을
 * 늘렸는데 다양성은 절반이 됐다. 눈으로는 안 보이는 종류의 퇴행이라
 * 계약으로 잡는다.
 */
const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
/**
 * **`enemyBreedIds`가 나머지 연산에 쓰는 모듈러스 전부**를 본다.
 *
 * 처음에는 전체 명단 길이 하나만 봤다. 그런데 돌격·저격 웨이브는 직업 풀을
 * 따로 쓰고(전사 3 · 근접 6 · 원거리 6), 거기서 `gcd(3,3)=3`·`gcd(3,6)=3`으로
 * 같은 결함이 살아 있었다 — **검사는 초록인데 돌격 웨이브 구성이 전 구간
 * 하나로 굳어 있었다.** 검사가 보는 것과 코드가 쓰는 것이 어긋나면, 통과는
 * 아무것도 보장하지 않는다.
 */
const MODULI = [
  ["명단 전체", NIGHTMARE_BREEDS.length],
  ["전사 풀(돌격)", WARRIOR_IDS.length],
  ["근접 풀(저격)", MELEE_IDS.length],
  ["원거리 풀(저격)", RANGED_IDS.length],
];
for (const [poolName, len] of MODULI) {
  if (len === 0) {
    mirrorFailures.push(`${poolName}이 비었다`);
    continue;
  }
  for (const [name, stride] of [
    ["WAVE_STRIDE", WAVE_STRIDE],
    ["UNIT_STRIDE", UNIT_STRIDE],
  ]) {
    const g = gcd(stride, len);
    if (g !== 1) {
      mirrorFailures.push(
        `${name}=${stride}이 ${poolName} 길이 ${len}과 서로소가 아니다 (gcd=${g}) — ` +
          `오프셋이 ${len / g}종류만 돈다`,
      );
    }
  }
}
if (WAVE_STRIDE === UNIT_STRIDE) {
  mirrorFailures.push(
    `보폭 둘이 같다(${WAVE_STRIDE}) — 자리 i의 적이 웨이브 w+i의 첫 적과 늘 같아진다`,
  );
}

/**
 * **짝은 앞에서부터 맞고, 남는 것은 정확히 소환사여야 한다.**
 *
 * 예전에는 길이가 같은지만 봤다. 지금은 소환사가 우리 쪽에만 있어서 길이가
 * 다르다 — 적에게 소환사를 주니 웨이브 성격이 지워졌기 때문이다(궁합
 * 8.3 → 4.1%p, `breeds.ts` 참고). 그 예외를 계약으로 못 박는다: 남는 것이
 * 소환사가 아니면 **아무도 모르게 짝 없는 고양이가 늘어난** 것이다.
 */
if (NIGHTMARE_BREEDS.length > BREEDS.length) {
  mirrorFailures.push(
    `악몽이 더 많다: 우리 ${BREEDS.length} vs 악몽 ${NIGHTMARE_BREEDS.length}`,
  );
}
const unpaired = BREEDS.slice(NIGHTMARE_BREEDS.length);
const strays = unpaired.filter((b) => b.cls !== "summoner");
if (strays.length > 0) {
  mirrorFailures.push(
    `짝 없는 고양이 중 소환사가 아닌 것: ${strays.map((b) => `${b.name}(${b.cls})`).join(", ")}`,
  );
}
if (unpaired.length !== BREEDS.filter((b) => b.cls === "summoner").length) {
  mirrorFailures.push("소환사가 짝 있는 구간에 섞여 있다 — 소환사는 명단 끝에 모여야 한다");
} else {
  // 짝이 있는 구간(악몽 명단 길이)만 돈다. 뒤의 소환사는 짝이 없다.
  NIGHTMARE_BREEDS.forEach((b, i) => {
    const a = BREEDS[i];
    const diff = MIRROR.filter((k) => a[k] !== b[k]);
    if (diff.length > 0) {
      mirrorFailures.push(`${i}번: ${a.name} vs ${b.name} — ${diff.map((k) => `${k}(${a[k]}\u2260${b[k]})`).join(", ")}`);
    }
  });
  const overlap = BREEDS.filter((a) => NIGHTMARE_BREEDS.some((b) => b.id === a.id));
  if (overlap.length > 0) mirrorFailures.push(`id가 겹친다: ${overlap.map((b) => b.id).join(",")}`);
}

console.log("\n적·아군 명단 계약");
if (mirrorFailures.length === 0) {
  console.log(
    `  OK   ${NIGHTMARE_BREEDS.length}쌍이 index별로 직업·스탯·스킬 일치, id 겹침 0`,
  );
  console.log(
    `  OK   ${NIGHTMARE_BREEDS.map((b, i) => `${BREEDS[i].name}\u2194${b.name}`).join(" ")}`,
  );
  console.log(
    `  OK   짝 없는 ${unpaired.length}마리는 전부 소환사 (${unpaired.map((b) => b.name).join(" ")}) — 악몽은 소환하지 않는다`,
  );
} else {
  for (const p of mirrorFailures) console.log(`  실패 ${p}`);
  process.exit(1);
}
