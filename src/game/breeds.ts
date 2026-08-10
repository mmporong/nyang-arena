import type { Breed } from "./types.ts";

/**
 * 고양이 8마리 = 직업 4종 × 2마리. **같은 직업이라도 스킬은 서로 다르다.**
 *
 * 여덟 중 여섯은 **액티브**(마나가 차면 터진다), 둘은 **패시브**(마나 없이 늘 켜져 있다).
 * 3:1로 둔 이유는 액티브가 판을 뒤집는 순간을 만들기 때문이다. 패시브는 그 사이를
 * 채우는 성격이다.
 *
 * 패시브로 돌린 둘은 원래 액티브와 개념이 겹쳤다 — 삼색이의 "3명에게 쏜다"와
 * 도탄, 줄줄이의 "4연타"와 연격. 자연스럽게 전환된다.
 *
 * 마나: 공격할 때마다 manaPerAttack만큼 차고, 100이 되면 스킬을 쓰고 0으로 돌아간다.
 * TFT가 역할마다 마나 획득량을 다르게 두는 것과 같은 이유로 직업별로 갈랐다 —
 * 전사는 4번(25), 궁수·마법사는 3번(34), 도적은 2번(50)에 터진다.
 * 도적이 자주 터지는 대신 한 방이 약하고, 전사는 드물게 터지는 대신 판을 뒤집는다.
 *
 * 스탯 설계
 * - 전사: 체력 최상, 공격 낮음. 앞에서 버틴다
 * - 도적: 체력 낮음, 공격·속도 최상. 빨리 붙어 터뜨린다
 * - 궁수: 중간 체력, 안정적인 물리 화력
 * - 마법사: 체력 최하, 사거리 최장, 공격 느림. 스킬로 판을 흔든다
 *
 * 측정 후 조정: 평타 기준 전력이 마법사 1 대 도적 4로 벌어져 있었다. 마법사가
 * 스킬 세 번 쓸 때까지 버티질 못했다. 사거리와 스킬이 강한 건 맞지만 4배는 과했다.
 */
export const BREEDS: readonly Breed[] = [
  // ── 전사 ─────────────────────────────────────────────
  {
    id: 1, name: "턱시도", color: "black", cls: "warrior", kind: "melee",
    hp: 150, atk: 20, atkInterval: 560, range: 0.8, moveSpeed: 1.7,
    manaPerAttack: 28, skill: "whirlwind", passive: null, cost: 3,
  },
  {
    id: 7, name: "몽실이", color: "gray", cls: "warrior", kind: "melee",
    hp: 190, atk: 16, atkInterval: 640, range: 0.9, moveSpeed: 1.4,
    manaPerAttack: 28, skill: "shockwave", passive: null, cost: 4,
  },

  // ── 도적 ─────────────────────────────────────────────
  {
    id: 3, name: "까망이", color: "black", cls: "rogue", kind: "melee",
    hp: 95, atk: 29, atkInterval: 430, range: 0.8, moveSpeed: 2.4,
    manaPerAttack: 50, skill: "shadow_strike", passive: null, cost: 4,
  },
  {
    id: 4, name: "줄줄이", color: "gray", cls: "rogue", kind: "melee",
    hp: 110, atk: 22, atkInterval: 440, range: 0.8, moveSpeed: 2.1,
    manaPerAttack: 0, skill: null, passive: "combo", cost: 3,
  },

  // ── 궁수 ─────────────────────────────────────────────
  {
    id: 8, name: "호랑이", color: "orange", cls: "archer", kind: "ranged",
    hp: 112, atk: 27, atkInterval: 540, range: 2.8, moveSpeed: 1.2,
    manaPerAttack: 34, skill: "pierce", passive: null, cost: 4,
  },
  {
    id: 6, name: "삼색이", color: "calico", cls: "archer", kind: "ranged",
    hp: 108, atk: 24, atkInterval: 510, range: 2.8, moveSpeed: 1.2,
    manaPerAttack: 0, skill: null, passive: "ricochet", cost: 4,
  },

  // ── 마법사 ───────────────────────────────────────────
  {
    id: 2, name: "꿀밤이", color: "cream", cls: "mage", kind: "ranged",
    hp: 98, atk: 24, atkInterval: 660, range: 3.0, moveSpeed: 1.0,
    manaPerAttack: 34, skill: "ember", passive: null, cost: 4,
  },
  {
    id: 5, name: "하양이", color: "white", cls: "mage", kind: "ranged",
    hp: 94, atk: 21, atkInterval: 630, range: 2.9, moveSpeed: 1.0,
    manaPerAttack: 34, skill: "frost_nova", passive: null, cost: 4,
  },
];

/**
 * 악몽이 쓰는 여덟 마리. **우리 고양이와 한 마리도 겹치지 않는다.**
 *
 * 전에는 적도 `BREEDS`에서 뽑았다. "악몽은 형체가 없어서 잠든 사람이 아는 모습을
 * 빌려 쓴다"는 설정으로 정당화했지만, 실제로는 난전 한가운데서 **내 하양이와 적
 * 하양이가 같은 그림**이었다. 발밑 고리 색과 좌우 반전만으로 갈라야 했는데,
 * 셋이 겹쳐 있으면 그 고리가 서로를 가린다.
 *
 * 시트에 20종이 있는데 우리가 8종, 보스가 9~12번을 쓰고 13~20번이 놀고 있었다.
 * 정확히 여덟 장이 남아서 1:1로 갈라진다.
 *
 * **순서가 곧 계약이다.** `enemyBreedIds`는 `(wave*3 + i*5) % 8`로 뽑으므로,
 * 이 배열의 i번째가 `BREEDS`의 i번째와 직업·스탯·스킬이 같아야 웨이브 구성이
 * 예전과 완전히 동일하게 유지된다. 지금 바꾸는 것은 **누구로 보이는가**뿐이고
 * 밸런스는 건드리지 않는다 — `npm run sim` 분포가 그대로인 것으로 확인한다.
 * 새 품종을 끼워 넣거나 순서를 섞으면 그 보증이 깨진다.
 *
 * `cost`는 전부 0이다. 악몽은 상점에 안 나온다 — 오퍼는 `BREEDS`만 본다.
 * 처음엔 우리 쪽 값을 그대로 베꼈는데, 그러면 "팔지 않는 것"에 값이 붙어 있어
 * 계약이 흐려진다. 보스도 같은 이유로 0이다.
 *
 * 이름은 나쁜 밤에 겪는 것에서 따왔다. 우리 고양이와 같은 `-이` 꼴을 쓰는 것은
 * 같은 세계의 것이기 때문이고, 뜻이 하나같이 불편한 것은 같은 편이 아니기
 * 때문이다.
 */
export const NIGHTMARE_BREEDS: readonly Breed[] = [
  // ── 전사 ─────────────────────────────────────────────
  // 문틈으로 들어온 것. 검은 등에 흰 배라 우리 턱시도와 헷갈릴 뻔했지만
  // 무늬가 뒤집혀 있다.
  {
    id: 20, name: "문틈이", color: "black", cls: "warrior", kind: "melee",
    hp: 150, atk: 20, atkInterval: 560, range: 0.8, moveSpeed: 1.7,
    manaPerAttack: 28, skill: "whirlwind", passive: null, cost: 0,
  },
  // 가슴 위에 올라앉는 것. 여덟 중 가장 두껍고 가장 느리다.
  {
    id: 16, name: "덮침이", color: "gray", cls: "warrior", kind: "melee",
    hp: 190, atk: 16, atkInterval: 640, range: 0.9, moveSpeed: 1.4,
    manaPerAttack: 28, skill: "shockwave", passive: null, cost: 0,
  },

  // ── 도적 ─────────────────────────────────────────────
  // 감아도 보이는 눈. 우리 까망이와 같은 검정이지만 눈테가 노랗다.
  {
    id: 19, name: "뜬눈이", color: "black", cls: "rogue", kind: "melee",
    hp: 95, atk: 29, atkInterval: 430, range: 0.8, moveSpeed: 2.4,
    manaPerAttack: 50, skill: "shadow_strike", passive: null, cost: 0,
  },
  // 지나가며 스치는 것. 때릴수록 빨라진다.
  {
    id: 15, name: "스침이", color: "gray", cls: "rogue", kind: "melee",
    hp: 110, atk: 22, atkInterval: 440, range: 0.8, moveSpeed: 2.1,
    manaPerAttack: 0, skill: null, passive: "combo", cost: 0,
  },

  // ── 궁수 ─────────────────────────────────────────────
  // 밤새 우는 것.
  {
    id: 13, name: "울음이", color: "orange", cls: "archer", kind: "ranged",
    hp: 112, atk: 27, atkInterval: 540, range: 2.8, moveSpeed: 1.2,
    manaPerAttack: 34, skill: "pierce", passive: null, cost: 0,
  },
  // 이름을 부르는 것. 맞은 것 근처로 튕긴다.
  {
    id: 17, name: "부름이", color: "orange", cls: "archer", kind: "ranged",
    hp: 108, atk: 24, atkInterval: 510, range: 2.8, moveSpeed: 1.2,
    manaPerAttack: 0, skill: null, passive: "ricochet", cost: 0,
  },

  // ── 마법사 ───────────────────────────────────────────
  // 침대 밑 먼지가 뭉친 것.
  {
    id: 18, name: "먼지털", color: "cream", cls: "mage", kind: "ranged",
    hp: 98, atk: 24, atkInterval: 660, range: 3.0, moveSpeed: 1.0,
    manaPerAttack: 34, skill: "ember", passive: null, cost: 0,
  },
  // 목덜미에 닿는 찬 숨.
  {
    id: 14, name: "입김이", color: "white", cls: "mage", kind: "ranged",
    hp: 94, atk: 21, atkInterval: 630, range: 2.9, moveSpeed: 1.0,
    manaPerAttack: 34, skill: "frost_nova", passive: null, cost: 0,
  },
];

/**
 * 두 명단을 함께 뒤진다.
 *
 * 적 스폰이 이 함수로 `Breed`를 되찾으므로 악몽 쪽도 여기서 나와야 한다.
 * id가 겹치지 않으므로(우리 1~8, 보스 9~12, 악몽 13~20) 어느 쪽에서 나왔든
 * 답은 하나뿐이다.
 */
export function breedById(id: number): Breed {
  const b = BREEDS.find((x) => x.id === id) ?? NIGHTMARE_BREEDS.find((x) => x.id === id);
  if (!b) throw new Error(`알 수 없는 품종 id: ${id}`);
  return b;
}

export const ALL_COLORS = [...new Set(BREEDS.map((b) => b.color))];
