import {
  actIntentKind,
  actUsable,
  dodgeUsable,
  dualChoiceActive,
  sweepDodgeFree,
  vulnerableWindowBoss,
} from "./battle.ts";
import { hitCell, type Layout } from "./layout.ts";
import { openLanes } from "./map.ts";
import {
  splitButtonChoice,
  uiInteractionDescriptor,
} from "./render.ts";
import { mapStep, type NextChoice, type Offer, type RunState } from "./run.ts";
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
  | { kind: "key-down"; code: string; repeat?: boolean }
  | { kind: "direct-action"; action: GameInputAction };

export type GameInputAction =
  | { kind: "none" }
  | { kind: "mute" }
  | { kind: "primary"; identity?: string }
  | { kind: "intent"; intent: Intervention["kind"]; dual: boolean; identity?: string }
  | { kind: "run-choice"; choice: NextChoice; identity?: string }
  | { kind: "raid-contract"; index: number; identity?: string }
  | { kind: "map-node"; index: number; identity?: string }
  | { kind: "reroll"; identity?: string }
  | { kind: "offer"; index: number; identity?: string }
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

function offerInputIdentity(offer: Offer): string {
  return JSON.stringify([
    offer.kind,
    offer.breed?.id ?? null,
    offer.targetUid ?? null,
    offer.relic?.id ?? null,
    offer.cost,
    offer.label,
    offer.sublabel,
  ]);
}

function currentActionIdentity(state: RunState, action: GameInputAction): string | null {
  switch (action.kind) {
    case "primary":
      return JSON.stringify([
        "primary",
        state.phase,
        state.phase === "reward" ? (state.relicDraftActive ? "relics" : "store") : null,
        state.phase === "reward" ? state.nodeKind : null,
        state.phase === "gameover" ? [state.seed, state.kind, state.challenge] : null,
      ]);
    case "intent": {
      const boss = vulnerableWindowBoss(state);
      return JSON.stringify([
        "intent",
        state.phase,
        dualChoiceActive(state),
        actIntentKind(state),
        action.intent,
        action.dual,
        sweepDodgeFree(state),
        state.dodgeCharges,
        boss?.uid ?? null,
        boss?.thresholdIdx ?? null,
        boss?.vulnerableCharges ?? null,
      ]);
    }
    case "run-choice":
      return JSON.stringify(["run-choice", state.phase, state.seed, state.kind, state.challenge, action.choice]);
    case "raid-contract":
      return state.raidOffers[action.index]?.id ?? null;
    case "map-node": {
      const step = mapStep(state);
      const node = state.map.steps[step]?.[action.index];
      return node
        ? JSON.stringify([state.map.stage, step, action.index, node.kind, node.wave, node.lane, node.next])
        : null;
    }
    case "offer": {
      const offer = state.offers[action.index];
      return offer ? offerInputIdentity(offer) : null;
    }
    case "reroll":
      return JSON.stringify([
        "reroll",
        state.phase,
        state.relicDraftActive,
        state.gold,
        state.freeRerolls,
        state.offers.map((offer) => offer ? offerInputIdentity(offer) : null),
      ]);
    default:
      return null;
  }
}

/**
 * 의미 DOM이 보여 준 선택과 나중에 실행할 선택을 묶는다. 같은 슬롯이 재추첨·
 * 새 단계에서 재사용돼도 사용자가 읽지 않은 다른 항목으로 바뀌어 실행되지 않는다.
 */
export function identifyGameInputAction(state: RunState, action: GameInputAction): GameInputAction {
  const identity = currentActionIdentity(state, action);
  if (identity === null) return action;
  switch (action.kind) {
    case "primary":
    case "intent":
    case "run-choice":
    case "raid-contract":
    case "map-node":
    case "reroll":
    case "offer":
      return { ...action, identity };
    default:
      return action;
  }
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

function pointerDown(ctx: GameInputContext, event: Extract<GameInputEvent, { kind: "pointer-down" }>): GameInputDispatch {
  const { state, layout, drag } = ctx;
  const { x, y } = event;
  const common = { preventDefault: true, unlockAudio: true } as const;
  const interaction = uiInteractionDescriptor(layout, state, { ...drag, hoverX: x, hoverY: y }, ctx.phaseLocked);
  if (interaction.mute) return result(drag, { kind: "mute" }, common);
  if (interaction.gameoverChoice) {
    return result(drag, { kind: "run-choice", choice: interaction.gameoverChoice }, common);
  }
  if (interaction.raidContractIndex >= 0) {
    return result(drag, { kind: "raid-contract", index: interaction.raidContractIndex }, common);
  }
  if (interaction.primary) {
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
  if (interaction.mapNodeIndex >= 0) {
    return result(drag, { kind: "map-node", index: interaction.mapNodeIndex }, common);
  }
  if (interaction.reroll) return result(drag, { kind: "reroll" }, common);
  if (interaction.offerIndex >= 0) return result(drag, { kind: "offer", index: interaction.offerIndex }, common);
  const fromCell = interaction.draggableCell;
  if (fromCell < 0) return result(drag, NONE, common);
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
    // 일반 회피의 키 반복은 유지한다. 다만 예고가 없는 취약 창에서 길게 누른
    // Space/G가 두 번째 결정타까지 자동 소비하지 않도록 반복 입력만 버린다.
    if (event.repeat && !dual && actIntentKind(state) === "strike") {
      return result(drag, NONE, { ...common, preventDefault: true });
    }
    if ((dual && !dodgeUsable(state)) || (!dual && !actUsable(state))) {
      return result(drag, NONE, { ...common, preventDefault: true });
    }
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
 * 의미 DOM과 다른 비좌표 입력이 stale 상태에서 게임 전이를 우회하지 못하게 하는
 * 공용 유효성 판정이다. 포인터·단축키가 만드는 명령의 현재 phase 계약과 같다.
 */
export function gameInputActionAvailable(state: RunState, action: GameInputAction): boolean {
  const expectedIdentity = currentActionIdentity(state, action);
  if (expectedIdentity !== null && (!("identity" in action) || action.identity !== expectedIdentity)) return false;

  switch (action.kind) {
    case "none":
      return false;
    case "mute":
      return true;
    case "primary":
      return state.phase !== "map" && state.phase !== "battle";
    case "intent": {
      if (state.phase !== "battle") return false;
      const dual = dualChoiceActive(state);
      if (action.dual !== dual) return false;
      if (dual) return (action.intent === "dodge" || action.intent === "gather") && dodgeUsable(state);
      return action.intent === "act" && actUsable(state);
    }
    case "run-choice":
      return state.phase === "gameover";
    case "raid-contract":
      return state.phase === "map"
        && Number.isInteger(action.index)
        && action.index >= 0
        && state.raidOffers[action.index] !== undefined;
    case "map-node":
      return state.phase === "map"
        && state.raidOffers.length === 0
        && Number.isInteger(action.index)
        && openLanes(state.map, mapStep(state)).includes(action.index);
    case "reroll":
      // 실패 이유도 같은 실행 경계에서 알려 주므로 자원이 없어도 입력은 유효하다.
      return state.phase === "reward";
    case "offer":
      return state.phase === "reward"
        && Number.isInteger(action.index)
        && action.index >= 0
        && state.offers[action.index] !== null
        && state.offers[action.index] !== undefined;
    case "move-cat":
      return (state.phase === "reward" || state.phase === "prepare")
        && Number.isInteger(action.from)
        && Number.isInteger(action.to)
        && action.from >= 0
        && action.to >= 0
        && action.from < state.ally.length
        && action.to < state.ally.length
        && state.ally[action.from] !== null;
  }
}

function directAction(
  ctx: GameInputContext,
  event: Extract<GameInputEvent, { kind: "direct-action" }>,
): GameInputDispatch {
  const common = { unlockAudio: true } as const;
  if (event.action.kind === "mute") return result(ctx.drag, event.action, common);
  if (ctx.phaseLocked || !gameInputActionAvailable(ctx.state, event.action)) return result(ctx.drag, NONE, common);
  return result(ctx.drag, event.action, common);
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
    case "direct-action":
      return directAction(ctx, event);
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
