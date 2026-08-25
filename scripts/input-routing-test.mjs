import assert from "node:assert/strict";

import { queueIntervention, stepBattle } from "../src/game/battle.ts";
import { breedById } from "../src/game/breeds.ts";
import { computeLayout, cellRect, hitCell, rectHas } from "../src/game/layout.ts";
import {
  dispatchGameInput,
  executeGameInputAction,
  gameInputActionAvailable,
  identifyGameInputAction,
} from "../src/game/input.ts";
import { openLanes } from "../src/game/map.ts";
import {
  createOfferPurchaseFailure,
  drawRaidPatternEmblem,
  gameoverGeometry,
  isRaidContractFocused,
  normalizeRaidContractFocusIndex,
  offerPurchaseFailureIsCurrent,
  offerPurchaseFeedbackDescriptor,
  openMapNodeRects,
  offerRects,
  raidContractInteractionVisual,
  raidContractRects,
  rerollRect,
  setRaidContractFocusIndex,
  uiInteractionDescriptor,
} from "../src/game/render.ts";
import {
  chooseNode,
  chooseRaidContract,
  makeCat,
  mapStep,
  moveCat,
  newRun,
  nextRunFrom,
  rerollOffers,
} from "../src/game/run.ts";
import { RAID_PATTERN_TOKENS } from "../src/validate/raid-contract-schema.ts";

const idleDrag = () => ({
  active: false,
  fromCell: -1,
  x: 0,
  y: 0,
  pointerId: -1,
  hoverX: -1,
  hoverY: -1,
});

const center = (rect) => ({ x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 });
const actionOf = (outcome) => outcome.action;
const ctx = (state, layout, drag = idleDrag(), phaseLocked = false) => ({ state, layout, drag, phaseLocked });
const seedTestCat = (state, cell = 12) => {
  const cat = makeCat(breedById(1), "ally", cell);
  state.ally[cell] = cat;
  return cat;
};

assert.equal(normalizeRaidContractFocusIndex(0), 0, "첫 계약 focus가 사라졌다");
assert.equal(normalizeRaidContractFocusIndex(2), 2, "셋째 계약 focus가 사라졌다");
assert.equal(normalizeRaidContractFocusIndex(-1), -1, "focus 해제가 정규화되지 않았다");
assert.equal(normalizeRaidContractFocusIndex(3), -1, "없는 계약 focus가 Canvas로 새었다");

setRaidContractFocusIndex(0);
assert.equal(isRaidContractFocused(0), true, "첫 DOM focus가 첫 Canvas 카드에 닿지 않았다");
assert.equal(isRaidContractFocused(1), false, "DOM focus가 다른 Canvas 카드에도 번졌다");
setRaidContractFocusIndex(2);
assert.equal(isRaidContractFocused(2), true, "focus 이동이 셋째 Canvas 카드에 닿지 않았다");
assert.equal(isRaidContractFocused(2, 0), false, "계약 제안 소멸 뒤 focus가 Canvas에 남았다");
setRaidContractFocusIndex(-1);
assert.equal(isRaidContractFocused(2), false, "blur 뒤 Canvas focus가 해제되지 않았다");

assert.deepEqual(
  raidContractInteractionVisual(false, true),
  {
    active: true,
    borderRole: "focus",
    borderWidth: 3,
    focusRing: true,
    focusRingGap: 4,
    focusRingWidth: 3,
    translateY: 0,
  },
  "keyboard focus는 금색 3px ring이고 카드를 움직이지 않아야 한다",
);
assert.deepEqual(
  raidContractInteractionVisual(true, false),
  {
    active: true,
    borderRole: "action",
    borderWidth: 3,
    focusRing: false,
    focusRingGap: 4,
    focusRingWidth: 0,
    translateY: -4,
  },
  "pointer hover는 주황 outline과 4px 상승으로 focus와 달라야 한다",
);

const emblemSignatures = new Set();
for (const pattern of RAID_PATTERN_TOKENS) {
  const calls = [];
  const fakeContext = {
    save: () => calls.push(["save"]),
    beginPath: () => calls.push(["beginPath"]),
    arc: (...args) => calls.push(["arc", ...args]),
    fill: () => calls.push(["fill"]),
    stroke: () => calls.push(["stroke"]),
    translate: (...args) => calls.push(["translate", ...args]),
    moveTo: (...args) => calls.push(["moveTo", ...args]),
    lineTo: (...args) => calls.push(["lineTo", ...args]),
    closePath: () => calls.push(["closePath"]),
    restore: () => calls.push(["restore"]),
  };
  drawRaidPatternEmblem(fakeContext, { x: 0, y: 0, w: 40, h: 40 }, pattern, "#f5a03c");
  assert.deepEqual(calls[0], ["save"], `${pattern} 인장이 Canvas 상태를 보존하지 않았다`);
  assert.deepEqual(calls.at(-1), ["restore"], `${pattern} 인장이 Canvas 상태를 복원하지 않았다`);
  assert.ok(calls.length > 8, `${pattern} 인장이 빈 도형으로 퇴행했다`);
  emblemSignatures.add(JSON.stringify(calls));
}
assert.equal(emblemSignatures.size, RAID_PATTERN_TOKENS.length, "서로 다른 보스 패턴 인장이 같은 도형으로 뭉개졌다");

function executeRunAction(state, action) {
  const result = {};
  executeGameInputAction(action, {
    mute: () => { result.called = "mute"; },
    primary: () => { result.called = "primary"; },
    intent: (kind, dual) => { result.intent = { kind, dual }; },
    runChoice: (choice) => { result.next = nextRunFrom(state, choice); },
    raidContract: (index) => { result.ok = chooseRaidContract(state, index); },
    mapNode: (index) => { result.ok = chooseNode(state, index); },
    reroll: () => { result.ok = rerollOffers(state); },
    offer: (index) => { result.offer = index; },
    moveCat: (from, to) => {
      moveCat(state, from, to);
      result.moved = { from, to };
    },
  });
  return result;
}

function pointerDown(state, layout, rect, drag = idleDrag(), phaseLocked = false, pointerId = 1) {
  return dispatchGameInput(ctx(state, layout, drag, phaseLocked), {
    kind: "pointer-down",
    pointerId,
    ...center(rect),
  });
}

const desktop = computeLayout(1280, 800, true);
const state = newRun(424242);
seedTestCat(state);

const failureVisual = offerPurchaseFeedbackDescriptor(desktop, 1, "insufficient-fish", 40, false);
assert.ok(failureVisual, "생선 부족 카드의 국소 실패 descriptor가 사라졌다");
assert.equal(failureVisual.durationMs, 200, "구매 실패가 160~220ms 계약을 벗어났다");
assert.equal(failureVisual.label, "생선 부족", "구매 실패 라벨이 즉시 원인을 말하지 않는다");
assert.deepEqual(
  { x: failureVisual.translateX, y: failureVisual.translateY },
  { x: 0, y: 0 },
  "구매 실패가 카드 흔들림을 만들었다",
);
assert.equal(
  offerPurchaseFeedbackDescriptor(desktop, 1, "success", 40, false),
  null,
  "구매 성공이 실패 outline 경로에 섞였다",
);
assert.equal(
  offerPurchaseFeedbackDescriptor(desktop, 1, "insufficient-fish", 200, false),
  null,
  "구매 실패 outline이 계약 시간 뒤에도 남았다",
);
const reducedFailure = offerPurchaseFeedbackDescriptor(desktop, 1, "insufficient-fish", 40, true);
assert.equal(reducedFailure?.durationMs, 160, "reduced-motion 실패 피드백이 160ms 정적 계약을 지키지 않았다");
assert.equal(
  offerPurchaseFeedbackDescriptor(desktop, Number.NaN, "insufficient-fish", 40, false),
  null,
  "NaN 슬롯이 구매 실패 기하로 들어왔다",
);

const failedOffer = {
  kind: "recruit",
  cost: 99,
  label: "실패 표본",
  sublabel: "identity 회귀",
};
const failureState = createOfferPurchaseFailure(1, failedOffer, 100);
assert.ok(failureState, "유효한 구매 실패 상태를 만들지 못했다");
assert.equal(offerPurchaseFailureIsCurrent(failureState, [null, failedOffer, null]), true);
assert.equal(
  offerPurchaseFailureIsCurrent(failureState, [null, { ...failedOffer }, null]),
  false,
  "재추첨한 새 카드에 이전 실패 상태가 옮겨 붙었다",
);
failedOffer.cost = 98;
assert.equal(
  offerPurchaseFailureIsCurrent(failureState, [null, failedOffer, null]),
  false,
  "동일 객체의 내용이 바뀌었는데 실패 snapshot이 남았다",
);
assert.equal(createOfferPurchaseFailure(Number.NaN, failedOffer, 100), null, "NaN 실패 슬롯이 상태로 등록됐다");

// 짧은 세로 티켓 세 장도 카드 중심과 숫자 1/2/3이 같은 실제 계약 전이를 만든다.
for (const [w, h] of [[320, 480], [390, 500]]) {
  const mobile = computeLayout(w, h, true);
  for (let index = 0; index < 3; index++) {
    const pointerState = newRun(800000 + w * 10 + h + index);
    const keyState = newRun(800000 + w * 10 + h + index);
    const rect = raidContractRects(mobile, pointerState.raidOffers.length)[index];
    assert.ok(rect, `${w}×${h}의 ${index + 1}번 계약 티켓이 사라졌다`);
    const pointer = pointerDown(pointerState, mobile, rect);
    const key = dispatchGameInput(ctx(keyState, mobile), { kind: "key-down", code: `Digit${index + 1}` });
    assert.deepEqual(actionOf(pointer), { kind: "raid-contract", index });
    assert.deepEqual(actionOf(pointer), actionOf(key), `${w}×${h} ${index + 1}번 계약의 pointer/keyboard 명령이 달라졌다`);
    assert.equal(executeRunAction(pointerState, pointer.action).ok, true, `${w}×${h} ${index + 1}번 pointer 계약 전이가 실패했다`);
    assert.equal(executeRunAction(keyState, key.action).ok, true, `${w}×${h} ${index + 1}번 숫자키 계약 전이가 실패했다`);
    assert.equal(pointerState.raidContract?.id, keyState.raidContract?.id, `${w}×${h} ${index + 1}번 실제 선택 결과가 달라졌다`);
  }

  const overlapState = newRun(900000 + w * 10 + h);
  const third = raidContractRects(mobile, overlapState.raidOffers.length)[2];
  assert.ok(third, `${w}×${h}의 셋째 계약 티켓이 사라졌다`);
  const overlap = {
    x: Math.max(third.x, mobile.button.x),
    y: Math.max(third.y, mobile.button.y),
    w: Math.min(third.x + third.w, mobile.button.x + mobile.button.w) - Math.max(third.x, mobile.button.x),
    h: Math.min(third.y + third.h, mobile.button.y + mobile.button.h) - Math.max(third.y, mobile.button.y),
  };
  assert.ok(overlap.w > 0 && overlap.h > 0, `${w}×${h} 회귀 표본이 숨은 primary 영역과 겹치지 않는다`);
  const overlapPointer = pointerDown(overlapState, mobile, overlap);
  assert.deepEqual(actionOf(overlapPointer), { kind: "raid-contract", index: 2 }, `${w}×${h}의 숨은 primary 영역이 셋째 계약을 가로챘다`);
  assert.equal(executeRunAction(overlapState, overlapPointer.action).ok, true, `${w}×${h} 셋째 계약의 겹침 지점 전이가 실패했다`);

  const edgeState = newRun(910000 + w * 10 + h);
  const edgePointer = dispatchGameInput(ctx(edgeState, mobile), {
    kind: "pointer-down",
    pointerId: 1,
    x: third.x + third.w / 2,
    y: third.y + third.h - 1,
  });
  assert.deepEqual(actionOf(edgePointer), { kind: "raid-contract", index: 2 }, `${w}×${h} 셋째 계약의 하단 1px이 클릭되지 않는다`);
  assert.equal(executeRunAction(edgeState, edgePointer.action).ok, true, `${w}×${h} 셋째 계약 하단의 실제 전이가 실패했다`);
}

// 계약 카드의 그림과 입력은 같은 raidContractRects를 쓰고, 숫자키도 같은 명령을 낸다.
const contractRect = raidContractRects(desktop, state.raidOffers.length)[1];
assert.ok(contractRect, "두 번째 계약 카드 기하가 있어야 한다");
const contractPointer = pointerDown(state, desktop, contractRect);
const contractKey = dispatchGameInput(ctx(state, desktop), { kind: "key-down", code: "Digit2" });
assert.deepEqual(actionOf(contractPointer), { kind: "raid-contract", index: 1 });
assert.deepEqual(actionOf(contractPointer), actionOf(contractKey), "계약 pointer/keyboard 명령이 달라졌다");
assert.equal(executeRunAction(state, contractPointer.action).ok, true, "실제 계약 전이가 실패했다");
assert.equal(state.raidOffers.length, 0, "계약 선택 뒤 지도가 열려야 한다");

// 패배 뒤 세 갈래도 버튼과 숫자키가 같은 명령을 내고 실제 재진입 전이에 연결된다.
const gameoverState = newRun(171717);
gameoverState.phase = "gameover";
const dailyChoice = gameoverGeometry(desktop, gameoverState).choices.daily;
const runPointer = pointerDown(gameoverState, desktop, dailyChoice);
const runKey = dispatchGameInput(ctx(gameoverState, desktop), { kind: "key-down", code: "Digit2" });
assert.deepEqual(actionOf(runPointer), { kind: "run-choice", choice: "daily" });
assert.deepEqual(actionOf(runPointer), actionOf(runKey), "다음 런 pointer/keyboard 명령이 달라졌다");
assert.equal(executeRunAction(gameoverState, runPointer.action).next.kind, "daily", "실제 오늘 런 전이와 연결되지 않았다");

// 열린 지도 노드 중 상점으로 들어가 실제 reward 전이를 만든다.
const step = mapStep(state);
const shopNode = openMapNodeRects(desktop, state).find(
  ({ idx }) => state.map.steps[step]?.[idx]?.kind === "shop",
);
assert.ok(shopNode, "첫 준비 관문에 열린 상점 노드가 있어야 한다");
const mapPointer = pointerDown(state, desktop, shopNode.rect);
const open = openLanes(state.map, step);
const shortcut = open.indexOf(shopNode.idx) + 1;
assert.ok(shortcut >= 1 && shortcut <= 4, "열린 지도 노드의 단축키 순서를 찾지 못했다");
const mapKey = dispatchGameInput(ctx(state, desktop), { kind: "key-down", code: `Digit${shortcut}` });
assert.deepEqual(actionOf(mapPointer), { kind: "map-node", index: shopNode.idx });
assert.deepEqual(actionOf(mapPointer), actionOf(mapKey), "지도 pointer/keyboard 명령이 달라졌다");
assert.equal(executeRunAction(state, mapPointer.action).ok, true, "실제 지도 전이가 실패했다");
assert.equal(state.phase, "reward", "상점 노드가 실제 보상 국면으로 이어지지 않았다");

// 재추첨도 pointer/R가 같은 명령을 내고, 비용과 카드 변경은 run.ts가 수행한다.
const rerollPointer = pointerDown(state, desktop, rerollRect(desktop));
const rerollKey = dispatchGameInput(ctx(state, desktop), { kind: "key-down", code: "KeyR" });
assert.deepEqual(actionOf(rerollPointer), { kind: "reroll" });
assert.deepEqual(actionOf(rerollPointer), actionOf(rerollKey), "재추첨 pointer/keyboard 명령이 달라졌다");
const beforeReroll = { gold: state.gold, offers: state.offers.map((offer) => offer?.label ?? null) };
assert.equal(executeRunAction(state, rerollPointer.action).ok, true, "실제 재추첨 전이가 실패했다");
assert.notDeepEqual(
  { gold: state.gold, offers: state.offers.map((offer) => offer?.label ?? null) },
  beforeReroll,
  "재추첨이 비용과 카드 중 어느 것도 바꾸지 않았다",
);

// cursor는 draw 순서가 아니라 한 descriptor가 정한다. 상점 카드·재추첨·주 행동과
// 패배 선택 모두 같은 pointer 상태를 쓰고, 화면 밖 좌표는 즉시 default로 돌아간다.
const withHover = (rect) => {
  const p = center(rect);
  return { ...idleDrag(), hoverX: p.x, hoverY: p.y };
};
const visibleOfferIndex = state.offers.findIndex(Boolean);
assert.ok(visibleOfferIndex >= 0, "hover 회귀용 상점 카드가 없다");
const offerHover = uiInteractionDescriptor(desktop, state, withHover(offerRects(desktop)[visibleOfferIndex]));
assert.equal(offerHover.cursor, "pointer", "상점 카드 hover cursor가 pointer가 아니다");
assert.equal(offerHover.offerIndex, visibleOfferIndex, "상점 카드 hover slot이 어긋났다");
const rerollHover = uiInteractionDescriptor(desktop, state, withHover(rerollRect(desktop)));
assert.equal(rerollHover.reroll, true, "재추첨 hover가 중앙 descriptor에 잡히지 않았다");
const primaryHover = uiInteractionDescriptor(desktop, state, withHover(desktop.button));
assert.equal(primaryHover.primary, true, "주 행동 버튼 hover가 중앙 descriptor에 잡히지 않았다");
assert.equal(
  uiInteractionDescriptor(desktop, state, { ...idleDrag(), hoverX: Number.NaN, hoverY: 10 }).cursor,
  "default",
  "유한하지 않은 좌표가 pointer cursor를 남겼다",
);

const gameoverHoverState = newRun(181818);
gameoverHoverState.phase = "gameover";
const challengeRect = gameoverGeometry(desktop, gameoverHoverState).choices.challenge;
const gameoverHover = uiInteractionDescriptor(desktop, gameoverHoverState, withHover(challengeRect));
assert.equal(gameoverHover.cursor, "pointer", "패배 선택 hover cursor가 pointer가 아니다");
assert.equal(gameoverHover.gameoverChoice, "challenge", "패배 선택 hover 대상이 어긋났다");

const descriptorAction = (interaction, fixtureState) => {
  if (interaction.mute) return { kind: "mute" };
  if (interaction.gameoverChoice) return { kind: "run-choice", choice: interaction.gameoverChoice };
  if (interaction.raidContractIndex >= 0) return { kind: "raid-contract", index: interaction.raidContractIndex };
  if (interaction.primary) return fixtureState.phase === "battle" ? null : { kind: "primary" };
  if (interaction.mapNodeIndex >= 0) return { kind: "map-node", index: interaction.mapNodeIndex };
  if (interaction.reroll) return { kind: "reroll" };
  if (interaction.offerIndex >= 0) return { kind: "offer", index: interaction.offerIndex };
  return { kind: "none" };
};

const parityRaidState = newRun(192001);
const parityRaidRect = raidContractRects(desktop, parityRaidState.raidOffers.length)[0];
assert.ok(parityRaidRect, "parity 계약 카드가 없다");
const parityMapState = newRun(192002);
assert.equal(chooseRaidContract(parityMapState, 0), true, "parity 지도 상태를 열지 못했다");
const parityMapNode = openMapNodeRects(desktop, parityMapState)[0];
assert.ok(parityMapNode, "parity 지도 노드가 없다");
const parityFixtures = [
  { name: "raid contract", fixtureState: parityRaidState, point: center(parityRaidRect), locked: false },
  { name: "map node", fixtureState: parityMapState, point: center(parityMapNode.rect), locked: false },
  { name: "reward offer", fixtureState: state, point: center(offerRects(desktop)[visibleOfferIndex]), locked: false },
  { name: "reward reroll", fixtureState: state, point: center(rerollRect(desktop)), locked: false },
  { name: "gameover choice", fixtureState: gameoverHoverState, point: center(challengeRect), locked: false },
  { name: "phase-locked raid contract", fixtureState: parityRaidState, point: center(parityRaidRect), locked: true },
  { name: "phase-locked map node", fixtureState: parityMapState, point: center(parityMapNode.rect), locked: true },
  { name: "phase-locked primary", fixtureState: state, point: center(desktop.button), locked: true },
  { name: "phase-locked mute", fixtureState: state, point: center(desktop.mute), locked: true },
];
for (const fixture of parityFixtures) {
  const hover = { ...idleDrag(), hoverX: fixture.point.x, hoverY: fixture.point.y };
  const descriptor = uiInteractionDescriptor(desktop, fixture.fixtureState, hover, fixture.locked);
  const dispatched = dispatchGameInput(ctx(fixture.fixtureState, desktop, idleDrag(), fixture.locked), {
    kind: "pointer-down",
    pointerId: 41,
    ...fixture.point,
  });
  assert.deepEqual(actionOf(dispatched), descriptorAction(descriptor, fixture.fixtureState), `${fixture.name} descriptor↔dispatch 불일치`);
}

// 버튼의 pulse는 쿨다운 동안 꺼져도 입력은 큐에 남아야 한다. 포인터와 Space가
// 같은 intent를 만들고 battle.ts가 잠금 해제 때까지 버리지 않는 기존 계약이다.
const queuedBattle = newRun(192003);
seedTestCat(queuedBattle);
queuedBattle.phase = "battle";
queuedBattle.dodgeCharges = 2;
queuedBattle.actCooldown = 500;
const threatenedAlly = queuedBattle.ally.find(Boolean);
assert.ok(threatenedAlly, "예약 입력 회귀용 아군이 없다");
const telegraphEnemy = makeCat(breedById(1), "enemy", 0);
telegraphEnemy.telegraph = {
  shape: "circle",
  mode: "avoid",
  fx: threatenedAlly.fx,
  fy: threatenedAlly.fy,
  dirX: 0,
  dirY: 0,
  arg: 0.75,
  reach: 0,
  fuse: 1200,
  fuseMax: 1200,
};
queuedBattle.enemy[0] = telegraphEnemy;
const battlePoint = center(desktop.button);
const battlePointer = dispatchGameInput(ctx(queuedBattle, desktop), {
  kind: "pointer-down",
  pointerId: 43,
  ...battlePoint,
});
const battleKey = dispatchGameInput(ctx(queuedBattle, desktop), { kind: "key-down", code: "Space" });
assert.deepEqual(actionOf(battlePointer), actionOf(battleKey), "쿨다운 중 포인터와 Space 예약 intent가 달라졌다");
assert.deepEqual(actionOf(battlePointer), { kind: "intent", intent: "act", dual: false });
const battleHover = uiInteractionDescriptor(desktop, queuedBattle, {
  ...idleDrag(),
  hoverX: battlePoint.x,
  hoverY: battlePoint.y,
});
assert.equal(battleHover.primary, true, "쿨다운 중 큐에 넣을 수 있는 포인터 입력이 차단됐다");
queueIntervention(queuedBattle, { kind: battlePointer.action.intent, dual: battlePointer.action.dual });
assert.equal(queuedBattle.pending.length, 1, "포인터 예약 intent가 pending에 들어가지 않았다");
stepBattle(queuedBattle, 16);
assert.equal(queuedBattle.pending.length, 1, "쿨다운 중 pending intent가 일찍 버려졌다");
queuedBattle.actCooldown = 0;
stepBattle(queuedBattle, 16);
assert.equal(queuedBattle.pending.length, 0, "쿨다운 해제 뒤 pending intent가 소비되지 않았다");

for (const relicDraftActive of [false, true]) {
  const disabledState = newRun(191919 + Number(relicDraftActive));
  disabledState.phase = "reward";
  disabledState.gold = 0;
  disabledState.freeRerolls = 0;
  disabledState.relicDraftActive = relicDraftActive;
  const point = center(rerollRect(desktop));
  const descriptor = uiInteractionDescriptor(desktop, disabledState, { ...idleDrag(), hoverX: point.x, hoverY: point.y });
  const dispatched = dispatchGameInput(ctx(disabledState, desktop), { kind: "pointer-down", pointerId: 42, ...point });
  const keyboard = dispatchGameInput(ctx(disabledState, desktop), { kind: "key-down", code: "KeyR" });
  assert.equal(descriptor.consumesPointer, true, "재추첨 실패 영역이 아래 입력을 삼키지 않았다");
  assert.equal(descriptor.reroll, true, "재추첨 실패가 descriptor의 피드백 경계에 들어오지 않았다");
  assert.equal(descriptor.cursor, "pointer", "실패 이유를 알려 주는 재추첨이 클릭 불가로 보인다");
  assert.deepEqual(actionOf(dispatched), { kind: "reroll" }, "재추첨 실패가 실제 action 경계를 지나지 않았다");
  assert.deepEqual(actionOf(dispatched), actionOf(keyboard), "재추첨 실패의 pointer/R 명령이 달라졌다");
}

// 빈 슬롯은 아래 보드로 새지 않는다.
state.offers[0] = null;
const emptySlot = offerRects(desktop)[0];
assert.ok(emptySlot, "첫 카드 슬롯 기하가 있어야 한다");
const emptyOutcome = pointerDown(state, desktop, emptySlot);
assert.deepEqual(actionOf(emptyOutcome), { kind: "none" });
assert.equal(emptyOutcome.drag.active, false, "빈 카드 슬롯이 드래그를 시작했다");

// 접힌 구성의 카드 사이/패널 틈이 실제 고양이 위에 있어도 드래그로 통과하지 않는다.
const folded = computeLayout(667, 275, true);
assert.equal(folded.columns, false, "접힌 구성 픽스처가 세로줄로 계산됐다");
const foldedCards = offerRects(folded);
const foldedReroll = rerollRect(folded);
let coveredGap = null;
for (let cell = 0; cell < state.ally.length && !coveredGap; cell++) {
  if (!state.ally[cell]) continue;
  const rect = cellRect(folded, "ally", cell);
  for (let yy = rect.y; yy <= rect.y + rect.h && !coveredGap; yy += Math.max(1, rect.h / 8)) {
    for (let xx = rect.x; xx <= rect.x + rect.w; xx += Math.max(1, rect.w / 8)) {
      const inPanel = rectHas(folded.offersPanel, xx, yy) || foldedCards.some((card) => rectHas(card, xx, yy));
      const inCard = foldedCards.some((card) => rectHas(card, xx, yy));
      if (inPanel && !inCard && !rectHas(foldedReroll, xx, yy) && hitCell(folded, "ally", xx, yy) === cell) {
        coveredGap = { x: xx, y: yy, cell };
        break;
      }
    }
  }
}
assert.ok(coveredGap, "접힌 카드 패널과 실제 고양이가 겹치는 gap 픽스처를 찾지 못했다");
const gapOutcome = dispatchGameInput(ctx(state, folded), { kind: "pointer-down", pointerId: 7, ...coveredGap });
const gapDescriptor = uiInteractionDescriptor(folded, state, {
  ...idleDrag(),
  hoverX: coveredGap.x,
  hoverY: coveredGap.y,
});
assert.equal(gapDescriptor.consumesPointer, true, "667×275 접힌 패널 gap이 descriptor에서 입력을 삼키지 않았다");
assert.equal(gapDescriptor.draggableCell, -1, "667×275 접힌 패널 gap이 descriptor에서 고양이를 잡았다");
assert.deepEqual(actionOf(gapOutcome), { kind: "none" });
assert.equal(gapOutcome.drag.active, false, "접힌 카드 gap이 뒤의 고양이를 집었다");

// 한 포인터가 잡은 드래그는 두 번째 포인터가 덮어쓰거나 끝낼 수 없다.
const occupied = state.ally.findIndex(Boolean);
const vacant = state.ally.findIndex((cat) => !cat);
assert.ok(occupied >= 0 && vacant >= 0, "드래그용 점유/빈 셀이 필요하다");
const fromRect = cellRect(desktop, "ally", occupied);
const toRect = cellRect(desktop, "ally", vacant);
const started = pointerDown(state, desktop, fromRect, idleDrag(), false, 11);
assert.equal(started.drag.active, true);
assert.equal(started.drag.pointerId, 11);
assert.equal(started.drag.fromCell, occupied);

const secondDown = pointerDown(state, desktop, toRect, started.drag, false, 12);
assert.deepEqual(secondDown.drag, started.drag, "두 번째 포인터가 드래그 소유권을 덮어썼다");
const secondMove = dispatchGameInput(ctx(state, desktop, secondDown.drag), {
  kind: "pointer-move",
  pointerId: 12,
  ...center(toRect),
});
assert.deepEqual(secondMove.drag, started.drag, "두 번째 포인터 이동이 소유 드래그를 움직였다");
const secondUp = dispatchGameInput(ctx(state, desktop, secondMove.drag), {
  kind: "pointer-up",
  pointerId: 12,
  ...center(toRect),
});
assert.equal(secondUp.drag.active, true, "두 번째 포인터가 소유 드래그를 끝냈다");
const secondCancel = dispatchGameInput(ctx(state, desktop, secondUp.drag), {
  kind: "pointer-cancel",
  pointerId: 12,
});
assert.equal(secondCancel.drag.active, true, "두 번째 포인터 cancel이 소유 드래그를 끝냈다");
const secondLostCapture = dispatchGameInput(ctx(state, desktop, secondCancel.drag), {
  kind: "lost-pointer-capture",
  pointerId: 12,
});
assert.equal(secondLostCapture.drag.active, true, "두 번째 포인터 capture 손실이 소유 드래그를 끝냈다");

const dropped = dispatchGameInput(ctx(state, desktop, secondLostCapture.drag), {
  kind: "pointer-up",
  pointerId: 11,
  ...center(toRect),
});
assert.deepEqual(actionOf(dropped), { kind: "move-cat", from: occupied, to: vacant });
assert.equal(dropped.drag.active, false, "정상 drop 뒤 드래그가 남았다");
executeRunAction(state, dropped.action);
assert.ok(state.ally[vacant], "실제 고양이가 drop 대상 셀로 이동하지 않았다");

// resize는 기존 포인터 소유권을 폐기한다. 다음 hit-test는 호출자가 넘긴 최신 layout만 쓴다.
state.phase = "prepare";
const oldLayout = computeLayout(1280, 800, false);
const newLayout = computeLayout(800, 1280, false);
const movedCell = vacant;
const resizeStart = pointerDown(state, oldLayout, cellRect(oldLayout, "ally", movedCell), idleDrag(), false, 21);
assert.equal(resizeStart.drag.active, true);
const resized = dispatchGameInput(ctx(state, newLayout, resizeStart.drag), { kind: "resize" });
assert.equal(resized.drag.active, false, "resize가 옛 레이아웃 드래그를 취소하지 않았다");
const newHit = pointerDown(state, newLayout, cellRect(newLayout, "ally", movedCell), resized.drag, false, 22);
assert.equal(newHit.drag.fromCell, movedCell, "resize 뒤 최신 layout의 셀을 잡지 못했다");

// phase lock은 모든 게임 입력을 막지만 음소거는 pointer/keyboard 모두 우선한다.
const lockedButton = pointerDown(state, desktop, desktop.button, idleDrag(), true);
assert.deepEqual(actionOf(lockedButton), { kind: "none" });
const lockedKey = dispatchGameInput(ctx(state, desktop, idleDrag(), true), { kind: "key-down", code: "Enter" });
assert.deepEqual(actionOf(lockedKey), { kind: "none" });
const mutedPointer = pointerDown(state, desktop, desktop.mute, idleDrag(), true);
const mutedKey = dispatchGameInput(ctx(state, desktop, idleDrag(), true), { kind: "key-down", code: "KeyM" });
assert.deepEqual(actionOf(mutedPointer), { kind: "mute" });
assert.deepEqual(actionOf(mutedPointer), actionOf(mutedKey), "잠금 중 mute의 pointer/keyboard 명령이 달라졌다");

// 의미 DOM도 좌표 입력과 같은 dispatcher를 지나며 stale phase와 phase lock을 우회하지 않는다.
const directState = newRun(707070);
seedTestCat(directState);
const directRaid = identifyGameInputAction(directState, { kind: "raid-contract", index: 1 });
assert.equal(gameInputActionAvailable(directState, directRaid), true, "현재 계약 DOM action이 유효하지 않다");
assert.equal(
  gameInputActionAvailable(directState, { kind: "raid-contract", index: 1 }),
  false,
  "identity 없는 계약 DOM action이 허용됐다",
);
assert.deepEqual(
  actionOf(dispatchGameInput(ctx(directState, desktop), { kind: "direct-action", action: directRaid })),
  directRaid,
  "계약 DOM action이 공용 dispatcher에서 바뀌었다",
);
assert.deepEqual(
  actionOf(dispatchGameInput(ctx(directState, desktop, idleDrag(), true), { kind: "direct-action", action: directRaid })),
  { kind: "none" },
  "잠긴 단계에서 계약 DOM action이 통과했다",
);
const staleRaidState = Array.from({ length: 16 }, (_, offset) => newRun(707071 + offset))
  .find((candidate) => candidate.raidOffers[1]?.id !== directState.raidOffers[1]?.id);
assert.ok(staleRaidState, "stale 계약 identity를 재현할 다른 런을 만들지 못했다");
assert.equal(gameInputActionAvailable(staleRaidState, directRaid), false, "바뀐 계약에 이전 DOM action이 남았다");
assert.deepEqual(
  actionOf(dispatchGameInput(ctx(staleRaidState, desktop), { kind: "direct-action", action: directRaid })),
  { kind: "none" },
  "stale 계약 DOM action이 다른 계약을 선택할 수 있다",
);
assert.deepEqual(
  actionOf(dispatchGameInput(ctx(directState, desktop, idleDrag(), true), {
    kind: "direct-action",
    action: { kind: "mute" },
  })),
  { kind: "mute" },
  "DOM 음소거가 phase lock 예외를 잃었다",
);

chooseRaidContract(directState, 0);
const directLane = openLanes(directState.map, mapStep(directState))[0];
assert.notEqual(directLane, undefined, "DOM 지도 action 픽스처의 열린 길이 없다");
const directMap = identifyGameInputAction(directState, { kind: "map-node", index: directLane });
assert.deepEqual(
  actionOf(dispatchGameInput(ctx(directState, desktop), { kind: "direct-action", action: directMap })),
  directMap,
  "열린 지도 DOM action이 공용 dispatcher를 통과하지 못했다",
);
const staleMapState = Array.from({ length: 16 }, (_, offset) => {
  const candidate = newRun(808081 + offset);
  chooseRaidContract(candidate, 0);
  return candidate;
}).find((candidate) => !gameInputActionAvailable(candidate, directMap));
assert.ok(staleMapState, "stale 지도 identity를 재현할 다른 런을 만들지 못했다");
assert.deepEqual(
  actionOf(dispatchGameInput(ctx(staleMapState, desktop), { kind: "direct-action", action: directMap })),
  { kind: "none" },
  "stale 지도 DOM action이 새 런의 같은 index로 바뀌었다",
);
assert.equal(chooseNode(directState, directLane), true, "DOM 지도 action 픽스처가 reward로 전이하지 못했다");
assert.equal(directState.phase, "reward");
assert.equal(gameInputActionAvailable(directState, directMap), false, "지난 지도 DOM action이 reward까지 살아남았다");
assert.deepEqual(
  actionOf(dispatchGameInput(ctx(directState, desktop), { kind: "direct-action", action: directMap })),
  { kind: "none" },
  "stale 지도 DOM action이 phase를 우회했다",
);
const directOfferIndex = directState.offers.findIndex(Boolean);
assert.ok(directOfferIndex >= 0, "DOM 구매 action 픽스처의 카드가 없다");
const directOffer = identifyGameInputAction(directState, { kind: "offer", index: directOfferIndex });
assert.deepEqual(
  actionOf(dispatchGameInput(ctx(directState, desktop), { kind: "direct-action", action: directOffer })),
  directOffer,
  "구매 DOM action이 공용 dispatcher를 통과하지 못했다",
);
const replacedOffer = directState.offers[directOfferIndex];
assert.ok(replacedOffer, "stale 구매 action 픽스처가 비었습니다");
directState.offers[directOfferIndex] = { ...replacedOffer, cost: replacedOffer.cost + 1 };
assert.equal(gameInputActionAvailable(directState, directOffer), false, "재추첨된 카드에 이전 DOM action이 남았다");
assert.deepEqual(
  actionOf(dispatchGameInput(ctx(directState, desktop), { kind: "direct-action", action: directOffer })),
  { kind: "none" },
  "stale 구매 DOM action이 다른 카드 구매로 바뀌었다",
);
assert.equal(
  gameInputActionAvailable(directState, { kind: "offer", index: 99 }),
  false,
  "범위 밖 구매 DOM action이 유효하다고 판정됐다",
);
const directFrom = directState.ally.findIndex(Boolean);
const directTo = directState.ally.findIndex((cat) => !cat);
assert.ok(directFrom >= 0 && directTo >= 0, "DOM 배치 action 픽스처의 출발·도착 셀이 없다");
assert.equal(
  gameInputActionAvailable(directState, { kind: "move-cat", from: directFrom, to: directTo }),
  true,
  "유효한 DOM 배치 action이 거절됐다",
);
assert.equal(
  gameInputActionAvailable(directState, { kind: "move-cat", from: directTo, to: directFrom }),
  false,
  "빈 셀에서 시작한 DOM 배치 action이 통과했다",
);

const directPrimaryState = newRun(717171);
directPrimaryState.phase = "reward";
directPrimaryState.relicDraftActive = true;
const relicPrimary = identifyGameInputAction(directPrimaryState, { kind: "primary" });
assert.equal(gameInputActionAvailable(directPrimaryState, relicPrimary), true, "현재 유물 건너뛰기 DOM action이 거절됐다");
directPrimaryState.relicDraftActive = false;
assert.equal(gameInputActionAvailable(directPrimaryState, relicPrimary), false, "지난 유물 건너뛰기가 상점 primary로 바뀌었다");
assert.deepEqual(
  actionOf(dispatchGameInput(ctx(directPrimaryState, desktop), { kind: "direct-action", action: relicPrimary })),
  { kind: "none" },
  "stale 유물 건너뛰기 DOM action이 상점을 건너뛰었다",
);
const rerollAction = identifyGameInputAction(directPrimaryState, { kind: "reroll" });
assert.equal(gameInputActionAvailable(directPrimaryState, rerollAction), true, "현재 재추첨 DOM action이 거절됐다");
directPrimaryState.gold += 1;
assert.equal(gameInputActionAvailable(directPrimaryState, rerollAction), false, "자원·카드가 바뀐 뒤 이전 재추첨 action이 남았다");

// production 실행기는 dispatcher의 모든 action을 정확한 effect 포트에 한 번씩 보낸다.
assert.equal(executeRunAction(state, { kind: "mute" }).called, "mute");
assert.equal(executeRunAction(state, { kind: "primary" }).called, "primary");
assert.deepEqual(executeRunAction(state, { kind: "intent", intent: "gather", dual: true }).intent, {
  kind: "gather",
  dual: true,
});
assert.equal(executeRunAction(state, { kind: "offer", index: 2 }).offer, 2);

// 일반 전투의 Space/G repeat는 늦은 예고를 놓치지 않게 유지한다. 취약 창의
// 결정타만은 한 번 길게 누른 입력이 두 차지를 모두 쓰지 않도록 별도로 막는다.
const battleState = newRun(222222);
seedTestCat(battleState);
battleState.phase = "battle";
battleState.dodgeCharges = 2;
const battleStarter = battleState.ally.find((cat) => cat !== null);
assert.ok(battleStarter, "반복 회피 입력 픽스처의 고양이가 없다");
battleState.enemy.fill(null);
battleState.enemy[0] = {
  ...battleStarter,
  side: "enemy",
  alive: true,
  radius: 1,
  vulnerableMs: 0,
  vulnerableCharges: 0,
  finalPhase: null,
  blink: null,
  telegraph: {
    shape: "circle",
    mode: "avoid",
    fx: battleStarter.fx,
    fy: battleStarter.fy,
    dirX: 0,
    dirY: 0,
    arg: 1,
    reach: 0,
    fuse: 1000,
    fuseMax: 1000,
  },
  telegraph2: null,
};
const repeatedSpace = dispatchGameInput(ctx(battleState, desktop), { kind: "key-down", code: "Space", repeat: true });
const repeatedGather = dispatchGameInput(ctx(battleState, desktop), { kind: "key-down", code: "KeyG", repeat: true });
assert.equal(repeatedSpace.action.kind, "intent", "반복 Space가 전투 의도에 연결되지 않았다");
assert.equal(repeatedGather.action.kind, "intent", "반복 G가 전투 의도에 연결되지 않았다");

const vulnerableState = newRun(232323);
seedTestCat(vulnerableState);
vulnerableState.phase = "battle";
vulnerableState.dodgeCharges = 2;
const starter = vulnerableState.ally.find((cat) => cat !== null);
assert.ok(starter, "취약 창 입력 픽스처의 고양이가 없다");
const vulnerableBoss = {
  ...starter,
  side: "enemy",
  alive: true,
  radius: 1,
  vulnerableMs: 1000,
  vulnerableCharges: 2,
  finalPhase: null,
  blink: null,
  telegraph: null,
  telegraph2: null,
};
vulnerableState.enemy.fill(null);
vulnerableState.enemy[0] = vulnerableBoss;
const firstStrikeKey = dispatchGameInput(ctx(vulnerableState, desktop), {
  kind: "key-down",
  code: "Space",
  repeat: false,
});
const heldStrikeKey = dispatchGameInput(ctx(vulnerableState, desktop), {
  kind: "key-down",
  code: "Space",
  repeat: true,
});
const heldStrikeGatherKey = dispatchGameInput(ctx(vulnerableState, desktop), {
  kind: "key-down",
  code: "KeyG",
  repeat: true,
});
assert.equal(firstStrikeKey.action.kind, "intent", "최초 Space가 결정타 의도로 연결되지 않았다");
assert.deepEqual(heldStrikeKey.action, { kind: "none" }, "취약 창 반복 Space가 두 번째 결정타로 통과했다");
assert.deepEqual(heldStrikeGatherKey.action, { kind: "none" }, "취약 창 반복 G가 두 번째 결정타로 통과했다");

vulnerableBoss.telegraph = {
  shape: "circle",
  mode: "avoid",
  fx: vulnerableBoss.fx,
  fy: vulnerableBoss.fy,
  dirX: 0,
  dirY: 0,
  arg: 1,
  reach: 0,
  fuse: 1000,
  fuseMax: 1000,
};
const heldDodgeKey = dispatchGameInput(ctx(vulnerableState, desktop), {
  kind: "key-down",
  code: "Space",
  repeat: true,
});
assert.equal(heldDodgeKey.action.kind, "intent", "예고 중 반복 Space가 회피 의도로 연결되지 않았다");
const repeatedReroll = dispatchGameInput(ctx(state, desktop), { kind: "key-down", code: "KeyR", repeat: true });
assert.deepEqual(repeatedReroll.action, { kind: "none" }, "반복 R이 재추첨으로 통과했다");
assert.equal(repeatedReroll.unlockAudio, false, "무시한 반복키가 오디오 잠금을 풀었다");

console.log(
  "입력 라우팅 PASS — pointer/keyboard 동등, stale DOM identity·빈 슬롯·접힘 gap 차단, 다중 포인터·drop·resize·phase lock/mute",
);
