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
import { arrangeForRelics, makeBossBot, walkMap, leaveShop, shopStep, MAP_POLICIES } from "./bot-policy.mjs";

const RUNS = Number(process.argv[2] ?? 2000);
/**
 * 시드 오프셋. **잡음 바닥을 재려고 넣었다.**
 *
 * 유물 목록을 건드리면 오퍼 생성이 난수를 다르게 먹어 같은 시드가 완전히
 * 다른 판이 된다. 그래서 '유물 안 삼'처럼 유물을 한 장도 안 사는 정책의
 * 평균조차 변경마다 11.3~12.7로 흔들렸다. 겹치지 않는 시드 블록으로 같은
 * 코드를 두 번 돌리면, 그 흔들림 중 **코드와 무관한 몫**이 얼마인지 나온다.
 * 그 폭보다 작은 차이는 근거로 쓰지 않는다.
 */
const SEED0 = Number(process.argv[3] ?? 0);
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

/**
 * 소수정예 — **다섯 마리에서 영입을 멈춘다.**
 *
 * 다른 정책이 못 보는 것을 보려고 넣었다. 실측에서 보유 마릿수가 웨이브
 * 1~16 내내 한도와 같았고(98~100%), 여섯 정책이 전부 한도까지 채웠다.
 * 그러면 '적게 데리고 다니기'를 조건으로 삼는 유물은 **한 번도 켜지지
 * 않고**, 켜지지 않는 것의 값은 잴 수 없다.
 *
 * 재지 못한 것을 깊이로 주장하지 않는다는 원칙의 반대편이다 — 새 축을
 * 만들었으면 그 축을 밟는 정책도 같이 만들어야 측정이 정직해진다.
 *
 * **결과는 부정이었고, 그래서 목록에서 뺐다.** 평균 8.6으로 직업
 * 몰빵(14.5)에 5.9웨이브 뒤진다. 그냥 나쁜 정책이라, 목록에 두면
 * '최선과 최악의 격차'만 3.3 → 5.9로 부풀린다 — 지도 축에서 순위
 * 통계를 전략으로 읽었던 것과 같은 함정이다. 나쁜 선택지를 더해서
 * 넓어진 폭은 깊이가 아니다. 되살리려면 `POLICIES`에 다시 넣으면 된다.
 */
const fewElite = (offers, s) => {
  const owned = s.ally.filter(Boolean).length;
  const pool = owned >= 5 ? offers.filter((o) => o.kind !== "recruit") : offers;
  return (
    pool.find((o) => o.kind === "relic") ??
    pool.filter((o) => o.kind === "upgrade").sort(byCost)[0] ??
    [...pool].sort(byCost)[0] ??
    null
  );
};

const POLICIES = {
  "유물 안 삼": (a) => [...a].filter((o) => o.kind !== "relic").sort(byCost)[0],
  "균형 (가장 비싼 것)": (a) => [...a].sort(byCost)[0],
  "전사 몰빵": focus("warrior"),
  "도적 몰빵": focus("rogue"),
  "궁수 몰빵": focus("archer"),
  "마법사 몰빵": focus("mage"),
  "소환사 몰빵": focus("summoner"),
};

function play(pick, seed) {
  const s = newRun(seed);
  const respond = makeBossBot();
  const shop = { rerolls: 0, lastWave: 0 };
  for (let guard = 0; guard < MAX_WAVE * 4000; guard++) {
    if (s.phase === "gameover") return s.wave;
    if (s.phase === "reward") {
      // 구매 정책은 bot-policy의 shopStep 한 곳에만 있다. 이 파일도 사본을
      // 갖고 있었고, 그 사본이 `rolls < 4 && s.gold >= 12`로 재추첨을 막아
      // **무료 재추첨을 놓쳤다** — 무료분은 생선이 필요 없는데 생선 조건이
      // 먼저 걸린다. 상점 칸의 보상이 조용히 사라지는 자리였다.
      // 실험 대상인 몰빵 정책만 `pick`으로 끼워 넣는다.
      if (shopStep(s, shop, pick) !== "leave") continue;
      leaveShop(s);
      continue;
    }
    if (s.phase === "map") {
      walkMap(s, mapPick);
      continue;
    }
    if (s.phase === "prepare") {
      if (s.wave > MAX_WAVE) return MAX_WAVE;
      // **유물을 읽고 배치를 고친다.** 자동 배치는 직업만 보므로 유물의 배치
      // 조건은 우연히만 맞는다. 이 한 줄이 없으면 조건이 결정이 아니라 운이고,
      // 그러면 여기서 재는 값이 사람이 겪는 것과 달라진다.
      arrangeForRelics(s);
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

console.log(`런 ${RUNS}회 · 배치·개입 정책 고정 · 구매 전략만 변경 · 시드 ${SEED0 + 1}~${SEED0 + RUNS}\n`);
console.log("전략                   최소  p10  p25  중앙값  p75  p90  최대   평균");
const means = {};
/** 시드 순서를 유지한 원본. 정렬본으로는 시드별 짝비교를 할 수 없다. */
const bySeed = {};
for (const [name, pick] of Object.entries(POLICIES)) {
  const raw = [];
  for (let i = 0; i < RUNS; i++) raw.push(play(pick, SEED0 + i + 1));
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
/**
 * 몰빵 정책 이름. **`POLICIES`에서 뽑는다 — 손으로 적으면 안 된다.**
 *
 * 전에는 네 직업을 손으로 적어 뒀는데, 다섯 번째 직업(소환사)을 `POLICIES`에
 * 넣고 이 줄을 못 고쳤다. 그래서 소환사 몰빵은 **돌기는 하는데 승수 집계에도
 * 신탁에도, 그리고 관문 판정(`bestFocus`)에도 한 번도 안 들어갔다** — 표에는
 * 뜨는데 "어느 몰빵이 이겼나"의 합이 RUNS와 맞아떨어져서 눈으로는 안 걸린다.
 *
 * 게임 쪽은 `everyClass`/`CLASS_ORDER`로 같은 실수를 타입이 막지만
 * (`src/game/types.ts`), 하네스는 `.mjs`라 그 보호가 안 닿는다. 그러니 여기서는
 * 목록을 손으로 적지 않는 것이 유일한 방어다.
 */
const focusNames = Object.keys(POLICIES).filter((n) => n.endsWith(" 몰빵"));
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
const bestFocus = Math.max(...focusNames.map((n) => means[n] ?? 0));
console.log(`\n최선과 최악의 격차: ${spread.toFixed(1)}웨이브`);
console.log(`유물을 안 사는 것(${noRelic.toFixed(1)}) 대비 최고 몰빵(${bestFocus.toFixed(1)}): ${(bestFocus - noRelic).toFixed(1)}웨이브`);
// **잡음 바닥.** 같은 코드를 겹치지 않는 시드 블록 셋에 300판씩 돌린 결과다
// (시드 1~300 · 301~600 · 601~900). 코드가 한 줄도 안 바뀌었는데 이만큼
// 흔들린다 — 명단이나 유물 목록을 건드리면 오퍼 생성이 난수를 다르게 먹어
// 같은 시드가 완전히 다른 판이 되기 때문이다.
//
//   고양이 8종:  3.3 / 3.0 / 3.5   (폭 0.5)
//   고양이 12종: 2.5 / 3.4 / 2.8   (폭 0.9)
//
// 두 밴드가 크게 겹치므로 **8종에서 12종으로 늘린 것이 이 축을 바꿨다고 말할
// 수 없다.** 평균은 3.3에서 2.9로 내려갔지만 그 차이가 폭 안이다.
//
// 이것이 과거 보너스 배율 스윕(1.15~1.45)이 3.2~4.0을 무작위로 오간 이유다.
// 그 폭 전체가 잡음 안이었고, 거기서 고른 값에는 근거가 없었다.
// **0.5웨이브 미만의 차이는 근거로 쓰지 말 것.** 그보다 작은 것을 보려면
// 시드를 늘려서(`npm run relics 900`) 다시 잴 것.
console.log(
  "  (잡음 바닥: 2000판에서 폭 0.2 — 같은 코드·다른 시드 블록으로 2.7 / 2.9 / 2.9.\n" +
    "   300판에서는 2.8 / 2.1 / 2.9로 폭 0.8이었다. 즉 이 축의 실제 값은 2.8쯤이고\n" +
    "   기준 4.0에 확실히 못 미친다 — 예전 배율 스윕이 3.2~4.0을 오간 것은 전부\n" +
    "   300판의 잡음이었다.\n" +
    "\n" +
    "   ** 이 문단은 2026-08-18 실측과 어긋난다.** 같은 2000판에서 4.9가 나왔고\n" +
    "   관문도 통과했다. 소환사를 넣어 직업이 5종이 되면서 마법사 몰빵이 16.3까지\n" +
    "   오른 것이 원인으로 보이지만, 블록 하나로는 못 뒤집는다 — 위의 2.7/2.9/2.9는\n" +
    "   겹치지 않는 세 블록에서 나온 값이다. 셋을 다시 재기 전에는 어느 쪽도 인용하지 말 것)",
);
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
