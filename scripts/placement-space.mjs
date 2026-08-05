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
import { buyOffer, moveCat, newRun, startBattle } from "../src/game/run.ts";
import { BOARD_COLS, BOARD_ROWS } from "../src/game/types.ts";

const RUNS = Number(process.argv[2] ?? 300);
const MAX_WAVE = 60;

/** 살아 있는 아군을 (셀, 고양이) 쌍으로. 보드 인덱스 순서라 결정적이다. */
function occupied(board) {
  const out = [];
  board.forEach((c, i) => {
    if (c && c.alive) out.push([i, c]);
  });
  return out;
}

/** 원하는 셀 목록으로 순서대로 옮긴다. 이미 그 자리면 건너뛴다. */
function placeInto(state, wanted) {
  const units = occupied(state.ally);
  for (let i = 0; i < units.length; i++) {
    const target = wanted[i];
    if (target === undefined) break;
    const from = state.ally.findIndex((c) => c === units[i][1]);
    if (from >= 0 && from !== target) moveCat(state, from, target);
  }
}

const CENTER_OUT = [2, 1, 3, 0, 4];

const ARRANGERS = {
  "그대로 (bestFreeCell)": null,

  "한 칸에 몰기": (state) => {
    // 앞줄 가운데부터 뭉친다. 광역기에 통째로 맞는 최악의 형태.
    const cells = [];
    for (const col of [4, 3, 2, 1, 0]) for (const r of CENTER_OUT) cells.push(r * BOARD_COLS + col);
    placeInto(state, cells);
  },

  "역할 반대 (근접 뒤)": (state) => {
    const units = occupied(state.ally);
    const melee = units.filter(([, c]) => c.breed.kind === "melee");
    const ranged = units.filter(([, c]) => c.breed.kind === "ranged");
    // 원거리를 앞줄(열 4)에, 근접을 뒷줄(열 0)에 — 정확히 반대로 세운다.
    const front = CENTER_OUT.map((r) => r * BOARD_COLS + (BOARD_COLS - 1));
    const back = CENTER_OUT.map((r) => r * BOARD_COLS + 0);
    const wanted = [];
    ranged.forEach((_, i) => front[i] !== undefined && wanted.push(front[i]));
    melee.forEach((_, i) => back[i] !== undefined && wanted.push(back[i]));
    placeInto(state, [...ranged, ...melee].map((_, i) => wanted[i]).filter((v) => v !== undefined));
  },

  "세로로 분산": (state) => {
    const units = occupied(state.ally);
    const melee = units.filter(([, c]) => c.breed.kind === "melee").map(([, c]) => c);
    const ranged = units.filter(([, c]) => c.breed.kind === "ranged").map(([, c]) => c);
    // 근접은 앞줄(열 4)에 행을 벌려 세우고, 원거리는 뒷줄(열 0~1)에 벌려 세운다.
    const wanted = [];
    const meleeCells = CENTER_OUT.map((r) => r * BOARD_COLS + (BOARD_COLS - 1));
    const rangedCells = [...CENTER_OUT.map((r) => r * BOARD_COLS + 0), ...CENTER_OUT.map((r) => r * BOARD_COLS + 1)];
    const order = [...melee, ...ranged];
    melee.forEach((_, i) => wanted.push(meleeCells[i % meleeCells.length]));
    ranged.forEach((_, i) => wanted.push(rangedCells[i % rangedCells.length]));
    // placeInto는 보드 순서를 쓰므로 역할별 순서를 직접 맞춰 준다
    for (let i = 0; i < order.length; i++) {
      const from = state.ally.findIndex((c) => c === order[i]);
      const to = wanted[i];
      if (from >= 0 && to !== undefined && from !== to) moveCat(state, from, to);
    }
  },
};

function play(arrange, seed) {
  const s = newRun(seed);
  for (let g = 0; g < MAX_WAVE * 400; g++) {
    if (s.phase === "gameover") return s.wave;
    if (s.phase === "reward") {
      const afford = s.offers
        .filter((o) => o && o.cost <= s.gold)
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
