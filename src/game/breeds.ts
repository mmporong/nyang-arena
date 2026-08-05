import type { Breed } from "./types.ts";

/**
 * 8/10 T1 빌드는 시트 #01~#08만 사용한다.
 * 색(color)은 시너지 트리거의 판정 기준이므로 스프라이트 외형과 반드시 일치해야 한다.
 *
 * 스탯 설계: 전투 한 판이 3~5초 안에 끝나도록 잡았다.
 * 기본 공격 간격 500ms 기준, 평균 4~6대에 한 마리가 쓰러진다.
 */
export const BREEDS: readonly Breed[] = [
  { id: 1, name: "턱시도", color: "black", hp: 110, atk: 22, atkInterval: 500, cost: 3 },
  { id: 2, name: "꿀밤이", color: "cream", hp: 130, atk: 18, atkInterval: 560, cost: 3 },
  { id: 3, name: "까망이", color: "black", hp: 90, atk: 30, atkInterval: 460, cost: 4 },
  { id: 4, name: "줄줄이", color: "gray", hp: 120, atk: 20, atkInterval: 520, cost: 3 },
  { id: 5, name: "하양이", color: "white", hp: 100, atk: 19, atkInterval: 440, cost: 3 },
  { id: 6, name: "삼색이", color: "calico", hp: 105, atk: 25, atkInterval: 500, cost: 4 },
  { id: 7, name: "몽실이", color: "gray", hp: 150, atk: 15, atkInterval: 620, cost: 4 },
  { id: 8, name: "호랑이", color: "orange", hp: 115, atk: 27, atkInterval: 540, cost: 4 },
];

export function breedById(id: number): Breed {
  const b = BREEDS.find((x) => x.id === id);
  if (!b) throw new Error(`알 수 없는 품종 id: ${id}`);
  return b;
}

export const ALL_COLORS = [...new Set(BREEDS.map((b) => b.color))];
