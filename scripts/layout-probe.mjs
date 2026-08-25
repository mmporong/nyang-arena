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
 *    생선 수와 안내 문구까지 가리면 무엇을 살 수 있는지 모르고 사게 된다.
 *    (보드를 덮어도 되는가는 4)에서 따로 본다 — 구매·배치를 합치면서 그 계약이
 *    뒤집혔다.)
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
import {
  battleSpeedCaption,
  rerollRect,
  healthBarGeom,
  offerRects,
  gameoverGeometry,
  mapChoiceLabelGeometry,
  mapChoiceLabelText,
  mapNodeHitRadius,
  nearestMapNode,
  offerPurchaseFeedbackDescriptor,
  openMapNodeRects,
  raidContractCardGeometry,
  raidContractGuideGeometry,
  raidContractInfoContentGeometry,
  raidContractOverlayHeaderGeometry,
  raidContractRects,
  raidContractChipGeometry,
  raidContractTitleText,
  raidContractUsesViewportFooter,
  splitButton,
  splitButtonChoice,
} from "../src/game/render.ts";
import { BOARD_SIZE, BOARD_COLS, cellToField } from "../src/game/types.ts";
import { BOSS_RADIUS, SNIPER_RADIUS } from "../src/game/bosses.ts";
import { RAID_CONTRACT_POOL } from "../src/validate/raid-contract-schema.ts";
import { makeStage, nodeInfo, openLanes } from "../src/game/map.ts";

const DEVICES = [
  ["iPhone SE 세로", 375, 553],
  ["iPhone SE 가로", 667, 275],
  ["iPhone 14 세로", 390, 750],
  ["iPhone 14 가로", 844, 320],
  ["Galaxy S20 세로", 360, 680],
  ["iPad 세로", 768, 1024],
  ["데스크톱", 1440, 800],
  ["데스크톱 와이드", 1920, 1080],
  ["사용자 캡처", 1901, 891],
  ["극단 세로", 320, 900],
  ["극단 가로", 1200, 300],
  ["599px 계약 경계", 599, 359],
  ["568px 계약 경계", 568, 320],
  ["짧은 세로", 390, 500],
  ["초소형 가로", 375, 320],
  ["좁고 낮은 세로", 320, 480],
  ["footer 폭 경계", 540, 500],
];

function overlapArea(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

let failed = 0;
console.log("기기               보드셀겹침  카드    카드틈  머리줄여백  최소셀  버튼  행동틈  전투셀  음소거  구성    판정");
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
  const storeCards = offerRects(L);
  const storeGaps = storeCards.slice(1).map((card, index) => L.columns
    ? card.y - (storeCards[index].y + storeCards[index].h)
    : card.x - (storeCards[index].x + storeCards[index].w));
  const storeGap = Math.min(...storeGaps);
  const storeRhythm = L.offerGap >= 8
    && storeGap >= 8 - 0.01
    && storeCards.every((card) => card.w >= 44 && card.h >= 44)
    && storeCards.every((card) => card.x >= -0.01 && card.y >= -0.01 && card.x + card.w <= w + 0.01 && card.y + card.h <= h + 0.01);

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
   * 기기 열 종을 매번 눈으로 보지는 않는다. 모든 포인터 대상은 44px 하한이다.
   */
  const muteClear =
    L.mute.x >= L.hud.x + L.hud.w &&
    L.mute.x + L.mute.w <= w &&
    L.mute.y >= 0 &&
    L.mute.w >= 44;

  const actionClear = B.columns
    ? B.button.y - Math.max(B.allyBoard.y + B.allyBoard.h, B.enemyBoard.y + B.enemyBoard.h)
    : B.button.y - (B.synergyBar.y + B.synergyBar.h);
  const [splitLeft, splitRight] = splitButton(B.button);
  const splitGap = splitRight.x - (splitLeft.x + splitLeft.w);
  const splitCenter = B.button.x + B.button.w / 2;
  const splitClear = splitLeft.w >= 44 &&
    splitRight.w >= 44 &&
    Math.abs(splitGap - 2) < 0.01 &&
    splitButtonChoice(B.button, splitCenter - 0.5) === "dodge" &&
    splitButtonChoice(B.button, splitCenter + 0.5) === "gather";

  // roomy=false는 준비 단계 띠까지 보드를 덮는 좁은 화면이다. 겹침 검사를 면제하되,
  // **입력이 안 새는 것은 레이아웃이 아니라 `main.ts`가 보장한다** — 보상 분기가
  // 카드 사각형·빈 슬롯·카드 사이 틈을 전부 삼킨다. 전에는 이 자리에 "그때도
  // 입력은 안 샌다"고만 적혀 있었고, 구매·배치를 합친 뒤 그 문장이 거짓이 됐다
  // (667x275에서 패널의 18%가 보드로 샜다). 면제의 근거는 이제 저쪽에 있다.
  // 5x5는 세로로 10줄이 필요해 3x3보다 셀이 작다. 판정 영역을 셀 간격의 절반만큼
  // 넓혀 두었으므로 시각 셀 24px면 손가락으로 집을 수 있다.
  const ok =
    (L.roomy ? worst < 0.01 : true) &&
    headroom >= 0 &&
    cardsOnScreen &&
    L.cell >= 24 &&
    L.button.h >= 44 &&
    actionClear >= B.actionGap - 0.5 &&
    muteClear &&
    battleClear &&
    storeRhythm &&
    splitClear;
  if (!ok) failed++;
  console.log(
    `${name.padEnd(18)} ${(worst * 100).toFixed(1).padStart(7)}%  ` +
      `${shape} ${String(Math.round(L.offerCards.w / 3)).padStart(3)}x${String(Math.round(L.offerCards.h)).padEnd(4)}` +
      `${String(Math.round(storeGap)).padStart(7)}  ` +
      `${String(Math.round(headroom)).padStart(8)}  ${String(Math.round(L.cell)).padStart(5)}  ` +
      `${String(Math.round(L.button.h)).padStart(4)}  ${String(Math.round(actionClear)).padStart(6)}  ` +
      `${String(Math.round(B.cell)).padStart(5)}  ` +
      `${String(Math.round(L.mute.w)).padStart(5)}  ` +
      `${(L.columns ? "세로줄" : L.stacked ? "쌓음" : "눕힘").padEnd(6)}` +
      (ok ? "OK" : "실패"),
  );
}

if (failed > 0) {
  console.log(`\n${failed}개 기기에서 실패 — 카드가 가리면 안 될 것을 가리거나 셀이 너무 작다`);
  process.exit(1);
}
console.log("\n전부 통과 — HUD와 안내 문구는 어느 구성에서도 끝까지 보인다");

const hudMeasureCtx = {
  font: "",
  measureText(text) {
    const px = Number(this.font.match(/([0-9.]+)px/)?.[1] ?? 12);
    return { width: [...text].length * px * 0.92 };
  },
};
let speedCaptionFailed = 0;
for (const [name, w, h] of DEVICES) {
  const B = computeLayout(w, h, false);
  const chipWidth = B.hud.w / 3;
  const captionSize = Math.max(11, B.hud.h * 0.30);
  const caption = battleSpeedCaption(chipWidth);
  hudMeasureCtx.font = `700 ${captionSize}px sans-serif`;
  const measuredWidth = hudMeasureCtx.measureText(caption).width;
  const fits = measuredWidth <= chipWidth - 4;
  if (!fits) speedCaptionFailed++;
  if (w <= 360 || !fits) {
    console.log(`  ${fits ? "OK  " : "실패"} ${name.padEnd(18)} ${caption.padEnd(10)} ${measuredWidth.toFixed(1)}/${chipWidth.toFixed(1)}px`);
  }
}
if (speedCaptionFailed > 0) {
  console.log(`\n${speedCaptionFailed}개 기기에서 실패 — 전투 속도 캡션이 중앙 HUD 칩을 넘는다`);
  process.exit(1);
}
console.log("전부 통과 — 320px·360px에서도 전투 속도 캡션이 중앙 HUD 칩 안에 있다");

/* ---------------------------------------------------------------- */
/* 상점 실패 피드백 기하                                              */
/* ---------------------------------------------------------------- */

let purchaseFeedbackFailed = 0;
for (const [name, w, h] of DEVICES) {
  const L = computeLayout(w, h);
  for (let slot = 0; slot < 3; slot++) {
    for (const reduce of [false, true]) {
      const expectedDuration = reduce ? 160 : 200;
      for (const elapsed of [0, expectedDuration - 1]) {
        const visual = offerPurchaseFeedbackDescriptor(L, slot, "insufficient-fish", elapsed, reduce);
        const values = visual
          ? [visual.rect.x, visual.rect.y, visual.rect.w, visual.rect.h, visual.labelX, visual.labelY, visual.alpha, visual.lineWidth]
          : [];
        const finite = visual !== null && values.every(Number.isFinite);
        const clipped = visual !== null &&
          visual.rect.x >= 0 && visual.rect.y >= 0 &&
          visual.rect.x + visual.rect.w <= w + 0.01 &&
          visual.rect.y + visual.rect.h <= h + 0.01 &&
          visual.labelX >= 0 && visual.labelX <= w && visual.labelY >= 0 && visual.labelY <= h;
        const staticOnly = visual !== null && visual.translateX === 0 && visual.translateY === 0;
        if (!finite || !clipped || !staticOnly || visual.durationMs !== expectedDuration) {
          purchaseFeedbackFailed++;
          console.log(`${name} slot ${slot + 1} ${reduce ? "reduce" : "normal"} 실패`, visual);
        }
      }
      if (offerPurchaseFeedbackDescriptor(L, slot, "success", 0, reduce) !== null) purchaseFeedbackFailed++;
      if (offerPurchaseFeedbackDescriptor(L, slot, "insufficient-fish", expectedDuration, reduce) !== null) purchaseFeedbackFailed++;
    }
  }
}
if (purchaseFeedbackFailed > 0) {
  console.log(`\n${purchaseFeedbackFailed}개 구매 실패 피드백 기하가 화면 경계·시간 계약을 벗어났다`);
  process.exit(1);
}
console.log(`구매 실패 피드백 통과 — ${DEVICES.length}기기 × 3슬롯, 160/200ms 정적 outline·유한 좌표·화면 클리핑`);

/* ---------------------------------------------------------------- */
/* 죽은 화면의 세 갈래 버튼                                            */
/* ---------------------------------------------------------------- */

/**
 * 부검 판 바닥의 세 버튼(같은 시드 · 오늘의 시드 · 도전 +1)이 어느 기기에서도
 * (1) 손가락 최소치(44px)를 지키고 (2) 판 안에 있고 (3) 판이 큰 버튼을 덮지 않고
 * (4) 판이 화면 위로 나가지 않는지 본다. 줄 수가 가장 많은 판(무엇에 막혔나 ·
 * 예고 성적 · 팀 · 판 종류 · 도감)으로 잰다 — 그보다 짧은 판은 더 여유롭다.
 * 그림과 히트테스트가 같은 `gameoverGeometry`를 쓰므로 여기서 통과하면 손이
 * 닿는 자리와 보이는 자리가 같다.
 */
const worstCase = {
  lossReason: "wipe",
  killer: { name: "무쇠발톱", hpFrac: 0.4, boss: true },
  telegraphsSeen: 6,
  kind: "challenge",
  challenge: 3,
  lastRaidContract: { id: "probe" },
};
let goFailed = 0;
console.log("\n죽은 화면 세 갈래 버튼 (최다 줄 기준)");
console.log("기기               버튼 w×h   버튼틈  글자하한  판 위끝  판 밑끝/큰버튼  판정");
for (const [name, w, h] of DEVICES) {
  const L = computeLayout(w, h);
  const { panel, choices, fontFloor, contentBottomY, choiceHintY } = gameoverGeometry(L, worstCase);
  const all = [choices.retry, choices.daily, choices.challenge];
  const inside = all.every(
    (r) => r.x >= panel.x && r.x + r.w <= panel.x + panel.w + 0.5 && r.y >= panel.y && r.y + r.h <= panel.y + panel.h + 0.5,
  );
  const finger = all.every((r) => r.h >= 44 && r.w >= 56);
  const choiceGap = choices.daily.x - (choices.retry.x + choices.retry.w);
  const rhythm = choiceGap >= 8;
  const readable = fontFloor >= 11;
  const contentClear = contentBottomY + 4 <= choiceHintY - fontFloor / 2 && choiceHintY + fontFloor / 2 + 4 <= choices.retry.y;
  const aboveButton = panel.y + panel.h <= L.button.y + 0.5;
  const onScreen = panel.y >= 0;
  const ok = inside && finger && rhythm && readable && contentClear && aboveButton && onScreen;
  if (!ok) goFailed++;
  console.log(
    `${name.padEnd(18)} ${String(Math.round(choices.retry.w)).padStart(4)}×${String(Math.round(choices.retry.h)).padEnd(4)} ` +
      `${String(Math.round(choiceGap)).padStart(6)}  ${String(Math.round(fontFloor)).padStart(8)}  ` +
      `${String(Math.round(panel.y)).padStart(6)}  ${String(Math.round(panel.y + panel.h)).padStart(6)}/${String(Math.round(L.button.y)).padEnd(6)}  ` +
      (ok ? "OK" : "실패"),
  );
}
if (goFailed > 0) {
  console.log(`\n${goFailed}개 기기에서 실패 — 죽은 화면의 버튼이 작거나 판이 큰 버튼을 덮는다`);
  process.exit(1);
}
console.log("전부 통과 — 세 갈래 버튼은 어느 기기에서도 손가락 크기이고 판 안에 있다");

/* ---------------------------------------------------------------- */
/* 첫 화면 악몽 계약                                                  */
/* ---------------------------------------------------------------- */

let contractFailed = 0;
const contractCtx = {
  font: "",
  measureText(text) {
    const px = Number(this.font.match(/([0-9.]+)px/)?.[1] ?? 12);
    return { width: [...text].length * px * 0.92 };
  },
};

function inspectContractLayout(w, h) {
  const L = computeLayout(w, h);
  const cards = raidContractRects(L, 3);
  const usesViewportFooter = raidContractUsesViewportFooter(L, 3);
  const bottomLimit = usesViewportFooter ? h : L.button.y - L.actionGap;
  const inside = cards.every(
    (card) =>
      card.x >= 0 &&
      card.y >= L.notice.y + L.notice.h &&
      card.x + card.w <= w + 0.5 &&
      card.y + card.h <= bottomLimit + 0.5,
  );
  const finger = cards.every((card) => card.w >= 44 && card.h >= 44);
  const separate = cards.every((card, i) => cards.every((other, j) => i === j || overlapArea(card, other) === 0));
  const stacked = cards[1].y > cards[0].y + 1;
  const cardGaps = cards.slice(1).map((card, i) => stacked
    ? card.y - (cards[i].y + cards[i].h)
    : card.x - (cards[i].x + cards[i].w));
  const rhythm = cardGaps.every((gap) => gap + 0.5 >= (stacked || L.w < 600 ? 12 : 20));
  const compactHeight = !stacked || cards.every((card) => card.h >= (usesViewportFooter ? 104 : 112));
  const lastCardBottom = Math.max(...cards.map((card) => card.y + card.h));
  const viewportMode = !usesViewportFooter || (
    stacked && cards.every((card) => card.h >= 104) && lastCardBottom >= h - 12
  );
  const bounded = cards.every((card) => card.w <= 420.5 && card.h <= 360.5);
  const header = cards.every((card) => {
    const compactCard = L.h < 380 || card.h <= 168 || card.w <= 280;
    const g = raidContractCardGeometry(card, compactCard);
    const regionsInside = [g.titleRect, g.riskSealRect, ...(g.keyBadgeRect ? [g.keyBadgeRect] : [])].every((region) =>
      region.x >= g.headerRect.x - 0.5 &&
      region.y >= g.headerRect.y - 0.5 &&
      region.x + region.w <= g.headerRect.x + g.headerRect.w + 0.5 &&
      region.y + region.h <= g.headerRect.y + g.headerRect.h + 0.5,
    );
    const compactRows = g.compactHeader && g.keyBadgeRect === null &&
      g.titleRect.y + g.titleRect.h <= g.riskSealRect.y + 0.5;
    const titleEndsBeforeSeal = g.titleRect.x + g.titleRect.w + 12 <= g.riskSealRect.x + 0.5;
    const titleStartsAfterKey = g.keyBadgeRect === null || g.titleRect.x >= g.keyBadgeRect.x + g.keyBadgeRect.w + 12 - 0.5;
    const wideRow = !g.compactHeader && titleEndsBeforeSeal && titleStartsAfterKey;
    const titlesFit = RAID_CONTRACT_POOL.every((contract, index) => {
      const rawTitle = raidContractTitleText(contract, index, g);
      const line = wrapLines(contractCtx, rawTitle, g.titleSize, 900, g.titleRect.w, 1)[0] ?? rawTitle;
      const fits = contractCtx.measureText(line).width <= g.titleRect.w + 0.5;
      const fullNameRequired = usesViewportFooter;
      return fits && (g.compactHeader || !line.endsWith("…")) && (!fullNameRequired || line.includes(contract.name));
    });
    return g.titleSize >= 16 && regionsInside && (compactRows || wideRow) && titlesFit;
  });
  const bands = cards.every((card) => {
    const compactCard = L.h < 380 || card.h <= 168 || card.w <= 280;
    const g = raidContractCardGeometry(card, compactCard);
    const regions = [g.headerRect, ...(g.riskRect ? [g.riskRect] : []), g.ruleRect, g.counterRect, g.footerRect];
    const regionInside = regions.every((region) =>
      region.x >= card.x + g.pad - 0.5 &&
      region.y >= card.y + g.pad - 0.5 &&
      region.x + region.w <= card.x + card.w - g.pad + 0.5 &&
      region.y + region.h <= card.y + card.h - g.pad + 0.5 &&
      region.w > 0 && region.h > 0,
    );
    const ordered = regions.slice(1).every((region, index) => region.y >= regions[index].y + regions[index].h - 0.5);
    const gaps = regions.slice(1).map((region, index) => region.y - (regions[index].y + regions[index].h));
    const biggestGap = Math.max(0, ...gaps);
    const usedH = regions.reduce((sum, region) => sum + region.h, 0);
    const innerH = card.h - g.pad * 2;
    return regionInside && ordered && biggestGap <= 24 && usedH / innerH >= 0.75 && g.bodySize >= 12;
  });
  const footer = cards.every((card) => {
    const g = raidContractCardGeometry(card, L.h < 380 || card.h <= 168 || card.w <= 280);
    const keyInside = g.keyRect === null || (
      g.keyRect.x >= card.x && g.keyRect.y >= card.y &&
      g.keyRect.x + g.keyRect.w <= card.x + card.w + 0.5 &&
      g.keyRect.y + g.keyRect.h <= card.y + card.h + 0.5
    );
    return g.contentBottomY <= g.footerLineY + 0.5 && keyInside && g.rewardMaxWidth >= (g.keyRect === null ? 52 : 48);
  });
  const copyVisible = cards.every((card) => RAID_CONTRACT_POOL.every((contract) => {
    const compactCard = L.h < 380 || card.h <= 168 || card.w <= 280;
    const g = raidContractCardGeometry(card, compactCard);
    const ruleContent = raidContractInfoContentGeometry(g.ruleRect, g, true);
    const counterContent = raidContractInfoContentGeometry(g.counterRect, g, false);
    const ruleW = ruleContent.textRect.w;
    const counterW = counterContent.textRect.w;
    const inlineRule = g.ultraCompact || g.ruleRect.h < g.stackedInfoMinHeight;
    const inlineCounter = g.ultraCompact || g.counterRect.h < g.stackedInfoMinHeight;
    const ruleLines = wrapLines(contractCtx, inlineRule ? `보스 변화 · ${contract.rule}` : contract.rule, g.bodySize, 600, ruleW, inlineRule ? 1 : g.maxLines);
    const ruleWidths = ruleLines.map((line) => contractCtx.measureText(line).width);
    const counterLines = wrapLines(contractCtx, inlineCounter ? `내 대응 · ${contract.counter}` : contract.counter, g.bodySize, 800, counterW, inlineCounter ? 1 : g.maxLines);
    const counterWidths = counterLines.map((line) => contractCtx.measureText(line).width);
    const fitsAtTwelve = ruleWidths.every((width) => width <= ruleW + 0.5) &&
      counterWidths.every((width) => width <= counterW + 0.5);
    const verticalFit = [
      [g.ruleRect, inlineRule, ruleLines.length],
      [g.counterRect, inlineCounter, counterLines.length],
    ].every(([rect, inline, lineCount]) => {
      if (inline) return g.bodySize <= rect.h + 0.5;
      const labelY = g.labelSize * 0.9 + 4;
      const textTop = labelY + g.labelSize * 0.72 + g.bodySize * 0.72;
      const textBottom = textTop + Math.max(0, lineCount - 1) * g.bodySize * 1.28 + g.bodySize * 0.5;
      return labelY + g.labelSize * 0.5 <= rect.h + 0.5 && textBottom <= rect.h + 0.5;
    });
    const mayEllipsize = compactCard || inlineRule || inlineCounter;
    const fullCopy = [...ruleLines, ...counterLines].every((line) => !line.endsWith("…"));
    return fitsAtTwelve && verticalFit && (mayEllipsize || fullCopy);
  }));
  const emblem = RAID_CONTRACT_POOL.every((contract) => contract.patterns.length > 0) && cards.every((card) => {
    const compactCard = L.h < 380 || card.h <= 168 || card.w <= 280;
    const g = raidContractCardGeometry(card, compactCard);
    const ruleContent = raidContractInfoContentGeometry(g.ruleRect, g, true);
    const counterContent = raidContractInfoContentGeometry(g.counterRect, g, false);
    const expected = !g.ultraCompact && g.ruleRect.w >= 260 && g.ruleRect.h >= 56;
    const seal = ruleContent.emblemRect;
    const expectedPresence = expected ? seal !== null : seal === null;
    const sealInside = seal === null || (
      seal.w >= 32 && seal.w <= 40 && seal.h === seal.w &&
      seal.x >= g.ruleRect.x - 0.5 && seal.y >= g.ruleRect.y - 0.5 &&
      seal.x + seal.w <= g.ruleRect.x + g.ruleRect.w + 0.5 &&
      seal.y + seal.h <= g.ruleRect.y + g.ruleRect.h + 0.5 &&
      ruleContent.textRect.x >= seal.x + seal.w + 10 - 0.5
    );
    return expectedPresence && sealInside && counterContent.emblemRect === null;
  });
  const guide = raidContractGuideGeometry(L, 3);
  const cardBottom = Math.max(...cards.map((card) => card.y + card.h));
  const guideMode = guide.visible === !usesViewportFooter;
  const guideClear = guideMode && (!guide.visible || (
    guide.dividerY >= cardBottom + 8 - 0.5 && guide.keys.every((key) =>
      key.x >= 0 && key.y >= cardBottom && key.x + key.w <= w + 0.5 && key.y + key.h <= h + 0.5
    )
  ));
  const overlayHeader = raidContractOverlayHeaderGeometry(L, 3);
  const headerClear = cards.every((card) => card.y >= overlayHeader.bottomY + 4 - 0.5);
  const ok = cards.length === 3 && inside && finger && separate && rhythm && compactHeight && viewportMode && bounded && header && bands && footer && copyVisible && emblem && guideClear && headerClear;
  return { L, cards, stacked, inside, finger, separate, rhythm, compactHeight, viewportMode, bounded, header, bands, footer, copyVisible, emblem, guideClear, headerClear, ok };
}

console.log("\n첫 화면 악몽 계약 카드");
console.log("기기               카드 w×h   배치   화면/버튼/겹침  판정");
for (const [name, w, h] of DEVICES) {
  const result = inspectContractLayout(w, h);
  const { cards, stacked, inside, finger, separate, rhythm, compactHeight, viewportMode, bounded, header, bands, footer, copyVisible, emblem, guideClear, headerClear, ok } = result;
  if (!ok) contractFailed++;
  const first = cards[0];
  console.log(
    `${name.padEnd(18)} ${String(Math.round(first.w)).padStart(4)}×${String(Math.round(first.h)).padEnd(4)} ` +
      `${(stacked ? "1열" : "3열").padEnd(4)}   ` +
      `${inside && finger && separate && rhythm && compactHeight && viewportMode && bounded && header && bands && footer && copyVisible && emblem && guideClear && headerClear ? "OK" : "실패"}              ${ok ? "OK" : "실패"}`,
  );
  if (!ok) {
    console.log(`  ↳ inside=${inside} finger=${finger} separate=${separate} rhythm=${rhythm} compactHeight=${compactHeight} viewport=${viewportMode} bounded=${bounded} header=${header} bands=${bands} footer=${footer} copy=${copyVisible} emblem=${emblem} guide=${guideClear} headerClear=${headerClear}`);
  }
}

let sweepCases = 0;
let sweepFailed = 0;
const sweepReasons = { inside: 0, finger: 0, separate: 0, rhythm: 0, compactHeight: 0, viewportMode: 0, bounded: 0, header: 0, bands: 0, footer: 0, copyVisible: 0, emblem: 0, guideClear: 0, headerClear: 0 };
for (let w = 320; w <= 900; w += 20) {
  for (let h = 275; h <= 900; h += 20) {
    sweepCases++;
    const result = inspectContractLayout(w, h);
    if (!result.ok) {
      sweepFailed++;
      for (const key of Object.keys(sweepReasons)) if (!result[key]) sweepReasons[key]++;
      if (sweepFailed <= 12) {
        const first = result.cards[0];
        console.log(`  sweep ${w}×${h} card=${Math.round(first.w)}×${Math.round(first.h)} header=${result.header} copy=${result.copyVisible}`);
      }
    }
  }
}
contractFailed += sweepFailed;
if (sweepFailed > 0) {
  console.log(`실패 반응형 경계 sweep ${sweepFailed}/${sweepCases}건`);
  console.log(`실패 원인 ${Object.entries(sweepReasons).filter(([, count]) => count > 0).map(([key, count]) => `${key}=${count}`).join(" · ")}`);
}

const cp = (text) => [...text].length;
for (const contract of RAID_CONTRACT_POOL) {
  if (cp(contract.name) > 7 || cp(contract.rule) > 34 || cp(contract.counter) > 34) {
    contractFailed++;
    console.log(
      `실패 ${contract.id}: 카피 예산 이름 ${cp(contract.name)}/7 · 규칙 ${cp(contract.rule)}/34 · 대응 ${cp(contract.counter)}/34`,
    );
  }
}
for (const [name, w, h] of DEVICES) {
  const L = computeLayout(w, h);
  for (const contract of RAID_CONTRACT_POOL) {
    for (const phase of ["map", "prepare", "reward"]) {
      const g = raidContractChipGeometry(L, contract, phase);
      const estimatedTextW = [...g.label].length * g.fontSize * 0.92;
      const insideNotice =
        g.chip.x >= L.notice.x &&
        g.chip.y >= L.notice.y &&
        g.chip.x + g.chip.w <= L.notice.x + L.notice.w + 0.5 &&
        g.chip.y + g.chip.h <= L.notice.y + L.notice.h + 0.5;
      if (!insideNotice || g.fontSize < 12 || estimatedTextW + 30 > g.chip.w + 0.5 || g.content.w < 80) {
        contractFailed++;
        console.log(`실패 ${name}/${contract.id}/${phase}: 활성 칩 폭·12px 하한·안내 영역 위반`);
      }
    }
  }
}
if (contractFailed > 0) {
  console.log(`\n${contractFailed}건 실패 — 계약 카드가 화면을 벗어나거나 카피 예산을 넘겼다`);
  process.exit(1);
}
console.log(`전부 통과 — ${DEVICES.length}기기 + ${sweepCases}경계 카드 3장·활성 칩 12px·터치 영역·겹침 0, 출고 ${RAID_CONTRACT_POOL.length}종 카피 예산 준수`);

/* ---------------------------------------------------------------- */
/* 지도 선택 라벨·터치 영역                                           */
/* ---------------------------------------------------------------- */

const probeMap = makeStage(1, 424242);
const openAtStart = openLanes(probeMap, 0);
let mapChoiceFailed = 0;
console.log("\n지도 열린 길 — 숫자 라벨·44px 터치·행동 영역 분리");
for (const [name, w, h] of DEVICES) {
  const L = computeLayout(w, h);
  const state = { map: probeMap, step: 0 };
  const current = openMapNodeRects(L, state);
  const checks = current.map((entry) => {
    const ordinal = openAtStart.indexOf(entry.idx) + 1;
    const node = probeMap.steps[0][entry.idx];
    const label = mapChoiceLabelGeometry(L, entry.rect, node?.kind === "boss");
    const text = mapChoiceLabelText(ordinal, nodeInfo(node.kind).name);
    const hit = mapNodeHitRadius(entry.rect) * 2 >= 44;
    const belowNode = label.y - label.fontSize * 0.6 >= entry.rect.y + entry.rect.h - 0.5;
    const aboveAction = label.bottom <= L.button.y - L.actionGap + 0.5;
    const numbered = text.startsWith(`${ordinal} `);
    return hit && belowNode && aboveAction && numbered;
  });
  const byX = [...current].sort((a, b) => a.rect.x - b.rect.x);
  const nearestWins = byX.slice(1).every((right, i) => {
    const left = byX[i];
    const leftCx = left.rect.x + left.rect.w / 2;
    const rightCx = right.rect.x + right.rect.w / 2;
    const cy = (left.rect.y + left.rect.h / 2 + right.rect.y + right.rect.h / 2) / 2;
    const overlap = rightCx - leftCx < mapNodeHitRadius(left.rect) + mapNodeHitRadius(right.rect);
    if (!overlap) return true;
    return nearestMapNode([left, right], (leftCx + rightCx) / 2 + 1, cy) === right &&
      nearestMapNode([left, right], (leftCx + rightCx) / 2 - 1, cy) === left;
  });
  const ok = current.length === openAtStart.length && checks.every(Boolean) && nearestWins;
  if (!ok) mapChoiceFailed++;
  console.log(`  ${ok ? "OK  " : "실패"} ${name.padEnd(18)} 열린 길 ${current.length}개 · 터치/라벨/순서 ${ok ? "일치" : "위반"}`);
}
if (mapChoiceFailed > 0) {
  console.log(`\n${mapChoiceFailed}개 기기에서 실패 — 지도 선택 라벨이나 44px 입력 영역이 행동 버튼과 충돌한다`);
  process.exit(1);
}
console.log("전부 통과 — 지도 숫자 순서와 키보드 순서가 같고 터치 영역은 44px 이상이다");


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

/**
 * **구매와 배치를 한 화면으로 합쳤으므로, 카드가 판을 덮으면 안 된다.**
 *
 * 전에는 덮어도 됐다 — 보상 단계에서 판이 입력을 안 받았기 때문이다. 이제는
 * 같은 화면에서 사고 끌므로 그 불변식이 사라졌고, 대신 **카드가 판을 비켜야
 * 한다**는 계약이 생겼다. 이 검사가 없으면 좁아진 화면에서 카드가 조용히
 * 판을 덮고, 고양이를 집으려던 손이 카드 구매로 새어 들어간다.
 *
 * 지원 대상인 세로줄 구성(데스크톱)에서만 요구한다. 접힌 구성(폰)은 카드가
 * 위로 자라 판을 덮는데, 세로 화면에서 둘을 다 띄우려면 셀이 손가락으로 집을
 * 수 없는 크기가 된다. **폰은 배제하기로 한 범위**이고, 거기서는 판의 덮이지
 * 않은 부분만 만질 수 있다 — 히트테스트가 카드를 먼저 보므로 오작동은 아니다.
 */
const inter = (a, b) => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
};

console.log("\n구매·배치 한 화면 — 카드가 판을 비키는가 (세로줄 구성만)");
let mergeFailed = 0;
for (const [name, w, h] of DEVICES) {
  const L = computeLayout(w, h, true);
  if (!L.columns) {
    console.log(`  건너뜀 ${name.padEnd(16)} 접힌 구성 — 카드가 판 위로 자란다(탭은 main.ts가 삼킨다)`);
    continue;
  }
  let cov = 0;
  for (const r of offerRects(L)) cov += inter(L.allyBoard, r);
  if (L.offersPanel) cov = Math.max(cov, inter(L.allyBoard, L.offersPanel));
  const pctCov = (cov / (L.allyBoard.w * L.allyBoard.h)) * 100;
  const ok = cov === 0;
  if (!ok) mergeFailed++;
  console.log(`  ${ok ? "OK  " : "실패"} ${name.padEnd(16)} 카드가 판을 ${pctCov.toFixed(1)}% 덮음`);
}
if (mergeFailed > 0) {
  console.log(`\n${mergeFailed}기기 실패 — 카드가 판을 덮는데 같은 화면에서 드래그를 받는다`);
  process.exit(1);
}
console.log("전부 통과 — 지원 구성에서 카드는 판을 비킨다");
