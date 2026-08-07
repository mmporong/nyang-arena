/**
 * 생선 곡선 — 버는 것과 쓰는 것.
 *
 * 밸런스를 보스 상수로만 잡아 왔는데, 그건 증상을 만지는 일일 수 있다. 판이
 * 끝나는 진짜 이유가 **경제의 모양**이라면 보스를 아무리 깎아도 같은 자리에서
 * 끝난다. 그래서 곡선 세 개를 웨이브별로 나란히 놓고 본다.
 *
 *   수입   웨이브마다 얼마나 들어오는가
 *   지출   무엇에 얼마를 쓰는가 (영입 / 강화 / 유물 / 재추첨)
 *   잔고   손에 남는가 (남으면 살 게 없다는 뜻, 마르면 성장이 멈춘다는 뜻)
 *
 * 그리고 **못 산 카드**를 센다. 생선이 모자라 지나친 카드가 많아지는 지점이
 * 곧 경제가 무너지는 지점이다.
 *
 * 실행: npm run gold
 */
import { stepBattle } from "../src/game/battle.ts";
import { BALANCE } from "../src/game/balance.ts";
import {
  buyOffer,
  newRun,
  rerollOffers,
  startBattle,
  unitCap,
  upgradeCost,
} from "../src/game/run.ts";
import { affordable, makeBossBot, walkMap, leaveShop, MAP_POLICIES } from "./bot-policy.mjs";

const RUNS = Number(process.argv[2] ?? 300);
const MAX_WAVE = 40;
const mapPick = MAP_POLICIES["무작위"];

/** 웨이브별 집계. 도달한 런만 세야 후반 표본이 왜곡되지 않는다. */
const stat = new Map();
function bump(wave, field, n = 1) {
  const cur = stat.get(wave) ?? { runs: 0, income: 0, spend: 0, held: 0, missed: 0, seen: 0, lv: 0, cats: 0 };
  cur[field] += n;
  stat.set(wave, cur);
}

const byCost = (a, b) => (a.kind === "replace" ? 1 : 0) - (b.kind === "replace" ? 1 : 0) || b.cost - a.cost;

function play(seed) {
  const s = newRun(seed);
  const respond = makeBossBot();
  let prevGold = s.gold;

  for (let guard = 0; guard < MAX_WAVE * 4000; guard++) {
    if (s.phase === "gameover") return s.wave;
    if (s.phase === "reward") {
      const w = s.wave;
      bump(w, "runs");
      // 들어온 양 = 지금 잔고 - 직전 잔고(전투 전). 음수면 상점 노드 등으로 이미 썼다.
      bump(w, "income", Math.max(0, s.gold - prevGold));

      // 이번 묶음에서 못 산 카드를 센다. 살 수 있었는데 안 산 것은 빼야
      // "생선이 모자랐다"만 남는다.
      for (const o of s.offers) {
        if (!o) continue;
        bump(w, "seen");
        if (o.cost > s.gold) bump(w, "missed");
      }

      const before = s.gold;
      for (let k = 0; k < 40; k++) {
        const aff = affordable(s);
        const pick = aff.length > 0 ? [...aff].sort(byCost)[0] : null;
        if (!pick) break;
        if (!buyOffer(s, pick)) s.offers = s.offers.map((o) => (o === pick ? null : o));
      }
      // balance-sim과 같은 재추첨 정책을 쓴다. 안 그러면 잔고가 부풀려져
      // "생선이 남는다"가 봇의 게으름인지 게임의 문제인지 갈리지 않는다.
      let rolls = 0;
      while (rolls < 4 && s.gold >= 12 && rerollOffers(s)) {
        rolls += 1;
        for (let k = 0; k < 40; k++) {
          const aff = affordable(s);
          const pick = aff.length > 0 ? [...aff].sort(byCost)[0] : null;
          if (!pick) break;
          if (!buyOffer(s, pick)) s.offers = s.offers.map((o) => (o === pick ? null : o));
        }
      }
      while (s.freeRerolls > 0) {
        rerollOffers(s);
        for (let k = 0; k < 40; k++) {
          const aff = affordable(s);
          const pick = aff.length > 0 ? [...aff].sort(byCost)[0] : null;
          if (!pick) break;
          if (!buyOffer(s, pick)) s.offers = s.offers.map((o) => (o === pick ? null : o));
        }
      }
      bump(w, "spend", before - s.gold);
      bump(w, "held", s.gold);

      const cats = s.ally.filter(Boolean);
      bump(w, "cats", cats.length);
      bump(w, "lv", cats.reduce((a, c) => a + c.level, 0) / Math.max(1, cats.length));

      leaveShop(s);
      prevGold = s.gold;
      continue;
    }
    if (s.phase === "map") {
      walkMap(s, mapPick);
      // 길이 주는 생선(정찰 +5)은 다음 상점의 '수입'으로 잡혀야 한다. 여기서
      // prevGold를 갱신하면 그 수입이 사라진다 — 그래서 갱신하지 않는다.
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

for (let i = 0; i < RUNS; i++) play(i + 1);

console.log(`런 ${RUNS}회 · 시드 1~${RUNS}\n`);
console.log("웨 도달 수입  지출  잔고  못산%  마리 평균Lv  강화값  적배수  플레이어/적");
const waves = [...stat.keys()].sort((a, b) => a - b);
for (const w of waves) {
  const m = stat.get(w);
  if (m.runs < 20) continue; // 표본이 적으면 노이즈다
  const inc = m.income / m.runs;
  const sp = m.spend / m.runs;
  const held = m.held / m.runs;
  const miss = m.seen > 0 ? (m.missed / m.seen) * 100 : 0;
  const cats = m.cats / m.runs;
  const lv = m.lv / m.runs;
  // 다음 강화 한 칸의 값과, 적이 그 사이 얼마나 세졌는지
  const nextUp = upgradeCost(Math.round(lv));
  const foe = Math.pow(BALANCE.enemyScale, w - 1);
  // 플레이어 전력 어림 = 마리수 x 레벨배수. 적 배수와 비율로 본다.
  const power = cats * Math.pow(BALANCE.levelScale, lv - 1);
  console.log(
    `${String(w).padStart(2)} ${String(m.runs).padStart(4)} ` +
      `${inc.toFixed(1).padStart(5)} ${sp.toFixed(1).padStart(5)} ${held.toFixed(1).padStart(5)} ` +
      `${miss.toFixed(0).padStart(5)}% ${cats.toFixed(1).padStart(5)} ${lv.toFixed(2).padStart(7)} ` +
      `${String(nextUp).padStart(6)} ${foe.toFixed(1).padStart(7)} ${(power / foe).toFixed(2).padStart(11)}`,
  );
}

console.log(`\n한도: 웨이브별 보유 상한 ${[1, 5, 10, 15, 20].map((w) => `W${w}=${unitCap(w)}`).join(" ")}`);
console.log(
  `수입 식: ${BALANCE.goldBase} + 웨이브 x ${BALANCE.goldPerWave} (선형)  ·  ` +
    `강화 비용: ${BALANCE.upgradeCostBase} x ${BALANCE.upgradeCostGrowth}^(Lv-1) (지수)  ·  ` +
    `적: ${BALANCE.enemyScale}^(웨이브-1) (지수)`,
);
