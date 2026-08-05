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

export function breedById(id: number): Breed {
  const b = BREEDS.find((x) => x.id === id);
  if (!b) throw new Error(`알 수 없는 품종 id: ${id}`);
  return b;
}

export const ALL_COLORS = [...new Set(BREEDS.map((b) => b.color))];
