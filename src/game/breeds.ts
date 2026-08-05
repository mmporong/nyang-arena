import type { Breed } from "./types.ts";

/**
 * 8/10 T1 빌드는 시트 #01~#08만 사용한다.
 * 색(color)은 시너지 트리거의 판정 기준이므로 스프라이트 외형과 반드시 일치해야 한다.
 *
 * 근접/원거리 설계:
 * - 아군 앞줄과 적 앞줄 사이는 2.5칸이다(types.ts의 FIELD_GAP).
 * - 원거리는 사거리 2.8~3.0이라 **제자리에서 바로 쏜다**. 대신 체력이 낮다.
 * - 근접은 사거리 0.8~0.9라 걸어가서 붙어야 한다. 이동 시간만큼 손해를 보는
 *   대신 체력이 높다. 그래서 근접을 앞줄에, 원거리를 뒷줄에 두는 배치가 생긴다.
 *
 * 스탯은 한 전투가 4~7초에 끝나도록 잡았다.
 */
export const BREEDS: readonly Breed[] = [
  { id: 1, name: "턱시도", color: "black", kind: "melee", hp: 120, atk: 22, atkInterval: 500, range: 0.8, moveSpeed: 1.7, cost: 3 },
  { id: 2, name: "꿀밤이", color: "cream", kind: "ranged", hp: 85, atk: 20, atkInterval: 620, range: 2.8, moveSpeed: 1.0, cost: 3 },
  { id: 3, name: "까망이", color: "black", kind: "melee", hp: 95, atk: 30, atkInterval: 460, range: 0.8, moveSpeed: 2.2, cost: 4 },
  { id: 4, name: "줄줄이", color: "gray", kind: "melee", hp: 130, atk: 20, atkInterval: 520, range: 0.8, moveSpeed: 1.5, cost: 3 },
  { id: 5, name: "하양이", color: "white", kind: "ranged", hp: 75, atk: 16, atkInterval: 420, range: 2.8, moveSpeed: 1.1, cost: 3 },
  { id: 6, name: "삼색이", color: "calico", kind: "ranged", hp: 80, atk: 28, atkInterval: 700, range: 3.0, moveSpeed: 0.9, cost: 4 },
  { id: 7, name: "몽실이", color: "gray", kind: "melee", hp: 170, atk: 15, atkInterval: 640, range: 0.9, moveSpeed: 1.2, cost: 4 },
  { id: 8, name: "호랑이", color: "orange", kind: "melee", hp: 125, atk: 27, atkInterval: 540, range: 0.8, moveSpeed: 1.8, cost: 4 },
];

export function breedById(id: number): Breed {
  const b = BREEDS.find((x) => x.id === id);
  if (!b) throw new Error(`알 수 없는 품종 id: ${id}`);
  return b;
}

export const ALL_COLORS = [...new Set(BREEDS.map((b) => b.color))];
