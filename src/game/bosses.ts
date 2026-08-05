import type { Breed } from "./types.ts";

/**
 * 보스.
 *
 * 예전 보스 웨이브는 "적 수를 반으로 줄이고 스탯 1.35배"였다. 그래서 통과율이
 * 96%로 이 게임에서 가장 안전한 웨이브 중 하나였고, 벽이 아니라 사건이라는
 * 원래 의도에는 맞았지만 **잴 것이 없었다** — 개입을 만들어도 통과율을 15%p
 * 올릴 여지가 3%p밖에 없었다.
 *
 * 그래서 보스를 **한 마리의 큰 것**으로 다시 만든다. 3x3 칸을 차지하고 체력이
 * 두껍고 오래 싸운다. 통과율을 조절할 손잡이(`balance.ts`의 보스 항목)를 두어
 * 개입의 값을 측정할 수 있게 하는 것이 핵심이다.
 *
 * 스프라이트는 시트에서 잘라 두고 쓰지 않던 09~20번을 쓴다. 낯선 고양이가
 * 크게 앉아 있으면 "보스가 나왔다"가 한 컷에 읽힌다.
 *
 * 보스도 그냥 `Cat`이다. 별도 타입을 만들면 타겟팅·이동·피해 판정을 전부 다시
 * 써야 하는데, 반경 하나만 추가하면 기존 전투 로직이 그대로 돈다.
 */
export const BOSS_BREEDS: readonly Breed[] = [
  {
    id: 9,
    name: "무쇠발톱",
    color: "gray",
    cls: "warrior",
    kind: "melee",
    // 실제 수치는 balance.ts의 배수로 정해진다. 여기 값은 그 배수의 기준일 뿐이다.
    hp: 120,
    atk: 14,
    atkInterval: 900,
    range: 0.8,
    // 느리게 걷는다. 보스가 빠르면 뒷줄이 순식간에 지워져 배치가 무의미해진다.
    moveSpeed: 0.45,
    manaPerAttack: 0,
    skill: null,
    passive: null,
    cost: 0,
  },
];

/** 보스가 차지하는 반경(칸). 일반 고양이는 0이라 기존 계산이 그대로다. */
export const BOSS_RADIUS = 1.5;

export function bossForWave(wave: number): Breed {
  const i = Math.floor(wave / 5) % BOSS_BREEDS.length;
  return BOSS_BREEDS[i] ?? BOSS_BREEDS[0]!;
}
