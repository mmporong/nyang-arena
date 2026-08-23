/**
 * 밸런스 스윕 — 튜너블 조합을 전수 시뮬레이션해 목표 분포에 가장 가까운 조합을 찾는다.
 *
 * 목표: 중앙값 10~14웨이브, 그리고 p10~p90 폭이 6 이상.
 * 폭이 좁으면 매 판 결과가 같아서 "한 판 더" 동기가 생기지 않는다.
 * 실제로 첫 튜닝은 중앙값 6에 분포 5~7로, 사실상 결정적이었다.
 *
 * 실행: npm run sweep
 */
import { BALANCE } from "../src/game/balance.ts";
import { walkMap, leaveShop, shopStep, MAP_POLICIES } from "./bot-policy.mjs";
import { stepBattle } from "../src/game/battle.ts";
import { newRun, startBattle } from "../src/game/run.ts";

const RUNS = Number(process.env.RUNS ?? 120);
const MAX_WAVE = 80;
/**
 * 지도는 아무 길이나 간다. 이 스크립트가 재는 축은 밸런스 상수지 경로가 아니다.
 *
 * **이 선언이 빠져 있어서 스윕이 통째로 죽어 있었다** — `decisions`를 죽였던
 * 것과 똑같은 버그를 같은 날 두 곳에 심었고, 스윕은 verify 사슬에 없어서
 * 몇 주 동안 아무도 몰랐다. 관문 밖의 도구는 썩는다.
 */
const mapPick = MAP_POLICIES["무작위"];

/**
 * 조합마다 **같은 시드 범위**를 쓴다.
 *
 * 예전에는 `newRun()`을 인자 없이 불러서 조합마다 다른 판을 돌렸다. 그러면
 * 조합 A와 B의 차이가 상수 때문인지 시드 운 때문인지 갈리지 않는다 — 같은
 * 시드로 짝지어 비교하라고 다른 스크립트에는 다 적어 놓고 여기만 빠졌다.
 */
function playOne(seed) {
  const s = newRun(seed);
  const shop = { rerolls: 0, lastWave: 0 };
  for (let guard = 0; guard < MAX_WAVE * 500; guard++) {
    if (s.phase === "gameover") return s.wave;
    if (s.phase === "reward") {
      // 구매·재추첨은 bot-policy의 `shopStep` 한 곳만 쓴다(무료 재추첨 포함). 사본은 늘 다르게
      // 재는 쪽으로 갈라진다 — 여기 사본도 무료 재추첨이 없었다.
      if (shopStep(s, shop) !== "leave") continue;
      leaveShop(s);
      continue;
    }
    if (s.phase === "map") {
      walkMap(s, mapPick);
      continue;
    }
    if (s.phase === "prepare") {
      if (s.wave > MAX_WAVE) return s.wave;
      startBattle(s);
      if (s.phase !== "battle") return s.wave;
      continue;
    }
    stepBattle(s, 100);
  }
  return s.wave;
}

function measure() {
  const rs = [];
  for (let i = 0; i < RUNS; i++) rs.push(playOne(i + 1));
  rs.sort((a, b) => a - b);
  const q = (p) => rs[Math.min(rs.length - 1, Math.floor(rs.length * p))];
  return { p10: q(0.1), med: q(0.5), p90: q(0.9), spread: q(0.9) - q(0.1) };
}

const grid = [];
for (const enemyScale of [1.24, 1.27, 1.3, 1.33]) {
  for (const veterancy of [1.1, 1.12, 1.14]) {
    for (const enemyCountDivisor of [1.35, 1.45]) {
      grid.push({ enemyScale, veterancy, enemyCountDivisor });
    }
  }
}

const rows = [];
for (const combo of grid) {
  Object.assign(BALANCE, combo);
  const m = measure();
  // 중앙값 12에 가깝고 분포가 넓을수록 좋다.
  const score = Math.abs(m.med - 13) * 2 - m.spread;
  rows.push({ ...combo, ...m, score });
}

rows.sort((a, b) => a.score - b.score);
console.log("적배수  베테랑  적수제수 |  p10  중앙  p90  폭   점수");
for (const r of rows.slice(0, 12)) {
  console.log(
    `${r.enemyScale.toFixed(2)}   ${r.veterancy.toFixed(2)}    ${r.enemyCountDivisor.toFixed(2)}     | ` +
      `${String(r.p10).padStart(4)} ${String(r.med).padStart(4)} ${String(r.p90).padStart(4)} ` +
      `${String(r.spread).padStart(3)}  ${r.score.toFixed(1)}`,
  );
}
const best = rows[0];
console.log(`\n추천: enemyScale=${best.enemyScale} veterancy=${best.veterancy} enemyCountDivisor=${best.enemyCountDivisor}`);
console.log(`      중앙값 ${best.med}웨이브, 분포 ${best.p10}~${best.p90}`);
