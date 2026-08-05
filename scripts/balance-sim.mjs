/**
 * 밸런스 하네스 — 게임 로직을 브라우저 없이 그대로 돌려 도달 웨이브 분포를 잰다.
 *
 * 눈대중으로 난이도를 맞추면 반드시 틀린다. 실제로 첫 빌드는 웨이브 2에서
 * 전멸했는데, 화면만 봐서는 "적이 좀 센가?" 정도로만 보였다.
 *
 * 정책(policy)은 초보 플레이어를 흉내낸다: 살 수 있으면 첫 카드를 사고,
 * 배치는 건드리지 않는다. 즉 여기서 나온 수치는 '하한'이다.
 *
 * 실행: npm run sim
 */
import { stepBattle } from "../src/game/battle.ts";
import { buyOffer, newRun, relicActive, rerollOffers, startBattle, waveKind } from "../src/game/run.ts";
import { livingCats } from "../src/game/types.ts";

const RUNS = Number(process.argv[2] ?? 300);
const MAX_WAVE = 60;
const DT = 100;

/** 웨이브 성격별 시도/패배와 전투 길이. 보스 통과율이 개입 강도의 판정 기준이다. */
const tried = new Map();
const lost = new Map();
const battleMs = [];
const battleMsByKind = new Map();
// 보스는 웨이브별로 따로 센다. 첫 보스(5)는 기믹을 가르치는 자리라 성격이 다르다.
const bossTried = new Map();
const bossLost = new Map();

/**
 * @param seed 런마다 고정 시드를 준다. 없으면 같은 명령이 매번 다른 수치를 내고,
 *   그러면 밸런스 변경이 좋아진 것인지 노이즈인지 구분할 수 없다.
 */
function playOne(seed) {
  const s = newRun(seed);
  let rerolls = 0;
  let lastWave = 0;
  let kindAtStart = null;
  let waveAtStart = 0;
  let elapsedBeforeTick = 0;

  for (let guard = 0; guard < MAX_WAVE * 400; guard++) {
    if (s.phase === "gameover") {
      if (kindAtStart) lost.set(kindAtStart, (lost.get(kindAtStart) ?? 0) + 1);
      if (kindAtStart === "boss") bossLost.set(waveAtStart, (bossLost.get(waveAtStart) ?? 0) + 1);
      return s.wave;
    }

    if (s.phase === "reward") {
      // 살 수 있는 것 중 가장 비싼 것을 산다 (강화 우선이 되는 경향)
      const affordable = s.offers
        .filter((o) => o && o.cost <= s.gold)
        // 유물은 조건을 이미 채우고 있을 때만 산다. 조건은 카드에 적혀 있으므로
        // 이건 '카드를 읽는' 최소한의 플레이어다. 조건을 안 보고 사면 대가만
        // 쌓여서, 기준 봇이 무작위 구매보다 나빠진다(측정: 8.8 대 9.3).
        .filter((o) => o.kind !== "relic" || (o.relic ? relicActive(o.relic, livingCats(s.ally)) : false))
        // 봇은 시너지 적합도를 판단하지 못하므로 교체가 순손실이다. 실제 플레이어는
        // 목표에 맞춰 쓰지만, 여기서는 다른 걸 못 살 때만 집는다.
        .sort((a, b) => (a.kind === "replace" ? 1 : 0) - (b.kind === "replace" ? 1 : 0) || b.cost - a.cost);
      if (affordable[0]) {
        const pick = affordable[0];
        const before = s.offers.length;
        // 구매 실패한 카드가 목록에 남으면 같은 카드를 무한히 재시도하게 된다.
        if (!buyOffer(s, pick) && s.offers.length === before) {
          s.offers = s.offers.map((o) => (o === pick ? null : o));
        }
        continue;
      }
      // 살 게 없고 생선이 남으면 다시 뽑는다. 잉여를 전력으로 바꾸는 실제 플레이 방식.
      if (s.wave !== lastWave) {
        lastWave = s.wave;
        rerolls = 0;
      }
      if (rerolls < 4 && s.gold >= 12 && rerollOffers(s)) {
        rerolls += 1;
        continue;
      }
      s.phase = "prepare";
      continue;
    }

    if (s.phase === "prepare") {
      if (s.wave > MAX_WAVE) return s.wave;
      kindAtStart = waveKind(s.wave);
      tried.set(kindAtStart, (tried.get(kindAtStart) ?? 0) + 1);
      if (kindAtStart === "boss") {
        waveAtStart = s.wave;
        bossTried.set(s.wave, (bossTried.get(s.wave) ?? 0) + 1);
      }
      startBattle(s);
      if (s.phase !== "battle") return s.wave; // 배치 불가 등
      continue;
    }

    // 전투가 끝나는 틱에는 battleElapsed가 리셋될 수 있으므로 직전 값을 들고 있는다.
    elapsedBeforeTick = s.battleElapsed;
    stepBattle(s, DT);
    if (s.phase !== "battle") {
      const ms = elapsedBeforeTick + DT;
      battleMs.push(ms);
      const list = battleMsByKind.get(kindAtStart) ?? [];
      list.push(ms);
      battleMsByKind.set(kindAtStart, list);
    }
  }
  return s.wave;
}

const results = [];
for (let i = 0; i < RUNS; i++) results.push(playOne(i + 1));
results.sort((a, b) => a - b);

const q = (p) => results[Math.min(results.length - 1, Math.floor(results.length * p))];
const mean = results.reduce((a, b) => a + b, 0) / results.length;

console.log(`런 ${RUNS}회 (정책: 살 수 있으면 가장 비싼 것 구매, 재배치 없음 · 시드 1~${RUNS})`);
console.log(`  최소 ${results[0]}  p25 ${q(0.25)}  중앙값 ${q(0.5)}  p75 ${q(0.75)}  최대 ${results[results.length - 1]}`);
console.log(`  평균 ${mean.toFixed(1)}웨이브`);

const hist = new Map();
for (const r of results) hist.set(r, (hist.get(r) ?? 0) + 1);
const bars = [...hist.entries()].sort((a, b) => a[0] - b[0]);
for (const [wave, n] of bars) {
  console.log(`  ${String(wave).padStart(2)}웨이브 ${"█".repeat(Math.ceil((n / RUNS) * 60))} ${n}`);
}

console.log("\n웨이브 성격별 통과율");
for (const kind of ["mixed", "rush", "snipe", "boss"]) {
  const tn = tried.get(kind) ?? 0;
  const ln = lost.get(kind) ?? 0;
  if (tn === 0) continue;
  const pass = ((tn - ln) / tn) * 100;
  console.log(`  ${kind.padEnd(6)} 시도 ${String(tn).padStart(5)}  패배 ${String(ln).padStart(4)}  통과율 ${pass.toFixed(1).padStart(5)}%`);
}

battleMs.sort((a, b) => a - b);
const bq = (p) => (battleMs[Math.min(battleMs.length - 1, Math.floor(battleMs.length * p))] ?? 0) / 1000;
console.log("\n보스 웨이브별 통과율");
for (const w of [...bossTried.keys()].sort((a, b) => a - b).slice(0, 5)) {
  const tn = bossTried.get(w) ?? 0;
  const ln = bossLost.get(w) ?? 0;
  console.log(`  W${String(w).padStart(2)}  시도 ${String(tn).padStart(4)}  패배 ${String(ln).padStart(3)}  통과율 ${(((tn - ln) / tn) * 100).toFixed(1).padStart(5)}%`);
}

console.log("\n전투 길이 (초)");
for (const kind of ["mixed", "rush", "snipe", "boss"]) {
  const list = (battleMsByKind.get(kind) ?? []).slice().sort((a, b) => a - b);
  if (list.length === 0) continue;
  const k = (p) => (list[Math.min(list.length - 1, Math.floor(list.length * p))] / 1000).toFixed(1);
  console.log(`  ${kind.padEnd(6)} p50 ${String(k(0.5)).padStart(5)}  p90 ${String(k(0.9)).padStart(5)}  최대 ${(list[list.length - 1] / 1000).toFixed(1)}`);
}
console.log(`60웨이브 상한 도달: ${results.filter((r) => r > MAX_WAVE).length}건`);

// 목표: 중앙값 8~15웨이브. 너무 짧으면 좌절, 너무 길면 한 판이 지루하다.
const med = q(0.5);
if (med < 6) console.log("\n판정: 너무 어렵다 (중앙값 6 미만)");
else if (med > 20) console.log("\n판정: 너무 쉽다 (중앙값 20 초과)");
else console.log("\n판정: 목표 구간(6~20) 안");
