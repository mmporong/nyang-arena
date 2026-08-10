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
import { buyOffer, chooseNode, mapStep, relicActive, rerollOffers, syncStage } from "../src/game/run.ts";
import { openLanes } from "../src/game/map.ts";
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
    if (s.enemy.some((c) => c?.alive && c.vulnerableMs > 0)) {
      s.pending.push({ kind: "strike" });
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
 * @returns "bought" 샀다 · "rerolled" 다시 뽑았다 · "leave" 더 할 일이 없다
 */
export function shopStep(s, st) {
  const byCost = (a, b) =>
    (a.kind === "replace" ? 1 : 0) - (b.kind === "replace" ? 1 : 0) || b.cost - a.cost;

  const pick = [...affordable(s)].sort(byCost)[0];
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
  const idx = pick(open, row) ?? open[0];
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
};
