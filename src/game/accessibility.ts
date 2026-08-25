import {
  actIntentKind,
  actUsable,
  dualChoiceActive,
  dodgeUsable,
  hazardZones,
  sweepDodgeFree,
  vulnerableWindowBoss,
} from "./battle.ts";
import { identifyGameInputAction, type GameInputAction } from "./input.ts";
import { nodeInfo, openLanes } from "./map.ts";
import { raidRiskLabel } from "./raid.ts";
import {
  canStartBattle,
  mapStep,
  REROLL_COST,
  type Offer,
  type Phase,
  type RunState,
} from "./run.ts";
import {
  BOARD_COLS,
  BOARD_ROWS,
  cellCol,
  cellRow,
  type Cat,
  type Telegraph,
} from "./types.ts";

export interface AccessibilityControl {
  readonly key: string;
  readonly label: string;
  readonly action: GameInputAction;
  readonly disabled: boolean;
  readonly shortcut?: string;
  readonly pressed?: boolean;
}

export interface AccessibilityBoardCell {
  readonly key: string;
  readonly index: number;
  readonly label: string;
  readonly occupied: boolean;
  readonly selected: boolean;
  readonly tabIndex: 0 | -1;
}

export interface AccessibilityBoardModel {
  readonly key: "ally-board";
  readonly label: string;
  readonly rowCount: number;
  readonly columnCount: number;
  readonly focusIndex: number;
  readonly pickedFrom: number | null;
  readonly stacked: boolean;
  readonly cells: readonly AccessibilityBoardCell[];
}

export interface AccessibilityModel {
  readonly phaseKey: string;
  readonly title: string;
  readonly description: string;
  readonly canvasLabel: string;
  readonly controls: readonly AccessibilityControl[];
  readonly board: AccessibilityBoardModel | null;
}

export interface AccessibilityModelOptions {
  readonly boardFocusIndex?: number;
  readonly pickedFrom?: number | null;
  /** `Layout.stacked`와 같은 값. 화살표 이동을 실제 화면 축에 맞춘다. */
  readonly stacked?: boolean;
}

export type BoardDirection = "up" | "down" | "left" | "right";

export interface BoardActivation {
  readonly pickedFrom: number | null;
  readonly action: GameInputAction | null;
}

export interface Announcement {
  readonly signature: string;
  readonly text: string;
}

export interface BattleAlert extends Announcement {
  readonly activeIdentity: string | null;
  readonly ended: boolean;
}

const BOARD_SIZE = BOARD_ROWS * BOARD_COLS;

const PHASE_COPY: Record<Phase, { title: string; description: string }> = {
  map: { title: "길 선택", description: "열린 길 가운데 다음 목적지를 고르세요." },
  reward: { title: "상점과 배치", description: "고양이를 고르고 진형을 정리하세요." },
  prepare: { title: "전투 준비", description: "진형을 확인한 뒤 전투를 시작하세요." },
  battle: { title: "전투", description: "예고를 읽고 필요한 순간에 개입하세요." },
  gameover: { title: "게임 오버", description: "결과를 확인하고 다음 런을 고르세요." },
};

function phaseCopy(state: RunState): { title: string; description: string } {
  if (state.phase === "map" && state.raidOffers.length > 0) {
    return { title: "악몽 계약", description: "다음 보스의 규칙과 추가 보상 하나를 고르세요." };
  }
  if (state.phase === "reward" && state.relicDraftActive) {
    return { title: "유물 선택", description: "유물 하나를 고르거나 건너뛴 뒤 상점을 이용하세요." };
  }
  return PHASE_COPY[state.phase];
}

function control(
  key: string,
  label: string,
  action: GameInputAction,
  disabled = false,
  shortcut?: string,
  pressed?: boolean,
): AccessibilityControl {
  return {
    key,
    label,
    action,
    disabled,
    ...(shortcut ? { shortcut } : {}),
    ...(pressed === undefined ? {} : { pressed }),
  };
}

function phaseKey(state: RunState): string {
  if (state.phase === "map") return state.raidOffers.length > 0 ? "map:contracts" : "map:routes";
  if (state.phase === "reward") return state.relicDraftActive ? "reward:relics" : "reward:store";
  if (state.phase === "battle") return dualChoiceActive(state) ? "battle:polarity" : "battle:single";
  return state.phase;
}

function offerLabel(offer: Offer, index: number): string {
  return `${index + 1}번 ${offer.label}, ${offer.sublabel}, 생선 ${offer.cost}`;
}

function mapControls(state: RunState): AccessibilityControl[] {
  if (state.raidOffers.length > 0) {
    return state.raidOffers.map((contract, index) => control(
      `raid-contract:${contract.id}`,
      `${index + 1}번 계약 ${contract.name}, 위험 ${raidRiskLabel(contract.risk)}, ${contract.rule}, 대응 ${contract.counter}, 승리 시 생선 +${contract.rewardFish}`,
      identifyGameInputAction(state, { kind: "raid-contract", index }),
      false,
      String(index + 1),
    ));
  }

  const step = mapStep(state);
  return openLanes(state.map, step).map((index, order) => {
    const node = state.map.steps[step]?.[index];
    const info = node ? nodeInfo(node.kind) : { name: "알 수 없는 길", hint: "" };
    return control(
      `map-node:${step}:${index}`,
      `${order + 1}번 길, ${info.name}${info.hint ? `, ${info.hint}` : ""}`,
      identifyGameInputAction(state, { kind: "map-node", index }),
      !node,
      String(order + 1),
    );
  });
}

function rewardControls(state: RunState): AccessibilityControl[] {
  const controls: AccessibilityControl[] = [];
  // 자원 부족 입력도 실제 실행 경계에서 실패 이유를 알려 주므로 막지 않는다.
  const rerollDisabled = false;
  controls.push(control(
    "reward:reroll",
    state.freeRerolls > 0 ? `무료 재추첨, ${state.freeRerolls}회 남음` : `재추첨, 생선 ${REROLL_COST}`,
    { kind: "reroll" },
    rerollDisabled,
    "R",
  ));
  state.offers.forEach((offer, index) => {
    if (!offer) return;
    controls.push(control(
      `reward:offer:${index}`,
      `${offerLabel(offer, index)}${state.gold < offer.cost ? ", 생선 부족" : ""}`,
      identifyGameInputAction(state, { kind: "offer", index }),
      false,
      String(index + 1),
    ));
  });
  controls.push(control(
    "reward:primary",
    state.relicDraftActive
      ? "유물 건너뛰기"
      : state.nodeKind === "shop"
        ? "길 고르기"
        : canStartBattle(state)
          ? "전투 시작"
          : "고양이를 먼저 데려오세요",
    { kind: "primary" },
    !state.relicDraftActive && state.nodeKind !== "shop" && !canStartBattle(state),
    "Enter",
  ));
  return controls;
}

function battleControls(state: RunState): AccessibilityControl[] {
  const locked = !dodgeUsable(state);
  const vulnerable = vulnerableWindowBoss(state);
  // 취약 창의 기회도 예고와 겹치면 방어에 쓰인다. 이때 "기회"라고만 읽으면
  // 결정타 버튼으로 오해하므로 실제 행동에 맞춰 방어/결정타 자원을 구분한다.
  const defenseResource = sweepDodgeFree(state)
    ? "연쇄 회피"
    : vulnerable && vulnerable.vulnerableCharges > 0
      ? `방어 개입 ${vulnerable.vulnerableCharges}회`
      : state.dodgeCharges > 0
        ? `회피 ${state.dodgeCharges}회`
        : locked
          ? "회피 0회"
          : "연쇄 회피";
  if (dualChoiceActive(state)) {
    return [
      control("battle:dodge", `산개, ${defenseResource}`, { kind: "intent", intent: "dodge", dual: true }, locked, "Space"),
      control("battle:gather", `집결, ${defenseResource}`, { kind: "intent", intent: "gather", dual: true }, locked, "G"),
    ];
  }

  const intent = actIntentKind(state);
  const label = intent === "strike" ? "결정타" : intent === "gather" ? "집결" : intent === "dodge" ? "산개" : "개입";
  const resource = intent === "strike"
    ? `결정타 ${vulnerable?.vulnerableCharges ?? 0}회`
    : defenseResource;
  return [control(
    "battle:act",
    `${label}, ${resource}`,
    { kind: "intent", intent: "act", dual: false },
    !actUsable(state),
    "Space",
  )];
}

function phaseControls(state: RunState): AccessibilityControl[] {
  switch (state.phase) {
    case "map":
      return mapControls(state);
    case "reward":
      return rewardControls(state);
    case "prepare":
      return [control(
        "prepare:primary",
        canStartBattle(state) ? "전투 시작" : "고양이를 먼저 데려오세요",
        { kind: "primary" },
        !canStartBattle(state),
        "Enter",
      )];
    case "battle":
      return battleControls(state);
    case "gameover":
      return [
        control("gameover:again", "같은 종류로 한 판 더", { kind: "primary" }, false, "Enter"),
        control("gameover:retry", "같은 시드 다시 도전", { kind: "run-choice", choice: "retry" }, false, "1"),
        control("gameover:daily", "오늘의 시드", { kind: "run-choice", choice: "daily" }, false, "2"),
        control("gameover:challenge", "다음 도전 단계", { kind: "run-choice", choice: "challenge" }, false, "3"),
      ];
  }
}

function clampCell(index: number): number {
  if (!Number.isFinite(index)) return 0;
  return Math.min(BOARD_SIZE - 1, Math.max(0, Math.trunc(index)));
}

export function boardCellPositionLabel(index: number, stacked = false): string {
  const cell = clampCell(index);
  const row = stacked ? BOARD_COLS - cellCol(cell) : cellRow(cell) + 1;
  const column = stacked ? cellRow(cell) + 1 : cellCol(cell) + 1;
  return `${row}행 ${column}열`;
}

export function boardCellLabel(index: number, cat: Cat | null, stacked = false): string {
  const position = boardCellPositionLabel(index, stacked);
  return cat ? `${position}, ${cat.breed.name}, 레벨 ${cat.level}` : `${position}, 빈 칸`;
}

export function createAccessibilityBoard(
  state: Pick<RunState, "ally">,
  focusIndex = 0,
  pickedFrom: number | null = null,
  stacked = false,
): AccessibilityBoardModel {
  const focus = clampCell(focusIndex);
  const picked = pickedFrom === null ? null : clampCell(pickedFrom);
  const order = stacked
    ? Array.from({ length: BOARD_SIZE }, (_, visualIndex) => {
        const visualRow = Math.floor(visualIndex / BOARD_COLS);
        const visualColumn = visualIndex % BOARD_COLS;
        return visualColumn * BOARD_COLS + (BOARD_COLS - 1 - visualRow);
      })
    : Array.from({ length: BOARD_SIZE }, (_, index) => index);
  const cells = order.map((index): AccessibilityBoardCell => {
    const cat = state.ally[index] ?? null;
    return {
      key: `board-cell:${index}`,
      index,
      label: boardCellLabel(index, cat, stacked),
      occupied: cat !== null,
      selected: picked === index,
      tabIndex: focus === index ? 0 : -1,
    };
  });
  return {
    key: "ally-board",
    label: "아군 배치판",
    rowCount: BOARD_ROWS,
    columnCount: BOARD_COLS,
    focusIndex: focus,
    pickedFrom: picked,
    stacked,
    cells,
  };
}

export function moveBoardFocus(index: number, direction: BoardDirection, stacked = false): number {
  const current = clampCell(index);
  const row = cellRow(current);
  const col = cellCol(current);
  if (stacked) {
    // stacked 보드는 화면 x=row, 화면 y=BOARD_COLS-1-col로 전치된다.
    switch (direction) {
      case "up":
        return col < BOARD_COLS - 1 ? current + 1 : current;
      case "down":
        return col > 0 ? current - 1 : current;
      case "left":
        return row > 0 ? current - BOARD_COLS : current;
      case "right":
        return row < BOARD_ROWS - 1 ? current + BOARD_COLS : current;
    }
  }
  switch (direction) {
    case "up":
      return row > 0 ? current - BOARD_COLS : current;
    case "down":
      return row < BOARD_ROWS - 1 ? current + BOARD_COLS : current;
    case "left":
      return col > 0 ? current - 1 : current;
    case "right":
      return col < BOARD_COLS - 1 ? current + 1 : current;
  }
}

export function activateBoardCell(
  state: Pick<RunState, "ally">,
  index: number,
  pickedFrom: number | null,
): BoardActivation {
  if (!Number.isInteger(index) || index < 0 || index >= BOARD_SIZE) {
    return { pickedFrom, action: null };
  }
  const target = index;
  if (pickedFrom === null) {
    return state.ally[target]
      ? { pickedFrom: target, action: null }
      : { pickedFrom: null, action: null };
  }
  const from = clampCell(pickedFrom);
  if (from === target) return { pickedFrom: null, action: null };
  return {
    pickedFrom: null,
    action: { kind: "move-cat", from, to: target },
  };
}

export function cancelBoardPickup(): null {
  return null;
}

export function deriveAccessibilityModel(
  state: RunState,
  muted: boolean,
  options: AccessibilityModelOptions = {},
): AccessibilityModel {
  const copy = phaseCopy(state);
  const key = phaseKey(state);
  const controls = [
    ...phaseControls(state),
    control("global:mute", muted ? "효과음 켜기" : "효과음 끄기", { kind: "mute" }, false, "M", muted),
  ].map((entry): AccessibilityControl => ({
    ...entry,
    action: identifyGameInputAction(state, entry.action),
  }));
  const board = state.phase === "reward" || state.phase === "prepare"
    ? createAccessibilityBoard(state, options.boardFocusIndex, options.pickedFrom ?? null, options.stacked ?? false)
    : null;
  return {
    phaseKey: key,
    title: copy.title,
    description: copy.description,
    canvasLabel: `냥 아레나, ${copy.title}. ${copy.description}`,
    controls,
    board,
  };
}

function roundIdentity(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function telegraphIdentity(zone: Telegraph): readonly unknown[] {
  return [
    zone.mode,
    zone.shape,
    roundIdentity(zone.fx),
    roundIdentity(zone.fy),
    roundIdentity(zone.dirX),
    roundIdentity(zone.dirY),
    roundIdentity(zone.arg),
    roundIdentity(zone.reach),
    zone.resident === true,
    zone.seize === true,
  ];
}

function activeBattleAlert(state: RunState): BattleAlert | null {
  if (state.phase !== "battle") return null;
  const ownerByZone = new Map<Telegraph, Cat>();
  for (const cat of state.enemy) {
    if (!cat?.alive) continue;
    if (cat.telegraph) ownerByZone.set(cat.telegraph, cat);
    if (cat.telegraph2) ownerByZone.set(cat.telegraph2, cat);
  }
  const telegraphs = hazardZones(state)
    // 발동 뒤 남은 creep은 새 예고가 아니라 이미 진행 중인 지형이다.
    .filter((zone) => !("idleMs" in zone))
    .map((zone) => ({ owner: ownerByZone.get(zone) ?? null, zone }));
  if (telegraphs.length > 0) {
    const identities = telegraphs.map(({ owner, zone }) => [owner?.uid ?? "field", owner?.thresholdIdx ?? -1, ...telegraphIdentity(zone)]);
    const modes = new Set(telegraphs.map(({ zone }) => zone.mode));
    const polarity = modes.has("avoid") && modes.has("gather");
    const text = polarity
      ? "극성 예고. 산개와 집결 중 안전한 쪽을 고르세요."
      : modes.has("gather")
        ? "집결 예고. 고양이를 한곳에 모으세요."
        : "산개 예고. 위험 장판에서 벗어나세요.";
    const identity = `battle:alert:${polarity ? "polarity" : modes.has("gather") ? "gather" : "avoid"}:${JSON.stringify(identities)}`;
    return { signature: identity, activeIdentity: identity, text, ended: false };
  }

  const vulnerable = state.enemy.find((cat) => cat?.alive && cat.radius > 0 && cat.vulnerableMs > 0 && cat.vulnerableCharges > 0);
  if (!vulnerable) return null;
  const identity = `battle:alert:strike:${vulnerable.uid}:${vulnerable.thresholdIdx}`;
  return {
    signature: identity,
    activeIdentity: identity,
    text: "결정타 기회. 지금 약점을 공격하세요.",
    ended: false,
  };
}

/**
 * 전투 예고의 의미·신원만 서명한다. fuse와 vulnerableMs는 일부러 제외해
 * 프레임마다 줄어드는 시간 때문에 같은 안내가 반복되지 않게 한다.
 */
export function deriveBattleAlert(
  state: RunState,
  previousActiveIdentity: string | null = null,
): BattleAlert | null {
  const active = activeBattleAlert(state);
  if (active) return active;
  if (!previousActiveIdentity || previousActiveIdentity.startsWith("battle:alert:end:")) return null;
  return {
    signature: `battle:alert:end:${previousActiveIdentity}`,
    activeIdentity: null,
    text: "전투 예고가 끝났습니다.",
    ended: true,
  };
}

function offerSignature(offer: Offer | null): readonly unknown[] | null {
  if (!offer) return null;
  return [offer.kind, offer.label, offer.sublabel, offer.cost, offer.targetUid ?? null, offer.relic?.id ?? null];
}

/** 매 프레임 값은 제외하고, 플레이어에게 의미 있는 상태 전이만 서명한다. */
export function derivePoliteAnnouncement(state: RunState): Announcement {
  const key = phaseKey(state);
  const salient = state.phase === "map"
    ? [state.map.stage, state.step, state.map.taken.slice(0, state.step + 1), state.raidContract?.id ?? null, state.raidOffers.map((offer) => offer.id)]
    : state.phase === "reward"
      ? [state.gold, state.freeRerolls, state.relicDraftActive, state.offers.map(offerSignature)]
      : state.phase === "gameover"
        ? [state.wave, state.lossReason, state.killer?.name ?? null, state.kind, state.challenge, state.recordBroken]
        : state.phase === "prepare"
          ? [state.nodeKind, state.wave]
          : [state.wave];
  // 전투 중 polarity gate의 열림/닫힘은 assertive 예고가 맡는다. polite phase가
  // 같은 사건을 다시 읽지 않도록 구조 키를 `battle` 하나로 고정한다.
  const announcementKey = state.phase === "battle" ? "battle" : key;
  const signature = `polite:${JSON.stringify([announcementKey, state.notice, salient])}`;
  const fallback = phaseCopy(state);
  const notice = state.phase === "battle" || (state.phase === "map" && state.raidOffers.length > 0)
    ? ""
    : state.notice.trim();
  return {
    signature,
    text: notice || `${fallback.title}. ${fallback.description}`,
  };
}

/** live region 호출자가 동일 서명을 다시 쓰지 않게 하는 작은 상태 경계. */
export class AnnouncementDeduper {
  #lastSignature: string | null = null;

  next(announcement: Announcement | null): string | null {
    if (!announcement || announcement.signature === this.#lastSignature) return null;
    this.#lastSignature = announcement.signature;
    return announcement.text;
  }

  reset(): void {
    this.#lastSignature = null;
  }
}
