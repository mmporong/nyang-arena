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
import { walkMap, MAP_POLICIES } from "./bot-policy.mjs";
import { stepBattle } from "../src/game/battle.ts";
import { livingCats } from "../src/game/types.ts";
import { buyOffer, newRun, startBattle, waveKind , relicActive, currentKind } from "../src/game/run.ts";

const RUNS = Number(process.argv[2] ?? 300);
// 지도는 아무 길이나 간다. 이 스크립트가 재는 축이 아니므로 고정하지 않는다.
const mapPick = MAP_POLICIES["무작위"];
const MAX_WAVE = 60;
const DT = 100;

/** 지금 예고가 떠 있는가. 봇이 화면을 보는 것과 같은 정보다. */
function telegraphUp(state) {
  return state.enemy.some((c) => c?.telegraph);
}

/** 취약 창이 열려 있는가. 이때 버튼은 약점 공격이 된다. */
function windowOpen(state) {
  return state.enemy.some((c) => c?.alive && c.vulnerableMs > 0);
}

/** 지금 떠 있는 예고가 요구하는 것. 장판 색이 알려주는 정보와 같다. */
function telegraphMode(state) {
  const c = state.enemy.find((x) => x?.telegraph);
  return c?.telegraph?.mode ?? null;
}

const POLICIES = {
  "개입 없음": null,

  // 회피와 약점을 갈라 잰다. 둘 중 무엇이 값을 하는지 모르면 어느 쪽을
  // 다듬어야 하는지도 모른다.
  "회피만": { dodge: () => true, strike: false, read: true },
  "약점만": { dodge: () => false, strike: true, read: true },
  // 장판 색을 안 읽고 늘 탭만 한다. 뭉침 예고에도 흩어지므로 벌을 받는다.
  "늘 탭만": { dodge: () => true, strike: true, read: false },
  // 반대로 읽는다. 규칙을 거꾸로 배운 플레이어.
  "거꾸로 읽음": { dodge: () => true, strike: true, read: "invert" },

  // 예고가 뜨자마자 누른다. 사람이 낼 수 있는 상한.
  "완벽(읽고 판단)": { dodge: () => true, strike: true, read: true },

  // 반응이 늦고 네 번에 한 번은 놓친다. 결정적으로 놓치게 해야 시드가 의미를 갖는다.
  "사람 흉내": { dodge: (upFor, seen) => seen % 4 !== 3 && upFor >= 3, strike: true, read: true },
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
        // 유물은 조건을 채우고 있을 때만. 카드를 읽는 최소한의 플레이어.
        .filter((o) => o.kind !== "relic" || (o.relic ? relicActive(o.relic, livingCats(s.ally)) : false))
        .sort((a, b) => (a.kind === "replace" ? 1 : 0) - (b.kind === "replace" ? 1 : 0) || b.cost - a.cost);
      if (afford[0]) {
        if (!buyOffer(s, afford[0])) s.offers = s.offers.map((o) => (o === afford[0] ? null : o));
        continue;
      }
      walkMap(s, mapPick);
      continue;
    }
    if (s.phase === "prepare") {
      if (s.wave > MAX_WAVE) return { final: MAX_WAVE, boss };
      kind = currentKind(s);
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
      // 창이 열리면 무조건 연타한다. 창 자체가 3초로 제한돼 있으므로
      // '얼마나 누를까'는 결정이 아니고 '놓치지 않는가'만 남는다.
      if (windowOpen(s)) {
        if (policy.strike) s.pending.push({ kind: "strike" });
      } else if (up) {
        upFor += 1;
        if (s.dodgeCharges > 0 && policy.dodge(upFor, seen)) {
          const need = telegraphMode(s);
          const kind =
            policy.read === false
              ? "dodge" // 색을 안 읽고 늘 탭
              : policy.read === "invert"
                ? need === "gather"
                  ? "dodge"
                  : "gather"
                : need === "gather"
                  ? "gather"
                  : "dodge";
          s.pending.push({ kind });
        }
      }
    }

    stepBattle(s, DT);
  }
  return { final: s.wave, boss };
}

const pct = (a, p) => a[Math.min(a.length - 1, Math.floor(a.length * p))];

console.log(`런 ${RUNS}회 · 구매·배치 정책 고정 · 개입만 변경 · 시드 1~${RUNS}\n`);
console.log("정책          보스통과율   W3      W6      전체중앙값   평균");

const base = {};
const results = {};
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
  const median = pct(finals, 0.5);
  results[name] = { pass, avg, median };
  if (name === "개입 없음") {
    base.pass = pass;
    base.avg = avg;
    base.median = median;
  }
  console.log(
    `${name.padEnd(12)} ${pass.toFixed(1).padStart(8)}% ${rate(3).padStart(8)} ${rate(6).padStart(8)} ` +
      `${String(pct(finals, 0.5)).padStart(10)} ${avg.toFixed(1).padStart(7)}`,
  );
}

console.log("\n판정");
for (const [name, policy] of Object.entries(POLICIES)) {
  if (!policy) continue;
}
/**
 * 합격 판정.
 *
 * **옛 기준(AC-B1 비개입 75~85%, AC-B2 이득 +15~25%p)은 폐기했다.** 측정으로
 * 양립 불가임이 확정됐기 때문이다.
 *
 *   telegraphDmg  비개입 보스   개입 이득    전체 중앙값
 *   1.15            35.0%      +48.5%p        12
 *   0.60            58.3%      +35.5%p        25
 *   0.35            75.5%      +22.5%p        (약 40)
 *   0.28            81.1%      +17.9%p        43
 *
 * 비개입 통과율을 75~85%로 올리면 개입까지 얹은 실제 플레이는 보스 통과율이
 * 98.9%가 되고, **보스가 판을 끝내지 못해 중앙값이 43으로 간다.** 목표 구간
 * (10~15)과 함께 성립할 수 없다. 옛 기준은 보스가 다섯 웨이브마다 오고 판이
 * 끝나는 이유가 지금과 달랐던 시절에 정해진 것이다.
 *
 * 그 기준이 **정말로 지키려던 것**은 따로 있다 — "실행 실력이 빌드와 배치
 * 결정을 덮으면 안 된다". 그건 개입의 크기가 아니라 **다른 축이 살아 있는지**로
 * 직접 재는 것이 맞다. 그래서 새 기준은 이렇다.
 *
 *   B1  비개입 보스 통과율 >= 25%   개입이 필수 관문이 되면 안 된다
 *   B2  유물 축 >= 4.0웨이브        빌드가 여전히 결과를 가른다 (npm run relics)
 *   B3  배치 축 >= 2.0웨이브        배치가 여전히 결과를 가른다 (npm run placement)
 *
 * B2·B3는 이 스크립트가 재지 않으므로 여기서는 B1만 판정하고, 나머지는
 * 각자의 스크립트가 자기 종료 코드로 말한다.
 */
const perfect = results["완벽(읽고 판단)"];
const human = results["사람 흉내"];
const gain = perfect ? perfect.pass - base.pass : 0;
const ac1 = base.pass >= 25;

console.log(`  개입 없이도 보스를 넘는가   ${base.pass.toFixed(1)}%  ${ac1 ? "충족" : "미충족 (>=25%)"}`);
console.log(`  개입이 만드는 차이          +${gain.toFixed(1)}%p  (사람 흉내 +${human ? (human.pass - base.pass).toFixed(1) : "?"}%p)`);
console.log("  빌드·배치가 살아 있는지는 npm run relics / npm run placement가 판정한다");
if (!ac1) {
  console.log("\n판정: 개입이 필수 관문이 됐다 — 못 누르면 못 지나간다");
  process.exitCode = 1;
}
