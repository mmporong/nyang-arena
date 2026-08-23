/**
 * 지도는 홀로가 아니라 **구매와 연계될 때** 값하는가.
 *
 * `map-space`는 구매·배치를 고정한 채 지도만 바꿔 도달 웨이브를 잰다. 그런데 지도 실험 넷(제단·열쇠·
 * 제물·성소)이 전부 함정으로 나온 이유가 바로 그 격리에 있다는 가설을 세웠다: 유물은 조건부라 로스터를
 * 몰빵하지 않으면 대가만 남아 손해다. 그러면 성소로 가서 유물을 모으는 것은, **그 유물에 맞춰 로스터를
 * 몰빵하는 구매**와 함께여야 값한다. map-space는 구매를 고정하니 그 연계를 못 본다.
 *
 * 이 스크립트는 그 연계를 직접 잰다. 성소 실험(`BALANCE.mapSanctuary`)을 켜고 봇 넷을 비교한다:
 *   무지성      가장 비싼 것 구매 · 무작위 경로            (아무것도 안 읽음)
 *   성소만      가장 비싼 것 구매 · 성소 노림 경로          (경로만 읽음 — map-space가 잰 그 함정)
 *   피벗만      몰빵 피벗 구매 · 무작위 경로               (구매만 읽음)
 *   연계        몰빵 피벗 구매 · 성소 노림 경로            (구매+경로를 함께 읽음)
 *
 * **연계가 피벗만·성소만을 둘 다 의미 있게 이기면**, 지도(성소)는 홀로는 함정이어도 구매와 연계될 때
 * 값한다는 뜻이다 — 즉 지도 축을 격리해 재는 것이 애초에 틀린 측정이라는 실증이다.
 *
 * 관측이다(관문 아님). 실행: npm run combo [런 수] [시드 오프셋]
 */
import { stepBattle } from "../src/game/battle.ts";
import { newRun, startBattle } from "../src/game/run.ts";
import { runSharded } from "./parallel.mjs";
import { BALANCE } from "../src/game/balance.ts";
import { makeBossBot, walkMap, leaveShop, shopStep, MAP_POLICIES, BUY_POLICIES, SANCTUARY_MAP_POLICIES } from "./bot-policy.mjs";

BALANCE.mapSanctuary = true; // 이 스크립트는 성소 세계에서만 뜻이 있다.

const ARGS = process.argv.slice(2);
const NUMS = ARGS.filter((a) => !a.startsWith("--"));
const RUNS = Number(NUMS[0] ?? 1500);
const SEED0 = Number(NUMS[1] ?? 0);
const MAX_WAVE = 60;

const cheap = BUY_POLICIES["가장 비싼 것(현재)"];
const pivot = BUY_POLICIES["몰빵 피벗(로스터를 읽음)"];
const rndMap = MAP_POLICIES["무작위"];
const sancMap = SANCTUARY_MAP_POLICIES["성소 노림"];

const BOTS = {
  "무지성": { buy: cheap, map: rndMap },
  "성소만": { buy: cheap, map: sancMap },
  "피벗만": { buy: pivot, map: rndMap },
  "연계": { buy: pivot, map: sancMap },
};

function play(bot, seed) {
  const s = newRun(seed);
  const respond = makeBossBot();
  const shop = { rerolls: 0, lastWave: 0 };
  for (let guard = 0; guard < MAX_WAVE * 4000; guard++) {
    if (s.phase === "gameover") return s.wave;
    if (s.phase === "reward") {
      if (shopStep(s, shop, bot.buy) !== "leave") continue;
      leaveShop(s);
      continue;
    }
    if (s.phase === "map") {
      walkMap(s, bot.map);
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

console.log(`런 ${RUNS}회 · 성소 세계 · 구매+경로를 함께 바꾼다 · 시드 ${SEED0 + 1}~${SEED0 + RUNS}\n`);
console.log("봇        최소  p25  중앙값  p75  최대   평균");

const sharded = await runSharded(import.meta.url, Object.keys(BOTS), (name, seed) => play(BOTS[name], seed), { runs: RUNS, seed0: SEED0 });
const means = {};
for (const name of Object.keys(BOTS)) {
  const out = sharded[name].slice().sort((a, b) => a - b);
  const avg = out.reduce((x, y) => x + y, 0) / out.length;
  means[name] = avg;
  console.log(
    `${name.padEnd(8)} ${String(out[0]).padStart(4)} ${String(pct(out, 0.25)).padStart(4)} ` +
      `${String(pct(out, 0.5)).padStart(6)} ${String(pct(out, 0.75)).padStart(4)} ` +
      `${String(out[out.length - 1]).padStart(5)} ${avg.toFixed(1).padStart(6)}`,
  );
}

// 성소가 홀로는 함정이어도(성소만 ≤ 무지성) 구매와 연계되면 값하는가(연계 > 피벗만).
const sancAlone = means["성소만"] - means["무지성"]; // 경로만 읽었을 때 성소의 값(≤0이면 함정)
const sancWithPivot = means["연계"] - means["피벗만"]; // 구매를 몰빵할 때 성소의 값
console.log(`\n성소의 값 — 경로만 읽을 때: ${sancAlone >= 0 ? "+" : ""}${sancAlone.toFixed(1)}웨이브  ·  피벗과 연계할 때: ${sancWithPivot >= 0 ? "+" : ""}${sancWithPivot.toFixed(1)}웨이브`);
console.log(
  sancWithPivot >= 1.0 && sancWithPivot - sancAlone >= 0.8
    ? "판정: 지도(성소)는 홀로는 함정이어도 구매와 연계될 때 값한다 — 지도를 격리해 재는 것이 틀린 측정이다"
    : "판정: 연계해도 성소가 값하지 않는다 — 지도가 유물 경로로는 결정을 못 만든다",
);
