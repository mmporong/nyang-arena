import type { Breed } from "./types.ts";

/**
 * 고양이 8마리 = 직업 4종 × 2마리. **같은 직업이라도 스킬은 서로 다르다.**
 *
 * 여덟 중 여섯은 **액티브**(마나가 차면 터진다), 둘은 **패시브**(마나 없이 늘 켜져 있다).
 * 3:1로 둔 이유는 액티브가 판을 뒤집는 순간을 만들기 때문이다. 패시브는 그 사이를
 * 채우는 성격이다.
 *
 * 패시브로 돌린 둘은 원래 액티브와 개념이 겹쳤다 — 튕구리의 "3명에게 쏜다"와
 * 도탄, 실타래의 "4연타"와 연격. 자연스럽게 전환된다.
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
    id: 1, name: "빙글밤", tagline: "밤을 빙글 베는 전사", color: "black", cls: "warrior", kind: "melee",
    hp: 150, atk: 20, atkInterval: 560, range: 0.8, moveSpeed: 1.7,
    manaPerAttack: 28, skill: "whirlwind", passive: null, cost: 3,
  },
  {
    id: 7, name: "쿵실이", tagline: "한 발로 골목을 울리는 전사", color: "gray", cls: "warrior", kind: "melee",
    hp: 190, atk: 16, atkInterval: 640, range: 0.9, moveSpeed: 1.4,
    manaPerAttack: 28, skill: "shockwave", passive: null, cost: 4,
  },

  // ── 도적 ─────────────────────────────────────────────
  {
    id: 3, name: "그림콩", tagline: "그림자보다 먼저 덮치는 도적", color: "black", cls: "rogue", kind: "melee",
    hp: 95, atk: 29, atkInterval: 430, range: 0.8, moveSpeed: 2.4,
    manaPerAttack: 50, skill: "shadow_strike", passive: null, cost: 4,
  },
  {
    id: 4, name: "실타래", tagline: "싸울수록 손이 빨라지는 도적", color: "gray", cls: "rogue", kind: "melee",
    hp: 110, atk: 22, atkInterval: 440, range: 0.8, moveSpeed: 2.1,
    manaPerAttack: 0, skill: null, passive: "combo", cost: 3,
  },

  // ── 궁수 ─────────────────────────────────────────────
  {
    id: 8, name: "바늘이", tagline: "한 줄을 끝까지 꿰는 궁수", color: "orange", cls: "archer", kind: "ranged",
    hp: 112, atk: 27, atkInterval: 540, range: 2.8, moveSpeed: 1.2,
    manaPerAttack: 34, skill: "pierce", passive: null, cost: 4,
  },
  {
    id: 6, name: "튕구리", tagline: "화살을 둘씩 튕기는 궁수", color: "calico", cls: "archer", kind: "ranged",
    hp: 108, atk: 24, atkInterval: 510, range: 2.8, moveSpeed: 1.2,
    manaPerAttack: 0, skill: null, passive: "ricochet", cost: 4,
  },

  // ── 마법사 ───────────────────────────────────────────
  {
    id: 2, name: "노을이", tagline: "꺼지지 않는 불씨를 심는 마법사", color: "cream", cls: "mage", kind: "ranged",
    hp: 98, atk: 24, atkInterval: 660, range: 3.0, moveSpeed: 1.0,
    manaPerAttack: 34, skill: "ember", passive: null, cost: 4,
  },
  {
    id: 5, name: "서리별", tagline: "발밑에 겨울을 피우는 마법사", color: "white", cls: "mage", kind: "ranged",
    hp: 94, atk: 21, atkInterval: 630, range: 2.9, moveSpeed: 1.0,
    manaPerAttack: 34, skill: "frost_nova", passive: null, cost: 4,
  },
  // ── 직업당 세 번째 ───────────────────────────────────
  //
  // **색을 갈아 만든 넷이다.** 원본 시트에 고양이가 20마리뿐이고 우리 8 ·
  // 악몽 8 · 보스 4로 이미 다 썼다. 새 아트를 사는 대신 있는 그림의 밝기만
  // 남기고 색을 갈아끼웠다(`scripts/recolor-sprites.py`). 청록·보라·연두·
  // 분홍은 앞의 여덟에 없는 색이라 난전에서 헷갈리지 않는다.
  //
  // 넷 다 **직업의 빈자리**를 맡는다. 전사 둘이 광역이라 셋째는 지키는 쪽,
  // 도적 둘이 마무리·연타라 셋째는 끊는 쪽, 궁수 둘이 직선·도탄이라 셋째는
  // 흩뿌리는 쪽, 마법사 둘이 지속피해·제어라 셋째는 살리는 쪽이다.
  {
    id: 21, name: "품이", tagline: "앞줄을 포근히 감싸는 전사", color: "teal", cls: "warrior", kind: "melee",
    hp: 170, atk: 14, atkInterval: 600, range: 0.85, moveSpeed: 1.5,
    manaPerAttack: 28, skill: "guard", passive: null, cost: 4,
  },
  {
    id: 22, name: "콕밤", tagline: "위험한 하나를 정확히 멈추는 도적", color: "purple", cls: "rogue", kind: "melee",
    hp: 100, atk: 25, atkInterval: 450, range: 0.8, moveSpeed: 2.2,
    manaPerAttack: 50, skill: "gouge", passive: null, cost: 4,
  },
  {
    id: 23, name: "소나기", tagline: "화살을 비처럼 흩뿌리는 궁수", color: "green", cls: "archer", kind: "ranged",
    hp: 105, atk: 22, atkInterval: 520, range: 2.7, moveSpeed: 1.2,
    manaPerAttack: 34, skill: "volley", passive: null, cost: 3,
  },
  {
    id: 24, name: "토닥이", tagline: "가장 다친 친구를 살리는 마법사", color: "pink", cls: "mage", kind: "ranged",
    hp: 92, atk: 18, atkInterval: 680, range: 2.9, moveSpeed: 1.0,
    manaPerAttack: 34, skill: "mend", passive: null, cost: 3,
  },
  // ── 소환사 ───────────────────────────────────────────
  //
  // 다섯 번째 직업. **자기 화력은 여덟 직업 중 가장 낮고(DPS 22~25) 대신
  // 판에 몸을 더 내보낸다.** 뒷줄에 서서 앞에 몸을 세우는 그림이라 원거리다.
  //
  // 소환 시스템은 유물(분신 부적·새끼 바구니)로만 닿을 수 있었다. 그쪽은
  // 스탯 유물과 다른 축을 만들려는 장치라 화력이 거의 없는 반면, 이쪽은
  // 직업의 본체다 — 불러낸 몸이 곧 이 직업의 화력이자 내구다.
  //
  // 마나는 원거리와 같은 34(3타)다. 소환이 늦으면 이미 진 뒤에 나온다.
  {
    id: 29, name: "와글이", tagline: "작은 그림자 셋을 부르는 소환사", color: "navy", cls: "summoner", kind: "ranged",
    hp: 96, atk: 16, atkInterval: 700, range: 2.6, moveSpeed: 1.0,
    manaPerAttack: 34, skill: "swarm", passive: null, cost: 4,
  },
  {
    id: 30, name: "든든이", tagline: "큰 그림자를 벽처럼 세우는 소환사", color: "gold", cls: "summoner", kind: "ranged",
    hp: 102, atk: 18, atkInterval: 720, range: 2.5, moveSpeed: 1.0,
    manaPerAttack: 34, skill: "bulwark", passive: null, cost: 4,
  },
  {
    id: 31, name: "초롱이", tagline: "적의 눈을 미끼로 홀리는 소환사", color: "crimson", cls: "summoner", kind: "ranged",
    hp: 90, atk: 15, atkInterval: 680, range: 2.7, moveSpeed: 1.0,
    manaPerAttack: 34, skill: "lure", passive: null, cost: 3,
  },
];

/**
 * 악몽이 쓰는 여덟 마리. **우리 고양이와 한 마리도 겹치지 않는다.**
 *
 * 전에는 적도 `BREEDS`에서 뽑았다. "악몽은 형체가 없어서 잠든 사람이 아는 모습을
 * 빌려 쓴다"는 설정으로 정당화했지만, 실제로는 난전 한가운데서 **내 서리별과 적
 * 입김이가 같은 그림**이었다. 발밑 고리 색과 좌우 반전만으로 갈라야 했는데,
 * 셋이 겹쳐 있으면 그 고리가 서로를 가린다.
 *
 * 시트에 20종이 있는데 우리가 8종, 보스가 9~12번을 쓰고 13~20번이 놀고 있었다.
 * 정확히 여덟 장이 남아서 1:1로 갈라진다.
 *
 * **순서가 곧 계약이다.** `enemyBreedIds`는 `(wave*3 + i*5) % 길이`로 뽑으므로,
 * 이 배열의 i번째가 `BREEDS`의 i번째와 직업·스탯·스킬이 같아야 한다. 그래야
 * 적이 우리와 같은 규칙의 고양이라는 것이 유지되고, 웨이브 구성이 그림이
 * 아니라 수치로 결정된다. `npm test`의 짝 계약이 이걸 단언한다.
 *
 * **길이를 바꾸면 웨이브 구성이 통째로 바뀐다.** 8에서 12로 늘렸을 때
 * `(wave*3 + i*5) % 12`가 완전히 다른 순열을 내므로, 밸런스가 그대로일
 * 것이라고 가정하지 말고 `npm run sim`으로 다시 잴 것.
 *
 * **소환사는 여기 없다.** 우리 쪽 열다섯 중 뒤의 셋(소환사)에는 짝이 없다 —
 * 악몽은 형체가 없어서 무엇을 불러낼 수가 없다는 설정이고, 실제로도 그래야
 * 했다. 적에게 소환사를 주니 **웨이브 성격이 지워졌다**: 돌격이든 저격이든
 * 소환사가 섞이면 "몸 여럿과 싸우는 판"으로 수렴해, 팀 성격이 웨이브 성격에
 * 반응할 여지가 사라진다. 궁합이 8.3%p에서 4.1%p로 내려갔고(잡음 폭 1.1),
 * 적에게서 소환사만 빼자 8.1·8.5로 돌아왔다.
 *
 * 그래서 **소환은 플레이어만 쓰는 기술**이다. 짝 계약은 앞의 열둘에만
 * 적용되고, `npm test`가 "남는 것은 정확히 소환사뿐"임을 함께 단언한다.
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
  // 문틈으로 들어온 것. 검은 등에 흰 배라 우리 빙글밤과 헷갈릴 뻔했지만
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
  // 감아도 보이는 눈. 우리 그림콩과 같은 검정이지만 눈테가 노랗다.
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
  // ── 직업당 세 번째 (짝) ──────────────────────────────
  //
  // 위 넷과 **직업·스탯·스킬이 같고 그림만 다르다.** 바탕도 악몽 쪽
  // 스프라이트를 갈아 썼으므로 우리 고양이와 겹치지 않는다.
  {
    id: 25, name: "진땀이", color: "teal", cls: "warrior", kind: "melee",
    hp: 170, atk: 14, atkInterval: 600, range: 0.85, moveSpeed: 1.5,
    manaPerAttack: 28, skill: "guard", passive: null, cost: 0,
  },
  {
    id: 26, name: "멍울이", color: "purple", cls: "rogue", kind: "melee",
    hp: 100, atk: 25, atkInterval: 450, range: 0.8, moveSpeed: 2.2,
    manaPerAttack: 50, skill: "gouge", passive: null, cost: 0,
  },
  {
    id: 27, name: "곰팡이", color: "green", cls: "archer", kind: "ranged",
    hp: 105, atk: 22, atkInterval: 520, range: 2.7, moveSpeed: 1.2,
    manaPerAttack: 34, skill: "volley", passive: null, cost: 0,
  },
  {
    id: 28, name: "열꽃이", color: "pink", cls: "mage", kind: "ranged",
    hp: 92, atk: 18, atkInterval: 680, range: 2.9, moveSpeed: 1.0,
    manaPerAttack: 34, skill: "mend", passive: null, cost: 0,
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
