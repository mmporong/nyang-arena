/**
 * 개입이 값을 하는가?
 *
 * 회피 버튼이 장식인지 아닌지는 "누른 봇과 안 누른 봇의 보스 통과율 차이"로만
 * 알 수 있다. 개입은 보스전 전용이므로 전체 도달 웨이브가 아니라 **보스 웨이브
 * 통과율**을 주 지표로 본다.
 *
 * 동시에 상한도 잰다. 개입이 전체 중앙값을 크게 올리면 빌드와 배치를 덮은
 * 것이므로, 그건 성공이 아니라 다른 방식의 실패다.
 *
 * 봇은 브라우저와 **같은 경로**로 개입한다 — `state.pending`에 의도를 넣기만
 * 하고 판정은 전부 `stepBattle` 안에서 일어난다. 이 파리티가 깨지면 여기서 잰
 * 수치는 사람이 겪는 값이 아니게 된다.
 *
 * 실행: npm run intervention
 */
import { stepBattle } from "../src/game/battle.ts";
import { buyOffer, newRun, startBattle, waveKind } from "../src/game/run.ts";

const RUNS = Number(process.argv[2] ?? 300);
const MAX_WAVE = 60;
const DT = 100;

/** 지금 예고가 떠 있는가. 봇이 화면을 보는 것과 같은 정보다. */
function telegraphUp(state) {
  return state.enemy.some((c) => c?.telegraph);
}

const POLICIES = {
  "개입 없음": null,

  // 예고가 뜨자마자 누른다. 사람이 낼 수 있는 상한.
  "완벽 회피": () => true,

  // 예고가 뜨고 두 틱(200ms) 뒤에 누른다. 반응 시간을 흉내낸 것.
  "반응 200ms": (state, upFor) => upFor >= 2,

  // 반응이 늦고 네 번에 한 번은 놓친다. 결정적으로 놓치게 해야 시드가 의미를 갖는다.
  "사람 흉내": (state, upFor, seen) => seen % 4 !== 3 && upFor >= 3,
};

function play(policy, seed) {
  const s = newRun(seed);
  let kind = null;
  let wave = 0;
  let upFor = 0;
  let seen = 0;
  let wasUp = false;
  const boss = { tried: new Map(), lost: new Map() };

  for (let g = 0; g < MAX_WAVE * 2000; g++) {
    if (s.phase === "gameover") {
      if (kind === "boss") boss.lost.set(wave, (boss.lost.get(wave) ?? 0) + 1);
      return { final: s.wave, boss };
    }
    if (s.phase === "reward") {
      const afford = s.offers
        .filter((o) => o && o.cost <= s.gold)
        .sort((a, b) => (a.kind === "replace" ? 1 : 0) - (b.kind === "replace" ? 1 : 0) || b.cost - a.cost);
      if (afford[0]) {
        if (!buyOffer(s, afford[0])) s.offers = s.offers.map((o) => (o === afford[0] ? null : o));
        continue;
      }
      s.phase = "prepare";
      continue;
    }
    if (s.phase === "prepare") {
      if (s.wave > MAX_WAVE) return { final: MAX_WAVE, boss };
      kind = waveKind(s.wave);
      wave = s.wave;
      if (kind === "boss") boss.tried.set(wave, (boss.tried.get(wave) ?? 0) + 1);
      upFor = 0;
      wasUp = false;
      startBattle(s);
      if (s.phase !== "battle") return { final: s.wave, boss };
      continue;
    }

    if (policy) {
      const up = telegraphUp(s);
      if (up && !wasUp) {
        seen += 1;
        upFor = 0;
      }
      wasUp = up;
      if (up) {
        upFor += 1;
        if (s.dodgeCharges > 0 && policy(s, upFor, seen)) s.pending.push({ kind: "dodge" });
      }
    }

    stepBattle(s, DT);
  }
  return { final: s.wave, boss };
}

const pct = (a, p) => a[Math.min(a.length - 1, Math.floor(a.length * p))];

console.log(`런 ${RUNS}회 · 구매·배치 정책 고정 · 개입만 변경 · 시드 1~${RUNS}\n`);
console.log("정책          보스통과율   W5      W10     전체중앙값   평균");

const base = {};
for (const [name, policy] of Object.entries(POLICIES)) {
  const finals = [];
  const tried = new Map();
  const lost = new Map();
  for (let i = 0; i < RUNS; i++) {
    const r = play(policy, i + 1);
    finals.push(r.final);
    for (const [w, n] of r.boss.tried) tried.set(w, (tried.get(w) ?? 0) + n);
    for (const [w, n] of r.boss.lost) lost.set(w, (lost.get(w) ?? 0) + n);
  }
  finals.sort((a, b) => a - b);
  const sum = (m) => [...m.values()].reduce((a, b) => a + b, 0);
  const all = sum(tried);
  const pass = all ? ((all - sum(lost)) / all) * 100 : 0;
  const rate = (w) => {
    const t = tried.get(w) ?? 0;
    const l = lost.get(w) ?? 0;
    return t ? `${(((t - l) / t) * 100).toFixed(1)}%` : "  -  ";
  };
  const avg = finals.reduce((a, b) => a + b, 0) / finals.length;
  if (name === "개입 없음") {
    base.pass = pass;
    base.avg = avg;
  }
  console.log(
    `${name.padEnd(12)} ${pass.toFixed(1).padStart(8)}% ${rate(5).padStart(8)} ${rate(10).padStart(8)} ` +
      `${String(pct(finals, 0.5)).padStart(10)} ${avg.toFixed(1).padStart(7)}`,
  );
}

console.log("\n판정");
for (const [name, policy] of Object.entries(POLICIES)) {
  if (!policy) continue;
}
console.log(`  기준선(개입 없음) 보스 통과율 ${base.pass.toFixed(1)}%`);
console.log("  AC-B1: 비개입 통과율이 75~85% 구간 →", base.pass >= 75 && base.pass <= 85 ? "충족" : "미충족");
console.log("  AC-B2: 개입 시 +15~25%p / AC-B3: 전체 중앙값 상승 +3 이하 (위 표에서 확인)");
