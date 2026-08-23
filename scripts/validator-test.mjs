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

/**
 * 예고 판정과 그림의 기하 계약.
 *
 * 렌더는 부채꼴을 `ctx.arc(0,0,reach,-arg,arg)` — 즉 **반지름 reach의 원호**로
 * 그린다. 판정이 `along`(방향 성분)으로 사거리를 자르면 가장자리에서 그림 밖
 * 1/cos(arg)까지 맞는 구역이 생긴다. 실제로 그랬고 고쳤다 — 이 검사는 그
 * 회귀를 막는다. 렌더 함수를 직접 부르는 대신 원호 규칙의 경계 성질을 박는다.
 */
{
  const { inTelegraph } = await import("../src/game/battle.ts");
  const failures = [];
  const cone = { shape: "cone", mode: "avoid", fx: 0, fy: 0, dirX: 1, dirY: 0, arg: 0.35, reach: 2.4, fuse: 1, fuseMax: 1 };
  // 축 위 reach 지점: 그림의 원호 위 → 맞아야 한다
  if (!inTelegraph(cone, 2.4, 0)) failures.push("부채꼴: 축 위 reach 지점이 안 맞는다");
  // 가장자리 각도에서 원호 살짝 밖(옛 along 판정이면 맞던 자리) → 안 맞아야 한다
  const edge = 0.349;
  const d = 2.4 * 1.04; // 원호 4% 밖, 옛 판정의 reach/cos(0.35)=2.556 안
  if (inTelegraph(cone, Math.cos(edge) * d, Math.sin(edge) * d))
    failures.push("부채꼴: 원호 밖(그림 밖)인데 판정이 맞다고 한다 — along 사거리 회귀");
  // 원호 안 + 각 안 → 맞아야 한다
  if (!inTelegraph(cone, Math.cos(0.2) * 2.0, Math.sin(0.2) * 2.0)) failures.push("부채꼴: 안쪽 점이 안 맞는다");
  // pad: 몸 반경만큼 넓어진다 — 경계 밖 0.2가 pad 0.28로는 맞아야 한다
  const circle = { ...cone, shape: "circle", arg: 1.0 };
  if (inTelegraph(circle, 1.2, 0)) failures.push("원: pad 없이 경계 밖이 맞는다");
  if (!inTelegraph(circle, 1.2, 0, 0.28)) failures.push("원: pad를 줘도 몸이 걸친 자리가 안 맞는다");

  console.log("\n예고 기하 계약 (판정 = 그림)");
  if (failures.length === 0) {
    console.log("  OK   부채꼴 사거리가 원호 기준(그림과 동일), pad가 몸 반경만큼 판정을 넓힌다");
  } else {
    for (const f of failures) console.log(`  실패 ${f}`);
    process.exit(1);
  }
}

/**
 * 재진입 고리 계약 — 판 종류별 기록·시드·도전 배수.
 *
 * 죽은 화면의 세 갈래(같은 시드·오늘의 시드·도전 +1)는 기록을 **종류별로** 따로
 * 남겨야 하고, 하네스가 쓰는 `newRun(seed)`는 0단계라 어떤 수치도 바꾸면 안 된다.
 * 노드에는 localStorage가 없다 — 없어도 게임이 돌아야 한다는 것이 첫 단언이고,
 * 그다음은 가짜 저장소를 끼워 기록 규칙을 박는다.
 */
{
  const run = await import("../src/game/run.ts");
  const { BALANCE } = await import("../src/game/balance.ts");
  const { openLanes } = await import("../src/game/map.ts");
  const failures = [];

  // 1) 저장소 없이: 기본 판은 free·0단계·기록 0
  const bare = run.newRun(7);
  if (bare.kind !== "free" || bare.challenge !== 0 || bare.dailyKey !== null || bare.modeBest !== 0 || bare.best !== 0)
    failures.push("저장소 없이 newRun(seed)의 기본값(free·0단계·기록 0)이 다르다");

  // 가짜 localStorage — 이 블록 안에서만 산다
  const mem = new Map();
  globalThis.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => void mem.set(k, String(v)),
    removeItem: (k) => void mem.delete(k),
    clear: () => mem.clear(),
  };
  try {
    // 2) 오늘의 시드: 같은 날 같은 값, 다른 날 다른 값, 키 형식
    if (run.dailySeed("2026-08-23") !== run.dailySeed("2026-08-23")) failures.push("dailySeed가 결정적이지 않다");
    if (run.dailySeed("2026-08-23") === run.dailySeed("2026-08-24")) failures.push("dailySeed가 날짜를 가르지 못한다");
    if (run.dailyKeyToday(new Date(2026, 7, 23)) !== "2026-08-23") failures.push("dailyKeyToday 형식이 YYYY-MM-DD가 아니다");

    // 3) 도전 배수: 같은 시드·같은 길에서 적 체력 합이 (1 + step×단계)배, 적 구성은 그대로
    const a = run.newRun(11);
    const b = run.newRun(11, { kind: "challenge", challenge: 2 });
    const lane = openLanes(a.map, 0)[0];
    run.chooseNode(a, lane);
    run.chooseNode(b, lane);
    const ids = (s) => s.enemy.filter(Boolean).map((c) => c.breed.id).join(",");
    const hp = (s) => s.enemy.filter(Boolean).reduce((t, c) => t + c.maxHp, 0);
    if (ids(a) !== ids(b)) failures.push("도전 단계가 적 구성(시드 결과)을 바꾼다");
    const want = 1 + BALANCE.challengeStep * 2;
    const got = hp(b) / hp(a);
    if (Math.abs(got - want) > 0.03) failures.push(`도전 2단계 적 체력 배수 ${got.toFixed(3)} (기대 ${want.toFixed(2)})`);

    // 4) 기록: 도전은 전체 최고를 안 건드리고 단계별로, 오늘의 시드는 그날+전체, 기본은 전체
    const c = run.newRun(3, { kind: "challenge", challenge: 1 });
    c.wave = 9;
    run.finishWave(c, false);
    if (run.loadBest() !== 0) failures.push("도전 판이 전체 최고 기록을 건드렸다");
    if (run.loadChallengeBest(1) !== 9 || c.modeBest !== 9 || !c.recordBroken) failures.push("도전 1단계 기록이 9로 남지 않았다");
    const d = run.newRun(3, { kind: "daily", dailyKey: "2026-08-23" });
    d.wave = 6;
    run.finishWave(d, false);
    if (run.loadBest() !== 6 || run.loadDailyBest("2026-08-23") !== 6) failures.push("오늘의 시드 판이 그날 기록과 전체 최고를 둘 다 남기지 않았다");
    const e = run.newRun(3);
    e.wave = 4;
    run.finishWave(e, false);
    if (run.loadBest() !== 6 || e.recordBroken || e.modeBest !== 6) failures.push("기본 판이 더 낮은 웨이브로 기록을 덮거나 갱신으로 표시했다");
    const codex = run.loadCodex();
    if (codex.breeds.length < 3) failures.push("도감이 쌓이지 않았다");

    // 5) 다음 판 갈래: 종류와 시드가 약속대로
    const r1 = run.nextRunFrom(c, "retry");
    if (r1.kind !== "challenge" || r1.challenge !== 1 || r1.seed !== 3) failures.push("도전 판 같은 시드가 종류·단계·시드를 잃었다");
    const r2 = run.nextRunFrom(d, "retry");
    if (r2.kind !== "daily" || r2.dailyKey !== "2026-08-23" || r2.seed !== 3) failures.push("오늘의 시드 판 같은 시드가 종류를 잃었다");
    const r3 = run.nextRunFrom(e, "retry");
    if (r3.kind !== "retry" || r3.seed !== 3) failures.push("기본 판 같은 시드가 retry/같은 시드가 아니다");
    const r4 = run.nextRunFrom(e, "challenge");
    if (r4.kind !== "challenge" || r4.challenge !== 1) failures.push("도전 +1이 1단계를 만들지 않았다");
    const r5 = run.nextRunFrom(c, "challenge");
    if (r5.challenge !== 2) failures.push("도전 1에서 도전 +1이 2단계가 아니다");
    const r6 = run.nextRunFrom(e, "daily");
    if (r6.kind !== "daily" || r6.seed !== run.dailySeed(run.dailyKeyToday())) failures.push("오늘의 시드가 오늘 날짜의 시드가 아니다");
    const r7 = run.nextRunFrom(c, "again");
    if (r7.kind !== "challenge" || r7.challenge !== 1 || r7.seed === 3) failures.push("도전 판 다시 도전이 같은 단계·새 시드가 아니다");
  } finally {
    delete globalThis.localStorage;
  }

  console.log("\n재진입 고리 계약 (기록은 종류별로, 0단계는 하네스와 같다)");
  if (failures.length === 0) {
    console.log(`  OK   도전 배수 ${(1 + BALANCE.challengeStep * 2).toFixed(2)}배 · 오늘의 시드 결정적 · 기록이 종류별로 갈린다 · 같은 시드가 종류를 지킨다`);
  } else {
    for (const f of failures) console.log(`  실패 ${f}`);
    process.exit(1);
  }
}


/**
 * 인접 보너스 계약 — `sameClassNeighbors`는 상하좌우만 세고, 같은 직업·살아 있는 우리 편만 센다.
 * 대각선을 세거나 판 밖으로 새면 배치 축 수치(깊이 1.8)가 다른 규칙을 잰 것이 된다.
 */
{
  const run = await import("../src/game/run.ts");
  const { BREEDS } = await import("../src/game/breeds.ts");
  const { BOARD_COLS } = await import("../src/game/types.ts");
  const failures = [];
  const s = run.newRun(5);
  s.ally.fill(null);
  const warrior = BREEDS.find((b) => b.cls === "warrior");
  const warrior2 = BREEDS.find((b) => b.cls === "warrior" && b !== warrior);
  const mage = BREEDS.find((b) => b.cls === "mage");
  const c = (row, col) => row * BOARD_COLS + col;
  s.ally[c(2, 2)] = run.makeCat(warrior, "ally", c(2, 2));
  s.ally[c(2, 3)] = run.makeCat(warrior2, "ally", c(2, 3)); // 오른쪽 — 같은 직업
  s.ally[c(1, 2)] = run.makeCat(mage, "ally", c(1, 2)); // 위 — 다른 직업
  s.ally[c(1, 1)] = run.makeCat(warrior, "ally", c(1, 1)); // 대각선 — 안 센다
  s.ally[c(3, 2)] = run.makeCat(warrior2, "ally", c(3, 2)); // 아래 — 같은 직업
  s.ally[c(3, 2)].alive = false; // 죽은 건 안 센다
  const n = run.sameClassNeighbors(s.ally, s.ally[c(2, 2)]);
  if (n !== 1) failures.push(`가운데 전사의 이웃이 1이어야 하는데 ${n} (오른쪽만 세야 한다)`);
  const edge = run.sameClassNeighbors(s.ally, s.ally[c(2, 3)]);
  if (edge !== 1) failures.push(`오른쪽 전사의 이웃이 1이어야 하는데 ${edge}`);
  const corner = run.newRun(6);
  corner.ally.fill(null);
  corner.ally[c(0, 0)] = run.makeCat(warrior, "ally", c(0, 0));
  corner.ally[c(4, 4)] = run.makeCat(warrior2, "ally", c(4, 4));
  if (run.sameClassNeighbors(corner.ally, corner.ally[c(0, 0)]) !== 0) failures.push("구석 칸이 판 밖이나 반대편 줄을 이웃으로 셌다");
  console.log("\n인접 보너스 계약 (상하좌우 · 같은 직업 · 살아 있는 것만)");
  if (failures.length === 0) {
    console.log("  OK   가운데 전사 이웃 1(오른쪽) · 대각선·다른 직업·죽은 것 제외 · 구석은 0");
  } else {
    for (const f of failures) console.log(`  실패 ${f}`);
    process.exit(1);
  }
}

/**
 * 지도 열쇠/봉쇄 실험 계약 — `BALANCE.mapKeys`.
 *
 * 꺼져 있으면 열쇠·금고가 안 나오고, 켜면 나오되 지도 계약(도달성·보스·전투 없는 걸음 없음)은
 * 그대로여야 한다. 금고는 별사탕이 있어야 유물을 열고(별사탕 감소), 없으면 헛걸음(생선만).
 */
{
  const { BALANCE } = await import("../src/game/balance.ts");
  const map = await import("../src/game/map.ts");
  const run = await import("../src/game/run.ts");
  const failures = [];
  const before = BALANCE.mapKeys;

  BALANCE.mapKeys = false;
  for (const seed of [1, 2, 3, 4, 5]) {
    const m = map.makeStage(1, seed);
    if (m.steps.flat().some((n) => n.kind === "key" || n.kind === "vault")) failures.push(`실험이 꺼졌는데 시드 ${seed}에 열쇠/금고가 있다`);
  }

  BALANCE.mapKeys = true;
  try {
    let anyKey = false;
    let anyVault = false;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]) {
      const m = map.makeStage(1, seed);
      const flat = m.steps.flat();
      if (flat.some((n) => n.kind === "key")) anyKey = true;
      if (flat.some((n) => n.kind === "vault")) anyVault = true;
      const problems = map.checkStage(m);
      if (problems.length) failures.push(`시드 ${seed} checkStage: ${problems.join(" / ")}`);
    }
    if (!anyKey) failures.push("실험을 켰는데 시드 1~15 어디에도 열쇠가 없다");
    if (!anyVault) failures.push("실험을 켰는데 시드 1~15 어디에도 금고가 없다");

    // 금고 계약: 별사탕 있으면 유물+별사탕 감소, 없으면 헛걸음(생선만).
    const withKey = run.newRun(3);
    withKey.keys = 2;
    withKey.gold = 20;
    const relBefore = withKey.relics.length;
    let hit = false;
    for (let step = 0; step < map.STAGE_STEPS && !hit; step++) {
      const row = withKey.map.steps[step] ?? [];
      const open = map.openLanes(withKey.map, step);
      const idx = open.find((i) => row[i]?.kind === "vault");
      if (idx !== undefined) {
        run.chooseNode(withKey, idx);
        hit = true;
        if (withKey.relics.length !== relBefore + 1) failures.push("금고(별사탕 있음)에서 유물이 안 늘었다");
        if (withKey.keys !== 1) failures.push("금고를 열었는데 별사탕이 안 줄었다");
      } else if (open.length) {
        run.chooseNode(withKey, open[0]);
        if (withKey.phase === "reward") run.leaveShop(withKey);
        if (withKey.phase === "prepare") run.startBattle(withKey);
        break;
      }
    }
    const noKey = run.newRun(6);
    noKey.keys = 0;
    const goldBefore = noKey.gold;
    let hit2 = false;
    for (let step = 0; step < map.STAGE_STEPS && !hit2; step++) {
      const row = noKey.map.steps[step] ?? [];
      const open = map.openLanes(noKey.map, step);
      const idx = open.find((i) => row[i]?.kind === "vault");
      if (idx !== undefined) {
        const rb = noKey.relics.length;
        run.chooseNode(noKey, idx);
        if (noKey.relics.length !== rb) failures.push("금고(별사탕 없음)에서 유물이 나왔다 — 헛걸음이어야 한다");
        if (noKey.gold <= goldBefore) failures.push("금고 헛걸음인데 위로금이 없다");
        hit2 = true;
      } else if (open.length) {
        run.chooseNode(noKey, open[0]);
        if (noKey.phase === "reward") run.leaveShop(noKey);
        if (noKey.phase === "prepare") run.startBattle(noKey);
        break;
      }
    }
  } finally {
    BALANCE.mapKeys = before;
  }

  console.log("\n지도 열쇠/봉쇄 실험 계약 (꺼지면 없음 · 켜지면 등장·계약 유지 · 별사탕 있어야 금고가 열린다)");
  if (failures.length === 0) {
    console.log("  OK   꺼짐: 열쇠/금고 없음 / 켜짐: 둘 다 등장·checkStage 통과 / 별사탕 있으면 유물+별사탕 감소, 없으면 헛걸음");
  } else {
    for (const f of failures) console.log(`  실패 ${f}`);
    process.exit(1);
  }
}
