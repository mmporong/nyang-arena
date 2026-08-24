/**
 * 측정 봇의 공통 행동.
 *
 * 보스가 세 웨이브마다 오고 기믹 대응이 필수가 된 뒤로, 이걸 안 쓰는 봇은
 * 보스에서 병목에 걸린다. 그러면 구매나 배치를 재려 해도 전부 "보스에서
 * 죽었다"로 수렴해 축이 압축된다 — 실제로 구매 정책 여섯이 전부 6.8~7.1로
 * 뭉쳤고 배치 격차가 3.7에서 1.3으로 떨어졌다.
 *
 * 그래서 **모든 측정 봇이 같은 기준선 위에서** 보스를 넘고, 그 위에서 재려는
 * 축만 바꾼다.
 */
import { bossIndexAt, buyOffer, chooseNode, chooseRaidContract, mapStep, moveCat, relicActive, rerollOffers, syncStage } from "../src/game/run.ts";
import { isRaidPrepStep, openLanes } from "../src/game/map.ts";
import { makeRng, mixSeed, rng } from "../src/game/rng.ts";
import { BOARD_COLS, livingCats } from "../src/game/types.ts";
import { bossForIndex } from "../src/game/bosses.ts";
import { dodgeUsable, hazardsActive } from "../src/game/battle.ts";
import { raidPrepRoute } from "../src/game/raid.ts";

/**
 * 예고를 읽고 반응한다. 사람처럼 조금 늦고 가끔 놓친다 —
 * 완벽하게 반응하는 봇은 상한이지 기준선이 아니다.
 */
/**
 * @param read 예고 색을 읽는가. false면 **늘 산개**(뭉침 예고에도 흩어진다) — intervention-space의
 *   "늘 탭만"과 같은 뜻이고, clear-space의 "무의식" 봇이 쓴다. 기본 true.
 */
export function makeBossBot({ read = true } = {}) {
  let lastTelegraph = null;
  let since = 0;
  let seen = 0;

  return function respond(s) {
    /**
     * 버튼 규칙의 사본을 두지 않는다 — 전에는 취약 창이면 `strike`를 직접
     * 밀었는데, resolveIntent가 "예고 > 취약"으로 바뀌자 **플레이어가 낼 수
     * 없는 정책**을 재는 봇이 됐다(리뷰 적발). `act`로 밀면 해석은 언제나
     * 게임과 동일하고, 사람 흉내(반응 지연·놓침)는 예고 쪽 분기만 맡는다.
     */
    if (s.enemy.some((c) => c?.alive && c.vulnerableMs > 0)) {
      s.pending.push({ kind: "act" });
      return;
    }
    const tg = s.enemy.find((c) => c?.telegraph)?.telegraph;
    if (!tg || s.dodgeCharges <= 0) {
      lastTelegraph = null;
      /**
       * `hazardsActive`·`dodgeUsable`(battle.ts) 하나씩으로 판정한다 —
       * 상주 장판(creep)·순차 스윕(sweep) 대기열은 `s.enemy`의 telegraph가
       * 아니라 battle.ts의 별도 배열이라 위 `tg` 검사엔 안 걸린다. 사람이
       * act 버튼을 누르면 resolveIntent의 기본값이 알아서 회피로 푸는데,
       * 이 봇은 act가 아니라 dodge/gather를 직접 박아 넣으므로 그 기본
       * 경로를 안 탄다 — 여기서 한 번 더 봐 준다. `dodgeUsable`을 쓰는
       * 이유는 스윕 두 번째 파동이 차지 0에서도 공짜로 통하기 때문이다
       * (`s.dodgeCharges > 0`만 보면 그 무료 순간을 봇이 아예 시도조차
       * 안 해서 "개입 1회로 연쇄 전체를 넘긴다"는 설계가 있으나 마나가
       * 된다 — 실측: 이 사본을 안 고치고는 sim 중앙값이 10에서 안 올랐다).
       */
      if (hazardsActive(s) && dodgeUsable(s)) {
        s.pending.push({ kind: "dodge" });
      }
      return;
    }
    since = tg === lastTelegraph ? since + 1 : 0;
    if (tg !== lastTelegraph) seen += 1;
    lastTelegraph = tg;
    // 네 번에 한 번 놓치고 두 틱 늦게 반응한다.
    if (seen % 4 !== 3 && since >= 2) {
      s.pending.push({ kind: read && tg.mode === "gather" ? "gather" : "dodge" });
    }
  };
}

/**
 * 살 수 있는 오퍼 중 유물은 조건을 채우고 있을 때만 남긴다.
 *
 * 조건은 카드에 적혀 있으므로 이건 '카드를 읽는' 최소한의 플레이어다.
 * 조건을 안 보고 사면 대가만 쌓여 기준 봇이 무작위 구매보다 나빠진다.
 */
export function affordable(s) {
  return s.offers
    .filter((o) => o && o.cost <= s.gold)
    .filter((o) => o.kind !== "relic" || (o.relic ? relicActive(o.relic, livingCats(s.ally)) : false));
}

/**
 * 상점에서 한 번 행동한다. **기준 봇의 구매 정책은 여기 한 곳에만 있다.**
 *
 * 전에는 `balance-sim`과 `metrics-gen`이 각자 이 로직을 갖고 있었고, 그래서
 * 조용히 갈라졌다 — 재추첨 예산을 sim은 **웨이브마다**, metrics는 **상점을
 * 밟을 때마다** 0으로 돌렸다. 상점 칸은 걸음만 먹고 웨이브는 안 먹으므로 둘은
 * 반드시 어긋나고, 실제로 같은 코드에서 p25가 8과 9로 갈렸다.
 *
 * 하필 `metrics-gen`은 "balance-sim과 한 글자도 다르면 안 된다"고 주석에
 * 적어 둔 파일이고, 그 파일이 내는 수치를 문서가 인용한다. 복사해 놓고
 * 같기를 바라는 대신 **부를 수 있는 것 하나로** 만든다.
 *
 * @param st 런 하나 동안 유지되는 상태. `{ rerolls: 0, lastWave: 0 }`로 시작한다.
 * @param choose 살 수 있는 것 중에서 고르는 함수. 안 주면 가장 비싼 것(기준 봇).
 *   유물 축처럼 **구매 정책 자체가 실험 대상**인 하네스가 이걸로 자기 정책을
 *   끼워 넣는다 — 그래야 재추첨 처리를 또 베끼지 않는다.
 * @returns "bought" 샀다 · "rerolled" 다시 뽑았다 · "leave" 더 할 일이 없다
 */
export function shopStep(s, st, choose = null) {
  const byCost = (a, b) =>
    (a.kind === "replace" ? 1 : 0) - (b.kind === "replace" ? 1 : 0) || b.cost - a.cost;

  const aff = affordable(s);
  // 정책에 상태도 넘긴다. '몇 마리 데리고 있나'를 못 보면 보유 수를
  // 조건으로 삼는 유물(분신 부적)을 쓰는 정책 자체를 쓸 수 없다.
  const pick = choose ? (aff.length > 0 ? choose(aff, s) : null) : [...aff].sort(byCost)[0];
  if (pick) {
    const before = s.offers.length;
    // 구매 실패한 카드가 목록에 남으면 같은 카드를 무한히 재시도하게 된다.
    if (!buyOffer(s, pick) && s.offers.length === before) {
      s.offers = s.offers.map((o) => (o === pick ? null : o));
    }
    return "bought";
  }

  // 무료 재추첨은 **조건 없이 다 쓴다.** 상점 칸이 "카드를 더 보라"고 준
  // 것이라 안 쓰면 그 보상이 사라진 것과 같고, 생선 예산과 섞어 세면 상점
  // 칸의 값을 재는 지도 축이 오염된다. `rerollOffers`가 무료분을 먼저 쓴다.
  if (s.freeRerolls > 0 && rerollOffers(s)) return "rerolled";

  // 생선으로 하는 재추첨 예산은 **웨이브마다** 돌아온다. 상점 방문마다
  // 돌리면 상점 칸을 밟을수록 더 뽑게 되어 같은 축이 또 오염된다.
  if (s.wave !== st.lastWave) {
    st.lastWave = s.wave;
    st.rerolls = 0;
  }
  if (st.rerolls < 4 && s.gold >= 12 && rerollOffers(s)) {
    st.rerolls += 1;
    return "rerolled";
  }
  return "leave";
}

/**
 * 들고 있는 유물이 요구하는 모양으로 배치를 고친다.
 *
 * **이게 없으면 유물의 배치 조건은 잴 수 없다.** 자동 배치(`bestFreeCell`)는
 * 직업만 보고 놓으므로 앞줄 근접 3은 31%, 뒷줄 원거리 4는 34%만 우연히
 * 맞는다. 봇이 배치를 못 바꾸면 그 조건은 "운"이지 "결정"이 아니고, 그러면
 * 유물 축을 재는 값이 사람이 겪는 것과 달라진다.
 *
 * 사람이 하는 일과 같은 것만 한다 — `moveCat`으로 칸을 맞바꾼다. 브라우저의
 * 드래그가 부르는 바로 그 함수다.
 *
 * 욕심을 부리지 않는다. 조건 하나를 채우려다 다른 조건을 깨뜨릴 수 있으므로,
 * **바꾼 뒤에 켜진 조건 수가 늘 때만** 유지한다. 최적 배치를 찾는 것이 아니라
 * "유물을 읽고 손을 대는 플레이어"를 흉내 내는 것이 목적이다.
 */
export function arrangeForRelics(s) {
  if (s.relics.length === 0) return;
  const cats = () => livingCats(s.ally);
  const score = () => s.relics.filter((r) => relicActive(r, cats())).length;

  let best = score();
  if (best === s.relics.length) return; // 이미 다 켜졌다

  // 빈 칸과 찬 칸을 전부 맞바꿔 보고 개선되는 것만 남긴다. 5x5라 25*25이지만
  // 한 걸음에 한 번뿐이고 조기 종료가 있어 측정 시간에 영향이 없다.
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    for (let from = 0; from < s.ally.length; from++) {
      if (!s.ally[from]) continue;
      for (let to = 0; to < s.ally.length; to++) {
        if (from === to) continue;
        moveCat(s, from, to);
        const now = score();
        if (now > best) { best = now; moved = true; }
        else moveCat(s, to, from); // 되돌린다
        if (best === s.relics.length) return;
      }
    }
    if (!moved) return;
  }
}

/**
 * 지도에서 한 칸을 고른다.
 *
 * 브라우저와 **같은 경로**로 간다 — `chooseNode`가 판정을 전부 갖고 있고,
 * 스크립트는 어느 칸을 고를지만 정한다. 이 파리티가 깨지면 여기서 잰 수치는
 * 사람이 겪는 값이 아니게 된다. 예전에 상점 → 배치로 바로 넘어가던 자리를
 * 지도로 바꾸지 않았더니, 심은 옛 게임을 재고 있었다.
 *
 * **한 걸음의 순서는 지도 → 상점 → 배치다.** 그래서 이 함수는 `map` 국면에서
 * 불리고, 부르고 나면 `reward`(상점)가 된다. 상점을 나서는 것은 `leaveShop`이다.
 *
 * `pick`은 고를 수 있는 칸들 중 하나를 고르는 함수다. 기본은 첫 칸(무작위에
 * 가깝지 않음)이 아니라 시드 난수 — 정책을 안 주면 아무 길이나 간다.
 */
export function walkMap(
  s,
  pick = MAP_POLICIES["무작위"],
  contractPick = RAID_CONTRACT_POLICIES["위험 낮은 계약"],
) {
  syncStage(s);
  if (s.raidOffers?.length > 0) {
    const contractIdx = contractPick(s.raidOffers, s);
    if (!Number.isInteger(contractIdx) || contractIdx < 0 || contractIdx >= s.raidOffers.length) {
      throw new Error(`계약 정책이 유효하지 않은 인덱스를 냈다: ${String(contractIdx)}`);
    }
    if (!chooseRaidContract(s, contractIdx)) {
      throw new Error(`계약 정책 선택 전이가 실패했다: ${contractIdx}`);
    }
  }
  const step = mapStep(s);
  const row = s.map.steps[step] ?? [];
  const open = openLanes(s.map, step);
  if (open.length === 0) {
    // 지도가 망가진 경우의 안전장치. 계약 테스트가 막고 있지만 여기서 멈추면
    // 원인을 못 찾는다.
    s.phase = "prepare";
    return;
  }
  // 정책에 **판 상태도 넘긴다.** 안 넘기면 "늘 전투 / 늘 정찰" 같은 눈감은
  // 정책만 만들 수 있고, 그러면 상황을 읽는 결정을 애초에 잴 수 없다.
  const idx = pick(open, row, s) ?? open[0];
  if (!Number.isInteger(idx) || !open.includes(idx)) {
    throw new Error(`지도 정책이 닫힌 칸을 골랐다: ${String(idx)}`);
  }
  if (!chooseNode(s, idx)) throw new Error(`지도 정책 선택 전이가 실패했다: ${idx}`);
}

/** 계약 선택 정책. 계약 공간 측정은 세 정책을 같은 시드로 짝비교한다. */
export const RAID_CONTRACT_POLICIES = {
  "첫 카드": () => 0,
  "위험 낮은 계약": (offers) => {
    let best = 0;
    for (let i = 1; i < offers.length; i++) {
      const a = offers[i];
      const b = offers[best];
      if (a.risk < b.risk || (a.risk === b.risk && a.rewardFish > b.rewardFish)) best = i;
    }
    return best;
  },
  "보상 큰 계약": (offers) => {
    let best = 0;
    for (let i = 1; i < offers.length; i++) {
      const a = offers[i];
      const b = offers[best];
      if (a.rewardFish > b.rewardFish || (a.rewardFish === b.rewardFish && a.risk < b.risk)) best = i;
    }
    return best;
  },
  /**
   * 현재 로스터를 읽는다. 근접이 많으면 집결·구조 계약, 원거리가 많으면
   * 고정 바닥·산개 계약을 선호한다. 보상은 동률에서만 본다.
   */
  "팀 읽고 고름": (offers, state) => {
    const cats = livingCats(state.ally);
    const melee = cats.filter((cat) => cat.breed.kind === "melee").length;
    const ranged = cats.length - melee;
    const strength = cats.reduce((sum, cat) => sum + cat.level, 0) + state.relics.length * 1.5;
    // 시작 3마리면 위험 1, 팀이 자라고 유물이 붙을수록 2·3을 감당한다.
    const affordableRisk = strength >= 13 ? 3 : strength >= 7 ? 2 : 1;
    const score = (contract) => {
      const patterns = [...contract.patterns, ...(contract.phase2Patterns ?? [])];
      const gatherish = patterns.filter((p) => p === "gather" || p === "hearth" || p === "seize").length;
      const spreadish = patterns.filter((p) => p === "stomp" || p === "quake" || p === "sweep" || p === "circle").length;
      const rosterFit = melee >= ranged ? gatherish : spreadish;
      const overreach = Math.max(0, contract.risk - affordableRisk);
      return rosterFit * 3 - overreach * 20 + contract.rewardFish * 0.25 - contract.risk * 0.4;
    };
    let best = 0;
    for (let i = 1; i < offers.length; i++) if (score(offers[i]) > score(offers[best])) best = i;
    return best;
  },
};

/**
 * 상점을 나선다. 브라우저의 버튼과 **같은 함수**를 부른다.
 *
 * 정찰 칸이면 다시 지도로, 아니면 배치로 간다. 스크립트가 이 판정을 각자
 * 복제하면 반드시 갈라진다 — 그래서 `run.ts`에만 둔다.
 */
export { leaveShop } from "../src/game/run.ts";

/** 길 고르기 정책들. `npm run map`이 이걸 비교한다. */
export const MAP_POLICIES = {
  // 언제나 안전한 쪽. 정예도 상점도 안 간다.
  "전투만": (open, row) => open.find((i) => row[i]?.kind === "battle") ?? open[0],
  // 위험을 산다. 정예가 있으면 무조건 간다.
  "정예 몰빵": (open, row) => open.find((i) => row[i]?.kind === "elite") ?? open[0],
  // 보스를 대비한다. 정찰이 있으면 무조건 간다.
  "정찰 몰빵": (open, row) => open.find((i) => row[i]?.kind === "shop") ?? open[0],
  // 아무 길이나. 지도가 결정인지 아닌지의 기준선이다.
  "무작위": (open) => open[Math.floor(rng() * open.length)] ?? open[0],
  /**
   * **판을 읽고 고른다.** 위의 넷은 전부 눈을 감고 있다 — 무엇을 만나든 늘 같은
   * 종류로 간다. 구매 축도 정확히 이 문제였다: 카드만 보는 정책끼리만 견주다가
   * "구매에 깊이가 없다"는 판정을 받았고, 로스터를 읽는 정책을 넣자 깊이가
   * 2.5로 드러났다. 지도만 눈감은 정책으로 남아 있었다.
   *
   * 읽는 것은 셋이다.
   * - **다음이 보스인가** — 그러면 정찰로 여분 회피를 챙긴다. 실측에서 보스전은
   *   91%가 차지를 0까지 쓴다(모자란 자원이다)
   * - **유물이 없는가** — 정예를 이기면 그 자리에서 유물을 준다. 유물 축이
   *   4.3웨이브이므로 초반의 유물 하나는 크다
   * - 그 밖에는 전투 — 정예는 판이 끝나는 이유의 31%라 이유 없이 갈 곳이 아니다
   */
  "읽고 고름": (open, row, s) => {
    const step = mapStep(s);
    const find = (k) => open.find((i) => row[i]?.kind === k);
    // 계약 카드의 위험 한 칸을 실제 준비 경로로 번역한다. 낮음은 일반전,
    // 중간은 정예, 높음은 정찰이다. 계약 직후 관문에는 세 경로가 모두 열린다.
    if (isRaidPrepStep(step) && s.raidContract) {
      const prepared = find(raidPrepRoute(s.raidContract));
      if (prepared !== undefined) return prepared;
    }
    // 일반 갈림길에서는 전투를 하나 덜 치르면서 생선·무료 재추첨을 얻는 정찰을
    // 우선한다. 준비 관문의 계약별 대가를 지킨 뒤에는 이 게임의 현재 최선
    // 장기 경로를 따르는 것이 "읽고 고름"의 기준선이다.
    const scout = find("shop");
    if (scout !== undefined) return scout;
    if (s.relics.length === 0) {
      const elite = find("elite");
      if (elite !== undefined) return elite;
    }
    return find("battle") ?? open[0];
  },
};

/* ------------------------------------------------------------------ */
/* 구매 정책 — decision-space·clear-space가 쓴다 (2026-08-23 여기로 모음)   */
/* ------------------------------------------------------------------ */

const byCost = (a, b) => (a.kind === "replace" ? 1 : 0) - (b.kind === "replace" ? 1 : 0) || b.cost - a.cost;

/**
 * **로스터를 읽고 한쪽으로 민다.**
 *
 * 여태 구매 정책은 전부 카드 자체만 봤다 — 값이 싼가 비싼가, 영입인가 강화인가.
 * 그래서 "무작위로 사는 봇과 최선 봇의 중앙값이 똑같이 12"라는 결과가 나왔고,
 * 거기서 "구매에는 깊이가 없다"고 결론을 냈다.
 *
 * 그런데 그 결론은 **읽고 사는 정책을 한 번도 안 재 본 상태**에서 내린 것이다.
 * `npm run relics`가 직업 몰빵으로 평균 13.8 → 18.2를 만든다는 것을 이미 알고
 * 있었으므로, 구매 축에도 같은 것이 있을 수 있다.
 *
 * 이 정책은 지금 내 팀에서 가장 많은 직업을 세고 그쪽으로 민다. 카드가 아니라
 * **상태를 보는** 최초의 구매 정책이다. 교체 카드도 쓴다 — 지금까지 모든 정책이
 * `replace`를 맨 뒤로 밀어 두고 있었는데, 몰빵에는 곁가지를 쳐내는 수단이 필요하다.
 */
function pivot(state, afford, useRelics = true) {
  const count = new Map();
  for (const c of livingCats(state.ally)) {
    count.set(c.breed.cls, (count.get(c.breed.cls) ?? 0) + 1);
  }
  let want = null;
  let most = -1;
  for (const [cls, n] of count) {
    if (n > most) {
      most = n;
      want = cls;
    }
  }
  if (!want) return [...(useRelics ? afford : afford.filter((o) => o.kind !== "relic"))].sort(byCost)[0] ?? null;
  const mine = (o) => o.breed?.cls === want;
  const pool = useRelics ? afford : afford.filter((o) => o.kind !== "relic");
  return (
    // 몰빵 직업의 유물이 최우선 — 조건을 이미 채우고 있으므로 대가만 남지 않는다.
    (useRelics ? pool.find((o) => o.kind === "relic" && o.relic?.condition?.cls === want) : null) ??
    [...pool].filter((o) => o.kind === "upgrade" && mine(o)).sort(byCost)[0] ??
    [...pool].filter((o) => o.kind === "recruit" && mine(o)).sort(byCost)[0] ??
    // 곁가지를 몰빵 직업으로 바꾼다. 조건(3마리 이상)을 채우는 유일한 지렛대일 때가 있다.
    [...pool].filter((o) => o.kind === "replace" && mine(o)).sort(byCost)[0] ??
    [...pool].filter((o) => o.kind !== "relic" && o.kind !== "replace").sort(byCost)[0] ??
    null
  );
}

export const BUY_POLICIES = {
  "아무것도 안 삼": () => null,
  "무작위 구매": (afford, state) => afford[Math.floor(buyRng(state)() * afford.length)],
  "가장 싼 것": (afford) => [...afford].sort((a, b) => a.cost - b.cost)[0],
  "가장 비싼 것(현재)": (afford) => [...afford].sort(byCost)[0],
  "강화만": (afford) => afford.filter((o) => o.kind === "upgrade")[0] ?? null,
  "영입만": (afford) => afford.filter((o) => o.kind === "recruit")[0] ?? null,
  "몰빵 피벗(로스터를 읽음)": (afford, state) => pivot(state, afford),
  /**
   * 같은 피벗인데 유물만 안 산다.
   *
   * 구매 축의 깊이가 **유물 축의 그림자인지**를 가르는 칸이다. 몰빵 피벗은
   * 직업을 모으는 정책이고 유물 조건도 직업 수라, 둘이 같은 것을 재고 있을
   * 수 있다. 유물을 끄고도 깊이가 남으면 두 축은 독립이다.
   */
  "몰빵 피벗(유물 제외)": (afford, state) => pivot(state, afford, false),
};

/**
 * 봇의 "무작위 구매" 선택용 난수 — **런마다 그 런의 시드에서** 뽑는다.
 *
 * 예전에는 프로세스 전역 LCG 하나를 모든 런이 이어 썼다. 그러면 같은 런도 앞서 돈 런 수에 따라
 * 다른 카드를 집고, 정책 순서를 바꾸거나 워커에 나누면 수치가 흔들린다. 게임 난수(`rng`)와는
 * 갈라 둔다 — 게임 난수를 먹으면 구매 선택이 전투 난수를 밀어 다른 런이 된다.
 */
const buyRngs = new WeakMap();
function buyRng(state) {
  let r = buyRngs.get(state);
  if (!r) {
    r = makeRng(mixSeed(state.seed >>> 0, 0x5eed));
    buyRngs.set(state, r);
  }
  return r;
}

/* ------------------------------------------------------------------ */
/* 배치 정책 — placement-space·clear-space가 쓴다 (2026-08-23 여기로 모음)  */
/* ------------------------------------------------------------------ */

export function livingUnits(state) {
  const out = [];
  state.ally.forEach((c) => {
    if (c && c.alive) out.push(c);
  });
  return out;
}

/**
 * 고양이 목록을 원하는 셀로 옮긴다.
 *
 * 이전 구현은 `occupied()`가 준 보드 순서와 원하는 셀 목록의 순서가 어긋나서
 * "역할 반대" 배치가 실제로는 역할을 뒤집지 않았다. 그래서 배치 격차가
 * 2.3으로 과소 측정됐다. 고양이와 목적지를 같은 인덱스로 짝지어야 한다.
 */
function put(state, cats, wanted) {
  cats.forEach((cat, i) => {
    const to = wanted[i];
    if (to === undefined) return;
    const from = state.ally.indexOf(cat);
    if (from >= 0 && from !== to) moveCat(state, from, to);
  });
}

const CENTER_OUT = [2, 1, 3, 0, 4];
/** 열 0이 우리 뒷줄, 열 4가 적과 맞닿는 앞줄이다. */
const cellsIn = (col) => CENTER_OUT.map((r) => r * BOARD_COLS + col);

/** (행, 열) → 셀 번호. formation-space의 cell()과 같은 규칙이다. */
const c2 = (row, col) => row * BOARD_COLS + col;

export const ARRANGERS = {
  "그대로 (bestFreeCell)": null,

  "한 칸에 몰기": (state) => {
    const cells = [4, 3, 2, 1, 0].flatMap(cellsIn);
    put(state, livingUnits(state), cells);
  },

  "역할 반대 (근접 뒤)": (state) => {
    const u = livingUnits(state);
    const melee = u.filter((c) => c.breed.kind === "melee");
    const ranged = u.filter((c) => c.breed.kind === "ranged");
    const front = cellsIn(BOARD_COLS - 1);
    const back = cellsIn(0);
    // 원거리를 앞줄에, 근접을 뒷줄에 — 정확히 반대로 세운다.
    put(state, [...ranged, ...melee], [
      ...ranged.map((_, i) => front[i % front.length]),
      ...melee.map((_, i) => back[i % back.length]),
    ]);
  },

  /**
   * 감싸기 — 원거리를 가운데 두고 근접이 둘러싼다.
   * `formation-space.mjs`의 같은 이름 대형과 자리를 맞춘다.
   */
  "감싸기 (원거리 보호)": (state) => {
    const u = livingUnits(state);
    const melee = u.filter((c) => c.breed.kind === "melee");
    const ranged = u.filter((c) => c.breed.kind === "ranged");
    const ring = [c2(1, 2), c2(2, 3), c2(3, 2), c2(0, 2), c2(4, 2), c2(2, 4)];
    const core = [c2(1, 1), c2(2, 1), c2(3, 1), c2(0, 1), c2(4, 1), c2(2, 0)];
    put(state, [...melee, ...ranged], [
      ...melee.map((_, i) => ring[i % ring.length]),
      ...ranged.map((_, i) => core[i % core.length]),
    ]);
  },

  /**
   * **다음 보스를 보고 대형을 고른다.** 상황을 읽는 유일한 정책이다.
   *
   * 나머지는 판 내내 같은 대형을 쓴다. 구매 축에서 똑같은 실수를 했다가
   * 로스터를 읽는 정책을 넣으니 0.9가 2.5로 바뀌었다 — **재는 정책이 없으면
   * 있는 깊이도 0으로 나온다.**
   *
   * 매핑은 `npm run formation`의 실측이다(예고당 잘못 선 마리수, 낮을수록 유리):
   *   무쇠발톱  분산 2.00 · 뭉침 2.67 · 감싸기 2.83 · 정석 2.85
   *   살금이    정석 1.82 · 감싸기 1.83 · 뭉침 2.00 · 분산 2.02
   *   서리귀    감싸기 2.33 · 정석 2.48 · 분산 2.72 · 뭉침 2.83
   */
  "보스 읽고 고름": (state) => {
    const boss = bossForIndex(bossIndexAt(state));
    if (boss?.id === 9) return ARRANGERS["세로로 분산"](state); // 무쇠발톱 → 분산
    if (boss?.id === 11) return ARRANGERS["감싸기 (원거리 보호)"](state); // 서리귀 → 감싸기
    // 살금이(10)는 정석이 최선이고 그게 기본 배치와 같은 꼴이다.
  },

  "세로로 분산": (state) => {
    const u = livingUnits(state);
    const melee = u.filter((c) => c.breed.kind === "melee");
    const ranged = u.filter((c) => c.breed.kind === "ranged");
    const front = cellsIn(BOARD_COLS - 1);
    const back = [...cellsIn(0), ...cellsIn(1)];
    put(state, [...melee, ...ranged], [
      ...melee.map((_, i) => front[i % front.length]),
      ...ranged.map((_, i) => back[i % back.length]),
    ]);
  },
  /**
   * **같은 직업을 한 열에 세로로 붙인다.** 인접 보너스(`BALANCE.adjacencyAtk`, 2026-08-23 채택)를
   * 최대로 받는 대형이다. 근접 직업은 앞 열(4·3)부터, 원거리는 뒷 열(0·1)부터 한 직업씩
   * 차지한다. `CENTER_OUT` 순서(2·1·3·0·4)는 새 칸이 늘 앞서 놓은 칸과 맞닿는다.
   *
   * 측정에서 이 정책은 자동 배치보다 **못했다**(7.8 vs 8.3) — 보너스가 정답이 아니라 대형의
   * 일부라는 증거로 남겨 둔다. 이득은 근접을 한 열에 세우는 "세로로 분산"이 가져간다.
   */
  "같은 직업 붙이기": (state) => {
    const u = livingUnits(state);
    const byClass = new Map();
    for (const c of u) {
      if (!byClass.has(c.breed.cls)) byClass.set(c.breed.cls, []);
      byClass.get(c.breed.cls).push(c);
    }
    const meleeCols = [BOARD_COLS - 1, BOARD_COLS - 2, 2];
    const rangedCols = [0, 1, 2];
    let mi = 0;
    let ri = 0;
    const used = new Set();
    const cats = [];
    const cells = [];
    for (const group of byClass.values()) {
      const melee = group[0].breed.kind === "melee";
      const cols = melee ? meleeCols : rangedCols;
      const col = cols[Math.min(cols.length - 1, melee ? mi++ : ri++)];
      for (const cat of group) {
        let cell = cellsIn(col).find((x) => !used.has(x));
        if (cell === undefined) {
          for (const c of cols) {
            cell = cellsIn(c).find((x) => !used.has(x));
            if (cell !== undefined) break;
          }
        }
        if (cell === undefined) continue;
        used.add(cell);
        cats.push(cat);
        cells.push(cell);
      }
    }
    put(state, cats, cells);
  },
};
