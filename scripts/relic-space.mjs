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
import { runSharded } from "./parallel.mjs";
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
// 지도 축을 섞지 않는다. 무작위 경로는 정예의 보장 유물을 "유물 안 삼"에도
// 주어 구매 정책 기준선을 오염시켰다. 지도 효과는 npm run map이 따로 재므로,
// 여기서는 모두 일반 전투로 고정해 유물을 살지·어느 직업에 맞출지만 비교한다.
const mapPick = MAP_POLICIES["전투만"];
const MAX_WAVE = 60;

/** 한 직업에 몰빵한다. 그 직업 유물이 나오면 최우선으로 산다. */
const focus = (cls, takeRelics = true) => (offers) => {
  const pool = takeRelics ? offers : offers.filter((o) => o.kind !== "relic");
  const relic = takeRelics && pool.find(
    (o) => o.kind === "relic" && o.relic?.condition.kind === "class_count" && o.relic.condition.cls === cls,
  );
  if (relic) return relic;
  return (
    pool.find((o) => o.kind === "recruit" && o.breed?.cls === cls) ??
    pool.find((o) => o.kind === "upgrade" && o.breed?.cls === cls) ??
    pool.find((o) => o.kind !== "relic" && o.kind !== "replace") ??
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
const FOCUS_CLASS = {
  "전사 몰빵": "warrior",
  "도적 몰빵": "rogue",
  "궁수 몰빵": "archer",
  "마법사 몰빵": "mage",
  "소환사 몰빵": "summoner",
};
const NO_RELIC_FOCUS = Object.fromEntries(
  Object.entries(FOCUS_CLASS).map(([name, cls]) => [`${name}:무유물`, focus(cls, false)]),
);
const EXPERIMENTS = { ...POLICIES, ...NO_RELIC_FOCUS };

function play(pick, seed, expectNoRelics = false) {
  const s = newRun(seed);
  const respond = makeBossBot();
  const shop = { rerolls: 0, lastWave: 0 };
  const finish = (wave) => {
    if (expectNoRelics && s.relics.length !== 0) {
      throw new Error(`유물 안 삼 기준선이 유물 ${s.relics.length}개를 보유했다 (시드 ${seed})`);
    }
    return wave;
  };
  for (let guard = 0; guard < MAX_WAVE * 4000; guard++) {
    if (s.phase === "gameover") return finish(s.wave);
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
      if (s.wave > MAX_WAVE) return finish(MAX_WAVE);
      // **유물을 읽고 배치를 고친다.** 자동 배치는 직업만 보므로 유물의 배치
      // 조건은 우연히만 맞는다. 이 한 줄이 없으면 조건이 결정이 아니라 운이고,
      // 그러면 여기서 재는 값이 사람이 겪는 것과 달라진다.
      arrangeForRelics(s);
      startBattle(s);
      if (s.phase !== "battle") return finish(s.wave);
      continue;
    }
    respond(s);
    stepBattle(s, 100);
  }
  return finish(s.wave);
}

const pct = (a, p) => a[Math.min(a.length - 1, Math.floor(a.length * p))];

console.log(`런 ${RUNS}회 · 배치·개입 정책 고정 · 구매 전략만 변경 · 시드 ${SEED0 + 1}~${SEED0 + RUNS}\n`);
console.log("전략                   최소  p10  p25  중앙값  p75  p90  최대   평균");
const means = {};
// 런은 워커에 나눠 돌리고(scripts/parallel.mjs) 원시 결과만 받는다. 집계는 아래 그대로다.
const sharded = await runSharded(
  import.meta.url,
  Object.keys(EXPERIMENTS),
  (name, seed) => play(EXPERIMENTS[name], seed, name === "유물 안 삼" || name.endsWith(":무유물")),
  { runs: RUNS, seed0: SEED0 },
);
for (const name of Object.keys(POLICIES)) {
  const raw = sharded[name].slice();
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

const vals = Object.values(means);
const spread = Math.max(...vals) - Math.min(...vals);
const noRelic = means["유물 안 삼"] ?? 0;
const focusRanking = focusNames.map((name) => [name, means[name] ?? 0]).sort((a, b) => b[1] - a[1]);
const [topName, bestFocus] = focusRanking[0];
const [, runnerUpFocus] = focusRanking[1];
const topGap = bestFocus - runnerUpFocus;
const minFocusGain = Math.min(...focusRanking.map(([, mean]) => mean - noRelic));

// 같은 직업 집중 정책에서 해당 유물을 살 수 있게/없게 한 실제 한계효과.
// 전체 빌드 격차만 재면 로스터 집중 효과를 유물 효과로 잘못 부를 수 있다.
const ABLATION_RUNS = RUNS;
const marginal = Object.fromEntries(focusNames.map((name) => {
  const mean = (rows) => rows.reduce((sum, wave) => sum + wave, 0) / rows.length;
  return [name, mean(sharded[name]) - mean(sharded[`${name}:무유물`])];
}));
const focusAblationMeans = Object.fromEntries(focusNames.map((name) => {
  const mean = (rows) => rows.reduce((sum, wave) => sum + wave, 0) / rows.length;
  return [name, {
    withRelic: mean(sharded[name]),
    withoutRelic: mean(sharded[`${name}:무유물`]),
  }];
}));
const marginalValues = Object.values(marginal);
const averageMarginal = marginalValues.reduce((sum, value) => sum + value, 0) / marginalValues.length;
const minMarginal = Math.min(...marginalValues);
const materialClasses = marginalValues.filter((value) => value >= 0.5).length;
const marginalPass = averageMarginal >= 0.5 && minMarginal >= -0.25 && materialClasses >= 3;
console.log(`\n최선과 최악의 격차: ${spread.toFixed(1)}웨이브`);
console.log(`유물을 안 사는 것(${noRelic.toFixed(1)}) 대비 최고 몰빵(${bestFocus.toFixed(1)}): ${(bestFocus - noRelic).toFixed(1)}웨이브`);
console.log(`빌드 다양성: 1위 ${topName}과 2위 격차 ${topGap.toFixed(1)} ≤ 1.5 · 모든 몰빵이 무유물보다 최소 ${minFocusGain.toFixed(1)} ≥ 1.0`);
console.log(`유물 택1 한계효과 ${ABLATION_RUNS}런/직업: ${Object.entries(marginal).map(([name, value]) => `${name.replace(" 몰빵", "")} ${value >= 0 ? "+" : ""}${value.toFixed(2)}`).join(" · ")}`);
console.log(`동일 빌드 on/off: ${Object.entries(focusAblationMeans).map(([name, value]) => `${name.replace(" 몰빵", "")} ${value.withRelic.toFixed(2)}/${value.withoutRelic.toFixed(2)}`).join(" · ")}`);
console.log(`유물 한계효과 관문: 평균 ${averageMarginal.toFixed(2)} ≥ 0.50 · 최소 ${minMarginal.toFixed(2)} ≥ -0.25 · 0.5+ 직업 ${materialClasses}/5 ≥ 3`);
/**
 * 기준 4.0웨이브는 빌드가 결과를 가르는 최소 효과다. 동시에 1위와 2위가
 * 1.5 안이고 모든 직업 몰빵이 무유물보다 1.0 이상 좋아야, 일부러 약한 기준선
 * 하나와 압도적 정답 하나를 넣어 폭만 키우는 우회를 막는다.
 */
const relicOk = bestFocus - noRelic >= 4.0 && topGap <= 1.5 && minFocusGain >= 1.0 && marginalPass;
console.log(
  relicOk
    ? "판정: 유물이 빌드를 가른다"
    : "판정: 유물이 빌드를 가르지 못한다 — 무엇을 사든 같은 곳에 도착한다",
);
if (!relicOk) process.exitCode = 1;
