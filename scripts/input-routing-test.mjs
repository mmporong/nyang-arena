import assert from "node:assert/strict";

import { computeLayout, cellRect, hitCell, rectHas } from "../src/game/layout.ts";
import { dispatchGameInput, executeGameInputAction } from "../src/game/input.ts";
import { openLanes } from "../src/game/map.ts";
import {
  gameoverGeometry,
  openMapNodeRects,
  offerRects,
  raidContractRects,
  rerollRect,
} from "../src/game/render.ts";
import {
  chooseNode,
  chooseRaidContract,
  mapStep,
  moveCat,
  newRun,
  nextRunFrom,
  rerollOffers,
} from "../src/game/run.ts";

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

// production 실행기는 dispatcher의 모든 action을 정확한 effect 포트에 한 번씩 보낸다.
assert.equal(executeRunAction(state, { kind: "mute" }).called, "mute");
assert.equal(executeRunAction(state, { kind: "primary" }).called, "primary");
assert.deepEqual(executeRunAction(state, { kind: "intent", intent: "gather", dual: true }).intent, {
  kind: "gather",
  dual: true,
});
assert.equal(executeRunAction(state, { kind: "offer", index: 2 }).offer, 2);

// Space/G는 취약 창 연타를 위해 repeat를 허용하고, 나머지 반복키는 입력 전에 버린다.
const battleState = newRun(222222);
battleState.phase = "battle";
const repeatedSpace = dispatchGameInput(ctx(battleState, desktop), { kind: "key-down", code: "Space", repeat: true });
const repeatedGather = dispatchGameInput(ctx(battleState, desktop), { kind: "key-down", code: "KeyG", repeat: true });
assert.equal(repeatedSpace.action.kind, "intent", "반복 Space가 전투 의도에 연결되지 않았다");
assert.equal(repeatedGather.action.kind, "intent", "반복 G가 전투 의도에 연결되지 않았다");
const repeatedReroll = dispatchGameInput(ctx(state, desktop), { kind: "key-down", code: "KeyR", repeat: true });
assert.deepEqual(repeatedReroll.action, { kind: "none" }, "반복 R이 재추첨으로 통과했다");
assert.equal(repeatedReroll.unlockAudio, false, "무시한 반복키가 오디오 잠금을 풀었다");

console.log(
  "입력 라우팅 PASS — 계약·지도·재추첨·다음 런 pointer/keyboard 동등, 빈 슬롯·접힘 gap 차단, 다중 포인터·drop·resize·phase lock/mute",
);
