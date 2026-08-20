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
import { buyOffer, chooseNode, mapStep, moveCat, relicActive, rerollOffers, syncStage } from "../src/game/run.ts";
import { isBossStep, openLanes } from "../src/game/map.ts";
import { rng } from "../src/game/rng.ts";
import { livingCats } from "../src/game/types.ts";

/**
 * 예고를 읽고 반응한다. 사람처럼 조금 늦고 가끔 놓친다 —
 * 완벽하게 반응하는 봇은 상한이지 기준선이 아니다.
 */
export function makeBossBot() {
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
      return;
    }
    since = tg === lastTelegraph ? since + 1 : 0;
    if (tg !== lastTelegraph) seen += 1;
    lastTelegraph = tg;
    // 네 번에 한 번 놓치고 두 틱 늦게 반응한다.
    if (seen % 4 !== 3 && since >= 2) {
      s.pending.push({ kind: tg.mode === "gather" ? "gather" : "dodge" });
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
export function walkMap(s, pick = MAP_POLICIES["무작위"]) {
  syncStage(s);
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
  if (!chooseNode(s, idx)) chooseNode(s, open[0]);
}

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
    const next = mapStep(s) + 1;
    const find = (k) => open.find((i) => row[i]?.kind === k);
    if (isBossStep(next) && s.bonusDodge === 0) {
      const shop = find("shop");
      if (shop !== undefined) return shop;
    }
    if (s.relics.length === 0) {
      const elite = find("elite");
      if (elite !== undefined) return elite;
    }
    return find("battle") ?? open[0];
  },
};
