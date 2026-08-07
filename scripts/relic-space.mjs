/**
 * 유물이 빌드를 가르는가?
 *
 * 유물의 존재 이유는 "무엇을 사든 결과가 같다"를 깨는 것이다. 구매 정책을
 * 바꿔도 도달 웨이브가 0.9밖에 안 갈렸던 것이 그 문제였고, 유물은 **조건을
 * 맞추면 크게 이득 / 안 맞추면 대가만 남는** 구조로 그걸 푼다.
 *
 * 그래서 여기서 재는 것은 난이도가 아니라 **갈림**이다. 몰빵 전략들이 유물을
 * 안 사는 것보다 뚜렷하게 높고, 조건을 안 보고 사는 것이 뚜렷하게 낮아야 한다.
 *
 * 실행: npm run relics
 */
import { stepBattle } from "../src/game/battle.ts";
import { buyOffer, newRun, rerollOffers, startBattle } from "../src/game/run.ts";
import { affordable, makeBossBot, walkMap, leaveShop, MAP_POLICIES } from "./bot-policy.mjs";

const RUNS = Number(process.argv[2] ?? 300);
// 지도는 아무 길이나 간다. 이 스크립트가 재는 축이 아니므로 고정하지 않는다.
const mapPick = MAP_POLICIES["무작위"];
const MAX_WAVE = 60;

/** 한 직업에 몰빵한다. 그 직업 유물이 나오면 최우선으로 산다. */
const focus = (cls) => (offers) => {
  const relic = offers.find(
    (o) => o.kind === "relic" && o.relic?.condition.kind === "class_count" && o.relic.condition.cls === cls,
  );
  if (relic) return relic;
  return (
    offers.find((o) => o.kind === "recruit" && o.breed?.cls === cls) ??
    offers.find((o) => o.kind === "upgrade" && o.breed?.cls === cls) ??
    offers.find((o) => o.kind !== "relic" && o.kind !== "replace") ??
    null
  );
};

const byCost = (a, b) => (a.kind === "replace" ? 1 : 0) - (b.kind === "replace" ? 1 : 0) || b.cost - a.cost;

const POLICIES = {
  "유물 안 삼": (a) => [...a].filter((o) => o.kind !== "relic").sort(byCost)[0],
  "균형 (가장 비싼 것)": (a) => [...a].sort(byCost)[0],
  "전사 몰빵": focus("warrior"),
  "도적 몰빵": focus("rogue"),
  "궁수 몰빵": focus("archer"),
  "마법사 몰빵": focus("mage"),
};

function play(pick, seed) {
  const s = newRun(seed);
  const respond = makeBossBot();
  for (let guard = 0; guard < MAX_WAVE * 4000; guard++) {
    if (s.phase === "gameover") return s.wave;
    if (s.phase === "reward") {
      let rolls = 0;
      for (let k = 0; k < 60; k++) {
        const afford = affordable(s);
        const choice = afford.length > 0 ? pick(afford) : null;
        if (choice) {
          if (!buyOffer(s, choice)) s.offers = s.offers.map((o) => (o === choice ? null : o));
          continue;
        }
        if (rolls < 4 && s.gold >= 12 && rerollOffers(s)) {
          rolls += 1;
          continue;
        }
        break;
      }
      leaveShop(s);
      continue;
    }
    if (s.phase === "map") {
      walkMap(s, mapPick);
      continue;
    }
    if (s.phase === "prepare") {
      if (s.wave > MAX_WAVE) return MAX_WAVE;
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

console.log(`런 ${RUNS}회 · 배치·개입 정책 고정 · 구매 전략만 변경 · 시드 1~${RUNS}\n`);
console.log("전략                   최소  p10  p25  중앙값  p75  p90  최대   평균");
const means = {};
/** 시드 순서를 유지한 원본. 정렬본으로는 시드별 짝비교를 할 수 없다. */
const bySeed = {};
for (const [name, pick] of Object.entries(POLICIES)) {
  const raw = [];
  for (let i = 0; i < RUNS; i++) raw.push(play(pick, i + 1));
  bySeed[name] = raw;
  const out = [...raw].sort((a, b) => a - b);
  const avg = out.reduce((x, y) => x + y, 0) / out.length;
  means[name] = avg;
  console.log(
    `${name.padEnd(20)} ${String(out[0]).padStart(4)} ${String(pct(out, 0.1)).padStart(4)} ` +
      `${String(pct(out, 0.25)).padStart(4)} ${String(pct(out, 0.5)).padStart(6)} ` +
      `${String(pct(out, 0.75)).padStart(4)} ${String(pct(out, 0.9)).padStart(4)} ` +
      `${String(out[out.length - 1]).padStart(5)} ${avg.toFixed(1).padStart(6)}`,
  );
}

/**
 * **고정 지배인가, 상황 선택인가.**
 *
 * 평균표만 보면 "도적 몰빵 18.2가 최고"로 끝난다. 그러면 이 축은 전략적 깊이가
 * 아니라 **지식 시험**이다 — 정답을 한 번 배우면 매 판 같은 것을 고르면 된다.
 *
 * 그래서 시드마다 어느 전략이 이겼는지를 센다.
 *
 *   고정 최선 = 한 전략을 끝까지 밀었을 때의 평균 (위 표의 최고값)
 *   신탁     = 시드마다 그 판에서 가장 좋았던 전략을 골랐을 때의 평균
 *
 * 신탁이 고정 최선보다 크게 높으면 **판마다 정답이 다르다**는 뜻이고, 그때만
 * 이 축에 상황 판단이 있다. 다만 신탁은 결과를 미리 아는 상한이라 사람이 낼 수
 * 있는 값이 아니다 — 여기서 재는 것은 "고를 값이 있는가"이지 "얼마나 낼 수
 * 있는가"가 아니다.
 */
const focusNames = ["전사 몰빵", "도적 몰빵", "궁수 몰빵", "마법사 몰빵"];
const wins = new Map(focusNames.map((n) => [n, 0]));
let oracleSum = 0;
for (let i = 0; i < RUNS; i++) {
  let bestName = null;
  let bestVal = -1;
  for (const n of focusNames) {
    if (bySeed[n][i] > bestVal) {
      bestVal = bySeed[n][i];
      bestName = n;
    }
  }
  wins.set(bestName, wins.get(bestName) + 1);
  oracleSum += bestVal;
}
const oracle = oracleSum / RUNS;
const fixedBest = Math.max(...focusNames.map((n) => means[n] ?? 0));
const topName = focusNames.find((n) => means[n] === fixedBest);
const topShare = (wins.get(topName) / RUNS) * 100;

console.log("\n시드마다 어느 몰빵이 이겼나 (동점은 먼저 나온 쪽)");
for (const n of focusNames) {
  console.log(`  ${n.padEnd(10)} ${String(wins.get(n)).padStart(4)}판  ${((wins.get(n) / RUNS) * 100).toFixed(1)}%`);
}
console.log(`\n고정 최선(${topName}) ${fixedBest.toFixed(1)}  ·  신탁 ${oracle.toFixed(1)}  ·  차이 ${(oracle - fixedBest).toFixed(1)}웨이브`);
console.log(
  topShare >= 50
    ? `판정: ${topName} 하나가 ${topShare.toFixed(0)}% 시드에서 최선이다 — 상황 판단보다 지식 시험에 가깝다`
    : `판정: 최선이 판마다 갈린다 (최다 ${topName} ${topShare.toFixed(0)}%) — 상황 판단의 여지가 있다`,
);

const vals = Object.values(means);
const spread = Math.max(...vals) - Math.min(...vals);
const noRelic = means["유물 안 삼"] ?? 0;
const bestFocus = Math.max(...["전사", "도적", "궁수", "마법사"].map((c) => means[`${c} 몰빵`] ?? 0));
console.log(`\n최선과 최악의 격차: ${spread.toFixed(1)}웨이브`);
console.log(`유물을 안 사는 것(${noRelic.toFixed(1)}) 대비 최고 몰빵(${bestFocus.toFixed(1)}): ${(bestFocus - noRelic).toFixed(1)}웨이브`);
/**
 * 기준 4.0웨이브. 개입 축을 재조정할 때 빌드가 살아 있는지 지키는 관문이다 —
 * 실행 실력이 빌드 결정을 덮으면 안 된다는 것이 이 숫자의 존재 이유다.
 */
const relicOk = bestFocus - noRelic >= 4.0;
console.log(
  relicOk
    ? "판정: 유물이 빌드를 가른다"
    : "판정: 유물이 빌드를 가르지 못한다 — 무엇을 사든 같은 곳에 도착한다",
);
if (!relicOk) process.exitCode = 1;
