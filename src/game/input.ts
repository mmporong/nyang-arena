import { dualChoiceActive } from "./battle.ts";
import { hitCell, rectHas, type Layout, type Rect } from "./layout.ts";
import { openLanes } from "./map.ts";
import {
  gameoverGeometry,
  nearestMapNode,
  offerRects,
  openMapNodeRects,
  raidContractRects,
  rerollRect,
  splitButtonChoice,
} from "./render.ts";
import { mapStep, type NextChoice, type RunState } from "./run.ts";
import type { Intervention } from "./types.ts";

export interface InputDragState {
  active: boolean;
  fromCell: number;
  x: number;
  y: number;
  pointerId: number;
  hoverX: number;
  hoverY: number;
}

export type GameInputEvent =
  | { kind: "pointer-down"; pointerId: number; x: number; y: number }
  | { kind: "pointer-move"; pointerId: number; x: number; y: number }
  | { kind: "pointer-up"; pointerId: number; x: number; y: number }
  | { kind: "pointer-cancel" | "lost-pointer-capture"; pointerId: number }
  | { kind: "resize" }
  | { kind: "pointer-leave" }
  | { kind: "key-down"; code: string; repeat?: boolean };

export type GameInputAction =
  | { kind: "none" }
  | { kind: "mute" }
  | { kind: "primary" }
  | { kind: "intent"; intent: Intervention["kind"]; dual: boolean }
  | { kind: "run-choice"; choice: NextChoice }
  | { kind: "raid-contract"; index: number }
  | { kind: "map-node"; index: number }
  | { kind: "reroll" }
  | { kind: "offer"; index: number }
  | { kind: "move-cat"; from: number; to: number };

/**
 * action을 실제 게임·UI 부수효과에 연결하는 production 포트.
 *
 * switch까지 main.ts에 남기면 테스트는 입력 판별만 증명하고 실제 연결 누락은
 * 놓친다. DOM 비의존 실행기를 production과 테스트가 함께 써 그 틈을 없앤다.
 */
export interface GameInputEffects {
  mute(): void;
  primary(): void;
  intent(kind: Intervention["kind"], dual: boolean): void;
  runChoice(choice: NextChoice): void;
  raidContract(index: number): void;
  mapNode(index: number): void;
  reroll(): void;
  offer(index: number): void;
  moveCat(from: number, to: number): void;
}

export function executeGameInputAction(action: GameInputAction, effects: GameInputEffects): void {
  switch (action.kind) {
    case "none":
      return;
    case "mute":
      effects.mute();
      return;
    case "primary":
      effects.primary();
      return;
    case "intent":
      effects.intent(action.intent, action.dual);
      return;
    case "run-choice":
      effects.runChoice(action.choice);
      return;
    case "raid-contract":
      effects.raidContract(action.index);
      return;
    case "map-node":
      effects.mapNode(action.index);
      return;
    case "reroll":
      effects.reroll();
      return;
    case "offer":
      effects.offer(action.index);
      return;
    case "move-cat":
      effects.moveCat(action.from, action.to);
      return;
  }
}

export interface GameInputContext {
  state: RunState;
  layout: Layout;
  drag: Readonly<InputDragState>;
  /** `performance.now() - phaseChangedAt < PHASE_LOCK_MS`의 production 판정값. */
  phaseLocked: boolean;
}

export interface GameInputDispatch {
  action: GameInputAction;
  drag: InputDragState;
  /** pointer move/leave 때만 갱신한다. 생략되면 기존 hover cell을 유지한다. */
  hoverCell?: number;
  preventDefault: boolean;
  unlockAudio: boolean;
}

const NONE: GameInputAction = { kind: "none" };

function copyDrag(drag: Readonly<InputDragState>): InputDragState {
  return { ...drag };
}

function result(
  drag: Readonly<InputDragState>,
  action: GameInputAction = NONE,
  options: Partial<Pick<GameInputDispatch, "hoverCell" | "preventDefault" | "unlockAudio">> = {},
): GameInputDispatch {
  return {
    action,
    drag: copyDrag(drag),
    preventDefault: options.preventDefault ?? false,
    unlockAudio: options.unlockAudio ?? false,
    ...(options.hoverCell === undefined ? {} : { hoverCell: options.hoverCell }),
  };
}

function cancelDrag(drag: Readonly<InputDragState>): InputDragState {
  return { ...drag, active: false, fromCell: -1, pointerId: -1 };
}

function canRearrange(state: RunState): boolean {
  return state.phase === "reward" || state.phase === "prepare";
}

function enclosingRect(first: Rect | null, next: Rect): Rect {
  if (!first) return { ...next };
  const x = Math.min(first.x, next.x);
  const y = Math.min(first.y, next.y);
  return {
    x,
    y,
    w: Math.max(first.x + first.w, next.x + next.w) - x,
    h: Math.max(first.y + first.h, next.y + next.h) - y,
  };
}

function pointerDown(ctx: GameInputContext, event: Extract<GameInputEvent, { kind: "pointer-down" }>): GameInputDispatch {
  const { state, layout, drag } = ctx;
  const { x, y } = event;
  const common = { preventDefault: true, unlockAudio: true } as const;

  // 음소거는 방금 바뀐 화면을 향한 잔여 탭이 아니므로 phase lock보다 먼저다.
  if (rectHas(layout.mute, x, y)) return result(drag, { kind: "mute" }, common);
  if (ctx.phaseLocked) return result(drag, NONE, common);

  if (state.phase === "gameover") {
    const { choices } = gameoverGeometry(layout, state);
    const choice: NextChoice | null = rectHas(choices.retry, x, y)
      ? "retry"
      : rectHas(choices.daily, x, y)
        ? "daily"
        : rectHas(choices.challenge, x, y)
          ? "challenge"
          : null;
    if (choice) return result(drag, { kind: "run-choice", choice }, common);
  }

  if (rectHas(layout.button, x, y)) {
    if (state.phase === "battle") {
      const dual = dualChoiceActive(state);
      return result(
        drag,
        { kind: "intent", intent: dual ? splitButtonChoice(layout.button, x) : "act", dual },
        common,
      );
    }
    return result(drag, { kind: "primary" }, common);
  }

  if (state.phase === "map") {
    if (state.raidOffers.length > 0) {
      const index = raidContractRects(layout, state.raidOffers.length).findIndex((rect) => rectHas(rect, x, y));
      return result(drag, index >= 0 ? { kind: "raid-contract", index } : NONE, common);
    }
    const node = nearestMapNode(openMapNodeRects(layout, state), x, y);
    return result(drag, node ? { kind: "map-node", index: node.idx } : NONE, common);
  }

  if (state.phase === "reward") {
    if (rectHas(rerollRect(layout), x, y)) return result(drag, { kind: "reroll" }, common);

    const cards = offerRects(layout);
    const index = cards.findIndex((rect) => rectHas(rect, x, y));
    // 빈 카드도 보이는 슬롯이다. 구매 액션 대신 입력만 삼켜 아래 보드로 새지 않게 한다.
    if (index >= 0) {
      return result(drag, state.offers[index] ? { kind: "offer", index } : NONE, common);
    }

    if (!layout.columns) {
      let panel: Rect | null = layout.offersPanel ? { ...layout.offersPanel } : null;
      for (const card of cards) panel = enclosingRect(panel, card);
      if (panel && rectHas(panel, x, y)) return result(drag, NONE, common);
    }
  }

  if (!canRearrange(state) || drag.active) return result(drag, NONE, common);
  const fromCell = hitCell(layout, "ally", x, y);
  if (fromCell < 0 || !state.ally[fromCell]) return result(drag, NONE, common);
  return {
    ...result(drag, NONE, common),
    drag: { ...drag, active: true, fromCell, x, y, pointerId: event.pointerId },
  };
}

function keyDown(ctx: GameInputContext, event: Extract<GameInputEvent, { kind: "key-down" }>): GameInputDispatch {
  const { state, drag } = ctx;
  if (event.repeat && event.code !== "Space" && event.code !== "KeyG") return result(drag);
  const common = { unlockAudio: true } as const;
  if (event.code === "KeyM") return result(drag, { kind: "mute" }, common);
  if (ctx.phaseLocked) return result(drag, NONE, common);

  if (event.code === "Space" || event.code === "KeyG") {
    if (state.phase !== "battle") return result(drag, NONE, { ...common, preventDefault: true });
    const dual = dualChoiceActive(state);
    const intent: Intervention["kind"] = dual ? (event.code === "KeyG" ? "gather" : "dodge") : "act";
    return result(drag, { kind: "intent", intent, dual }, { ...common, preventDefault: true });
  }
  if (event.code === "Enter") {
    return result(drag, state.phase === "battle" ? NONE : { kind: "primary" }, common);
  }
  if (event.code === "KeyR") {
    return result(drag, state.phase === "reward" ? { kind: "reroll" } : NONE, common);
  }
  if (!/^Digit[1-4]$/.test(event.code)) return result(drag, NONE, common);

  const slot = Number(event.code.slice(5)) - 1;
  if (state.phase === "gameover") {
    const choice = (["retry", "daily", "challenge"] as const)[slot];
    return result(drag, choice ? { kind: "run-choice", choice } : NONE, common);
  }
  if (state.phase === "map") {
    if (state.raidOffers.length > 0) {
      return result(drag, state.raidOffers[slot] ? { kind: "raid-contract", index: slot } : NONE, common);
    }
    const index = openLanes(state.map, mapStep(state))[slot];
    return result(drag, index === undefined ? NONE : { kind: "map-node", index }, common);
  }
  if (state.phase !== "reward" || slot > 2 || !state.offers[slot]) return result(drag, NONE, common);
  return result(drag, { kind: "offer", index: slot }, common);
}

/**
 * Canvas/Window 이벤트를 게임 명령으로 바꾸는 DOM 비의존 경계다.
 *
 * 이 함수는 런 상태를 바꾸지 않는다. 호출자가 반환된 명령을 `chooseNode`,
 * `rerollOffers`, `moveCat` 같은 실제 run 함수에 전달하므로 브라우저 입력과
 * 헤드리스 검증이 같은 전이 코드를 사용한다.
 */
export function dispatchGameInput(ctx: GameInputContext, event: GameInputEvent): GameInputDispatch {
  switch (event.kind) {
    case "pointer-down":
      return pointerDown(ctx, event);
    case "key-down":
      return keyDown(ctx, event);
    case "pointer-move": {
      if (ctx.drag.active && event.pointerId !== ctx.drag.pointerId) return result(ctx.drag);
      const drag = ctx.drag.active ? { ...ctx.drag, x: event.x, y: event.y } : copyDrag(ctx.drag);
      drag.hoverX = event.x;
      drag.hoverY = event.y;
      return {
        ...result(drag, NONE, { hoverCell: canRearrange(ctx.state) ? hitCell(ctx.layout, "ally", event.x, event.y) : -1 }),
        drag,
      };
    }
    case "pointer-up": {
      if (!ctx.drag.active || event.pointerId !== ctx.drag.pointerId) return result(ctx.drag);
      const to = hitCell(ctx.layout, "ally", event.x, event.y);
      const action: GameInputAction = to >= 0
        ? { kind: "move-cat", from: ctx.drag.fromCell, to }
        : NONE;
      return { ...result(ctx.drag, action), drag: cancelDrag(ctx.drag) };
    }
    case "pointer-leave":
      return {
        ...result(ctx.drag, NONE, { hoverCell: -1 }),
        drag: { ...ctx.drag, hoverX: -1, hoverY: -1 },
      };
    case "pointer-cancel":
    case "lost-pointer-capture":
      if (!ctx.drag.active || event.pointerId !== ctx.drag.pointerId) return result(ctx.drag);
      return { ...result(ctx.drag), drag: cancelDrag(ctx.drag) };
    case "resize":
      return { ...result(ctx.drag), drag: cancelDrag(ctx.drag) };
  }
}
