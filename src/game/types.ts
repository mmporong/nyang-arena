export type Pose = "idle" | "sleep" | "wink" | "move" | "back" | "run";

export type CatColor = "black" | "cream" | "gray" | "white" | "calico" | "orange";

export type Side = "ally" | "enemy";

/** 근접은 붙어야 때리고, 원거리는 제자리에서 쏜다. */
export type AttackKind = "melee" | "ranged";

export const BOARD_COLS = 3;
export const BOARD_ROWS = 3;
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
 * 아군은 fx 0..2, 적은 fx 4.5..6.5에 선다. fx가 클수록 적 진영 쪽이고,
 * fy는 양쪽 공통으로 0..2다. 즉 아군 앞줄과 적 앞줄 사이는 2.5칸이다.
 *
 * 렌더러가 이 좌표를 화면으로 옮긴다. 가로에서는 fx가 화면 x축, 세로에서는
 * 화면 y축(위쪽이 적)에 대응한다. 전투 계산이 화면 크기나 방향에 의존하면
 * 헤드리스 시뮬레이션과 실제 게임이 갈라지므로 좌표를 고정한다.
 */
export const FIELD_GAP = 2.5;
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
  readonly kind: AttackKind;
  readonly hp: number;
  readonly atk: number;
  /** 공격 간격(ms). 작을수록 빠르다. */
  readonly atkInterval: number;
  /** 사거리(칸). 아군 앞줄과 적 앞줄 사이가 2.5칸이다. */
  readonly range: number;
  /** 이동 속도(칸/초) */
  readonly moveSpeed: number;
  readonly cost: number;
}

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
