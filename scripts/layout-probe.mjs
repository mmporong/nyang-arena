/**
 * 레이아웃 겹침 검사 — 기기별로 카드가 가려서는 안 될 것을 가리지 않는지 확인한다.
 *
 * 두 가지를 본다.
 *
 * 1) 준비 단계의 팀 요약 띠(offersPanel)가 아군 보드를 덮지 않을 것.
 *    예전에 이 자리를 보드 예산에서 떼지 않아 세로 화면에서 아랫줄 셀 3개가
 *    통째로 가려지고 탭까지 가로챘다.
 *
 * 2) 보상 단계의 카드(offerCards)와 그 머리줄이 HUD·안내 문구를 덮지 않을 것.
 *    카드는 보드를 덮어도 된다 — 보상 단계에는 보드를 만질 수 없다(canRearrange).
 *    하지만 생선 수와 안내 문구까지 가리면 무엇을 살 수 있는지 모르고 사게 된다.
 *
 * 3) 카드 설명 줄바꿈(wrapLines)이 줄 수를 지키고 폭을 넘지 않을 것.
 *    폭이 0이나 음수여도 무한 루프에 빠지면 안 된다.
 *
 * layout.ts, rerollRect, wrapLines를 만졌으면 이걸 다시 돌려라.
 *
 * 실행: npm run probe
 */
import { cellRect, computeLayout, fieldToScreen } from "../src/game/layout.ts";
import { wrapLines } from "../src/game/theme.ts";
import { rerollRect, healthBarGeom } from "../src/game/render.ts";
import { BOARD_SIZE, BOARD_COLS, cellToField } from "../src/game/types.ts";
import { BOSS_RADIUS, SNIPER_RADIUS } from "../src/game/bosses.ts";

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
console.log("기기               보드셀겹침  카드    머리줄여백  최소셀  버튼  전투셀  음소거  구성    판정");
for (const [name, w, h] of DEVICES) {
  const L = computeLayout(w, h);
  /**
   * 전투 국면은 아래 띠가 접혀 판이 커진다. 상점 모드만 재면 그 배치는 한 번도
   * 검사되지 않는다 — 기기 열 종에서 겹치는지 보는 게 이 스크립트의 일이므로
   * 두 모드를 다 봐야 한다.
   */
  const B = computeLayout(w, h, false);

  let worst = 0;
  for (const side of ["ally", "enemy"]) {
    for (let i = 0; i < BOARD_SIZE; i++) {
      const cr = cellRect(L, side, i);
      worst = Math.max(worst, overlapArea(cr, L.offersPanel) / (cr.w * cr.h));
    }
  }

  // 머리줄(다시 뽑기 버튼)의 위끝이 안내 문구 아래로 내려와 있어야 한다.
  const rr = rerollRect(L);
  const headroom = rr.y - (L.notice.y + L.notice.h);
  const cardsOnScreen = L.offerCards.x >= 0 && L.offerCards.x + L.offerCards.w <= w;
  // 카드가 세로로 섰는지 눕혔는지 — 눈으로 확인할 때 어느 분기인지 알아야 한다.
  const shape = L.offerCards.h >= L.offerCards.w / 3 ? "세로" : "가로";

  /**
   * 전투 배치에서 판이 정보 자리를 침범하면 안 된다.
   *
   * 어디를 보는지는 구성에 따라 다르다. 접힌 구성에서는 시너지 바가 판 **아래**
   * 띠이므로 판의 밑변을 보면 되지만, 세로줄 구성에서는 시너지가 왼쪽 줄에
   * 있어 그 검사가 늘 실패한다(판 밑변이 줄 시작보다 항상 아래다). 세로줄에서는
   * 판이 좌우 줄과 가로로 겹치는지를 본다.
   */
  const battleClear = L.columns
    ? B.allyBoard.x >= B.offers.x + B.offers.w &&
      B.allyBoard.x + B.allyBoard.w <= B.offerCards.x &&
      B.cell >= L.cell
    : Math.max(B.allyBoard.y + B.allyBoard.h, B.enemyBoard.y + B.enemyBoard.h) <=
        B.synergyBar.y + 1 && B.cell >= L.cell;

  /**
   * 음소거 버튼은 HUD 칩과 겹치지 않고 화면 안에 있어야 한다.
   *
   * HUD에서 자리를 떼는 방식이라 `hud.w`를 줄이는 걸 빼먹으면 조용히
   * "최고 기록" 위에 올라탄다 — 그런 종류의 실수는 화면을 봐야 보이고,
   * 기기 열 종을 매번 눈으로 보지는 않는다. 32px는 손가락 최소치다.
   */
  const muteClear =
    L.mute.x >= L.hud.x + L.hud.w &&
    L.mute.x + L.mute.w <= w &&
    L.mute.y >= 0 &&
    L.mute.w >= 32;

  // roomy=false는 준비 단계 띠까지 보드를 덮는 좁은 화면이다. 그때도 입력은 안 샌다.
  // 5x5는 세로로 10줄이 필요해 3x3보다 셀이 작다. 판정 영역을 셀 간격의 절반만큼
  // 넓혀 두었으므로 시각 셀 24px면 손가락으로 집을 수 있다.
  const ok =
    (L.roomy ? worst < 0.01 : true) &&
    headroom >= 0 &&
    cardsOnScreen &&
    L.cell >= 24 &&
    L.button.h >= 40 &&
    muteClear &&
    battleClear;
  if (!ok) failed++;
  console.log(
    `${name.padEnd(18)} ${(worst * 100).toFixed(1).padStart(7)}%  ` +
      `${shape} ${String(Math.round(L.offerCards.w / 3)).padStart(3)}x${String(Math.round(L.offerCards.h)).padEnd(4)}` +
      `${String(Math.round(headroom)).padStart(8)}  ${String(Math.round(L.cell)).padStart(5)}  ` +
      `${String(Math.round(L.button.h)).padStart(4)}  ${String(Math.round(B.cell)).padStart(5)}  ` +
      `${String(Math.round(L.mute.w)).padStart(5)}  ` +
      `${(L.columns ? "세로줄" : L.stacked ? "쌓음" : "눕힘").padEnd(6)}` +
      (ok ? "OK" : "실패"),
  );
}

if (failed > 0) {
  console.log(`\n${failed}개 기기에서 실패 — 카드가 가리면 안 될 것을 가리거나 셀이 너무 작다`);
  process.exit(1);
}
console.log("\n전부 통과 — 카드는 보드만 덮고, HUD와 안내 문구는 끝까지 보인다");

/* ---------------------------------------------------------------- */
/* 카드 설명 줄바꿈                                                    */
/* ---------------------------------------------------------------- */

// 글자당 10px인 가짜 컨텍스트. 실제 폰트 없이 계약만 검사한다.
const fakeCtx = { font: "", measureText: (s) => ({ width: s.length * 10 }) };

const WRAP_CASES = [
  ["빈 문자열", "", 100, 2],
  ["공백만", "   ", 100, 2],
  ["한 줄에 들어감", "가나다", 100, 2],
  ["두 줄로 나뉨", "가나다 라마바 사아자 차카타", 100, 2],
  ["넘쳐서 말줄임", "가나다 라마바 사아자 차카타 파하가 나다라", 100, 2],
  ["한 어절이 폭보다 긺", "가나다라마바사아자차카타파하", 50, 2],
  ["과대 어절이 중간 줄에", "가나 가나다라마바사아자차카타 다라", 100, 3],
  ["maxLines=1", "가나다 라마바 사아자", 100, 1],
  ["폭 0", "가나다", 0, 2],
  ["폭 음수", "가나다", -10, 2],
];

let wrapFailed = 0;
console.log("\n줄바꿈 검사");
for (const [name, text, width, maxLines] of WRAP_CASES) {
  const started = Date.now();
  const out = wrapLines(fakeCtx, text, 12, 500, width, maxLines);
  const ms = Date.now() - started;
  // 폭이 0 이하면 어떤 글자도 못 들어가므로 폭 초과는 봐준다. 줄 수와 종료성만 본다.
  const tooWide = width > 0 && out.some((l) => l.length * 10 > width && l.length > 1);
  const ok = out.length <= maxLines && !tooWide && ms < 200;
  if (!ok) wrapFailed++;
  console.log(`  ${ok ? "OK  " : "실패"} ${name.padEnd(20)} ${out.length}/${maxLines}줄  ${JSON.stringify(out)}`);
}

if (wrapFailed > 0) {
  console.log(`\n줄바꿈 ${wrapFailed}건 실패 — 카드 설명이 카드 밖으로 새거나 줄 수를 넘겼다`);
  process.exit(1);
}
console.log("전부 통과 — 설명은 정해진 줄 수 안에서 폭을 지킨다");

/**
 * 체력 바가 보드를 넘어 HUD 위로 올라가는가.
 *
 * 바를 머리 위로 올린 커밋에서 "셀 안에 들어온다"고 적고 근거로 이 프로브를
 * 들었는데, 그때 프로브는 카드와 줄바꿈만 볼 뿐 고양이 기하를 아예 안 봤다.
 * 실제로는 반경 있는 유닛(보스 1.5 · 저격수 0.85)이 몸을 셀 밖까지 키워서,
 * 적 보드 맨 윗줄에 서는 저격수가 세로 배치 일곱 기기에서 안내 문구를 덮었다.
 *
 * 이제 `healthBarGeom`을 렌더러와 **같은 함수로** 불러서 잰다. 주장과 근거가
 * 같은 코드를 가리켜야 근거다.
 */
const BAR_CASES = [
  // [이름, 진영, 반경, 셀]  — 저격수는 적 col 4(세로 배치에서 맨 윗줄), 보스는 중앙
  ["일반 고양이", "enemy", 0, 2 * BOARD_COLS + (BOARD_COLS - 1)],
  ["저격수", "enemy", SNIPER_RADIUS, 2 * BOARD_COLS + (BOARD_COLS - 1)],
  ["보스", "enemy", BOSS_RADIUS, 2 * BOARD_COLS + 2],
  ["아군 앞줄", "ally", 0, 2 * BOARD_COLS],
];

console.log("\n체력 바가 보드 안에 있는가");
let barFailed = 0;
for (const [name, w, h] of DEVICES) {
  const L = computeLayout(w, h);
  const bad = [];
  for (const [label, side, radius, cell] of BAR_CASES) {
    const { fx, fy } = cellToField(side, cell);
    const { y: cy } = fieldToScreen(L, fx, fy);
    const { by } = healthBarGeom(L, side, radius, cy);
    const top = side === "ally" ? L.allyBoard.y : L.enemyBoard.y;
    if (by < top) bad.push(`${label} ${(top - by).toFixed(1)}px 넘침`);
  }
  if (bad.length > 0) barFailed++;
  console.log(`  ${bad.length === 0 ? "OK  " : "실패"} ${name.padEnd(16)} ${bad.join(" · ") || "네 경우 모두 보드 안"}`);
}
if (barFailed > 0) {
  console.log(`\n체력 바 ${barFailed}기기 실패 — 바가 보드를 넘어 HUD 위에 그려진다`);
  process.exit(1);
}
console.log("전부 통과 — 반경 있는 유닛도 바가 보드 안에 머문다");
