/**
 * 이 게임에 '결정'이 존재하는가?
 *
 * 좋은 정책과 나쁜 정책의 도달 웨이브가 비슷하다면, 그 선택은 결정이 아니라 절차다.
 * 구매 정책 넷을 같은 조건에서 돌려 분포를 비교한다.
 */
import { stepBattle } from "../src/game/battle.ts";
import { buyOffer, newRun, rerollOffers, startBattle } from "../src/game/run.ts";
import { livingCats } from "../src/game/types.ts";
import { affordable, makeBossBot, walkMap, MAP_POLICIES } from "./bot-policy.mjs";

const RUNS = 300;
/**
 * 지도는 아무 길이나 간다. 이 스크립트가 재는 축은 **구매**지 경로가 아니므로
 * 경로 정책을 고정해 잡음을 줄인다.
 *
 * 이 선언이 빠져 있어서 스크립트가 통째로 죽어 있었다 — 지도를 붙이며 다른
 * 스크립트에는 넣고 여기만 빠뜨렸다. 구매 축은 이 저장소의 출발점("이 게임에
 * 결정이 있는가")이었는데 그 근거가 재현되지 않는 상태였다.
 */
const mapPick = MAP_POLICIES["무작위"];

const byCost = (a, b) => (a.kind === "replace" ? 1 : 0) - (b.kind === "replace" ? 1 : 0) || b.cost - a.cost;

/**
 * **로스터를 읽고 한쪽으로 민다.**
 *
 * 여태 구매 정책은 전부 카드 자체만 봤다 — 값이 싼가 비싼가, 영입인가 강화인가.
 * 그래서 "무작위로 사는 봇과 최선 봇의 중앙값이 똑같이 12"라는 결과가 나왔고,
 * 거기서 "구매에는 깊이가 없다"고 결론을 냈다.
 *
 * 그런데 그 결론은 **읽고 사는 정책을 한 번도 안 재 본 상태**에서 내린 것이다.
 * `npm run relics`가 직업 몰빵으로 평균 13.8 → 18.2를 만든다는 것을 이미 알고
 * 있었으므로, 구매 축에도 같은 것이 있을 수 있다.
 *
 * 이 정책은 지금 내 팀에서 가장 많은 직업을 세고 그쪽으로 민다. 카드가 아니라
 * **상태를 보는** 최초의 구매 정책이다. 교체 카드도 쓴다 — 지금까지 모든 정책이
 * `replace`를 맨 뒤로 밀어 두고 있었는데, 몰빵에는 곁가지를 쳐내는 수단이 필요하다.
 */
function pivot(state, afford) {
  const count = new Map();
  for (const c of livingCats(state.ally)) {
    count.set(c.breed.cls, (count.get(c.breed.cls) ?? 0) + 1);
  }
  let want = null;
  let most = -1;
  for (const [cls, n] of count) {
    if (n > most) {
      most = n;
      want = cls;
    }
  }
  if (!want) return [...afford].sort(byCost)[0] ?? null;
  const mine = (o) => o.breed?.cls === want;
  return (
    // 몰빵 직업의 유물이 최우선 — 조건을 이미 채우고 있으므로 대가만 남지 않는다.
    afford.find((o) => o.kind === "relic" && o.relic?.condition?.cls === want) ??
    [...afford].filter((o) => o.kind === "upgrade" && mine(o)).sort(byCost)[0] ??
    [...afford].filter((o) => o.kind === "recruit" && mine(o)).sort(byCost)[0] ??
    // 곁가지를 몰빵 직업으로 바꾼다. 조건(3마리 이상)을 채우는 유일한 지렛대일 때가 있다.
    [...afford].filter((o) => o.kind === "replace" && mine(o)).sort(byCost)[0] ??
    [...afford].filter((o) => o.kind !== "relic" && o.kind !== "replace").sort(byCost)[0] ??
    null
  );
}

const POLICIES = {
  "아무것도 안 삼": () => null,
  "무작위 구매": (afford) => afford[Math.floor(seeded() * afford.length)],
  "가장 싼 것": (afford) => [...afford].sort((a, b) => a.cost - b.cost)[0],
  "가장 비싼 것(현재)": (afford) => [...afford].sort(byCost)[0],
  "강화만": (afford) => afford.filter((o) => o.kind === "upgrade")[0] ?? null,
  "영입만": (afford) => afford.filter((o) => o.kind === "recruit")[0] ?? null,
  "몰빵 피벗(로스터를 읽음)": (afford, state) => pivot(state, afford),
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
  const respond = makeBossBot();
  let rerolls = 0;
  let lastWave = 0;
  for (let guard = 0; guard < 40000; guard++) {
    if (s.phase === "gameover") return s.wave;
    if (s.phase === "reward") {
      const afford = affordable(s);
      // 정책에 상태를 함께 넘긴다. 카드만 보는 정책은 두 번째 인자를 무시한다.
      const choice = afford.length > 0 ? pick(afford, s) : null;
      if (choice) {
        if (!buyOffer(s, choice)) s.offers = s.offers.map((o) => (o === choice ? null : o));
        continue;
      }
      if (s.wave !== lastWave) { lastWave = s.wave; rerolls = 0; }
      if (rerolls < 4 && s.gold >= 12 && rerollOffers(s)) { rerolls += 1; continue; }
      walkMap(s, mapPick);
      continue;
    }
    if (s.phase === "prepare") {
      if (s.wave > 60) return 60;
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
const p10 = (a) => pct(a, 0.1);
const p90 = (a) => pct(a, 0.9);
console.log("정책                  최소   p10   p25  중앙값   p75   p90   최대   평균");
const means = {};
const bySeed = {};
for (const [name, pick] of Object.entries(POLICIES)) {
  seed = 12345;
  const raw = [];
  for (let i = 0; i < RUNS; i++) raw.push(run(pick, i + 1));
  bySeed[name] = raw;
  const out = [...raw].sort((a, b) => a - b);
  const avg = out.reduce((x, y) => x + y, 0) / out.length;
  means[name] = avg;
  console.log(
    `${name.padEnd(20)} ${String(out[0]).padStart(4)} ${String(p10(out)).padStart(5)} ` +
      `${String(pct(out, 0.25)).padStart(5)} ${String(pct(out, 0.5)).padStart(6)} ` +
      `${String(pct(out, 0.75)).padStart(5)} ${String(p90(out)).padStart(5)} ` +
      `${String(out[out.length - 1]).padStart(5)} ${avg.toFixed(1).padStart(7)}`,
  );
}

/**
 * **폭과 깊이를 갈라서 판정한다.**
 *
 *   폭   = 최선 − 아무것도 안 삼    "사는 게 나은가"
 *   깊이 = 최선 − 무작위 구매       "무엇을 사는지가 중요한가"
 *
 * 오래 폭(11.5)만 인용하며 "구매가 이 게임 최대의 축"이라고 적어 왔다. 그런데
 * 값싼 정책들끼리는 평균 12.8~13.8에 중앙값이 전부 12로 붙어 있었고, 그래서
 * 한동안 "구매에는 깊이가 없다"고 결론을 냈다.
 *
 * **그 결론도 틀렸다.** 비교한 정책이 전부 카드만 보는 정책이었기 때문이다.
 * 로스터를 읽고 한쪽으로 미는 정책을 넣자 깊이가 드러났다. 축에 깊이가 없다는
 * 판정은 "잘하는 정책을 아직 안 찾았다"와 구분되지 않는다 — 없음을 증명하려면
 * 그 축에서 가능한 최선을 실제로 시도해 봐야 한다.
 */
const floorV = means["아무것도 안 삼"] ?? 0;
const naive = means["무작위 구매"] ?? 0;
const bestName = Object.keys(means).reduce((a, b) => (means[a] >= means[b] ? a : b));
const bestV = means[bestName];
const d = bySeed[bestName].map((v, i) => v - bySeed["무작위 구매"][i]).sort((a, b) => a - b);
const medDiff = d[Math.floor(d.length / 2)];
const winPct = (d.filter((x) => x > 0).length / d.length) * 100;

console.log(`\n폭   (최선 ${bestV.toFixed(1)} − 안 삼 ${floorV.toFixed(1)}) = ${(bestV - floorV).toFixed(1)}웨이브`);
console.log(`깊이 (최선 ${bestV.toFixed(1)} − 무작위 ${naive.toFixed(1)}) = ${(bestV - naive).toFixed(1)}웨이브`);
console.log(`     시드짝비교: 중앙값 ${medDiff >= 0 ? "+" : ""}${medDiff} · ${winPct.toFixed(0)}% 시드에서 우세  (최선 = ${bestName})`);
console.log(
  bestV - naive >= 1.5
    ? "판정: 구매에 깊이가 있다 — 무엇을 사는지가 결과를 가른다"
    : "판정: 구매에 깊이가 없다 — 사기만 하면 무엇을 사든 같다",
);
