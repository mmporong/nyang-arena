import assert from "node:assert/strict";

import {
  AnnouncementDeduper,
  activateBoardCell,
  boardCellPositionLabel,
  cancelBoardPickup,
  createAccessibilityBoard,
  deriveAccessibilityModel,
  deriveBattleAlert,
  derivePoliteAnnouncement,
  moveBoardFocus,
} from "../src/game/accessibility.ts";
import { sweepZones } from "../src/game/battle.ts";
import { BREEDS } from "../src/game/breeds.ts";
import { BOSS_BREEDS } from "../src/game/bosses.ts";
import { openLanes } from "../src/game/map.ts";
import { makeCat, newRun, rollOffers } from "../src/game/run.ts";

const stateFor = (phase) => {
  const state = newRun(424242);
  state.phase = phase;
  state.raidOffers = [];
  return state;
};

const actionKinds = (model) => model.controls.map((entry) => entry.action.kind);
const keys = (model) => model.controls.map((entry) => entry.key);

{
  const state = newRun(424242);
  assert.equal(state.phase, "map");
  assert.equal(state.raidOffers.length, 3);
  const first = deriveAccessibilityModel(state, false);
  const second = deriveAccessibilityModel(state, false);
  assert.deepEqual(first, second, "동일 상태의 접근성 모델은 안정적이어야 합니다");
  assert.equal(first.phaseKey, "map:contracts");
  assert.deepEqual(actionKinds(first), ["raid-contract", "raid-contract", "raid-contract", "mute"]);
  assert.equal(first.controls.slice(0, 3).every((entry) => typeof entry.action.identity === "string"), true);
  assert.deepEqual(first.controls.slice(0, 3).map((entry) => entry.shortcut), ["1", "2", "3"]);
  assert.match(first.canvasLabel, /악몽 계약/);
}

{
  const state = stateFor("map");
  const lanes = openLanes(state.map, state.step);
  const model = deriveAccessibilityModel(state, true);
  assert.equal(model.phaseKey, "map:routes");
  assert.deepEqual(model.controls.slice(0, -1).map((entry) => entry.action.index), lanes);
  assert.equal(model.controls.slice(0, -1).every((entry) => typeof entry.action.identity === "string"), true);
  assert.equal(model.controls.at(-1).key, "global:mute");
  assert.equal(model.controls.at(-1).pressed, true);
}

{
  const state = stateFor("reward");
  state.gold = 99;
  rollOffers(state);
  const model = deriveAccessibilityModel(state, false);
  assert.equal(model.phaseKey, "reward:store");
  assert.deepEqual(actionKinds(model), ["reroll", "offer", "offer", "offer", "primary", "mute"]);
  assert.deepEqual(model.controls.slice(1, 4).map((entry) => entry.action.index), [0, 1, 2]);
  assert.equal(model.controls.slice(0, -1).every((entry) => typeof entry.action.identity === "string"), true);
  assert.equal(model.board.cells.length, 25);
  assert.equal(model.board.cells.filter((cell) => cell.tabIndex === 0).length, 1);
}

{
  const state = stateFor("prepare");
  const model = deriveAccessibilityModel(state, false, { boardFocusIndex: 7 });
  assert.deepEqual(keys(model), ["prepare:primary", "global:mute"]);
  assert.equal(typeof model.controls[0].action.identity, "string");
  assert.equal(model.board.focusIndex, 7);
  assert.equal(model.board.cells[7].tabIndex, 0);
}

{
  const state = stateFor("battle");
  state.dodgeCharges = 2;
  const single = deriveAccessibilityModel(state, false);
  assert.deepEqual(keys(single), ["battle:act", "global:mute"]);
  assert.equal(single.controls[0].action.kind, "intent");
  assert.equal(single.controls[0].action.intent, "act");
  assert.equal(single.controls[0].action.dual, false);
  assert.equal(typeof single.controls[0].action.identity, "string");

  const boss = makeCat(BOSS_BREEDS[0], "enemy", 0);
  boss.radius = 1;
  boss.telegraph = {
    shape: "half", mode: "avoid", fx: 2.5, fy: 2.5, dirX: -1, dirY: 0,
    arg: 0, reach: 0, fuse: 1200, fuseMax: 1200,
  };
  boss.telegraph2 = {
    shape: "half", mode: "gather", fx: 2.5, fy: 2.5, dirX: 1, dirY: 0,
    arg: 0, reach: 0, fuse: 1200, fuseMax: 1200,
  };
  state.enemy[0] = boss;
  const dual = deriveAccessibilityModel(state, false);
  assert.equal(dual.phaseKey, "battle:polarity");
  assert.deepEqual(keys(dual), ["battle:dodge", "battle:gather", "global:mute"]);
  assert.deepEqual(dual.controls.slice(0, 2).map((entry) => entry.action.intent), ["dodge", "gather"]);
  boss.vulnerableMs = 900;
  boss.vulnerableCharges = 2;
  const overlap = deriveAccessibilityModel(state, false);
  assert.match(overlap.controls[0].label, /방어 개입 2회/);
  assert.doesNotMatch(overlap.controls[0].label, /결정타/);
  boss.telegraph = null;
  boss.telegraph2 = null;
  const strike = deriveAccessibilityModel(state, false);
  assert.match(strike.controls[0].label, /결정타, 결정타 2회/);
}

{
  const state = stateFor("gameover");
  const model = deriveAccessibilityModel(state, false);
  assert.deepEqual(keys(model), [
    "gameover:again",
    "gameover:retry",
    "gameover:daily",
    "gameover:challenge",
    "global:mute",
  ]);
  assert.deepEqual(model.controls.slice(0, 4).map((entry) => entry.action.kind), ["primary", "run-choice", "run-choice", "run-choice"]);
  assert.equal(model.controls.slice(0, 4).every((entry) => typeof entry.action.identity === "string"), true);
}

{
  const state = stateFor("reward");
  state.ally[6] = makeCat(BREEDS[0], "ally", 6, 3);
  const board = createAccessibilityBoard(state, 6, 6, false);
  assert.equal(board.cells.length, 25);
  assert.equal(board.cells.filter((cell) => cell.tabIndex === 0).length, 1);
  assert.match(board.cells[6].label, /2행 2열/);
  assert.match(board.cells[6].label, new RegExp(BREEDS[0].name));
  assert.match(board.cells[6].label, /레벨 3/);
  assert.match(board.cells[0].label, /빈 칸/);
  assert.equal(board.cells[6].selected, true);

  assert.equal(moveBoardFocus(0, "up"), 0);
  assert.equal(moveBoardFocus(0, "left"), 0);
  assert.equal(moveBoardFocus(0, "right"), 1);
  assert.equal(moveBoardFocus(0, "down"), 5);
  assert.equal(moveBoardFocus(24, "right"), 24);
  assert.equal(moveBoardFocus(24, "down"), 24);

  // stacked에서는 화면 x=row, 화면 y=4-col이므로 시각 방향을 따라 전치된다.
  const stacked = createAccessibilityBoard(state, 6, null, true);
  assert.equal(stacked.stacked, true);
  assert.deepEqual(stacked.cells.slice(0, 5).map((cell) => cell.index), [4, 9, 14, 19, 24]);
  assert.match(stacked.cells.find((cell) => cell.index === 6).label, /4행 2열/);
  assert.equal(boardCellPositionLabel(6, true), "4행 2열");
  assert.equal(moveBoardFocus(6, "up", true), 7);
  assert.equal(moveBoardFocus(6, "down", true), 5);
  assert.equal(moveBoardFocus(6, "left", true), 1);
  assert.equal(moveBoardFocus(6, "right", true), 11);
  assert.equal(moveBoardFocus(4, "up", true), 4);
  assert.equal(moveBoardFocus(20, "right", true), 20);

  assert.deepEqual(activateBoardCell(state, 0, null), { pickedFrom: null, action: null });
  assert.deepEqual(activateBoardCell(state, 6, null), { pickedFrom: 6, action: null });
  assert.deepEqual(activateBoardCell(state, 12, 6), {
    pickedFrom: null,
    action: { kind: "move-cat", from: 6, to: 12 },
  });
  assert.deepEqual(activateBoardCell(state, 6, 6), { pickedFrom: null, action: null });
  assert.deepEqual(activateBoardCell(state, 99, 6), { pickedFrom: 6, action: null });
  assert.equal(cancelBoardPickup(), null);
}

{
  const state = stateFor("battle");
  const boss = makeCat(BOSS_BREEDS[0], "enemy", 0);
  boss.radius = 1;
  boss.thresholdIdx = 2;
  boss.telegraph = {
    shape: "circle", mode: "avoid", fx: 2, fy: 2, dirX: 0, dirY: 0,
    arg: 1.5, reach: 0, fuse: 1200, fuseMax: 1200,
  };
  state.enemy[0] = boss;

  const avoid = deriveBattleAlert(state);
  assert.match(avoid.text, /산개/);
  boss.telegraph.fuse = 300;
  const sameAvoid = deriveBattleAlert(state);
  assert.equal(sameAvoid.signature, avoid.signature, "fuse 감소는 예고 서명을 바꾸면 안 됩니다");

  boss.telegraph.mode = "gather";
  const gather = deriveBattleAlert(state);
  assert.match(gather.text, /집결/);
  assert.notEqual(gather.signature, avoid.signature);

  boss.telegraph2 = { ...boss.telegraph, shape: "half", mode: "avoid", dirX: -1 };
  boss.telegraph = { ...boss.telegraph, shape: "half", mode: "gather", dirX: 1 };
  const polarity = deriveBattleAlert(state);
  assert.match(polarity.text, /극성/);
  assert.notEqual(polarity.signature, gather.signature);

  boss.telegraph = null;
  boss.telegraph2 = null;
  sweepZones.push({
    shape: "line", mode: "avoid", fx: 0, fy: 1, dirX: 1, dirY: 0,
    arg: 0.4, reach: 5, fuse: 800, fuseMax: 800,
  });
  const sweep = deriveBattleAlert(state);
  assert.match(sweep.text, /산개/);
  sweepZones[0].fuse = 100;
  assert.equal(deriveBattleAlert(state).signature, sweep.signature, "sweep fuse 감소가 예고 서명을 바꿨습니다");
  sweepZones.length = 0;

  boss.vulnerableMs = 900;
  boss.vulnerableCharges = 2;
  const strike = deriveBattleAlert(state);
  assert.match(strike.text, /결정타/);
  boss.vulnerableMs = 100;
  assert.equal(deriveBattleAlert(state).signature, strike.signature, "취약 시간 감소는 서명을 바꾸면 안 됩니다");

  boss.vulnerableMs = 0;
  const ended = deriveBattleAlert(state, strike.activeIdentity);
  assert.equal(ended.ended, true);
  assert.match(ended.text, /끝났/);
  assert.notEqual(ended.signature, strike.signature);
  assert.equal(deriveBattleAlert(state, ended.signature), null, "종료 신호를 반복하면 안 됩니다");
}

{
  const state = stateFor("reward");
  state.gold = 99;
  rollOffers(state);
  const first = derivePoliteAnnouncement(state);
  const idle = derivePoliteAnnouncement(state);
  assert.equal(idle.signature, first.signature, "idle 상태는 polite 서명을 바꾸면 안 됩니다");

  const deduper = new AnnouncementDeduper();
  assert.equal(deduper.next(first), first.text);
  assert.equal(deduper.next(idle), null);

  state.gold -= state.offers[0].cost;
  state.offers[0] = null;
  state.notice = "구매 완료";
  const purchase = derivePoliteAnnouncement(state);
  assert.notEqual(purchase.signature, first.signature);
  assert.equal(deduper.next(purchase), "구매 완료");

  state.notice = "";
  state.offers.reverse();
  const reroll = derivePoliteAnnouncement(state);
  assert.notEqual(reroll.signature, purchase.signature);

  const map = stateFor("map");
  const beforeMap = derivePoliteAnnouncement(map);
  map.map.taken[0] = 1;
  map.step = 1;
  map.notice = "정찰 길을 골랐습니다";
  const afterMap = derivePoliteAnnouncement(map);
  assert.notEqual(afterMap.signature, beforeMap.signature);

  const gameover = stateFor("gameover");
  const loss = derivePoliteAnnouncement(gameover);
  gameover.lossReason = "timeout";
  gameover.notice = "시간이 다 됐어요";
  assert.notEqual(derivePoliteAnnouncement(gameover).signature, loss.signature);
}

console.log("accessibility-test: all phase controls/grid/live announcement contracts PASS");
