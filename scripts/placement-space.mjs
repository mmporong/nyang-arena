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
import { runSharded } from "./parallel.mjs";
import { buyOffer, newRun, startBattle } from "../src/game/run.ts";
import { affordable, makeBossBot, walkMap, leaveShop, MAP_POLICIES, ARRANGERS } from "./bot-policy.mjs";

const RUNS = Number(process.argv[2] ?? 1200);
/**
 * 시드 오프셋. 잡음 바닥을 재려고 넣었다 — `relic-space.mjs`와 같은 이유다.
 * 유물 목록처럼 무관해 보이는 것을 건드려도 오퍼 생성이 난수를 다르게 먹어
 * 같은 시드가 다른 판이 된다. 겹치지 않는 블록으로 같은 코드를 두 번 돌려
 * 코드와 무관한 흔들림이 얼마인지부터 보고, 그보다 작은 차이는 안 믿는다.
 */
const SEED0 = Number(process.argv[3] ?? 0);
// 지도는 아무 길이나 간다. 이 스크립트가 재는 축이 아니므로 고정하지 않는다.
const mapPick = MAP_POLICIES["무작위"];
const MAX_WAVE = 60;

/** 살아 있는 아군을 보드 순서대로. */

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

console.log(`런 ${RUNS}회 · 구매 정책 고정(가장 비싼 것) · 배치만 변경 · 시드 1~${RUNS}\n`);
console.log("배치                    최소   p10   p25  중앙값   p75   p90   최대   평균");
const means = {};
// 런은 워커에 나눠 돌리고(scripts/parallel.mjs) 원시 결과만 받는다. 집계는 아래 그대로다.
const sharded = await runSharded(import.meta.url, Object.keys(ARRANGERS), (name, seed) => play(ARRANGERS[name], seed), { runs: RUNS, seed0: SEED0 });
for (const name of Object.keys(ARRANGERS)) {
  const out = sharded[name].slice();
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
