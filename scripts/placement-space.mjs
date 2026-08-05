/**
 * 배치가 결정인가?
 *
 * 구매와 마찬가지로, 좋은 배치와 나쁜 배치의 도달 웨이브가 비슷하다면
 * 배치는 결정이 아니라 장식이다. 같은 시드·같은 구매 정책 위에서 배치만
 * 바꿔 분포를 비교한다.
 *
 * `decision-space.mjs`가 구매 축을 재고, 이 스크립트가 배치 축을 잰다.
 * 둘 다 `npm run sim`과 같은 게임 코드를 임포트하므로 시뮬과 게임이 갈라지지 않는다.
 *
 * 실행: npm run placement
 */
import { stepBattle } from "../src/game/battle.ts";
import { buyOffer, moveCat, newRun, startBattle , relicActive } from "../src/game/run.ts";
import { BOARD_COLS , livingCats } from "../src/game/types.ts";

const RUNS = Number(process.argv[2] ?? 300);
const MAX_WAVE = 60;

/** 살아 있는 아군을 보드 순서대로. */
function livingUnits(state) {
  const out = [];
  state.ally.forEach((c) => {
    if (c && c.alive) out.push(c);
  });
  return out;
}

/**
 * 고양이 목록을 원하는 셀로 옮긴다.
 *
 * 이전 구현은 `occupied()`가 준 보드 순서와 원하는 셀 목록의 순서가 어긋나서
 * "역할 반대" 배치가 실제로는 역할을 뒤집지 않았다. 그래서 배치 격차가
 * 2.3으로 과소 측정됐다. 고양이와 목적지를 같은 인덱스로 짝지어야 한다.
 */
function put(state, cats, wanted) {
  cats.forEach((cat, i) => {
    const to = wanted[i];
    if (to === undefined) return;
    const from = state.ally.indexOf(cat);
    if (from >= 0 && from !== to) moveCat(state, from, to);
  });
}

const CENTER_OUT = [2, 1, 3, 0, 4];
/** 열 0이 우리 뒷줄, 열 4가 적과 맞닿는 앞줄이다. */
const cellsIn = (col) => CENTER_OUT.map((r) => r * BOARD_COLS + col);

const ARRANGERS = {
  "그대로 (bestFreeCell)": null,

  "한 칸에 몰기": (state) => {
    const cells = [4, 3, 2, 1, 0].flatMap(cellsIn);
    put(state, livingUnits(state), cells);
  },

  "역할 반대 (근접 뒤)": (state) => {
    const u = livingUnits(state);
    const melee = u.filter((c) => c.breed.kind === "melee");
    const ranged = u.filter((c) => c.breed.kind === "ranged");
    const front = cellsIn(BOARD_COLS - 1);
    const back = cellsIn(0);
    // 원거리를 앞줄에, 근접을 뒷줄에 — 정확히 반대로 세운다.
    put(state, [...ranged, ...melee], [
      ...ranged.map((_, i) => front[i % front.length]),
      ...melee.map((_, i) => back[i % back.length]),
    ]);
  },

  "세로로 분산": (state) => {
    const u = livingUnits(state);
    const melee = u.filter((c) => c.breed.kind === "melee");
    const ranged = u.filter((c) => c.breed.kind === "ranged");
    const front = cellsIn(BOARD_COLS - 1);
    const back = [...cellsIn(0), ...cellsIn(1)];
    put(state, [...melee, ...ranged], [
      ...melee.map((_, i) => front[i % front.length]),
      ...ranged.map((_, i) => back[i % back.length]),
    ]);
  },
};

function play(arrange, seed) {
  const s = newRun(seed);
  for (let g = 0; g < MAX_WAVE * 400; g++) {
    if (s.phase === "gameover") return s.wave;
    if (s.phase === "reward") {
      const afford = s.offers
        .filter((o) => o && o.cost <= s.gold)
        // 유물은 조건을 채우고 있을 때만. 카드를 읽는 최소한의 플레이어.
        .filter((o) => o.kind !== "relic" || (o.relic ? relicActive(o.relic, livingCats(s.ally)) : false))
        .sort((a, b) => (a.kind === "replace" ? 1 : 0) - (b.kind === "replace" ? 1 : 0) || b.cost - a.cost);
      if (afford[0]) {
        if (!buyOffer(s, afford[0])) s.offers = s.offers.map((o) => (o === afford[0] ? null : o));
        continue;
      }
      s.phase = "prepare";
      continue;
    }
    if (s.phase === "prepare") {
      if (s.wave > MAX_WAVE) return s.wave;
      if (arrange) arrange(s);
      startBattle(s);
      if (s.phase !== "battle") return s.wave;
      continue;
    }
    stepBattle(s, 100);
  }
  return s.wave;
}

const pct = (a, p) => a[Math.min(a.length - 1, Math.floor(a.length * p))];

console.log(`런 ${RUNS}회 · 구매 정책 고정(가장 비싼 것) · 배치만 변경 · 시드 1~${RUNS}\n`);
console.log("배치                    최소   p10   p25  중앙값   p75   p90   최대   평균");
const means = {};
for (const [name, arrange] of Object.entries(ARRANGERS)) {
  const out = [];
  for (let i = 0; i < RUNS; i++) out.push(play(arrange, i + 1));
  out.sort((a, b) => a - b);
  const avg = out.reduce((x, y) => x + y, 0) / out.length;
  means[name] = avg;
  console.log(
    `${name.padEnd(22)} ${String(out[0]).padStart(4)} ${String(pct(out, 0.1)).padStart(5)} ` +
      `${String(pct(out, 0.25)).padStart(5)} ${String(pct(out, 0.5)).padStart(6)} ` +
      `${String(pct(out, 0.75)).padStart(5)} ${String(pct(out, 0.9)).padStart(5)} ` +
      `${String(out[out.length - 1]).padStart(5)} ${avg.toFixed(1).padStart(7)}`,
  );
}

const vals = Object.values(means);
const spread = Math.max(...vals) - Math.min(...vals);
console.log(`\n최선과 최악의 평균 격차: ${spread.toFixed(1)}웨이브`);
console.log(
  spread < 1.0
    ? "판정: 배치는 결정이 아니다 — 어떻게 놓든 같은 곳에 도착한다"
    : spread < 2.5
      ? "판정: 배치가 조금 영향을 준다"
      : "판정: 배치가 결정이다",
);
