/**
 * 이 게임에 '결정'이 존재하는가?
 *
 * 좋은 정책과 나쁜 정책의 도달 웨이브가 비슷하다면, 그 선택은 결정이 아니라 절차다.
 * 구매 정책 넷을 같은 조건에서 돌려 분포를 비교한다.
 */
import { stepBattle } from "/home/lim/nyang-arena/src/game/battle.ts";
import { buyOffer, newRun, rerollOffers, startBattle } from "/home/lim/nyang-arena/src/game/run.ts";

const RUNS = 300;

const POLICIES = {
  "아무것도 안 삼": () => null,
  "무작위 구매": (afford) => afford[Math.floor(seeded() * afford.length)],
  "가장 싼 것": (afford) => [...afford].sort((a, b) => a.cost - b.cost)[0],
  "가장 비싼 것(현재)": (afford, s) =>
    [...afford]
      // 유물은 조건을 채우고 있을 때만. 카드를 읽는 최소한의 플레이어다.
      .filter((o) => o.kind !== "relic" || (o.relic ? relicActive(o.relic, livingCats(s.ally)) : false))
      .sort((a, b) => (a.kind === "replace" ? 1 : 0) - (b.kind === "replace" ? 1 : 0) || b.cost - a.cost)[0],
  "강화만": (afford) => afford.filter((o) => o.kind === "upgrade")[0] ?? null,
  "영입만": (afford) => afford.filter((o) => o.kind === "recruit")[0] ?? null,
};

/**
 * 봇의 "무작위 구매" 선택용 난수.
 *
 * 게임 자체의 난수는 `newRun(seed)`가 잡는다 — 예전에는 이 시드가 게임까지
 * 제어한다고 주석에 적혀 있었지만 사실이 아니었고, 그래서 같은 코드를 두 번
 * 돌리면 중앙값이 13, 13, 14로 흔들렸다.
 */
let seed = 12345;
function seeded() {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
}

function run(pick, runSeed) {
  const s = newRun(runSeed);
  let rerolls = 0;
  let lastWave = 0;
  for (let guard = 0; guard < 40000; guard++) {
    if (s.phase === "gameover") return s.wave;
    if (s.phase === "reward") {
      const afford = s.offers.filter((o) => o && o.cost <= s.gold);
      const choice = afford.length > 0 ? pick(afford, s) : null;
      if (choice) {
        if (!buyOffer(s, choice)) s.offers = s.offers.map((o) => (o === choice ? null : o));
        continue;
      }
      if (s.wave !== lastWave) { lastWave = s.wave; rerolls = 0; }
      if (rerolls < 4 && s.gold >= 12 && rerollOffers(s)) { rerolls += 1; continue; }
      s.phase = "prepare";
      continue;
    }
    if (s.phase === "prepare") {
      if (s.wave > 60) return 60;
      startBattle(s);
      if (s.phase !== "battle") return s.wave;
      continue;
    }
    stepBattle(s, 100);
  }
  return s.wave;
}

const pct = (a, p) => a[Math.min(a.length - 1, Math.floor(a.length * p))];
const p10 = (a) => pct(a, 0.1);
const p90 = (a) => pct(a, 0.9);
console.log("정책                  최소   p10   p25  중앙값   p75   p90   최대   평균");
for (const [name, pick] of Object.entries(POLICIES)) {
  seed = 12345;
  const out = [];
  for (let i = 0; i < RUNS; i++) out.push(run(pick, i + 1));
  out.sort((a, b) => a - b);
  const avg = out.reduce((x, y) => x + y, 0) / out.length;
  console.log(
    `${name.padEnd(20)} ${String(out[0]).padStart(4)} ${String(p10(out)).padStart(5)} ` +
      `${String(pct(out, 0.25)).padStart(5)} ${String(pct(out, 0.5)).padStart(6)} ` +
      `${String(pct(out, 0.75)).padStart(5)} ${String(p90(out)).padStart(5)} ` +
      `${String(out[out.length - 1]).padStart(5)} ${avg.toFixed(1).padStart(7)}`,
  );
}
