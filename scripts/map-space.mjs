/**
 * 지도가 결정인가?
 *
 * 구매·배치·개입을 잰 것과 같은 방법이다 — **정책만 바꾸고 나머지는 고정한 뒤
 * 도달 웨이브가 갈리는지 본다.** 갈리지 않으면 지도는 화면에만 있는 것이고,
 * 그러면 아무 길이나 가도 되므로 매 걸음 누르는 것이 그냥 의식(儀式)이 된다.
 *
 * 세 갈래가 서로 다른 대가를 치른다는 것이 설계의 전제다.
 *   전투   기본값. 평범한 생선
 *   정예   저격대. 통과율이 낮은 대신 생선 1.6배 + 유물 보장
 *   상점   안 싸운다. 생선과 무료 재추첨을 받지만 **웨이브는 지나간다**
 *          (적은 웨이브마다 복리로 세지므로 그 사이 상대가 강해진다)
 *
 * 실행: npm run map
 */
import { stepBattle } from "../src/game/battle.ts";
import { buyOffer, newRun, rerollOffers, startBattle } from "../src/game/run.ts";
import { affordable, makeBossBot, walkMap, leaveShop, MAP_POLICIES } from "./bot-policy.mjs";

const RUNS = Number(process.argv[2] ?? 300);
const MAX_WAVE = 60;

const byCost = (a, b) => (a.kind === "replace" ? 1 : 0) - (b.kind === "replace" ? 1 : 0) || b.cost - a.cost;

function play(pick, seed) {
  const s = newRun(seed);
  const respond = makeBossBot();
  const seen = { battle: 0, elite: 0, shop: 0, boss: 0 };

  for (let guard = 0; guard < MAX_WAVE * 4000; guard++) {
    if (s.phase === "gameover") return { wave: s.wave, seen };
    if (s.phase === "reward") {
      for (let k = 0; k < 40; k++) {
        const afford = affordable(s);
        const choice = afford.length > 0 ? [...afford].sort(byCost)[0] : null;
        if (!choice) break;
        if (!buyOffer(s, choice)) s.offers = s.offers.map((o) => (o === choice ? null : o));
      }
      // 무료 재추첨이 남아 있으면 쓴다. 안 쓰면 상점 칸의 보상이 사라진 것과 같다.
      while (s.freeRerolls > 0) {
        rerollOffers(s);
        for (let k = 0; k < 40; k++) {
          const afford = affordable(s);
          const choice = afford.length > 0 ? [...afford].sort(byCost)[0] : null;
          if (!choice) break;
          if (!buyOffer(s, choice)) s.offers = s.offers.map((o) => (o === choice ? null : o));
        }
      }
      leaveShop(s);
      continue;
    }
    if (s.phase === "map") {
      walkMap(s, pick);
      // 무엇을 밟았는지는 고른 **직후**에 센다. 상점을 나선 뒤에는 nodeKind가
      // 다음 걸음의 것으로 바뀌어 있다.
      if (s.nodeKind) seen[s.nodeKind] += 1;
      continue;
    }
    if (s.phase === "prepare") {
      if (s.wave > MAX_WAVE) return { wave: MAX_WAVE, seen };
      startBattle(s);
      if (s.phase !== "battle") return { wave: s.wave, seen };
      continue;
    }
    respond(s);
    stepBattle(s, 100);
  }
  return { wave: s.wave, seen };
}

const pct = (a, p) => a[Math.min(a.length - 1, Math.floor(a.length * p))];

console.log(`런 ${RUNS}회 · 구매·배치·개입 고정 · 길 고르기만 변경 · 시드 1~${RUNS}\n`);
console.log("정책          최소  p25  중앙값  p75  최대   평균   전투/정예/상점");

const means = {};
for (const [name, pick] of Object.entries(MAP_POLICIES)) {
  const out = [];
  const tally = { battle: 0, elite: 0, shop: 0, boss: 0 };
  for (let i = 0; i < RUNS; i++) {
    const r = play(pick, i + 1);
    out.push(r.wave);
    for (const k of Object.keys(tally)) tally[k] += r.seen[k];
  }
  out.sort((a, b) => a - b);
  const avg = out.reduce((x, y) => x + y, 0) / out.length;
  means[name] = avg;
  const mix = `${(tally.battle / RUNS).toFixed(1)}/${(tally.elite / RUNS).toFixed(1)}/${(tally.shop / RUNS).toFixed(1)}`;
  console.log(
    `${name.padEnd(12)} ${String(out[0]).padStart(4)} ${String(pct(out, 0.25)).padStart(4)} ` +
      `${String(pct(out, 0.5)).padStart(6)} ${String(pct(out, 0.75)).padStart(4)} ` +
      `${String(out[out.length - 1]).padStart(5)} ${avg.toFixed(1).padStart(6)}   ${mix}`,
  );
}

const vals = Object.values(means);
const spread = Math.max(...vals) - Math.min(...vals);
console.log(`\n최선과 최악의 격차: ${spread.toFixed(1)}웨이브`);
const mapOk = spread >= 1.5;
console.log(
  mapOk
    ? "판정: 지도가 길을 가른다"
    : "판정: 지도가 결정이 아니다 — 어느 길로 가든 같은 곳에 도착한다",
);
// 미달이면 실패로 끝낸다. 관측만 하고 0을 반환하면 CI가 관측과 합격을
// 구분하지 못하고, 그러면 '측정으로 만든다'가 말뿐이 된다.
if (!mapOk) process.exitCode = 1;
