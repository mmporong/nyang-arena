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
import { runSharded } from "./parallel.mjs";
import { newRun, startBattle } from "../src/game/run.ts";
import { makeBossBot, walkMap, leaveShop, shopStep, MAP_POLICIES } from "./bot-policy.mjs";

const RUNS = Number(process.argv[2] ?? 1500);
/**
 * 시드 오프셋. 잡음 바닥을 재려고 넣었다 — `relic-space`·`placement-space`와
 * 같은 이유다. 판정이 기준에 걸쳐 있을 때 그것이 신호인지 잡음인지는
 * 겹치지 않는 시드 블록으로 같은 코드를 다시 돌려야만 갈린다.
 */
const SEED0 = Number(process.argv[3] ?? 0);
const MAX_WAVE = 60;

function play(pick, seed) {
  const s = newRun(seed);
  const respond = makeBossBot();
  const seen = { battle: 0, elite: 0, shop: 0, boss: 0 };
  const shop = { rerolls: 0, lastWave: 0 };

  for (let guard = 0; guard < MAX_WAVE * 4000; guard++) {
    if (s.phase === "gameover") return { wave: s.wave, seen };
    if (s.phase === "reward") {
      // 구매 정책은 bot-policy의 shopStep 한 곳에만 있다. 이 파일도 제 사본을
      // 갖고 있었는데, 그런 사본이 balance-sim과 metrics-gen에서 조용히 갈려
      // 같은 코드에서 p25가 8과 9로 달라진 적이 있다. 무료 재추첨도 shopStep이
      // 처리한다 — 안 쓰면 상점 칸의 보상이 사라진 것과 같다.
      if (shopStep(s, shop) !== "leave") continue;
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
/** 시드별 결과. 평균이 아니라 **판마다 최선이 갈리는가**를 보려고 모은다. */
const perSeed = {};
// 런은 워커에 나눠 돌리고(scripts/parallel.mjs) 원시 결과만 받는다. 집계는 아래 그대로다.
const sharded = await runSharded(import.meta.url, Object.keys(MAP_POLICIES), (name, seed) => play(MAP_POLICIES[name], seed), { runs: RUNS, seed0: SEED0 });
for (const name of Object.keys(MAP_POLICIES)) {
  const out = [];
  const tally = { battle: 0, elite: 0, shop: 0, boss: 0 };
  perSeed[name] = [];
  for (let i = 0; i < RUNS; i++) {
    const r = sharded[name][i];
    out.push(r.wave);
    perSeed[name][i] = r.wave;
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
console.log(
  "  (잡음 바닥: 1500판에서 폭 0.4 — 같은 코드·다른 시드 블록으로 0.5 / 0.8 / 0.9.\n" +
    "   300판일 때는 0.7 / 1.9 / 0.6으로 폭 1.3이었고, 그 폭이 기준 1.5를 넘나들어\n" +
    "   **시드 블록 하나만 보면 통과로 읽히는 판**이 실제로 나왔다. 그래서 기본을\n" +
    "   1500판으로 올렸다. 판수를 줄여 재면 그만큼 판정을 믿을 수 없다)",
);

/**
 * 평균만 보면 "정찰이 제일 낫다"로 끝나고, 그게 사실이면 지도는 결정이 아니라
 * **정답**이다. 유물 축을 잴 때 쓴 것과 같은 방법으로 한 겹 더 본다 —
 * 시드마다 어느 길이 이겼는지, 그리고 판마다 최선을 골랐다면 어디까지 갔을지.
 *
 * 고정 최선과 신탁의 차이가 크면 "길이 안 갈린다"가 아니라 "**언제 어느 길인지**를
 * 게임이 안 알려준다"는 뜻이고, 그건 다른 문제이므로 다른 처방이 필요하다.
 */
const names = Object.keys(MAP_POLICIES).filter((n) => n !== "무작위");
const wins = Object.fromEntries(names.map((n) => [n, 0]));
let oracle = 0;
for (let i = 0; i < RUNS; i++) {
  let best = null;
  for (const n of names) if (best === null || perSeed[n][i] > perSeed[best][i]) best = n;
  wins[best] += 1;
  oracle += perSeed[best][i];
}
oracle /= RUNS;
const fixedBest = names.reduce((a, b) => (means[a] >= means[b] ? a : b));
console.log("\n시드마다 어느 길이 이겼나 — **해설이지 판정이 아니다**");
console.log("  (같은 정책을 다른 시드 블록에 돌려도 비슷한 숫자가 나온다. 순위통계라 전략의 증거가 못 된다)");
for (const n of names) {
  console.log(`  ${n.padEnd(12)} ${String(wins[n]).padStart(4)}판  ${((wins[n] / RUNS) * 100).toFixed(1)}%`);
}
console.log(`\n고정 최선(${fixedBest}) ${means[fixedBest].toFixed(1)}  ·  신탁 ${oracle.toFixed(1)}  ·  차이 ${(oracle - means[fixedBest]).toFixed(1)}웨이브`);
const topShare = Math.max(...Object.values(wins)) / RUNS;

/**
 * 판정은 **고정 정책의 평균 격차**로 한다.
 *
 * 한 번 신탁 기준(시드별 승자가 절반을 못 넘고 + 신탁 이득 1.5웨이브 이상)으로
 * 바꿨다가 되돌렸다. 실제 수치가 그럴듯했기 때문이다 — 승자가 전투 39% ·
 * 정예 31% · 정찰 31%로 갈리고 신탁 이득이 3.6웨이브였다. "어느 길로 가든 같은
 * 곳에 도착한다"가 아니라 "어느 길이 맞는지가 판마다 다르다"로 읽혔다.
 *
 * **귀무모형을 돌려 보니 틀렸다.** 같은 정책 하나를 겹치지 않는 시드 블록 셋에
 * 돌리면 셋 사이의 전략적 차이는 정의상 0인데, 그 기준이 **더 잘 통과했다** —
 * 최다 35.7% · 신탁 이득 4.48웨이브. 진짜 정책 셋(38.7% · 3.59)보다 높다.
 *
 * 이유는 이 게임의 구조에 있다. 도달 웨이브의 시드별 편차가 크고(평균 12에
 * 표준편차 5), `rng`가 런당 한 줄기라 **선택이 난수 소비 횟수를 바꾸는 순간
 * 그 뒤가 완전히 다른 런이 된다.** 그래서 같은 시드의 두 정책은 짝이 아니라
 * 독립 표본이고, "셋 중 최대"를 "하나의 평균"과 견주면 전략과 무관하게 항상
 * 몇 웨이브가 남는다. 순위통계를 전략으로 읽은 것이다.
 *
 * 평균 비교는 이 문제가 없다 — 300런이면 잡음이 상쇄된다. 그래서 관문은
 * 평균 격차로 두고, 신탁 줄은 **해설로만** 남긴다(유물 하네스도 같은 구조다 —
 * 거기서도 판정은 평균 차이가 하고 신탁은 곁들이는 말이다).
 *
 * 지금 지도는 0.7웨이브로 미달이다. 이 값 자체가 전에 적어 둔 1.4보다 나쁜데,
 * 그건 이 파일이 유료 재추첨을 안 쓰는 봇으로 재고 있었기 때문이다(위 shopStep
 * 주석 참고). 상점 칸의 무료 재추첨이 과대평가돼 있었다.
 */
const mapOk = spread >= 1.5;
console.log(
  mapOk
    ? "판정: 지도가 길을 가른다"
    : "판정: 지도가 결정이 아니다 — 어느 길로 가든 같은 곳에 도착한다",
);
// 미달이면 실패로 끝낸다. 관측만 하고 0을 반환하면 CI가 관측과 합격을
// 구분하지 못하고, 그러면 '측정으로 만든다'가 말뿐이 된다.
if (!mapOk) process.exitCode = 1;
