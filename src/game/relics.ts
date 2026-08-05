import type { EffectKey } from "../validate/synergy-schema.ts";
import type { ClassKind } from "./types.ts";

/**
 * 유물.
 *
 * 측정된 문제를 정면으로 푼다 — **무엇을 사든 결과가 같았다.** 구매 정책을
 * 무작위로 바꿔도 최선으로 바꿔도 도달 웨이브 격차가 0.9웨이브뿐이었다.
 * 고양이 여덟 종이 스탯만 다르고 역할이 같으니 어떤 조합을 사도 총합이
 * 비슷해지기 때문이다.
 *
 * 유물은 두 성질을 **반드시 함께** 갖는다.
 *
 * - **조건부**: 특정 팀 구성일 때만 크게 작동한다. 조건이 없으면 그냥 더
 *   세지는 물건이 되어 "무엇을 사든 같다"를 한 번 더 재현한다.
 * - **대가**: 조건과 무관하게 항상 붙는다. 조건을 못 맞추면 손해만 본다.
 *   대가도 조건부라면 유물은 공짜 보너스이고, 그러면 "질렀다"는 감각이 없다.
 *
 * 효과 키는 시너지의 것을 그대로 쓴다. 새 스탯 축을 만들면 밸런스를 처음부터
 * 다시 잡아야 하고, 같은 축을 쓰면 적용 코드도 공유된다.
 *
 * 데이터는 순수 테이블이다. 검증기를 만들지 않은 이유는 이 값들을 사람이 손으로
 * 쓰기 때문이다 — 검증기는 신뢰할 수 없는 입력(LLM 출력)을 막으려고 존재한다.
 * 다만 열거형 키와 수치 쌍으로 두었으므로, 나중에 생성으로 넘어갈 때 데이터
 * 형태를 바꾸지 않고 검증기만 얹으면 된다.
 */

export type RelicCondition =
  | { kind: "class_count"; cls: ClassKind; min: number }
  | { kind: "unit_max"; max: number }
  | { kind: "unit_min"; min: number }
  | { kind: "level_min"; min: number }
  | { kind: "breed_variety"; min: number };

export interface RelicEffect {
  key: EffectKey;
  value: number;
}

export interface Relic {
  readonly id: string;
  readonly name: string;
  /** 조건을 사람 말로. 카드에 그대로 뜬다. */
  readonly want: string;
  /** 대가를 사람 말로. */
  readonly toll: string;
  readonly cost: number;
  readonly condition: RelicCondition;
  /** 조건을 채웠을 때만 붙는다 */
  readonly boon: RelicEffect;
  /** 조건과 무관하게 항상 붙는다 */
  readonly bane: RelicEffect;
}

/**
 * 대가에 쓸 수 있는 효과 키.
 *
 * `evade_add`는 뺐다. 회피는 하한 클램프가 없어 음수를 넣어도 판정이
 * `random() < evade`라 애초에 거짓이다 — 즉 **대가가 아무 일도 안 한다.**
 * 곱셈 키만 대가로 쓰면 `Math.max(1, ...)`가 바닥을 잡아 준다.
 */
const BANE_KEYS: readonly EffectKey[] = ["atk_mul", "hp_mul", "atkspd_mul"];

export const RELICS: readonly Relic[] = [
  {
    id: "iron_collar",
    name: "무쇠 목걸이",
    want: "전사 3마리 이상",
    toll: "공격력 15% 감소",
    cost: 9,
    condition: { kind: "class_count", cls: "warrior", min: 3 },
    boon: { key: "hp_mul", value: 1.55 },
    bane: { key: "atk_mul", value: 0.85 },
  },
  {
    id: "shadow_claw",
    name: "그림자 발톱",
    want: "도적 3마리 이상",
    toll: "체력 30% 감소",
    cost: 10,
    condition: { kind: "class_count", cls: "rogue", min: 3 },
    // 도적은 원래 공격력이 최상인 데다 전투 시작과 함께 뒷줄로 뛰어든다.
    // 1.6을 곱했더니 도적 몰빵만 평균 18.4로 다른 몰빵(12.8~14.0)을 압도했다.
    boon: { key: "atk_mul", value: 1.32 },
    bane: { key: "hp_mul", value: 0.7 },
  },
  {
    id: "hawk_eye",
    name: "매의 눈",
    want: "궁수 3마리 이상",
    toll: "체력 15% 감소",
    cost: 9,
    condition: { kind: "class_count", cls: "archer", min: 3 },
    boon: { key: "atkspd_mul", value: 1.45 },
    bane: { key: "hp_mul", value: 0.85 },
  },
  {
    id: "stardust_rod",
    name: "별가루 지팡이",
    want: "마법사 3마리 이상",
    toll: "체력 25% 감소",
    cost: 11,
    condition: { kind: "class_count", cls: "mage", min: 3 },
    boon: { key: "atk_mul", value: 1.75 },
    bane: { key: "hp_mul", value: 0.75 },
  },
  {
    id: "lone_hunter",
    name: "고독한 사냥꾼",
    want: "고양이 4마리 이하",
    toll: "공격 속도 15% 감소",
    cost: 12,
    condition: { kind: "unit_max", max: 4 },
    boon: { key: "atk_mul", value: 1.9 },
    bane: { key: "atkspd_mul", value: 0.85 },
  },
  {
    id: "the_swarm",
    name: "우르르",
    want: "고양이 8마리 이상",
    toll: "공격력 10% 감소",
    cost: 10,
    condition: { kind: "unit_min", min: 8 },
    boon: { key: "hp_mul", value: 1.4 },
    bane: { key: "atk_mul", value: 0.9 },
  },
  {
    id: "crown",
    name: "왕관",
    want: "Lv.4 이상 한 마리",
    toll: "체력 15% 감소",
    cost: 12,
    condition: { kind: "level_min", min: 4 },
    boon: { key: "atk_mul", value: 1.5 },
    bane: { key: "hp_mul", value: 0.85 },
  },
  {
    id: "rainbow_bell",
    name: "무지개 방울",
    want: "서로 다른 품종 5종",
    toll: "공격 속도 10% 감소",
    cost: 10,
    condition: { kind: "breed_variety", min: 5 },
    boon: { key: "evade_add", value: 0.22 },
    bane: { key: "atkspd_mul", value: 0.9 },
  },
];

export function relicById(id: string): Relic | null {
  return RELICS.find((r) => r.id === id) ?? null;
}

/** 데이터 계약. npm test가 이걸 단언한다. */
export function checkRelicTable(): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const r of RELICS) {
    if (seen.has(r.id)) problems.push(`id 중복: ${r.id}`);
    seen.add(r.id);
    if (!BANE_KEYS.includes(r.bane.key)) {
      problems.push(`${r.id}: 대가에 못 쓰는 키 ${r.bane.key}`);
    }
    // 곱셈 대가는 1보다 작아야 불이익이다. 부호를 뒤집어 쓰면 오히려 강화가 된다.
    if (r.bane.value <= 0 || r.bane.value >= 1) {
      problems.push(`${r.id}: 대가 값이 불이익이 아님 (${r.bane.value})`);
    }
    if (r.boon.key !== "evade_add" && r.boon.value <= 1) {
      problems.push(`${r.id}: 보너스 값이 이익이 아님 (${r.boon.value})`);
    }
    if (r.cost <= 0) problems.push(`${r.id}: 비용이 0 이하`);
  }
  return problems;
}
