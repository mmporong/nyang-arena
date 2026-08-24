/**
 * 밸런스 하네스 — 게임 로직을 브라우저 없이 그대로 돌려 도달 웨이브 분포를 잰다.
 *
 * 눈대중으로 난이도를 맞추면 반드시 틀린다. 실제로 첫 빌드는 웨이브 2에서
 * 전멸했는데, 화면만 봐서는 "적이 좀 센가?" 정도로만 보였다.
 *
 * 정책(policy)은 초보 플레이어를 흉내낸다: 살 수 있으면 첫 카드를 사고,
 * 배치는 건드리지 않는다. 즉 여기서 나온 수치는 '하한'이다.
 *
 * 실행: npm run sim
 */
import { makeBossBot, walkMap, leaveShop, shopStep, MAP_POLICIES } from "./bot-policy.mjs";
import { stepBattle } from "../src/game/battle.ts";
import { newRun, startBattle, currentKind } from "../src/game/run.ts";

const RUNS = Number(process.argv[2] ?? 300);
/**
 * 시드 오프셋. 잡음 바닥을 재려고 넣었다 — 결정 축 셋과 같은 이유다.
 * 특히 아래 궁합(팀 성격 x 웨이브 성격)은 표본 150 미만 칸을 통째로
 * 버리므로, 어느 칸이 문턱을 넘느냐에 따라 값이 크게 튄다.
 */
const SEED0 = Number(process.argv[3] ?? 0);
// 지도는 아무 길이나 간다. 이 스크립트가 재는 축이 아니므로 고정하지 않는다.
const mapPick = MAP_POLICIES["무작위"];
const MAX_WAVE = 60;
const DT = 100;

/** 웨이브 성격별 시도/패배와 전투 길이. 보스 통과율이 개입 강도의 판정 기준이다. */
const tried = new Map();
const lost = new Map();

/**
 * 자연 런 생태 표 — 구매·생존 결과로 그때 생긴 팀의 성격을 사후 분류한다.
 *
 * 셀 수와 도달 깊이가 다르므로 궁합 판정에 쓰지 않는다. 실제 게임에서 어떤 팀이
 * 얼마나 자주 어떤 웨이브를 만났는지 보는 외적 타당성 보조표다. 궁합 자체는
 * `matchup-space.mjs`의 고정 81장면 census가 관찰한다.
 */
const matchup = new Map(); // "팀|웨이브" → { tried, lost }
function teamShape(state) {
  const cats = state.ally.filter(Boolean);
  if (cats.length === 0) return "빈팀";
  let melee = 0;
  for (const c of cats) if (c.breed.kind === "melee") melee += 1;
  const r = melee / cats.length;
  return r >= 0.67 ? "근접 위주" : r <= 0.33 ? "원거리 위주" : "균형";
}
function tally(key, field) {
  const cur = matchup.get(key) ?? { tried: 0, lost: 0 };
  cur[field] += 1;
  matchup.set(key, cur);
}
const battleMs = [];
const battleMsByKind = new Map();
// 보스는 웨이브별로 따로 센다. 첫 보스(5)는 기믹을 가르치는 자리라 성격이 다르다.
const bossTried = new Map();
const bossLost = new Map();

/**
 * @param seed 런마다 고정 시드를 준다. 없으면 같은 명령이 매번 다른 수치를 내고,
 *   그러면 밸런스 변경이 좋아진 것인지 노이즈인지 구분할 수 없다.
 */
function playOne(seed) {
  const s = newRun(seed);
  const shop = { rerolls: 0, lastWave: 0 };
  let kindAtStart = null;
  let shapeAtStart = null;
  let waveAtStart = 0;
  let elapsedBeforeTick = 0;
  const respond = makeBossBot();

  for (let guard = 0; guard < MAX_WAVE * 400; guard++) {
    if (s.phase === "gameover") {
      if (kindAtStart) lost.set(kindAtStart, (lost.get(kindAtStart) ?? 0) + 1);
      if (kindAtStart && shapeAtStart) tally(`${shapeAtStart}|${kindAtStart}`, "lost");
      if (kindAtStart === "boss") bossLost.set(waveAtStart, (bossLost.get(waveAtStart) ?? 0) + 1);
      return s.wave;
    }

    if (s.phase === "reward") {
      // 구매 정책은 bot-policy의 shopStep 한 곳에만 있다. 여기와 metrics-gen이
      // 각자 갖고 있었더니 재추첨 예산 리셋 시점이 갈려 같은 코드에서 p25가
      // 8과 9로 달라졌다.
      const act = shopStep(s, shop);
      if (act !== "leave") continue;
      leaveShop(s);
      continue;
    }

    if (s.phase === "map") {
      walkMap(s, mapPick);
      continue;
    }

    if (s.phase === "prepare") {
      if (s.wave > MAX_WAVE) return s.wave;
      kindAtStart = currentKind(s);
      tried.set(kindAtStart, (tried.get(kindAtStart) ?? 0) + 1);
      shapeAtStart = teamShape(s);
      tally(`${shapeAtStart}|${kindAtStart}`, "tried");
      if (kindAtStart === "boss") {
        waveAtStart = s.wave;
        bossTried.set(s.wave, (bossTried.get(s.wave) ?? 0) + 1);
      }
      startBattle(s);
      if (s.phase !== "battle") return s.wave; // 배치 불가 등
      continue;
    }

    // 보스 대응은 모든 측정축이 공유하는 bot-policy 한 곳만 쓴다. 방어 우선순위,
    // 반응 지연, 취약 창 기회 보존을 이 파일에 복제하면 6축이 서로 다른 게임을 잰다.
    respond(s);

    // 전투가 끝나는 틱에는 battleElapsed가 리셋될 수 있으므로 직전 값을 들고 있는다.
    elapsedBeforeTick = s.battleElapsed;
    stepBattle(s, DT);
    if (s.phase !== "battle") {
      const ms = elapsedBeforeTick + DT;
      battleMs.push(ms);
      const list = battleMsByKind.get(kindAtStart) ?? [];
      list.push(ms);
      battleMsByKind.set(kindAtStart, list);
    }
  }
  return s.wave;
}

const results = [];
for (let i = 0; i < RUNS; i++) results.push(playOne(SEED0 + i + 1));
results.sort((a, b) => a - b);

const q = (p) => results[Math.min(results.length - 1, Math.floor(results.length * p))];
const mean = results.reduce((a, b) => a + b, 0) / results.length;

console.log(
  `런 ${RUNS}회 (정책: 살 수 있으면 가장 비싼 것 구매, 재배치 없음 · ` +
    `시드 ${SEED0 + 1}~${SEED0 + RUNS})`,
);
console.log(`  최소 ${results[0]}  p25 ${q(0.25)}  중앙값 ${q(0.5)}  p75 ${q(0.75)}  최대 ${results[results.length - 1]}`);
console.log(`  평균 ${mean.toFixed(1)}웨이브`);

const hist = new Map();
for (const r of results) hist.set(r, (hist.get(r) ?? 0) + 1);
const bars = [...hist.entries()].sort((a, b) => a[0] - b[0]);
for (const [wave, n] of bars) {
  console.log(`  ${String(wave).padStart(2)}웨이브 ${"█".repeat(Math.ceil((n / RUNS) * 60))} ${n}`);
}

console.log("\n웨이브 성격별 통과율");
for (const kind of ["mixed", "rush", "snipe", "boss"]) {
  const tn = tried.get(kind) ?? 0;
  const ln = lost.get(kind) ?? 0;
  if (tn === 0) continue;
  const pass = ((tn - ln) / tn) * 100;
  console.log(`  ${kind.padEnd(6)} 시도 ${String(tn).padStart(5)}  패배 ${String(ln).padStart(4)}  통과율 ${pass.toFixed(1).padStart(5)}%`);
}

battleMs.sort((a, b) => a - b);
const bq = (p) => (battleMs[Math.min(battleMs.length - 1, Math.floor(battleMs.length * p))] ?? 0) / 1000;
console.log("\n보스 웨이브별 통과율");
for (const w of [...bossTried.keys()].sort((a, b) => a - b).slice(0, 5)) {
  const tn = bossTried.get(w) ?? 0;
  const ln = bossLost.get(w) ?? 0;
  console.log(`  W${String(w).padStart(2)}  시도 ${String(tn).padStart(4)}  패배 ${String(ln).padStart(3)}  통과율 ${(((tn - ln) / tn) * 100).toFixed(1).padStart(5)}%`);
}

console.log("\n전투 길이 (초)");
for (const kind of ["mixed", "rush", "snipe", "boss"]) {
  const list = (battleMsByKind.get(kind) ?? []).slice().sort((a, b) => a - b);
  if (list.length === 0) continue;
  const k = (p) => (list[Math.min(list.length - 1, Math.floor(list.length * p))] / 1000).toFixed(1);
  console.log(`  ${kind.padEnd(6)} p50 ${String(k(0.5)).padStart(5)}  p90 ${String(k(0.9)).padStart(5)}  최대 ${(list[list.length - 1] / 1000).toFixed(1)}`);
}
console.log(`60웨이브 상한 도달: ${results.filter((r) => r > MAX_WAVE).length}건`);

// 저장소 절대 규칙: 중앙값 10~15웨이브. 너무 짧으면 좌절, 너무 길면 한 판이 지루하다.
const med = q(0.5);
if (med < 10) console.log("\n판정: 너무 어렵다 (중앙값 10 미만)");
else if (med > 15) console.log("\n판정: 너무 쉽다 (중앙값 15 초과)");
else console.log("\n판정: 목표 구간(10~15) 안");
// 구간 밖이면 실패로 끝낸다. 다른 축과 같은 이유다 — 관측만 하고 0을 돌려주면 measure-all이
// "관문 통과"를 찍는다. 2026-08-23 코드 분석이 이 축의 exit 코드가 없다는 것을 잡았다.
if (med < 10 || med > 15) process.exitCode = 1;


/* ------------------------------------------------------------------ */
/* 궁합 표                                                              */
/* ------------------------------------------------------------------ */

const SHAPES = ["근접 위주", "균형", "원거리 위주"];
const WK = ["mixed", "rush", "snipe", "boss"];
console.log("\n자연 런 생태(비게이트) — 사후 팀 성격 x 웨이브 통과율 (괄호는 서로 다른 표본 수)");
console.log("팀            " + WK.map((k) => k.padStart(11)).join(""));
for (const shape of SHAPES) {
  const cells = WK.map((k) => {
    const m = matchup.get(`${shape}|${k}`);
    if (!m || m.tried === 0) return "-".padStart(11);
    return `${(((m.tried - m.lost) / m.tried) * 100).toFixed(0)}%(${m.tried})`.padStart(11);
  });
  console.log(shape.padEnd(12) + cells.join(""));
}
console.log("판정 없음 — 구매·진행 깊이·불균형 셀 수가 섞인 생태 진단이며 궁합 근거로 쓰지 않는다");
