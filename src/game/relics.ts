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
 * **보너스 값은 원본의 1.2배다.** 조건을 진짜 조건으로 고친 뒤(아래
 * `RelicCondition` 참고) 격차가 3.3 → 3.9웨이브까지 왔고, 관문 기준 4.0을
 * 넘기려고 균일 1.2배를 곱했다(4.3). 새로 만든 배치 조건 넷만 올려 보기도
 * 했는데 **오히려 3.2로 나빠졌다** — 측정 정책이 직업 몰빵이라 사는 것이
 * 직업 유물이기 때문이다. 어느 유물이 실제로 팔리는지를 안 보고 "어려운
 * 조건이 더 값해야 한다"는 논리만 따르면 이렇게 헛짚는다.
 *
 * **알아 둘 것: 유물 격차와 궁합(팀 성격 × 웨이브 성격)은 난이도에 대해
 * 반대로 움직인다.** 같은 유물 값으로 `enemyScale`만 1.28 → 1.30으로 올리면
 * 유물이 4.3 → 3.3으로 죽고 궁합이 6.3 → 9.3%p로 산다. 판이 쉬우면 유물이
 * 복리로 쌓일 시간이 있어 빌드가 갈리고, 어려우면 그 전에 죽어서 무엇을
 * 들고 있느냐보다 무엇과 붙느냐가 결정한다. 한쪽을 올리려고 난이도를 만지면
 * 다른 쪽이 내려가므로, **둘을 같이 올리려면 난이도가 아닌 다른 손잡이가
 * 필요하다.** 지금은 관문에 걸리는 유물 쪽을 택했다.
 *
 * 데이터는 순수 테이블이다. 검증기를 만들지 않은 이유는 이 값들을 사람이 손으로
 * 쓰기 때문이다 — 검증기는 신뢰할 수 없는 입력(LLM 출력)을 막으려고 존재한다.
 * 다만 열거형 키와 수치 쌍으로 두었으므로, 나중에 생성으로 넘어갈 때 데이터
 * 형태를 바꾸지 않고 검증기만 얹으면 된다.
 */

/**
 * 유물이 요구하는 팀 상태.
 *
 * **조건은 조건 노릇을 해야 한다.** 처음에는 여덟 중 넷이 직업 수, 나머지가
 * 유닛 수·레벨·품종 다양성이었는데 계측해 보니 그게 조건이 아니었다 —
 * 왕관(레벨 4+) 99%, 우르르(8마리+) 99%, 무지개 방울(품종 5종+) 92%로 **가만히
 * 있어도 켜졌고**, 고독한 사냥꾼(4마리 이하)은 0%로 한 번도 안 켜졌다. 늘 켜지는
 * 조건은 그냥 스탯 보너스이고, 절대 안 켜지는 조건은 없는 유물이다. 이 파일
 * 머리에 적어 둔 원칙("조건이 없으면 그냥 더 세지는 물건이 된다")을 데이터가
 * 스스로 어기고 있었다.
 *
 * 그래서 **배치를 읽는 조건**을 넣는다. 두 가지가 같이 해결된다.
 *
 * - 조건이 진짜 조건이 된다. 앞줄에 근접 셋을 세우려면 다른 것을 포기해야 한다
 * - **배치 축이 존재 이유를 얻는다.** 계측에서 배치 깊이가 0.5웨이브라
 *   "드래그는 장식"이라는 판정을 받고 있었다. 자동 배치가 이미 최선에
 *   가까웠기 때문인데, 유물이 특정 모양을 요구하면 자동 배치가 최선이 아니게 된다
 *
 * 앞/뒤 정의는 시너지(`synergy-schema.ts`)와 **같은 것을 쓴다** — 열 0이 뒷줄,
 * 열 4가 앞줄(적에게 가까운 쪽). 두 곳에서 다르게 정의하면 카드에 적힌 말과
 * 판정이 갈린다.
 */
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
    boon: { key: "hp_mul", value: 1.66 },
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
    boon: { key: "atk_mul", value: 1.38 },
    bane: { key: "hp_mul", value: 0.7 },
  },
  {
    id: "hawk_eye",
    name: "매의 눈",
    want: "궁수 3마리 이상",
    toll: "체력 15% 감소",
    cost: 9,
    condition: { kind: "class_count", cls: "archer", min: 3 },
    boon: { key: "atkspd_mul", value: 1.54 },
    bane: { key: "hp_mul", value: 0.85 },
  },
  {
    id: "stardust_rod",
    name: "별가루 지팡이",
    want: "마법사 3마리 이상",
    toll: "체력 25% 감소",
    cost: 11,
    condition: { kind: "class_count", cls: "mage", min: 3 },
    boon: { key: "atk_mul", value: 1.9 },
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
    toll: "공격 속도 10% 감소",
    cost: 10,
    condition: { kind: "row_spread", min: 5 },
    boon: { key: "evade_add", value: 0.26 },
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
