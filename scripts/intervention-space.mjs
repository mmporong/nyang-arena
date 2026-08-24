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
import { walkMap, leaveShop, MAP_POLICIES, VULNERABLE_CASH_OUT_MS } from "./bot-policy.mjs";
import {
  actIntentKind,
  defenseIntentKind,
  dodgeUsable,
  hazardZones,
  queueIntervention,
  stepBattle,
  strikeUsable,
} from "../src/game/battle.ts";
import { livingCats } from "../src/game/types.ts";
import { buyOffer, newRun, startBattle, relicActive, currentKind } from "../src/game/run.ts";

const RUNS = Number(process.argv[2] ?? 300);
const START_SEED = Number(process.argv[3] ?? 1);
if (!Number.isSafeInteger(RUNS) || RUNS <= 0) throw new Error(`실행 횟수는 양의 정수여야 한다: ${process.argv[2]}`);
if (!Number.isSafeInteger(START_SEED) || START_SEED <= 0) {
  throw new Error(`시작 시드는 양의 정수여야 한다: ${process.argv[3]}`);
}
const END_SEED = START_SEED + RUNS - 1;
// 지도는 아무 길이나 간다. 이 스크립트가 재는 축이 아니므로 고정하지 않는다.
const mapPick = MAP_POLICIES["무작위"];
const MAX_WAVE = 60;
const DT = 100;

/**
 * 지금 예고가 떠 있는가. 봇이 화면을 보는 것과 같은 정보다.
 *
 * `hazardsActive`(battle.ts) 하나로 판정한다 — 전에는 `s.enemy.some(c =>
 * c?.telegraph)`만 봐서 상주 장판(creep)·순차 스윕(sweep) 대기열이 떠 있는
 * 동안(둘 다 `state.enemy[].telegraph`에 안 산다) 이 봇이 "위험 없음"으로
 * 잘못 읽었다 — 그 스텝엔 개입을 아예 안 넣으므로, sweep이 어려워졌다는
 * 신호가 실제로는 "이 사본이 못 봤다"였다(2차 반려 진단).
 */
function telegraphUp(state) {
  return defenseIntentKind(state) !== null;
}

/** 취약 창이 열려 있는가. 이때 버튼은 약점 공격이 된다. */
function windowOpen(state) {
  return state.enemy.some((c) => c?.alive && c.vulnerableMs > 0);
}

/**
 * 지금 떠 있는 예고가 요구하는 것. 장판 색이 알려주는 정보와 같다.
 *
 * `hazardZones`의 첫 항목을 본다 — 보스 telegraph(있으면 항상 먼저 들어간다)
 * 를 최우선으로 하고, creep·sweep만 떠 있으면 그 항목을 본다(둘 다
 * mode:"avoid"라 "dodge"로 정확히 해석된다).
 */
function telegraphMode(state) {
  return hazardZones(state)[0]?.mode ?? null;
}

const POLICIES = {
  "개입 없음": null,

  // 회피와 약점을 갈라 잰다. 둘 중 무엇이 값을 하는지 모르면 어느 쪽을
  // 다듬어야 하는지도 모른다.
  "회피만": { dodge: () => true, strike: "none", read: true },
  "약점만": { dodge: () => false, strike: "two", read: true },
  // 장판 색을 안 읽고 늘 탭만 한다. 뭉침 예고에도 흩어지므로 벌을 받는다.
  "늘 탭만": { dodge: () => true, strike: "two", read: false },
  // 반대로 읽는다. 규칙을 거꾸로 배운 플레이어.
  "거꾸로 읽음": { dodge: () => true, strike: "one", read: "invert" },

  // 0/1/2 고정 정책의 가운데 통제군. 상황 판단 정책과 별개로 창당 정확히
  // 한 번의 공격이 실제 생산 경로에서 성립하는지 잰다.
  "한 번 공격": { dodge: () => true, strike: "one", read: true },

  // 첫 기회는 안전한 창 전반에 공격하고, 둘째는 예고 기회를 기다렸다가 창이
  // 닫히기 직전에 남아 있을 때만 공격한다. 방어할 일이 없으면 피해로 회수하고,
  // 겹침이 오면 그 한 칸을 방어에 남기는 실제 상황 판단 정책이다.
  "완벽(읽고 판단)": { dodge: () => true, strike: "adaptive", read: true },

  // 반응이 늦고 네 번에 한 번은 놓친다. 결정적으로 놓치게 해야 시드가 의미를 갖는다.
  "사람 흉내": {
    dodge: (upFor, seen) => seen % 4 !== 3 && upFor >= 3,
    strike: "adaptive",
    read: true,
  },

  // 예고는 정확히 읽지만 정상 창에서도 결정타 두 번을 먼저 써 버리는 비교군.
  "결정타 우선": { dodge: () => true, strike: "two", read: true },
};

/** 실제 버튼과 같은 act 경로로 이번 취약 창의 결정타를 시도할지 정한다. */
function shouldStrike(policy, state, activeWindow) {
  const boss = state.enemy.find((cat) => cat?.alive && cat.vulnerableMs > 0);
  if (!boss || !strikeUsable(state)) return false;
  // 마지막 창은 새 예고가 없는 피니시 보장이다. 모든 정책이 같은 방식으로
  // 마무리하고 정상 창의 선택성 표본에는 넣지 않는다.
  if (boss.finalPhase?.stage === "open") return true;
  if (policy.strike === "none") return false;
  const used = activeWindow?.strikes ?? 0;
  if (policy.strike === "two") return used < 2;
  if (policy.strike === "one") return used < 1;
  if (policy.strike === "adaptive") {
    if (used < 1) return true;
    return used < 2 && boss.vulnerableMs <= VULNERABLE_CASH_OUT_MS;
  }
  return false;
}

function play(policy, seed) {
  const s = newRun(seed);
  let kind = null;
  let wave = 0;
  let upFor = 0;
  let seen = 0;
  let wasUp = false;
  const boss = { tried: new Map(), lost: new Map() };
  const strike = { normal: [], final: [], attempts: 0, successes: 0 };
  let activeWindow = null;
  function closeWindow(expired = activeWindow?.lastRemaining ?? 0) {
    if (!activeWindow) return;
    activeWindow.expired += Math.max(0, expired);
    activeWindow.conservationOk =
      activeWindow.initial === activeWindow.strikes + activeWindow.localDefense + activeWindow.expired;
    (activeWindow.final ? strike.final : strike.normal).push(activeWindow);
    activeWindow = null;
  }
  const finish = (final) => {
    closeWindow();
    return {
      final,
      boss,
      nth,
      strike,
      overlap: { seen: s.vulnOverlapSeen, dodged: s.vulnOverlapDodged },
    };
  };
  /**
   * 이 런에서 몇 번째 보스인가. 웨이브 번호가 아니라 **기회 번호**다.
   *
   * 웨이브별로 묶으면 후반 웨이브 칸에는 거기까지 살아온 런만 들어간다.
   * 실제로 비개입 봇의 W6 통과율(45.6%)이 W3(36.0%)보다 높게 나왔는데,
   * 보스가 쉬워진 것이 아니라 **약한 런이 이미 죽어서 표본에서 빠진** 것이다.
   * 첫 보스는 모든 런이 한 번씩 맞으므로 그 칸만 편향이 없다.
   */
  let bossIdx = 0;
  const nth = { tried: new Map(), lost: new Map() };

  for (let g = 0; g < MAX_WAVE * 2000; g++) {
    if (s.phase === "gameover") {
      if (kind === "boss") {
        boss.lost.set(wave, (boss.lost.get(wave) ?? 0) + 1);
        nth.lost.set(bossIdx, (nth.lost.get(bossIdx) ?? 0) + 1);
      }
      return finish(s.wave);
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
      leaveShop(s);
      continue;
    }
    if (s.phase === "map") {
      walkMap(s, mapPick);
      continue;
    }
    if (s.phase === "prepare") {
      if (s.wave > MAX_WAVE) return finish(MAX_WAVE);
      kind = currentKind(s);
      wave = s.wave;
      if (kind === "boss") {
        boss.tried.set(wave, (boss.tried.get(wave) ?? 0) + 1);
        bossIdx += 1;
        nth.tried.set(bossIdx, (nth.tried.get(bossIdx) ?? 0) + 1);
      }
      upFor = 0;
      wasUp = false;
      startBattle(s);
      if (s.phase !== "battle") return finish(s.wave);
      continue;
    }

    const openBoss = s.enemy.find((cat) => cat?.alive && cat.vulnerableMs > 0);
    const finalOpen = openBoss?.finalPhase?.stage === "open";
    if (
      openBoss &&
      (!activeWindow || activeWindow.uid !== openBoss.uid || activeWindow.final !== finalOpen)
    ) {
      closeWindow();
      activeWindow = {
        uid: openBoss.uid,
        final: finalOpen,
        initial: openBoss.vulnerableCharges,
        lastRemaining: openBoss.vulnerableCharges,
        strikes: 0,
        localDefense: 0,
        globalDefense: 0,
        expired: 0,
        conservationOk: false,
      };
    }

    if (policy) {
      const up = telegraphUp(s);
      if (up && !wasUp) {
        seen += 1;
        upFor = 0;
      }
      wasUp = up;
      /**
       * 예고가 먼저, 취약 창은 그다음 — resolveIntent와 같은 순서다.
       * 예전에는 "창이 열리면 무조건 연타한다"가 앞에 있었는데, US-102가
       * 그 전제를 뒤집었다: 창이 열려 있어도 예고가 활성이면 버튼은 회피다.
       * 이 순서가 갈라지면 서문의 파리티 계약("봇은 브라우저와 같은 경로로
       * 개입한다")이 깨져 여기서 잰 수치가 사람이 겪는 값이 아니게 된다.
       * 종류를 직접 지정하는 것은 유지한다 — 거꾸로 읽기 같은 나쁜 정책을
       * 일부러 돌리는 것이 이 하네스의 임무라서다.
       */
      if (up) {
        upFor += 1;
        // dodgeUsable(battle.ts) — 순차 스윕(sweep)의 두 번째 파동은 차지가
        // 0이어도 첫 파동에서 낸 값으로 공짜로 통과한다("개입 1회로 연쇄
        // 전체를 넘긴다"). `s.dodgeCharges > 0`만 보면 그 무료 순간을 이
        // 하네스가 아예 안 눌러 실제보다 어렵게 잰다.
        if (dodgeUsable(s) && policy.dodge(upFor, seen, s)) {
          const need = defenseIntentKind(s) ?? telegraphMode(s);
          if (policy.read === true) {
            // 올바른 정책은 화면과 같은 act를 보낸다. 안전해진 상주 장판과
            // 결정타가 겹쳐도 실제 입력 해석을 우회하지 않는다.
            queueIntervention(s, { kind: "act" });
          } else {
            const kind =
              policy.read === false
                ? "dodge" // 색을 안 읽고 늘 탭
                : need === "gather"
                  ? "dodge"
                  : "gather";
            queueIntervention(s, { kind });
          }
        }
      } else if (windowOpen(s)) {
        // 직접 strike를 넣으면 resolveIntent의 예고 우선순위·자원 판정을 우회한다.
        // 정책은 누를지만 정하고 실제 행동은 브라우저와 같은 act가 해석한다.
        if (shouldStrike(policy, s, activeWindow)) {
          strike.attempts += 1;
          queueIntervention(s, { kind: "act" });
        }
      }
    }

    const tracked = activeWindow
      ? s.enemy.find((cat) => cat?.uid === activeWindow.uid)
      : null;
    const beforeLocal = tracked?.vulnerableCharges ?? 0;
    const beforeGlobal = s.dodgeCharges;
    const head = s.pending[0];
    const expectedKind = head?.kind === "act" ? actIntentKind(s) : head?.kind;

    stepBattle(s, DT);

    if (activeWindow && tracked) {
      const after = s.enemy.find((cat) => cat?.uid === activeWindow.uid);
      const stillOpen = !!after?.alive && after.vulnerableMs > 0 &&
        (after.finalPhase?.stage === "open") === activeWindow.final;
      const afterLocal = stillOpen ? after.vulnerableCharges : 0;
      const localChanged = beforeLocal > afterLocal;
      let localSpent = 0;
      if (localChanged && beforeLocal > 0) {
        if (expectedKind === "strike") {
          activeWindow.strikes += 1;
          strike.successes += 1;
          localSpent = 1;
        } else if (expectedKind === "dodge" || expectedKind === "gather") {
          activeWindow.localDefense += 1;
          localSpent = 1;
        }
      }
      if (beforeGlobal > s.dodgeCharges && (expectedKind === "dodge" || expectedKind === "gather")) {
        activeWindow.globalDefense += beforeGlobal - s.dodgeCharges;
      }
      activeWindow.lastRemaining = afterLocal;
      if (!stillOpen) closeWindow(Math.max(0, beforeLocal - localSpent));
    }
  }
  return finish(s.wave);
}

/**
 * 시드 단위 bootstrap. 시드를 복원추출로 다시 뽑아 통과율을 2000번 다시 센다.
 *
 * 보스 시도를 독립표본처럼 합산하면 안 되는 이유는 **한 시드가 여러 번 등장**
 * 하기 때문이다(군집). 재추출의 단위를 보스 시도가 아니라 시드로 두면 그
 * 군집이 보존된다.
 */
function bootstrapCI(perSeed, iters = 2000) {
  if (perSeed.length === 0) return [0, 0];
  let st = 987654321;
  const rnd = () => ((st = (st * 1664525 + 1013904223) >>> 0) / 4294967296);
  const out = [];
  for (let i = 0; i < iters; i++) {
    let t = 0;
    let w = 0;
    for (let k = 0; k < perSeed.length; k++) {
      const p = perSeed[Math.floor(rnd() * perSeed.length)];
      t += p.tried;
      w += p.won;
    }
    out.push(t ? (w / t) * 100 : 0);
  }
  out.sort((a, b) => a - b);
  return [out[Math.floor(iters * 0.025)], out[Math.floor(iters * 0.975)]];
}

const pct = (a, p) => a[Math.min(a.length - 1, Math.floor(a.length * p))];

console.log(`런 ${RUNS}회 · 구매·배치 정책 고정 · 개입만 변경 · 시드 ${START_SEED}~${END_SEED}\n`);
console.log("정책          보스통과율   W3      W6      전체중앙값   평균");

const base = {};
const results = {};
for (const [name, policy] of Object.entries(POLICIES)) {
  const finals = [];
  const tried = new Map();
  const lost = new Map();
  const nthTried = new Map();
  const nthLost = new Map();
  const firstBySeed = [];
  const finalBySeed = [];
  const normalWindows = [];
  const finalWindows = [];
  let strikeAttempts = 0;
  let strikeSuccesses = 0;
  let overlapSeen = 0;
  let overlapDodged = 0;
  for (let i = 0; i < RUNS; i++) {
    const r = play(policy, START_SEED + i);
    finals.push(r.final);
    finalBySeed.push(r.final);
    normalWindows.push(...r.strike.normal);
    finalWindows.push(...r.strike.final);
    strikeAttempts += r.strike.attempts;
    strikeSuccesses += r.strike.successes;
    overlapSeen += r.overlap.seen;
    overlapDodged += r.overlap.dodged;
    for (const [w, n] of r.boss.tried) tried.set(w, (tried.get(w) ?? 0) + n);
    for (const [w, n] of r.boss.lost) lost.set(w, (lost.get(w) ?? 0) + n);
    for (const [k, n] of r.nth.tried) nthTried.set(k, (nthTried.get(k) ?? 0) + n);
    for (const [k, n] of r.nth.lost) nthLost.set(k, (nthLost.get(k) ?? 0) + n);
    const t1 = r.nth.tried.get(1) ?? 0;
    if (t1) firstBySeed.push({ tried: t1, won: t1 - (r.nth.lost.get(1) ?? 0) });
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
  const nthRate = (k) => {
    const t = nthTried.get(k) ?? 0;
    return t ? ((t - (nthLost.get(k) ?? 0)) / t) * 100 : null;
  };
  results[name] = {
    pass,
    avg,
    median,
    first: nthRate(1),
    firstTried: nthTried.get(1) ?? 0,
    ci: bootstrapCI(firstBySeed),
    finalBySeed,
    normalWindows,
    finalWindows,
    strikeAttempts,
    strikeSuccesses,
    overlapSeen,
    overlapDodged,
  };
  if (name === "개입 없음") {
    base.pass = pass;
    base.avg = avg;
    base.median = median;
    base.first = nthRate(1);
    base.finalBySeed = finalBySeed;
  }
  console.log(
    `${name.padEnd(12)} ${pass.toFixed(1).padStart(8)}% ${rate(3).padStart(8)} ${rate(6).padStart(8)} ` +
      `${String(pct(finals, 0.5)).padStart(10)} ${avg.toFixed(1).padStart(7)}`,
  );
}

/**
 * 편향 없는 칸과 편향 있는 칸을 갈라서 다시 찍는다.
 *
 * `보스통과율` 열은 한 런의 여러 보스 시도를 그냥 합산한 값이다. 두 가지가
 * 섞여 있다 — 시드 군집(한 시드가 여러 번 등장)과 생존자 편향(오래 사는 정책이
 * 더 어려운 후반 보스를 더 많이 맞는다). 그래서 **첫 보스만** 따로 본다.
 * 모든 런이 정확히 한 번씩 맞으므로 정책 간 비교가 성립하는 유일한 칸이다.
 */
console.log("\n첫 보스만 (모든 런이 한 번씩 맞는다 · 시드 bootstrap 95% 구간)");
console.log("정책            첫보스통과율   95% 구간        시드짝비교(도달웨이브)");
for (const name of Object.keys(POLICIES)) {
  const r = results[name];
  if (!r || r.first === null) continue;
  const [lo, hi] = r.ci;
  let paired = "  기준";
  if (name !== "개입 없음" && base.finalBySeed) {
    const d = r.finalBySeed.map((v, i) => v - base.finalBySeed[i]).sort((a, b) => a - b);
    const med = d[Math.floor(d.length / 2)];
    const win = d.filter((x) => x > 0).length;
    paired = `중앙값 ${med >= 0 ? "+" : ""}${med} · ${((win / d.length) * 100).toFixed(0)}% 시드에서 우세`;
  }
  console.log(
    `${name.padEnd(14)} ${r.first.toFixed(1).padStart(10)}%   ${`${lo.toFixed(1)}~${hi.toFixed(1)}`.padStart(12)}   ${paired}`,
  );
}
function windowSummary(result) {
  const windows = result?.normalWindows ?? [];
  const sum = (field) => windows.reduce((total, window) => total + window[field], 0);
  const exact = [0, 1, 2].map((count) => windows.filter((window) => window.strikes === count).length);
  return {
    windows: windows.length,
    strikes: sum("strikes"),
    localDefense: sum("localDefense"),
    globalDefense: sum("globalDefense"),
    expired: sum("expired"),
    exact,
    conservationViolations: windows.filter((window) => !window.conservationOk).length,
    finalWindows: result?.finalWindows.length ?? 0,
    finalStrikes: (result?.finalWindows ?? []).reduce((total, window) => total + window.strikes, 0),
  };
}

console.log("\n정상 취약 창 — 창 기회 2 = 결정타 + local 방어 + 소멸");
for (const name of ["회피만", "한 번 공격", "완벽(읽고 판단)", "결정타 우선", "늘 탭만"]) {
  const result = results[name];
  if (!result) continue;
  const stats = windowSummary(result);
  const handled = result.overlapSeen > 0 ? (result.overlapDodged / result.overlapSeen) * 100 : 0;
  console.log(
    `  ${name.padEnd(14)} 창 ${String(stats.windows).padStart(4)} · 결정타 ${String(stats.strikes).padStart(4)} ` +
      `· 방어 local/global ${stats.localDefense}/${stats.globalDefense} · 소멸 ${stats.expired} ` +
      `· 공격 0/1/2창 ${stats.exact.join("/")} · 보존위반 ${stats.conservationViolations} ` +
      `· 겹침 ${result.overlapDodged}/${result.overlapSeen} (${handled.toFixed(1)}%)`,
  );
  console.log(`  ${"".padEnd(14)} 최종 피니시 창 ${stats.finalWindows} · 결정타 ${stats.finalStrikes} (선택성 판정 제외)`);
}
console.log(`  (첫 보스 표본 ${results["개입 없음"]?.firstTried ?? 0}판 · 시드 ${START_SEED}~${END_SEED})`);
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
console.log(`  개입이 만드는 차이          +${gain.toFixed(1)}%p  (사람 흉내 +${human ? (human.pass - base.pass).toFixed(1) : "?"}%p)  ← 합산값, 편향 있음`);
console.log(
  `  첫 보스만 보면              ${base.first?.toFixed(1)}% → ${perfect?.first?.toFixed(1)}% ` +
    `= +${perfect && base.first != null ? (perfect.first - base.first).toFixed(1) : "?"}%p  ← 이쪽을 인용할 것`,
);
/**
 * **깊이도 여기서 판정한다.** 두 지표가 서로 다른 말을 하므로 둘 다 적는다.
 *
 *   첫 보스 통과율:  95.7% → 99.7%  = +4.0%p    작다
 *   도달 웨이브 짝차:  시드별 중앙값 +5           크다
 *
 * 모순이 아니다. 첫 보스는 모두에게 쉬워서 아무 때나 눌러도 넘어간다. 색을
 * 읽는 값은 **뒤로 갈수록** 나온다 — 뭉침 예고에 흩어지면 전원이 크게 맞고,
 * 그 피해가 누적되는 데 몇 웨이브가 걸린다.
 *
 * 첫 보스 칸만 인용하면 개입의 깊이를 과소평가하고, 합산 통과율을 인용하면
 * 과대평가한다. 짝지은 도달 웨이브가 이 축의 정직한 크기다.
 */
const always = results["늘 탭만"];
if (always && perfect) {
  const d = perfect.finalBySeed.map((v, i) => v - always.finalBySeed[i]).sort((a, b) => a - b);
  const med = d[Math.floor(d.length / 2)];
  const win = d.filter((x) => x > 0).length;
  console.log(
    `  깊이 (늘 탭만 → 읽고 판단)  첫 보스 +${(perfect.first - always.first).toFixed(1)}%p · ` +
      `도달웨이브 짝차 중앙값 ${med >= 0 ? "+" : ""}${med} (${((win / d.length) * 100).toFixed(0)}% 시드 우세)`,
  );
}
function pairedSummary(leftName, rightName) {
  const left = results[leftName];
  const right = results[rightName];
  if (!left || !right) return null;
  const raw = left.finalBySeed.map((value, i) => value - right.finalBySeed[i]);
  const sorted = [...raw].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const wins = raw.filter((delta) => delta > 0).length;
  const average = raw.reduce((sum, delta) => sum + delta, 0) / raw.length;
  return { median, winRate: (wins / raw.length) * 100, average };
}

console.log("\n균형 정책 짝비교 (아래 취약 창 선택성 exit gate의 근거)");
for (const other of ["회피만", "결정타 우선", "늘 탭만"]) {
  const paired = pairedSummary("완벽(읽고 판단)", other);
  if (!paired) continue;
  console.log(
    `  완벽 - ${other.padEnd(7)} 중앙값 ${paired.median >= 0 ? "+" : ""}${paired.median} · ` +
      `엄격우세 ${paired.winRate.toFixed(1)}% · 평균차 ${paired.average >= 0 ? "+" : ""}${paired.average.toFixed(2)}`,
  );
}
const zero = windowSummary(results["회피만"]);
const one = windowSummary(results["한 번 공격"]);
const two = windowSummary(results["결정타 우선"]);
const adaptiveVsZero = pairedSummary("완벽(읽고 판단)", "회피만");
const adaptiveVsTwo = pairedSummary("완벽(읽고 판단)", "결정타 우선");
const minWindows = Math.max(20, Math.floor(RUNS * 0.33));
const exactRate = (summary, count) => summary.windows > 0 ? summary.exact[count] / summary.windows : 0;
const meanStrikes = (summary) => summary.windows > 0 ? summary.strikes / summary.windows : 0;
const changedSeeds = results["회피만"].finalBySeed.filter(
  (value, index) => value !== results["결정타 우선"].finalBySeed[index],
).length / RUNS;
const adaptiveOutcome = [adaptiveVsZero, adaptiveVsTwo].some((paired, index) => {
  if (!paired) return false;
  const other = index === 0 ? results["회피만"] : results["결정타 우선"];
  const firstGain = results["완벽(읽고 판단)"].first - other.first;
  return paired.average >= 0.5 || firstGain >= 5;
});

const choiceChecks = [
  ["정상 창 표본", zero.windows >= minWindows && one.windows >= minWindows && two.windows >= minWindows,
    `${zero.windows}/${one.windows}/${two.windows} (각 >=${minWindows})`],
  ["0공격 계약", exactRate(zero, 0) >= 0.99, `${(exactRate(zero, 0) * 100).toFixed(1)}%`],
  ["1공격 계약", exactRate(one, 1) >= 0.95, `${(exactRate(one, 1) * 100).toFixed(1)}%`],
  ["2공격 계약", exactRate(two, 2) >= 0.95, `${(exactRate(two, 2) * 100).toFixed(1)}%`],
  ["창 자원 보존식", zero.conservationViolations + one.conservationViolations + two.conservationViolations === 0,
    `위반 ${zero.conservationViolations + one.conservationViolations + two.conservationViolations}`],
  ["공격량 0<1<2", meanStrikes(zero) < meanStrikes(one) && meanStrikes(one) < meanStrikes(two),
    `${meanStrikes(zero).toFixed(2)}<${meanStrikes(one).toFixed(2)}<${meanStrikes(two).toFixed(2)}`],
  ["방어 보존 이점", zero.localDefense > two.localDefense,
    `local 방어 ${zero.localDefense}>${two.localDefense}`],
  ["정책 결과 분기", changedSeeds >= 0.2, `${(changedSeeds * 100).toFixed(1)}% 시드`],
  ["상황 판단 결과 이점", adaptiveOutcome,
    `평균차 vs0 ${adaptiveVsZero?.average.toFixed(2) ?? "-"} · vs2 ${adaptiveVsTwo?.average.toFixed(2) ?? "-"}`],
];
let choiceBad = 0;
console.log("\n취약 창 선택성 관문");
for (const [label, ok, value] of choiceChecks) {
  if (!ok) choiceBad += 1;
  console.log(`  ${ok ? "충족" : "미달"}  ${label.padEnd(18)} ${value}`);
}
console.log("  빌드·배치가 살아 있는지는 npm run relics / npm run placement가 판정한다");
if (!ac1 || choiceBad > 0) {
  if (!ac1) console.log("\n판정: 개입이 필수 관문이 됐다 — 못 누르면 못 지나간다");
  if (choiceBad > 0) console.log(`판정: 취약 창 선택성 ${choiceBad}건 미달 — strike-not-a-choice 유지`);
  process.exitCode = 1;
}
