/**
 * 이 게임에 '결정'이 존재하는가?
 *
 * 좋은 정책과 나쁜 정책의 도달 웨이브가 비슷하다면, 그 선택은 결정이 아니라 절차다.
 * 구매 정책 넷을 같은 조건에서 돌려 분포를 비교한다.
 */
import { stepBattle } from "../src/game/battle.ts";
import { newRun, startBattle } from "../src/game/run.ts";
import { makeBossBot, walkMap, leaveShop, shopStep, MAP_POLICIES, BUY_POLICIES } from "./bot-policy.mjs";

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


function run(pick, runSeed) {
  const s = newRun(runSeed);
  const respond = makeBossBot();
  const shop = { rerolls: 0, lastWave: 0 };
  for (let guard = 0; guard < 40000; guard++) {
    if (s.phase === "gameover") return s.wave;
    if (s.phase === "reward") {
      // 구매·재추첨은 bot-policy의 `shopStep` 한 곳만 쓴다. 이 파일은 제 사본을 들고 있었고 **무료
      // 재추첨을 안 써서** 상점 칸의 보상을 버리고 있었다 — AGENTS.md가 네 번 적은 그 결함이다.
      // 정책은 choose 인자로 넘긴다(카드만 보는 정책은 둘째 인자를 무시한다).
      if (shopStep(s, shop, pick) !== "leave") continue;
      leaveShop(s);
      continue;
    }
    if (s.phase === "map") {
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
for (const [name, pick] of Object.entries(BUY_POLICIES)) {
  // 무작위 구매의 난수는 런 시드에서 나온다(bot-policy `buyRng`) — 정책마다 되감을 전역 LCG가 더는 없다.
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
// 미달이면 실패로 끝낸다 — 판정을 찍고도 0을 돌려주면 measure-all의 "관문 통과"가 거짓이 된다.
if (!(bestV - naive >= 1.5)) process.exitCode = 1;
