/**
 * 스테이지 클리어율 — "무의식으로 하면 못 깨고, 조건에 맞게 하면 깬다"가 지켜지는가.
 *
 * 결정 축 하네스는 축을 하나씩 바꿔 깊이를 잰다. 여기서는 두 패널을 같은 시드로 함께 돌린다.
 *
 * 1. 2026-08-23 네 축 기준 적용: 구매·배치·개입·지도만 바꾸고 계약은 모두 안전 정책으로 통제한다.
 * 2. 현재 다섯 축 통합 관찰: 세 페르소나가 보상/안전/팀 맞춤 계약까지 서로 다르게 고른다.
 *
 * 두 번째 패널은 여러 축을 동시에 바꾸므로 계약의 독립 인과 효과가 아니다. 그 판정은 구매·전투를
 * 통제하는 contract-space만 담당한다. 기존 네 축 임계값도 두 번째 패널에는 적용하지 않는다.
 *
 * 스테이지 k 클리어 = 그 스테이지의 두 번째 보스를 넘어 다음 스테이지 지도에 들어섰다
 * (`map.stage − 1 ≥ k`). 웨이브 번호로 세지 않는 이유: 상점 칸은 걸음만 먹고 웨이브는 안 먹어서
 * 같은 스테이지라도 웨이브가 다르다.
 *
 * **기준(2026-08-23)** — 관측이고 관문은 아니다. 처음엔 "무의식 S1 ≤ 40%"로 잡았다가 측정으로
 * 되잡았다: 스윕을 돌려 보니 첫 스테이지를 무의식이 못 넘게 만드는 손잡이는 `enemyScale`(양쪽을 다
 * 죽여 조건 충족 완주가 80%→27%로 붕괴)과 `bossHpMulFirst`(첫 보스를 벽으로 — balance.ts가 "보스는
 * 벽이 아니라 사건"이라며 명시적으로 거부한 방향)뿐이었다. 짧은 첫 스테이지는 로스터·유물이 아직
 * 안 쌓여 결정으로 가를 수가 없고, 그래서 **게이트는 깊이에 산다** — 이게 이 장르의 정석이다(StS도
 * 1막은 초보가 대개 넘고, 완주가 실력을 가른다). 그래서 기준을 올바른 성질로 바꾼다:
 *   완주 게이트   조건 충족 S3 ≥ 무의식 S3 × 3  ·  무의식 S3 ≤ 20%   (무의식은 어쩌다 운으로만 완주)
 *   깊이 확대     (조건 충족 − 무의식) 격차가 S2 ≥ 40%p · S3 ≥ 40%p   (아래로 갈수록 벌어진다)
 *   조건 충족     S1 ≥ 85%                                          (조건을 맞추면 첫 스테이지는 안정)
 *   무의식 S1     기록만 — 장르 관행상 관대해도 된다(첫 막은 초보 관문이 아니다)
 *
 * 실행: npm run clear [런 수] [시드 오프셋]
 */
import { stepBattle } from "../src/game/battle.ts";
import { newRun, startBattle } from "../src/game/run.ts";
import { STAGE_STEPS } from "../src/game/map.ts";
import { runSharded } from "./parallel.mjs";
import { walkMap, leaveShop, shopStep } from "./bot-policy.mjs";
import { BALANCE } from "../src/game/balance.ts";
import { CLEAR_BASELINE_BOTS, CLEAR_INTEGRATED_BOTS } from "./clear-bots.mjs";
import { evaluateClearCriteria } from "./clear-criteria.mjs";

const ARGS = process.argv.slice(2);
const NUMS = ARGS.filter((a, i) => !a.startsWith("--") && ARGS[i - 1] !== "--set");
/**
 * `--set key=value` — 난이도 손잡이 스윕용. BALANCE의 숫자 항목을 이 프로세스(와 워커)에서만 덮어쓴다.
 * 예: npm run clear -- 600 0 --set enemyScale=1.32 --set bossHpMulFirst=80
 * 채택은 여기서 하지 않는다 — 표를 보고 balance.ts를 고친 뒤 verify를 다시 돈다.
 */
const OVERRIDES = [];
for (let i = 0; i < ARGS.length; i++) {
  if (ARGS[i] !== "--set") continue;
  const [k, v] = String(ARGS[i + 1] ?? "").split("=");
  if (!(k in BALANCE) || !Number.isFinite(Number(v))) throw new Error(`--set ${ARGS[i + 1]}: BALANCE에 없는 키이거나 숫자가 아니다`);
  BALANCE[k] = Number(v);
  OVERRIDES.push(`${k}=${v}`);
}
const RUNS = Number(NUMS[0] ?? 600);
const SEED0 = Number(NUMS[1] ?? 0);
const MAX_WAVE = 60;
const STAGES = 4;

const PANELS = Object.freeze([
  Object.freeze({ id: "baseline", title: "4축 기준 적용", bots: CLEAR_BASELINE_BOTS }),
  Object.freeze({ id: "integrated", title: "5축 통합 관찰", bots: CLEAR_INTEGRATED_BOTS }),
]);
const botKey = (panel, name) => `${panel.id}/${name}`;
const BOTS = Object.freeze(
  Object.fromEntries(PANELS.flatMap((panel) => Object.entries(panel.bots).map(([name, bot]) => [botKey(panel, name), bot]))),
);

function play(bot, seed) {
  const s = newRun(seed);
  const respond = bot.respond();
  const shop = { rerolls: 0, lastWave: 0 };
  for (let guard = 0; guard < MAX_WAVE * 4000; guard++) {
    if (s.phase === "gameover") {
      return { wave: s.wave, stage: s.map.stage, bossDeath: !!s.killer?.boss, capped: false };
    }
    if (s.phase === "reward") {
      if (shopStep(s, shop, bot.buy) !== "leave") continue;
      leaveShop(s);
      continue;
    }
    if (s.phase === "map") {
      walkMap(s, bot.map, bot.contract);
      continue;
    }
    if (s.phase === "prepare") {
      if (s.wave > MAX_WAVE) return { wave: MAX_WAVE, stage: STAGES + 1, bossDeath: false, capped: true };
      if (bot.place) bot.place(s);
      startBattle(s);
      if (s.phase !== "battle") return { wave: s.wave, stage: s.map.stage, bossDeath: false, capped: false };
      continue;
    }
    respond(s);
    stepBattle(s, 100);
  }
  return { wave: s.wave, stage: s.map.stage, bossDeath: false, capped: false };
}

const pct = (a, p) => a[Math.min(a.length - 1, Math.floor(a.length * p))];
const fmt = (x) => `${(x * 100).toFixed(1)}%`.padStart(7);

console.log(
  `패널별 런 ${RUNS}회 · 같은 시드 ${SEED0 + 1}~${SEED0 + RUNS}` +
    (OVERRIDES.length ? `  · 덮어씀: ${OVERRIDES.join(" ")}` : "") +
    "\n",
);
console.log(`스테이지 k 클리어 = k번째 여정(${STAGE_STEPS}걸음·보스 둘)을 넘어 다음 지도에 들어섬\n`);

const sharded = await runSharded(import.meta.url, Object.keys(BOTS), (name, seed) => play(BOTS[name], seed), { runs: RUNS, seed0: SEED0 });
function printPanel(panel) {
  console.log(`── ${panel.title} ──`);
  console.log(`계약 선택 · ${Object.entries(panel.bots).map(([name, bot]) => `${name}=${bot.contractLabel}`).join(" · ")}`);
  console.log("봇            도달 중앙값  p25  p75   S1 클리어  S2 클리어  S3 클리어  S4 클리어  보스에서 죽음");
  const clear = {};
  for (const name of Object.keys(panel.bots)) {
    const rs = sharded[botKey(panel, name)];
    const waves = rs.map((r) => r.wave).sort((a, b) => a - b);
    const counts = [];
    for (let k = 1; k <= STAGES; k++) counts.push(rs.filter((r) => r.stage - 1 >= k).length);
    const rates = counts.map((count) => count / rs.length);
    clear[name] = { counts, rates, runs: rs.length };
    const bossDeath = rs.filter((r) => r.bossDeath).length / rs.length;
    console.log(
      `${name.padEnd(12)} ${String(pct(waves, 0.5)).padStart(8)} ${String(pct(waves, 0.25)).padStart(5)} ${String(pct(waves, 0.75)).padStart(4)}  ` +
        rates.map(fmt).join("   ") +
        `   ${fmt(bossDeath)}`,
    );
  }
  console.log();
  return clear;
}
const baselineClear = printPanel(PANELS[0]);
printPanel(PANELS[1]);
console.log("5축 패널 판정 없음 — 여러 축을 함께 바꾼 제품 페르소나 관찰이며, 계약 독립 효과는 npm run contracts가 판정");

/**
 * 2026-08-23의 기준은 계약 도입 전 네 축 봇에 정의됐다. 그러므로 계약을 동일하게 통제한 첫 패널만
 * 대조한다. 여기서는 관측이다 — measure-all의 OBSERVE에 기록되지만 exit 코드로 관문을 바꾸지 않는다.
 */
const mindless = baselineClear["무의식"];
const skilled = baselineClear["조건 충족"];
const checks = evaluateClearCriteria(mindless, skilled);
console.log("\n4축 기준 대조 (계약 동일 통제 · 완주가 결정을 가르는가)");
let bad = 0;
for (const [label, ok, v] of checks) {
  if (!ok) bad += 1;
  const shown = label.includes("배")
    ? Number.isFinite(v) ? `${v.toFixed(1)}배` : "∞배"
    : `${(v * 100).toFixed(1)}%`;
  console.log(`  ${ok ? "충족" : "미달"}  ${label.padEnd(24)} ${shown}`);
}
console.log(`  기록  무의식 S1 ${(mindless.rates[0] * 100).toFixed(1)}% (장르 관행상 관대해도 됨 — 기준 없음)`);
console.log(
  bad === 0
    ? "\n관측: 현재 제품이 2026-08-23 네 축 기준을 충족한다"
    : `\n관측: 2026-08-23 네 축 기준 ${bad}건 미달 (관문 아님)`,
);
