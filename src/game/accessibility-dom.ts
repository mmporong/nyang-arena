import {
  moveBoardFocus,
  type AccessibilityBoardCell,
  type AccessibilityControl,
  type AccessibilityModel,
  type Announcement,
  type BoardDirection,
} from "./accessibility.ts";

export interface AccessibilityDomCallbacks {
  activate(control: AccessibilityControl): void;
  focus(control: AccessibilityControl | null): void;
  boardFocus(index: number): void;
  boardActivate(index: number): void;
  boardCancel(): void;
}

export interface AccessibilityDomObservation {
  readonly phaseKey: string;
  readonly controlKeys: readonly string[];
  readonly focusKey: string | null;
  readonly politeUpdates: number;
  readonly alertUpdates: number;
  readonly politeText: string;
  readonly alertText: string;
}

export interface AccessibilityDomBridge {
  sync(model: AccessibilityModel): void;
  announcePolite(announcement: Announcement | null): boolean;
  consumePolite(announcement: Announcement | null): void;
  announceAlert(announcement: Announcement | null): boolean;
  observation(): AccessibilityDomObservation;
}

interface LiveState {
  signature: string | null;
  updates: number;
}

const INTERACTIVE_SELECTOR = "button, input, select, textarea, a[href], [contenteditable='true'], [role='gridcell']";

/** 네이티브 컨트롤의 Enter/Space는 브라우저가 click으로 바꾼다. 전역 단축키가 재처리하지 않는다. */
export function isNativeInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(INTERACTIVE_SELECTOR) !== null;
}

function setAttribute(element: Element, name: string, value: string | null): void {
  if (value === null) {
    if (element.hasAttribute(name)) element.removeAttribute(name);
    return;
  }
  if (element.getAttribute(name) !== value) element.setAttribute(name, value);
}

function setText(element: HTMLElement, text: string): void {
  if (element.textContent !== text) element.textContent = text;
}

function createButton(): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  return button;
}

function boardDirection(code: string): BoardDirection | null {
  switch (code) {
    case "ArrowUp":
      return "up";
    case "ArrowDown":
      return "down";
    case "ArrowLeft":
      return "left";
    case "ArrowRight":
      return "right";
    default:
      return null;
  }
}

export function createAccessibilityDomBridge(
  root: HTMLElement,
  callbacks: AccessibilityDomCallbacks,
): AccessibilityDomBridge {
  const panel = document.createElement("section");
  panel.className = "game-a11y-controls";
  panel.setAttribute("aria-label", "냥 아레나 조작 패널");

  const title = document.createElement("h2");
  const description = document.createElement("p");
  description.id = "game-a11y-description";
  const actions = document.createElement("div");
  actions.className = "game-a11y-actions";
  const board = document.createElement("div");
  board.className = "game-a11y-board";
  board.setAttribute("role", "grid");
  const boardRows = Array.from({ length: 5 }, (_, index) => {
    const row = document.createElement("div");
    row.className = "game-a11y-row";
    row.setAttribute("role", "row");
    row.setAttribute("aria-rowindex", String(index + 1));
    board.appendChild(row);
    return row;
  });
  const global = document.createElement("div");
  global.className = "game-a11y-global";
  global.setAttribute("aria-label", "전체 설정");
  const polite = document.createElement("div");
  polite.className = "sr-only";
  polite.dataset.live = "polite";
  polite.setAttribute("role", "status");
  polite.setAttribute("aria-live", "polite");
  polite.setAttribute("aria-atomic", "true");
  const alert = document.createElement("div");
  alert.className = "sr-only";
  alert.dataset.live = "assertive";
  alert.setAttribute("role", "alert");
  alert.setAttribute("aria-live", "assertive");
  alert.setAttribute("aria-atomic", "true");
  panel.append(title, description, actions, board, global, polite, alert);
  root.appendChild(panel);

  const controlButtons = new Map<string, HTMLButtonElement>();
  const boardButtons = new Map<string, HTMLButtonElement>();
  const descriptors = new Map<string, AccessibilityControl>();
  let modelSignature = "";
  let currentModel: AccessibilityModel | null = null;
  let orderedFocusKeys: string[] = [];
  const politeState: LiveState = { signature: null, updates: 0 };
  const alertState: LiveState = { signature: null, updates: 0 };

  const controlButton = (key: string): HTMLButtonElement => {
    const existing = controlButtons.get(key);
    if (existing) return existing;
    const button = createButton();
    button.dataset.focusKey = key;
    button.addEventListener("click", () => {
      const descriptor = descriptors.get(key);
      if (descriptor) callbacks.activate(descriptor);
    });
    button.addEventListener("focus", () => callbacks.focus(descriptors.get(key) ?? null));
    button.addEventListener("blur", () => {
      queueMicrotask(() => {
        if (!panel.contains(document.activeElement)) callbacks.focus(null);
      });
    });
    controlButtons.set(key, button);
    return button;
  };

  const boardButton = (cell: AccessibilityBoardCell): HTMLButtonElement => {
    const existing = boardButtons.get(cell.key);
    if (existing) return existing;
    const button = createButton();
    button.dataset.focusKey = cell.key;
    button.dataset.boardIndex = String(cell.index);
    button.setAttribute("role", "gridcell");
    button.addEventListener("focus", () => callbacks.boardFocus(cell.index));
    button.addEventListener("click", () => callbacks.boardActivate(cell.index));
    button.addEventListener("keydown", (event) => {
      if (!currentModel?.board) return;
      const index = Number(button.dataset.boardIndex);
      const direction = boardDirection(event.code);
      if (direction) {
        event.preventDefault();
        const next = moveBoardFocus(index, direction, currentModel.board.stacked);
        callbacks.boardFocus(next);
        boardButtons.get(`board-cell:${next}`)?.focus();
        return;
      }
      if (event.code === "Escape") {
        event.preventDefault();
        callbacks.boardCancel();
      }
      // Enter/Space는 네이티브 button click 한 번에만 맡긴다.
    });
    boardButtons.set(cell.key, button);
    return button;
  };

  const syncControls = (controls: readonly AccessibilityControl[]): void => {
    descriptors.clear();
    const desired = new Set<string>();
    for (const descriptor of controls) {
      desired.add(descriptor.key);
      descriptors.set(descriptor.key, descriptor);
      const button = controlButton(descriptor.key);
      setText(button, descriptor.label);
      button.disabled = descriptor.disabled;
      setAttribute(button, "aria-keyshortcuts", descriptor.shortcut ?? null);
      setAttribute(button, "aria-pressed", descriptor.pressed === undefined ? null : String(descriptor.pressed));
      (descriptor.key.startsWith("global:") ? global : actions).appendChild(button);
    }
    for (const [key, button] of controlButtons) {
      if (desired.has(key)) continue;
      button.remove();
      controlButtons.delete(key);
    }
  };

  const syncBoard = (model: AccessibilityModel): void => {
    const boardModel = model.board;
    board.hidden = boardModel === null;
    if (!boardModel) {
      for (const button of boardButtons.values()) button.remove();
      boardButtons.clear();
      return;
    }
    setAttribute(board, "aria-label", boardModel.label);
    setAttribute(board, "aria-rowcount", String(boardModel.rowCount));
    setAttribute(board, "aria-colcount", String(boardModel.columnCount));
    const desired = new Set<string>();
    boardModel.cells.forEach((cell, visualIndex) => {
      desired.add(cell.key);
      const button = boardButton(cell);
      button.dataset.boardIndex = String(cell.index);
      setText(button, cell.occupied ? `${cell.index + 1}` : "·");
      setAttribute(button, "aria-label", cell.label);
      setAttribute(button, "aria-selected", String(cell.selected));
      setAttribute(button, "aria-colindex", String((visualIndex % boardModel.columnCount) + 1));
      button.tabIndex = cell.tabIndex;
      boardRows[Math.floor(visualIndex / boardModel.columnCount)]?.appendChild(button);
    });
    for (const [key, button] of boardButtons) {
      if (desired.has(key)) continue;
      button.remove();
      boardButtons.delete(key);
    }
  };

  const writeLive = (element: HTMLElement, state: LiveState, announcement: Announcement | null): boolean => {
    if (!announcement || announcement.signature === state.signature) return false;
    state.signature = announcement.signature;
    state.updates += 1;
    if (element.textContent === announcement.text) {
      const update = state.updates;
      element.textContent = "";
      queueMicrotask(() => {
        if (state.updates === update) setText(element, announcement.text);
      });
    } else {
      setText(element, announcement.text);
    }
    return true;
  };

  return {
    sync(model) {
      const signature = JSON.stringify(model);
      if (signature === modelSignature) return;
      const previousPhase = currentModel?.phaseKey ?? null;
      const active = panel.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
      const activeKey = active?.dataset.focusKey ?? null;
      const previousIndex = activeKey ? orderedFocusKeys.indexOf(activeKey) : -1;
      const hadPanelFocus = active !== null;

      currentModel = model;
      modelSignature = signature;
      setText(title, model.title);
      setText(description, model.description);
      panel.dataset.phase = model.phaseKey;
      panel.setAttribute("aria-describedby", description.id);
      syncControls(model.controls);
      syncBoard(model);
      orderedFocusKeys = [
        ...model.controls.filter((entry) => !entry.disabled && !entry.key.startsWith("global:")).map((entry) => entry.key),
        ...(model.board?.cells.filter((cell) => cell.tabIndex === 0).map((cell) => cell.key) ?? []),
        ...model.controls.filter((entry) => !entry.disabled && entry.key.startsWith("global:")).map((entry) => entry.key),
      ];

      if (!hadPanelFocus) return;
      const phaseChanged = previousPhase !== null && previousPhase !== model.phaseKey;
      const preferred = !phaseChanged && activeKey && orderedFocusKeys.includes(activeKey)
        ? activeKey
        : orderedFocusKeys[Math.max(0, phaseChanged ? 0 : Math.min(previousIndex, orderedFocusKeys.length - 1))];
      if (!preferred) return;
      (controlButtons.get(preferred) ?? boardButtons.get(preferred))?.focus();
    },
    announcePolite(announcement) {
      return writeLive(polite, politeState, announcement);
    },
    consumePolite(announcement) {
      if (announcement) politeState.signature = announcement.signature;
    },
    announceAlert(announcement) {
      return writeLive(alert, alertState, announcement);
    },
    observation() {
      const focused = panel.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
      return {
        phaseKey: currentModel?.phaseKey ?? "",
        controlKeys: [...orderedFocusKeys],
        focusKey: focused?.dataset.focusKey ?? null,
        politeUpdates: politeState.updates,
        alertUpdates: alertState.updates,
        politeText: polite.textContent ?? "",
        alertText: alert.textContent ?? "",
      };
    },
  };
}
