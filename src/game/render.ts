import {
  actIntentKind,
  actUsable,
  BLINK_IN_MS,
  BLINK_OUT_MS,
  creepZones,
  damagePops,
  dodgeUsable,
  dualChoiceActive,
  FIELD_MAX_FX,
  finalPhaseChannelActive,
  fxs,
  hazardsActive,
  POP_LIFE_MS,
  shots,
  SHOT_LIFE_MS,
  skillName,
  strikeUsable,
  sweepZones,
  type Fx,
  vulnerableWindowBoss,
} from "./battle.ts";
import { bossForIndex, bossKit, BOSS_THRESHOLDS, FINAL_VULNERABLE_MS, SNIPER_BREED } from "./bosses.ts";
import { drawScene, type Scene } from "./backdrop.ts";
import { bossHint, bossOrdinalInStage, isRaidPrepStep, nodeInfo, openLanes, STAGE_STEPS, type NodeKind } from "./map.ts";
import { drawFish, drawIcon, drawNodeIcon, drawSpeaker, type IconName } from "./icons.ts";
import { isMuted, playUiCue } from "./audio.ts";
import { BALANCE } from "./balance.ts";
import { cellRect, fieldToScreen, hitCell, uiSpace, type Layout, type Rect } from "./layout.ts";
import { SPRITE_CROP, spriteDrawRect } from "./sprite-atlas.ts";
import { spriteFor, type SpriteFrame } from "./sprites.ts";
import {
  boardUnits,
  OFFER_SLOTS,
  REROLL_COST,
  unitCap,
  currentKind,
  waveKindInfo,
  mapStep,
  bossIndexAt,
  bossesSeen,
  nextRaidBossTarget,
  sameClassNeighbors,
  relicActive,
  CODEX_TOTALS,
  loadCodex,
  type Codex,
  type NextChoice,
  type Offer,
  type RunState,
} from "./run.ts";
import { RELICS, type Relic } from "./relics.ts";
import { raidPrepLabel, raidPrepRoute, raidRiskLabel, raidShareCode } from "./raid.ts";
import { stageTheme, tintForEnemy } from "./stages.ts";
import type { RaidContract } from "../validate/raid-contract-schema.ts";

const debugSpriteFallback = typeof location !== "undefined"
  && new URLSearchParams(location.search).get("debug") === "1";
let spriteFallbackDraws = 0;

/** production 판정에는 관여하지 않는 debug 전용 누적 관찰값이다. */
export function spriteFallbackDrawCount(): number {
  return spriteFallbackDraws;
}

/** 유물 총 종류. 오른쪽 줄이 "몇 개 중 몇 개"를 말하고 칸 높이를 여기서 뽑는다. */
const RELIC_TOTAL = RELICS.length;
import {
  bevelPanel,
  numText,
  numTextHeight,
  numTextWidth,
  roundRect,
  T,
  uiText,
  wrapLines,
} from "./theme.ts";
import {
  effectLabel,
  synergyProgress,
  triggerLabel,
} from "../validate/synergy-schema.ts";
import { PASSIVES, SKILLS } from "./skills.ts";
import {
  BOARD_ROWS,
  BOARD_SIZE,
  CLASS_LABEL,
  CLASS_ORDER,
  CLASS_SHORT,
  zeroByClass,
  livingCats,
  type Cat,
  type ClassKind,
  type CreepZone,
  type Pose,
  type Side,
  type Telegraph,
} from "./types.ts";

/**
 * 셀 대비 고양이 그리기 크기.
 * 작을수록 전장이 넓어 보이고 유닛이 겹칠 일이 줄어든다.
 * 체력바·뱃지는 셀이 아니라 이 크기에 비례시켜야 축소해도 비율이 안 깨진다.
 */
/*
 * 기기별로 조작 안내를 갈라 주던 `HAS_KEYS`는 지웠다. 개입이 버튼 하나가
 * 되면서 안내할 조작 자체가 없어졌다 — 어디서든 "그 버튼을 누른다"가 전부다.
 */

const CAT_SCALE = 0.66;

/**
 * 운영체제의 모션 축소 설정. 쿼리 객체는 한 번만 만들되 `matches`는 매번 읽어
 * 실행 중 설정이 바뀌어도 다음 프레임부터 반영한다. Node 하네스가 이 모듈을
 * 불러도 `window`에 닿지 않게 가드한다.
 */
const motionQuery =
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : null;

function reducedMotion(): boolean {
  return motionQuery?.matches ?? false;
}

/** 반복 맥동은 모션 축소에서 중간 밝기의 정지 상태로 남긴다. */
function motionPulse(period: number): number {
  return reducedMotion() ? 0.5 : 0.5 + 0.5 * Math.sin(performance.now() / period);
}

/** 시너지 트리거마다 고유색. TFT가 특성별로 색을 나누는 것과 같은 이유 — 한눈에 구분되게. */
/**
 * 직업 색. 뱃지와 카드에서 같은 색을 쓴다.
 *
 * 전부 저채도다. 직업은 **정체성**이지 신호가 아니므로 판 위에서 예고와
 * 경쟁하면 안 된다. 특히 궁수는 원래 액션 버튼과 같은 주황이었는데, 주황을
 * 버튼에 양보하고 청동으로 물러났다.
 */
const CLASS_COLOR: Record<ClassKind, string> = {
  warrior: "#C4715A",
  rogue: "#A97CC4",
  archer: "#C9A05C",
  // 소환사는 남색. 마법사의 하늘색과 이웃이라 한 단계 짙게 잡아 갈랐다.
  mage: "#6E97C4",
  summoner: "#5C6BB8",
};

/**
 * 직업 아이콘. 7x7 비트맵으로, 각 행의 하위 7비트가 한 줄이다.
 *
 * 전에는 "전·도·궁·법" 한 글자를 시스템 폰트로 뱃지에 찍었다. 지름 20px짜리
 * 원 안의 한글은 획이 뭉개져서, 결국 **색으로만** 구분하게 된다. 그런데 직업색은
 * 저채도로 물러난 상태라 그 색조차 약하다.
 *
 * 도형은 색을 못 봐도 갈린다. 실루엣이 서로 최대한 안 겹치게 골랐다 —
 * 넓은 사다리꼴(방패) · 대각선(단검) · 열린 호(활) · 대칭 십자(별).
 * 무기 고증보다 **7px에서 구분되는가**가 기준이다.
 *
 * 세로줄의 직업 목록은 이걸 안 쓴다(`CLASS_PICTO` 참고). 거기는 20px이라
 * 그림이 들어가지만, 판 위 뱃지는 7~10px이라 실루엣이 뭉갠다. 같은 정보를
 * 두 크기로 보여주는 자리라 **그림도 둘**이어야 한다.
 */
const CLASS_ICON: Record<ClassKind, readonly number[]> = {
  // 방패 — 넓게 시작해 아래로 좁아진다
  warrior: [0x7f, 0x7f, 0x3e, 0x3e, 0x1c, 0x1c, 0x08],
  // 단검 — 오른쪽 위로 뻗는 대각선
  rogue: [0x03, 0x06, 0x0c, 0x18, 0x38, 0x70, 0x20],
  // 활 — 오른쪽으로 열린 호
  archer: [0x38, 0x44, 0x42, 0x42, 0x42, 0x44, 0x38],
  // 별 — 상하좌우 대칭 십자
  mage: [0x08, 0x08, 0x1c, 0x7f, 0x1c, 0x08, 0x08],
  // 부름 — 위의 고리 하나가 아래 점 셋을 부른다
  summoner: [0x1c, 0x22, 0x22, 0x1c, 0x00, 0x00, 0x55],
};

/** 세로줄 직업 목록용 그림. 판 위 뱃지(7x7 비트맵)와 크기가 달라 따로 둔다. */
const CLASS_PICTO: Record<ClassKind, IconName> = {
  warrior: "cls-warrior",
  rogue: "cls-rogue",
  archer: "cls-archer",
  mage: "cls-mage",
  summoner: "cls-summoner",
};

/** 뱃지 안에 직업 표식을 그린다. */
function drawClassIcon(
  ctx: CanvasRenderingContext2D,
  cls: ClassKind,
  cx: number,
  cy: number,
  size: number,
  color: string,
): void {
  const rows = CLASS_ICON[cls];
  // 픽셀을 정수로 떨어뜨린다. 소수 크기로 그리면 7px 도형이 흐려져 아이콘의
  // 유일한 장점(또렷함)이 사라진다.
  const p = Math.max(1, Math.round(size / 7));
  const x0 = Math.round(cx - (p * 7) / 2);
  const y0 = Math.round(cy - (p * 7) / 2);
  ctx.fillStyle = color;
  for (let r = 0; r < 7; r++) {
    const bits = rows[r] ?? 0;
    for (let c = 0; c < 7; c++) {
      if (bits & (1 << (6 - c))) ctx.fillRect(x0 + c * p, y0 + r * p, p, p);
    }
  }
}

const TRIGGER_COLOR: Record<string, string> = {
  same_color_3: "#C9A05C",
  same_breed_2: "#A97CC4",
  front_melee_2: "#C4715A",
  back_ranged_2: "#6E97C4",
};

export interface DragState {
  active: boolean;
  fromCell: number;
  x: number;
  y: number;
  /** 드래그를 시작한 포인터. 멀티터치에서 다른 손가락이 끼어드는 걸 막는다. */
  pointerId: number;
  /**
   * 마우스가 지금 있는 자리. 드래그 중이 아니어도 늘 갱신된다.
   *
   * 손가락에는 호버가 없으므로 터치에서는 -1로 남는다. 호버는 **덤**이지
   * 정보를 거기에만 두면 안 된다는 뜻이다 — 지금 지도의 갈래 설명이 요약
   * 줄에도 같이 뜨는 이유다.
   */
  hoverX: number;
  hoverY: number;
}

/* ------------------------------------------------------------------ */
/* 배경과 아레나                                                        */
/* ------------------------------------------------------------------ */

/**
 * 이번 웨이브의 무대.
 *
 * 보스는 자기 무대를 갖는다 — 성격을 공간이 먼저 말하기 때문이다. 정면 대결은
 * 콜로세움, 순간이동은 겹친 지붕, 제자리 원형 장판은 얼어붙은 수면. 나머지
 * 웨이브는 전부 숲이고, 숲만 하루가 흐른다.
 */
function sceneForWave(s: RunState): Scene {
  // 스테이지 테마가 씬을 통째로 정해 두면 그걸 따른다 — 스테이지 1은
  // 콜로세움·골목 대신 잿불 벌판 하나로 통일한다(서리귀는 스테이지 1에
  // 안 나오는 보스라 겹칠 일이 없다). 나머지 스테이지는 기존 로직 그대로다.
  const forced = stageTheme(s.map.stage).backdropScene;
  if (forced) return forced;
  const boss = s.enemy.find((c) => c?.radius && c.radius > 0 && c.breed.id !== SNIPER_BREED.id);
  if (boss) {
    if (boss.breed.id === 10) return "alley";
    if (boss.breed.id === 11) return "frost";
    return "stone";
  }
  return "forest";
}

/**
 * 하루의 진행. 열 웨이브가 하루다.
 *
 * 웨이브 번호를 그대로 쓰면 판이 길어질수록 영원히 밤이다. 스테이지가 넘어가면
 * 다시 아침으로 돌아와야 "또 하루가 시작됐다"가 읽히고, 그게 곧 진행감이다.
 */
const STAGE_WAVES = 10;
function dayProgress(wave: number): number {
  return ((wave - 1) % STAGE_WAVES) / (STAGE_WAVES - 1);
}

/**
 * 배경 어둠 그라디언트는 레이아웃에만 의존한다. 매 프레임 `createLinearGradient`(4 µs)를 다시
 * 만들던 것을 레이아웃 키로 기억한다 — 컨텍스트마다 따로(그라디언트는 만든 컨텍스트에 묶인다).
 */
const bgGradientCache = new WeakMap<CanvasRenderingContext2D, { key: string; g: CanvasGradient }>();

function drawBackground(ctx: CanvasRenderingContext2D, L: Layout, s: RunState): void {
  ctx.fillStyle = T.ink;
  ctx.fillRect(0, 0, L.w, L.h);

  drawScene(ctx, L.w, L.h, sceneForWave(s), dayProgress(s.wave));

  /**
   * 어둠을 세로로 다르게 깐다.
   *
   * 평평하게 덮으면 둘 중 하나를 잃는다 — 옅으면 밝은 하늘 위에서 HUD 글자가
   * 날아가고, 짙으면 씬이 진흙이 된다. 글자가 있는 위아래는 짙게, 판이 있는
   * 가운데는 옅게 두면 씬은 살고 글자는 읽힌다.
   */
  const top = L.notice.y + L.notice.h;
  const bottom = L.offersPanel.y;
  const key = `${L.w}|${L.h}|${top}|${bottom}`;
  let hit = bgGradientCache.get(ctx);
  if (!hit || hit.key !== key) {
    const g = ctx.createLinearGradient(0, 0, 0, L.h);
    g.addColorStop(0, "rgba(9,6,5,0.80)");
    g.addColorStop(Math.max(0.02, Math.min(0.98, top / L.h)), "rgba(9,6,5,0.30)");
    g.addColorStop(Math.max(0.03, Math.min(0.99, bottom / L.h)), "rgba(9,6,5,0.42)");
    g.addColorStop(1, "rgba(9,6,5,0.86)");
    hit = { key, g };
    bgGradientCache.set(ctx, hit);
  }
  ctx.fillStyle = hit.g;
  ctx.fillRect(0, 0, L.w, L.h);
}

function arenaBox(L: Layout): Rect {
  const pad = L.cell * 0.34;
  const x = Math.min(L.allyBoard.x, L.enemyBoard.x) - pad;
  // 진영 라벨까지 감싸되 안내 문구 띠는 침범하지 않는다.
  // 클램프가 없으면 패널 윗변이 문구를 가로지른다.
  const y = Math.max(
    Math.min(L.allyBoard.y, L.enemyBoard.y) - pad * 0.5 - L.labelH,
    L.notice.y + L.notice.h,
  );
  const right =
    Math.max(L.allyBoard.x + L.allyBoard.w, L.enemyBoard.x + L.enemyBoard.w) +
    pad;
  const bottom =
    Math.max(L.allyBoard.y + L.allyBoard.h, L.enemyBoard.y + L.enemyBoard.h) +
    pad;
  return { x, y, w: right - x, h: bottom - y };
}


/**
 * 보스 광역기 예고.
 *
 * 보이지 않는 경고는 경고가 아니다. 터지기 전에 어디가 위험한지 보여주고,
 * 남은 시간에 따라 차오르게 해서 "곧 터진다"가 읽히게 한다.
 *
 * 판정은 battle.ts가 정준 좌표에서 하고 여기서는 그리기만 한다. 두 곳에서
 * 따로 계산하면 보이는 곳과 맞는 곳이 갈라진다.
 */
/**
 * 사선 해칭 — "여기서 나가라".
 *
 * 색만으로 신호를 나누면 적록색약에게는 두 예고가 같은 회색 판이 된다. 형태를
 * 하나씩 붙이면 색을 못 봐도 무늬로 갈린다. 호출부에서 예고 모양으로 클립한 뒤
 * 부르므로 여기서는 넉넉한 사각형만 채우면 된다.
 */
function hatch(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  hue: string,
  fill: number,
): void {
  const gap = Math.max(6, Math.min(w, h) * 0.11);
  ctx.save();
  ctx.strokeStyle = `rgba(${hue},${0.16 + fill * 0.3})`;
  ctx.lineWidth = Math.max(1, gap * 0.18);
  ctx.beginPath();
  // 좌상 → 우하 사선. 시작을 -h만큼 당겨야 위쪽 모서리까지 덮인다.
  for (let i = -h; i < w + h; i += gap) {
    ctx.moveTo(x + i, y);
    ctx.lineTo(x + i + h, y + h);
  }
  ctx.stroke();
  ctx.restore();
}

/** 동심원 — "여기로 모여라". 안으로 빨려드는 방향이 무늬에 들어 있다. */
function concentric(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  hue: string,
  fill: number,
): void {
  ctx.save();
  ctx.strokeStyle = `rgba(${hue},${0.22 + fill * 0.34})`;
  ctx.lineWidth = Math.max(1, r * 0.045);
  for (let k = 1; k <= 3; k++) {
    ctx.beginPath();
    ctx.arc(cx, cy, (r * k) / 4, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * 예고를 그리는 클립 상자. 반경이 커서 그냥 그리면 HUD와 하단 UI까지
 * 침범하므로 전장 안으로 자른다 — 상주 장판(creep) 그리기도 같은 상자를 쓴다.
 */
function telegraphClipBox(L: Layout): { x0: number; y0: number; x1: number; y1: number; m: number } {
  const x0 = Math.min(L.allyBoard.x, L.enemyBoard.x);
  const y0 = Math.min(L.allyBoard.y, L.enemyBoard.y);
  const x1 = Math.max(L.allyBoard.x + L.allyBoard.w, L.enemyBoard.x + L.enemyBoard.w);
  const y1 = Math.max(L.allyBoard.y + L.allyBoard.h, L.enemyBoard.y + L.enemyBoard.h);
  return { x0, y0, x1, y1, m: L.cell * 0.25 };
}

/** 예고 하나를 그린다. `drawTelegraphs`가 `telegraph`·`telegraph2` 둘 다 이걸로 그린다. */
function drawOneTelegraph(
  ctx: CanvasRenderingContext2D,
  L: Layout,
  tg: Telegraph,
  box: { x0: number; y0: number; x1: number; y1: number; m: number },
): void {
  const { x0, y0, x1, y1, m } = box;
  // 0 → 1로 차오른다. 다 차면 터진다.
  const fill = 1 - Math.max(0, tg.fuse) / tg.fuseMax;
  const gather = tg.mode === "gather";
  // 나가라는 분홍, 들어와라는 청록. 둘 다 판 위에서 채도를 독점하는 대역이라
  // 진영색·직업색과 밝기에서부터 갈린다.
  const hue = gather ? "43,227,180" : "255,63,110";
  const origin = fieldToScreen(L, tg.fx, tg.fy);
  const pitch = L.cell + L.gap;

  ctx.save();
  ctx.beginPath();
  ctx.rect(x0 - m, y0 - m, x1 - x0 + m * 2, y1 - y0 + m * 2);
  ctx.clip();
  ctx.lineJoin = "round";

  if (tg.shape === "circle") {
    const r = tg.arg * pitch;
    ctx.beginPath();
    ctx.arc(origin.x, origin.y, r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${hue},${0.1 + fill * 0.28})`;
    ctx.fill();
    ctx.strokeStyle = `rgba(${hue},${0.5 + fill * 0.5})`;
    ctx.lineWidth = 2 + fill * 2;
    ctx.stroke();
    // 중심을 채우면 고양이·체력바·피해 숫자를 덮는다. 남은 시간은 외곽에서
    // 차오르는 도화선으로 옮겨, 위험의 시간축과 판의 정보 밀도를 함께 지킨다.
    const from = -Math.PI / 2;
    ctx.beginPath();
    ctx.arc(origin.x, origin.y, r * 0.9, from, from + Math.PI * 2 * fill);
    ctx.strokeStyle = `rgba(${hue},${0.72 + fill * 0.28})`;
    ctx.lineWidth = Math.max(3, L.cell * 0.07);
    ctx.lineCap = "round";
    ctx.stroke();
    if (gather) {
      concentric(ctx, origin.x, origin.y, r, hue, fill);
    } else {
      ctx.save();
      ctx.beginPath();
      ctx.arc(origin.x, origin.y, r, 0, Math.PI * 2);
      ctx.clip();
      hatch(ctx, origin.x - r, origin.y - r, r * 2, r * 2, hue, fill);
      ctx.restore();
    }
  } else if (tg.shape === "half") {
    /**
     * 극성의 절반 존. 원형·직선·부채꼴처럼 중심에서 뻗는 모양이 아니라
     * 판을 가르는 사각형이라 회전 대신 **네 모서리를 각각 `fieldToScreen`으로
     * 옮겨 잇는다** — 세로 화면에서 보드가 전치돼도(fx가 화면 y가 돼도)
     * 이 방식은 그대로 맞는 사각형을 낸다.
     */
    // 아군 보드(0..4)가 아니라 판 전체(FIELD_MAX_FX)로 뻗는다 — 근접이 붙어
    // 싸우는 자리(fx 6~9)까지 덮어야 판정(battle.ts의 inTelegraph)과 맞는다.
    const nearX = tg.dirX >= 0 ? tg.fx : -0.5;
    const farX = tg.dirX >= 0 ? FIELD_MAX_FX + 0.5 : tg.fx;
    const corners = [
      fieldToScreen(L, nearX, -0.5),
      fieldToScreen(L, farX, -0.5),
      fieldToScreen(L, farX, BOARD_ROWS - 0.5),
      fieldToScreen(L, nearX, BOARD_ROWS - 0.5),
    ];
    ctx.beginPath();
    ctx.moveTo(corners[0]!.x, corners[0]!.y);
    for (const p of corners.slice(1)) ctx.lineTo(p.x, p.y);
    ctx.closePath();
    ctx.fillStyle = `rgba(${hue},${0.1 + fill * 0.26})`;
    ctx.fill();
    ctx.strokeStyle = `rgba(${hue},${0.5 + fill * 0.5})`;
    ctx.lineWidth = 2 + fill * 2;
    ctx.stroke();
    const bx0 = Math.min(...corners.map((p) => p.x));
    const by0 = Math.min(...corners.map((p) => p.y));
    const bx1 = Math.max(...corners.map((p) => p.x));
    const by1 = Math.max(...corners.map((p) => p.y));
    ctx.save();
    ctx.clip();
    if (gather) concentric(ctx, (bx0 + bx1) / 2, (by0 + by1) / 2, (bx1 - bx0) / 2, hue, fill);
    else hatch(ctx, bx0, by0, bx1 - bx0, by1 - by0, hue, fill);
    ctx.restore();
  } else {
    // 직선·부채꼴은 방향이 있으므로 화면에서도 같은 방향으로 돌린다.
    const tip = fieldToScreen(L, tg.fx + tg.dirX * tg.reach, tg.fy + tg.dirY * tg.reach);
    const ang = Math.atan2(tip.y - origin.y, tip.x - origin.x);
    const len = Math.hypot(tip.x - origin.x, tip.y - origin.y);

    ctx.translate(origin.x, origin.y);
    ctx.rotate(ang);
    ctx.beginPath();
    if (tg.shape === "line") {
      const half = tg.arg * pitch;
      ctx.rect(0, -half, len, half * 2);
    } else {
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, len, -tg.arg, tg.arg);
      ctx.closePath();
    }
    ctx.fillStyle = `rgba(${hue},${0.1 + fill * 0.26})`;
    ctx.fill();
    ctx.strokeStyle = `rgba(${hue},${0.5 + fill * 0.5})`;
    ctx.lineWidth = 2 + fill * 2;
    ctx.stroke();
    // 방향이 있는 예고는 전부 회피다. 해칭도 같은 규칙을 따른다.
    ctx.save();
    ctx.clip();
    hatch(ctx, -len, -len, len * 2, len * 2, hue, fill);
    ctx.restore();
  }
  ctx.restore();
}

function drawTelegraphs(ctx: CanvasRenderingContext2D, L: Layout, s: RunState): void {
  const box = telegraphClipBox(L);
  for (const c of s.enemy) {
    if (!c) continue;
    if (c.telegraph) drawOneTelegraph(ctx, L, c.telegraph, box);
    // 극성(polarity)의 두 번째 존. `telegraph`가 흩어짐, `telegraph2`가
    // 모임이다 — 둘이 같은 도화선으로 같이 뜨고 같이 터진다(battle.ts).
    if (c.telegraph2) drawOneTelegraph(ctx, L, c.telegraph2, box);
  }
  // 순차 스윕(sweep) 대기열. 특정 보스의 telegraph가 아니라 battle.ts의
  // 별도 배열이라(creepZones와 같은 이유) 위 루프엔 안 걸린다. 길이는 항상
  // 0 또는 1이라 이 자리에서 그냥 그려도 다른 예고와 겹쳐 그려질 일이 없다.
  for (const z of sweepZones) drawOneTelegraph(ctx, L, z, box);
}

/**
 * 상주 장판(creep). `drawOneTelegraph`의 circle 분기와 같은 기하를 쓰되
 * **맥동**을 더해 "발동 중인 예고"가 아니라 "눌러앉은 위협"으로 읽히게 한다 —
 * 그리기 로직 자체를 복제하지 않고, `fill` 대신 `pulse`로 채도만 흔든다.
 */
function drawCreepZones(ctx: CanvasRenderingContext2D, L: Layout, zones: readonly CreepZone[]): void {
  if (zones.length === 0) return;
  const box = telegraphClipBox(L);
  const pitch = L.cell + L.gap;
  const hue = "255,63,110";
  const pulse = motionPulse(260);

  for (const z of zones) {
    const origin = fieldToScreen(L, z.fx, z.fy);
    const r = z.arg * pitch;

    ctx.save();
    ctx.beginPath();
    ctx.rect(box.x0 - box.m, box.y0 - box.m, box.x1 - box.x0 + box.m * 2, box.y1 - box.y0 + box.m * 2);
    ctx.clip();
    ctx.lineJoin = "round";

    ctx.beginPath();
    ctx.arc(origin.x, origin.y, r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${hue},${0.14 + pulse * 0.1})`;
    ctx.fill();
    ctx.strokeStyle = `rgba(${hue},${0.55 + pulse * 0.35})`;
    ctx.lineWidth = 2.4 + pulse * 1.6;
    ctx.stroke();
    ctx.save();
    ctx.clip();
    hatch(ctx, origin.x - r, origin.y - r, r * 2, r * 2, hue, 0.4 + pulse * 0.2);
    ctx.restore();

    // 다음 성장 틱까지 남은 시간. 안쪽에서 차오르다 다 차면 자란다 —
    // 예고의 "차오르면 터진다"와 같은 문법이라 따로 안 배워도 읽힌다.
    const tickFill = 1 - Math.max(0, z.fuse) / z.fuseMax;
    ctx.beginPath();
    ctx.arc(origin.x, origin.y, r * 0.94, 0, Math.PI * 2 * tickFill);
    ctx.strokeStyle = `rgba(255,255,255,${0.3 + pulse * 0.25})`;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }
}

/**
 * 판은 씬 위에 얹히는 반투명 슬랩이다.
 *
 * 불투명하게 채우면 씬이 판 뒤에서만 보여서 액자 속 그림이 된다. 비쳐 보이게
 * 두면 판이 그 무대 **위에** 놓인 것으로 읽히고, 동시에 어둡게 눌러 두므로
 * 판 위의 고양이와 예고는 그대로 또렷하다.
 */
function drawArena(ctx: CanvasRenderingContext2D, L: Layout): void {
  const r = arenaBox(L);
  roundRect(ctx, r, L.cell * 0.22);
  ctx.fillStyle = "rgba(20,13,10,0.62)";
  ctx.fill();
  ctx.strokeStyle = T.floorEdge;
  ctx.lineWidth = 1;
  ctx.stroke();
}

/* ------------------------------------------------------------------ */
/* 상단 HUD                                                             */
/* ------------------------------------------------------------------ */

/**
 * 캡션 위, 숫자 아래. 자원은 글자가 아니라 숫자로 읽힌다.
 *
 * `icon`을 주면 숫자 왼쪽에 그림이 붙는다. 생선은 이 게임에서 유일한 자원이고
 * 카드 비용·리롤 비용·보상까지 전부 같은 단위인데, 화면에서는 그때그때 다른
 * 파란 숫자로만 나타나 같은 물건인 줄 알기 어려웠다. 그림이 그 셋을 묶는다.
 */
function hudChip(
  ctx: CanvasRenderingContext2D,
  box: Rect,
  caption: string,
  value: string,
  color: string,
  align: "left" | "center" | "right",
  icon = false,
): void {
  /**
   * HUD 글자를 키웠다.
   *
   * 크기를 `min(화면폭, 화면높이)`에서 뽑는 값들이라 큰 화면일수록 **판 안에서**
   * 상대적으로 작아졌다. 1669x925에서 캡션이 9px, 생선 그림이 18px이라
   * 자원이 자원으로 안 읽혔다. 자원은 매 걸음 보는 숫자라 한눈에 들어와야 한다.
   */
  const cap = Math.max(11, box.h * 0.30);
  const px = Math.max(3, Math.round(box.h * 0.075));
  const valueY = box.y + box.h * 0.70;
  const iconSize = box.h * 0.62;
  // 그림이 붙으면 숫자와 그림을 합친 덩어리가 정렬 기준을 따라야 한다.
  // 숫자만 정렬하면 가운데 정렬에서 덩어리가 그림 폭만큼 왼쪽으로 밀린다.
  // 그림과 숫자 사이 간격. 0.78이면 붙어 보여서 한 덩어리로 안 읽혔다.
  const gap = icon ? iconSize * 1.15 : 0;
  const anchor =
    align === "left"
      ? box.x
      : align === "right"
        ? box.x + box.w
        : box.x + box.w / 2;
  const x = align === "left" ? anchor + gap : align === "right" ? anchor : anchor + gap / 2;

  uiText(ctx, caption, anchor, box.y + box.h * 0.26, cap, T.muted, {
    align,
    weight: 700,
  });
  numText(ctx, value, x, valueY, px, color, align, false);

  if (icon) {
    const numW = numTextWidth(ctx, value, px);
    // 숫자 덩어리의 왼쪽 끝을 구해 거기서 한 칸 더 왼쪽에 놓는다.
    const numLeft = align === "left" ? x : align === "right" ? x - numW : x - numW / 2;
    drawFish(ctx, numLeft - gap * 0.62, valueY, iconSize, color);
  }
}

/**
 * 생선 카운터 롤업.
 *
 * 값이 바뀐 순간 스냅하면 "얼마나 늘었는지"가 안 보인다 — 보스 처치처럼
 * 한 번에 크게 뛰는 순간일수록 스냅이 더 어색하다. `chipTrail`(보스
 * 체력바)과 같은 이유로 모듈 전역에 둔다. 프레임 사이에 이어져야
 * 굴러가는 것으로 보인다.
 */
let goldShown = -1; // -1은 "아직 첫 프레임을 못 봤다"는 뜻. 첫 프레임부터 굴리면 0에서 시작 생선까지 굴러가는 이상한 그림이 된다.
let goldFrom = 0;
let goldTo = 0;
let goldStartedAt = 0;
const GOLD_ROLLUP_MS = 420;

interface GoldPop {
  amount: number;
  startedAt: number;
}
const goldPops: GoldPop[] = [];
const GOLD_POP_MS = 900;

/** 매 프레임 실제 값과 견줘 롤업을 다시 걸고, 늘었으면 뜨는 글자를 하나 더한다. */
function trackGold(gold: number): void {
  if (reducedMotion()) {
    goldShown = gold;
    goldFrom = gold;
    goldTo = gold;
    goldPops.length = 0;
    return;
  }
  if (goldShown < 0) {
    goldShown = gold;
    goldFrom = gold;
    goldTo = gold;
    return;
  }
  if (gold === goldTo) return;
  if (gold > goldTo) {
    goldPops.push({ amount: gold - goldTo, startedAt: performance.now() });
    if (goldPops.length > 6) goldPops.shift();
  }
  goldFrom = goldShown;
  goldTo = gold;
  goldStartedAt = performance.now();
}

/** 지금 화면에 보일 값. ease-out으로 목표를 향해 굴러간다. */
function currentGoldShown(): number {
  if (reducedMotion()) {
    goldShown = goldTo;
    return goldShown;
  }
  const t = Math.min(1, (performance.now() - goldStartedAt) / GOLD_ROLLUP_MS);
  goldShown = Math.round(goldFrom + (goldTo - goldFrom) * easeOutCubic(t));
  return goldShown;
}

/** "+N" 이 카운터 위로 살짝 떠오르며 페이드아웃한다. 생선 그림 대신 숫자만 — 자리가 좁다. */
function drawGoldPops(ctx: CanvasRenderingContext2D, chip: Rect): void {
  if (reducedMotion()) {
    goldPops.length = 0;
    return;
  }
  const now = performance.now();
  for (let i = goldPops.length - 1; i >= 0; i--) {
    const p = goldPops[i]!;
    const t = (now - p.startedAt) / GOLD_POP_MS;
    if (t >= 1) {
      goldPops.splice(i, 1);
      continue;
    }
    const y = chip.y + chip.h * 0.68 - t * chip.h * 1.5;
    const alpha = 1 - t * t;
    ctx.save();
    ctx.globalAlpha = Math.max(0, alpha);
    uiText(ctx, `+${p.amount}`, chip.x + chip.w / 2, y, Math.max(11, chip.h * 0.32), T.fish, {
      align: "center",
      weight: 800,
      outline: true,
    });
    ctx.restore();
  }
}

function drawHud(ctx: CanvasRenderingContext2D, L: Layout, s: RunState): void {
  const r = L.hud;
  const third = r.w / 3;
  hudChip(
    ctx,
    { x: r.x, y: r.y, w: third, h: r.h },
    "깊이",
    String(s.wave),
    T.text,
    "left",
  );

  trackGold(s.gold);
  const goldChip: Rect = { x: r.x + third, y: r.y, w: third, h: r.h };
  hudChip(
    ctx,
    goldChip,
    // 캡션을 비운다. 생선 그림이 곧 이름이라 글자까지 붙이면 같은 말을 두 번 한다.
    "",
    String(currentGoldShown()),
    T.fish,
    "center",
    true,
  );
  drawGoldPops(ctx, goldChip);

  // 판 종류별 잣대 — 오늘의 시드는 그날, 도전은 그 단계의 기록을 보여준다.
  hudChip(
    ctx,
    { x: r.x + third * 2, y: r.y, w: third, h: r.h },
    recordCaption(s),
    s.modeBest > 0 ? String(s.modeBest) : "-",
    T.paperDim,
    "right",
  );
}

/**
 * 음소거 토글.
 *
 * HUD 칩들과 같은 언어로 그린다 — 따로 튀는 위젯을 만들면 게임 화면에
 * 브라우저 UI가 하나 얹힌 것처럼 보인다. 꺼져 있을 때 더 흐리게 두는 이유는
 * **꺼진 상태가 기본으로 보이면 안 되기** 때문이다. 소리가 있다는 걸 모르는
 * 사람이 대부분이므로, 켜져 있을 때 눈에 띄어야 한다.
 */
function drawMute(ctx: CanvasRenderingContext2D, L: Layout, muted: boolean): void {
  const r = L.mute;
  roundRect(ctx, r, r.w * 0.28);
  ctx.fillStyle = "rgba(239,224,198,0.05)";
  ctx.fill();
  ctx.strokeStyle = "rgba(239,224,198,0.10)";
  ctx.lineWidth = 1;
  ctx.stroke();
  drawSpeaker(ctx, r.x + r.w / 2, r.y + r.h / 2, r.w * 0.62, T.text, !muted);
}

/* ------------------------------------------------------------------ */
/* 보드와 고양이                                                        */
/* ------------------------------------------------------------------ */

/**
 * 격자(25칸 × 2진영)는 하이라이트 칸 하나를 빼면 프레임마다 완전히 같다. 그런데 매 프레임
 * roundRect 50개 + fill/stroke 100번을 다시 그렸다 — 전투 프레임의 7~10%였다(2026-08-23 성능
 * 분석). 레이아웃·진영·DPR이 같으면 한 번 구운 그림을 붙이고, 하이라이트 칸만 위에 덧그린다.
 * 노드 하네스는 이 함수를 부르지 않으므로 `document`는 호출 시점에만 만진다.
 */
const boardGridCache = new Map<string, { canvas: HTMLCanvasElement; x: number; y: number; w: number; h: number }>();

function boardGridImage(L: Layout, side: Side): { canvas: HTMLCanvasElement; x: number; y: number; w: number; h: number } | null {
  if (typeof document === "undefined") return null;
  const dpr = Math.min(typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1, 2);
  const first = cellRect(L, side, 0);
  const last = cellRect(L, side, BOARD_SIZE - 1);
  // 선 굵기(1px)가 칸 밖으로 반 픽셀 나가므로 2px 여유를 둔다.
  const pad = 2;
  const x = Math.floor(Math.min(first.x, last.x) - pad);
  const y = Math.floor(Math.min(first.y, last.y) - pad);
  const w = Math.ceil(Math.max(first.x + first.w, last.x + last.w) + pad) - x;
  const h = Math.ceil(Math.max(first.y + first.h, last.y + last.h) + pad) - y;
  const key = `${side}|${x},${y},${w},${h}|${L.cell}|${L.gap}|${dpr}`;
  const hit = boardGridCache.get(key);
  if (hit) return hit;
  // 레이아웃이 자주 바뀌진 않지만(리사이즈·국면 전환) 무한히 쌓이지 않게 한다.
  if (boardGridCache.size > 8) boardGridCache.clear();
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * dpr));
  canvas.height = Math.max(1, Math.round(h * dpr));
  const c = canvas.getContext("2d");
  if (!c) return null;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.translate(-x, -y);
  for (let i = 0; i < BOARD_SIZE; i++) {
    const cr = cellRect(L, side, i);
    roundRect(c, cr, L.cell * 0.16);
    c.fillStyle = "rgba(239,224,198,0.045)";
    c.fill();
    c.strokeStyle = "rgba(239,224,198,0.10)";
    c.lineWidth = 1;
    c.stroke();
  }
  const entry = { canvas, x, y, w, h };
  boardGridCache.set(key, entry);
  return entry;
}

function drawBoard(
  ctx: CanvasRenderingContext2D,
  L: Layout,
  side: Side,
  accent: string,
  highlightCell: number,
): void {
  const grid = boardGridImage(L, side);
  if (grid) {
    ctx.drawImage(grid.canvas, grid.x, grid.y, grid.w, grid.h);
  } else {
    for (let i = 0; i < BOARD_SIZE; i++) {
      const cr = cellRect(L, side, i);
      roundRect(ctx, cr, L.cell * 0.16);
      ctx.fillStyle = "rgba(239,224,198,0.045)";
      ctx.fill();
      ctx.strokeStyle = "rgba(239,224,198,0.10)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
  // 하이라이트 칸은 캐시된 바탕(4.5% 크림) 위에 덧그린다 — 예전엔 그 칸만 13%였으니 엄밀히는
  // 4.5%만큼 더 밝다. 눈으로 구분되지 않는 차이라 캐시를 두 장으로 가르지 않았다(의도).
  if (highlightCell >= 0 && highlightCell < BOARD_SIZE) {
    const cr = cellRect(L, side, highlightCell);
    roundRect(ctx, cr, L.cell * 0.16);
    ctx.fillStyle = "rgba(244,227,193,0.13)";
    ctx.fill();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }
}

/**
 * 고양이 하나. 전투 중에는 셀이 아니라 전장 좌표에 그린다.
 *
 * 돌진 연출은 화면 좌표가 아니라 전장 좌표에서 fx를 살짝 밀어 계산한다.
 * 그래야 가로/세로 어느 방향이든 "적 쪽으로 들이받는" 방향이 저절로 맞는다.
 */
/**
 * 취약 창 표시.
 *
 * 이 창은 "지금 때려라"의 유일한 순간인데 알려 주는 것이 버튼 글자뿐이었다.
 * 판을 보다가 버튼을 봐야 알 수 있으니 실제로 놓친다 — 브라우저에서 돌려 보고
 * 알았다. 레이드에서 버스트 창은 언제나 보스 쪽에 뜬다.
 *
 * 고리 하나로 끝낸다. 남은 시간은 고리가 닳는 것으로 보이고, 사용한 결정타
 * 횟수는 고리의 두께와 맥동 속도로 돌아온다. 다음 행동은 버튼 문구가 말한다.
 *
 * 붉은 예고(나가라)·푸른 예고(들어와라)와 섞이면 안 되므로 색은 금빛이다.
 */
const VULN_HUE = "255,226,74";

/** 결정타를 쓸 때마다 맥동이 빨라져 창에서 쓴 횟수를 화면에 남긴다. */
function vulnerablePulse(cat: Cat, t: number): number {
  if (reducedMotion()) return 0.5;
  const used = BALANCE.vulnerableChargesPerWindow - Math.min(cat.vulnerableCharges, BALANCE.vulnerableChargesPerWindow);
  const speed = 380 - used * 36;
  return 0.5 + 0.5 * Math.sin(t / speed);
}

/**
 * 몸 뒤에 깔리는 맥동.
 *
 * 반경을 스프라이트 안(0.5)으로 묶는 이유는 보스가 판 가장자리 자리에 앉으면
 * 그보다 큰 것은 전부 판을 넘기 때문이다. 예고와 달리 여기는 잘라 주는 경로가
 * 없다. 가장자리 알파가 0이므로 넘더라도 보이지 않는다.
 */
function drawVulnerableGlow(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  cat: Cat,
): void {
  const pulse = vulnerablePulse(cat, performance.now());
  const inner = size * 0.18;
  const outer = size * (0.44 + pulse * 0.06);
  if (!(outer > inner)) return;

  const g = ctx.createRadialGradient(cx, cy, inner, cx, cy, outer);
  g.addColorStop(0, `rgba(${VULN_HUE},${0.26 + pulse * 0.18})`);
  g.addColorStop(1, `rgba(${VULN_HUE},0)`);
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, outer, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();
}

/** 닳아 가는 고리. 12시에서 시계 방향으로 줄어든다. */
function drawVulnerableRing(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  cat: Cat,
): void {
  /**
   * 최종 국면(finalPhase, US-404)의 마지막 취약 창은 킷의 평소 값(서리귀
   * 4500ms)보다 길게 잡는다(`FINAL_VULNERABLE_MS` 5000ms) — 그 창이 열려
   * 있는 동안은 분모를 이 값으로 바꿔야, 열리자마자 고리가 이미 다 찬
   * 것처럼 보이지 않는다.
   */
  const max =
    cat.finalPhase?.stage === "open"
      ? FINAL_VULNERABLE_MS
      : Math.max(1, bossKit(cat.breed.id).vulnerableMs);
  const left = Math.max(0, Math.min(1, cat.vulnerableMs / max));
  const pulse = vulnerablePulse(cat, performance.now());
  // 보스 반경 1.5칸 안으로 묶는다. 스프라이트가 3.15칸에 그려지므로 0.47이 그 선이다.
  const r = size * 0.47;
  const w = Math.max(3, size * 0.05);

  ctx.save();
  ctx.lineCap = "round";
  // 닳은 자리를 어둡게 남긴다. 얼마나 지났는지도 같이 읽힌다.
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(12,8,6,0.5)";
  ctx.lineWidth = w;
  ctx.stroke();

  const from = -Math.PI / 2;
  ctx.beginPath();
  ctx.arc(cx, cy, r, from, from + Math.PI * 2 * left);
  ctx.strokeStyle = `rgba(${VULN_HUE},${0.75 + pulse * 0.25})`;
  const used = BALANCE.vulnerableChargesPerWindow - Math.min(cat.vulnerableCharges, BALANCE.vulnerableChargesPerWindow);
  ctx.lineWidth = w * (1 + used * 0.08);
  ctx.stroke();
  ctx.restore();
}

/** 고양이 몸 크기. 반경 있는 것(보스·저격수)은 셀 격자를 벗어나 크게 그린다. */
/**
 * 스테이지 색조를 입힌 스프라이트를 만드는 재사용 버퍼.
 *
 * 메인 캔버스에서 `source-atop`을 걸면 안 된다 — 그 합성이 자르는 것은
 * 스프라이트의 알파가 아니라 **목적지 캔버스의 알파**인데, 배경이 이미
 * 불투명하게 깔려 있어 자를 경계가 없다. 실제로 색조가 고양이 모양이 아니라
 * 26×26 사각형 통째로 찍혔다(리뷰 실측 Δ99). 알파가 실루엣과 일치하는 곳은
 * 이 오프스크린 버퍼 안뿐이다.
 */
let tintBuf: HTMLCanvasElement | null = null;

function tintedSprite(frame: SpriteFrame, tint: string): CanvasImageSource {
  const w = SPRITE_CROP.w;
  const h = SPRITE_CROP.h;
  if (!tintBuf) {
    tintBuf = document.createElement("canvas");
    tintBuf.width = w;
    tintBuf.height = h;
  }
  const g = tintBuf.getContext("2d")!;
  g.clearRect(0, 0, w, h);
  g.drawImage(frame.image, frame.sx, frame.sy, frame.sw, frame.sh, 0, 0, w, h);
  g.save();
  g.globalCompositeOperation = "source-atop";
  // 균일 α0.4는 명암을 6할로 눌러 무늬가 죽는다(recolor-sprites.py가 지키는
  // "밝기 순서 보존"의 반대). 0.28이면 색 기운은 남고 줄무늬·눈이 산다.
  g.globalAlpha = 0.28;
  g.fillStyle = tint;
  g.fillRect(0, 0, w, h);
  g.restore();
  return tintBuf;
}

/** atlas crop과 원본 197px 여백 보정을 모든 렌더 경로에 똑같이 적용한다. */
function drawSpriteFrame(
  ctx: CanvasRenderingContext2D,
  frame: SpriteFrame,
  x: number,
  y: number,
  size: number,
  croppedSource?: CanvasImageSource,
): void {
  const { dx, dy, dw, dh } = spriteDrawRect(x, y, size);
  if (croppedSource) {
    ctx.drawImage(croppedSource, 0, 0, SPRITE_CROP.w, SPRITE_CROP.h, dx, dy, dw, dh);
  } else {
    ctx.drawImage(frame.image, frame.sx, frame.sy, frame.sw, frame.sh, dx, dy, dw, dh);
  }
}

/** atlas가 없어도 전장·카드·드래그에서 고양이임을 잃지 않는 공용 Canvas 폴백. */
function drawCatFallback(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
): void {
  if (debugSpriteFallback) spriteFallbackDraws += 1;
  const cx = x + size / 2;
  const cy = y + size * 0.52;
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = "rgba(20,12,10,0.78)";
  ctx.lineWidth = Math.max(1.5, size * 0.035);
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(cx - size * 0.34, cy - size * 0.2);
  ctx.lineTo(cx - size * 0.27, cy - size * 0.46);
  ctx.lineTo(cx - size * 0.08, cy - size * 0.31);
  ctx.lineTo(cx + size * 0.08, cy - size * 0.31);
  ctx.lineTo(cx + size * 0.27, cy - size * 0.46);
  ctx.lineTo(cx + size * 0.34, cy - size * 0.2);
  ctx.bezierCurveTo(cx + size * 0.42, cy + size * 0.18, cx + size * 0.27, cy + size * 0.42, cx, cy + size * 0.42);
  ctx.bezierCurveTo(cx - size * 0.27, cy + size * 0.42, cx - size * 0.42, cy + size * 0.18, cx - size * 0.34, cy - size * 0.2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "rgba(255,245,218,0.92)";
  ctx.beginPath();
  ctx.arc(cx - size * 0.12, cy - size * 0.06, Math.max(1, size * 0.035), 0, Math.PI * 2);
  ctx.arc(cx + size * 0.12, cy - size * 0.06, Math.max(1, size * 0.035), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function catBodySize(L: Layout, radius: number, sizeMul = 1): number {
  const base = radius > 0 ? L.cell * radius * 2.1 : L.cell * CAT_SCALE;
  return base * sizeMul;
}

/**
 * 체력 바의 두께와 윗변. **`drawCat`과 프로브가 같은 식을 쓰게** 따로 뺐다.
 *
 * 바를 머리 위로 올렸을 때 "CAT_SCALE이 0.66이라 셀 안에 들어온다"고 적었는데,
 * 그건 `radius === 0`인 일반 고양이에만 해당한다. 반경 있는 유닛은 몸이
 * `cell * radius * 2.1`이라 훨씬 위로 뜬다 — 저격수(반경 0.85)는 중심에서
 * 1.27칸 위였고, 하필 자리가 적 보드 맨 윗줄이라 세로 배치 일곱 기기 전부에서
 * 보드를 넘어 **안내 문구 띠 위에** 그려졌다. 고양이는 HUD보다 나중에
 * 그려지므로 글자를 덮는다. 그때 근거로 든 `npm run probe`는 카드와 줄바꿈만
 * 볼 뿐 이 기하를 아예 안 봤다 — 주장을 뒷받침하지 않는 근거였다.
 *
 * 그래서 둘을 고친다. 띄우는 거리를 **셀 기준으로 고정**하고, 마지막에 보드
 * 위끝으로 한 번 더 자른다. 그리고 이 함수를 `layout-probe`가 직접 불러
 * 기기별로 넘치는지 잰다 — 이제 주장과 근거가 같은 코드를 가리킨다.
 */
export function healthBarGeom(
  L: Layout,
  side: Side,
  radius: number,
  cy: number,
  sizeMul = 1,
): { bh: number; by: number } {
  const size = catBodySize(L, radius, sizeMul);
  const bh = Math.max(4, size * 0.15);
  const lift = Math.min(size, L.cell * CAT_SCALE);
  /**
   * 위끝 클램프의 기준은 **자기 진영 보드가 아니라 전장 전체의 최상단**이다.
   *
   * 자기 보드 기준이었을 때: 도적이 적 진영으로 도약하면 몸(cy)은 적 보드에
   * 있는데 클램프가 아군 보드 위끝으로 바를 끌어내려, 체력바가 몸을 안
   * 따라가고 제자리에 남은 것처럼 보였다 — 영상 검수에서 실제로 잡혔다.
   * 이 클램프의 원래 목적은 "안내 문구 띠를 덮지 말라"이고, 그 선은 진영과
   * 무관하게 전장 최상단 하나다. side 파라미터는 프로브 호출부와의 계약
   * 때문에 남긴다.
   */
  void side;
  const topLimit = Math.min(L.allyBoard.y, L.enemyBoard.y);
  const by = Math.max(topLimit + 1, cy - size * 0.5 - bh - Math.max(2, lift * 0.06));
  return { bh, by };
}

function drawCat(
  ctx: CanvasRenderingContext2D,
  L: Layout,
  cat: Cat,
  dimmed: boolean,
  stage: number,
): void {
  const dir = cat.side === "ally" ? 1 : -1;
  const { x: cx, y: cy } = fieldToScreen(
    L,
    cat.fx + dir * 0.22 * cat.lunge,
    cat.fy,
  );

  // 보스는 반경만큼 크게 그린다. 셀 격자에 얽매이지 않고 3x3을 덮는다.
  // 소환수는 sizeMul로 작아진다.
  const size = catBodySize(L, cat.radius, cat.sizeMul);
  const x = cx - size / 2;
  const y = cy - size / 2 - L.cell * 0.03;

  /**
   * 순간이동 페이드. `out`은 옅어지고, `gone`은 안 보이고, `in`은 다시 짙어진다.
   *
   * `gone` 동안은 통째로 그리지 않고 여기서 끝낸다 — 부재는 배틀 상태에서는
   * "그 자리에 도착해 있음"인데(`tickBlink`가 좌표를 이미 옮겨 뒀다), 화면에서는
   * "아직 아무도 없음"이어야 한다. 체력 바만 빈 자리에 떠 있으면 더 어색하므로
   * 몸과 함께 전부 숨긴다 — 자리 표시는 `fxs`의 고리·파티클이 대신한다.
   */
  const blink = cat.blink;
  const blinkFade =
    !blink ? 1
    : blink.phase === "out" ? Math.max(0, Math.min(1, blink.ms / BLINK_OUT_MS))
    : blink.phase === "gone" ? 0
    : Math.max(0, Math.min(1, 1 - blink.ms / BLINK_IN_MS));
  if (blinkFade <= 0.02) return;

  /**
   * 발밑 표식. 그림자이면서 **진영 표시**다.
   *
   * 전에는 검은 타원 하나였다. 그런데 양쪽이 같은 스프라이트를 쓰고 전투가
   * 시작되면 가운데로 뒤섞이므로, 위치도 스프라이트도 진영을 말해 주지 못했다 —
   * 남는 단서가 판 구석의 작은 "우리 편/상대" 글자뿐이었다.
   *
   * 발밑은 언제나 보이고 유닛끼리 겹쳐도 가려지지 않는 자리다. 여기에 진영색을
   * 넣으면 난전 한가운데서도 내 고양이가 어느 것인지 한눈에 갈린다.
   */
  if (cat.alive) {
    const ally = cat.side === "ally";
    const ring = ally ? T.ally : T.enemy;
    ctx.save();
    ctx.globalAlpha = (dimmed ? 0.12 : 0.34) * blinkFade;
    ctx.beginPath();
    ctx.ellipse(cx, cy + size * 0.44, size * 0.32, size * 0.11, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#000";
    ctx.fill();
    ctx.globalAlpha = (dimmed ? 0.2 : 0.85) * blinkFade;
    ctx.beginPath();
    ctx.ellipse(cx, cy + size * 0.44, size * 0.3, size * 0.1, 0, 0, Math.PI * 2);
    ctx.strokeStyle = ring;
    ctx.lineWidth = Math.max(1.5, size * 0.045);
    ctx.stroke();
    // 적은 고리를 점선으로 끊는다. 색을 못 봐도 무늬로 갈린다.
    if (!ally) {
      ctx.globalAlpha = (dimmed ? 0.2 : 0.9) * blinkFade;
      ctx.beginPath();
      ctx.ellipse(cx, cy + size * 0.44, size * 0.3, size * 0.1, 0, -0.5, 0.5);
      ctx.strokeStyle = T.inkDeep;
      ctx.lineWidth = Math.max(1.5, size * 0.05);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 맥동은 몸 뒤, 고리는 몸 위. 순서를 지켜야 보스가 빛 속에 서 있는 것으로 읽힌다.
  if (cat.alive && cat.vulnerableMs > 0) drawVulnerableGlow(ctx, cx, cy, size, cat);

  ctx.save();
  if (!cat.alive) ctx.globalAlpha = 0.32;
  else if (dimmed) ctx.globalAlpha = 0.35;
  // 소환수는 **비쳐 보인다.** 분신은 주인과 같은 그림이라(시트 20장이 이미
  // 소진돼 새 스프라이트가 없다) 크기만으로는 어느 쪽이 진짜인지 안 갈린다.
  // 반투명은 "실체가 덜한 것"으로 곧장 읽히고, 색조를 돌리는 것과 달리
  // 어느 품종인지는 그대로 남는다.
  else if (cat.summon) ctx.globalAlpha = 0.62;
  // 순간이동 페이드는 위 조건과 무관하게 항상 곱한다 — out/in 단계는
  // `cat.alive`가 그대로 true라 위 분기 어느 것도 안 걸릴 수 있다.
  ctx.globalAlpha *= blinkFade;

  const frame = spriteFor(cat.breed.id, cat.pose);
  /**
   * 스테이지 테마의 잔몹 색조 — 버퍼에서 입힌 스프라이트로 바꿔치기한다.
   * 반전·플래시 등 아래 그리기 경로는 그대로 탄다. 보스(radius>0)와
   * 저격수는 뺀다: PRD가 우두머리는 칭호·배너로 못박았고, 보스 사각형은
   * 잔몹의 22.8배 면적이라 색조가 판을 덮는다.
   */
  let tinted: CanvasImageSource | undefined;
  // 저격수는 radius(0.85)로 이미 걸러지지만 id 검사를 겹쳐 둔다 —
  // "공용 미니보스는 스테이지 색을 안 입는다"는 의도가 조건에서 읽히게.
  if (frame && cat.side === "enemy" && cat.radius === 0 && cat.breed.id !== SNIPER_BREED.id) {
    const tint = tintForEnemy(stage, cat.breed.id);
    if (tint) tinted = tintedSprite(frame, tint);
  }
  if (frame) {
    if (cat.flash > 0) ctx.filter = "brightness(2.4) saturate(0.6)";
    if (cat.side === "enemy") {
      // 적은 좌우를 뒤집어 **우리 쪽을 보게** 한다. 양쪽이 같은 방향을 보고
      // 있으면 같은 편이 줄 서 있는 것처럼 읽힌다 — 대치라는 것 자체가 전달되지
      // 않는다.
      //
      // save/restore로 감싼다. setTransform으로 되돌리면 main.ts가 걸어 둔
      // 고해상도 배율까지 지워져서 화면 전체가 깨진다.
      ctx.save();
      ctx.translate(cx * 2, 0);
      ctx.scale(-1, 1);
      drawSpriteFrame(ctx, frame, x, y, size, tinted);
      ctx.restore();
    } else {
      drawSpriteFrame(ctx, frame, x, y, size, tinted);
    }
    // filter 대입은 빈 값("none")이어도 drawImage 단가를 1.6배로 올린다 — 켰을 때만 끈다.
    if (cat.flash > 0) ctx.filter = "none";
  } else {
    drawCatFallback(ctx, x, y, size, cat.side === "ally" ? T.ally : T.enemy);
  }

  ctx.restore();

  if (!cat.alive) return;

  if (cat.vulnerableMs > 0) drawVulnerableRing(ctx, cx, cy, size, cat);

  /**
   * 체력 바 — 셀이 아니라 고양이 크기에 맞추고, **머리 위**에 둔다.
   *
   * 전에는 발밑(cy + size*0.5)에 있었다. 그런데 `drawList`가 y 오름차순으로
   * 그리므로 **앞에 선 고양이가 정확히 그 자리를 덮는다** — 난전이 될수록
   * 뒷줄의 체력이 안 보이고, 하필 발밑 진영 고리와도 겹쳐 둘이 서로를 가렸다.
   * 머리 위는 반대다. 나보다 앞에 선 것은 화면에서 아래에 있으므로 절대
   * 올라오지 않는다. 판에서 유일하게 안 가려지는 자리다.
   *
   * 두께도 올렸다(0.1 → 0.15). 진영을 색으로 말하는 물건이 손톱만 하면
   * 색을 읽기 전에 형체부터 안 보인다.
   */
  const bw = size * 0.88;
  const { bh, by } = healthBarGeom(L, cat.side, cat.radius, cy, cat.sizeMul);
  const bx = cx - bw / 2;
  const frac = Math.max(0, Math.min(1, cat.hp / cat.maxHp));

  roundRect(ctx, { x: bx - 1, y: by - 1, w: bw + 2, h: bh + 2 }, (bh + 2) / 2);
  ctx.fillStyle = "rgba(12,8,6,0.8)";
  ctx.fill();
  roundRect(ctx, { x: bx, y: by, w: Math.max(bh, bw * frac), h: bh }, bh / 2);
  ctx.fillStyle = cat.side === "ally" ? T.ally : T.enemy;
  ctx.fill();

  // 마나 바. 체력 바 바로 아래에 얇게. 가득 차면 스킬이 나간다.
  // 스킬이 없는 고양이(패시브·보스)는 마나가 의미 없으므로 아예 그리지 않는다.
  // **소환수도 같은 사유다.** 주인의 breed를 쓰므로 스킬이 '있는' 것으로
  // 보이지만 발동은 막혀 있다(`battle.ts`의 `!cat.summon`). 그리면 가득 찬
  // 채로 영영 안 나가는 스킬을 준비된 것처럼 보여주게 된다.
  const my = by + bh + 1.5;
  const mh = Math.max(2, bh * 0.62);
  const mfrac =
    cat.breed.skill && !cat.summon
      ? Math.max(0, Math.min(1, cat.mana / cat.manaMax))
      : -1;
  if (mfrac >= 0) {
    roundRect(
      ctx,
      { x: bx - 1, y: my - 1, w: bw + 2, h: mh + 2 },
      (mh + 2) / 2,
    );
    ctx.fillStyle = "rgba(12,8,6,0.8)";
    ctx.fill();
    if (mfrac > 0) {
      roundRect(
        ctx,
        { x: bx, y: my, w: Math.max(mh, bw * mfrac), h: mh },
        mh / 2,
      );
      ctx.fillStyle = mfrac >= 1 ? T.gold : T.mana;
      ctx.fill();
    }
  }

  // 직업 뱃지
  if (size >= 26) {
    const cls = cat.breed.cls;
    const hue = CLASS_COLOR[cls];
    // 뱃지는 몸이 커져도 같이 커지면 안 된다. 보스에서 지름 3배가 되어 화면을 먹었다.
    // 자리는 몸을 따라가되(size) 크기는 일반 고양이 기준(cell)으로 고정한다.
    const rad = Math.min(size, L.cell * CAT_SCALE) * 0.2;
    const bxc = cx + size * 0.44;
    const byc = cy - size * 0.44;
    ctx.beginPath();
    ctx.arc(bxc, byc, rad, 0, Math.PI * 2);
    ctx.fillStyle = T.inkDeep;
    ctx.fill();
    ctx.strokeStyle = hue;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    drawClassIcon(ctx, cls, bxc, byc, rad * 1.35, hue);
  }

  // 상태이상 — 기절·빙결은 머리에 고리, 지속 피해는 아래에 점
  if (cat.stun > 0) {
    ctx.save();
    ctx.strokeStyle = T.ranged;
    ctx.lineWidth = Math.max(1.5, size * 0.05);
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    // 전에는 머리 **위**(-0.56)였는데 체력 바가 그 자리로 올라왔다. 머리에
    // 얹으면 겹치지 않고, 오히려 기절한 머리 위를 도는 고리로 읽힌다.
    ctx.arc(cx, cy - size * 0.28, size * 0.16, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  if (cat.dot) {
    ctx.save();
    ctx.fillStyle = T.melee;
    ctx.beginPath();
    ctx.arc(
      cx - bw / 2 - size * 0.09,
      by + bh / 2,
      Math.max(2, size * 0.055),
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.restore();
  }

  // 스킬 시전 이름표
  if (cat.castFlash > 0) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, cat.castFlash / 400);
    uiText(
      ctx,
      skillName(cat),
      cx,
      cy - size * 0.78,
      Math.max(10, size * 0.2),
      CLASS_COLOR[cat.breed.cls],
      {
        align: "center",
        weight: 800,
        outline: true,
      },
    );
    ctx.restore();
  }

  // 레벨은 스프라이트 무늬에 묻히지 않게 뱃지 위에 얹는다.
  if (cat.level > 1 && size >= 30) {
    const rad = size * 0.2;
    const lx = cx - size * 0.44;
    const ly = cy - size * 0.44;
    ctx.beginPath();
    ctx.arc(lx, ly, rad, 0, Math.PI * 2);
    ctx.fillStyle = T.inkDeep;
    ctx.fill();
    ctx.strokeStyle = T.gold;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    numText(
      ctx,
      String(cat.level),
      lx,
      ly,
      Math.max(1, rad * 0.24),
      T.gold,
      "center",
      false,
    );
  }
}

/** `targetRef`가 가리키는 아군을 찾는다. 진짜 고양이와 소환수 양쪽에 있을 수 있다. */
function findAllyByUid(s: RunState, uid: string): Cat | undefined {
  for (const c of s.ally) if (c && c.uid === uid) return c;
  for (const c of s.summons) if (c.uid === uid) return c;
  return undefined;
}

/**
 * 보스가 지금 노리는 대상 머리 위에 표식을 그린다.
 *
 * 보스(반경이 있는 개체)만 그린다 — 일반 적까지 전부 표시하면 화면이
 * 시끄러워진다. `targetRef`는 `pickTarget`이 이번 스텝에 고른 결과를 그대로
 * 옮겨 적은 값이라 판정에는 관여하지 않는다(`battle.ts`) — 지워도 전투 결과는
 * 같다. 색은 진영색(`T.enemy`)을 쓴다 — 판 위 고채도는 위험·모임·취약
 * 셋뿐이라는 원칙(`theme.ts`)을 이 표식도 지켜야 한다.
 */
function drawBossTargetMark(ctx: CanvasRenderingContext2D, L: Layout, s: RunState): void {
  for (const boss of s.enemy) {
    if (!boss || !boss.alive || boss.radius <= 0 || !boss.targetRef) continue;
    // 부재("gone") 중에는 노리는 대상도 없다 — 실제로 아무 것도 안 하고 있다.
    if (boss.blink && boss.blink.phase === "gone") continue;
    const target = findAllyByUid(s, boss.targetRef);
    if (!target || !target.alive) continue;

    const { x: cx, y: cy } = fieldToScreen(L, target.fx, target.fy);
    const { bh, by } = healthBarGeom(L, target.side, target.radius, cy, target.sizeMul);
    const w = Math.max(6, bh * 1.6);
    const my = by - bh * 1.6;

    ctx.save();
    ctx.strokeStyle = T.enemy;
    ctx.lineWidth = Math.max(1.5, bh * 0.5);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(cx - w, my + w * 0.7);
    ctx.lineTo(cx, my);
    ctx.lineTo(cx + w, my + w * 0.7);
    ctx.stroke();
    ctx.restore();
  }
}

/**
 * 표식(seize, US-403) 마커 — 표식이 걸린 아군 머리 위에 그린다.
 *
 * `cat.seized`는 battle.ts가 판정에만 쓰는 상태이고(`fireTelegraph`의 seize
 * 분기가 도화선이 다 되는 순간 1회 판정한다), 이 함수를 지워도 전투 결과는
 * 같다. 구원 원 자체는 새로 그리지 않는다 — 여느 gather 원과 같은 `Telegraph`
 * 라 `drawTelegraphs`가 이미 그린다. 여기서는 "누가 표식됐는지"만 얹는다.
 *
 * 보스 표적 표식(위 함수)과 헷갈리지 않도록 **아래를 가리키는** 역삼각형으로
 * 그린다 — "위에서 찍혔다"는 방향이 그대로 읽힌다. 색은 새 신호를 안 만들고
 * `T.danger`를 재사용한다(theme.ts: 판 위 고채도는 위험·모임·취약 셋뿐이라는
 * 원칙) — 표식된 몸이 실제로 위험에 처해 있다는 뜻과도 맞는다.
 */
function drawSeizeMark(ctx: CanvasRenderingContext2D, L: Layout, s: RunState): void {
  const marked: Cat[] = [];
  for (const c of s.ally) if (c && c.alive && c.seized) marked.push(c);
  for (const c of s.summons) if (c.alive && c.seized) marked.push(c);
  if (marked.length === 0) return;

  const pulse = motionPulse(160);
  for (const c of marked) {
    const { x: cx, y: cy } = fieldToScreen(L, c.fx, c.fy);
    const { bh, by } = healthBarGeom(L, c.side, c.radius, cy, c.sizeMul);
    const w = Math.max(6, bh * 1.6);
    const my = by - bh * 1.6;

    ctx.save();
    ctx.strokeStyle = `rgba(255,63,110,${0.7 + pulse * 0.3})`;
    ctx.lineWidth = Math.max(1.5, bh * 0.5);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(cx - w, my);
    ctx.lineTo(cx, my + w * 0.7);
    ctx.lineTo(cx + w, my);
    ctx.stroke();
    ctx.restore();
  }
}

/**
 * 스킬 연출. 종류마다 그리는 방식이 다르다 — 무엇이 터졌는지 색과 모양으로 읽힌다.
 * 판정과 완전히 분리돼 있어서 이 함수를 지워도 전투 결과는 같다.
 */
/* ------------------------------------------------------------------ */
/* 연출 — 두 겹                                                         */
/* ------------------------------------------------------------------ */

/**
 * 연출을 두 겹으로 나눈다.
 *
 * - **벡터 겹**은 범위·방향·시간을 말한다. 플레이어가 판단에 쓰는 정보라서
 *   스킬당 하나둘이면 충분하고, 셋을 넘으면 무엇이 범위인지 모르게 된다.
 * - **파티클 겹**은 무게·재질·잔향을 말한다. 판단에는 안 쓰이지만 타격이
 *   타격으로 느껴지게 하는 것이 이쪽이다.
 *
 * 벡터가 문제였던 게 아니라 **어디에 그렸느냐**가 문제였다. 최종 해상도에
 * `arc`를 그리면 안티에일리어싱된 회색 테두리가 생겨서 고양이만 픽셀이고
 * 이펙트는 다른 그림이 된다. 같은 `arc`를 파티클과 같은 저해상도 버퍼에 그리고
 * 통째로 확대하면 계단진 원이 된다 — 코드는 거의 그대로고 그리는 대상만 바뀐다.
 *
 * 부수 효과로 더 싸다. 화면의 1/3 해상도라 픽셀 수가 9분의 1이다.
 *
 * 히트스톱과 화면 흔들림은 넣지 않았다. 히트스톱은 시뮬 타이밍을 건드려
 * 헤드리스 파리티가 깨지고, 흔들림은 판 전체를 움직이므로 예고를 읽는 데
 * 방해가 되는지 측정하기 전에는 넣을 수 없다.
 */
const FX_PIXEL = 3;

let fxBuf: HTMLCanvasElement | null = null;
let fxCtx: CanvasRenderingContext2D | null = null;

interface Particle {
  /** 화면 좌표(px). 버퍼 좌표로 두면 창 크기가 바뀔 때 전부 어긋난다. */
  x: number;
  y: number;
  vx: number;
  vy: number;
  g: number;
  life: number;
  max: number;
  size: number;
  ramp: readonly string[];
  /**
   * 램프 단계 어긋남(0~1).
   *
   * 이게 없으면 한 번에 뿌린 파티클이 **전부 같은 속도로 늙어** 한 순간에는
   * 한 색만 보인다. 램프가 3단이어도 화면에는 단색으로 나온다.
   * 조각마다 단계를 조금씩 밀어 세 색이 늘 같이 보이게 한다.
   */
  jit: number;
}

const particles: Particle[] = [];
/** 이미 파티클을 뿌린 연출. Fx는 렌더러가 소유하지 않으므로 신원으로 기억한다. */
const seeded = new WeakSet<object>();
let fxLast = 0;

/**
 * 색 램프.
 *
 * 알파 페이드 대신 색이 식는다 — 흰빛에서 제 색으로, 다시 어둡게. 연속 투명도는
 * 픽셀 아트에 없는 것이라 그것만으로도 다른 그림처럼 보인다. 벡터 겹의 색에서
 * 자동으로 뽑으므로 두 겹이 어긋날 수 없다.
 */
const rampCache = new Map<string, readonly string[]>();

function hexToRgb(h: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}
function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;
}
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const R = r / 255, G = g / 255, B = b / 255;
  const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
  const l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const sat = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h: number;
  if (mx === R) h = ((G - B) / d + (G < B ? 6 : 0)) / 6;
  else if (mx === G) h = ((B - R) / d + 2) / 6;
  else h = ((R - G) / d + 4) / 6;
  return [h * 360, sat, l];
}
function hslToHex(h: number, s: number, l: number): string {
  const H = ((h % 360) + 360) % 360 / 360;
  if (s === 0) { const v = l * 255; return rgbToHex(v, v, v); }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t0: number): number => {
    let t = t0;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return rgbToHex(f(H + 1 / 3) * 255, f(H) * 255, f(H - 1 / 3) * 255);
}

/** 색상환에서 target 쪽으로 짧은 길을 따라 amount도 만큼 돌린다. */
function towardHue(h: number, target: number, amount: number): number {
  let d = ((target - h + 540) % 360) - 180;
  d = Math.max(-amount, Math.min(amount, d));
  return h + d;
}

/**
 * 색 램프 — **색상 이동(hue shift)**으로 3단을 만든다.
 *
 * 예전에는 `흰색 → 제 색 → 검정`이었다. 3단이긴 했는데 밝은 쪽이 순백이라
 * 채도가 통째로 날아가고 어두운 쪽은 그냥 탁해졌다. 밝기만 움직이면 같은 색의
 * 명암 계단이 되지 입체가 안 생긴다.
 *
 * 픽셀 아트가 쓰는 방식은 **밝은 쪽을 빛의 색으로, 어두운 쪽을 그늘의 색으로**
 * 트는 것이다. 여기서 빛은 골목의 가로등(따뜻한 노랑 45°), 그늘은 밤하늘
 * (차가운 파랑 245°)이다. 배경이 실제로 그 두 색이라 파티클이 장면에 앉는다.
 *
 * 채도는 양끝에서 오히려 **올린다.** 밝게 하면서 채도를 두면 물감이 물에
 * 풀린 것처럼 보이는데, 픽셀 아트의 하이라이트는 색이 옅어지는 게 아니라
 * 더 진해지면서 밝아진다.
 */
function rampFor(color: string): readonly string[] {
  let r = rampCache.get(color);
  if (!r) {
    const [cr, cg, cb] = hexToRgb(color);
    const [h, sat, l] = rgbToHsl(cr, cg, cb);
    // 같은 색의 3단이다. 노랑이면 연한 노랑 · 노랑 · 진한 노랑.
    // 색상은 아주 조금만(6~8도) 튼다 — 완전히 같은 색상으로 밝기만 바꾸면
    // 회색을 섞은 것처럼 보이고, 크게 틀면 다른 색이 된다.
    const hi = hslToHex(towardHue(h, 45, 7), Math.min(1, sat * 1.05 + 0.04), Math.min(0.9, l + 0.2));
    const lo = hslToHex(towardHue(h, 245, 9), Math.min(1, sat * 1.1 + 0.06), Math.max(0.12, l - 0.22));
    r = [hi, color, lo];
    rampCache.set(color, r);
  }
  return r;
}

/** 램프의 밝은 칸·어두운 칸. 벡터 겹이 테두리를 세울 때 쓴다. */
export function rampHi(color: string): string {
  return rampFor(color)[0]!;
}
export function rampLo(color: string): string {
  return rampFor(color)[2]!;
}

/** 각 연출이 뿌리는 파티클. 개수와 방향이 곧 그 스킬의 무게다. */
function seed(f: Fx, x: number, y: number, cell: number): void {
  const ramp = rampFor(f.color);
  const u = cell * 0.02; // 셀 크기에 비례한 속도 단위. 화면이 커도 같게 보인다.
  const push = (n: number, make: (i: number) => Omit<Particle, "ramp" | "jit">): void => {
    for (let i = 0; i < n; i++) particles.push({ ...make(i), ramp, jit: Math.random() * 0.9 });
  };
  const rnd = (a: number, b: number): number => a + Math.random() * (b - a);

  switch (f.kind) {
    case "ring":
      // 넓게 퍼지는 한 방. 바깥으로 고르게 밀린다.
      push(22, (i) => {
        const a = (Math.PI * 2 * i) / 22 + rnd(-0.2, 0.2);
        const sp = rnd(0.7, 1.9) * u;
        return { x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.6, g: u * 0.05, life: 430, max: 430, size: i % 3 ? 1 : 2 };
      });
      break;
    case "frost":
      // 육각 방향으로만 뻗는다. 원이 아니라 결정이라는 것이 방향에서 읽힌다.
      push(24, (i) => {
        const a = (Math.PI * 2 * (i % 6)) / 6 + (i < 12 ? 0 : Math.PI / 6);
        const sp = (0.5 + (i / 24) * 1.3) * u;
        return { x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.7, g: u * 0.03, life: 520, max: 520, size: i % 3 ? 1 : 2 };
      });
      break;
    case "streak":
    case "beam":
      // 방향이 있는 것은 그 방향으로 흐른다.
      push(16, () => {
        const a = Math.atan2(f.ty - f.fy, f.tx - f.fx) + rnd(-0.25, 0.25);
        const sp = rnd(1.0, 2.4) * u;
        return { x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 0, life: 330, max: 330, size: 1 };
      });
      break;
    case "slash":
      push(14, (i) => {
        const a = f.angle + (i / 14) * 1.4;
        const sp = rnd(0.8, 1.6) * u;
        return { x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.55, g: u * 0.06, life: 380, max: 380, size: i % 2 ? 1 : 2 };
      });
      break;
    case "ember":
      // 위로만. 중력이 음수라 떠오른다.
      push(3, () => ({ x: x + rnd(-cell * 0.2, cell * 0.2), y, vx: rnd(-0.1, 0.1) * u, vy: rnd(-0.7, -0.3) * u, g: -u * 0.01, life: 620, max: 620, size: 1 }));
      break;
    case "spark":
      push(8, (i) => {
        const a = (Math.PI * 2 * i) / 8 + rnd(-0.3, 0.3);
        const sp = rnd(0.5, 1.3) * u;
        return { x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - u * 0.3, g: u * 0.09, life: 280, max: 280, size: 1 };
      });
      break;
    case "burst":
      // 장판 전체가 번쩍이는 순간의 잔불. 짧고 굵게 튄다 — 오래 남으면 벡터
      // 겹이 이미 사라진 뒤에도 그 자리가 위험해 보인다.
      push(10, (i) => {
        const a = (Math.PI * 2 * i) / 10 + rnd(-0.25, 0.25);
        const sp = rnd(0.5, 1.4) * u;
        return { x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.6, g: u * 0.06, life: 300, max: 300, size: i % 2 ? 1 : 2 };
      });
      break;
    case "bossdeath":
      // 확장 링 3겹과 같이 퍼지는 굵은 파편. 보스 처치가 지금까지 중 가장
      // 무거운 사건이므로 파티클도 이 게임에서 가장 크게 뿌린다.
      push(30, (i) => {
        const a = (Math.PI * 2 * i) / 30 + rnd(-0.15, 0.15);
        const sp = rnd(1.0, 2.6) * u;
        return { x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.65, g: u * 0.05, life: 620, max: 620, size: i % 3 ? 1 : 2 };
      });
      break;
    case "phaseShift":
      // 죽음보다 짧고 빠르게 튀겨야 한다. 같은 파편을 쓰면 페이즈 전환도
      // 처치처럼 읽히므로, 위험이 안쪽에서 바깥으로 번지는 모양을 강조한다.
      push(26, (i) => {
        const a = (Math.PI * 2 * i) / 26 + rnd(-0.12, 0.12);
        const sp = rnd(1.4, 3.0) * u;
        return { x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.7, g: u * 0.04, life: 480, max: 480, size: i % 3 ? 1 : 2 };
      });
      break;
  }
  // 한 프레임에 스킬이 여럿 터져도 상한을 넘지 않게 한다.
  if (particles.length > 520) particles.splice(0, particles.length - 520);
}

function stepParticles(dt: number): void {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i]!;
    p.life -= dt;
    if (p.life <= 0) {
      particles.splice(i, 1);
      continue;
    }
    p.vy += p.g * dt * 0.06;
    p.x += p.vx * dt * 0.06;
    p.y += p.vy * dt * 0.06;
  }
}

function drawFx(ctx: CanvasRenderingContext2D, L: Layout): void {
  const now = performance.now();
  const dt = Math.min(48, fxLast ? now - fxLast : 16);
  fxLast = now;
  const reduce = reducedMotion();

  const bw = Math.max(8, Math.round(L.w / FX_PIXEL));
  const bh = Math.max(8, Math.round(L.h / FX_PIXEL));
  if (!fxBuf || fxBuf.width !== bw || fxBuf.height !== bh) {
    fxBuf = document.createElement("canvas");
    fxBuf.width = bw;
    fxBuf.height = bh;
    fxCtx = fxBuf.getContext("2d");
  }
  const b = fxCtx;
  if (!b) return;
  b.setTransform(1, 0, 0, 1, 0, 0);
  b.clearRect(0, 0, bw, bh);
  b.imageSmoothingEnabled = false;

  // 새로 뜬 연출에만 파티클을 뿌린다. Fx는 매 프레임 같은 객체로 남아 있다.
  for (const f of fxs) {
    if (seeded.has(f)) continue;
    seeded.add(f);
    if (!reduce) {
      const p = fieldToScreen(L, f.fx, f.fy);
      seed(f, p.x, p.y, L.cell);
    }
  }
  if (reduce) particles.length = 0;
  else stepParticles(dt);

  drawFxVectors(b, L);

  // 파티클 — 하나가 fillRect 한 번이다. 알파 대신 색 램프로 식는다.
  if (!reduce) {
    for (const p of particles) {
      const k = 1 - p.life / p.max;
      const col = p.ramp[Math.min(p.ramp.length - 1, Math.floor(k * p.ramp.length + p.jit))]!;
      b.fillStyle = col;
      b.fillRect(Math.round(p.x / FX_PIXEL), Math.round(p.y / FX_PIXEL), p.size, p.size);
    }
  }

  const prev = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(fxBuf, 0, 0, L.w, L.h);
  ctx.imageSmoothingEnabled = prev;
}

/** 벡터 겹. 좌표와 굵기를 전부 버퍼 배율로 줄여서 저해상도에 그린다. */
/** 투명도를 네 단계로 계단진다. 연속 페이드는 픽셀 아트에 없는 것이다. */
function qa(a: number): number {
  return Math.max(0, Math.ceil(Math.min(1, a) * 4) / 4);
}

function drawFxVectors(ctx: CanvasRenderingContext2D, L: Layout): void {
  const S = 1 / FX_PIXEL;
  const pitch = (L.cell + L.gap) * S;

  for (const f of fxs) {
    const t = 1 - f.life / f.maxLife; // 0 → 1
    const raw = fieldToScreen(L, f.fx, f.fy);
    const p = { x: raw.x * S, y: raw.y * S };
    ctx.save();
    ctx.lineJoin = "miter";
    ctx.lineCap = "butt";

    switch (f.kind) {
      case "ring": {
        ctx.globalAlpha = qa(0.85 * (1 - t) ** 1.4);
        ctx.strokeStyle = f.color;
        ctx.lineWidth = Math.max(1, L.cell * 0.09 * (1 - t * 0.6) * S);
        ctx.beginPath();
        ctx.arc(p.x, p.y, f.radius * pitch * (0.25 + t * 0.85), 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
      case "slash": {
        // 짧은 호가 바깥으로 퍼지며 사라진다
        ctx.globalAlpha = qa(0.95 * (1 - t));
        ctx.strokeStyle = f.color;
        ctx.lineWidth = Math.max(1, L.cell * 0.075 * S);
        const rr = f.radius * pitch * (0.35 + t * 0.55);
        const a0 = f.angle + t * 1.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, rr, a0, a0 + 0.85);
        ctx.stroke();
        break;
      }
      case "beam": {
        const raw2 = fieldToScreen(L, f.tx, f.ty);
        const q = { x: raw2.x * S, y: raw2.y * S };
        ctx.globalAlpha = qa(0.9 * (1 - t) ** 0.7);
        ctx.strokeStyle = f.color;
        ctx.lineWidth = Math.max(1, f.radius * pitch * (1 - t * 0.5));
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(q.x, q.y);
        ctx.stroke();
        break;
      }
      case "streak": {
        // 시작점에서 목표까지 순식간에 지나간 자국
        const raw2 = fieldToScreen(L, f.tx, f.ty);
        const q = { x: raw2.x * S, y: raw2.y * S };
        const head = {
          x: p.x + (q.x - p.x) * Math.min(1, t * 1.8),
          y: p.y + (q.y - p.y) * Math.min(1, t * 1.8),
        };
        ctx.globalAlpha = qa(0.9 * (1 - t));
        ctx.strokeStyle = f.color;
        ctx.lineWidth = Math.max(1, L.cell * 0.1 * S);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(head.x, head.y);
        ctx.stroke();
        break;
      }
      case "spark": {
        // 네 갈래로 튀는 짧은 선
        ctx.globalAlpha = qa(1 - t);
        ctx.strokeStyle = f.color;
        ctx.lineWidth = Math.max(1, L.cell * 0.045 * S);
        const len = f.radius * pitch * (0.25 + t * 0.5);
        for (let i = 0; i < 4; i++) {
          const a = f.angle + (Math.PI / 2) * i;
          ctx.beginPath();
          ctx.moveTo(
            p.x + Math.cos(a) * len * 0.4,
            p.y + Math.sin(a) * len * 0.4,
          );
          ctx.lineTo(p.x + Math.cos(a) * len, p.y + Math.sin(a) * len);
          ctx.stroke();
        }
        break;
      }
      case "ember": {
        // 위로 떠오르며 작아진다
        ctx.globalAlpha = qa(0.9 * (1 - t) ** 1.5);
        ctx.fillStyle = f.color;
        const rise = t * pitch * 0.9;
        ctx.beginPath();
        ctx.arc(
          p.x,
          p.y - rise,
          Math.max(1, f.radius * pitch * (1 - t)),
          0,
          Math.PI * 2,
        );
        ctx.fill();
        break;
      }
      case "frost": {
        // 여섯 갈래 결정. 얼어붙은 대상 위에 오래 남는다
        ctx.globalAlpha = qa(0.8 * (1 - t) ** 0.6);
        ctx.strokeStyle = f.color;
        ctx.lineWidth = Math.max(1, L.cell * 0.04 * S);
        const rr = f.radius * pitch * (0.6 + t * 0.25);
        for (let i = 0; i < 6; i++) {
          const a = f.angle + (Math.PI / 3) * i;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x + Math.cos(a) * rr, p.y + Math.sin(a) * rr);
          ctx.stroke();
        }
        break;
      }
      case "burst": {
        /**
         * 예고 장판과 똑같은 모양을 채워 넣는다 — `drawTelegraphs`가 원형·직선·
         * 부채꼴을 그리는 것과 같은 기하다. 해칭·동심원 같은 무늬는 없다.
         * 이건 판단할 시간이 있는 예고가 아니라 이미 끝난 순간의 섬광이라,
         * 읽을거리가 아니라 한 번 확 채워졌다 빠지면 된다.
         */
        ctx.globalAlpha = qa(0.85 * (1 - t) ** 1.6);
        ctx.fillStyle = f.color;
        const shape = f.shape ?? "circle";
        if (shape === "circle") {
          const r = (f.arg ?? 1) * pitch;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx.fill();
        } else if (shape === "half") {
          // 극성 절반 존의 섬광. drawOneTelegraph의 half 분기와 같은 방식으로
          // 네 모서리를 옮겨 잇는다 — p(=fx,0 지점)는 여기서 쓰지 않는다.
          const dirX = f.dirX ?? 1;
          const nearX = dirX >= 0 ? f.fx : -0.5;
          const farX = dirX >= 0 ? FIELD_MAX_FX + 0.5 : f.fx;
          const corners = [
            fieldToScreen(L, nearX, -0.5),
            fieldToScreen(L, farX, -0.5),
            fieldToScreen(L, farX, BOARD_ROWS - 0.5),
            fieldToScreen(L, nearX, BOARD_ROWS - 0.5),
          ];
          ctx.beginPath();
          ctx.moveTo(corners[0]!.x * S, corners[0]!.y * S);
          for (const cpt of corners.slice(1)) ctx.lineTo(cpt.x * S, cpt.y * S);
          ctx.closePath();
          ctx.fill();
        } else {
          const ang = Math.atan2(f.dirY ?? 0, f.dirX ?? 1);
          const reach = (f.reach ?? 0) * pitch;
          ctx.translate(p.x, p.y);
          ctx.rotate(ang);
          ctx.beginPath();
          if (shape === "line") {
            const half = (f.arg ?? 0.5) * pitch;
            ctx.rect(0, -half, reach, half * 2);
          } else {
            const half = f.arg ?? 0.35;
            ctx.moveTo(0, 0);
            ctx.arc(0, 0, reach, -half, half);
            ctx.closePath();
          }
          ctx.fill();
        }
        break;
      }
      case "bossdeath": {
        // 확장 링 세 겹. 겹마다 시작을 살짝 늦춰(lag) 뒤따라오는 파문으로
        // 보이게 한다 — 동시에 세 개를 그리면 그냥 굵은 원 하나로 뭉쳐 보인다.
        ctx.strokeStyle = f.color;
        for (let k = 0; k < 3; k++) {
          const lag = k * 0.16;
          if (t < lag) continue;
          const kt = Math.min(1, (t - lag) / (1 - lag));
          ctx.globalAlpha = qa(0.85 * (1 - kt) ** 1.2);
          ctx.lineWidth = Math.max(1, L.cell * 0.08 * (1 - kt * 0.5) * S);
          ctx.beginPath();
          ctx.arc(p.x, p.y, (f.radius + 0.7 + k * 1.0) * pitch * (0.15 + kt * 1.1), 0, Math.PI * 2);
          ctx.stroke();
        }
        break;
      }
      case "phaseShift": {
        // 초반의 화면 섬광은 짧게만 남긴다. 전장을 가리는 시간이 길면
        // 새 예고를 읽는 순간을 훼손하므로, 위험을 알리는 한 박자로 제한한다.
        if (t < 0.28) {
          ctx.globalAlpha = qa(0.3 * (1 - t / 0.28));
          ctx.fillStyle = f.color;
          ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        }

        // 죽음의 세 겹 파문과 달리 굵은 한 겹과 짧은 방사선으로 그린다.
        // 보스가 사라지는 것이 아니라 더 위험해졌다는 방향성이 핵심이다.
        ctx.globalAlpha = qa(0.95 * (1 - t) ** 0.8);
        ctx.strokeStyle = f.color;
        ctx.lineWidth = Math.max(1, L.cell * 0.13 * (1 - t * 0.45) * S);
        ctx.beginPath();
        ctx.arc(p.x, p.y, f.radius * pitch * (0.2 + t * 1.45), 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = Math.max(1, L.cell * 0.055 * S);
        const ray = f.radius * pitch * (0.65 + t * 0.7);
        for (let i = 0; i < 8; i++) {
          const a = (Math.PI * 2 * i) / 8 + Math.PI / 8;
          ctx.beginPath();
          ctx.moveTo(p.x + Math.cos(a) * ray * 0.72, p.y + Math.sin(a) * ray * 0.72);
          ctx.lineTo(p.x + Math.cos(a) * ray, p.y + Math.sin(a) * ray);
          ctx.stroke();
        }
        break;
      }
    }
    ctx.restore();
  }
}

/** 원거리 투사체. 피해는 이미 적용됐고 이건 순수 연출이다. */
function drawShots(ctx: CanvasRenderingContext2D, L: Layout): void {
  for (const s of shots) {
    // 모션 축소에서는 궤적을 이동시키지 않고 피격점에 짧게 남긴다.
    const t = reducedMotion() ? 1 : 1 - s.life / SHOT_LIFE_MS;
    const fx = s.fromX + (s.toX - s.fromX) * t;
    const fy = s.fromY + (s.toY - s.fromY) * t;
    const { x, y } = fieldToScreen(L, fx, fy);
    const rad = Math.max(2.5, L.cell * 0.05);
    const color = s.ally ? T.gold : T.enemy;

    const back = fieldToScreen(
      L,
      fx - (s.toX - s.fromX) * 0.14,
      fy - (s.toY - s.fromY) * 0.14,
    );
    ctx.save();
    ctx.globalAlpha = 0.4;
    ctx.strokeStyle = color;
    ctx.lineWidth = rad * 1.2;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(back.x, back.y);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  }
}

function drawPops(ctx: CanvasRenderingContext2D, L: Layout, s: RunState): void {
  const quiet = hazardsActive(s);
  const reduce = reducedMotion();
  for (const p of damagePops) {
    const { x, y } = fieldToScreen(L, p.fx, p.fy);
    const t = 1 - p.life / POP_LIFE_MS;
    ctx.save();
    // 예고가 떠 있는 동안 일반 피해는 뒤로 물린다. 치명타·회복·빗나감은
    // 판단 피드백이라 절반 이상 남기고, 나머지만 크게 낮춘다.
    const important = p.crit || p.heal || p.text === "회피";
    const emphasis = quiet ? (important ? 0.68 : 0.34) : 1;
    const sizeScale = quiet ? (important ? 0.65 : 0.4) : 1;
    ctx.globalAlpha = Math.max(0, 1 - t * t) * emphasis;
    // 같은 프레임에 뜬 숫자는 계단으로 민다. 흩뿌리기로는 셋이 겹치면 여전히
    // `72 61`처럼 붙어 읽혔다. 아래·오른쪽으로 미는 것은 위쪽이 보스와 HUD라서다.
    const ox = x + p.step * L.cell * 0.38;
    const oy = y - L.cell * 0.34 - (reduce ? 0 : t * L.cell * 0.55) + p.step * L.cell * 0.4;
    if (p.text === "회피") {
      uiText(ctx, "빗나감", ox, oy, Math.max(9, L.cell * 0.16) * sizeScale, T.paperDim, {
        align: "center",
        weight: 700,
        outline: true,
      });
    } else {
      // 스킬·치명타만 크고 레몬이다. 판 위에서 레몬이 뜨는 경우는 취약 창과
      // 큰 한 방 둘뿐이라 "지금 뭔가 세게 들어갔다"로 뜻이 통한다.
      numText(
        ctx,
        p.text,
        ox,
        oy,
        Math.max(1, L.cell * (p.crit ? 0.035 : 0.028)) * sizeScale,
        // 회복은 초록. 판 위에서 숫자가 뜨는 것은 늘 깎이는 일이었으므로,
        // 색이 안 갈리면 "+12"도 맞은 것으로 먼저 읽힌다.
        p.heal ? "#8FD9A8" : p.crit ? T.vuln : "#FFFFFF",
        "center",
        true,
        true,
      );
    }
    ctx.restore();
  }
}

/* ------------------------------------------------------------------ */
/* 진영 표시                                                            */
/* ------------------------------------------------------------------ */

/**
 * 진영 라벨을 아레나 바깥 모서리에 붙인다.
 *
 * 예전에는 각 보드 바로 위에 뒀는데, 근접 유닛이 정확히 그 자리로 걸어 나가
 * "상대" 글자를 덮어버렸다. 유닛이 잘 가지 않는 아레나 가장자리로 옮긴다.
 * 방향을 알려주는 보조 표시이므로 크기도 줄여 조용하게 둔다.
 */
function drawSideLabels(ctx: CanvasRenderingContext2D, L: Layout): void {
  const a = arenaBox(L);
  const fs = Math.min(Math.max(9, L.cell * 0.16), L.labelH * 0.8);
  const inset = L.cell * 0.22;
  const put = (
    x: number,
    y: number,
    text: string,
    color: string,
    align: CanvasTextAlign,
  ) => {
    uiText(ctx, text, x, y, fs, color, {
      align,
      weight: 800,
      outline: true,
    });
  };

  if (L.stacked) {
    put(a.x + inset, a.y + fs * 1.1, "상대", T.enemy, "left");
    put(a.x + inset, a.y + a.h - fs * 1.1, "우리 편", T.ally, "left");
  } else {
    put(a.x + inset, a.y + fs * 1.2, "우리 편", T.ally, "left");
    put(a.x + a.w - inset, a.y + fs * 1.2, "상대", T.enemy, "right");
  }
}

function drawDivider(ctx: CanvasRenderingContext2D, L: Layout): void {
  ctx.save();
  ctx.strokeStyle = "rgba(239,224,198,0.09)";
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 7]);
  ctx.beginPath();
  if (L.stacked) {
    const y = Math.round((L.enemyBoard.y + L.enemyBoard.h + L.allyBoard.y) / 2) + 0.5;
    ctx.moveTo(L.allyBoard.x, y);
    ctx.lineTo(L.allyBoard.x + L.allyBoard.w, y);
  } else {
    const x = Math.round((L.allyBoard.x + L.allyBoard.w + L.enemyBoard.x) / 2) + 0.5;
    ctx.moveTo(x, L.allyBoard.y - L.labelH);
    ctx.lineTo(x, L.allyBoard.y + L.allyBoard.h);
  }
  ctx.stroke();
  ctx.restore();

  // 두 보드 사이가 곧 전선이다.
  const cx = L.stacked
    ? L.allyBoard.x + L.allyBoard.w / 2
    : (L.allyBoard.x + L.allyBoard.w + L.enemyBoard.x) / 2;
  const cy = L.stacked
    ? (L.enemyBoard.y + L.enemyBoard.h + L.allyBoard.y) / 2
    : L.allyBoard.y + L.allyBoard.h / 2;
  const rad = Math.max(10, L.cell * 0.15);
  ctx.beginPath();
  ctx.arc(cx, cy, rad, 0, Math.PI * 2);
  ctx.fillStyle = T.inkDeep;
  ctx.fill();
  ctx.strokeStyle = "rgba(239,224,198,0.16)";
  ctx.lineWidth = 1;
  ctx.stroke();
  numText(
    ctx,
    "VS",
    cx,
    cy,
    Math.max(1, rad * 0.2),
    T.muted,
    "center",
    false,
  );
}

/* ------------------------------------------------------------------ */
/* 하단: 팀 상태 / 보상 카드                                            */
/* ------------------------------------------------------------------ */

/** 다시 뽑기 버튼. 카드 머리줄 오른쪽 끝에 둔다. */
export function rerollRect(L: Layout): Rect {
  const r = L.offerCards;
  if (L.columns) {
    /**
     * 세로줄에서는 카드가 줄을 꽉 채우므로 머리줄도 줄 폭을 그대로 쓴다.
     *
     * 높이를 고정값으로 두면 안 된다 — 844×320 같은 납작한 가로에서 머리줄 띠가
     * 44px뿐인데 버튼이 34px+여백을 먹어 안내 문구 위로 2px 올라탔다.
     * **띠에서 비율로 뽑아야** 화면이 줄어도 안 넘친다.
     */
    const top = L.notice.y + L.notice.h;
    const band = Math.max(1, r.y - top);
    const h = Math.max(22, Math.min(34, band * 0.62));
    return { x: r.x, y: r.y - h - band * 0.16, w: r.w, h };
  }
  const h = Math.max(24, Math.min(34, r.h * 0.13));
  const w = Math.max(88, r.w * 0.28);
  return { x: r.x + r.w - w, y: r.y - h - h * 0.34, w, h };
}

/**
 * 슬롯은 늘 세 칸. 하나를 사도 남은 카드가 넓어지지 않는다.
 *
 * 세로줄에서는 위에서 아래로 쌓고, 접힌 구성에서는 가로로 늘어놓는다.
 * **보이는 곳과 눌리는 곳이 이 함수 하나에서 나온다** — 렌더도 히트테스트도
 * 여기만 부른다. 둘을 따로 계산하면 반드시 갈라진다.
 */
export function offerRects(L: Layout, count: number = OFFER_SLOTS): Rect[] {
  const r = L.offerCards;
  const n = Math.max(1, count);
  const gap = L.offerGap;
  if (L.columns) {
    const ch = (r.h - gap * (n - 1)) / n;
    return Array.from({ length: count }, (_, i) => ({
      x: r.x,
      y: r.y + i * (ch + gap),
      w: r.w,
      h: ch,
    }));
  }
  const cw = (r.w - gap * (n - 1)) / n;
  return Array.from({ length: count }, (_, i) => ({
    x: r.x + i * (cw + gap),
    y: r.y,
    w: cw,
    h: r.h,
  }));
}

/**
 * 보상 단계가 아닐 때 카드 자리를 비워 두면 화면 아래가 휑하다.
 * 대신 팀 구성을 보여준다 — 근접/원거리 균형은 배치를 정할 때 실제로 필요한 정보다.
 */
function drawTeamStrip(
  ctx: CanvasRenderingContext2D,
  L: Layout,
  s: RunState,
): void {
  const r = L.offers;
  const cats = livingCats(s.ally);
  // 카운터와 순서 둘 다 `CLASS_LABEL`에서 뽑는다. 손으로 적으면 직업을
  // 늘렸을 때 배열은 타입 검사를 통과하면서 새 직업만 빠진다.
  const counts = zeroByClass();
  for (const c of cats) counts[c.breed.cls] += 1;

  const rows: [string, number, string, IconName | null][] = [
    ...CLASS_ORDER.map(
      (cls) =>
        [CLASS_LABEL[cls], counts[cls], CLASS_COLOR[cls], CLASS_PICTO[cls]] as
          [string, number, string, IconName | null],
    ),
    // 상대는 직업이 아니라 진영이라 아이콘을 안 붙인다. 붙이면 다섯 줄이
    // 같은 종류의 것으로 읽혀 "우리 넷 + 상대"라는 구분이 사라진다.
    ["상대", livingCats(s.enemy).length, T.enemy, null],
  ];

  if (L.columns) {
    /**
     * 세로줄에서는 **한 줄에 하나씩** — 이름 왼쪽, 수 오른쪽.
     *
     * 가로 띠였을 때는 다섯 칸을 나눠 이름 위·수 아래로 쌓았는데, 그 배치가
     * 화면에서 가장 크고 밝은 물건이 되어 판 위의 예고보다 눈에 먼저 들어왔다
     * (design-brief 4-2가 잡은 위계 역전). 옆으로 나오면서 크기를 줄일 수 있다.
     */
    const rowH = r.h / rows.length;
    const fs = Math.max(10, Math.min(15, rowH * 0.42));
    const px = Math.max(1, rowH * 0.062);
    const iconSize = Math.min(rowH * 0.62, r.w * 0.13);
    rows.forEach(([label, n, hue, icon], i) => {
      const cy = r.y + rowH * (i + 0.5);
      // 아이콘이 있으면 글자를 그만큼 민다. 없는 줄(상대)도 같은 자리에서
      // 시작해야 다섯 줄의 글머리가 어긋나지 않는다.
      const textX = r.x + iconSize * 1.35;
      if (icon) drawIcon(ctx, icon, r.x + iconSize * 0.5, cy, iconSize, n > 0 ? hue : T.muted);
      uiText(ctx, label, textX, cy, fs, T.muted, { align: "left", weight: 700 });
      numText(ctx, String(n), r.x + r.w, cy, px, n > 0 ? hue : T.muted, "right", false);
      if (i < rows.length - 1) {
        const y = Math.round(r.y + rowH * (i + 1)) + 0.5;
        ctx.strokeStyle = "rgba(239,224,198,0.07)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(r.x, y);
        ctx.lineTo(r.x + r.w, y);
        ctx.stroke();
      }
    });
    return;
  }

  const cap = Math.max(9, r.h * 0.17);
  const px = Math.max(2, Math.round(r.h * 0.048));
  const cols = rows.length;
  const cw = r.w / cols;

  rows.forEach(([label, n, hue], i) => {
    const cx = r.x + cw * i + cw / 2;
    uiText(ctx, label, cx, r.y + r.h * 0.3, cap, T.muted, {
      align: "center",
      weight: 700,
    });
    numText(ctx, String(n), cx, r.y + r.h * 0.66, px, hue, "center", false);
  });

  ctx.strokeStyle = "rgba(239,224,198,0.08)";
  ctx.lineWidth = 1;
  for (let i = 1; i < cols; i++) {
    const x = Math.round(r.x + cw * i) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, r.y + r.h * 0.22);
    ctx.lineTo(x, r.y + r.h * 0.82);
    ctx.stroke();
  }
}

/** #RRGGBB → rgba(). 팔레트가 hex라 투명도를 얹으려면 한 번 풀어야 한다. */
function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/**
 * 카드 위 고양이는 살아 있어야 한다 — 위아래로 조금 흔들리고 가끔 눈을 깜빡인다.
 * 위상을 품종마다 어긋나게 준다. 셋이 동시에 깜빡이면 살아 있는 게 아니라 기계로 보인다.
 */
function cardIdle(seed: number, t: number): { pose: Pose; bob: number } {
  if (reducedMotion()) return { pose: "idle", bob: 0 };
  const cycle = 2600 + (seed % 5) * 260;
  const p = (t + seed * 430) % cycle;
  return {
    pose: p < 170 ? "wink" : "idle",
    bob: Math.sin((t + seed * 700) / 540),
  };
}

/** 초상 자리. 직업색으로 은은하게 물들이고 그 안에 고양이를 세운다. */
function drawPortraitWell(
  ctx: CanvasRenderingContext2D,
  well: Rect,
  breedId: number,
  seed: number,
  accent: string,
  afford: boolean,
  t: number,
): void {
  // 크기가 0 이하로 들어오면 createRadialGradient가 던지고, 그 예외가 rAF 루프를
  // 끊어 화면이 영구히 굳는다. 안 그리는 편이 낫다.
  if (well.w <= 0 || well.h <= 0) return;

  const rad = Math.min(well.w, well.h) * 0.16;
  roundRect(ctx, well, rad);
  ctx.fillStyle = "rgba(12,8,6,0.5)";
  ctx.fill();

  ctx.save();
  roundRect(ctx, well, rad);
  ctx.clip();
  const cx = well.x + well.w / 2;
  const cy = well.y + well.h * 0.5;
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, well.w * 0.62);
  glow.addColorStop(0, hexA(accent, afford ? 0.3 : 0.1));
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(well.x, well.y, well.w, well.h);

  const { pose, bob } = cardIdle(seed, t);
  const frame = spriteFor(breedId, pose);
  // 0.86인 이유: 흔들림 폭(±sz*0.05)까지 우물 안에 들어와야 발이 잘리지 않는다.
  const sz = Math.min(well.w, well.h) * 0.86;
  if (frame) {
    ctx.globalAlpha = afford ? 1 : 0.45;
    drawSpriteFrame(ctx, frame, cx - sz / 2, cy - sz / 2 + bob * sz * 0.05, sz);
  } else {
    ctx.globalAlpha = afford ? 1 : 0.45;
    drawCatFallback(ctx, cx - sz / 2, cy - sz / 2 + bob * sz * 0.05, sz, accent);
  }
  ctx.restore();

  roundRect(ctx, well, rad);
  ctx.strokeStyle = afford ? hexA(accent, 0.42) : "rgba(239,224,198,0.10)";
  ctx.lineWidth = 1;
  ctx.stroke();
}

/**
 * 값은 카드 모서리의 뱃지로. 어느 카드가 얼마인지 훑어보기 좋다.
 *
 * **원이 아니라 알약이다.** 생선 그림을 넣으면서 바꿨다 — 원 안에 그림과 숫자를
 * 위아래로 쌓아 봤더니 둘 다 절반 크기가 되어 겹쳐 읽혔다(지름이 22px 남짓이라
 * 애초에 두 물건이 들어갈 자리가 아니었다). 가로로 눕히면 둘 다 제 크기로 선다.
 *
 * 오른쪽 끝은 옛 원의 오른쪽 끝에 그대로 둔다. 호출부 셋이 카드 오른쪽 모서리에서
 * 자리를 잡고 있어서, 기준이 움직이면 그 셋을 다시 맞춰야 한다.
 */
/**
 * 뱃지가 실제로 먹는 폭.
 *
 * 알약이 되면서 폭이 자릿수에 따라 달라진다. 눕힌 카드는 글 오른쪽에 뱃지를
 * 두므로 **글이 자리를 미리 떼야** 하는데, `br * 2.1`처럼 어림하면 두 자리
 * 비용에서 뱃지가 능력 줄을 덮는다(실제로 그랬다).
 */
function costBadgeWidth(ctx: CanvasRenderingContext2D, r: number, cost: number): number {
  const px = Math.max(1, (r * 1.0) / 7);
  return r * 0.88 + r * 1.24 * 0.86 + r * 0.12 + numTextWidth(ctx, String(cost), px);
}

function drawCostBadge(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  cost: number,
  afford: boolean,
): void {
  const hue = afford ? T.fish : T.muted;
  const fish = r * 1.24;
  // 숫자 높이를 뱃지 높이에 맞춘다. 두 자리(유물이 9~12생선)도 같은 크기로 선다 —
  // 옛 원은 자릿수만큼 글자를 줄여야 했지만 알약은 폭이 따라 늘어난다.
  const px = Math.max(1, (r * 1.0) / 7);
  const numW = numTextWidth(ctx, String(cost), px);
  const gap = r * 0.12;
  const padX = r * 0.44;
  const h = r * 2;
  const w = padX * 2 + fish * 0.86 + gap + numW;
  const right = cx + r;
  const box = { x: right - w, y: cy - h / 2, w, h };

  roundRect(ctx, box, h / 2);
  ctx.fillStyle = "rgba(18,12,10,0.94)";
  ctx.fill();
  ctx.strokeStyle = afford ? T.fish : "rgba(239,224,198,0.16)";
  ctx.lineWidth = 2;
  ctx.stroke();

  drawFish(ctx, box.x + padX + fish * 0.43, cy, fish, hue);
  numText(ctx, String(cost), right - padX, cy, px, hue, "right", false);
}

/**
 * 유물 카드.
 *
 * 고양이 카드와 달리 초상이 없다. 대신 **원하는 것과 치르는 것**을 나란히
 * 보여준다 — 유물의 값은 그 둘의 관계에서 나오므로, 사기 전에 둘 다 보이지
 * 않으면 도박이 아니라 그냥 뽑기가 된다.
 */
function drawRelicCard(
  ctx: CanvasRenderingContext2D,
  cr: Rect,
  relic: Relic,
  cost: number,
  afford: boolean,
  pad: number,
): void {
  const rad = Math.min(cr.w, cr.h) * 0.13;
  bevelPanel(
    ctx,
    cr,
    rad,
    afford ? "rgba(111,182,220,0.12)" : "rgba(239,224,198,0.035)",
    afford ? "rgba(0,0,0,0.35)" : "rgba(0,0,0,0.25)",
    3,
  );
  roundRect(ctx, cr, rad);
  ctx.strokeStyle = afford ? T.fish : "rgba(239,224,198,0.12)";
  ctx.lineWidth = afford ? 2 : 1;
  ctx.stroke();

  const vertical = cr.h >= cr.w * 0.9;
  const cx = cr.x + cr.w / 2;
  const tw = cr.w - pad * 2;
  const fsName = Math.max(12, Math.min(21, cr.w * 0.11));
  const fsBody = Math.max(10, fsName * 0.68);

  const br = Math.max(11, (vertical ? cr.w : cr.h) * (vertical ? 0.105 : 0.17));
  // 세운 카드는 모서리에, 눕힌 카드는 오른쪽 가운데에. 눕힌 카드에서 모서리에
  // 두면 이름 줄과 같은 높이가 되어 알약이 글자를 덮는다.
  drawCostBadge(
    ctx,
    cr.x + cr.w - pad - br,
    vertical ? cr.y + pad + br * 0.9 : cr.y + cr.h / 2,
    br,
    cost,
    afford,
  );

  if (!vertical) {
    const relicTw = tw - costBadgeWidth(ctx, br, cost) - pad * 0.6;
    uiText(ctx, relic.name, cr.x + pad, cr.y + cr.h * 0.32, fsName, afford ? T.text : T.muted, {
      align: "left",
      weight: 800,
      maxWidth: relicTw,
    });
    const brief = `${relic.want} · ${relic.gain}`;
    uiText(ctx, brief, cr.x + pad, cr.y + cr.h * 0.66, fsBody, afford ? T.fish : T.muted, {
      align: "left",
      weight: 600,
      maxWidth: relicTw,
    });
    return;
  }

  let ty = cr.y + cr.h * 0.3;
  uiText(ctx, "유물", cx, ty - fsName * 0.95, fsBody * 0.95, afford ? T.fish : T.muted, {
    align: "center",
    weight: 700,
  });
  uiText(ctx, relic.name, cx, ty, fsName, afford ? T.text : T.muted, {
    align: "center",
    weight: 800,
    maxWidth: tw,
  });

  // 원하는 것 / 치르는 것을 라벨과 함께. 어느 쪽이 이익인지 헷갈리면 안 된다.
  ty += fsName * 0.75 + fsBody;
  const rows: (readonly [string, string, string])[] = [
    ["원하는 것", relic.want, afford ? T.fish : T.muted],
  ];
  // 규칙 유물만 '얻는 것'을 적는다. 스탯 유물은 세진다는 게 자명하다.
  rows.push(["얻는 것", relic.gain, afford ? T.ally : T.muted]);
  rows.push(["치르는 것", relic.toll, afford ? T.enemy : T.muted]);
  for (const [label, text, color] of rows) {
    uiText(ctx, label, cx, ty, fsBody * 0.85, "rgba(156,139,118,0.9)", { align: "center", weight: 600 });
    ty += fsBody * 1.15;
    for (const line of wrapLines(ctx, text, fsBody, 700, tw, 2)) {
      uiText(ctx, line, cx, ty, fsBody, color, { align: "center", weight: 700 });
      ty += fsBody * 1.2;
    }
    ty += fsBody * 0.35;
  }
}

function drawOffers(
  ctx: CanvasRenderingContext2D,
  L: Layout,
  s: RunState,
): void {
  const rects = offerRects(L);
  const t = performance.now();

  s.offers.forEach((o: Offer | null, i) => {
    const cr = rects[i];
    if (!cr) return;
    const rad = Math.min(cr.w, cr.h) * 0.13;

    // 산 자리는 비워 둔다. 카드가 사라지면서 남은 것이 넓어지면 손이 헛나간다.
    //
    // **정적 텍스트 판("샀음")은 그리지 않는다.** TFT·슬레이더스파이어·발라트로·
    // 하스스톤 전장·백팩배틀즈 다섯 모두 빈 슬롯에 "품절" 류 글자를 안 찍는다 —
    // 구매 피드백은 글자가 아니라 카드가 사라지는 **동작**이 진다(그 동작은
    // `drawBuyTweens`가 맡는다). 여기 남는 건 빈 테두리뿐이라, 채움을 어둡게
    // 눌러 "지금 비었다"는 것 자체가 눈에 들어오게 한다.
    if (!o) {
      roundRect(ctx, cr, rad);
      ctx.fillStyle = "rgba(12,8,6,0.28)";
      ctx.fill();
      ctx.setLineDash([4, 5]);
      ctx.strokeStyle = "rgba(239,224,198,0.10)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);
      return;
    }

    const afford = s.gold >= o.cost;
    // 영입·교체는 그 고양이의 직업색으로. 카드만 봐도 무엇이 오는지 알 수 있다.
    // 유물은 어느 직업에도 속하지 않으므로 생선색으로 따로 세운다.
    const accent = o.kind === "relic" ? T.fish : o.kind === "upgrade" ? T.gold : CLASS_COLOR[o.breed!.cls];

    bevelPanel(
      ctx,
      cr,
      rad,
      afford ? "rgba(239,224,198,0.10)" : "rgba(239,224,198,0.035)",
      afford ? "rgba(0,0,0,0.35)" : "rgba(0,0,0,0.25)",
      3,
    );
    roundRect(ctx, cr, rad);
    ctx.strokeStyle = afford ? accent : "rgba(239,224,198,0.12)";
    ctx.lineWidth = afford ? 2 : 1;
    ctx.stroke();

    // 짧은 변에서 뽑는다. 폭에서만 뽑으면 넓고 낮은 카드에서 여백이 높이를
    // 잡아먹어 우물 크기가 음수가 되고, 그래디언트가 던져 rAF 루프가 죽는다.
    const relicPad = Math.max(5, Math.min(cr.w, cr.h) * 0.07);
    if (o.kind === "relic" && o.relic) {
      drawRelicCard(ctx, cr, o.relic, o.cost, afford, relicPad);
      return;
    }

    // 무엇을 하는 고양이인지 사기 전에 보여준다.
    const skill = o.breed!.skill ? SKILLS[o.breed!.skill] : null;
    const passive = o.breed!.passive ? PASSIVES[o.breed!.passive] : null;
    const abilityName = skill?.name ?? passive?.name ?? "";
    const abilityDesc = skill?.desc ?? passive?.desc ?? "";
    const abilityLine = `${o.sublabel} · ${skill ? "" : "패시브 "}${abilityName}`;
    // 짧은 변에서 뽑는다. 폭에서만 뽑으면 넓고 낮은 카드에서 여백이 높이를
    // 잡아먹어 우물 크기가 음수가 되고, 그래디언트가 던져 rAF 루프가 죽는다.
    const pad = Math.max(5, Math.min(cr.w, cr.h) * 0.07);

    // 세로 카드가 기본. 초상이 위, 글이 아래.
    if (cr.h >= cr.w * 0.9) {
      const well: Rect = {
        x: cr.x + pad,
        y: cr.y + pad,
        w: cr.w - pad * 2,
        h: cr.h * 0.34,
      };
      drawPortraitWell(
        ctx,
        well,
        o.breed!.id,
        o.breed!.id * 7 + i,
        accent,
        afford,
        t,
      );
      const br = Math.max(12, cr.w * 0.105);
      drawCostBadge(ctx, cr.x + cr.w - pad - br, cr.y + pad + br * 0.9, br, o.cost, afford);

      const fsName = Math.max(12, Math.min(22, cr.w * 0.115));
      const fsAbil = fsName * 0.78;
      const fsDesc = Math.max(10, fsName * 0.66);
      const cx = cr.x + cr.w / 2;
      const tw = cr.w - pad * 2;

      let ty = well.y + well.h + Math.max(9, cr.h * 0.05) + fsName * 0.5;
      uiText(ctx, o.label, cx, ty, fsName, afford ? T.text : T.muted, {
        align: "center",
        weight: 800,
        maxWidth: tw,
      });
      ty += fsName * 0.52 + fsAbil * 0.72;
      uiText(ctx, abilityLine, cx, ty, fsAbil, afford ? accent : T.muted, {
        align: "center",
        weight: 700,
        maxWidth: tw,
      });
      ty += fsAbil * 0.6 + fsDesc * 0.9;

      // 설명은 남은 자리만큼만. 카드 밖으로 새면 옆 카드와 겹쳐 읽힌다.
      const room = cr.y + cr.h - pad - ty;
      const lineH = fsDesc * 1.3;
      const maxLines = Math.max(
        1,
        Math.min(3, Math.floor((room + fsDesc * 0.65) / lineH)),
      );
      for (const line of wrapLines(
        ctx,
        abilityDesc,
        fsDesc,
        500,
        tw,
        maxLines,
      )) {
        uiText(ctx, line, cx, ty, fsDesc, afford ? T.paperDim : T.muted, {
          align: "center",
          weight: 500,
        });
        ty += lineH;
      }
      return;
    }

    /**
    /**
     * 카드를 세울 높이가 안 나오는 화면에서는 눕힌다. **두 구역**으로 나눈다.
     *
     *   윗줄  [초상] 이름 / 능력          [비용]
     *   아랫줄 설명 — 카드 폭을 통째로 쓴다
     *
     * 예전에는 셋을 전부 초상 오른쪽 한 칸에 밀어 넣었다. 340px 카드에서 초상
     * 75 + 뱃지 85 + 여백 48이 60%를 먹어 글에 133px밖에 안 남았고, 거기에
     * 41px 글자를 넣으니 축소 한계를 넘어 뱃지 위로 흘렀다.
     *
     * 설명은 원래 문장이라 가장 긴데 가장 좁은 자리를 받고 있었다. 초상 아래
     * 빈 폭이 그대로 남아 있었으므로 거기로 내린다 — **긴 글에 긴 자리를** 준다.
     */
    const br = Math.max(12, cr.h * 0.155);
    const roomy = cr.h >= 84;
    const headH = roomy ? cr.h * 0.58 : cr.h;
    const side = Math.min(headH - pad * 1.4, cr.w * 0.19);
    const well: Rect = { x: cr.x + pad, y: cr.y + pad, w: side, h: side };
    drawPortraitWell(ctx, well, o.breed!.id, o.breed!.id * 7 + i, accent, afford, t);

    const fs = Math.max(13, Math.min(cr.h * 0.2, cr.w * 0.088));
    const textX = well.x + well.w + pad;
    const textW = cr.x + cr.w - pad - costBadgeWidth(ctx, br, o.cost) - pad * 0.7 - textX;

    uiText(ctx, o.label, textX, cr.y + headH * (roomy ? 0.38 : 0.4), fs, afford ? T.text : T.muted, {
      align: "left",
      weight: 800,
      maxWidth: textW,
    });
    /**
     * 능력 줄 앞에 **직업 픽토그램**을 세운다.
     *
     * 카드가 "궁수 영입 · 꿰뚫기"라고 글로만 말하고 있었다. 직업은 이 게임에서
     * 살지 말지를 가르는 첫 정보인데(유물 조건이 전부 직업 수다) 글자 두 자에
     * 실려 있었다. 왼쪽 줄 직업 카운터가 이미 같은 그림을 쓰므로, 카드와 카운터가
     * **같은 기호로 같은 것을 가리키게** 된다 — 새 어휘를 안 늘리고 연결만 짓는다.
     */
    const abilY = cr.y + headH * 0.72;
    const icoS = fs * 0.72;
    const hasCls = drawIcon(ctx, `cls-${o.breed!.cls}` as IconName, textX + icoS * 0.5, abilY, icoS, afford ? accent : T.muted);
    const abilX = textX + (hasCls ? icoS * 1.25 : 0);
    uiText(ctx, abilityLine, abilX, abilY, fs * 0.62, afford ? accent : T.muted, {
      align: "left",
      weight: 700,
      maxWidth: textW - (abilX - textX),
    });

    // 설명은 카드 폭을 다 쓴다. 두 줄까지 접는다.
    if (roomy) {
      const dfs = Math.max(11, fs * 0.58);
      const dw = cr.w - pad * 2;
      let dy = cr.y + headH + dfs * 0.9;
      for (const line of wrapLines(ctx, abilityDesc, dfs, 500, dw, 2)) {
        uiText(ctx, line, cr.x + pad, dy, dfs, afford ? T.paperDim : T.muted, {
          align: "left",
          weight: 500,
        });
        dy += dfs * 1.35;
      }
    }

    drawCostBadge(ctx, cr.x + cr.w - pad - br, cr.y + cr.h / 2, br, o.cost, afford);
  });
}

/** 0~1 진행도를 완만하게 접는다. 등장·소멸 트윈 여럿이 같이 쓴다. */
function easeOutCubic(t: number): number {
  const p = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - p, 3);
}

/**
 * 구매 트윈 하나. 카드가 슬롯에서 사라지는 대신 아군 보드 쪽으로 날아가며
 * 지워지는 동안의 상태다.
 *
 * **판정과는 무관한 연출 상태다.** `main.ts`의 `buyWithFx`가 `buyOffer`(실제
 * 구매, run.ts)를 먼저 반영한 다음 여기 등록만 한다. 헤드리스 시뮬은 이
 * 배열의 존재조차 모르므로 결과에 영향이 없다.
 *
 * 자리는 좌표가 아니라 **슬롯 인덱스·도착 셀**로 들고 있는다. 화면 크기가
 * 트윈 도중 바뀌어도(회전·주소창 접힘) 매 프레임 `offerRects`/`cellRect`로
 * 다시 구하므로 좌표가 안 어긋난다.
 */
interface BuyTween {
  slot: number;
  /** null이면 유물처럼 특정 칸이 안 생기는 구매다 — 보드 한가운데로 향한다. */
  cell: number | null;
  breedId: number | null;
  accent: string;
  label: string;
  cost: number;
  startedAt: number;
}

export interface UiInteractionDescriptor {
  cursor: "default" | "pointer" | "grab" | "grabbing";
  mute: boolean;
  /** 비활성 컨트롤·빈 카드·접힌 상점 패널처럼 아래 판으로 새면 안 되는 영역. */
  consumesPointer: boolean;
  offerIndex: number;
  reroll: boolean;
  primary: boolean;
  raidContractIndex: number;
  mapNodeIndex: number;
  gameoverChoice: Exclude<NextChoice, "again"> | null;
  draggableCell: number;
}

function pointInRect(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

/** 버튼 얼굴의 pulse와 별개로, 지금 입력을 받아 큐에 보존할 수 있는가. */
function primaryButtonAcceptsInput(s: RunState): boolean {
  if (s.phase === "map") return false;
  if (s.phase !== "battle") return true;
  // 쿨다운 중 입력도 battle.ts의 pending 큐가 보존한다. 여기서 cooldown이나
  // pulse 조건으로 막으면 포인터만 예약 입력을 잃고 Space/G와 갈라진다.
  return dualChoiceActive(s) ? dodgeUsable(s) : actUsable(s);
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

/**
 * 한 프레임의 포인터 대상과 cursor를 한곳에서 정한다.
 *
 * draw 함수는 이 결과를 소비할 뿐 canvas cursor를 직접 쓰지 않는다. 따라서 지도,
 * 계약, 상점이 같은 프레임에 그려져도 마지막 draw가 pointer를 default로 덮지 않는다.
 */
export function uiInteractionDescriptor(
  L: Layout,
  s: RunState,
  drag: Readonly<DragState>,
  phaseLocked = false,
): UiInteractionDescriptor {
  const none: UiInteractionDescriptor = {
    cursor: drag.active ? "grabbing" : "default",
    mute: false,
    consumesPointer: false,
    offerIndex: -1,
    reroll: false,
    primary: false,
    raidContractIndex: -1,
    mapNodeIndex: -1,
    gameoverChoice: null,
    draggableCell: -1,
  };
  if (drag.active) return none;
  const { hoverX: x, hoverY: y } = drag;
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) return none;
  if (pointInRect(L.mute, x, y)) return { ...none, cursor: "pointer", mute: true, consumesPointer: true };
  if (phaseLocked) return { ...none, consumesPointer: true };

  if (s.phase === "gameover") {
    const { choices } = gameoverGeometry(L, s);
    const gameoverChoice: Exclude<NextChoice, "again"> | null = pointInRect(choices.retry, x, y)
      ? "retry"
      : pointInRect(choices.daily, x, y)
        ? "daily"
        : pointInRect(choices.challenge, x, y)
          ? "challenge"
          : null;
    if (gameoverChoice) return { ...none, cursor: "pointer", consumesPointer: true, gameoverChoice };
  }

  if (s.phase === "map") {
    if (s.raidOffers.length > 0) {
      const raidContractIndex = raidContractRects(L, s.raidOffers.length).findIndex((rect) => pointInRect(rect, x, y));
      return raidContractIndex >= 0
        ? { ...none, cursor: "pointer", consumesPointer: true, raidContractIndex }
        : { ...none, consumesPointer: true };
    }
  }

  if (pointInRect(L.button, x, y) && primaryButtonAcceptsInput(s)) {
    return { ...none, cursor: "pointer", consumesPointer: true, primary: true };
  }
  if (pointInRect(L.button, x, y)) return { ...none, consumesPointer: true };

  if (s.phase === "map") {
    const node = nearestMapNode(openMapNodeRects(L, s), x, y);
    return node
      ? { ...none, cursor: "pointer", consumesPointer: true, mapNodeIndex: node.idx }
      : { ...none, consumesPointer: true };
  }

  if (s.phase === "reward") {
    const reroll = rerollRect(L);
    if (pointInRect(reroll, x, y)) {
      // 비용 부족·유물 드래프트도 실제 reroll 경계를 거쳐 즉시 이유를 알려 준다.
      // 키보드 R과 같은 명령을 내야 실패 outline/notice가 포인터에서도 사라지지 않는다.
      return { ...none, cursor: "pointer", consumesPointer: true, reroll: true };
    }
    const cards = offerRects(L);
    const slot = cards.findIndex((rect) => pointInRect(rect, x, y));
    if (slot >= 0) {
      return s.offers[slot]
        ? { ...none, cursor: "pointer", consumesPointer: true, offerIndex: slot }
        : { ...none, consumesPointer: true };
    }
    if (!L.columns) {
      let panel: Rect | null = { ...L.offersPanel };
      for (const card of cards) panel = enclosingRect(panel, card);
      if (panel && pointInRect(panel, x, y)) return { ...none, consumesPointer: true };
    }
    const cell = hitCell(L, "ally", x, y);
    if (cell >= 0 && s.ally[cell]) {
      return { ...none, cursor: "grab", consumesPointer: true, draggableCell: cell };
    }
  }

  if (s.phase === "prepare") {
    const cell = hitCell(L, "ally", x, y);
    if (cell >= 0 && s.ally[cell]) {
      return { ...none, cursor: "grab", consumesPointer: true, draggableCell: cell };
    }
  }
  return none;
}

const buyTweens: BuyTween[] = [];
/** 비행·도착 확인을 합친 420ms. 다음 입력을 막지 않으면서 적용 위치까지 읽히는 길이다. */
const BUY_TWEEN_MS = 420;
/** 모션 축소에서는 비행을 없애고 도착점 확인만 짧게 남긴다. */
const BUY_REDUCED_MS = 180;

export type OfferPurchaseOutcome = "success" | "insufficient-fish";

export interface OfferPurchaseFeedbackDescriptor {
  slot: number;
  rect: Rect;
  label: "생선 부족";
  labelX: number;
  labelY: number;
  alpha: number;
  lineWidth: number;
  durationMs: number;
  translateX: 0;
  translateY: 0;
}

/**
 * 구매 실패 연출의 순수 기하. 성공은 기존 카드→보드 트윈만 사용하므로 여기서
 * descriptor를 만들지 않는다. 실패는 카드 자리에서 160~200ms 정지 outline과
 * 짧은 라벨만 남기며, 화면 밖 좌표나 흔들림을 만들지 않는다.
 */
export function offerPurchaseFeedbackDescriptor(
  L: Layout,
  slot: number,
  outcome: OfferPurchaseOutcome,
  elapsedMs: number,
  reduceMotion: boolean,
): OfferPurchaseFeedbackDescriptor | null {
  if (!Number.isInteger(slot) || outcome === "success" || !Number.isFinite(elapsedMs) || elapsedMs < 0) return null;
  const source = offerRects(L)[slot];
  const durationMs = reduceMotion ? 160 : 200;
  if (!source || elapsedMs >= durationMs) return null;
  const inset = Math.max(1, Math.min(3, Math.min(source.w, source.h) * 0.025));
  const x = Math.max(0, Math.min(L.w, source.x + inset));
  const y = Math.max(0, Math.min(L.h, source.y + inset));
  const right = Math.max(x, Math.min(L.w, source.x + source.w - inset));
  const bottom = Math.max(y, Math.min(L.h, source.y + source.h - inset));
  const progress = Math.min(1, elapsedMs / durationMs);
  return {
    slot,
    rect: { x, y, w: right - x, h: bottom - y },
    label: "생선 부족",
    labelX: Math.max(0, Math.min(L.w, source.x + source.w / 2)),
    labelY: Math.max(0, Math.min(L.h, source.y + Math.max(14, Math.min(24, source.h * 0.18)))),
    alpha: progress <= 0.58 ? 1 : Math.max(0, 1 - (progress - 0.58) / 0.42),
    lineWidth: Math.max(2, Math.min(4, L.scale * 2.8)),
    durationMs,
    translateX: 0,
    translateY: 0,
  };
}

export interface OfferPurchaseFailure {
  slot: number;
  /** 같은 슬롯에 새 카드가 들어와도 실패 표식이 옮겨 붙지 않게 하는 객체 identity. */
  offer: Offer;
  snapshot: Pick<Offer, "kind" | "cost" | "label">;
  startedAt: number;
}

let offerPurchaseFailure: OfferPurchaseFailure | null = null;

/** 렌더 상태와 무관하게 검증할 수 있는 실패 상태 생성 경계. */
export function createOfferPurchaseFailure(
  slot: number,
  offer: Offer,
  startedAt: number,
): OfferPurchaseFailure | null {
  if (!Number.isInteger(slot) || slot < 0 || slot >= OFFER_SLOTS || !Number.isFinite(startedAt)) return null;
  return {
    slot,
    offer,
    snapshot: { kind: offer.kind, cost: offer.cost, label: offer.label },
    startedAt,
  };
}

/** 재추첨·구매로 슬롯 내용이 바뀐 뒤 이전 실패 상태를 폐기하는 순수 판정. */
export function offerPurchaseFailureIsCurrent(
  failure: OfferPurchaseFailure,
  offers: readonly (Offer | null)[],
): boolean {
  const current = offers[failure.slot];
  return current === failure.offer &&
    current.kind === failure.snapshot.kind &&
    current.cost === failure.snapshot.cost &&
    current.label === failure.snapshot.label;
}

export function clearOfferPurchaseFailure(): void {
  offerPurchaseFailure = null;
}

/** 생선 부족이 확정된 카드만 등록한다. 소리와 파티클은 의도적으로 없다. */
export function spawnOfferPurchaseFailure(slot: number, offer: Offer): void {
  offerPurchaseFailure = createOfferPurchaseFailure(slot, offer, performance.now());
}

/**
 * 카드를 하나 산 순간 부른다. `main.ts`의 `buyWithFx`가 유일한 호출부다.
 *
 * 색·그림은 여기서 정한다 — `drawOffers`가 카드에 쓰는 것과 같은 규칙
 * (유물은 생선색, 강화는 금색, 나머지는 직업색)이라 호출부가 그 규칙을
 * 몰라도 된다.
 */
export function spawnBuyTween(offer: Offer, slot: number, cell: number | null): void {
  clearOfferPurchaseFailure();
  const accent =
    offer.kind === "relic" ? T.fish : offer.kind === "upgrade" ? T.gold : offer.breed ? CLASS_COLOR[offer.breed.cls] : T.fish;
  const cue = offer.kind === "upgrade" ? "upgrade" : "purchase";
  const label =
    offer.kind === "relic"
      ? "유물 획득"
      : offer.kind === "upgrade"
        ? "강화 완료"
        : offer.kind === "replace"
          ? "교체 완료"
          : "영입 완료";
  buyTweens.push({
    slot,
    cell,
    breedId: offer.breed ? offer.breed.id : null,
    accent,
    label,
    cost: offer.cost,
    startedAt: performance.now(),
  });
  // 성공한 구매만 이 함수에 도달한다. 실패 입력에 확인음이 나면 사용자는
  // 거래가 성립했다고 오해하므로 `buyOffer` 바깥의 이 경계를 유지한다.
  playUiCue(cue);
}

/** 진행 중인 구매 트윈을 그리고, 끝난 것은 지운다. */
function drawBuyTweens(ctx: CanvasRenderingContext2D, L: Layout): void {
  if (buyTweens.length === 0) return;
  const now = performance.now();
  const reduce = reducedMotion();
  const rects = offerRects(L);
  for (let i = buyTweens.length - 1; i >= 0; i--) {
    const tw = buyTweens[i]!;
    const t = (now - tw.startedAt) / (reduce ? BUY_REDUCED_MS : BUY_TWEEN_MS);
    const from = rects[tw.slot];
    if (t >= 1 || (!reduce && !from)) {
      buyTweens.splice(i, 1);
      continue;
    }

    const to = tw.cell === null ? L.allyBoard : cellRect(L, "ally", tw.cell);
    const toCx = to.x + to.w / 2;
    const toCy = to.y + to.h / 2;
    const flightT = Math.min(1, t / 0.62);
    const e = easeOutCubic(flightT);
    const fromCx = from ? from.x + from.w / 2 : toCx;
    const fromCy = from ? from.y + from.h / 2 : toCy;
    const cx = reduce ? toCx : fromCx + (toCx - fromCx) * e;
    const cy = reduce ? toCy : fromCy + (toCy - fromCy) * e;
    // 축소 설정에서는 크기 이동도 없애고 도착 지점에 정적인 확인만 남긴다.
    const scale = reduce
      ? 0.72
      : flightT < 0.42
        ? 0.96 + (flightT / 0.42) * 0.22
        : 1.18 - ((flightT - 0.42) / 0.58) * 0.56;
    const alpha = reduce ? 1 - t : t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
    const basis = reduce ? Math.min(to.w, to.h) : Math.min(from?.w ?? to.w, from?.h ?? to.h);
    const size = basis * scale;

    ctx.save();
    ctx.globalAlpha = Math.max(0, alpha);
    const frame = tw.breedId !== null ? spriteFor(tw.breedId, "idle") : null;
    if (frame) {
      drawSpriteFrame(ctx, frame, cx - size / 2, cy - size / 2, size);
    } else if (tw.breedId !== null) {
      drawCatFallback(ctx, cx - size / 2, cy - size / 2, size, tw.accent);
    } else {
      // 유물·강화 카드는 그림이 없다. 직업색 대신 카드 색조로 남긴다.
      roundRect(ctx, { x: cx - size / 2, y: cy - size / 2, w: size, h: size }, size * 0.22);
      ctx.fillStyle = hexA(tw.accent, 0.6);
      ctx.fill();
    }
    ctx.restore();

    // 비행이 끝나는 순간 거래 결과가 도착점에 남는다. 카드가 사라지고 생선만
    // 줄던 이전 흐름과 달리, 무엇이 어디에 적용됐는지를 한 프레임에 연결한다.
    const arrival = reduce ? t : Math.max(0, (t - 0.42) / 0.58);
    if (arrival > 0) {
      const ringT = easeOutCubic(arrival);
      const ringR = Math.min(to.w, to.h) * (reduce ? 0.6 : 0.28 + ringT * 0.52);
      const ringAlpha = Math.max(0, 1 - arrival);
      ctx.save();
      ctx.globalAlpha = ringAlpha;
      ctx.strokeStyle = tw.accent;
      ctx.lineWidth = Math.max(2, basis * 0.055 * (reduce ? 1 : 1 - arrival * 0.35));
      ctx.beginPath();
      ctx.arc(toCx, toCy, ringR, 0, Math.PI * 2);
      ctx.stroke();
      if (!reduce) {
        for (let ray = 0; ray < 6; ray++) {
          const angle = -Math.PI / 2 + (Math.PI * 2 * ray) / 6;
          const inner = ringR * 0.72;
          const outer = ringR * (0.96 + 0.16 * (ray % 2));
          ctx.beginPath();
          ctx.moveTo(toCx + Math.cos(angle) * inner, toCy + Math.sin(angle) * inner);
          ctx.lineTo(toCx + Math.cos(angle) * outer, toCy + Math.sin(angle) * outer);
          ctx.stroke();
        }
      }
      const labelY = toCy - Math.min(to.h * 0.58, 48) - (reduce ? 0 : arrival * 12);
      uiText(ctx, `${tw.label} · 생선 -${tw.cost}`, toCx, labelY, Math.max(12, Math.min(16, basis * 0.24)), T.paper, {
        align: "center",
        weight: 800,
        outline: true,
        maxWidth: Math.max(120, to.w * 1.7),
      });
      ctx.restore();
    }
  }
}

/**
 * 카드 머리줄 문구.
 *
 * 보유/한도를 먼저 보여주는 이유: 만석이면 영입 카드가 아예 안 나오는데, 그 이유가
 * 화면 어디에도 없으면 "왜 새 고양이가 안 뜨지"로 읽힌다.
 */
function offerHeadline(s: RunState): string {
  const owned = livingCats(s.ally).length;
  const cap = unitCap(s.wave);
  const team = `우리 편 ${owned}/${cap}`;

  if (s.relicDraftActive) return `유물 드래프트 · 셋 중 하나만 고르거나 건너뛰세요`;

  if (s.offers.every((o) => o === null)) {
    // 웨이브 1만 "가볼까요"(질문형)였고 나머지는 "다음 걸음으로"(명사형)였다.
    // 같은 행동을 웨이브 번호에 따라 다르게 부르면 그게 같은 버튼인지 헷갈린다.
    return `${team} · 다 샀어요 — 자리를 다듬고 다음 걸음으로`;
  }
  if (owned >= cap) return `${team} · 자리가 다 찼어요. 강화하거나 바꿔 넣어요`;
  if (s.wave === 1) return `${team} · 쓰고 가도, 그냥 가도 괜찮아요`;
  return `${team} · 생선을 쓸까요, 그냥 갈까요`;
}

/**
 * 보유 유물 — 세로줄 구성의 오른쪽 줄이 상점이 아닐 때 쓰는 자리.
 *
 * 두 문제를 함께 푼다.
 *
 * 1. **배치·전투에서 오른쪽 줄이 통째로 비어** 화면이 왼쪽으로 쏠렸다. 카드가
 *    없는 국면이 판 시간의 대부분인데 그동안 3분의 1이 배경이었다.
 * 2. **유물이 판 중에 안 보였다.** 측정상 이 게임에서 가장 깊은 축인데
 *    (격차 5.1웨이브 · 신탁 격차 5.9) 무엇을 갖고 있는지는 죽어서 부검 화면에
 *    가야 알 수 있었다. 조건이 전부 팀 구성이라 왼쪽 줄의 직업 수와 나란히
 *    놓여야 "지금 켜져 있나"를 읽을 수 있다.
 *
 * 조건 충족 여부를 색과 글자로 함께 낸다 — 켜졌는지가 유물의 전부다.
 */
function drawRelicColumn(
  ctx: CanvasRenderingContext2D,
  L: Layout,
  s: RunState,
  head: Rect,
): void {
  const r = L.offerCards;
  const cats = livingCats(s.ally);

  uiText(ctx, "유물", head.x, head.y + head.h / 2, Math.max(11, Math.min(15, head.h * 0.46)), T.muted, {
    align: "left",
    weight: 800,
  });
  uiText(
    ctx,
    `${s.relics.length}/${RELIC_TOTAL}`,
    head.x + head.w,
    head.y + head.h / 2,
    Math.max(10, Math.min(14, head.h * 0.42)),
    T.muted,
    { align: "right", weight: 700 },
  );

  if (s.relics.length === 0) {
    // 빈 줄을 그냥 두면 고장으로 보인다. 어디서 얻는지를 적어 둔다.
    uiText(ctx, "아직 없어요", r.x + r.w / 2, r.y + r.h * 0.4, Math.max(11, r.w * 0.075), T.muted, {
      align: "center",
      weight: 700,
    });
    uiText(
      ctx,
      "가위눌림을 밀어내면 하나 떨어져요",
      r.x + r.w / 2,
      r.y + r.h * 0.4 + Math.max(16, r.w * 0.1),
      Math.max(10, r.w * 0.058),
      "rgba(156,139,118,0.7)",
      { align: "center", weight: 500, maxWidth: r.w * 0.92 },
    );
    return;
  }

  const gap = Math.max(6, r.w * 0.04);
  // 칸 높이는 유물 수가 아니라 상한에서 뽑는다. 하나 살 때마다 카드가 줄어들면
  // 같은 유물이 판마다 다른 크기로 보인다.
  const rowH = Math.min((r.h - gap * (RELIC_TOTAL - 1)) / RELIC_TOTAL, Math.max(46, r.w * 0.2));

  s.relics.forEach((relic, i) => {
    const on = relicActive(relic, cats);
    const cr: Rect = { x: r.x, y: r.y + i * (rowH + gap), w: r.w, h: rowH };
    if (cr.y + cr.h > r.y + r.h) return;

    roundRect(ctx, cr, cr.h * 0.22);
    ctx.fillStyle = on ? "rgba(240,186,74,0.13)" : "rgba(239,224,198,0.035)";
    ctx.fill();
    ctx.strokeStyle = on ? T.gold : "rgba(239,224,198,0.10)";
    ctx.lineWidth = on ? 2 : 1;
    ctx.stroke();

    const padX = cr.h * 0.24;
    const fs = Math.max(10, cr.h * 0.29);
    // 아이콘은 세로 가운데. 이름·조건 두 줄을 합친 덩어리 옆에 선다.
    const icon = cr.h * 0.52;
    const hasIcon = drawIcon(
      ctx,
      `relic-${relic.id}` as IconName,
      cr.x + padX + icon * 0.5,
      cr.y + cr.h * 0.5,
      icon,
      on ? T.gold : T.muted,
    );
    const textX = cr.x + padX + (hasIcon ? icon * 1.3 : 0);
    uiText(ctx, relic.name, textX, cr.y + cr.h * 0.33, fs, on ? T.text : T.muted, {
      align: "left",
      weight: 800,
      maxWidth: cr.x + cr.w - padX - fs * 2.4 - textX,
    });
    // 켜짐/꺼짐은 색만으로 두지 않는다 — 색맹 대응이고, 조건이 뭔지도 같이 읽혀야 한다.
    uiText(
      ctx,
      on ? "켜짐" : "꺼짐",
      cr.x + cr.w - padX,
      cr.y + cr.h * 0.33,
      fs * 0.82,
      on ? T.gold : "rgba(156,139,118,0.75)",
      { align: "right", weight: 800 },
    );
    uiText(
      ctx,
      on ? relic.toll : `${relic.want} · ${relic.toll}`,
      textX,
      cr.y + cr.h * 0.71,
      fs * 0.76,
      on ? "rgba(156,139,118,0.9)" : T.muted,
      { align: "left", weight: 500, maxWidth: cr.x + cr.w - padX - textX },
    );
  });
}

/** 다시 뽑기 버튼. 두 구성이 같은 그림을 쓰도록 따로 뺐다. */
function drawRerollButton(
  ctx: CanvasRenderingContext2D,
  L: Layout,
  s: RunState,
  rr: Rect,
): void {
  const canRoll = !s.relicDraftActive && (s.freeRerolls > 0 || s.gold >= REROLL_COST);
  roundRect(ctx, rr, rr.h * 0.5);
  ctx.fillStyle = canRoll ? "rgba(111,182,220,0.14)" : "rgba(239,224,198,0.04)";
  ctx.fill();
  ctx.strokeStyle = canRoll ? T.fish : "rgba(239,224,198,0.12)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  const rfs = Math.max(10, rr.h * 0.46);
  // 세로줄에서는 버튼이 줄 폭을 다 쓰므로 글자를 가운데로 몬다. 접힌 구성에서는
  // 오른쪽 끝에 붙은 작은 버튼이라 글자를 오른쪽으로 민다.
  if (s.relicDraftActive) {
    uiText(ctx, "택 1 · 다시 뽑기 없음", rr.x + rr.w / 2, rr.y + rr.h / 2, rfs, T.muted, {
      align: "center",
      weight: 700,
      maxWidth: rr.w * 0.9,
    });
    return;
  }
  const rollPx = Math.max(1, rr.h * 0.09);
  const rollRight = rr.x + rr.w - rr.w * (L.columns ? 0.06 : 0.12);
  const numW = numTextWidth(ctx, String(REROLL_COST), rollPx);
  uiText(
    ctx,
    "다시 뽑기",
    L.columns ? rr.x + rr.w * 0.06 : rr.x + rr.w * 0.42,
    rr.y + rr.h / 2,
    rfs,
    canRoll ? T.text : T.muted,
    { align: L.columns ? "left" : "right", weight: 700 },
  );
  // 값 왼쪽에 생선. 카드 뱃지·HUD와 같은 그림이라 "이것도 생선 값"이 붙는다.
  drawFish(ctx, rollRight - numW - rr.h * 0.34, rr.y + rr.h / 2, rr.h * 0.5, canRoll ? T.fish : T.muted);
  numText(ctx, String(REROLL_COST), rollRight, rr.y + rr.h / 2, rollPx, canRoll ? T.fish : T.muted, "right", false);
}

/** 패널 안의 서로 다른 읽기 구역을 배경색만으로 구분하지 않게 하는 기준선. */
function drawPanelDivider(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
): void {
  const fade = Math.min(24, w * 0.12);
  const gradient = ctx.createLinearGradient(x, y, x + w, y);
  gradient.addColorStop(0, "rgba(239,224,198,0)");
  gradient.addColorStop(fade / w, "rgba(239,224,198,0.18)");
  gradient.addColorStop(1 - fade / w, "rgba(239,224,198,0.18)");
  gradient.addColorStop(1, "rgba(239,224,198,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(x, Math.round(y), w, 1);
}

function drawBottomZone(
  ctx: CanvasRenderingContext2D,
  L: Layout,
  s: RunState,
): void {
  const reward = s.phase === "reward";
  const rr = rerollRect(L);

  if (L.columns) {
    /**
     * 세로줄에서는 **아무것도 덮지 않는다.**
     *
     * 접힌 구성에서는 카드가 판 위로 자라므로 화면을 어둡게 깔아 "지금은 카드를
     * 보는 시간"임을 알렸다. 세로줄에서는 카드가 제 줄에 서 있고, 무엇보다 이제
     * 상점은 **적을 보면서 사는 자리**다 — 판을 어둡게 하면 그 순서를 만든 이유가
     * 사라진다.
     */
    // 오른쪽 줄은 국면에 따라 내용만 바뀌고 자리는 늘 있다 — 상점이면 카드,
    // 아니면 보유 유물. 국면마다 패널이 생겼다 사라지면 화면이 요동친다.
    const p = L.offersPanel;
    roundRect(ctx, p, Math.min(16, p.w * 0.06));
    ctx.fillStyle = "rgba(20,14,11,0.80)";
    ctx.fill();
    ctx.strokeStyle = "rgba(239,224,198,0.18)";
    ctx.lineWidth = 1;
    ctx.stroke();
    // 왼쪽 줄(직업 수 + 목표)은 전투 중에도 남는다. 무엇이 몇 마리 살아 있고
    // 목표를 얼마나 채웠는지가 전투를 보는 정보다. 두 블록을 한 패널로 묶어야
    // 한 덩어리로 읽힌다 — 따로 깔았더니 직업 수만 떠 있는 상자로 보였다.
    const panelPad = uiSpace(L.scale, 3);
    const leftPanelPad = Math.min(panelPad, L.offers.x);
    const lp = {
      x: L.offers.x - leftPanelPad,
      y: L.offers.y - leftPanelPad,
      w: L.offers.w + leftPanelPad * 2,
      h: L.synergyBar.y + L.synergyBar.h - L.offers.y + leftPanelPad * 2,
    };
    roundRect(ctx, lp, Math.min(16, lp.w * 0.06));
    ctx.fillStyle = "rgba(20,14,11,0.80)";
    ctx.fill();
    ctx.strokeStyle = "rgba(239,224,198,0.18)";
    ctx.lineWidth = 1;
    ctx.stroke();
    drawPanelDivider(
      ctx,
      lp.x + leftPanelPad,
      (L.offers.y + L.offers.h + L.synergyBar.y) / 2,
      lp.w - leftPanelPad * 2,
    );
    drawPanelDivider(
      ctx,
      p.x + panelPad,
      L.offerCards.y - uiSpace(L.scale, 1),
      p.w - panelPad * 2,
    );
    drawTeamStrip(ctx, L, s);
    if (reward) {
      drawRerollButton(ctx, L, s, rr);
      drawOffers(ctx, L, s);
    } else {
      // 카드가 없는 국면(배치·전투·지도)에는 같은 자리에 보유 유물을 세운다.
      drawRelicColumn(ctx, L, s, rr);
    }
    return;
  }

  // 보상 단계에는 카드가 보드 위로 자란다. 그동안 보드는 어차피 만질 수 없으므로
  // 덮는다는 걸 눈에 보이게 해야 한다. (세로줄 구성에서는 아예 안 덮는다 —
  // 구매·배치를 합치면서 그것이 계약이 됐고 npm run probe가 검사한다.)
  const panel: Rect = reward
    ? {
        x: 0,
        y: rr.y - rr.h * 0.7,
        w: L.w,
        h: L.offersPanel.y + L.offersPanel.h - (rr.y - rr.h * 0.7),
      }
    : L.offersPanel;

  if (reward) {
    ctx.fillStyle = "rgba(12,8,6,0.62)";
    ctx.fillRect(0, 0, L.w, L.h);
  }

  ctx.fillStyle = reward ? "rgba(20,14,11,0.96)" : "rgba(20,14,11,0.55)";
  ctx.fillRect(panel.x, panel.y, panel.w, panel.h);

  if (reward) {
    // 보드 한가운데를 직선으로 자르면 고양이가 반토막 나 보인다. 위로 흘려 보낸다.
    const fade = Math.min(64, panel.h * 0.24);
    const g = ctx.createLinearGradient(0, panel.y - fade, 0, panel.y);
    g.addColorStop(0, "rgba(20,14,11,0)");
    g.addColorStop(1, "rgba(20,14,11,0.96)");
    ctx.fillStyle = g;
    ctx.fillRect(0, panel.y - fade, L.w, fade);
  } else {
    ctx.strokeStyle = "rgba(239,224,198,0.18)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, panel.y + 0.5);
    ctx.lineTo(L.w, panel.y + 0.5);
    ctx.stroke();
  }

  if (reward) {
    uiText(
      ctx,
      offerHeadline(s),
      L.offerCards.x,
      rr.y + rr.h / 2,
      Math.max(10, Math.min(15, rr.h * 0.46)),
      T.muted,
      { align: "left", weight: 600 },
    );
    drawRerollButton(ctx, L, s, rr);
    drawOffers(ctx, L, s);
  } else if (s.phase !== "battle") {
    // 전투에는 이 자리를 판에게 넘긴다. 직업 수는 무엇을 살지 정할 때 쓰는
    // 정보라 상점과 배치에서만 필요하고, 전투 중에는 판이 그 자리를 쓴다.
    drawTeamStrip(ctx, L, s);
  }
}

/* ------------------------------------------------------------------ */
/* 시너지 · 버튼 · 안내                                                  */
/* ------------------------------------------------------------------ */

/**
 * 시너지 칩 — 조건, 진행도, 효과를 한 칩에 다 보여준다.
 *
 * 예전에는 조건만 띄웠다. 무엇을 얻는지도, 얼마나 왔는지도 안 보여주니
 * 화면 아래 목표 세 줄이 무슨 뜻인지 알 수 없었다.
 * 네 조건은 전부 동시에 만족할 수 있으므로 셋 다 켜는 것이 실제 목표가 된다.
 */
function drawSynergies(
  ctx: CanvasRenderingContext2D,
  L: Layout,
  s: RunState,
): void {
  const r = L.synergyBar;
  if (r.h < 12) return;
  const n = Math.max(1, s.synergies.length);
  const units = boardUnits(s);
  // 세로줄에서는 위아래로 쌓고, 접힌 구성에서는 좌우로 늘어놓는다.
  // 세로줄에서는 `synergyBar`가 이미 칩 셋에 딱 맞게 잡혀 있다(computeLayout).
  // 같은 식을 써야 칩이 패널을 안 넘는다.
  const gap = L.columns ? Math.max(6, r.w * 0.04) : r.w * 0.016;
  const cw = L.columns ? r.w : (r.w - gap * (n - 1)) / n;
  const ch = L.columns ? (r.h - gap * (n - 1)) / n : r.h;

  s.synergies.forEach((syn, i) => {
    const on = s.activeSynergyIds.has(syn.id);
    const hue = TRIGGER_COLOR[syn.trigger] ?? T.gold;
    const { have, need } = synergyProgress(syn.trigger, units);
    const cr: Rect = L.columns
      ? { x: r.x, y: r.y + i * (ch + gap), w: cw, h: ch }
      : { x: r.x + i * (cw + gap), y: r.y, w: cw, h: ch };
    const fs = Math.max(10, cr.h * 0.27);

    roundRect(ctx, cr, cr.h * 0.22);
    ctx.fillStyle = on ? "rgba(240,186,74,0.13)" : "rgba(239,224,198,0.035)";
    ctx.fill();
    ctx.strokeStyle = on ? hue : "rgba(239,224,198,0.10)";
    ctx.lineWidth = on ? 2 : 1;
    ctx.stroke();

    const padX = cr.h * 0.22;
    const inner = cr.w - padX * 2;
    const px = Math.max(1, cr.h * 0.03);
    const prog = `${Math.min(have, need)}/${need}`;

    // 칩이 좁으면 좌우로 나눌 수 없다. 세로 화면에서 글자가 겹치던 문제.
    const wide = cr.w > cr.h * 6;

    if (wide) {
      uiText(
        ctx,
        triggerLabel(syn.trigger),
        cr.x + padX,
        cr.y + cr.h * 0.34,
        fs * 0.86,
        on ? hue : T.muted,
        {
          align: "left",
          weight: 700,
          maxWidth: inner * 0.52,
        },
      );
      numText(
        ctx,
        prog,
        cr.x + padX,
        cr.y + cr.h * 0.72,
        px,
        on ? hue : T.muted,
        "left",
        false,
      );
      uiText(
        ctx,
        syn.name,
        cr.x + cr.w - padX,
        cr.y + cr.h * 0.34,
        fs * 0.86,
        on ? T.text : T.muted,
        {
          align: "right",
          weight: 800,
          maxWidth: inner * 0.45,
        },
      );
      uiText(
        ctx,
        effectLabel(syn.effect),
        cr.x + cr.w - padX,
        cr.y + cr.h * 0.72,
        fs * 0.8,
        on ? T.gold : "rgba(156,139,118,0.6)",
        { align: "right", weight: 600, maxWidth: inner * 0.55 },
      );
      return;
    }

    // 좁은 칩: 두 줄로 확실히 나눈다. 이름(장식)은 뺀다 — 플레이어에게 필요한 건
    // 무엇을 해야 하는가지 시너지의 이름이 아니다.
    // 윗줄: 조건과 진행도. 아랫줄: 얻는 효과.
    uiText(
      ctx,
      triggerLabel(syn.trigger),
      cr.x + padX,
      cr.y + cr.h * 0.32,
      fs * 0.86,
      on ? hue : T.muted,
      {
        align: "left",
        weight: 800,
        maxWidth: inner * 0.68,
      },
    );
    numText(
      ctx,
      prog,
      cr.x + cr.w - padX,
      cr.y + cr.h * 0.32,
      px,
      on ? hue : T.muted,
      "right",
      false,
    );
    uiText(
      ctx,
      effectLabel(syn.effect),
      cr.x + cr.w / 2,
      cr.y + cr.h * 0.72,
      fs * 0.76,
      on ? T.gold : "rgba(156,139,118,0.6)",
      { align: "center", weight: 600, maxWidth: inner },
    );
  });
}

/**
 * 여정 지도 화면.
 *
 * 길은 **왼쪽에서 오른쪽으로** 흐른다. 이 게임은 이제 가로가 기본이고, 가로
 * 화면에서 세로로 흐르는 길은 남는 폭을 또 버린다.
 *
 * 지나온 길은 흐릿하게 남긴다. 어디서 왔는지가 보여야 지금 고르는 것이 어디로
 * 이어지는지도 읽힌다. 갈 수 없는 칸은 선 없이 어둡게 둔다 — 지우면 길이
 * 좁아 보이고, 똑같이 그리면 고를 수 있는 줄 알고 누른다.
 */
/*
 * 칸 안의 표식은 **아이콘**이다(보스만 이름).
 *
 * 예전에는 "전투/정예/정찰"을 글자로 찍었다. 셋은 길이가 같고 지름 30px 원
 * 안에서는 전부 회색 얼룩으로 보여서, 갈림길에서 무엇과 무엇 중에 고르는지가
 * 한 번에 안 읽혔다. 형태는 작아져도 실루엣이 남는다 — icons.ts 참고.
 * 이름이 필요한 곳(호버 설명·갈래 요약)은 `nodeInfo`가 그대로 낸다.
 */

export function mapNodeRects(L: Layout, s: RunState): { rect: Rect; step: number; idx: number }[] {
  const out: { rect: Rect; step: number; idx: number }[] = [];
  const box = mapBox(L);
  const rows = STAGE_STEPS;
  const rh = box.h / rows;
  const r = Math.min(rh * 0.34, box.w * 0.1);
  for (let step = 0; step < rows; step++) {
    const row = s.map.steps[step] ?? [];
    for (let i = 0; i < row.length; i++) {
      const node = row[i]!;
      /**
       * **아래에서 위로 간다.** 0걸음이 맨 아래, 마지막 걸음이 맨 위다.
       *
       * 좌→우였을 때는 여섯 걸음이 화면 폭을 다 먹어 칸이 붙었고, 무엇보다
       * "올라간다"는 감각이 없었다. 이 게임의 한 스테이지는 골목 하나를
       * 거슬러 올라가 끝에 있는 주인을 만나는 일이다. 세로로 세우면 남은
       * 거리가 곧 눈에 남은 높이가 된다.
       */
      const cy = box.y + box.h - rh * (step + 0.5);
      // lane은 격자 줄 번호다. 버려진 칸이 있어도 자리가 유지돼 길이 흔들리지 않는다.
      const cx = box.x + box.w * ((node.lane + 0.5) / 4);
      out.push({ rect: { x: cx - r, y: cy - r, w: r * 2, h: r * 2 }, step, idx: i });
    }
  }
  return out;
}

/** 그림의 호버와 포인터 입력이 함께 쓰는 현재 열린 길 목록. */
export function openMapNodeRects(L: Layout, s: RunState): { rect: Rect; step: number; idx: number }[] {
  const step = mapStep(s);
  const open = new Set(openLanes(s.map, step));
  return mapNodeRects(L, s).filter((entry) => entry.step === step && open.has(entry.idx));
}

/** 지도 원이 작아져도 포인터 판정은 DESIGN.md의 44px 하한을 지킨다. */
export function mapNodeHitRadius(rect: Rect): number {
  return Math.max(22, rect.w / 2 + 6);
}

/** 겹치는 44px 판정 안에서는 배열 순서가 아니라 손가락에 가장 가까운 칸을 고른다. */
export function nearestMapNode<T extends { rect: Rect }>(
  nodes: readonly T[],
  x: number,
  y: number,
): T | undefined {
  let nearest: T | undefined;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const node of nodes) {
    const cx = node.rect.x + node.rect.w / 2;
    const cy = node.rect.y + node.rect.h / 2;
    const distance = Math.hypot(x - cx, y - cy);
    if (distance > mapNodeHitRadius(node.rect) || distance >= nearestDistance) continue;
    nearest = node;
    nearestDistance = distance;
  }
  return nearest;
}

/** 지도 표식과 선택 확인이 같은 종류 색을 쓰는 단일 경계. */
function mapNodeAccent(kind: NodeKind): string {
  if (kind === "boss") return T.enemy;
  if (kind === "elite") return T.vuln;
  if (kind === "shop") return T.fish;
  return T.ally;
}

/**
 * 지도 전이가 끝난 뒤에도 남길 수 있는 최소 snapshot.
 *
 * 이전 지도 면이나 다른 노드는 저장하지 않는다. 선택 순간의 위치를 화면 비율로
 * 들고 있으므로 320ms 안에 회전하더라도 고리가 새 화면 밖으로 밀리지 않는다.
 */
export interface MapChoiceFeedbackSnapshot {
  xRatio: number;
  yRatio: number;
  radiusRatio: number;
  label: string;
  accent: string;
}

export function captureMapChoiceFeedback(
  L: Layout,
  s: RunState,
  idx: number,
): MapChoiceFeedbackSnapshot | null {
  const hit = openMapNodeRects(L, s).find((entry) => entry.idx === idx);
  if (!hit) return null;
  const node = s.map.steps[hit.step]?.[idx];
  if (!node) return null;
  const label = node.kind === "boss"
    ? bossForIndex(bossIndexAt(s, hit.step)).name
    : nodeInfo(node.kind).name;
  const basis = Math.max(1, Math.min(L.w, L.h));
  return {
    xRatio: (hit.rect.x + hit.rect.w / 2) / Math.max(1, L.w),
    yRatio: (hit.rect.y + hit.rect.h / 2) / Math.max(1, L.h),
    radiusRatio: Math.max(18, hit.rect.w / 2) / basis,
    label,
    accent: mapNodeAccent(node.kind),
  };
}

interface TimedFeedback {
  startedAt: number;
}

interface RerollFeedback extends TimedFeedback {
  success: boolean;
}

interface MapChoiceFeedback extends TimedFeedback {
  snapshot: MapChoiceFeedbackSnapshot;
}

interface NextRunFeedback extends TimedFeedback {
  choice: NextChoice;
}

let rerollFeedback: RerollFeedback | null = null;
let mapChoiceFeedback: MapChoiceFeedback | null = null;
let nextRunFeedback: NextRunFeedback | null = null;

/** 실제 재추첨 결과가 정해진 뒤에만 부른다. 실패에는 성공음을 내지 않는다. */
export function spawnRerollFeedback(success: boolean): void {
  rerollFeedback = { success, startedAt: performance.now() };
  if (success) playUiCue("reroll");
}

/** `chooseNode`가 성공한 뒤, 전이 전에 잡아 둔 위치만 남긴다. */
export function spawnMapChoiceFeedback(snapshot: MapChoiceFeedbackSnapshot): void {
  mapChoiceFeedback = { snapshot, startedAt: performance.now() };
  playUiCue("map");
}

/** 새 런은 즉시 시작하고 이전 버튼 대신 선택 이름만 짧게 남긴다. */
export function spawnNextRunFeedback(choice: NextChoice): void {
  rerollFeedback = null;
  mapChoiceFeedback = null;
  nextRunFeedback = { choice, startedAt: performance.now() };
  playUiCue("reentry");
}

function feedbackProgress(startedAt: number, duration: number): number {
  return (performance.now() - startedAt) / duration;
}

function feedbackAlpha(progress: number, fadeFrom = 0.68): number {
  if (progress <= fadeFrom) return 1;
  return Math.max(0, 1 - (progress - fadeFrom) / (1 - fadeFrom));
}

function drawOfferPurchaseFailure(ctx: CanvasRenderingContext2D, L: Layout, s: RunState): void {
  const fx = offerPurchaseFailure;
  if (!fx) return;
  if (s.phase !== "reward" || !offerPurchaseFailureIsCurrent(fx, s.offers)) {
    clearOfferPurchaseFailure();
    return;
  }
  const visual = offerPurchaseFeedbackDescriptor(
    L,
    fx.slot,
    "insufficient-fish",
    performance.now() - fx.startedAt,
    reducedMotion(),
  );
  if (!visual) {
    clearOfferPurchaseFailure();
    return;
  }
  ctx.save();
  ctx.globalAlpha = visual.alpha;
  roundRect(ctx, visual.rect, Math.max(6, L.scale * 8));
  ctx.strokeStyle = T.action;
  ctx.lineWidth = visual.lineWidth;
  ctx.stroke();
  uiText(ctx, visual.label, visual.labelX, visual.labelY, Math.max(12, Math.min(16, L.scale * 14)), T.gold, {
    align: "center",
    weight: 900,
    outline: true,
    maxWidth: Math.max(48, visual.rect.w - 12),
  });
  ctx.restore();
}

function drawRerollFeedback(ctx: CanvasRenderingContext2D, L: Layout, s: RunState): void {
  const fx = rerollFeedback;
  if (!fx) return;
  if (s.phase !== "reward") {
    rerollFeedback = null;
    return;
  }
  const reduce = reducedMotion();
  const duration = reduce ? 160 : fx.success ? 300 : 220;
  const progress = feedbackProgress(fx.startedAt, duration);
  if (progress >= 1) {
    rerollFeedback = null;
    return;
  }

  const color = fx.success ? T.gold : T.action;
  const alpha = feedbackAlpha(progress, fx.success ? 0.72 : 0.58);
  ctx.save();
  ctx.globalAlpha = alpha;
  if (!fx.success) {
    roundRect(ctx, L.offerCards, Math.max(7, L.scale * 9));
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(2, L.scale * 2.4);
    ctx.stroke();
  } else {
    const rects = offerRects(L);
    rects.forEach((rect, index) => {
      const stagger = reduce ? 0 : index * 0.12;
      const local = Math.max(0, Math.min(1, (progress - stagger) / Math.max(0.01, 1 - stagger)));
      if (progress < stagger) return;
      roundRect(ctx, rect, Math.max(6, L.scale * 8));
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(2, L.scale * (reduce ? 2.2 : 3.2 - local));
      ctx.stroke();
      if (!reduce) {
        const sweepX = rect.x + rect.w * easeOutCubic(local);
        const glow = ctx.createLinearGradient(sweepX - rect.w * 0.16, 0, sweepX + rect.w * 0.08, 0);
        glow.addColorStop(0, "rgba(240,186,74,0)");
        glow.addColorStop(0.65, `rgba(240,186,74,${0.14 * (1 - local * 0.35)})`);
        glow.addColorStop(1, "rgba(240,186,74,0)");
        ctx.fillStyle = glow;
        roundRect(ctx, rect, Math.max(6, L.scale * 8));
        ctx.fill();
      }
    });
  }
  const label = fx.success ? "새 제안" : "재추첨 불가";
  uiText(
    ctx,
    label,
    L.offerCards.x + L.offerCards.w / 2,
    L.offerCards.y + Math.max(14, L.scale * 16),
    Math.max(12, Math.min(17, L.scale * 15)),
    color,
    { align: "center", weight: 900, outline: true, maxWidth: L.offerCards.w * 0.8 },
  );
  ctx.restore();
}

function drawMapChoiceFeedback(ctx: CanvasRenderingContext2D, L: Layout, s: RunState): void {
  const fx = mapChoiceFeedback;
  if (!fx) return;
  if (s.phase !== "reward") {
    mapChoiceFeedback = null;
    return;
  }
  const reduce = reducedMotion();
  const duration = reduce ? 160 : 320;
  const progress = feedbackProgress(fx.startedAt, duration);
  if (progress >= 1) {
    mapChoiceFeedback = null;
    return;
  }
  const { snapshot } = fx;
  const basis = Math.max(1, Math.min(L.w, L.h));
  const cx = snapshot.xRatio * L.w;
  const cy = snapshot.yRatio * L.h;
  const baseRadius = Math.max(18, snapshot.radiusRatio * basis);
  const ringRadius = reduce ? baseRadius * 1.2 : baseRadius * (1 + easeOutCubic(progress) * 0.9);
  const alpha = feedbackAlpha(progress, 0.65);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = snapshot.accent;
  ctx.lineWidth = Math.max(2, L.scale * (reduce ? 2.6 : 4 - progress * 1.8));
  ctx.beginPath();
  ctx.arc(cx, cy, ringRadius, 0, Math.PI * 2);
  ctx.stroke();
  if (!reduce) {
    ctx.beginPath();
    ctx.arc(cx, cy, baseRadius * (0.72 + progress * 0.2), 0, Math.PI * 2);
    ctx.strokeStyle = T.paper;
    ctx.lineWidth = Math.max(1, L.scale * 1.4);
    ctx.stroke();
  }
  uiText(
    ctx,
    `경로 확정 · ${snapshot.label}`,
    cx,
    cy + ringRadius + Math.max(15, L.scale * 14),
    Math.max(12, Math.min(16, L.scale * 14)),
    T.paper,
    { align: "center", weight: 900, outline: true, maxWidth: Math.max(150, L.w * 0.32) },
  );
  ctx.restore();
}

function nextRunChoiceLabel(choice: NextChoice): string {
  if (choice === "retry") return "같은 판 재도전";
  if (choice === "daily") return "오늘의 시드";
  if (choice === "challenge") return "도전 +1";
  return "한 판 더";
}

function drawNextRunFeedback(ctx: CanvasRenderingContext2D, L: Layout, s: RunState): void {
  const fx = nextRunFeedback;
  if (!fx) return;
  if (s.phase !== "map") {
    nextRunFeedback = null;
    return;
  }
  const reduce = reducedMotion();
  const duration = reduce ? 160 : 320;
  const progress = feedbackProgress(fx.startedAt, duration);
  if (progress >= 1) {
    nextRunFeedback = null;
    return;
  }
  const alpha = feedbackAlpha(progress, 0.64);
  const w = Math.min(L.w * 0.7, Math.max(190, L.scale * 300));
  const h = Math.max(42, L.scale * 48);
  const x = L.w / 2 - w / 2;
  const y = L.h / 2 + Math.min(L.h * 0.18, L.scale * 74);
  ctx.save();
  ctx.globalAlpha = alpha;
  roundRect(ctx, { x, y, w, h }, h / 2);
  ctx.fillStyle = "rgba(28,19,14,0.92)";
  ctx.fill();
  ctx.strokeStyle = T.gold;
  ctx.lineWidth = Math.max(2, L.scale * 2.2);
  ctx.stroke();
  uiText(ctx, `새 런 · ${nextRunChoiceLabel(fx.choice)}`, L.w / 2, y + h / 2, Math.max(13, L.scale * 15), T.gold, {
    align: "center",
    weight: 900,
    outline: true,
    maxWidth: w - Math.max(20, L.scale * 28),
  });
  ctx.restore();
}

/** 모든 선택 확인은 최종 전환 막 위에 그려 새 화면과 입력 상태가 어긋나지 않게 한다. */
function drawInteractionFeedback(ctx: CanvasRenderingContext2D, L: Layout, s: RunState): void {
  drawOfferPurchaseFailure(ctx, L, s);
  drawRerollFeedback(ctx, L, s);
  drawMapChoiceFeedback(ctx, L, s);
  drawNextRunFeedback(ctx, L, s);
}

/** 상점·주 행동·패배 선택이 같은 hover 문법(주황 outline)을 공유한다. */
function drawUiHoverFeedback(
  ctx: CanvasRenderingContext2D,
  L: Layout,
  s: RunState,
  interaction: UiInteractionDescriptor,
): void {
  let rect: Rect | null = null;
  if (interaction.offerIndex >= 0) rect = offerRects(L)[interaction.offerIndex] ?? null;
  else if (interaction.reroll) rect = rerollRect(L);
  else if (interaction.primary) rect = L.button;
  else if (interaction.gameoverChoice) rect = gameoverGeometry(L, s).choices[interaction.gameoverChoice];
  if (!rect) return;

  const inset = Math.max(1, Math.min(3, Math.min(rect.w, rect.h) * 0.025));
  const outline: Rect = {
    x: rect.x + inset,
    y: rect.y + inset,
    w: Math.max(0, rect.w - inset * 2),
    h: Math.max(0, rect.h - inset * 2),
  };
  ctx.save();
  roundRect(ctx, outline, Math.max(6, Math.min(outline.h * 0.26, L.scale * 10)));
  ctx.strokeStyle = T.action;
  ctx.lineWidth = Math.max(2, Math.min(3, L.scale * 3));
  ctx.stroke();
  if (!reducedMotion()) {
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = T.action;
    ctx.fill();
  }
  ctx.restore();
}

export interface MapChoiceLabelGeometry {
  y: number;
  fontSize: number;
  maxWidth: number;
  bottom: number;
}

/** 열린 길의 영구 라벨. 행동 구역 위에서 끝나도록 렌더와 프로브가 같이 쓴다. */
export function mapChoiceLabelGeometry(L: Layout, rect: Rect, boss = false): MapChoiceLabelGeometry {
  const fontSize = Math.max(10, rect.w * (boss ? 0.3 : 0.28));
  const actionBoundary = L.button.y - L.actionGap;
  const preferredY = rect.y + rect.h + fontSize * 0.95;
  const y = Math.min(preferredY, actionBoundary - fontSize * 0.6);
  return {
    y,
    fontSize,
    maxWidth: rect.w * (boss ? 3.4 : 2.8),
    bottom: y + fontSize * 0.6,
  };
}

export function mapChoiceLabelText(shortcut: number, label: string): string {
  return `${shortcut} ${label}`;
}

/**
 * 지도가 서는 자리.
 *
 * 세로로 세우면서 폭이 필요 없어졌다 — 갈래는 최대 넷이라 좁은 기둥으로 충분하다.
 * **판 가운데**에 세워서 다른 국면의 보드와 같은 자리를 쓴다. 화면이 바뀌어도
 * 눈이 같은 곳을 본다.
 */
function mapBox(L: Layout): Rect {
  const top = L.notice.y + L.notice.h + L.scale * 10;
  // 맨 아래 원 밑에 숫자·종류 라벨이 설 한 토큰을 먼저 예약한다.
  const bottom = L.button.y - L.actionGap - uiSpace(L.scale, 3);
  const h = Math.max(L.scale * 160, bottom - top);
  const w = Math.min(L.w * 0.5, Math.max(L.scale * 260, 320));
  return { x: L.w / 2 - w / 2, y: top, w, h };
}

/**
 * 짧은 세로 화면은 평소 행동 버튼 자리를 계약 티켓에 양보한다.
 *
 * 계약 카드 자체가 44px보다 훨씬 큰 CTA이고 숫자키도 남으므로, 별도 하단 안내를
 * 접는 편이 88px짜리 세로 카드 세 장보다 정보·터치 양쪽에서 낫다.
 */
export function raidContractUsesViewportFooter(L: Layout, count = 3): boolean {
  const gap = uiSpace(L.scale, 3);
  const top = L.notice.y + L.notice.h + 28;
  const bottom = L.h - uiSpace(L.scale, 2);
  const minTicketH = 104;
  return (
    L.portrait &&
    L.w < 600 &&
    L.h <= 540 &&
    bottom - top >= minTicketH * count + gap * (count - 1)
  );
}

export interface RaidContractOverlayHeaderGeometry {
  compact: boolean;
  titleY: number;
  titleSize: number;
  subtitleVisible: boolean;
  subtitleY: number;
  subtitleSize: number;
  bottomY: number;
}

/** 계약 제목과 카드가 같은 세로 공간을 쓰지 않도록 렌더·프로브가 공유하는 기하. */
export function raidContractOverlayHeaderGeometry(
  L: Layout,
  count = 3,
): RaidContractOverlayHeaderGeometry {
  const compact = L.h < 380 || raidContractUsesViewportFooter(L, count);
  const veryShort = L.h < 300;
  const titleSize = veryShort ? 14 : compact ? 16 : Math.max(20, L.scale * 25);
  const titleY = veryShort
    ? L.notice.y + L.notice.h / 2
    : L.notice.y + L.notice.h + (compact ? 13 : Math.max(20, L.scale * 22));
  const subtitleVisible = !compact;
  const subtitleSize = Math.max(12, L.scale * 13);
  const subtitleY = L.notice.y + L.notice.h + Math.max(42, L.scale * 44);
  const bottomY = subtitleVisible
    ? subtitleY + subtitleSize / 2
    : titleY + titleSize / 2;
  return { compact, titleY, titleSize, subtitleVisible, subtitleY, subtitleSize, bottomY };
}

/** 첫 화면의 악몽 계약 카드. 렌더·히트테스트·레이아웃 검사가 같은 기하를 쓴다. */
export function raidContractRects(L: Layout, count = 3): Rect[] {
  const veryShort = L.h < 300;
  const usesViewportFooter = raidContractUsesViewportFooter(L, count);
  const top = L.notice.y + L.notice.h + (
    usesViewportFooter ? 28 : veryShort ? 8 : L.h < 360 ? 30 : Math.max(52, L.scale * 58)
  );
  const bottom = usesViewportFooter ? L.h - uiSpace(L.scale, 2) : L.button.y - L.actionGap;
  const availableH = Math.max(96, bottom - top);
  const stackedGap = uiSpace(L.scale, 3);
  const wantsStacked = usesViewportFooter || L.portrait || L.w < 600;
  // 폭만 보고 세로 스택을 고르면 599×359에서 카드가 61px까지 무너진다.
  // 세 장이 각각 본문·footer 최소 높이를 가질 때만 1열로 접는다.
  const minStackedH = usesViewportFooter ? 104 : 112;
  const stacked = wantsStacked && availableH >= minStackedH * count + stackedGap * (count - 1);
  const gap = stacked || L.w < 600 ? stackedGap : 24;
  if (stacked) {
    const w = Math.min(420, L.w - uiSpace(L.scale, 3) * 2, Math.max(260, L.w * 0.88));
    const availableCardH = (availableH - gap * (count - 1)) / count;
    // 세로 화면이 길다고 카드 본문을 늘리지 않는다. 계약은 장문의 문서가 아니라
    // 네 구역을 빠르게 견주는 티켓이고, 남는 높이는 카드 **사이 밖**에 둔다.
    const targetH = L.h >= 720 ? 168 : L.h >= 560 ? 148 : 136;
    const h = Math.min(availableCardH, targetH);
    const groupH = h * count + gap * (count - 1);
    const groupTop = top + (availableH - groupH) / 2;
    return Array.from({ length: count }, (_, i) => ({
      x: L.w / 2 - w / 2,
      y: groupTop + i * (h + gap),
      w,
      h,
    }));
  }
  const maxCardW = 420;
  const maxCardH = L.w < 600 && L.h >= 380
    ? Math.min(220, availableH)
    : L.h >= 760
      ? 360
      : L.h >= 620
        ? 340
        : L.h >= 480
          ? 310
          : availableH;
  const side = uiSpace(L.scale, 4);
  const availableW = Math.min(L.w - side * 2, maxCardW * count + gap * (count - 1));
  const w = (availableW - gap * (count - 1)) / count;
  const h = Math.min(availableH, maxCardH);
  const left = (L.w - availableW) / 2;
  // 제목·부제와 카드 사이를 먼저 묶는다. 카드를 전체 가용 높이의 정중앙에
  // 놓으면 높이를 줄인 만큼 위쪽 공백이 다시 커져, 사용자가 지적한 느슨한
  // 화면이 형태만 바뀐 채 남는다.
  const y = top + Math.min(16, Math.max(0, availableH - h));
  return Array.from({ length: count }, (_, i) => ({
    x: left + i * (w + gap),
    y,
    w,
    h,
  }));
}

export interface RaidContractGuideGeometry {
  visible: boolean;
  dividerY: number;
  labelRightX: number;
  cy: number;
  keys: Rect[];
}

/** 계약 카드가 곧 CTA이므로, 비활성 큰 버튼 대신 카드 바로 아래 입력 키만 둔다. */
export function raidContractGuideGeometry(L: Layout, count = 3): RaidContractGuideGeometry {
  if (raidContractUsesViewportFooter(L, count)) {
    return { visible: false, dividerY: L.h, labelRightX: L.w / 2, cy: L.h, keys: [] };
  }
  const keySize = Math.max(24, Math.min(32, L.button.h * 0.52));
  const keyGap = 6;
  const groupW = keySize * count + keyGap * (count - 1);
  const groupX = L.button.x + L.button.w / 2 - groupW / 2;
  const cards = raidContractRects(L, count);
  const cardBottom = Math.max(...cards.map((card) => card.y + card.h));
  const cy = Math.min(L.button.y + L.button.h / 2, cardBottom + 28 + keySize / 2);
  const keyY = cy - keySize / 2;
  return {
    visible: true,
    dividerY: keyY - 12,
    labelRightX: groupX - 12,
    cy,
    keys: Array.from({ length: count }, (_, index) => ({
      x: groupX + index * (keySize + keyGap),
      y: keyY,
      w: keySize,
      h: keySize,
    })),
  };
}

/** 좁은 카드에서도 번호만 남기지 않고 계약명을 선택 근거로 보존한다. */
export function raidContractTitleText(
  contract: Pick<RaidContract, "name">,
  index: number,
  card: Pick<RaidContractCardGeometry, "keyBadgeRect">,
): string {
  return card.keyBadgeRect ? contract.name : `${index + 1} ${contract.name}`;
}

export interface RaidContractCardGeometry {
  narrow: boolean;
  ultraCompact: boolean;
  compactHeader: boolean;
  pad: number;
  titleSize: number;
  bodySize: number;
  labelSize: number;
  maxLines: number;
  headerRect: Rect;
  riskRect: Rect | null;
  ruleRect: Rect;
  counterRect: Rect;
  footerRect: Rect;
  keyBadgeRect: Rect | null;
  titleRect: Rect;
  riskSealRect: Rect;
  contentBottomY: number;
  footerLineY: number;
  rewardY: number;
  rewardMaxWidth: number;
  stackedInfoMinHeight: number;
  keyRect: Rect | null;
}

/** 계약 카드 내부의 제목·본문·footer 경계. 실제 그림과 프로브가 같은 값을 쓴다. */
export function raidContractCardGeometry(rect: Rect, compact: boolean): RaidContractCardGeometry {
  const narrow = rect.w < 180;
  const ultraCompact = rect.h < 140 || (rect.w < 150 && rect.h < 190);
  const short = rect.h < 168;
  const pad = ultraCompact ? 8 : compact || narrow || short ? 10 : Math.max(12, Math.min(16, rect.w * 0.05));
  const baseTitleSize = Math.max(16, Math.min(narrow ? 17 : compact ? 19 : 24, rect.h * (ultraCompact ? 0.17 : compact ? 0.13 : 0.075)));
  const bodySize = compact || ultraCompact
    ? 12
    : Math.max(12, Math.min(narrow ? 13 : 16, rect.h * 0.05));
  const labelSize = Math.max(10, Math.min(12, bodySize * 0.78));
  const gap = ultraCompact ? 2 : compact ? 4 : 8;
  const inner: Rect = {
    x: rect.x + pad,
    y: rect.y + pad,
    w: Math.max(1, rect.w - pad * 2),
    h: Math.max(1, rect.h - pad * 2),
  };
  const headerH = ultraCompact ? Math.min(34, inner.h * 0.34) : compact ? Math.min(44, inner.h * 0.3) : Math.min(60, inner.h * 0.22);
  const riskH = ultraCompact ? 0 : compact ? Math.max(14, Math.min(18, inner.h * 0.12)) : Math.max(20, Math.min(26, inner.h * 0.09));
  const footerH = ultraCompact ? Math.max(22, Math.min(28, inner.h * 0.28)) : compact ? Math.max(30, Math.min(40, inner.h * 0.24)) : Math.max(50, Math.min(60, inner.h * 0.2));
  const gapCount = riskH > 0 ? 4 : 3;
  const infoTotal = Math.max(2, inner.h - headerH - riskH - footerH - gap * gapCount);
  const ruleH = infoTotal / 2;
  const counterH = infoTotal - ruleH;

  const headerRect: Rect = { x: inner.x, y: inner.y, w: inner.w, h: headerH };
  let y = headerRect.y + headerRect.h + gap;
  const riskRect: Rect | null = riskH > 0 ? { x: inner.x, y, w: inner.w, h: riskH } : null;
  if (riskRect) y += riskRect.h + gap;
  const ruleRect: Rect = { x: inner.x, y, w: inner.w, h: ruleH };
  y += ruleRect.h + gap;
  const counterRect: Rect = { x: inner.x, y, w: inner.w, h: counterH };
  y += counterRect.h + gap;
  const footerRect: Rect = { x: inner.x, y, w: inner.w, h: Math.max(1, inner.y + inner.h - y) };

  const inlineNumber = rect.w < 300;
  const badgeSize = Math.max(22, Math.min(34, headerRect.h * 0.68));
  let keyBadgeRect: Rect | null = inlineNumber
    ? null
    : { x: headerRect.x, y: headerRect.y + (headerRect.h - badgeSize) / 2, w: badgeSize, h: badgeSize };
  const sealW = ultraCompact
    ? Math.max(46, Math.min(58, headerRect.w * 0.42))
    : inlineNumber
      ? Math.max(50, Math.min(60, headerRect.w * 0.34))
    : Math.max(62, Math.min(82, headerRect.h * 1.42));
  let riskSealRect: Rect = {
    x: headerRect.x + headerRect.w - sealW,
    y: headerRect.y,
    w: sealW,
    h: headerRect.h,
  };
  let titleX = keyBadgeRect ? keyBadgeRect.x + keyBadgeRect.w + 12 : headerRect.x;
  let titleRect: Rect = {
    x: titleX,
    y: headerRect.y,
    w: Math.max(1, riskSealRect.x - 12 - titleX),
    h: headerRect.h,
  };
  // 가장 긴 이름을 16px에서조차 위험 봉인 옆에 둘 수 없으면 제목과 위험을
  // 두 줄로 나눈다. 먼저 글자를 줄여 맞추면 8px까지 작아져도 겹침을 숨기므로,
  // 배치를 결정한 뒤 16px 하한을 고정한다.
  const minimumTitleChars = keyBadgeRect ? 7 : 9;
  const compactHeader = titleRect.w < minimumTitleChars * 16 * 0.92;
  if (compactHeader) {
    keyBadgeRect = null;
    const rowGap = Math.max(1, Math.min(3, headerRect.h * 0.04));
    const rowH = Math.max(1, (headerRect.h - rowGap) / 2);
    titleX = headerRect.x;
    titleRect = { x: titleX, y: headerRect.y, w: headerRect.w, h: rowH };
    riskSealRect = {
      x: headerRect.x,
      y: headerRect.y + rowH + rowGap,
      w: headerRect.w,
      h: rowH,
    };
  }
  const quantizedBaseTitleSize = Math.max(16, Math.floor(baseTitleSize / 4) * 4);
  const availableTitleSize = compactHeader
    ? quantizedBaseTitleSize
    : Math.floor(titleRect.w / (minimumTitleChars * 0.92 * 4)) * 4;
  const titleSize = Math.max(16, Math.min(quantizedBaseTitleSize, availableTitleSize));
  const infoTextTop = labelSize * 0.9 + 4 + labelSize * 0.72 + bodySize * 0.72;
  const stackedInfoMinHeight = infoTextTop + bodySize * 0.5 + 2;
  const twoLineBottom = infoTextTop + bodySize * 1.28 + bodySize * 0.5 + 2;
  const maxLines = !ultraCompact && Math.min(ruleRect.h, counterRect.h) >= twoLineBottom ? 2 : 1;
  const keyW = Math.max(50, bodySize * 4.4);
  const keyRect: Rect | null = narrow
    ? null
    : {
        x: footerRect.x + footerRect.w - keyW,
        y: footerRect.y + Math.max(0, (footerRect.h - bodySize * 1.8) / 2),
        w: keyW,
        h: Math.min(footerRect.h, bodySize * 1.8),
      };
  const rewardY = footerRect.y + footerRect.h / 2;
  return {
    narrow,
    ultraCompact,
    compactHeader,
    pad,
    titleSize,
    bodySize,
    labelSize,
    maxLines,
    headerRect,
    riskRect,
    ruleRect,
    counterRect,
    footerRect,
    keyBadgeRect,
    titleRect,
    riskSealRect,
    contentBottomY: counterRect.y + counterRect.h,
    footerLineY: footerRect.y,
    rewardY,
    rewardMaxWidth: narrow
      ? footerRect.w
      : Math.max(48, keyRect!.x - footerRect.x - 8),
    stackedInfoMinHeight,
    keyRect,
  };
}

function drawRiskClaws(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  risk: number,
  size: number,
  color: string,
): void {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(1.5, size * 0.16);
  for (let i = 0; i < 3; i++) {
    ctx.globalAlpha = i < risk ? 1 : 0.2;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(x + i * size * 0.72, y + size * 0.42);
    ctx.quadraticCurveTo(x + i * size * 0.72 + size * 0.28, y - size * 0.3, x + i * size * 0.72 + size * 0.5, y - size * 0.48);
    ctx.stroke();
  }
  ctx.restore();
}

function activeContractLine(
  contract: RaidContract,
  seed: number,
  mode: "map" | "prepare" | "battle" | "debrief",
): string {
  const code = raidShareCode(seed, contract.id);
  if (mode === "map") return `${contract.name} · ${raidPrepLabel(raidPrepRoute(contract))}`;
  if (mode === "battle") return `${contract.name} · ${contract.counter}`;
  if (mode === "debrief") return `${contract.name} · ${contract.counter} · ${code}`;
  return `${contract.name} · ${contract.counter}`;
}

export interface RaidContractChipGeometry {
  chip: Rect;
  content: Rect;
  label: string;
  fontSize: number;
}

/** 안내 문구와 독립된 활성 계약 칩. 작은 화면은 이름, 넓은 화면은 대응까지 보인다. */
export function raidContractChipGeometry(
  L: Layout,
  contract: RaidContract,
  phase: "map" | "prepare" | "reward",
): RaidContractChipGeometry {
  const r = L.notice;
  const fontSize = Math.max(12, Math.min(15, r.h * 0.52));
  const detailed = phase === "map"
    ? `${contract.name} · ${raidPrepLabel(raidPrepRoute(contract))}`
    : `${contract.name} · ${contract.counter}`;
  const estimate = (text: string) => [...text].length * fontSize * 0.92 + 30;
  const maxChipW = Math.max(104, Math.min(r.w * 0.56, r.w - 92));
  const label = estimate(detailed) <= maxChipW ? detailed : contract.name;
  const chipW = Math.min(maxChipW, Math.max(104, estimate(label)));
  const gap = Math.max(5, L.scale * 5);
  const chip: Rect = { x: r.x + 1, y: r.y + 1, w: chipW, h: Math.max(11, r.h - 2) };
  const contentX = chip.x + chip.w + gap;
  const content: Rect = {
    x: contentX,
    y: r.y,
    w: Math.max(80, r.x + r.w - contentX),
    h: r.h,
  };
  return { chip, content, label, fontSize };
}

function drawActiveRaidContractChip(
  ctx: CanvasRenderingContext2D,
  geometry: RaidContractChipGeometry,
  risk: number,
): void {
  const { chip, label, fontSize } = geometry;
  roundRect(ctx, chip, Math.max(3, chip.h * 0.22));
  ctx.fillStyle = "rgba(15,10,8,0.90)";
  ctx.fill();
  ctx.strokeStyle = "rgba(239,224,198,0.28)";
  ctx.lineWidth = 1;
  ctx.stroke();
  const claw = Math.max(5, Math.min(8, chip.h * 0.28));
  drawRiskClaws(ctx, chip.x + 6, chip.y + chip.h * 0.63, risk, claw, T.enemy);
  uiText(ctx, label, chip.x + 6 + claw * 2.35, chip.y + chip.h / 2, fontSize, T.paper, {
    align: "left",
    weight: 800,
  });
}

function raidContractRiskColor(risk: number): string {
  return risk === 3 ? T.danger : risk === 2 ? T.gold : T.gather;
}

/** 위험은 색 하나가 아니라 발톱 수·3칸 트랙·텍스트를 같은 카드 안에서 반복한다. */
function drawRaidRiskSeal(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  risk: RaidContract["risk"],
  bodySize: number,
): void {
  const color = raidContractRiskColor(risk);
  roundRect(ctx, rect, Math.max(4, rect.h * 0.22));
  ctx.fillStyle = hexA(color, 0.09);
  ctx.fill();
  ctx.strokeStyle = hexA(color, 0.55);
  ctx.lineWidth = 1.5;
  ctx.stroke();

  if (rect.h < Math.max(28, bodySize * 2)) {
    const claw = Math.max(4, Math.min(bodySize * 0.52, rect.h * 0.28, rect.w / 12));
    const clawW = claw * 1.94;
    const startX = rect.x + 5;
    drawRiskClaws(ctx, startX, rect.y + rect.h / 2, risk, claw, color);
    uiText(ctx, raidRiskLabel(risk), startX + clawW + 5, rect.y + rect.h / 2, Math.max(10, bodySize * 0.72), color, {
      align: "left",
      weight: 800,
      maxWidth: Math.max(1, rect.w - clawW - 15),
    });
    return;
  }

  const claw = Math.max(5, Math.min(bodySize * 0.68, rect.w / 3.15, rect.h * 0.24));
  drawRiskClaws(ctx, rect.x + rect.w / 2 - claw * 0.98, rect.y + rect.h * 0.42, risk, claw, color);
  uiText(ctx, raidRiskLabel(risk), rect.x + rect.w / 2, rect.y + rect.h * 0.76, Math.max(10, bodySize * 0.72), color, {
    align: "center",
    weight: 800,
    maxWidth: rect.w - 8,
  });
}

function drawRaidRiskTrack(ctx: CanvasRenderingContext2D, rect: Rect, risk: RaidContract["risk"], bodySize: number): void {
  const color = raidContractRiskColor(risk);
  const labelW = Math.min(rect.w * 0.3, bodySize * 3.8);
  uiText(ctx, "위험 부담", rect.x, rect.y + rect.h / 2, Math.max(10, bodySize * 0.7), T.paperDim, {
    weight: 700,
    maxWidth: labelW,
  });
  const trackX = rect.x + labelW + 6;
  const gap = 4;
  const segmentW = Math.max(2, (rect.x + rect.w - trackX - gap * 2) / 3);
  const segmentH = Math.max(5, Math.min(9, rect.h * 0.52));
  for (let i = 0; i < 3; i++) {
    const segment = {
      x: trackX + i * (segmentW + gap),
      y: rect.y + (rect.h - segmentH) / 2,
      w: segmentW,
      h: segmentH,
    };
    roundRect(ctx, segment, segmentH / 2);
    ctx.fillStyle = i < risk ? hexA(color, 0.72) : "rgba(239,224,198,0.08)";
    ctx.fill();
    ctx.strokeStyle = i < risk ? color : "rgba(239,224,198,0.18)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

export type RaidPattern = RaidContract["patterns"][number];

export interface RaidContractInfoContentGeometry {
  textRect: Rect;
  emblemRect: Rect | null;
}

/** 패턴 인장이 본문 폭을 쓸 때 렌더와 레이아웃 프로브가 공유하는 실제 영역. */
export function raidContractInfoContentGeometry(
  rect: Rect,
  card: Pick<RaidContractCardGeometry, "ultraCompact" | "pad">,
  withEmblem = false,
): RaidContractInfoContentGeometry {
  const sidePad = card.ultraCompact ? 5 : Math.max(7, card.pad * 0.65);
  const canShowEmblem = withEmblem && !card.ultraCompact && rect.w >= 260 && rect.h >= 56;
  const emblemSize = canShowEmblem ? Math.max(32, Math.min(40, rect.h - 12)) : 0;
  const emblemRect = canShowEmblem
    ? { x: rect.x + sidePad, y: rect.y + (rect.h - emblemSize) / 2, w: emblemSize, h: emblemSize }
    : null;
  const textX = emblemRect ? emblemRect.x + emblemRect.w + 10 : rect.x + sidePad;
  return {
    emblemRect,
    textRect: {
      x: textX,
      y: rect.y,
      w: Math.max(1, rect.x + rect.w - sidePad - textX),
      h: rect.h,
    },
  };
}

/** 기존 보스 패턴 토큰을 새 이미지 없이 계약서의 작은 기믹 인장으로 번역한다. */
export function drawRaidPatternEmblem(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  pattern: RaidPattern,
  color: string,
): void {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const r = Math.min(rect.w, rect.h) * 0.34;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, Math.min(rect.w, rect.h) * 0.46, 0, Math.PI * 2);
  ctx.fillStyle = hexA(color, 0.08);
  ctx.fill();
  ctx.strokeStyle = hexA(color, 0.42);
  ctx.lineWidth = 1.25;
  ctx.stroke();
  ctx.translate(cx, cy);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(1.5, rect.w * 0.055);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const line = (x1: number, y1: number, x2: number, y2: number): void => {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  };

  switch (pattern) {
    case "circle":
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.72, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.14, 0, Math.PI * 2);
      ctx.fill();
      break;
    case "line":
      line(-r * 0.62, -r * 0.72, r * 0.62, r * 0.72);
      line(-r * 0.2, -r * 0.72, r * 0.72, r * 0.34);
      break;
    case "cone":
      ctx.beginPath();
      ctx.moveTo(-r * 0.62, -r * 0.7);
      ctx.lineTo(r * 0.72, 0);
      ctx.lineTo(-r * 0.62, r * 0.7);
      ctx.closePath();
      ctx.stroke();
      break;
    case "gather":
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.16, 0, Math.PI * 2);
      ctx.fill();
      for (const angle of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
        const ox = Math.cos(angle) * r * 0.78;
        const oy = Math.sin(angle) * r * 0.78;
        const ix = Math.cos(angle) * r * 0.3;
        const iy = Math.sin(angle) * r * 0.3;
        line(ox, oy, ix, iy);
      }
      break;
    case "stomp":
      ctx.beginPath();
      ctx.moveTo(-r * 0.3, -r * 0.72);
      ctx.lineTo(r * 0.3, -r * 0.72);
      ctx.lineTo(0, -r * 0.12);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.arc(0, r * 0.3, r * 0.34, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, r * 0.3, r * 0.68, Math.PI * 0.08, Math.PI * 0.92);
      ctx.stroke();
      break;
    case "hearth":
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.68, 0, Math.PI * 2);
      ctx.stroke();
      line(-r * 0.34, 0, r * 0.34, 0);
      line(0, -r * 0.34, 0, r * 0.34);
      break;
    case "quake":
      ctx.beginPath();
      ctx.moveTo(-r * 0.72, -r * 0.45);
      ctx.lineTo(-r * 0.2, -r * 0.08);
      ctx.lineTo(-r * 0.5, r * 0.12);
      ctx.lineTo(0, r * 0.58);
      ctx.lineTo(r * 0.2, r * 0.08);
      ctx.lineTo(r * 0.72, r * 0.42);
      ctx.stroke();
      break;
    case "creep":
      for (const scale of [0.28, 0.52, 0.78]) {
        ctx.beginPath();
        ctx.arc(0, 0, r * scale, -Math.PI * 0.9, Math.PI * 0.55);
        ctx.stroke();
      }
      break;
    case "sweep":
      for (const y of [-0.52, 0, 0.52]) {
        line(-r * 0.72, r * y, r * 0.5, r * y);
        line(r * 0.5, r * y, r * 0.25, r * y - r * 0.2);
      }
      break;
    case "polarity":
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.72, 0, Math.PI * 2);
      ctx.stroke();
      line(0, -r * 0.72, 0, r * 0.72);
      ctx.beginPath();
      ctx.arc(-r * 0.34, -r * 0.28, r * 0.1, 0, Math.PI * 2);
      ctx.arc(r * 0.34, r * 0.28, r * 0.1, 0, Math.PI * 2);
      ctx.fill();
      break;
    case "seize":
      ctx.beginPath();
      ctx.arc(-r * 0.18, 0, r * 0.42, 0, Math.PI * 2);
      ctx.stroke();
      line(-r * 0.72, 0, r * 0.72, 0);
      line(-r * 0.18, -r * 0.72, -r * 0.18, r * 0.72);
      ctx.beginPath();
      ctx.arc(r * 0.62, 0, r * 0.16, 0, Math.PI * 2);
      ctx.fill();
      break;
    default: {
      const unsupported: never = pattern;
      ctx.restore();
      throw new Error(`지원하지 않는 계약 패턴 인장: ${String(unsupported)}`);
    }
  }
  ctx.restore();
}

function drawRaidContractInfoBand(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  label: string,
  text: string,
  card: RaidContractCardGeometry,
  accent: string,
  strong: boolean,
  pattern: RaidPattern | null = null,
): void {
  roundRect(ctx, rect, Math.max(3, Math.min(8, rect.h * 0.18)));
  ctx.fillStyle = strong ? hexA(accent, 0.075) : "rgba(239,224,198,0.035)";
  ctx.fill();
  ctx.strokeStyle = strong ? hexA(accent, 0.22) : "rgba(239,224,198,0.1)";
  ctx.lineWidth = 1;
  ctx.stroke();

  const content = raidContractInfoContentGeometry(rect, card, pattern !== null);
  const contentX = content.textRect.x;
  const contentW = content.textRect.w;
  if (content.emblemRect && pattern) drawRaidPatternEmblem(ctx, content.emblemRect, pattern, accent);
  if (card.ultraCompact || rect.h < card.stackedInfoMinHeight) {
    // `uiText(maxWidth)`에 긴 원문을 바로 넘기면 8px 하한까지 줄인 뒤에도 폭이
    // 모자란 초소형 카드에서 옆 카드로 샌다. 12px에서 먼저 한 줄 말줄임을
    // 확정하면 글자 크기와 카드 경계를 둘 다 지킬 수 있다.
    const line = wrapLines(ctx, `${label} · ${text}`, card.bodySize, strong ? 800 : 600, contentW, 1)[0] ?? label;
    uiText(ctx, line, contentX, rect.y + rect.h / 2, card.bodySize, strong ? accent : T.paperDim, {
      weight: strong ? 800 : 600,
      maxWidth: contentW,
    });
    return;
  }

  const labelY = rect.y + card.labelSize * 0.9 + 4;
  uiText(ctx, label, contentX, labelY, card.labelSize, strong ? accent : T.muted, {
    weight: 800,
    maxWidth: contentW,
  });
  const lineH = card.bodySize * 1.28;
  const textTop = labelY + card.labelSize * 0.72 + card.bodySize * 0.72;
  const lines = wrapLines(ctx, text, card.bodySize, strong ? 800 : 600, contentW, card.maxLines);
  lines.forEach((line, lineIndex) => {
    uiText(ctx, line, contentX, textTop + lineIndex * lineH, card.bodySize, strong ? accent : T.paperDim, {
      weight: strong ? 800 : 600,
      maxWidth: contentW,
    });
  });
}

let raidContractFocusIndex = -1;

export function normalizeRaidContractFocusIndex(index: number, count = 3): number {
  return Number.isInteger(index) && index >= 0 && index < count ? index : -1;
}

/** 접근성 DOM 버튼의 focus를 같은 Canvas 카드에 투영하는 렌더 전용 상태. */
export function setRaidContractFocusIndex(index: number): void {
  raidContractFocusIndex = normalizeRaidContractFocusIndex(index);
}

/** DOM focus 상태와 Canvas 카드 인덱스를 잇는 단일 판정점. */
export function isRaidContractFocused(index: number, count = 3): boolean {
  return normalizeRaidContractFocusIndex(raidContractFocusIndex, count) === index;
}

export interface RaidContractInteractionVisual {
  active: boolean;
  borderRole: "action" | "focus" | "default";
  borderWidth: number;
  focusRing: boolean;
  focusRingGap: number;
  focusRingWidth: number;
  translateY: number;
}

/** hover와 keyboard focus가 시각·이동 양쪽에서 섞이지 않게 하는 상태 계약. */
export function raidContractInteractionVisual(
  hot: boolean,
  focused: boolean,
): RaidContractInteractionVisual {
  return {
    active: hot || focused,
    borderRole: hot ? "action" : focused ? "focus" : "default",
    borderWidth: hot || focused ? 3 : 1.5,
    focusRing: focused,
    focusRingGap: 4,
    focusRingWidth: focused ? 3 : 0,
    translateY: hot ? -4 : 0,
  };
}

function drawRaidContractCard(
  ctx: CanvasRenderingContext2D,
  L: Layout,
  rect: Rect,
  contract: RaidContract,
  index: number,
  hot: boolean,
  focused: boolean,
): void {
  const interaction = raidContractInteractionVisual(hot, focused);
  const active = interaction.active;
  const compact = L.h < 380 || rect.h <= 168 || rect.w <= 280;
  const card = raidContractCardGeometry(rect, compact);
  const face = active ? "rgba(62,39,29,0.99)" : "rgba(35,24,19,0.99)";
  bevelPanel(ctx, rect, Math.max(8, L.scale * 10), face, "rgba(0,0,0,0.72)", hot ? 6 : 3);
  roundRect(ctx, rect, Math.max(8, L.scale * 10));
  ctx.strokeStyle = interaction.borderRole === "action"
    ? T.action
    : interaction.borderRole === "focus"
      ? T.gold
      : contract.risk === 3
        ? hexA(T.enemy, 0.72)
        : "rgba(239,224,198,0.38)";
  ctx.lineWidth = interaction.borderWidth;
  ctx.stroke();
  if (interaction.focusRing) {
    const ringGap = interaction.focusRingGap;
    const ring: Rect = {
      x: rect.x - ringGap,
      y: rect.y - ringGap,
      w: rect.w + ringGap * 2,
      h: rect.h + ringGap * 2,
    };
    roundRect(ctx, ring, Math.max(10, L.scale * 12));
    ctx.strokeStyle = T.gold;
    ctx.lineWidth = interaction.focusRingWidth;
    ctx.stroke();
  }

  // 위험색은 카드 전체를 덮지 않고 왼쪽 rail과 봉인에만 쓴다. 전장 신호 3색의
  // 채도 독점을 계약 UI가 빼앗지 않게 하는 경계다.
  roundRect(ctx, { x: rect.x + 3, y: rect.y + 8, w: Math.max(2, L.scale * 3), h: rect.h - 16 }, 2);
  ctx.fillStyle = hexA(raidContractRiskColor(contract.risk), active ? 0.9 : 0.55);
  ctx.fill();

  if (card.keyBadgeRect) {
    ctx.beginPath();
    ctx.arc(
      card.keyBadgeRect.x + card.keyBadgeRect.w / 2,
      card.keyBadgeRect.y + card.keyBadgeRect.h / 2,
      card.keyBadgeRect.w / 2,
      0,
      Math.PI * 2,
    );
    ctx.fillStyle = hot ? T.action : focused ? hexA(T.gold, 0.22) : "rgba(245,160,60,0.12)";
    ctx.fill();
    ctx.strokeStyle = hot ? T.action : focused ? T.gold : "rgba(245,160,60,0.55)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    uiText(ctx, `${index + 1}`, card.keyBadgeRect.x + card.keyBadgeRect.w / 2, card.keyBadgeRect.y + card.keyBadgeRect.h / 2, card.bodySize, hot ? T.actionInk : focused ? T.gold : T.action, {
      align: "center",
      weight: 900,
    });
  }
  const rawTitle = raidContractTitleText(contract, index, card);
  const titleLine = wrapLines(ctx, rawTitle, card.titleSize, 900, card.titleRect.w, 1)[0] ?? rawTitle;
  uiText(
    ctx,
    titleLine,
    card.titleRect.x,
    card.titleRect.y + card.titleRect.h / 2,
    card.titleSize,
    T.paper,
    { weight: 900, maxWidth: card.titleRect.w },
  );
  drawRaidRiskSeal(ctx, card.riskSealRect, contract.risk, card.bodySize);
  if (card.riskRect) drawRaidRiskTrack(ctx, card.riskRect, contract.risk, card.bodySize);

  drawRaidContractInfoBand(ctx, card.ruleRect, "보스 변화", contract.rule, card, T.paperDim, false, contract.patterns[0] ?? null);
  drawRaidContractInfoBand(ctx, card.counterRect, "내 대응", contract.counter, card, T.gather, true);

  drawPanelDivider(ctx, card.footerRect.x, card.footerLineY, card.footerRect.w);
  const footer = card.footerRect;
  const fishSize = Math.max(13, Math.min(24, footer.h * 0.46));
  const fishX = footer.x + fishSize * 0.55;
  drawFish(ctx, fishX, card.rewardY, fishSize, T.fish);
  const rewardX = fishX + fishSize * 0.8;
  if (!card.ultraCompact && footer.h >= 38) {
    uiText(ctx, "승리 시", rewardX, footer.y + footer.h * 0.34, Math.max(10, card.labelSize), T.paperDim, {
      weight: 700,
      maxWidth: card.rewardMaxWidth - fishSize,
    });
    uiText(ctx, `+${contract.rewardFish} 생선`, rewardX, footer.y + footer.h * 0.7, Math.max(15, card.bodySize * 1.25), T.fish, {
      weight: 900,
      maxWidth: card.rewardMaxWidth - fishSize,
    });
  } else {
    uiText(ctx, `+${contract.rewardFish}`, rewardX, card.rewardY, Math.max(14, card.bodySize * 1.12), T.fish, {
      weight: 900,
      maxWidth: card.rewardMaxWidth - fishSize,
    });
  }

  if (card.keyRect) {
    roundRect(ctx, card.keyRect, Math.max(4, card.keyRect.h * 0.24));
    ctx.fillStyle = hot ? T.action : focused ? hexA(T.gold, 0.18) : "rgba(239,224,198,0.06)";
    ctx.fill();
    ctx.strokeStyle = hot ? T.action : focused ? T.gold : "rgba(239,224,198,0.28)";
    ctx.lineWidth = active ? 2 : 1;
    ctx.stroke();
    uiText(ctx, `선택 ${index + 1}`, card.keyRect.x + card.keyRect.w / 2, card.keyRect.y + card.keyRect.h / 2, Math.max(11, card.bodySize * 0.82), hot ? T.actionInk : focused ? T.gold : T.paperDim, {
      align: "center",
      weight: 900,
      maxWidth: card.keyRect.w - 6,
    });
  }
}

function drawRaidContractOverlay(
  ctx: CanvasRenderingContext2D,
  L: Layout,
  s: RunState,
  pointer: UiInteractionDescriptor,
): void {
  const rects = raidContractRects(L, s.raidOffers.length);
  const target = nextRaidBossTarget(s);
  const header = raidContractOverlayHeaderGeometry(L, s.raidOffers.length);
  uiText(
    ctx,
    header.compact ? `악몽 계약 · ${target.name}` : "악몽과 계약할 시간",
    L.w / 2,
    header.titleY,
    header.titleSize,
    T.paper,
    { align: "center", weight: 800, outline: true },
  );
  if (header.subtitleVisible) {
    uiText(
      ctx,
      `${target.name}의 변화 · 내 대응 · 보상을 비교하세요`,
      L.w / 2,
      header.subtitleY,
      header.subtitleSize,
      T.paperDim,
      { align: "center", maxWidth: L.w - 24 },
    );
  }

  const hovered = pointer.raidContractIndex;
  rects.forEach((rect, index) => {
    const contract = s.raidOffers[index];
    if (!contract) return;
    const hot = hovered === index;
    const focused = isRaidContractFocused(index, s.raidOffers.length);
    const interaction = raidContractInteractionVisual(hot, focused);
    ctx.save();
    if (interaction.translateY !== 0 && !reducedMotion()) ctx.translate(0, interaction.translateY);
    drawRaidContractCard(ctx, L, rect, contract, index, hot, focused);
    ctx.restore();
  });
}

interface RaidContractChoiceFx {
  offers: readonly RaidContract[];
  chosenIndex: number;
  startedAt: number;
}

let previousRaidOffers: RaidContract[] = [];
let raidContractChoiceFx: RaidContractChoiceFx | null = null;

/** RunState를 바꾸지 않고 제안 3장→선택 완료 전이만 관찰해 봉인 snapshot을 남긴다. */
function watchRaidContractChoice(s: RunState): void {
  const current = s.phase === "map" ? s.raidOffers : [];
  if (previousRaidOffers.length > 0 && current.length === 0 && s.raidContract) {
    const chosenIndex = previousRaidOffers.findIndex((contract) => contract.id === s.raidContract?.id);
    if (chosenIndex >= 0) {
      raidContractChoiceFx = {
        offers: [...previousRaidOffers],
        chosenIndex,
        startedAt: performance.now(),
      };
      playUiCue("contract");
    }
  }
  previousRaidOffers = current.length > 0 ? [...current] : [];
}

function drawRaidContractSealStamp(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  contract: RaidContract,
  progress: number,
  reduce: boolean,
): void {
  const fade = progress > 0.86 ? 1 - (progress - 0.86) / 0.14 : 1;
  const arrive = easeOutCubic(Math.min(1, progress / 0.58));
  const radius = Math.max(34, Math.min(58, Math.min(rect.w, rect.h) * 0.18));
  const scale = reduce ? 1 : 1.42 - arrive * 0.42;
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h * 0.54;
  ctx.save();
  ctx.globalAlpha = Math.max(0, fade) * Math.min(1, progress * 4);
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(123,45,42,0.92)";
  ctx.fill();
  ctx.strokeStyle = T.gold;
  ctx.lineWidth = Math.max(2, radius * 0.07);
  ctx.stroke();
  drawRiskClaws(ctx, -radius * 0.44, -radius * 0.04, contract.risk, radius * 0.34, T.paper);
  ctx.restore();

  if (!reduce) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, fade) * (1 - arrive * 0.55);
    ctx.fillStyle = T.paperDim;
    for (let i = 0; i < 6; i++) {
      const angle = -Math.PI / 2 + (Math.PI * 2 * i) / 6;
      const travel = radius * (0.85 + arrive * (0.7 + (i % 2) * 0.25));
      const px = cx + Math.cos(angle) * travel;
      const py = cy + Math.sin(angle) * travel + arrive * 12;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(angle + arrive * (i % 2 ? 1.2 : -1.1));
      ctx.fillRect(-3, -2, 6, 4);
      ctx.restore();
    }
    ctx.restore();
  }

  const labelY = cy + radius + 22;
  uiText(ctx, "계약 체결", cx, labelY, Math.max(14, Math.min(18, rect.w * 0.05)), T.gold, {
    align: "center",
    weight: 900,
    outline: true,
  });
  uiText(ctx, `${contract.name} · 승리 생선 +${contract.rewardFish}`, cx, labelY + 22, Math.max(12, Math.min(15, rect.w * 0.042)), T.paper, {
    align: "center",
    weight: 800,
    outline: true,
    maxWidth: rect.w * 0.9,
  });
}

function drawRaidContractChoiceFeedback(ctx: CanvasRenderingContext2D, L: Layout): void {
  const fx = raidContractChoiceFx;
  if (!fx) return;
  const reduce = reducedMotion();
  const duration = reduce ? 160 : 360;
  const progress = (performance.now() - fx.startedAt) / duration;
  if (progress >= 1) {
    raidContractChoiceFx = null;
    return;
  }
  const rects = raidContractRects(L, fx.offers.length);
  const chosenRect = rects[fx.chosenIndex];
  const chosen = fx.offers[fx.chosenIndex];
  if (!chosenRect || !chosen) return;

  // 상태는 이미 지도 선택으로 넘어갔다. 이전 카드 세 장을 그대로 남기면 화면은
  // 계약 선택처럼 보이는데 입력은 지도에 들어가는 거짓 UI가 된다. 카드 자리에는
  // 클릭 대상이 아닌 국소 outline·봉인만 남겨 지도와 입력을 즉시 일치시킨다.
  const fade = progress > 0.78 ? 1 - (progress - 0.78) / 0.22 : 1;
  ctx.save();
  ctx.globalAlpha = Math.max(0, fade);
  roundRect(ctx, chosenRect, Math.max(8, L.scale * 10));
  ctx.strokeStyle = T.gold;
  ctx.lineWidth = Math.max(2, (reduce ? 3 : 5 - progress * 3));
  ctx.stroke();
  if (!reduce) {
    const halo = ctx.createRadialGradient(
      chosenRect.x + chosenRect.w / 2,
      chosenRect.y + chosenRect.h * 0.54,
      0,
      chosenRect.x + chosenRect.w / 2,
      chosenRect.y + chosenRect.h * 0.54,
      Math.min(chosenRect.w, chosenRect.h) * 0.42,
    );
    halo.addColorStop(0, `rgba(240,186,74,${0.16 * (1 - progress)})`);
    halo.addColorStop(1, "rgba(240,186,74,0)");
    ctx.fillStyle = halo;
    ctx.fillRect(chosenRect.x, chosenRect.y, chosenRect.w, chosenRect.h);
  }
  ctx.restore();
  drawRaidContractSealStamp(ctx, chosenRect, chosen, reduce ? 0.7 : progress, reduce);
}

/** 봉우리 셋 달린 왕관. 지도의 스테이지 우두머리 칸에만 씌운다. */
function drawCrown(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, color: string): void {
  const h = w * 0.62;
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(cx - w / 2, cy);
  ctx.lineTo(cx - w / 2, cy - h * 0.5);
  ctx.lineTo(cx - w * 0.24, cy - h * 0.18);
  ctx.lineTo(cx, cy - h);
  ctx.lineTo(cx + w * 0.24, cy - h * 0.18);
  ctx.lineTo(cx + w / 2, cy - h * 0.5);
  ctx.lineTo(cx + w / 2, cy);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawMap(ctx: CanvasRenderingContext2D, L: Layout, s: RunState, pointer: UiInteractionDescriptor): void {
  if (s.phase !== "map") return;
  /**
   * 지도는 화면을 통째로 가진다.
   *
   * 0.88이었을 때 아래 UI가 비쳐서 직업 카운터·목표 칩·유물 패널의 글자가
   * 지도 선과 겹쳐 읽혔다. 반투명은 "뒤에 뭔가 있다"를 알려 주려던 것인데,
   * 지도를 보는 동안 뒤엣것은 **읽을 필요가 없을 뿐 아니라 읽히면 안 된다**.
   */
  // **알파를 먼저 되돌린다.** 앞 단계가 남긴 globalAlpha가 곱해지면 막이
  // 0.975가 아니라 그 곱만큼만 덮여 아래 UI가 그대로 비친다.
  ctx.globalAlpha = 1;
  ctx.fillStyle = "rgba(10,7,5,0.98)";
  ctx.fillRect(0, 0, L.w, L.h);
  if (s.raidOffers.length > 0) {
    drawRaidContractOverlay(ctx, L, s, pointer);
    return;
  }
  const step = mapStep(s);
  const openOrder = openLanes(s.map, step);
  const open = new Set(openOrder);
  const prepRoute = s.raidContract && isRaidPrepStep(step)
    ? raidPrepRoute(s.raidContract)
    : null;
  const rects = mapNodeRects(L, s);
  const at = (st: number, i: number): Rect | undefined =>
    rects.find((x) => x.step === st && x.idx === i)?.rect;

  // 선 먼저. 칸 아래에 깔려야 칸이 선을 끊는 것처럼 보인다.
  for (let st = 0; st < STAGE_STEPS - 1; st++) {
    const row = s.map.steps[st] ?? [];
    for (let i = 0; i < row.length; i++) {
      const a = at(st, i);
      if (!a) continue;
      for (const t of row[i]!.next) {
        const b = at(st + 1, t);
        if (!b) continue;
        const past = s.map.taken[st] === i;
        const live = st === step - 1 ? past : st < step;
        ctx.strokeStyle = live ? "rgba(244,227,193,0.5)" : "rgba(239,224,198,0.14)";
        ctx.lineWidth = live ? Math.max(2, L.scale * 2.4) : Math.max(1, L.scale * 1.4);
        /**
         * 아래 칸의 위쪽에서 위 칸의 아래쪽으로. 직선이 아니라 **완만한 곡선**이다.
         *
         * 직선으로 이으면 배선도처럼 보인다. 골목길은 꺾이지 곧지 않다.
         * 제어점을 중간 높이에 두고 x는 각 끝의 x를 쓰면, 갈래가 벌어질 때
         * 자연스럽게 휘고 나란한 선끼리도 서로 다른 곡률을 갖는다.
         */
        const ax = a.x + a.w / 2;
        const ay = a.y;
        const bx = b.x + b.w / 2;
        const by = b.y + b.h;
        const my = (ay + by) / 2;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.bezierCurveTo(ax, my, bx, my, bx, by);
        ctx.stroke();
      }
    }
  }

  /**
   * 마우스가 올라간 칸.
   *
   * 고를 수 있는 칸만 반응한다. 못 가는 칸이 커지면 갈 수 있는 줄 알고 누르게
   * 되고, 그건 호버가 정보를 주는 게 아니라 거짓말을 하는 것이다.
   */
  const hovered = pointer.mapNodeIndex;

  for (const { rect, step: st, idx } of rects) {
    const node = s.map.steps[st]?.[idx];
    if (!node) continue;
    const taken = s.map.taken[st] === idx;
    const here = st === step;
    const pickable = here && open.has(idx);
    const done = st < step;
    const hot = here && idx === hovered;
    const contractPrep = pickable && prepRoute === node.kind;
    const shortcut = pickable ? openOrder.indexOf(idx) + 1 : 0;

    const hue = mapNodeAccent(node.kind);
    // 고를 수 있는 칸만 살아 있다. 나머지는 지도의 배경이다.
    const alpha = pickable ? 1 : taken ? 0.62 : done ? 0.26 : 0.46;

    // 올라간 칸은 조금 커진다. 크기 변화가 색 변화보다 먼저 눈에 띈다.
    // 스테이지 우두머리(걸음의 두 번째 보스)는 늘 한 치수 크다 — 중간보스와
    // 같은 크기면 지도가 "이 스테이지의 끝"을 말할 방법이 없다.
    const stageBossNode = node.kind === "boss" && bossOrdinalInStage(st) > 0;
    const grow = (hot ? rect.w * 0.09 : 0) + (stageBossNode ? rect.w * 0.1 : 0);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(rect.x + rect.w / 2, rect.y + rect.h / 2, rect.w / 2 + grow, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(14,10,8,0.92)";
    ctx.fill();
    ctx.strokeStyle = hot ? "#FFFFFF" : contractPrep ? T.gold : hue;
    ctx.lineWidth = hot ? Math.max(3, L.scale * 3.4) : pickable ? Math.max(2, L.scale * 2.6) : Math.max(1, L.scale * 1.4);
    ctx.stroke();
    // 카드가 지시한 계약 직후 준비 경로. 색만 바꾸지 않고 이중 고리로 표시해
    // 색각과 작은 화면에서도 다른 종류임을 남긴다.
    if (contractPrep) {
      ctx.beginPath();
      ctx.arc(rect.x + rect.w / 2, rect.y + rect.h / 2, rect.w / 2 + grow + Math.max(4, L.scale * 5), 0, Math.PI * 2);
      ctx.strokeStyle = T.gold;
      ctx.lineWidth = Math.max(1.5, L.scale * 1.8);
      ctx.stroke();
    }
    // 보스 칸만 **이름**을 보여준다. 어떤 보스가 오는지가 곧 무엇을 준비할지를
    // 정하는데, 지금까지 그 정보가 화면에 없었다.
    //
    // 신원은 `bossIndexAt`에서만 나온다. 예전에는 현재 걸음 기준으로 "앞으로
    // 만날 보스가 몇 번째인가"를 세어 라벨을 붙였는데, 그러면 **지나간 보스 칸이
    // 다음 보스 이름으로 바뀌어** 한 지도에 같은 이름이 둘 뜬다.
    if (node.kind === "boss") {
      const name = bossForIndex(bossIndexAt(s, st)).name;
      const visibleName = shortcut > 0 ? mapChoiceLabelText(shortcut, name) : name;
      const weight = pickable ? 800 : 400;
      /**
       * 아이콘은 원 **안**, 이름은 원 **아래**.
       *
       * 예전에는 이름을 원 안에 넣었다. 세 글자(살금이)와 네 글자(무쇠발톱)가
       * 섞여 있어 네 글자는 원에 맞추느라 작아졌고, 그러면서 보스 칸만 아이콘이
       * 없어 다른 칸들과 다른 언어를 썼다. 이름을 밖으로 내면 둘 다 풀린다 —
       * 아이콘이 계열을 지키고, 이름은 원 크기와 무관하게 읽힌다.
       */
      drawNodeIcon(
        ctx,
        "boss",
        rect.x + rect.w / 2,
        rect.y + rect.h / 2,
        (rect.w + grow * 2) * 0.68,
        hot ? T.paper : hue,
      );
      const label = mapChoiceLabelGeometry(L, rect, true);
      uiText(
        ctx,
        visibleName,
        rect.x + rect.w / 2,
        label.y,
        label.fontSize,
        hot ? T.paper : hue,
        { align: "center", weight, outline: true, maxWidth: label.maxWidth },
      );
      // 우두머리 칸에만 왕관. 색·크기와 달리 멀리서도 "종류가 다르다"로 읽힌다.
      if (stageBossNode) {
        drawCrown(ctx, rect.x + rect.w / 2, rect.y - rect.w * 0.1, rect.w * 0.42, T.gold);
      }
    } else {
      drawNodeIcon(
        ctx,
        node.kind,
        rect.x + rect.w / 2,
        rect.y + rect.h / 2,
        (rect.w + grow * 2) * 0.72,
        hot ? T.paper : hue,
      );
      // 터치에는 호버가 없다. 지금 고를 수 있는 길만 숫자 단축키와 종류를
      // 상시 표시해 화면의 선택지와 키보드의 1/2/3 순서를 일치시킨다.
      if (shortcut > 0) {
        const label = mapChoiceLabelGeometry(L, rect);
        uiText(
          ctx,
          mapChoiceLabelText(shortcut, nodeInfo(node.kind).name),
          rect.x + rect.w / 2,
          label.y,
          label.fontSize,
          contractPrep ? T.gold : hot ? T.paper : hue,
          { align: "center", weight: 800, outline: true, maxWidth: label.maxWidth },
        );
      }
    }
    ctx.restore();

    // 고를 수 있는 칸은 맥동한다. 여섯 칸 중 어디를 눌러야 하는지가 한눈에 보인다.
    if (pickable) {
      const pulse = motionPulse(260);
      ctx.save();
      ctx.beginPath();
      ctx.arc(rect.x + rect.w / 2, rect.y + rect.h / 2, rect.w / 2 + L.scale * 4, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,255,255,${0.12 + pulse * 0.28})`;
      ctx.lineWidth = Math.max(1.5, L.scale * 1.8);
      ctx.stroke();
      ctx.restore();
    }
  }

  const cur = s.map.steps[step] ?? [];
  const kinds = [...new Set(cur.filter((_, i) => open.has(i)).map((n) => n.kind))];
  // 올라간 칸이 있으면 그 칸의 설명을, 없으면 갈래 요약을 준다. 터치에는
  // 호버가 없으므로 요약이 늘 남아 있어야 한다.
  const hotNode = hovered >= 0 ? cur[hovered] : undefined;
  // 보스 칸에 올리면 그 보스가 무엇을 하는지 알려준다. 정답이 아니라 성질이다.
  // 라벨과 **같은 인덱스**를 써야 한다. 이름은 살금이인데 설명은 무쇠발톱이
  // 나오던 자리다 — 여기만 앞의 보스 수를 안 세고 있었다.
  const bossLine =
    hotNode?.kind === "boss" ? bossHint(bossForIndex(bossIndexAt(s, step)).id) : null;
  const info = hotNode ? nodeInfo(hotNode.kind) : null;
  const hotIsPrep = hotNode && prepRoute === hotNode.kind;
  // 스테이지 제목은 아무것도 안 올렸을 때의 기본 줄에만 붙는다 — 노드를
  // 올리면 그 칸의 설명이 더 급하므로 자리를 양보한다. backdropScene이 없는
  // 스테이지(2·3, 아직 미배선)는 이름을 안 붙여 기존 문구 그대로 나간다.
  const theme = stageTheme(s.map.stage);
  const stageTitle = theme.backdropScene ? ` · ${theme.name}` : "";
  uiText(
    ctx,
    bossLine
      ? bossLine
      : info
      ? `${info.name} — ${info.hint}${hotIsPrep ? " · 이번 계약의 대응 경로" : ""}`
      : prepRoute && s.raidContract
      ? `${activeContractLine(s.raidContract, s.seed, "map")} · 이중 고리 밖은 보스 강도 +${Math.round((BALANCE.contractMismatchPower - 1) * 100)}%`
      : `${s.map.stage}번째 밤${stageTitle} · ${step + 1}/${STAGE_STEPS} — ${kinds.map((k) => nodeInfo(k).name).join(" 또는 ")}`,
    L.w / 2,
    mapBox(L).y - L.scale * 6,
    // 폰 세로에서 scale이 0.43이라 13×0.43 = 5.6px였다 — 하한 11px. 긴 보스 설명은 폭 안에서 줄인다.
    Math.max(11, L.scale * 13),
    T.paperDim,
    { align: "center", weight: 400, maxWidth: L.w - L.scale * 24 },
  );
}

/**
 * 버튼 문구는 짧고 능동적이어야 한다("전투 시작"·"출발"류) — TFT·슬레이더스파이어·
 * 발라트로·하스스톤 전장·백팩배틀즈가 공통으로 쓰는 톤이다. "싸우러 가기"처럼
 * 에두르는 동사구는 안내 문구(존댓말)와 버튼(명사·명령형)의 경계를 흐린다.
 */
export function buttonText(s: RunState): string {
  switch (s.phase) {
    case "prepare":
      return "전투 시작";
    case "battle": {
      // 보스전에는 이 자리가 개입 버튼이다. 전투 중 죽어 있던 공간을 재사용하므로
      // 세로 레이아웃 예산이 늘지 않는다.
      //
      // 버튼은 하나이고 상황에 따라 역할만 바뀐다 — 취약 창이 열리면 약점 공격,
      // 평소엔 회피. 조작을 늘리지 않고 레이드의 두 국면을 넣는 방법이다.
      // 예고와 취약 창이 겹치면 resolveIntent가 회피를 먼저 처리한다. 라벨도
      // 같은 우선순위를 써야 버튼을 눌렀을 때 실제 행동과 어긋나지 않는다.
      //
      // 최종 국면(finalPhase, US-404)의 채널 동안은 그 무엇보다 먼저 잠긴다
      // — 예고도 취약 창도 이 동안은 안 걸리므로 원래대로면 "회피"가
      // 뜨겠지만, 실제로는 아무 것도 할 수 없는 연출 구간이다.
      if (finalPhaseChannelActive(s)) return "…";
      const intent = actIntentKind(s);
      const visibleWindow = s.enemy.some((c) => c?.alive && c.vulnerableMs > 0);
      const open = vulnerableWindowBoss(s);
      // 순간이동으로 몸이 사라진 동안 local 기회는 남아 있어도 지금 쓸 수 없다.
      // 이를 "기회 소진"이라고 부르면 자원 상태가 거짓이므로 잠깐 잠금으로 보인다.
      if (visibleWindow && !open) return "…";
      if ((intent === "dodge" || intent === "gather") && actUsable(s)) {
        if (s.actCooldown > 0) return `${(s.actCooldown / 1000).toFixed(1)}초`;
        const pool = open && open.vulnerableCharges > 0
          ? `기회 ${open.vulnerableCharges}`
          : `회피 ${s.dodgeCharges}`;
        return `${intent === "gather" ? "집결!" : "산개!"}  ${pool}`;
      }
      if (open) {
        if (!strikeUsable(s)) {
          return `기회 소진 · 회피 ${s.dodgeCharges}`;
        }
        return open.vulnerableCharges === BALANCE.vulnerableChargesPerWindow
          ? `결정타 · 기회 ${open.vulnerableCharges}`
          : `한 번 더 · 기회 ${open.vulnerableCharges}`;
      }
      // `dodgeUsable`(battle.ts) — 차지가 0이어도 순차 스윕(sweep)의 두 번째
      // 파동은 첫 파동에서 이미 낸 값으로 공짜로 넘어간다("개입 1회로 연쇄
      // 전체를 넘긴다"). 여기를 `s.dodgeCharges <= 0`으로만 재면 그 무료
      // 순간에도 버튼이 "전투 중"으로 죽어 보여 아무도 안 누르게 된다.
      if (!dodgeUsable(s)) return "전투 중";
      // 쿨다운 중에는 남은 시간을 그대로 보여준다. 잠긴 이유를 안 보여주면
      // 그냥 안 먹는 버튼으로 읽힌다 — 예전에 실제로 그 보고를 받았다.
      if (s.actCooldown > 0) return `${(s.actCooldown / 1000).toFixed(1)}초`;
      /**
       * 라벨은 실제 레이드에서 부르는 콜을 쓴다 — 붉은 예고엔 "산개",
       * 청록엔 "집결". 예고가 없을 때는 이 버튼의 자원 이름인 "회피"다
       * ("대응"은 게임에서 안 쓰는 말이라 기능이 아니라 장식으로 읽혔다).
       * 무엇을 할지는 여전히 게임이 정하고, 라벨은 그걸 말로 보여줄 뿐이다.
       * 차지가 0인데도 눌러야 하는 순간(스윕 두 번째 파동)엔 숫자를 빼서
       * "0인데 왜 눌러야 하나"는 혼란을 없앤다.
       */
      return s.dodgeCharges > 0 ? `회피  ${s.dodgeCharges}` : "회피";
    }
    case "reward":
      if (s.relicDraftActive) return "유물 건너뛰기";
      // 상점 다음은 배치다. 정찰 칸만은 싸우지 않으므로 다시 지도로 간다.
      return s.nodeKind === "shop" ? "길 고르기" : "전투 시작";
    case "map":
      return s.raidOffers.length > 0 ? "계약 1 · 2 · 3 중 선택" : "길을 고르세요";
    case "gameover":
      return "다시 도전";
  }
}

/**
 * `dualChoiceActive`(battle.ts)가 참일 때 버튼 자리를 산개/집결 두 짝으로
 * 가른다. 극성 전용 이름을 안 쓴 것은 그 게이트와 같은 이유다 — 원버튼
 * 폐기가 검토 중이라 나중엔 극성이 아닌 예고에서도 이 함수가 그대로 쓰인다.
 *
 * 둘은 독립 CTA가 아니라 한 세그먼트 그룹이다. 2px 내부선만 남기고 히트테스트는
 * 전체 그룹을 가운데로 나눠, 내부선 위를 눌러도 가장 가까운 선택이 동작한다.
 * `L.button`은 손대지 않는다 — `npm run probe`가 전체 터치 영역을 검사한다.
 */
export function splitButton(r: Rect): [Rect, Rect] {
  const gap = 2;
  const halfW = (r.w - gap) / 2;
  return [
    { x: r.x, y: r.y, w: halfW, h: r.h },
    { x: r.x + halfW + gap, y: r.y, w: halfW, h: r.h },
  ];
}

/** 2px 내부선도 버튼 중심을 기준으로 가장 가까운 세그먼트에 배정한다. */
export function splitButtonChoice(r: Rect, x: number): "dodge" | "gather" {
  return x < r.x + r.w / 2 ? "dodge" : "gather";
}

/**
 * 갈라진 버튼 한 짝의 문구. `buttonText`의 예고 분기와 조건을 맞췄다 —
 * 자원 상태(차지·쿨다운)는 두 버튼이 공유하는 값이라 그대로 반복하고,
 * 갈라지는 것은 동사(산개!/집결!)뿐이다. 여기서 어긋나면 라벨과 실제
 * 눌렀을 때의 동작(main.ts)이 따로 논다.
 *
 * **키 힌트를 붙인다.** 버튼이 둘로 갈리면서 "왼쪽·오른쪽" 대신 눌러야 할
 * 키(Space·G)를 라벨이 직접 말해야 한다 — 안 그러면 마우스 없이는 어느
 * 버튼이 어느 키인지 외워야 한다. 좁으면(반쪽 폭 140px 아래, 데스크톱
 * 세로줄 구성의 최소치가 여기 걸린다) 약칭으로 줄인다 — `uiText`의
 * `maxWidth` 말줄임이 최후 안전장치지만, 그전에 "Space"가 잘려 "Spa…"로
 * 보이는 것보다 "spc"가 낫다.
 */
function dualButtonText(s: RunState, verb: "산개" | "집결", key: string, keyAbbrev: string, w: number): string {
  if (!dodgeUsable(s)) return "전투 중";
  if (s.actCooldown > 0) return `${(s.actCooldown / 1000).toFixed(1)}초`;
  const hint = w >= 140 ? key : keyAbbrev;
  const open = vulnerableWindowBoss(s);
  const pool = open ? `기회 ${open.vulnerableCharges}` : `회피 ${s.dodgeCharges}`;
  return `${verb}! ${hint}  ${pool}`;
}

function drawButton(
  ctx: CanvasRenderingContext2D,
  L: Layout,
  s: RunState,
): void {
  if (s.phase === "map" && s.raidOffers.length > 0) {
    // 계약 카드는 누르는 물건인데 아래에 비활성 대형 버튼을 한 번 더 그리면
    // 사용자는 먼저 그 버튼을 살리려 한다. 같은 기하 예산에는 입력 안내만 남긴다.
    const guide = raidContractGuideGeometry(L, s.raidOffers.length);
    if (!guide.visible) return;
    const keySize = guide.keys[0]?.w ?? 24;
    drawPanelDivider(ctx, L.button.x, guide.dividerY, L.button.w);
    uiText(ctx, "카드를 누르거나", guide.labelRightX, guide.cy, Math.max(12, keySize * 0.44), T.paperDim, {
      align: "right",
      weight: 700,
      maxWidth: Math.max(80, L.button.w * 0.38),
    });
    guide.keys.forEach((keyRect, i) => {
      roundRect(ctx, keyRect, keySize * 0.22);
      ctx.fillStyle = "rgba(239,224,198,0.06)";
      ctx.fill();
      ctx.strokeStyle = "rgba(239,224,198,0.28)";
      ctx.lineWidth = 1;
      ctx.stroke();
      uiText(ctx, `${i + 1}`, keyRect.x + keyRect.w / 2, keyRect.y + keyRect.h / 2, Math.max(12, keySize * 0.46), T.action, {
        align: "center",
        weight: 900,
      });
    });
    return;
  }

  // 보드·정보 띠와 행동 구역의 경계. 실제 버튼 기하는 바꾸지 않아 히트테스트와 같다.
  drawPanelDivider(ctx, L.button.x, L.button.y - L.actionGap / 2, L.button.w);

  /**
   * 전투 중 버튼은 **반응할 것이 있을 때만** 살아 있다.
   *
   * 개입은 예고가 떠 있는 1.2초 안에서만 일한다. 그 밖에서 누르면 큐에도 안
   * 들어가고 차지도 안 줄고 아무 일도 안 일어나는데, 버튼은 내내 같은 주황으로
   * 눌러 달라는 얼굴을 하고 있었다. 그래서 "버튼이 고장 났다"로 읽혔다 —
   * 실제로 그 보고를 받았고, 계측해 보니 기능은 멀쩡했다.
   *
   * 말로 설명하는 대신 버튼이 스스로 때를 알린다. 죽어 있으면 누를 때가 아니고,
   * 살아나면 지금이다. 무엇을 눌러야 하는지는 여전히 장판 색이 말한다 —
   * 버튼까지 정답을 알려주면 읽을 이유가 사라진다.
   */
  const armed =
    !finalPhaseChannelActive(s) && // 최종 국면 채널 — 개입 버튼은 잠긴다("…")
    ((s.phase !== "battle" && s.phase !== "map") ||
      (s.phase === "battle" &&
        (dualChoiceActive(s)
          ? dodgeUsable(s) && s.actCooldown <= 0 && hazardsActive(s)
          : actUsable(s) && (actIntentKind(s) === "strike" || s.actCooldown <= 0))));
  const pulse = armed && s.phase === "battle";

  /**
   * 지금은 극성(polarity)만 버튼이 두 갈래다 — `dualChoiceActive`(battle.ts)
   * 하나가 그 기준이다. 나머지 예고·취약 창·상점 등은 자동 판단이 되므로
   * (`resolveIntent`) 여전히 버튼 하나다.
   *
   * **원버튼 폐기가 검토 중이다.** `dualChoiceActive`가 넓어지면(모든 예고에서
   * 산개/집결을 직접 고르는 쪽으로) 여기는 손댈 것이 없다 — 게이트 하나만
   * 보고 있어서다.
   */
  if (s.phase === "battle" && dualChoiceActive(s)) {
    const [left, right] = splitButton(L.button);
    drawButtonFace(ctx, left, armed, pulse, dualButtonText(s, "산개", "Space", "spc", left.w));
    drawButtonFace(ctx, right, armed, pulse, dualButtonText(s, "집결", "G", "G", right.w));
    return;
  }

  drawButtonFace(ctx, L.button, armed, pulse, buttonText(s));
}

type ButtonVariant = "primary" | "secondary";

/** 버튼 한 짝을 그린다. 주 행동과 보조 선택이 같은 상태 문법을 공유한다. */
function drawButtonFace(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  armed: boolean,
  pulse: boolean,
  label: string,
  variant: ButtonVariant = "primary",
): void {
  const idle = !armed;
  const secondary = variant === "secondary";
  const face = idle
    ? "rgba(239,224,198,0.07)"
    : secondary
      ? "rgba(48,34,27,0.98)"
      : T.action;
  const edge = idle
    ? "rgba(0,0,0,0.3)"
    : secondary
      ? "rgba(239,224,198,0.28)"
      : "#A85E1E";

  bevelPanel(
    ctx,
    r,
    r.h * 0.26,
    face,
    edge,
    idle ? 2 : Math.max(3, r.h * 0.08),
  );

  // 살아난 순간을 놓치지 않게 테두리가 한 번 밝아진다. 예고는 1.2초뿐이다.
  if (pulse && !secondary) {
    const p = motionPulse(150);
    ctx.save();
    roundRect(ctx, r, r.h * 0.26);
    ctx.strokeStyle = `rgba(255,255,255,${0.18 + p * 0.3})`;
    ctx.lineWidth = Math.max(2, r.h * 0.05);
    ctx.stroke();
    ctx.restore();
  }

  if (!idle && !secondary) {
    // 위쪽 하이라이트. 눌리는 물건처럼 보이게 하는 최소한의 장치.
    roundRect(
      ctx,
      {
        x: r.x + r.w * 0.06,
        y: r.y + r.h * 0.13,
        w: r.w * 0.88,
        h: r.h * 0.22,
      },
      r.h * 0.11,
    );
    ctx.fillStyle = "rgba(255,255,255,0.16)";
    ctx.fill();
  }

  // maxWidth를 넘긴다. 없으면 uiText가 줄이지 않아 긴 글이 상자 밖으로 샌다 —
  // 실제로 `Space 흩어져 · Shift 뭉쳐 6`이 버튼 오른쪽으로 삐져나와 있었다.
  uiText(
    ctx,
    label,
    r.x + r.w / 2,
    r.y + r.h / 2,
    secondary ? Math.max(12, r.h * 0.32) : Math.max(15, r.h * 0.36),
    idle ? T.muted : secondary ? T.paper : T.actionInk,
    {
      align: "center",
      weight: 800,
      maxWidth: r.w * 0.86,
    },
  );
}

/**
 * 안내 띠. 준비 단계에서는 이번 상대의 성격을 알려준다.
 * 무엇이 오는지 모르면 배치를 바꿀 이유가 없다.
 */
/**
 * 방금 깎인 체력이 따라오는 양(chip damage).
 *
 * 막대가 즉시 줄면 "얼마나 들어갔는지"가 안 보인다. 흰 꼬리가 0.4초쯤 늦게
 * 따라오면 한 방의 크기가 눈에 남는다. uid로 기억하되 보스는 한 번에 하나라
 * 이 맵은 항목 두엇을 넘지 않는다.
 */
const chipTrail = new Map<string, number>();

/**
 * 보스 전용 체력 배너.
 *
 * 일반 고양이와 같은 언어(더 넓은 막대)로는 "레이드가 시작됐다"가 전달되지
 * 않는다. 자리·두께·눈금 셋을 다르게 해서 다른 물건으로 만든다.
 *
 * 자리는 안내 문구 띠를 그대로 쓴다. 보스전 중에는 그 띠가 어차피 비어 있고
 * (안내는 배치 단계에만 뜬다), 새 자리를 떼면 판이 줄어 셀이 작아진다.
 *
 * 눈금은 `BOSS_THRESHOLDS` 그 자체다. 광역기가 나가는 지점이 화면에 없으면
 * 플레이어는 "왜 갑자기 터졌는지"를 배울 수 없다. 지나간 문턱은 흔적만 남기고,
 * 다음 문턱만 레몬으로 도드라진다 — 알아야 할 것은 언제나 다음 하나뿐이다.
 */
function drawBossBanner(
  ctx: CanvasRenderingContext2D,
  L: Layout,
  boss: Cat,
  stageBoss: boolean,
  stage: number,
  contract: RaidContract | null,
  seed: number,
): void {
  const r = L.notice;
  const sniper = boss.breed.id === SNIPER_BREED.id;
  // 스테이지 테마의 칭호. null이면(스테이지 2·3, 아직 미배선) 기존 문구를 쓴다.
  // 킷·수치는 안 건드리고 문구만 리스킨한다 — 저격수는 스테이지 무관 공용
  // 미니보스라 테마를 안 탄다.
  const titled = stageTheme(stage).bossTitles;
  // 저격수는 미니 보스다. 위계를 크기로 표현한다 — 같은 배너, 낮은 높이, 눈금 없음.
  const h = r.h * (sniper ? 0.72 : 1);
  const y = r.y + (r.h - h) / 2;
  const pad = h * 0.16;

  bevelPanel(ctx, { x: r.x, y, w: r.w, h }, h * 0.22, "rgba(14,10,8,0.82)", "rgba(0,0,0,0.5)", 2);

  // 왼쪽 — 이름과 격
  const nameSize = Math.max(10, h * 0.34);
  uiText(ctx, boss.breed.name, r.x + pad * 1.4, y + h * 0.36, nameSize, T.text, {
    align: "left",
    weight: 800,
  });
  // 격이 셋으로 갈린다 — 미니 보스(저격수) / 중간보스 / 스테이지 우두머리.
  // 우두머리만 금색이다. 판 위 고채도는 위험·모임·취약 셋뿐이라는 원칙에서
  // 취약(금색)과 같은 대역을 쓴다 — "이건 큰 사건"이라는 뜻으로 이미 학습된 색.
  uiText(
    ctx,
    // 페이즈 2 문구는 짧게 — 위계는 색이 말한다. 금색은 페이즈와 무관하게
    // 우두머리의 것이다: 가장 위험해지는 순간에 중간보스 색으로 강등되면
    // "격이 셋"이라는 위의 원칙이 스스로 깨진다(리뷰가 잡은 회귀).
    contract ? activeContractLine(contract, seed, "battle")
      : sniper ? "설핏 든 것"
      : titled ? (stageBoss ? (boss.phase2 ? titled.bossPhase2 : titled.bossPhase1) : titled.mid)
      : stageBoss && boss.phase2 ? "사나워진 우두머리" : stageBoss ? "이 땅의 우두머리" : "되풀이되는 것",
    r.x + pad * 1.4,
    y + h * 0.72,
    nameSize * 0.72,
    stageBoss && !sniper ? T.gold : T.enemy,
    { align: "left", weight: 700, maxWidth: Math.max(h * 3.2, r.w * 0.2) },
  );

  // 오른쪽 — 남은 페이즈. 숫자 하나로 "얼마나 남았나"가 잡힌다.
  const left = sniper ? 0 : Math.max(0, BOSS_THRESHOLDS.length - boss.thresholdIdx);
  const rightW = sniper ? pad : h * 1.5;
  if (!sniper) {
    numText(
      ctx,
      `${left}/${BOSS_THRESHOLDS.length}`,
      r.x + r.w - pad * 1.4,
      y + h * 0.5,
      Math.max(1, h * 0.055),
      left <= 1 ? T.vuln : T.paperDim,
      "right",
    );
  }

  // 가운데 — 막대. 일반 고양이 체력바가 5px 남짓이므로 여기서 확실히 두껍게.
  const barX = r.x + Math.max(r.w * 0.24, h * 4.4);
  const barW = r.x + r.w - rightW - pad - barX;
  const barH = h * 0.42;
  const barY = y + (h - barH) / 2;
  if (barW <= 4) return;

  const frac = Math.max(0, Math.min(1, boss.hp / boss.maxHp));
  const prev = chipTrail.get(boss.uid) ?? frac;
  // 위로는 즉시 따라붙고(부활·회복) 아래로만 천천히 따라온다.
  const chip = frac > prev ? frac : prev + (frac - prev) * 0.08;
  chipTrail.set(boss.uid, chip);

  roundRect(ctx, { x: barX, y: barY, w: barW, h: barH }, barH * 0.3);
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fill();

  // 방금 깎인 양이 흰 꼬리로 남는다.
  if (chip > frac + 0.002) {
    roundRect(ctx, { x: barX, y: barY, w: barW * chip, h: barH }, barH * 0.3);
    ctx.fillStyle = "rgba(255,255,255,0.16)";
    ctx.fill();
  }
  roundRect(ctx, { x: barX, y: barY, w: Math.max(barH * 0.6, barW * frac), h: barH }, barH * 0.3);
  // 체력바는 페이즈와 무관하게 같은 색 — 어둡게 바꾸면 트랙(검정 55%)과
  // 대비가 죽는다. 페이즈 전환은 phaseShift 충격파와 배너 문구가 이미 말한다.
  ctx.fillStyle = T.bossHp;
  ctx.fill();

  if (!sniper) {
    for (const t of BOSS_THRESHOLDS) {
      const tx = Math.round(barX + barW * t);
      const passed = frac <= t;
      // 다음에 올 문턱 하나만 레몬으로 세운다. 여섯을 다 세우면 아무것도 안 보인다.
      const next = !passed && BOSS_THRESHOLDS.filter((v) => v < frac)[0] === t;
      ctx.fillStyle = next
        ? T.vuln
        : passed
          ? "rgba(239,224,198,0.42)"
          : "rgba(239,224,198,0.18)";
      const tw = next ? 2 : 1;
      const th = next ? barH : barH * 0.7;
      ctx.fillRect(tx - tw / 2, barY + (barH - th) / 2, tw, th);
    }
  }

  // 퍼센트는 막대 안 오른쪽 끝에. 숫자를 밖에 두면 자리를 또 뗀다.
  numText(
    ctx,
    `${Math.round(frac * 100)}%`,
    barX + barW - barH * 0.4,
    barY + barH / 2,
    Math.max(1, barH * 0.11),
    T.paper,
    "right",
  );
}

let lastNoticeText = "";
let lastNoticeAt = 0;
/** 안내 문구가 바뀐 시각을 돌려준다. 보스 배너의 등장 애니메이션이 그 기준을 잰다. */
function trackNoticeChange(text: string): number {
  if (text !== lastNoticeText) {
    lastNoticeText = text;
    lastNoticeAt = performance.now();
  }
  return lastNoticeAt;
}

function drawNotice(
  ctx: CanvasRenderingContext2D,
  L: Layout,
  s: RunState,
): void {
  if (s.phase === "gameover") return;
  // 보스가 살아 있으면 이 띠는 배너에 넘긴다. 안내는 배치 단계 것이라 겹치지 않는다.
  const boss = s.enemy.find((c) => c?.alive && c.radius > 0);
  if (s.phase === "battle" && boss) {
    drawBossBanner(
      ctx,
      L,
      boss,
      boss.stageBoss === true,
      s.map.stage,
      s.nodeKind === "boss" ? s.raidContract : null,
      s.seed,
    );
    return;
  }
  const r = L.notice;
  const size = Math.max(11, r.h * 0.56);
  const cy = r.y + r.h / 2;
  const chipGeometry = s.raidContract && (s.phase === "map" || s.phase === "prepare" || s.phase === "reward")
    ? raidContractChipGeometry(L, s.raidContract, s.phase)
    : null;
  const showsKind =
    s.phase === "prepare" || (s.phase === "reward" && s.nodeKind !== "shop" && !s.notice);
  if (chipGeometry || showsKind || s.notice) {
    roundRect(ctx, r, Math.max(3, r.h * 0.18));
    ctx.fillStyle = "rgba(20,14,11,0.56)";
    ctx.fill();
    ctx.strokeStyle = "rgba(239,224,198,0.16)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  if (chipGeometry && s.raidContract) drawActiveRaidContractChip(ctx, chipGeometry, s.raidContract.risk);
  const body = chipGeometry?.content ?? r;
  const bodyCx = body.x + body.w / 2;

  /**
   * 이번에 싸울 상대의 성격을 알린다.
   *
   * **구매·배치를 합치면서 이 배너가 통째로 사라졌었다.** 조건이
   * `phase === "prepare"`뿐이었는데 UI가 그 화면을 안 그리게 됐기 때문이다.
   * 하필 이 게임이 파는 것이 "무엇과 싸울지 알고 산다"이고, 그 '무엇'을 글로
   * 말해 주는 자리가 여기 하나뿐이었다 — 기능을 합치면서 그 근거를 없앤 셈이다.
   *
   * 정찰 칸은 안 싸우므로 뺀다. `s.notice`가 있으면(정예 경고 등) 그쪽이
   * 이긴다 — 성격은 매 걸음 같은 자리에 뜨지만 안내는 그때만 뜨므로,
   * 겹치면 드문 쪽이 더 알릴 것이 있다.
   */
  if (showsKind) {
    // 웨이브 번호가 아니라 **고른 칸**이 성격을 정한다. `waveKind(s.wave)`를
    // 쓰던 동안 상점을 밟은 판에서 배너가 실제 적과 다른 이름을 달고 있었다.
    const info = waveKindInfo(currentKind(s));
    const nameW = ctx.measureText(info.name).width;
    if (chipGeometry) {
      uiText(ctx, `${info.name} — ${info.hint}`, bodyCx, cy, size * 0.94, T.paperDim, {
        align: "center",
        weight: 600,
        maxWidth: body.w * 0.94,
      });
      return;
    }
    uiText(
      ctx,
      info.name,
      L.w / 2 - nameW * 0.5 - r.h * 0.2,
      cy,
      size,
      T.action,
      {
        align: "right",
        weight: 800,
      },
    );
    uiText(ctx, info.hint, L.w / 2 - nameW * 0.5, cy, size * 0.94, T.paperDim, {
      align: "left",
      weight: 600,
      maxWidth: L.w / 2 + nameW * 0.5 - r.x - r.h,
    });
    return;
  }

  if (!s.notice) return;

  /**
   * 보스 처치 보너스만 다르게 그린다.
   *
   * 부검 통계에서 판이 끝나는 이유의 41%가 보스다 — 이 게임에서 가장 큰
   * 사건인데, "새 목표가 생겼어요" 같은 잔 안내와 같은 크기·색이면 묻힌다.
   * 금색으로 키우고, 등장을 한 박자 늘여 무게를 준다.
   *
   * `s.noticeKind`로 가른다. 문구("보스 처치!"로 시작하는지)로 갈랐다면
   * 나중에 카피를 다듬을 때 이 스타일이 아무 신호 없이 빠진다.
   */
  if (s.noticeKind === "boss") {
    const since = trackNoticeChange(s.notice);
    const grow = reducedMotion() ? 1 : Math.min(1, (performance.now() - since) / 260);
    const scale = 0.82 + 0.18 * easeOutCubic(grow);
    uiText(ctx, s.notice, bodyCx, cy, size * 1.3 * scale, T.gold, {
      align: "center",
      weight: 800,
      outline: true,
      maxWidth: body.w * 0.94,
    });
    return;
  }

  uiText(ctx, s.notice, bodyCx, cy, size, T.paperDim, {
    align: "center",
    weight: 600,
    maxWidth: body.w * 0.94,
  });
}

/** 죽은 화면의 세 갈래 버튼 자리. 그림(`drawGameOver`)과 히트테스트(main.ts)가 같이 쓴다. */
export interface GameoverGeometry {
  panel: Rect;
  choices: { retry: Rect; daily: Rect; challenge: Rect };
  /** 부검 줄 간격(px). 작은 화면에서는 하한이 붙고, 공간이 모자라면 scale 치수로 접는다. */
  lineH: number;
  /** 본문 글자 하한(px). 극저높이에서도 11px 아래로 접지 않는다. */
  fontFloor: number;
  /** 큰 숫자 중심과 부검 첫 줄. 렌더와 프로브가 같은 세로 흐름을 쓴다. */
  statY: number;
  firstLineY: number;
  /** 부검·기록 정보의 실제 마지막 픽셀과 선택 안내문 중심. */
  contentBottomY: number;
  choiceHintY: number;
}

/**
 * 부검 판의 기하.
 *
 * 줄 수가 판마다 다르므로(무엇에 막혔나 · 예고 성적 · 팀 · 판 종류 · 도감) 높이를
 * 여기서 한 번만 계산하고, 세 갈래 버튼은 판 바닥에 깐다. 버튼 높이는 손가락
 * 최소치(44px)를 지킨다 — `npm run probe`가 큰 버튼에 거는 기준과 같다.
 */
export function gameoverGeometry(L: Layout, s: RunState): GameoverGeometry {
  const compact = L.h < 360;
  const contextLines = compact
    ? 1
    : (s.telegraphsSeen > 0 ? 1 : 0) + 1 + (s.kind !== "free" ? 1 : 0) + 1;
  const lines =
    (s.lossReason === "timeout" || s.killer ? 1 : 0) +
    (s.raidContract || s.lastRaidContract ? 1 : 0) +
    contextLines;
  const choiceH = Math.max(44, L.scale * 40);
  // 폭 하한 260px — 320px 폰에서 scale(0.36)×560 = 199px로는 세 버튼이 손가락 폭(56px)에
  // 못 미친다. 화면의 86%를 넘지는 않는다.
  const panelW = Math.min(L.w * 0.86, Math.max(260, L.scale * 560));
  /**
   * 줄 간격·글자·버튼 위 여백에 **픽셀 하한**을 둔다. 폰 세로(390px)에서 scale이 0.43이라
   * 20×0.43 = 8.6px 줄 간격에 6px 글자가 겹쳤고, 버튼(40px 하한)은 안 줄어 라벨을 덮었다.
   * 그런데 하한을 두면 납작한 가로 화면(667×275)에서는 판이 큰 버튼 위 공간에 안 들어간다.
   * 그래서 **모자라면 정보와 여백을 접는다** — 글자 하한을 깨서 공간을 만드는 대신
   * 극저높이는 예고·팀·도감·기록을 한 줄로 요약한다.
   */
  const avail = L.button.y - Math.max(6, L.scale * 10) - 4;
  let lineH = Math.max(compact ? 14 : 16, L.scale * 20);
  const fontFloor = 11;
  let inset = Math.max(compact ? 8 : 10, L.scale * 12);
  let extra = compact
    ? Math.max(22, L.scale * 24)
    : Math.max(30, L.scale * 30) + Math.max(0, 12 - L.scale * 12) * 2 + uiSpace(L.scale, 3);
  let lead = compact ? Math.max(72, L.scale * 128) : Math.max(88, L.scale * 174);
  let panelH = lead + lines * lineH + choiceH + extra;
  if (panelH > avail) {
    // 마지막 접힘에서도 글자를 줄이지 않는다. 여백과 숫자 머리 구역만 압축한다.
    lineH = Math.max(13, L.scale * 18);
    inset = Math.max(8, L.scale * 10);
    extra = Math.max(16, L.scale * 20);
    lead = compact ? Math.max(62, L.scale * 112) : Math.max(78, L.scale * 150);
    panelH = lead + lines * lineH + choiceH + extra;
  }
  // 버튼 위로만 쓴다. 아래로 내려가면 유일한 행동이 판에 깔린다.
  const top = Math.max(L.scale * 10, (L.button.y - panelH) / 2);
  const panel: Rect = { x: L.w / 2 - panelW / 2, y: top, w: panelW, h: panelH };
  const gap = uiSpace(L.scale, compact ? 2 : 3);
  const cw = (panel.w - inset * 2 - gap * 2) / 3;
  const cy = panel.y + panel.h - inset - choiceH;
  const at = (i: number): Rect => ({ x: panel.x + inset + i * (cw + gap), y: cy, w: cw, h: choiceH });
  const choices = { retry: at(0), daily: at(1), challenge: at(2) };
  const statY = panel.y + (compact ? Math.max(34, L.scale * 56) : Math.max(48, L.scale * 76));
  const statPx = Math.max(3, Math.round(L.scale * 9));
  const statH = numTextHeight(statPx);
  const statGap = Math.max(8, L.scale * 12);
  const firstLineY = statY + statH / 2 + statGap * 2.6;
  const afterLinesY = firstLineY + lines * lineH;
  const contentBottomY = compact
    ? firstLineY + Math.max(0, lines - 1) * lineH + Math.max(fontFloor, L.scale * 13) / 2
    : afterLinesY + L.scale * 6 + Math.max(6, L.scale * 9) + Math.max(12, L.scale * 14) + Math.max(fontFloor, L.scale * 14) / 2;
  const choiceHintY = choices.retry.y - Math.max(10, L.scale * 11);
  return { panel, choices, lineH, fontFloor, statY, firstLineY, contentBottomY, choiceHintY };
}

let codexCacheFor: RunState | null = null;
let codexCache: Codex = { breeds: [], relics: [], bosses: [] };

/** 죽은 화면은 매 프레임 그려지므로 도감은 판(RunState)당 한 번만 읽는다. */
function codexFor(s: RunState): Codex {
  if (codexCacheFor !== s) {
    codexCache = loadCodex();
    codexCacheFor = s;
  }
  return codexCache;
}

function modeLabel(s: RunState): string {
  if (s.kind === "daily") return `오늘의 시드 ${s.dailyKey ?? ""}`.trim();
  if (s.kind === "challenge") return `도전 ${s.challenge} · 적 +${Math.round(BALANCE.challengeStep * s.challenge * 100)}%`;
  if (s.kind === "retry") return "같은 시드로 다시 한 판";
  return "";
}

/** HUD·부검 막대가 쓰는 기록 이름. 판 종류별로 잣대가 다르다. */
function recordCaption(s: RunState): string {
  if (s.kind === "daily") return "오늘 최고";
  if (s.kind === "challenge") return `도전 ${s.challenge} 최고`;
  return "최고 기록";
}

function drawGameOver(
  ctx: CanvasRenderingContext2D,
  L: Layout,
  s: RunState,
): void {
  if (s.phase !== "gameover") return;
  ctx.fillStyle = "rgba(14,10,8,0.86)";
  ctx.fillRect(0, 0, L.w, L.h);

  /**
   * 부검을 판 하나에 담는다.
   *
   * 처음엔 화면 한가운데 글자만 얹었더니 아래 시너지 바와 직업 카운터가 어둠막
   * 너머로 비쳐 글자와 겹쳤다. 읽어야 할 것과 이미 끝난 것이 같은 자리에서
   * 싸우면 둘 다 안 읽힌다. 판을 깔아 안팎을 가른다.
   */
  const { panel, choices, lineH, fontFloor, statY, firstLineY, choiceHintY } = gameoverGeometry(L, s);
  const compact = L.h < 360;
  const font = (base: number): number => Math.max(fontFloor, L.scale * base);
  bevelPanel(ctx, panel, L.scale * 12, "rgba(20,14,11,0.94)", "rgba(0,0,0,0.6)", 2);

  const cy = statY;
  const px = Math.max(3, Math.round(L.scale * 9));
  const num = String(s.wave);
  // 라벨 자리를 숫자의 **실제 높이**에서 뽑는다. 상수로 두면 화면 배율이 바뀔 때
  // "도달"과 "웨이브"가 숫자 위로 올라탄다(1280x800에서 실제로 그랬다).
  const numH = numTextHeight(px);
  // 라벨과 숫자 사이 — 글자에 하한을 두었으므로 간격에도 하한을 둔다(폰에서 라벨이 숫자에 닿았다).
  const gap = Math.max(fontFloor > 0 ? 8 : 0, L.scale * 12);

  uiText(ctx, "악몽", L.w / 2, cy - numH / 2 - gap, font(15), T.muted, {
    align: "center",
    weight: 800,
  });
  numText(ctx, num, L.w / 2, cy, px, T.paper, "center", false);
  uiText(ctx, "깊이", L.w / 2, cy + numH / 2 + gap, font(16), T.muted, {
    align: "center",
    weight: 800,
  });

  /**
   * 부검.
   *
   * 숫자 하나로 끝나면 12분을 쓰고도 "다음엔 뭘 다르게 하지"에 답이 없다.
   * 세 줄만 준다 — **무엇에 막혔는가 · 예고를 얼마나 읽었는가 · 어떤 팀이었는가.**
   * 측정상 가장 큰 결정 축이 개입이고 판이 끝나는 이유의 41%가 보스라서,
   * 그 둘이 첫 두 줄이다. 더 얹으면 읽히지 않는다.
   */
  let ly = firstLineY;
  const line = (text: string, color: string, weight = 400): void => {
    uiText(ctx, text, L.w / 2, ly, font(13), color, { align: "center", weight, maxWidth: panel.w - L.scale * 24 });
    ly += lineH;
  };

  if (s.lossReason === "timeout") {
    line("시간이 다 됐어요 · 화력이 조금 모자랐어요", T.enemy, 800);
  } else if (s.killer) {
    const hp = Math.round(s.killer.hpFrac * 100);
    line(
      s.killer.boss
        ? `${s.killer.name}에게 막혔어요 · 체력 ${hp}%를 남기고`
        : `${s.killer.name} 무리에게 당했어요`,
      T.enemy,
      800,
    );
  }

  const debriefContract = s.nodeKind === "boss" ? s.raidContract : s.lastRaidContract;
  if (debriefContract) {
    line(
      s.nodeKind === "boss"
        ? `계약 ${activeContractLine(debriefContract, s.seed, "debrief")}`
        : `계약 ${debriefContract.name} 완료 · 누적 생선 +${s.raidBonusFish}`,
      T.gold,
      800,
    );
  } else if (s.raidContract) {
    line(`다음 계약 ${s.raidContract.name} · ${raidShareCode(s.seed, s.raidContract.id)}`, T.paperDim, 800);
  }

  // 살아남은 고양이가 아니라 **데리고 있던** 고양이를 센다. 전멸한 판에서
  // livingCats를 쓰면 전부 0이 떠서 어떤 팀이었는지가 사라진다.
  const cats = s.ally.filter((c): c is Cat => c !== null);
  const by = zeroByClass();
  for (const c of cats) by[c.breed.cls] += 1;
  const team = CLASS_ORDER.map((c) => `${CLASS_SHORT[c]}${by[c]}`).join(" ");
  const cx = codexFor(s);
  if (compact) {
    const read = Math.max(0, s.telegraphsSeen - s.telegraphsEaten);
    const seen = cx.breeds.length + cx.relics.length + cx.bosses.length;
    const total = CODEX_TOTALS.breeds + CODEX_TOTALS.relics + CODEX_TOTALS.bosses;
    const mode = s.kind === "daily"
      ? " · 오늘"
      : s.kind === "challenge"
        ? ` · 도전 ${s.challenge}`
        : s.kind === "retry"
          ? " · 재도전"
          : "";
    line(`예고 ${read}/${s.telegraphsSeen} · 팀 ${cats.length} · 유물 ${s.relics.length} · 도감 ${seen}/${total} · 최고 ${s.modeBest}${mode}`, T.muted, 800);
  } else {
    // 예고 성적. 보스를 한 번도 안 만난 판에는 뜨지 않는다.
    if (s.telegraphsSeen > 0) {
      const read = s.telegraphsSeen - s.telegraphsEaten;
      const rate = Math.round((read / s.telegraphsSeen) * 100);
      line(
        `예고 ${s.telegraphsSeen}번 중 ${read}번 피함 (${rate}%)`,
        rate >= 70 ? T.gather : rate >= 40 ? T.paperDim : T.danger,
        800,
      );
    }
    line(s.relics.length > 0 ? `${team} · ${s.relics.map((r) => r.name).join(" · ")}` : team, T.muted);
    if (s.kind !== "free") line(modeLabel(s), T.paperDim, 800);
    line(
      `도감  고양이 ${cx.breeds.length}/${CODEX_TOTALS.breeds} · 유물 ${cx.relics.length}/${CODEX_TOTALS.relics} · 보스 ${cx.bosses.length}/${CODEX_TOTALS.bosses}`,
      T.muted,
    );
  }

  /**
   * 최고 기록 대비 막대.
   *
   * "12웨이브"는 잘한 건지 못한 건지 알 수 없는 숫자다. 자기 최고 기록 옆에
   * 놓으면 그때서야 뜻이 생긴다 — 거의 다 왔는지, 한참 못 미쳤는지.
   */
  if (!compact) {
    const goal = Math.max(s.modeBest, s.wave, 1);
    const bw = Math.min(L.w * 0.5, L.scale * 320);
    const bh = Math.max(6, L.scale * 9);
    const bx = L.w / 2 - bw / 2;
    const byy = ly + L.scale * 6;
    roundRect(ctx, { x: bx, y: byy, w: bw, h: bh }, bh / 2);
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fill();
    roundRect(ctx, { x: bx, y: byy, w: Math.max(bh, (bw * s.wave) / goal), h: bh }, bh / 2);
    ctx.fillStyle = s.recordBroken ? T.gold : T.ally;
    ctx.fill();
    // 최고 기록 눈금. 갱신한 판에는 내가 그 눈금이므로 그리지 않는다.
    if (!s.recordBroken && s.modeBest > 0) {
      const tx = bx + (bw * s.modeBest) / goal;
      ctx.fillStyle = T.gold;
      ctx.fillRect(tx - 1, byy - bh * 0.35, 2, bh * 1.7);
    }

    uiText(
      ctx,
      s.recordBroken ? `${recordCaption(s)} 갱신` : `${recordCaption(s)} 깊이 ${s.modeBest}`,
      L.w / 2,
      byy + bh + Math.max(12, L.scale * 14),
      font(14),
      s.recordBroken ? T.gold : T.muted,
      { align: "center", weight: 800 },
    );
  }

  /**
   * 다음 판 세 갈래 — 같은 시드 · 오늘의 시드 · 도전 +1.
   *
   * 큰 버튼("다시 도전")은 같은 종류로 한 판 더이고, 여기 셋은 종류를 바꾼다.
   * 부검 바로 아래 두는 이유는 "다음엔 뭘 다르게 하지"의 답이 나온 자리에서
   * 바로 고르게 하려는 것이다 — 같은 판을 다시(내 선택 탓인지), 모두와 같은
   * 판을(오늘의 시드), 더 센 판을(도전). 히트테스트는 `gameoverGeometry`를
   * main.ts가 같이 써서 그림과 어긋나지 않는다.
   */
  uiText(
    ctx,
    `도전은 단계마다 적 +${Math.round(BALANCE.challengeStep * 100)}% · 기록은 종류별로 따로 남는다`,
    L.w / 2,
    choiceHintY,
    Math.max(11, L.scale * 11),
    T.muted,
    { align: "center", maxWidth: panel.w - L.scale * 24 },
  );
  drawButtonFace(ctx, choices.retry, true, false, "1 같은 판", "secondary");
  drawButtonFace(ctx, choices.daily, true, false, "2 오늘", "secondary");
  drawButtonFace(ctx, choices.challenge, true, false, "3 도전+", "secondary");
}

/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* 막 — 판·여정의 경계에서 한 번 나왔다 사라지는 화면                     */
/* ------------------------------------------------------------------ */

/**
 * 전환 막.
 *
 * 지금까지 판이 시작되는지, 여정이 넘어가는지, 보스를 넘었는지가 화면에서
 * 구분되지 않았다. 상점 → 지도 → 배치 → 전투가 같은 무게로 이어져서 **어디가
 * 마디인지**가 없었다. 마디가 없으면 12분이 한 덩어리로 느껴진다.
 *
 * 막은 렌더러만 안다. `RunState`에 넣지 않은 이유는 헤드리스 시뮬이 이걸 알
 * 필요가 없어서다 — 연출은 판정과 분리한다는 이 저장소의 규칙 그대로다.
 * 대신 상태의 **변화를 렌더러가 관찰**해서 스스로 띄운다.
 */
interface Curtain {
  title: string;
  sub: string;
  life: number;
  max: number;
}

const CURTAIN_MS = 1500;
const CURTAIN_REDUCED_MS = 420;
let curtain: Curtain | null = null;
let curtainAt = 0;
/** 무엇이 바뀌었는지 알려면 직전 값을 들고 있어야 한다. */
let seenSeed = -1;
let seenStage = -1;
let seenBosses = -1;

function raise(title: string, sub: string): void {
  const life = reducedMotion() ? CURTAIN_REDUCED_MS : CURTAIN_MS;
  curtain = { title, sub, life, max: life };
}

/** 상태의 변화를 보고 막을 올린다. 게임 코드는 이걸 모른다. */
function watchTransitions(s: RunState): void {
  const bosses = bossesSeen(s);

  if (s.seed !== seenSeed) {
    // 새 판. 시드가 곧 판의 신원이다.
    seenSeed = s.seed;
    seenStage = s.map.stage;
    seenBosses = bosses;
    raise("냥 아레나", "집사님, 오늘 밤도 잘 부탁해요");
    return;
  }
  // 보스를 넘은 것이 먼저다. 넘는 순간 여정도 함께 바뀌는 경우가 있는데,
  // 그때 여정 안내만 뜨면 방금 해낸 일이 화면에서 사라진다.
  if (bosses > seenBosses) {
    seenBosses = bosses;
    seenStage = s.map.stage;
    raise("악몽을 밀어냈어요", `악몽 깊이 ${s.wave - 1}까지 나아갔어요`);
    return;
  }
  if (s.map.stage !== seenStage) {
    seenStage = s.map.stage;
    const theme = stageTheme(s.map.stage);
    // backdropScene이 있는 스테이지(지금은 1뿐)만 이름·부제를 새로 건다.
    // 없는 스테이지(2·3, 아직 미배선)는 기존 문구 그대로 — "테마 레코드만
    // 자리 잡아 둔다"는 이번 웨이브의 경계를 배너 문구에도 그대로 지킨다.
    if (theme.backdropScene) raise(`${s.map.stage}번째 밤 · ${theme.name}`, theme.subtitle);
    else raise(`${s.map.stage}번째 밤`, "여섯 걸음 안에 악몽이 둘 있어요");
  }
}

/**
 * 막을 그린다. 들어올 때 빠르고 나갈 때 느리다 — 정보는 즉시 주고,
 * 사라지는 것은 눈이 따라올 수 있게.
 */
function drawCurtain(ctx: CanvasRenderingContext2D, L: Layout): void {
  if (!curtain) return;
  const now = performance.now();
  const dt = curtainAt ? Math.min(48, now - curtainAt) : 16;
  curtainAt = now;
  curtain.life -= dt;
  if (curtain.life <= 0) {
    curtain = null;
    return;
  }

  const t = 1 - curtain.life / curtain.max; // 0 → 1
  // 앞 12%에 들어오고, 뒤 35%에 나간다.
  const alpha = reducedMotion()
    ? 1
    : t < 0.12
      ? t / 0.12
      : t > 0.65
        ? 1 - (t - 0.65) / 0.35
        : 1;
  const a = Math.max(0, Math.min(1, alpha));

  ctx.save();
  ctx.globalAlpha = a;
  ctx.fillStyle = "rgba(9,6,5,0.9)";
  ctx.fillRect(0, 0, L.w, L.h);

  const cy = L.h / 2;
  // 위아래 선. 글자만 있으면 떠 있는 자막처럼 보인다.
  const lw = Math.min(L.w * 0.6, L.scale * 420);
  ctx.strokeStyle = `rgba(244,227,193,${0.35 * a})`;
  ctx.lineWidth = Math.max(1, L.scale * 1.5);
  for (const dy of [-L.scale * 40, L.scale * 40]) {
    ctx.beginPath();
    ctx.moveTo(L.w / 2 - lw / 2, cy + dy);
    ctx.lineTo(L.w / 2 + lw / 2, cy + dy);
    ctx.stroke();
  }

  uiText(ctx, curtain.title, L.w / 2, cy - L.scale * 8, L.scale * 30, T.paper, {
    align: "center",
    weight: 800,
  });
  uiText(ctx, curtain.sub, L.w / 2, cy + L.scale * 20, L.scale * 14, T.paperDim, {
    align: "center",
    weight: 400,
  });
  ctx.restore();
}

/** 보스 출현은 전투 상태를 관찰하는 렌더 전용 사건이다. */
interface BossArrival {
  scale: number;
  alpha: number;
}

let arrivalBossUid: string | null = null;
let arrivalBossElapsed = 0;
let arrivalFrameAt = 0;

function bossArrival(s: RunState): BossArrival | null {
  const boss =
    s.phase === "battle" ? s.enemy.find((c) => c?.alive && c.radius > 0) : undefined;
  if (!boss) {
    arrivalBossUid = null;
    arrivalBossElapsed = 0;
    arrivalFrameAt = 0;
    return null;
  }

  const now = performance.now();
  if (boss.uid !== arrivalBossUid) {
    arrivalBossUid = boss.uid;
    arrivalBossElapsed = 0;
    arrivalFrameAt = now;
  } else {
    // 숨김 탭에서는 rAF가 멈춘다. 절대시간을 빼면 그동안 연출만 소진되므로,
    // 실제로 그린 프레임의 간격만 최대 48ms씩 누적한다.
    arrivalBossElapsed += arrivalFrameAt ? Math.min(48, now - arrivalFrameAt) : 16;
    arrivalFrameAt = now;
  }

  const sniper = boss.breed.id === SNIPER_BREED.id;
  const reduce = reducedMotion();
  const duration = reduce ? (sniper ? 180 : 240) : sniper ? 420 : boss.stageBoss === true ? 680 : 560;
  const raw = Math.max(0, arrivalBossElapsed / duration);
  if (raw >= 1) return null;

  const settled = easeOutCubic(raw);
  const zoom = sniper ? 0.018 : boss.stageBoss === true ? 0.035 : 0.028;
  return {
    scale: reduce ? 1 : 1 + zoom * (1 - settled),
    // 모션 축소에서는 짧게 같은 프레임만 보여 주고 이동·확대는 없다.
    alpha: reduce ? 0.18 : (sniper ? 0.16 : 0.24) * (1 - settled),
  };
}

/**
 * 출현 프레임은 판 안에만 깐다. HUD·버튼까지 어두워지면 조작 불능처럼 보이고,
 * 채도 높은 새 색을 쓰면 예고 신호 셋과 경쟁하므로 종이색 명암만 쓴다.
 */
function drawBossArrivalFrame(ctx: CanvasRenderingContext2D, L: Layout, arrival: BossArrival): void {
  const r = arenaBox(L);
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const radius = Math.hypot(r.w, r.h) / 2;

  ctx.save();
  roundRect(ctx, r, L.cell * 0.22);
  ctx.clip();
  const shade = ctx.createRadialGradient(cx, cy, Math.min(r.w, r.h) * 0.16, cx, cy, radius);
  shade.addColorStop(0, "rgba(9,6,5,0)");
  shade.addColorStop(1, `rgba(9,6,5,${arrival.alpha})`);
  ctx.fillStyle = shade;
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = Math.min(0.7, arrival.alpha * 2.6);
  roundRect(ctx, r, L.cell * 0.22);
  ctx.strokeStyle = T.paperDim;
  ctx.lineWidth = Math.max(1, L.cell * 0.035);
  ctx.stroke();
  ctx.restore();
}

/**
 * 보스가 죽는 순간의 화면 흔들림.
 *
 * battle.ts는 카메라를 모른다 — `bossdeath` kind의 Fx가 `fxs`에 살아 있는
 * 동안만 여기서 오프셋을 계산해 판 그림 전체에 얹는다. 위쪽 `drawFx` 근처
 * 주석대로 일반 타격에는 흔들림을 안 넣었다(예고를 읽는 도중 방해될 여지가
 * 측정 전이라). 보스가 죽은 뒤에는 그 보스가 걸었던 예고가 이미 지워졌으므로
 * (`damage`가 `telegraph`를 null로 만든다) 더 읽을 예고가 없다 — 그래서
 * 이 한 경우만 예외로 켠다.
 */
function bossDeathShake(L: Layout): { x: number; y: number } {
  if (reducedMotion()) return { x: 0, y: 0 };
  const dead = fxs.find((f) => f.kind === "bossdeath");
  if (!dead) return { x: 0, y: 0 };
  // 위상은 Fx에 실려 온다. s.step은 처치 직후 finishWave가 올려 못 믿는다.
  const stageBoss = dead.stageBoss === true;
  const t = 1 - dead.life / dead.maxLife;
  const decay = (1 - t) ** 2;
  // 우두머리는 더 크게 흔든다. 중간보스와 같은 진동이면 "더 큰 사건"이라는
  // 위상이 소리 없이 사라진다 — 수명은 battle이 정하므로 여기서는 진폭만.
  const mag = L.cell * (stageBoss ? 0.26 : 0.16) * decay;
  // 진동의 위상은 `life`(연출 남은 시간)에서 뽑는다 — 헤드리스 시뮬은 이 함수를
  // 아예 안 부르므로 결정성 문제는 없지만, performance.now() 대신 연출 자체의
  // 시간축을 쓰면 흔들림이 항상 이 Fx의 수명과 같은 리듬으로 움직인다.
  const wob = dead.life * 0.09;
  return { x: Math.sin(wob) * mag, y: Math.cos(wob * 1.3) * mag * 0.7 };
}

/**
 * 최종 국면(finalPhase, US-404) 연출 — 화면이 어두워지고 보스가 빛난다.
 *
 * battle.ts는 상태(`Cat.finalPhase`의 `stage`·`remainMs`)만 들고 있다.
 * "얼마나 어두워지는지"·"얼마나 빛나는지"는 전부 연출의 몫이라 여기서
 * 계산한다 — 지워도 전투 결과는 같다. "구원 플래시"(채널이 끝나며 아군이
 * 회복하는 순간)는 새 연출을 안 만든다 — battle.ts가 그 순간 이미 힐 팝업과
 * `ring` Fx를 쏘아 올리므로(기존 힐 연출과 같은 경로) 여기서는 화면
 * 어두워짐·보스 발광 둘만 얹는다.
 */
function drawFinalPhaseOverlay(ctx: CanvasRenderingContext2D, L: Layout, s: RunState): void {
  const boss = s.enemy.find((c) => c?.alive && c.finalPhase);
  if (!boss || !boss.finalPhase) return;
  const { stage, remainMs, totalMs } = boss.finalPhase;

  // 화면 어두워짐 — 채널 동안만, **판(arenaBox) 안에서만**. `drawArena`가
  // 채우는 것과 같은 영역이라 HUD·안내 문구는 안 어두워진다(`bossDeathShake`
  // 주석과 같은 원칙 — "판·고양이·연출만" 흔들거나 어두워져야 한다).
  if (stage === "channel") {
    const t = totalMs > 0 ? 1 - Math.max(0, remainMs) / totalMs : 1;
    ctx.save();
    roundRect(ctx, arenaBox(L), L.cell * 0.22);
    ctx.fillStyle = `rgba(6,4,3,${0.12 + t * 0.4})`;
    ctx.fill();
    ctx.restore();
  }

  // 보스 발광 — 채널 내내 맥동하고, 마지막 창에서는 옅게 남는다.
  const { x: bx, y: by } = fieldToScreen(L, boss.fx, boss.fy);
  const size = catBodySize(L, boss.radius, boss.sizeMul);
  const pulse = motionPulse(180);
  const r = size * (0.7 + pulse * 0.18);
  const g = ctx.createRadialGradient(bx, by, size * 0.2, bx, by, r);
  const glowAlpha = stage === "channel" ? 0.5 + pulse * 0.25 : 0.2;
  g.addColorStop(0, `rgba(240,186,74,${glowAlpha})`);
  g.addColorStop(1, "rgba(240,186,74,0)");
  ctx.save();
  ctx.beginPath();
  ctx.arc(bx, by, r, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();
}

export function render(
  ctx: CanvasRenderingContext2D,
  L: Layout,
  s: RunState,
  drag: DragState,
  hoverCell: number,
  phaseLocked = false,
): void {
  const interaction = uiInteractionDescriptor(L, s, drag, phaseLocked);
  ctx.canvas.style.cursor = interaction.cursor;
  watchRaidContractChoice(s);
  drawBackground(ctx, L, s);
  drawArena(ctx, L);
  drawHud(ctx, L, s);
  drawMute(ctx, L, isMuted());

  // 판·고양이·연출만 흔든다. HUD·상점·지도까지 흔들리면 화면 전체가 고장난
  // 것처럼 보인다.
  const shake = bossDeathShake(L);
  const arrival = bossArrival(s);
  ctx.save();
  ctx.translate(shake.x, shake.y);
  if (arrival && arrival.scale !== 1) {
    const arena = arenaBox(L);
    const cx = arena.x + arena.w / 2;
    const cy = arena.y + arena.h / 2;
    ctx.translate(cx, cy);
    ctx.scale(arrival.scale, arrival.scale);
    ctx.translate(-cx, -cy);
  }

  /**
   * 지도 국면은 `drawMap`이 화면 전체를 0.98 알파로 덮는다. 그 아래 판·고양이·연출·하단 띠는
   * 보이지 않는데도 매 프레임 1,000번 가까이 그려지고 있었다(지도 프레임의 60~70%). 덮일 것은
   * 건너뛴다 — 배경·HUD는 남겨 0.98 너머로 비치는 색이 그대로다.
   */
  const covered = s.phase === "map";
  if (covered) {
    ctx.restore();
    drawMap(ctx, L, s, interaction);
    drawNotice(ctx, L, s);
    drawButton(ctx, L, s);
    drawRaidContractChoiceFeedback(ctx, L);
    drawUiHoverFeedback(ctx, L, s, interaction);
    watchTransitions(s);
    drawCurtain(ctx, L);
    drawInteractionFeedback(ctx, L, s);
    return;
  }

  drawDivider(ctx, L);
  drawSideLabels(ctx, L);
  drawBoard(ctx, L, "ally", T.ally, hoverCell);
  drawBoard(ctx, L, "enemy", T.enemy, -1);
  if (arrival) drawBossArrivalFrame(ctx, L, arrival);
  drawTelegraphs(ctx, L, s);
  drawCreepZones(ctx, L, creepZones);

  // 화면 아래쪽 고양이가 위에 그려지도록 y로 정렬한다.
  // 전투 중에는 양쪽이 뒤섞이므로 이게 없으면 겹칠 때 앞뒤가 뒤집혀 보인다.
  const drawList: { cat: Cat; y: number; dimmed: boolean }[] = [];
  for (let i = 0; i < BOARD_SIZE; i++) {
    const e = s.enemy[i];
    if (e)
      drawList.push({
        cat: e,
        y: fieldToScreen(L, e.fx, e.fy).y,
        dimmed: false,
      });
    const a = s.ally[i];
    if (a) {
      drawList.push({
        cat: a,
        y: fieldToScreen(L, a.fx, a.fy).y,
        dimmed: drag.active && drag.fromCell === i,
      });
    }
  }
  // 소환수는 보드가 아니라 state.summons에 산다. 같은 목록에 넣어야
  // 겹칠 때 앞뒤가 맞는다.
  for (const sm of s.summons) {
    if (!sm.alive) continue;
    drawList.push({ cat: sm, y: fieldToScreen(L, sm.fx, sm.fy).y, dimmed: false });
  }
  drawList.sort((p, q) => p.y - q.y);
  for (const d of drawList) drawCat(ctx, L, d.cat, d.dimmed, s.map.stage);
  // 인접 보너스 표시 — 배치하는 동안만. 같은 직업이 붙은 고양이 위에 얻는 공격 보너스를 적는다.
  // 규칙을 글로 설명하는 대신 효과를 그 자리에 보여준다. 전투 중에는 숫자 팝과 겹쳐 뺀다.
  if (BALANCE.adjacencyAtk > 0 && s.phase !== "battle" && s.phase !== "gameover") {
    for (const cat of s.ally) {
      if (!cat || !cat.alive) continue;
      const n = sameClassNeighbors(s.ally, cat);
      if (n === 0) continue;
      const pct = Math.round(BALANCE.adjacencyAtk * Math.min(BALANCE.adjacencyMax, n) * 100);
      const p = fieldToScreen(L, cat.fx, cat.fy);
      uiText(ctx, `+${pct}%`, p.x, p.y - L.cell * 0.72, Math.max(10, L.cell * 0.26), T.gold, {
        align: "center",
        weight: 800,
        outline: true,
      });
    }
  }
  drawBossTargetMark(ctx, L, s);
  drawSeizeMark(ctx, L, s);

  drawFx(ctx, L);
  drawShots(ctx, L);
  // 최종 국면(finalPhase) 연출 — 고양이·연출 위, 데미지 숫자 아래. 숫자가
  // 어두워진 화면에서도 그대로 읽혀야 "얼마나 회복했는지"가 안 묻힌다.
  drawFinalPhaseOverlay(ctx, L, s);

  // 드래그 중인 고양이는 손가락을 따라다닌다.
  if (drag.active) {
    const cat = s.ally[drag.fromCell];
    if (cat) {
      const size = L.cell * CAT_SCALE;
      const frame = spriteFor(cat.breed.id, "move");
      ctx.save();
      ctx.globalAlpha = 0.95;
      if (frame)
        drawSpriteFrame(ctx, frame, drag.x - size / 2, drag.y - size / 2, size);
      else
        drawCatFallback(ctx, drag.x - size / 2, drag.y - size / 2, size, T.ally);
      ctx.restore();
    }
  }

  drawPops(ctx, L, s);
  ctx.restore();

  drawBottomZone(ctx, L, s);
  drawBuyTweens(ctx, L);
  drawSynergies(ctx, L, s);
  drawMap(ctx, L, s, interaction);
  drawNotice(ctx, L, s);
  // 부검을 먼저 깔고 버튼을 그 위에 올린다. 순서가 반대면 전면 어둠막이 버튼까지
  // 덮어서, 유일하게 누를 수 있는 물건이 비활성처럼 보였다.
  drawGameOver(ctx, L, s);
  drawButton(ctx, L, s);
  drawRaidContractChoiceFeedback(ctx, L);
  drawUiHoverFeedback(ctx, L, s, interaction);
  // 막은 맨 위다. 아래에 무엇이 있든 전환이 전환으로 읽혀야 한다.
  watchTransitions(s);
  drawCurtain(ctx, L);
  drawInteractionFeedback(ctx, L, s);
}
