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
import { affordable, makeBossBot, walkMap, MAP_POLICIES } from "./bot-policy.mjs";

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
for (const [name, pick] of Object.entries(POLICIES)) {
  const out = [];
  for (let i = 0; i < RUNS; i++) out.push(play(pick, i + 1));
  out.sort((a, b) => a - b);
  const avg = out.reduce((x, y) => x + y, 0) / out.length;
  means[name] = avg;
  console.log(
    `${name.padEnd(20)} ${String(out[0]).padStart(4)} ${String(pct(out, 0.1)).padStart(4)} ` +
      `${String(pct(out, 0.25)).padStart(4)} ${String(pct(out, 0.5)).padStart(6)} ` +
      `${String(pct(out, 0.75)).padStart(4)} ${String(pct(out, 0.9)).padStart(4)} ` +
      `${String(out[out.length - 1]).padStart(5)} ${avg.toFixed(1).padStart(6)}`,
  );
}

const vals = Object.values(means);
const spread = Math.max(...vals) - Math.min(...vals);
const noRelic = means["유물 안 삼"] ?? 0;
const bestFocus = Math.max(...["전사", "도적", "궁수", "마법사"].map((c) => means[`${c} 몰빵`] ?? 0));
console.log(`\n최선과 최악의 격차: ${spread.toFixed(1)}웨이브`);
console.log(`유물을 안 사는 것(${noRelic.toFixed(1)}) 대비 최고 몰빵(${bestFocus.toFixed(1)}): ${(bestFocus - noRelic).toFixed(1)}웨이브`);
console.log(
  spread < 1.5
    ? "판정: 유물이 빌드를 가르지 못한다 — 무엇을 사든 같은 곳에 도착한다"
    : "판정: 유물이 빌드를 가른다",
);
