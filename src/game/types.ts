export type Pose = "idle" | "sleep" | "wink" | "move" | "back" | "run";

export type CatColor = "black" | "cream" | "gray" | "white" | "calico" | "orange";

export type Side = "ally" | "enemy";

export interface Breed {
  /** 시트 행 번호 (1-20). 스프라이트 파일명 접두사와 같다. */
  readonly id: number;
  readonly name: string;
  readonly color: CatColor;
  readonly hp: number;
  readonly atk: number;
  /** 공격 간격(ms). 작을수록 빠르다. */
  readonly atkInterval: number;
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
  alive: boolean;
  pose: Pose;
  /** 임시 포즈가 유지되는 ms. 0이면 기본 포즈로 복귀 */
  poseTimer: number;
  /** 공격 돌진 연출 진행도 0..1 */
  lunge: number;
  /** 피격 깜빡임 잔여 ms */
  flash: number;
}

export const BOARD_COLS = 3;
export const BOARD_ROWS = 3;
export const BOARD_SIZE = BOARD_COLS * BOARD_ROWS;

export type Board = (Cat | null)[];

export function emptyBoard(): Board {
  return new Array<Cat | null>(BOARD_SIZE).fill(null);
}

export function cellRow(cell: number): number {
  return Math.floor(cell / BOARD_COLS);
}

export function cellCol(cell: number): number {
  return cell % BOARD_COLS;
}

export function livingCats(board: Board): Cat[] {
  const out: Cat[] = [];
  for (const c of board) if (c && c.alive) out.push(c);
  return out;
}
