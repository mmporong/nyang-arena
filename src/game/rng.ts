/**
 * 게임플레이 난수.
 *
 * 시드가 없으면 같은 코드를 두 번 돌려도 다른 수치가 나와서, 밸런스를 바꿨을 때
 * 좋아진 것인지 노이즈인지 판정할 수 없다. 실제로 결정공간 측정에서 무작위 구매
 * 중앙값이 13, 13, 14로 흔들렸다 — 감지하려는 변화폭과 노이즈가 같았다.
 *
 * **모듈 전역인 이유:** 전투 판정(회피)에는 `RunState`가 닿지 않는다. 프로세스당
 * 활성 런이 하나라는 전제이고, 시뮬은 런을 순차로 돌리며 브라우저는 런이 하나다.
 *
 * **연출용 난수는 여기를 쓰지 않는다.** 파티클 위치 같은 것은 헤드리스에서 아예
 * 돌지 않으므로, 시드를 태우면 같은 시드인데도 브라우저와 시뮬의 난수 소비 횟수가
 * 갈려서 오히려 재현성이 깨진다.
 */

let state = 1;
let calls = 0;

/** 0은 mulberry32의 고정점이라 1로 밀어낸다. */
export function seedRng(seed: number): void {
  state = seed >>> 0 || 1;
  calls = 0;
}

/** 지금까지 소비한 난수 개수. 파리티 테스트가 이걸 비교한다. */
export function rngCalls(): number {
  return calls;
}

/** mulberry32 한 걸음. 전역 스트림과 독립 스트림이 같은 식을 쓴다. */
function step(s: number): { next: number; value: number } {
  const next = (s + 0x6d2b79f5) >>> 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return { next, value: ((t ^ (t >>> 14)) >>> 0) / 4294967296 };
}

/** mulberry32. 32비트 상태로 충분히 고르고, 의존성 없이 몇 줄이면 된다. */
export function rng(): number {
  calls += 1;
  const r = step(state);
  state = r.next;
  return r.value;
}

/**
 * **전역 스트림과 무관한 독립 난수기.**
 *
 * 왜 필요한가. 전역 스트림은 런당 하나인데, 전투의 회피 판정이 공격 횟수만큼
 * 난수를 먹는다. 그래서 정책이 조금만 달라도 소비 횟수가 갈리고, **그 뒤에
 * 생성되는 지도가 통째로 달라진다.** 같은 시드로 두 정책을 비교해도 짝비교가
 * 아니라 독립 표본이 되는 것이다 — 결정 축 셋의 잡음 밴드가 넓은 이유가
 * 여기 있다(지도 1.5/0.7/0.8, 배치 0.8/1.2/0.6, 유물 2.5/3.4/2.8).
 *
 * 지도를 이 줄기로 옮기면 같은 시드는 정책과 무관하게 **같은 지도**를 낸다.
 * 통계에서 말하는 공통 난수(common random numbers)이고, 판수를 늘리는 것보다
 * 훨씬 싸게 분산을 줄인다.
 */
export function makeRng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    const r = step(s);
    s = r.next;
    return r.value;
  };
}

/**
 * 시드와 갈래 번호를 섞어 서로 다른 줄기를 만든다.
 *
 * 그냥 더하면 (시드 1, 스테이지 2)와 (시드 2, 스테이지 1)이 같은 줄기가 된다.
 * 황금비 상수를 곱해 흩어 놓는다.
 */
export function mixSeed(seed: number, branch: number): number {
  let h = (seed >>> 0) ^ Math.imul(branch + 1, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * 제자리 Fisher-Yates.
 *
 * 예전에는 `sort(() => Math.random() - 0.5)`를 썼는데 이건 **고른 셔플이 아니다** —
 * 비교 함수가 비일관적이라 엔진의 정렬 구현에 따라 원소별 위치 분포가 치우친다.
 * 시너지 추첨과 오퍼 풀에 쓰이고 있었으므로 판마다 나오는 조합이 편향돼 있었다.
 */
export function shuffle<T>(list: T[]): T[] {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = list[i]!;
    const b = list[j]!;
    list[i] = b;
    list[j] = a;
  }
  return list;
}
