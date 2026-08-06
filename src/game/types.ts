export type Pose = "idle" | "sleep" | "wink" | "move" | "back" | "run";

export type CatColor = "black" | "cream" | "gray" | "white" | "calico" | "orange";

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
export type Intervention = { kind: "dodge" } | { kind: "gather" } | { kind: "strike" };

/** 보스 광역기의 예고 모양. 터지기 전에 화면에 그려진다. */
export type TelegraphShape = "circle" | "line" | "cone";

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
}

/** 근접은 붙어야 때리고, 원거리는 제자리에서 쏜다. */
export type AttackKind = "melee" | "ranged";

/**
 * 직업. 근접/원거리의 하위 분류다.
 * 전사·도적은 근접, 궁수·마법사는 원거리라서 기존 배치 규칙이 그대로 산다.
 */
export type ClassKind = "warrior" | "rogue" | "archer" | "mage";

export const CLASS_LABEL: Record<ClassKind, string> = {
  warrior: "전사",
  rogue: "도적",
  archer: "궁수",
  mage: "마법사",
};

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
  | "frost_nova";

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
  /** 시트 행 번호 (1-20). 스프라이트 파일명 접두사와 같다. */
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
  /** 다음에 발동할 체력 문턱의 인덱스. 보스만 쓴다. */
  thresholdIdx: number;
  /**
   * 남은 취약 시간(ms). 0보다 크면 보스가 공격을 멈추고 약점이 열린다.
   *
   * 회피 버튼이 이 동안 **약점 공격**으로 바뀐다. 버튼은 하나이고 역할만
   * 바뀐다 — 조작을 늘리지 않고 레이드의 '버스트 창'을 넣는 방법이다.
   */
  vulnerableMs: number;
  /** 이번 취약 창에서 쌓은 연타 수. 창이 닫히면 0으로 돌아간다. */
  strikeCombo: number;
  /** 취약 창을 이미 한 번 열었는가. 보스전당 한 번만 열린다. */
  vulnerableUsed: boolean;
  /**
   * 남은 이동 금지 시간(ms).
   *
   * 회피로 빼낸 고양이가 다음 틱에 곧바로 목표를 향해 걸어 돌아가면 회피가
   * 무의미해진다. 도적은 0.6초면 위험 구간에 다시 들어간다.
   */
  moveLock: number;
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
