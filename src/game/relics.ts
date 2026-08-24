import type { EffectKey } from "../validate/synergy-schema.ts";
import type { ClassKind } from "./types.ts";

/**
 * 유물은 조건을 맞추면 큰 이득을 주고, 조건과 무관한 대가를 항상 적용한다.
 * 보스 승리 뒤 별도 3장 드래프트에서 하나만 고른 다음 일반 상점으로 이어진다.
 * 수치는 `scripts/relic-space.mjs`가 같은 직업 빌드의 유물 on/off를 비교해 검증한다.
 */

/** 유물이 요구하는 팀 상태. 열 0은 뒷줄, 열 4는 앞줄이다. */
export type RelicCondition =
  | { kind: "class_count"; cls: ClassKind; min: number }
  | { kind: "unit_max"; max: number }
  | { kind: "unit_min"; min: number }
  | { kind: "level_min"; min: number }
  | { kind: "breed_variety"; min: number }
  /** 앞줄(열 4)에 근접이 min마리 이상 */
  | { kind: "front_melee"; min: number }
  /** 뒷줄(열 0)에 원거리가 min마리 이상 */
  | { kind: "back_ranged"; min: number }
  /** 서로 다른 행을 min개 이상 쓴다 — 흩어져 서야 켜진다 */
  | { kind: "row_spread"; min: number };

export interface RelicEffect {
  key: EffectKey;
  value: number;
}

/** 스탯이 아니라 전투 시작 규칙을 바꾸는 보너스. */
export type RelicRule =
  /** 전투가 시작될 때 가장 앞선 고양이가 소환수를 부른다 */
  | { kind: "summon"; spec: "mirror" | "kitten" };

export interface Relic {
  readonly id: string;
  readonly name: string;
  /** 조건을 사람 말로. 카드에 그대로 뜬다. */
  readonly want: string;
  /** 대가를 사람 말로. */
  readonly toll: string;
  /** 얻는 것을 사람 말로. 드래프트 카드에 정확한 이득을 표시한다. */
  readonly gain: string;
  readonly cost: number;
  readonly condition: RelicCondition;
  /** 조건을 채웠을 때만 붙는다. 규칙 유물은 대신 boonRule을 쓴다. */
  readonly boon?: RelicEffect;
  /** 조건을 채웠을 때만 작동하는 규칙 보너스 */
  readonly boonRule?: RelicRule;
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
    gain: "체력 ×1.74",
    toll: "공격력 15% 감소",
    cost: 9,
    condition: { kind: "class_count", cls: "warrior", min: 3 },
    // 전사의 이미 높은 생존력을 더 키우되 화력을 희생한다.
    boon: { key: "hp_mul", value: 1.74 },
    bane: { key: "atk_mul", value: 0.85 },
  },
  {
    id: "shadow_claw",
    name: "그림자 발톱",
    want: "도적 3마리 이상",
    gain: "공격력 ×2",
    toll: "체력 30% 감소",
    cost: 10,
    condition: { kind: "class_count", cls: "rogue", min: 3 },
    // 도약 화력을 키우지만 낮아진 체력 때문에 실패 위험도 커진다.
    boon: { key: "atk_mul", value: 2.0 },
    bane: { key: "hp_mul", value: 0.7 },
  },
  {
    id: "hawk_eye",
    name: "매의 눈",
    want: "궁수 3마리 이상",
    gain: "공격 속도 ×2.8",
    toll: "체력 15% 감소",
    cost: 9,
    condition: { kind: "class_count", cls: "archer", min: 3 },
    boon: { key: "atkspd_mul", value: 2.8 },
    bane: { key: "hp_mul", value: 0.85 },
  },
  {
    id: "stardust_rod",
    name: "별가루 지팡이",
    want: "마법사 3마리 이상",
    gain: "공격력 ×2",
    toll: "체력 25% 감소",
    cost: 11,
    condition: { kind: "class_count", cls: "mage", min: 3 },
    boon: { key: "atk_mul", value: 2.0 },
    bane: { key: "hp_mul", value: 0.75 },
  },
  {
    // unit_max 4였다. 유닛 한도가 10까지 올라가는 게임에서 "4마리 이하"는
    // 아무도 안 고르는 조건이라 120런 동안 **한 번도 안 켜졌고 한 번도 안
    // 팔렸다.** 앞줄에 근접 셋을 세우는 것으로 바꾼다 — 살 수 있는 조건이면서
    // 공짜가 아니다(뒤가 얇아진다).
    id: "lone_hunter",
    name: "앞발 맹세",
    want: "앞줄에 근접 3마리",
    gain: "공격력 ×2.08",
    toll: "공격 속도 15% 감소",
    cost: 12,
    condition: { kind: "front_melee", min: 3 },
    boon: { key: "atk_mul", value: 2.08 },
    bane: { key: "atkspd_mul", value: 0.85 },
  },
  {
    // unit_min 8이었다. 한도가 10이라 후반에는 가만히 있어도 99% 켜졌다.
    // 뒷줄 원거리 넷으로 바꾼다. 셋이면 자동 배치가 71% 만들어 줘서 조건이
    // 아니고, 넷이면 34%다. 앞발 맹세와 정반대를 요구하므로 둘을 같이 켜려면
    // 일곱을 양 끝에 몰아야 하고, 그러면 가운데가 빈다.
    id: "the_swarm",
    name: "뒷자리 약속",
    want: "뒷줄에 원거리 4마리",
    gain: "체력 ×1.48",
    toll: "공격력 10% 감소",
    cost: 10,
    condition: { kind: "back_ranged", min: 4 },
    boon: { key: "hp_mul", value: 1.48 },
    bane: { key: "atk_mul", value: 0.9 },
  },
  {
    // level_min 4였다. 비용 12를 낼 때쯤이면 이미 레벨 4라 99% 켜졌다.
    // 문턱을 올려 **강화에 몰아야만** 닿게 한다. 영입과 강화 사이의 선택이
    // 실제로 갈리는 자리다.
    id: "crown",
    name: "왕관",
    want: "Lv.6 이상 한 마리",
    gain: "공격력 ×1.6",
    toll: "체력 15% 감소",
    cost: 12,
    condition: { kind: "level_min", min: 6 },
    boon: { key: "atk_mul", value: 1.6 },
    bane: { key: "hp_mul", value: 0.85 },
  },
  {
    // breed_variety 5였다. 여덟 종에서 다섯 종을 모으는 건 아무렇게나 사도
    // 되는 일이라 92% 켜졌다. 다섯 행을 다 쓰는 것으로 바꾼다 — 광역기에
    // 통째로 맞지 않으려면 흩어야 하는데, 흩으면 근접이 앞에 못 뭉친다.
    id: "rainbow_bell",
    name: "무지개 방울",
    want: "다섯 행에 흩어 서기",
    gain: "회피 +26%p",
    toll: "공격 속도 10% 감소",
    cost: 10,
    condition: { kind: "row_spread", min: 5 },
    boon: { key: "evade_add", value: 0.26 },
    bane: { key: "atkspd_mul", value: 0.9 },
  },
  {
    /**
     * 다섯 번째 직업의 몫. 나머지 넷과 같은 꼴(직업 3마리 조건 + 스탯 보너스)로
     * 맞췄다 — 소환사만 직업 유물이 없으면 그 직업으로 몰빵할 이유가 없고,
     * `relic-space`의 몰빵 정책 다섯 중 하나가 빈손으로 도는 셈이 된다.
     *
     * 보너스를 공격 속도로 준 이유: 소환사의 값은 자기 평타가 아니라 **소환
     * 주기**다. 마나가 평타로 차므로 손이 빨라지면 몸을 더 자주 내보낸다.
     * 공격력을 주면 여덟 직업 중 가장 낮은 DPS를 조금 올릴 뿐이다.
     */
    id: "hollow_bell",
    name: "빈 종",
    want: "소환사 3마리 이상",
    gain: "공격 속도 ×2.6",
    toll: "체력 20% 감소",
    cost: 10,
    condition: { kind: "class_count", cls: "summoner", min: 3 },
    // 평타로 마나를 채우는 소환사의 소환 주기를 줄인다.
    boon: { key: "atkspd_mul", value: 2.6 },
    bane: { key: "hp_mul", value: 0.8 },
  },
  {
    // 앞줄 넷이라는 진형 대가를 지불하면 화력 대신 맞아 줄 몸을 늘린다.
    id: "mirror_charm",
    name: "분신 부적",
    want: "앞줄에 근접 4마리",
    gain: "맨 앞 고양이가 분신 둘을 부른다",
    toll: "체력 12% 감소",
    cost: 11,
    condition: { kind: "front_melee", min: 4 },
    boonRule: { kind: "summon", spec: "mirror" },
    bane: { key: "hp_mul", value: 0.88 },
  },
  {
    /**
     * 뒷줄 원거리를 세 마리 이상 세우면 새끼가 한 마리 붙는다.
     *
     * 새끼는 분신보다 작고 오래 간다. 뒷줄이 두꺼울수록 앞이 얇아지므로,
     * 그 얇아진 앞을 대신 채우는 성격이다 — 조건과 보상이 같은 방향을
     * 가리키면 유물이 그냥 보너스가 되고, 반대를 가리켜야 결정이 된다.
     */
    id: "kitten_basket",
    name: "새끼 바구니",
    want: "뒷줄에 원거리 3마리",
    gain: "맨 앞 고양이가 새끼를 부른다",
    toll: "공격력 10% 감소",
    cost: 9,
    condition: { kind: "back_ranged", min: 3 },
    boonRule: { kind: "summon", spec: "kitten" },
    bane: { key: "atk_mul", value: 0.9 },
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
    if (!r.boon && !r.boonRule) {
      problems.push(`${r.id}: 보너스가 없다 (boon도 boonRule도 없음)`);
    }
    if (!r.gain.trim()) problems.push(`${r.id}: 얻는 것 설명이 없다`);
    if (r.boon && r.boon.key !== "evade_add" && r.boon.value <= 1) {
      problems.push(`${r.id}: 보너스 값이 이익이 아님 (${r.boon.value})`);
    }
    if (r.cost <= 0) problems.push(`${r.id}: 비용이 0 이하`);
  }
  return problems;
}
