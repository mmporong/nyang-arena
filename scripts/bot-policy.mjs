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
import { relicActive } from "../src/game/run.ts";
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
