import {
  ARRANGERS,
  BUY_POLICIES,
  makeBossBot,
  MAP_POLICIES,
  RAID_CONTRACT_POLICIES,
} from "./bot-policy.mjs";

const BASE_PROFILES = Object.freeze({
  "무의식": Object.freeze({
    buy: BUY_POLICIES["무작위 구매"],
    place: null,
    respond: () => makeBossBot({ read: false }),
    map: MAP_POLICIES["무작위"],
  }),
  "기본 봇": Object.freeze({
    buy: BUY_POLICIES["가장 비싼 것(현재)"],
    place: null,
    respond: () => makeBossBot(),
    map: MAP_POLICIES["무작위"],
  }),
  "조건 충족": Object.freeze({
    buy: BUY_POLICIES["몰빵 피벗(로스터를 읽음)"],
    place: ARRANGERS["세로로 분산"],
    respond: () => makeBossBot(),
    map: MAP_POLICIES["읽고 고름"],
  }),
});

function withContract(profile, contractLabel) {
  return Object.freeze({
    ...profile,
    contract: RAID_CONTRACT_POLICIES[contractLabel],
    contractLabel,
  });
}

/**
 * 현재 제품에서 2026-08-23의 네 결정축 기준을 적용한다. 새 계약축의 정책
 * 차이가 비교를 오염시키지 않도록 세 봇 모두 같은 안전 정책으로 고정한다.
 */
export const CLEAR_BASELINE_BOTS = Object.freeze(
  Object.fromEntries(
    Object.entries(BASE_PROFILES).map(([name, profile]) => [
      name,
      withContract(profile, "위험 낮은 계약"),
    ]),
  ),
);

/**
 * 현재 제품의 다섯 결정축을 한꺼번에 쓰는 페르소나 관찰이다. 여러 축을 동시에
 * 바꾸므로 계약의 독립 효과나 기존 네 축 기준의 통과 여부를 주장하지 않는다.
 */
export const CLEAR_INTEGRATED_BOTS = Object.freeze({
  "무의식": withContract(BASE_PROFILES["무의식"], "보상 큰 계약"),
  "기본 봇": withContract(BASE_PROFILES["기본 봇"], "위험 낮은 계약"),
  "조건 충족": withContract(BASE_PROFILES["조건 충족"], "팀 읽고 고름"),
});
