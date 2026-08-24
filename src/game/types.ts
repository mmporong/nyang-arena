export type Pose = "idle" | "sleep" | "wink" | "move" | "back" | "run";

/**
 * 털색. 뒤의 넷은 **색을 갈아 만든 품종**이다(`scripts/recolor-sprites.py`).
 *
 * 원본 시트에 고양이가 20마리뿐이고 우리 8 · 악몽 8 · 보스 4로 이미 다
 * 썼다. 새 아트를 사는 대신 있는 그림의 밝기만 남기고 색을 갈아끼웠다.
 * 앞의 여섯에 없는 색으로 골라서 난전에서 헷갈리지 않는다.
 */
export type CatColor =
  | "black"
  | "cream"
  | "gray"
  | "white"
  | "calico"
  | "orange"
  | "teal"
  | "purple"
  | "green"
  | "pink"
  | "navy"
  | "gold"
  | "crimson";

export type Side = "ally" | "enemy";

/**
 * 플레이어가 전투 중에 넣는 의도.
 *
 * 버튼이 상태를 직접 만지지 않고 큐에 넣기만 하는 이유: 브라우저와 헤드리스
 * 시뮬이 **같은 함수**를 통과해야 개입의 값을 잴 수 있다. 판정은 전부
 * stepBattle 안에서 일어난다.
 *
 * 버튼은 하나이고 **누르는 방식**이 의도를 가른다 — 짧게 탭하면 흩어지고,
 * 꾹 누르면 모인다. 붉은 장판에 꾹 누르면 위험 한가운데로 모이고, 푸른 장판에
 * 탭하면 나뉘어야 할 피해를 통째로 맞는다. 그래서 "누를까"가 아니라
 * "어느 쪽인가"가 결정이 된다.
 */
/**
 * 플레이어가 전투에 끼어드는 방법.
 *
 * `act`가 화면이 쓰는 유일한 것이다 — **버튼도 키도 하나**이고, 무엇을 할지는
 * `stepBattle`이 지금 판을 보고 정한다. 예전에는 흩어짐과 뭉침을 사람이 갈라
 * 눌렀는데(Space / Shift), 조작 둘을 1.2초 안에 고르라는 것은 이 게임이 요구할
 * 만한 판단이 아니었다. 버튼 하나가 상황에 맞게 일한다.
 *
 * 나머지 셋은 **측정용으로 남긴다.** `scripts/intervention-space.mjs`가
 * "늘 흩어지기만", "거꾸로 읽기" 같은 나쁜 정책을 일부러 돌려서 개입의 값을
 * 재는데, 그러려면 정책이 직접 종류를 지정할 수 있어야 한다. 게임 화면에서는
 * 안 쓰인다.
 */
/**
 * `dual` — 극성(polarity) 같은 두 갈래 게이트(`dualChoiceActive`, battle.ts)
 * 가 **열려 있는 동안 사람이 직접** 이 의도를 큐에 넣었다는 표시.
 *
 * `polarityChoices` 부검 카운터가 "몇 번 소비됐나"가 아니라 "몇 번 골랐나"를
 * 재려면, 게이트가 열려 있었는지를 **넣는 순간**(main.ts) 물어야 한다 —
 * 소비 시점(`stepBattle`이 큐에서 꺼내는 순간)에 다시 물으면 그 사이 예고가
 * 이미 꺼져 있을 수 있어(쿨다운에 막혀 늦게 소비될 때) 분명히 골랐는데도
 * 안 세어진다(실측: seed 4에서 입력 1회가 +0으로 셌다). 그래서 이 비트를
 * `Intervention` 자체에 실어 큐를 타고 그대로 넘어가게 한다. 측정 봇
 * (`bot-policy.mjs`)이 직접 넣는 dodge/gather는 **이 비트를 안 채운다** —
 * 사람이 고른 것만 세어야 하므로.
 */
export type Intervention =
  | { kind: "act" }
  | { kind: "dodge"; dual?: boolean }
  | { kind: "gather"; dual?: boolean }
  | { kind: "strike" };

/**
 * 보스 광역기의 예고 모양. 터지기 전에 화면에 그려진다.
 *
 * `half` — 판을 좌/우로 가르는 절반. **극성(polarity)** 전용이다. 원형·직선·
 * 부채꼴은 전부 "중심에서 거리·각도"로 안팎을 가르는데, 절반은 그 계산이
 * 의미가 없다(경계선까지 거리는 무한대로 가도 안이다). 그래서 `fx`를 경계
 * 좌표로, `dirX`의 부호를 "안쪽이 어느 방향인가"로 재활용하고 `fy`·`dirY`·
 * `arg`·`reach`는 쓰지 않는다 — `inTelegraph`가 다른 모양보다 먼저 갈라낸다.
 */
export type TelegraphShape = "circle" | "line" | "cone" | "half";

/**
 * 예고가 요구하는 것.
 *
 * - `avoid` — 장판 밖으로 나가라. 안에 있으면 맞는다.
 * - `gather` — 장판 **안으로** 들어가라. 피해가 안에 있는 수만큼 나뉘고,
 *   아무도 없으면 전원이 통째로 맞는다.
 *
 * 레이드가 레이드인 이유가 이 대비다. 흩어짐만 있으면 예고가 뜰 때마다 그냥
 * 누르면 되지만, 뭉침이 섞이면 **어느 쪽이 더 급한지**를 읽어야 한다.
 * 차지가 한정돼 있으므로 그게 곧 우선순위 판단이 된다.
 */
export type TelegraphMode = "avoid" | "gather";

export interface Telegraph {
  shape: TelegraphShape;
  mode: TelegraphMode;
  /** 원형이면 중심, 직선·부채꼴이면 시작점 */
  fx: number;
  fy: number;
  /** 조준 방향 (단위 벡터). 원형은 쓰지 않는다 */
  dirX: number;
  dirY: number;
  /** 원형: 반경 / 직선: 폭의 절반 / 부채꼴: 반각(라디안) */
  arg: number;
  /** 직선·부채꼴의 사거리 */
  reach: number;
  /** 남은 예고 시간(ms). 0이 되면 터진다 */
  fuse: number;
  /** 예고 전체 길이(ms). 렌더가 차오르는 정도를 계산한다 */
  fuseMax: number;
  /**
   * 터진 뒤 사라지지 않고 `CreepZone`으로 눌러앉아야 하는가. **creep 패턴만**
   * 참이다. `Telegraph`에 이 한 비트만 얹는 이유: 발동 판정(`fireTelegraph`)이
   * "이 예고가 creep이었는가"를 알아야 하는데, 패턴 이름은 `makeTelegraph`
   * 안에서만 살고 만들어진 `Telegraph`엔 안 남기 때문이다. optional이고
   * 기본은 없음(=false)이라 기존 예고 생성 코드는 한 곳도 안 건드린다.
   */
  resident?: boolean;
  /**
   * **표식(seize) 전용.** 이 원이 US-403의 구원 원임을 표시한다. `resident`와
   * 같은 이유로 한 비트만 얹는다 — `fireTelegraph`(battle.ts)가 이 원이
   * 터질 때 "전원 채점"이 아니라 "표식이 걸린 아군 한 마리만 채점"으로
   * 갈라야 하는데, 패턴 이름은 `makeTelegraph` 안에서만 살고 만들어진
   * `Telegraph`엔 안 남기 때문이다. optional이고 기본은 없음(=false)이라
   * 기존 예고 생성 코드는 한 곳도 안 건드린다.
   */
  seize?: boolean;
}

/**
 * 성장형 장판(creep) — 발동 후에도 사라지지 않고 판 위에 눌러앉는 예고.
 *
 * `Telegraph`를 그대로 확장한다. shape·mode·fx·fy·arg는 "지금 이 순간의
 * 원형 장판"으로 기존 판정·렌더(`inTelegraph`·`drawTelegraphs`)를 한 톨도
 * 바꾸지 않고 그대로 재사용하기 위해서다 — 다른 점은 **꺼지지 않는다**는
 * 것뿐이고, 꺼지지 않게 만드는 상태만 여기 얹는다.
 *
 * `fuse`는 "터지기까지 남은 시간"이 아니라 **다음 성장 틱까지 남은 시간**으로
 * 뜻이 바뀐다 — 값이 0에 닿으면 터지는 대신 자라난다. 렌더의 "차오르는 정도"
 * 계산(`fuseMax` 대비 `fuse`)은 그대로 맥동 애니메이션으로 재활용된다.
 */
export interface CreepZone extends Telegraph {
  /** 아무도 없었던 연속 시간(ms). `CREEP_IDLE_DESPAWN_MS`에 닿으면 소멸한다. */
  idleMs: number;
  /** 반경 성장 단계. `CREEP_RADIUS_STEPS`의 인덱스이고 배열 끝에서 멈춘다. */
  stepIdx: number;
  /** 틱마다 점유 중인 아군에게 주는 고정 피해. 스폰 시점 보스 공격력으로 정해진다. */
  tickDamage: number;
}

/** 근접은 붙어야 때리고, 원거리는 제자리에서 쏜다. */
export type AttackKind = "melee" | "ranged";

/**
 * 직업. 근접/원거리의 하위 분류다.
 * 전사·도적은 근접, 궁수·마법사는 원거리라서 기존 배치 규칙이 그대로 산다.
 */
export type ClassKind = "warrior" | "rogue" | "archer" | "mage" | "summoner";

export const CLASS_LABEL: Record<ClassKind, string> = {
  warrior: "전사",
  rogue: "도적",
  archer: "궁수",
  mage: "마법사",
  summoner: "소환사",
};

/**
 * 한 글자 약칭. 부검 화면의 팀 요약("전1 도2 궁3 법4")에 쓴다.
 *
 * 전에는 그 줄이 `전${by.warrior} 도${by.rogue} ...`로 **문자열에 손으로**
 * 박혀 있었다. 직업을 늘리면 객체는 컴파일러가 잡지만 이 문자열은 그대로
 * 통과하고, 새 직업만 요약에서 사라진다. `Record<ClassKind, ...>`로 옮겨
 * 안 채우면 컴파일이 안 되게 했다.
 */
export const CLASS_SHORT: Record<ClassKind, string> = {
  warrior: "전",
  rogue: "도",
  archer: "궁",
  mage: "법",
  summoner: "소",
};

/**
 * 직업 하나도 안 빠진 순서 배열만 통과시킨다.
 *
 * 빠진 것이 있으면 인자 타입이 `never`가 되어 **선언 자리에서** 컴파일이
 * 멈춘다. 별도의 검사용 변수를 두지 않아도 되고(`noUnusedLocals`에 안 걸린다),
 * 순서가 배열 리터럴로 눈에 보인 채로 남는다.
 */
function everyClass<const T extends readonly ClassKind[]>(
  order: Exclude<ClassKind, T[number]> extends never ? T : never,
): T {
  return order;
}

/**
 * 화면에 직업을 늘어놓는 순서.
 *
 * 전에는 `render.ts`에 `["warrior", "rogue", "archer", "mage"]`가 손으로
 * 적혀 있었다. 배열이라 원소가 빠져도 타입 검사가 통과한다 — 직업을 늘리면
 * `Record<ClassKind, ...>` 자리들은 컴파일러가 잡아 주지만 **그 배열만
 * 조용히 옛 넷으로 남아** 새 직업이 시너지 패널과 부검 요약에서 사라진다.
 *
 * `Object.keys(CLASS_LABEL)`로 뽑는 방법도 됐지만, 그러면 **화면 순서가
 * 라벨 맵의 선언 순서에 조용히 묶인다** — 라벨 줄을 재정렬하는 겉보기에
 * 무해한 편집이 패널 순서를 뒤집는데 컴파일러도 테스트도 모른다. 순서는
 * 여기 눈에 보이게 두고, 누락만 `everyClass`가 막는다.
 */
export const CLASS_ORDER = everyClass(["warrior", "rogue", "archer", "mage", "summoner"]);

/** 직업별 0으로 채운 카운터. 직업을 늘려도 손댈 필요가 없다. */
export function zeroByClass(): Record<ClassKind, number> {
  return Object.fromEntries(CLASS_ORDER.map((c) => [c, 0])) as Record<ClassKind, number>;
}

/** 고양이마다 하나씩 갖는 고유 스킬. 실행 로직은 skills.ts에 있다. */
/**
 * 패시브 — 마나 없이 늘 켜져 있는 능력. 그 고양이만 가진다.
 * 액티브와 패시브 비율은 3:1로 둔다. 액티브가 판을 뒤집는 순간을 만들고,
 * 패시브는 꾸준히 흐르는 성격을 만든다.
 */
export type PassiveId = "ricochet" | "combo";

export type SkillId =
  | "whirlwind"
  | "shockwave"
  | "shadow_strike"
  | "pierce"
  | "ember"
  | "frost_nova"
  // 아래 넷은 직업당 세 번째 고양이가 쓴다. 앞의 여섯과 메커니즘이 겹치지
  // 않게 골랐다 — 특히 `guard`와 `mend`는 이 게임에 없던 **지키는 쪽** 축이다.
  | "guard"
  | "gouge"
  | "volley"
  | "mend"
  // 소환사 셋. 판에 몸을 더 내보내는 것이 공통이고, **무엇을 어떻게 부르는지가
  // 서로 다르다** — 숫자로 밀지, 큰 것 하나로 버틸지, 쓰러진 자리에서 되부를지.
  | "swarm"
  | "bulwark"
  | "lure";

export const BOARD_COLS = 5;
export const BOARD_ROWS = 5;
export const BOARD_SIZE = BOARD_COLS * BOARD_ROWS;

export function cellRow(cell: number): number {
  return Math.floor(cell / BOARD_COLS);
}

export function cellCol(cell: number): number {
  return cell % BOARD_COLS;
}

/**
 * 전투 좌표계 — 화면 방향과 무관한 정준 공간.
 *
 * 아군은 fx 0..4, 적은 fx 6..10에 선다. fx가 클수록 적 진영 쪽이고,
 * fy는 양쪽 공통으로 0..4다. 즉 아군 앞줄과 적 앞줄 사이는 FIELD_GAP칸이다.
 *
 * 보드가 5열이 되면서 뒷줄에서 적까지 거리가 멀어졌다. 뒷줄 근접이 한참 걸어가는
 * 것은 의도된 페널티다 — 근접은 앞에 세우라는 규칙이 거리로 강제된다.
 *
 * 렌더러가 이 좌표를 화면으로 옮긴다. 가로에서는 fx가 화면 x축, 세로에서는
 * 화면 y축(위쪽이 적)에 대응한다. 전투 계산이 화면 크기나 방향에 의존하면
 * 헤드리스 시뮬레이션과 실제 게임이 갈라지므로 좌표를 고정한다.
 */
export const FIELD_GAP = 2.0;
export const ALLY_FRONT_FX = BOARD_COLS - 1;
export const ENEMY_FRONT_FX = ALLY_FRONT_FX + FIELD_GAP;

export function cellToField(side: Side, cell: number): { fx: number; fy: number } {
  const col = cellCol(cell);
  return { fx: side === "ally" ? col : ENEMY_FRONT_FX + col, fy: cellRow(cell) };
}

export interface Breed {
  /**
   * 스프라이트 파일명 접두사. 1~20은 시트에서 자른 원본이고, 21~28은
   * 그 원본의 색을 갈아 만든 것이다(`scripts/recolor-sprites.py`).
   */
  readonly id: number;
  readonly name: string;
  readonly color: CatColor;
  readonly cls: ClassKind;
  readonly kind: AttackKind;
  readonly hp: number;
  readonly atk: number;
  /** 공격 간격(ms). 작을수록 빠르다. */
  readonly atkInterval: number;
  /** 사거리(칸). 아군 앞줄과 적 앞줄 사이가 FIELD_GAP칸이다. */
  readonly range: number;
  /** 이동 속도(칸/초) */
  readonly moveSpeed: number;
  /** 공격 한 번에 차는 마나. 100이 되면 스킬을 쓴다. 패시브 고양이는 0이다. */
  readonly manaPerAttack: number;
  /** 액티브 스킬. 패시브 고양이는 null. */
  readonly skill: SkillId | null;
  /** 패시브. 액티브 고양이는 null. 둘 중 하나만 갖는다. */
  readonly passive: PassiveId | null;
  readonly cost: number;
}

export const MANA_MAX = 100;

export interface Cat {
  readonly uid: string;
  readonly breed: Breed;
  level: number;
  maxHp: number;
  hp: number;
  atk: number;
  atkInterval: number;
  /** 0..1 회피율 */
  evade: number;
  /** 다음 공격까지 남은 ms */
  cooldown: number;
  /** 몸 크기(칸). 보스만 0보다 크다. 사거리·겹침 계산이 이걸 뺀다. */
  radius: number;
  /** 예고 중인 광역기. 보스만 쓴다. */
  telegraph: Telegraph | null;
  /**
   * 두 번째 동시 예고. **극성(polarity)에서만** 쓴다.
   *
   * `telegraph`는 계속 "보스가 지금 거는 예고 하나"를 뜻하고(회피 자동판단
   * `resolveIntent`가 이걸 찾아 산개로 처리한다), 극성만 예외로 동시에 두
   * 존(흩어짐 반쪽·모임 반쪽)을 걸어야 한다. 배열로 일반화하는 대신 필드
   * 하나를 더 두는 이유: `state.enemy`를 도는 자리가 battle.ts·render.ts에
   * 십수 군데라 `telegraph: Telegraph[]`로 바꾸면 전부 고쳐야 하는데, 실제로
   * 동시에 두 개 이상 뜨는 예고는 지금 이 패턴 하나뿐이다. `run.ts`의
   * `makeCat`은 이 필드를 채우지 않으므로(이 작업의 담당 파일이 아니다)
   * optional이고, 안 채워진 값은 `null`과 같다.
   */
  telegraph2?: Telegraph | null;
  /** 다음에 발동할 체력 문턱의 인덱스. 보스만 쓴다. */
  thresholdIdx: number;
  /**
   * 남은 취약 시간(ms). 0보다 크면 보스가 공격을 멈추고 약점이 열린다.
   *
   * 회피 버튼이 이 동안 **결정타**로 바뀐다. 창 전용 기회를 공격에 쓸지
   * 후반 예고의 방어에 남길지가 선택이 된다.
   */
  vulnerableMs: number;
  /** 이번 취약 창에 남은 공격·방어 공용 기회. 창 종료 때 소멸하고 0이 된다. */
  vulnerableCharges: number;
  /** 취약 창을 이미 한 번 열었는가. 보스전당 한 번만 열린다. */
  vulnerableUsed: boolean;
  /**
   * 남은 이동 금지 시간(ms).
   *
   * 회피로 빼낸 고양이가 다음 틱에 곧바로 목표를 향해 걸어 돌아가면 회피가
   * 무의미해진다. 도적은 0.6초면 위험 구간에 다시 들어간다.
   */
  moveLock: number;
  /**
   * 개입으로 달려갈 자리. null이면 안 달리는 중이다.
   *
   * 전에는 회피·뭉침이 `c.fx = spot.fx`로 좌표를 **한 번에 바꿨다.** 판정은
   * 맞았지만 화면에서는 고양이가 사라졌다 나타났다 — 순간이동이었고, 그래서
   * 버튼을 눌러도 "내가 무엇을 시켰는지"가 안 보였다.
   *
   * 목표만 적어 두고 실제 이동은 `tickDashes`가 매 스텝 나눠서 한다.
   * `stepBattle`은 브라우저에서 프레임 간격(~16ms)으로 돌므로 그대로 달리는
   * 모션이 되고, 헤드리스 시뮬은 100ms 스텝이라 한두 번에 끝난다 — 판정은
   * 양쪽이 같다.
   */
  dash: { tx: number; ty: number; speed: number } | null;
  side: Side;
  /** 보드 셀 인덱스 0..8, 보드 밖(벤치)이면 -1 */
  cell: number;
  /** 전장 위치. 전투가 시작되면 셀을 떠나 여기서 움직인다. */
  fx: number;
  fy: number;
  alive: boolean;
  pose: Pose;
  /** 임시 포즈가 유지되는 ms. 0이면 기본 포즈로 복귀 */
  poseTimer: number;
  /** 공격 돌진 연출 진행도 0..1 */
  lunge: number;
  /** 피격 깜빡임 잔여 ms */
  flash: number;

  /** 0..manaMax. 공격할 때마다 쌓이고, 가득 차면 스킬을 쓰고 0으로 돌아간다. */
  mana: number;
  manaMax: number;
  /** 스킬 시전 연출 잔여 ms. 0보다 크면 이름표가 뜬다. */
  castFlash: number;

  /** 행동 불가 잔여 ms (스턴·빙결). 이동도 공격도 못 한다. */
  stun: number;
  /** 지속 피해. 남은 시간과 초당 피해량 */
  dot: { dps: number; remain: number } | null;
  /** 남은 보호막. 피해를 먼저 흡수한다 */
  shield: number;
  /** 이동 속도 배수. 돌격대 같은 웨이브 성격이 여기를 건드린다. */
  speedMul: number;
  /** 도적 연격: 연속으로 때린 대상과 쌓인 횟수. 대상이 바뀌면 초기화된다. */
  comboTarget: string | null;
  combo: number;

  /**
   * 몸 크기 배수. 그림과 **겹침 반경**을 함께 줄인다. 보통 고양이는 1이다.
   *
   * `radius`로는 작은 유닛을 못 만든다 — 그쪽은 보스용이라 0보다 크면
   * `separate()`가 "안 밀리는 몸"으로 취급한다(`aFixed = a.radius > 0`).
   * 소환수를 `radius`로 줄이면 잡몹에게 안 밀리는 새끼 고양이가 된다.
   *
   * 판이 이미 꽉 차 있어서 이 축이 필요했다. 10마리일 때 최근접 거리가
   * 1.05로 분리 목표 1.0에 붙어 있다 — 같은 크기의 몸을 더 얹으면 상시
   * 밀어내기가 되고, 그게 벽 밀림을 만든다. 소환수는 작아야 들어간다.
   */
  sizeMul: number;
  /**
   * 소환수라면 누가 언제까지 불렀는가. 진짜 고양이는 null이다.
   *
   * 소환수는 `state.summons`에 따로 산다. 아군 보드에 끼워 넣지 않는 이유는
   * **아군을 세는 곳이 24군데**여서다 — 보유 한도·강화 대상·시너지 집계·유물
   * 조건·전멸 판정·하네스 일곱 개가 전부 `livingCats(state.ally)`를 부른다.
   * 거기 섞이면 분신이 시너지를 켜고 전멸을 막는다. 따로 두면 기본값이
   * "안 세어진다"가 되어, 빠뜨렸을 때 조용히 이득 보는 쪽이 아니라 그냥
   * 없는 쪽으로 실패한다.
   */
  summon: { ownerUid: string; lifeMs: number } | null;
  /**
   * 도발. 참이면 적이 이것을 **먼저** 노린다.
   *
   * 게임에 없던 축이다 — 그 전까지 타겟은 거리와 몰림으로만 정해졌고
   * (`pickTarget`), 누가 맞을지를 고를 방법이 없었다. 소환사가 화력 최하인
   * 대신 판을 버티게 하는 직업이라면, "몸이 대신 맞는다"를 실제로 만드는
   * 장치가 필요하다.
   *
   * 지금은 미끼 소환수만 켠다. 수명이 다하면 소환수째로 사라지므로 따로
   * 끄는 처리가 없다.
   */
  taunt: boolean;

  /**
   * 순간이동 페이드 상태. 보스만 쓴다. `null`(또는 없음)이면 평소대로다.
   *
   * `run.ts`의 `makeCat`은 이 필드를 채우지 않는다 — **optional로 두는 이유가
   * 그것이다.** run.ts는 이 작업에서 손댈 수 없는 파일이라, 필드를 필수로
   * 두면 그 리터럴이 컴파일을 통과하지 못한다. 안 채워진 고양이는 `undefined`가
   * 되고, 코드 전역에서 `null`과 똑같이 취급한다(진짜 순간이동은 보스만 한다).
   *
   * - `out` — 사라지는 중. 알파가 줄어든다.
   * - `gone` — 부재. `to`로 좌표가 이미 옮겨져 있지만 화면엔 안 보이고,
   *   `pickTarget`도 이 보스를 후보에서 뺀다(`battle.ts`).
   * - `in` — 나타나는 중. 알파가 다시 찬다.
   *
   * `ms`는 다른 타이머들과 같은 규칙으로 **그 단계에 남은 시간**이고, 0이 되면
   * 다음 단계로 넘어간다.
   */
  blink?: { phase: "out" | "gone" | "in"; ms: number; to: { fx: number; fy: number } } | null;

  /**
   * 보스가 이번 스텝에 찍은 목표의 uid. 렌더러가 표식을 그리는 용도로만 쓴다.
   *
   * `pickTarget`은 매 스텝 새로 계산하므로(`battle.ts`) 이 값을 지워도 전투
   * 결과는 같다 — 순수한 읽기용 스냅샷이다. `run.ts`의 `makeCat`이 채우지
   * 않으므로 `blink`와 같은 이유로 optional이다. 보스가 아닌 고양이는
   * 갱신되지 않으므로 항상 비어 있다.
   */
  targetRef?: string | null;
  /**
   * 이 보스가 스테이지의 **우두머리**(걸음의 두 번째 보스)인가.
   *
   * 처치 연출·배너가 위상을 물어야 하는데, 살아 있는 `state.step`은 처치
   * 직후 `finishWave`가 올려 버려 다음 프레임부터 거짓말을 한다 — 실측으로
   * 우두머리 강화 흔들림이 한 프레임도 못 살았다(702회 실측 평균 0.16프레임). 낳는 순간(buildBossWave)에
   * 박아 두면 상태 전이와 무관하게 참을 유지한다.
   */
  stageBoss?: boolean;
  /**
   * 우두머리가 체력 절반 밑으로 내려와 페이즈 2 패턴으로 갈아탔는가.
   *
   * `blink`·`targetRef`와 같은 이유로 optional이다 — `run.ts`의 `makeCat`은
   * 이 필드를 채우지 않는다(이 작업의 담당 파일이 아니라 손대지 않는다).
   * 안 채워진 고양이(우두머리가 아니거나 아직 전환 전)는 `undefined`이고,
   * `battle.ts` 전역에서 `false`와 똑같이 취급한다.
   *
   * 렌더가 "지금 막 전환됐다"를 프레임마다 다시 그리지 않으려면 전환 여부
   * 자체가 상태로 남아야 한다 — 그 순간의 1회성 연출은 `Fx`의 `phaseShift`
   * 종류가 대신한다(`battle.ts`).
   */
  phase2?: boolean;

  /**
   * 표식(seize, US-403) 구원 대기 상태. **아군만** 쓴다.
   *
   * 참이면 이 고양이가 지금 도화선 위에 서 있다는 뜻이고, 구원 판정은
   * `fireTelegraph`(battle.ts)의 seize 분기가 **도화선이 다 되는 순간 1회**
   * 결정적으로 내린다 — 매 프레임 다시 재지 않는다. `blink`·`phase2`와 같은
   * 이유로 optional이다: `run.ts`의 `makeCat`은 이 필드를 채우지 않는다
   * (이 작업의 담당 파일이 아니다). 안 채워진 고양이는 `undefined`이고
   * `false`와 똑같이 취급한다.
   */
  seized?: boolean;
  /**
   * 최종 국면(finalPhase, US-404) 상태. **스테이지 3 우두머리(서리귀)에게만,
   * 게임 전체에서 1회만** 켜진다(`RunState.finalPhaseUsed`가 그 문을 지킨다).
   *
   * `channel` — 2.5초 전능 채널. 예고도 공격도 멈춘다(`boss.stun`을 그대로
   * 걸어 재사용한다). 채널이 끝나면 `open`으로 넘어가면서 전 아군이 60%
   * 회복하고 보스에게 마지막 취약 창이 열린다 — 그 창은 **새 타이머를
   * 따로 두지 않고 기존 `vulnerableMs`를 그대로 빌려 쓴다**(창이 닫히면
   * `battle.ts`가 스스로 `finalPhase`를 지운다).
   *
   * `remainMs`/`totalMs`는 `channel` 단계에서만 진행의 근거다 — `open`
   * 단계의 실제 남은 시간은 `boss.vulnerableMs`(대 `FINAL_VULNERABLE_MS`)를
   * 봐야 한다(render.ts). 두 값을 이중으로 흘려보내면 반드시 어긋난다.
   *
   * `preHp` — 채널 시작 **직전** 각 아군의 체력 스냅샷(uid→hp). 채널 회복
   * 공식이 "빈사에서 끌어올리되 원래보다 나빠지지 않는다"(hp = max(채널
   * 직전 hp, maxHp×60%))를 지키려면 그 직전 값을 기억해 둬야 한다 — hp를
   * 1로 낮춘 뒤에는 원래 값을 잃어버리기 때문이다.
   *
   * `blink`·`phase2`와 같은 이유로 optional이다 — `run.ts`의 `makeCat`은
   * 채우지 않는다.
   */
  finalPhase?: {
    stage: "channel" | "open";
    remainMs: number;
    totalMs: number;
    preHp: Map<string, number>;
  } | null;
}

export type Board = (Cat | null)[];

export function emptyBoard(): Board {
  return new Array<Cat | null>(BOARD_SIZE).fill(null);
}

export function livingCats(board: Board): Cat[] {
  const out: Cat[] = [];
  for (const c of board) if (c && c.alive) out.push(c);
  return out;
}

export function fieldDistance(a: Cat, b: Cat): number {
  return Math.hypot(a.fx - b.fx, a.fy - b.fy);
}

/**
 * 두 유닛의 **표면** 사이 거리.
 *
 * 보스처럼 큰 개체는 중심까지 갈 필요 없이 몸에 닿으면 때릴 수 있어야 한다.
 * 일반 고양이는 반경이 0이라 `fieldDistance`와 같은 값이 나온다 — 즉 기존
 * 유닛의 거동은 한 톨도 바뀌지 않는다.
 */
export function surfaceDistance(a: Cat, b: Cat): number {
  return Math.max(0, fieldDistance(a, b) - a.radius - b.radius);
}
