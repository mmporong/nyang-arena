/**
 * 레이아웃 겹침 검사 — 보상 카드 패널이 아군 보드를 덮지 않는지 기기별로 확인한다.
 *
 * 예전에 오퍼 영역이 보드 영역에서 자리를 떼지 않아, 세로 화면에서 아랫줄 셀
 * 3개가 통째로 가려지고 탭까지 카드가 가로챘다. 작은 가로 화면에서는 보드
 * 전체가 사라졌다. layout.ts를 만졌으면 이걸 다시 돌려라.
 *
 * 실행: npm run probe
 */
import { cellRect, computeLayout } from "../src/game/layout.ts";
import { BOARD_SIZE } from "../src/game/types.ts";

const DEVICES = [
  ["iPhone SE 세로", 375, 553],
  ["iPhone SE 가로", 667, 275],
  ["iPhone 14 세로", 390, 750],
  ["iPhone 14 가로", 844, 320],
  ["Galaxy S20 세로", 360, 680],
  ["iPad 세로", 768, 1024],
  ["데스크톱", 1440, 800],
  ["데스크톱 와이드", 1920, 1080],
  ["극단 세로", 320, 900],
  ["극단 가로", 1200, 300],
];

function overlapArea(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

let failed = 0;
console.log("기기               보드셀 최대겹침  최소셀  버튼높이  보상단계   판정");
for (const [name, w, h] of DEVICES) {
  const L = computeLayout(w, h);
  const panel = L.offersPanel;

  let worst = 0;
  for (const board of [L.allyBoard, L.enemyBoard]) {
    for (let i = 0; i < BOARD_SIZE; i++) {
      const cr = cellRect(board, L.cell, L.gap, i);
      worst = Math.max(worst, overlapArea(cr, panel) / (cr.w * cr.h));
    }
  }

  // roomy=false는 보상 단계를 모달로 쓰는 좁은 화면이다. 이때 겹침은 의도된 것이고,
  // 대신 canRearrange가 prepare에서만 참이라 보드 입력이 새지 않는다.
  const ok = (L.roomy ? worst < 0.01 : true) && L.cell >= 28 && L.button.h >= 40;
  if (!ok) failed++;
  console.log(
    `${name.padEnd(18)} ${(worst * 100).toFixed(1).padStart(8)}%  ` +
      `${String(Math.round(L.cell)).padStart(5)}  ${String(Math.round(L.button.h)).padStart(7)}  ` +
      `${(L.roomy ? "보드 노출" : "모달").padEnd(9)}` +
      (ok ? "OK" : "실패"),
  );
}

if (failed > 0) {
  console.log(`\n${failed}개 기기에서 실패 — 보드 노출 화면에서 카드가 보드를 덮거나 셀이 너무 작다`);
  process.exit(1);
}
console.log("\n전부 통과 — 보드가 노출되는 화면에서는 카드가 보드를 덮지 않는다");
