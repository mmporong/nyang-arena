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
import { buyOffer, moveCat, newRun, startBattle, bossBreedAt } from "../src/game/run.ts";
import { affordable, makeBossBot, walkMap, leaveShop, MAP_POLICIES } from "./bot-policy.mjs";
import { BOARD_COLS , livingCats } from "../src/game/types.ts";
import { BALANCE } from "../src/game/balance.ts";

/**
 * `--adjacency`: 배치 실험 2. 같은 직업이 붙으면 공격이 오른다(`BALANCE.adjacencyAtk`).
 * 플래그는 자리와 무관하고 숫자 인자(런 수·시드 오프셋)는 순서대로 읽는다. 켜면
 * 규칙을 이용하는 배치("같은 직업 붙이기")를 정책에 더해 같은 기준으로 잰다.
 */
const ARGS = process.argv.slice(2);
const ADJACENCY = ARGS.includes("--adjacency");
const NUMS = ARGS.filter((a) => !a.startsWith("--"));
if (ADJACENCY) BALANCE.adjacencyAtk = 0.08;
const RUNS = Number(NUMS[0] ?? 1200);
/**
 * 시드 오프셋. 잡음 바닥을 재려고 넣었다 — `relic-space.mjs`와 같은 이유다.
 * 유물 목록처럼 무관해 보이는 것을 건드려도 오퍼 생성이 난수를 다르게 먹어
 * 같은 시드가 다른 판이 된다. 겹치지 않는 블록으로 같은 코드를 두 번 돌려
 * 코드와 무관한 흔들림이 얼마인지부터 보고, 그보다 작은 차이는 안 믿는다.
 */
const SEED0 = Number(NUMS[1] ?? 0);
// 지도는 아무 길이나 간다. 이 스크립트가 재는 축이 아니므로 고정하지 않는다.
const mapPick = MAP_POLICIES["무작위"];
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

/** (행, 열) → 셀 번호. formation-space의 cell()과 같은 규칙이다. */
const c2 = (row, col) => row * BOARD_COLS + col;

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

  /**
   * 감싸기 — 원거리를 가운데 두고 근접이 둘러싼다.
   * `formation-space.mjs`의 같은 이름 대형과 자리를 맞춘다.
   */
  "감싸기 (원거리 보호)": (state) => {
    const u = livingUnits(state);
    const melee = u.filter((c) => c.breed.kind === "melee");
    const ranged = u.filter((c) => c.breed.kind === "ranged");
    const ring = [c2(1, 2), c2(2, 3), c2(3, 2), c2(0, 2), c2(4, 2), c2(2, 4)];
    const core = [c2(1, 1), c2(2, 1), c2(3, 1), c2(0, 1), c2(4, 1), c2(2, 0)];
    put(state, [...melee, ...ranged], [
      ...melee.map((_, i) => ring[i % ring.length]),
      ...ranged.map((_, i) => core[i % core.length]),
    ]);
  },

  /**
   * **다음 보스를 보고 대형을 고른다.** 상황을 읽는 유일한 정책이다.
   *
   * 나머지는 판 내내 같은 대형을 쓴다. 구매 축에서 똑같은 실수를 했다가
   * 로스터를 읽는 정책을 넣으니 0.9가 2.5로 바뀌었다 — **재는 정책이 없으면
   * 있는 깊이도 0으로 나온다.**
   *
   * 매핑은 `npm run formation`의 실측이다(예고당 잘못 선 마리수, 낮을수록 유리):
   *   무쇠발톱  분산 2.00 · 뭉침 2.67 · 감싸기 2.83 · 정석 2.85
   *   살금이    정석 1.82 · 감싸기 1.83 · 뭉침 2.00 · 분산 2.02
   *   서리귀    감싸기 2.33 · 정석 2.48 · 분산 2.72 · 뭉침 2.83
   */
  "보스 읽고 고름": (state) => {
    const boss = bossBreedAt(state);
    if (boss?.id === 9) return ARRANGERS["세로로 분산"](state); // 무쇠발톱 → 분산
    if (boss?.id === 11) return ARRANGERS["감싸기 (원거리 보호)"](state); // 서리귀 → 감싸기
    // 살금이(10)는 정석이 최선이고 그게 기본 배치와 같은 꼴이다.
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

if (ADJACENCY) {
  /**
   * 실험 2 전용 — **같은 직업을 한 열에 세로로 붙인다.** 근접 직업은 앞 열(4·3)부터,
   * 원거리는 뒷 열(0·1)부터 한 직업씩 차지한다. `CENTER_OUT` 순서(2·1·3·0·4)는 새 칸이
   * 늘 앞서 놓은 칸과 맞닿으므로 한 열 안의 같은 직업은 전부 인접 보너스를 받는다.
   * 대가는 뭉침이다 — 저격·장판이 오면 같은 대형이 벌을 받는다. 그 긴장이 재는 대상이다.
   */
  ARRANGERS["같은 직업 붙이기"] = (state) => {
    const u = livingUnits(state);
    const byClass = new Map();
    for (const c of u) {
      if (!byClass.has(c.breed.cls)) byClass.set(c.breed.cls, []);
      byClass.get(c.breed.cls).push(c);
    }
    const meleeCols = [BOARD_COLS - 1, BOARD_COLS - 2, 2];
    const rangedCols = [0, 1, 2];
    let mi = 0;
    let ri = 0;
    const used = new Set();
    const cats = [];
    const cells = [];
    for (const group of byClass.values()) {
      const melee = group[0].breed.kind === "melee";
      const cols = melee ? meleeCols : rangedCols;
      const col = cols[Math.min(cols.length - 1, melee ? mi++ : ri++)];
      for (const cat of group) {
        let cell = cellsIn(col).find((x) => !used.has(x));
        if (cell === undefined) {
          for (const c of cols) {
            cell = cellsIn(c).find((x) => !used.has(x));
            if (cell !== undefined) break;
          }
        }
        if (cell === undefined) continue;
        used.add(cell);
        cats.push(cat);
        cells.push(cell);
      }
    }
    put(state, cats, cells);
  };
}

function play(arrange, seed) {
  const s = newRun(seed);
  const respond = makeBossBot();
  for (let g = 0; g < MAX_WAVE * 400; g++) {
    if (s.phase === "gameover") return s.wave;
    if (s.phase === "reward") {
      const afford = affordable(s).sort(
        (a, b) => (a.kind === "replace" ? 1 : 0) - (b.kind === "replace" ? 1 : 0) || b.cost - a.cost,
      );
      if (afford[0]) {
        if (!buyOffer(s, afford[0])) s.offers = s.offers.map((o) => (o === afford[0] ? null : o));
        continue;
      }
      leaveShop(s);
      continue;
    }
    if (s.phase === "map") {
      walkMap(s, mapPick);
      continue;
    }
    if (s.phase === "prepare") {
      if (s.wave > MAX_WAVE) return s.wave;
      if (arrange) arrange(s);
      startBattle(s);
      if (s.phase !== "battle") return s.wave;
      continue;
    }
    respond(s);
    stepBattle(s, 100);
  }
  return s.wave;
}

const pct = (a, p) => a[Math.min(a.length - 1, Math.floor(a.length * p))];

console.log(`런 ${RUNS}회 · 구매 정책 고정(가장 비싼 것) · 배치만 변경 · 시드 ${SEED0 + 1}~${SEED0 + RUNS}` + (ADJACENCY ? " · 실험 2(인접 보너스 +8%/마리, 최대 2)" : "") + "\n");
console.log("배치                    최소   p10   p25  중앙값   p75   p90   최대   평균");
const means = {};
for (const [name, arrange] of Object.entries(ARRANGERS)) {
  const out = [];
  for (let i = 0; i < RUNS; i++) out.push(play(arrange, SEED0 + i + 1));
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

/**
 * **폭과 깊이를 갈라서 본다.**
 *
 * 오래 `max - min`만 찍고 "배치가 결정이다"라고 판정해 왔다. 그런데 그 격차는
 * 거의 전부 `역할 반대(근접 뒤)`에서 나온다 — **고의로 틀리게 놓은 정책**이다.
 * 즉 재고 있던 것은 "배치를 망치면 나빠지는가"였고, 그건 결정의 폭이지 깊이가
 * 아니다.
 *
 *   폭   = 최선 − 고의적 최악   "배치를 망칠 수 있는가"
 *   깊이 = 최선 − 자동 배치     "손으로 놓으면 자동보다 나은가"
 *
 * 깊이 쪽이 사람에게 실제로 남는 질문이다. 자동 배치가 이미 최선에 가까우면
 * 드래그는 장식이다.
 */
const vals = Object.values(means);
const spread = Math.max(...vals) - Math.min(...vals);
const auto = means["그대로 (bestFreeCell)"] ?? 0;
const bestPlace = Math.max(...vals);
const depth = bestPlace - auto;

console.log(`\n폭   (최선 ${bestPlace.toFixed(1)} − 고의적 최악 ${Math.min(...vals).toFixed(1)}) = ${spread.toFixed(1)}웨이브`);
console.log(`깊이 (최선 ${bestPlace.toFixed(1)} − 자동 배치 ${auto.toFixed(1)}) = ${depth.toFixed(1)}웨이브`);
console.log(
  "  (잡음 바닥: 1200판에서 0.7 / 1.0 / 0.7 — 기준 1.5에 한참 못 미친다.\n" +
    "   폭은 3블록에서 뽑은 거친 추정이라 그 자체의 오차가 크다. 300판일 때도\n" +
    "   0.9 / 1.1 / 1.0이었으니 값 자체는 판수에 크게 안 흔들리는 축이다)",
);

/**
 * 관문은 **폭**으로 잡는다. 이 시험의 임무는 "배치가 결정인가"를 증명하는 것이
 * 아니라, 개입·밸런스를 조정하다가 **배치가 아예 무의미해지는 것을 잡는** 회귀
 * 감시다(intervention-space의 B3가 이 값을 참조한다).
 *
 * 깊이는 판정하되 관문에 걸지 않는다. 이미 얕다는 것을 알고 있고, 그걸로
 * verify를 빨갛게 만들면 지도 축이 내는 신호와 섞여 정보가 줄어든다. 대신
 * 미해결 항목으로 `docs/generated/metrics-current.json`에 남긴다.
 */
const placeOk = spread >= 2.0;
console.log(placeOk ? "회귀 감시: 통과 — 배치를 망치면 나빠진다" : "회귀 감시: 실패 — 어디에 놓든 같다");
console.log(
  depth >= 1.5
    ? "판정: 배치에 깊이가 있다 — 손으로 놓을 값을 한다"
    : "판정: 배치에 깊이가 없다 — 자동 배치가 이미 최선에 가깝고, 드래그는 장식이다",
);
if (!placeOk) process.exitCode = 1;
