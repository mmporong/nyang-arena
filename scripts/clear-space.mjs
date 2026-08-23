/**
 * 스테이지 클리어율 — "무의식으로 하면 못 깨고, 조건에 맞게 하면 깬다"가 지켜지는가.
 *
 * 결정 축 하네스(구매·배치·개입·지도)는 축을 **하나씩** 바꿔 깊이를 잰다. 그런데 "게임이 적당히
 * 어려운가"는 축 하나가 아니라 **플레이 방식 전체**가 결과를 가르는지의 문제다. 그래서 여기서는
 * 네 축을 한꺼번에 묶은 봇 셋을 같은 시드로 돌려 스테이지별 클리어율을 본다.
 *
 *   무의식     무작위 구매 · 자동 배치 · 예고를 안 읽고 늘 산개 · 아무 길
 *   기본 봇    가장 비싼 것 · 자동 배치 · 사람 흉내(읽되 늦고 놓침) · 아무 길  ← balance-sim과 같다
 *   조건 충족  몰빵 피벗(로스터 읽음) · 세로로 분산(근접 앞 한 열) · 예고 읽음 · 읽고 고름
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
import { makeBossBot, walkMap, leaveShop, shopStep, MAP_POLICIES, BUY_POLICIES, ARRANGERS } from "./bot-policy.mjs";
import { BALANCE } from "../src/game/balance.ts";

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

const BOTS = {
  "무의식": {
    buy: BUY_POLICIES["무작위 구매"],
    place: null,
    respond: () => makeBossBot({ read: false }),
    map: MAP_POLICIES["무작위"],
  },
  "기본 봇": {
    buy: BUY_POLICIES["가장 비싼 것(현재)"],
    place: null,
    respond: () => makeBossBot(),
    map: MAP_POLICIES["무작위"],
  },
  "조건 충족": {
    buy: BUY_POLICIES["몰빵 피벗(로스터를 읽음)"],
    place: ARRANGERS["세로로 분산"],
    respond: () => makeBossBot(),
    map: MAP_POLICIES["읽고 고름"],
  },
};

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
      walkMap(s, bot.map);
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
  `런 ${RUNS}회 · 봇마다 구매·배치·개입·지도를 한꺼번에 고정 · 시드 ${SEED0 + 1}~${SEED0 + RUNS}` +
    (OVERRIDES.length ? `  · 덮어씀: ${OVERRIDES.join(" ")}` : "") +
    "\n",
);
console.log(`스테이지 k 클리어 = k번째 여정(${STAGE_STEPS}걸음·보스 둘)을 넘어 다음 지도에 들어섬\n`);
console.log("봇            도달 중앙값  p25  p75   S1 클리어  S2 클리어  S3 클리어  S4 클리어  보스에서 죽음");

const sharded = await runSharded(import.meta.url, Object.keys(BOTS), (name, seed) => play(BOTS[name], seed), { runs: RUNS, seed0: SEED0 });
const clear = {};
for (const name of Object.keys(BOTS)) {
  const rs = sharded[name];
  const waves = rs.map((r) => r.wave).sort((a, b) => a - b);
  const rates = [];
  for (let k = 1; k <= STAGES; k++) rates.push(rs.filter((r) => r.stage - 1 >= k).length / rs.length);
  clear[name] = rates;
  const bossDeath = rs.filter((r) => r.bossDeath).length / rs.length;
  console.log(
    `${name.padEnd(12)} ${String(pct(waves, 0.5)).padStart(8)} ${String(pct(waves, 0.25)).padStart(5)} ${String(pct(waves, 0.75)).padStart(4)}  ` +
      rates.map(fmt).join("   ") +
      `   ${fmt(bossDeath)}`,
  );
}

/**
 * 판정은 사전 등록 기준을 그대로 읽는다. 여기서는 **관측**이다 — measure-all의 OBSERVE에 들어가
 * 기록되지만 exit 코드로 관문을 빨갛게 만들지는 않는다. 난이도를 바꾼 뒤 이 표가 기준 안으로
 * 들어오면 그때 관문으로 올린다(이 주석을 고칠 것).
 */
const mindless = clear["무의식"];
const skilled = clear["조건 충족"];
const checks = [
  ["완주 게이트 조건÷무의식 ≥ 3배", mindless[2] > 0 ? skilled[2] / mindless[2] >= 3 : skilled[2] >= 0.2, mindless[2] > 0 ? skilled[2] / mindless[2] : Infinity],
  ["무의식 완주 S3 ≤ 20%", mindless[2] <= 0.2, mindless[2]],
  ["깊이 확대 격차 S2 ≥ 40%p", skilled[1] - mindless[1] >= 0.4, skilled[1] - mindless[1]],
  ["깊이 확대 격차 S3 ≥ 40%p", skilled[2] - mindless[2] >= 0.4, skilled[2] - mindless[2]],
  ["조건 충족 S1 ≥ 85%", skilled[0] >= 0.85, skilled[0]],
];
console.log("\n기준 대조 (완주가 결정을 가르는가 · 격차가 깊이에 따라 벌어지는가)");
let bad = 0;
for (const [label, ok, v] of checks) {
  if (!ok) bad += 1;
  const shown = Number.isFinite(v) && v > 3 && label.includes("배") ? `${v.toFixed(1)}배` : `${(v * 100).toFixed(1)}%`;
  console.log(`  ${ok ? "충족" : "미달"}  ${label.padEnd(24)} ${shown}`);
}
console.log(`  기록  무의식 S1 ${(mindless[0] * 100).toFixed(1)}% (장르 관행상 관대해도 됨 — 기준 없음)`);
console.log(
  bad === 0
    ? "\n판정: 난이도가 결정을 가른다 — 완주는 조건을 맞춰야 하고, 격차는 깊이에 따라 벌어진다"
    : `\n판정: 기준 ${bad}건 미달 — 결정 게이트가 약하다 (관측, 관문 아님)`,
);
