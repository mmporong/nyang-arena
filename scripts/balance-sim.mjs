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
import { buyOffer, newRun, rerollOffers, startBattle } from "../src/game/run.ts";

const RUNS = Number(process.argv[2] ?? 300);
const MAX_WAVE = 60;
const DT = 100;

function playOne() {
  const s = newRun();
  let rerolls = 0;
  let lastWave = 0;

  for (let guard = 0; guard < MAX_WAVE * 400; guard++) {
    if (s.phase === "gameover") return s.wave;

    if (s.phase === "reward") {
      // 살 수 있는 것 중 가장 비싼 것을 산다 (강화 우선이 되는 경향)
      const affordable = s.offers.filter((o) => o.cost <= s.gold)
        // 봇은 시너지 적합도를 판단하지 못하므로 교체가 순손실이다. 실제 플레이어는
        // 목표에 맞춰 쓰지만, 여기서는 다른 걸 못 살 때만 집는다.
        .sort((a, b) => (a.kind === "replace" ? 1 : 0) - (b.kind === "replace" ? 1 : 0) || b.cost - a.cost);
      if (affordable[0]) {
        const pick = affordable[0];
        const before = s.offers.length;
        // 구매 실패한 카드가 목록에 남으면 같은 카드를 무한히 재시도하게 된다.
        if (!buyOffer(s, pick) && s.offers.length === before) {
          s.offers = s.offers.filter((o) => o !== pick);
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
      startBattle(s);
      if (s.phase !== "battle") return s.wave; // 배치 불가 등
      continue;
    }

    stepBattle(s, DT);
  }
  return s.wave;
}

const results = [];
for (let i = 0; i < RUNS; i++) results.push(playOne());
results.sort((a, b) => a - b);

const q = (p) => results[Math.min(results.length - 1, Math.floor(results.length * p))];
const mean = results.reduce((a, b) => a + b, 0) / results.length;

console.log(`런 ${RUNS}회 (정책: 살 수 있으면 가장 비싼 것 구매, 재배치 없음)`);
console.log(`  최소 ${results[0]}  p25 ${q(0.25)}  중앙값 ${q(0.5)}  p75 ${q(0.75)}  최대 ${results[results.length - 1]}`);
console.log(`  평균 ${mean.toFixed(1)}웨이브`);

const hist = new Map();
for (const r of results) hist.set(r, (hist.get(r) ?? 0) + 1);
const bars = [...hist.entries()].sort((a, b) => a[0] - b[0]);
for (const [wave, n] of bars) {
  console.log(`  ${String(wave).padStart(2)}웨이브 ${"█".repeat(Math.ceil((n / RUNS) * 60))} ${n}`);
}

// 목표: 중앙값 8~15웨이브. 너무 짧으면 좌절, 너무 길면 한 판이 지루하다.
const med = q(0.5);
if (med < 6) console.log("\n판정: 너무 어렵다 (중앙값 6 미만)");
else if (med > 20) console.log("\n판정: 너무 쉽다 (중앙값 20 초과)");
else console.log("\n판정: 목표 구간(6~20) 안");
