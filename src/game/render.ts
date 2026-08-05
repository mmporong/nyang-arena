import { damagePops, POP_LIFE_MS, shots, SHOT_LIFE_MS } from "./battle.ts";
import { cellRect, fieldToScreen, type Layout, type Rect } from "./layout.ts";
import { spriteFor } from "./sprites.ts";
import { boardUnits, type Offer, type RunState } from "./run.ts";
import { bevelPanel, pixelText, pixelTextWidth, roundRect, T, uiText } from "./theme.ts";
import { effectLabel, synergyProgress, triggerLabel } from "../validate/synergy-schema.ts";
import { BOARD_SIZE, livingCats, type Cat, type Side } from "./types.ts";

/**
 * 셀 대비 고양이 그리기 크기.
 * 작을수록 전장이 넓어 보이고 유닛이 겹칠 일이 줄어든다.
 * 체력바·뱃지는 셀이 아니라 이 크기에 비례시켜야 축소해도 비율이 안 깨진다.
 */
const CAT_SCALE = 0.66;

/** 시너지 트리거마다 고유색. TFT가 특성별로 색을 나누는 것과 같은 이유 — 한눈에 구분되게. */
const TRIGGER_COLOR: Record<string, string> = {
  same_color_3: "#E8913C",
  same_breed_2: "#C97BD4",
  front_melee_2: "#E8654A",
  back_ranged_2: "#6FB6DC",
};

export interface DragState {
  active: boolean;
  fromCell: number;
  x: number;
  y: number;
  /** 드래그를 시작한 포인터. 멀티터치에서 다른 손가락이 끼어드는 걸 막는다. */
  pointerId: number;
}

/* ------------------------------------------------------------------ */
/* 배경과 아레나                                                        */
/* ------------------------------------------------------------------ */

function drawBackground(ctx: CanvasRenderingContext2D, L: Layout): void {
  ctx.fillStyle = T.ink;
  ctx.fillRect(0, 0, L.w, L.h);

  // 아레나 바닥에만 빛이 드는 느낌. 전장이 어디인지 색으로 말한다.
  const cx = (L.allyBoard.x + L.allyBoard.w + L.enemyBoard.x) / 2;
  const cy = (L.allyBoard.y + L.enemyBoard.y + L.enemyBoard.h) / 2;
  const rad = Math.max(L.w, L.h) * 0.55;
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
  g.addColorStop(0, "rgba(232,145,60,0.10)");
  g.addColorStop(0.55, "rgba(232,145,60,0.03)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
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
  const right = Math.max(L.allyBoard.x + L.allyBoard.w, L.enemyBoard.x + L.enemyBoard.w) + pad;
  const bottom = Math.max(L.allyBoard.y + L.allyBoard.h, L.enemyBoard.y + L.enemyBoard.h) + pad;
  return { x, y, w: right - x, h: bottom - y };
}

function drawArena(ctx: CanvasRenderingContext2D, L: Layout): void {
  const r = arenaBox(L);
  roundRect(ctx, r, L.cell * 0.22);
  ctx.fillStyle = T.floor;
  ctx.fill();
  ctx.strokeStyle = T.floorEdge;
  ctx.lineWidth = 1;
  ctx.stroke();
}

/* ------------------------------------------------------------------ */
/* 상단 HUD                                                             */
/* ------------------------------------------------------------------ */

/** 아이콘 대신 픽셀 숫자를 크게 세운 칩. 자원은 글자가 아니라 숫자로 읽힌다. */
function hudChip(
  ctx: CanvasRenderingContext2D,
  box: Rect,
  caption: string,
  value: string,
  color: string,
  align: "left" | "center" | "right",
): void {
  const cap = Math.max(9, box.h * 0.24);
  const px = Math.max(2, Math.round(box.h * 0.055));
  const x = align === "left" ? box.x : align === "right" ? box.x + box.w : box.x + box.w / 2;

  uiText(ctx, caption, x, box.y + box.h * 0.26, cap, T.muted, {
    align,
    weight: 700,
    tracking: cap * 0.12,
  });
  pixelText(ctx, value, x, box.y + box.h * 0.72, px, color, align, false);
}

function drawHud(ctx: CanvasRenderingContext2D, L: Layout, s: RunState): void {
  const r = L.hud;
  const third = r.w / 3;
  hudChip(ctx, { x: r.x, y: r.y, w: third, h: r.h }, "웨이브", String(s.wave), T.text, "left");
  hudChip(ctx, { x: r.x + third, y: r.y, w: third, h: r.h }, "생선", String(s.gold), T.fish, "center");
  hudChip(
    ctx,
    { x: r.x + third * 2, y: r.y, w: third, h: r.h },
    "최고 기록",
    s.best > 0 ? String(s.best) : "-",
    T.paperDim,
    "right",
  );
}

/* ------------------------------------------------------------------ */
/* 보드와 고양이                                                        */
/* ------------------------------------------------------------------ */

function drawBoard(
  ctx: CanvasRenderingContext2D,
  L: Layout,
  side: Side,
  accent: string,
  highlightCell: number,
): void {
  for (let i = 0; i < BOARD_SIZE; i++) {
    const cr = cellRect(L, side, i);
    roundRect(ctx, cr, L.cell * 0.16);
    ctx.fillStyle = i === highlightCell ? "rgba(244,227,193,0.13)" : "rgba(239,224,198,0.045)";
    ctx.fill();
    ctx.strokeStyle = i === highlightCell ? accent : "rgba(239,224,198,0.10)";
    ctx.lineWidth = i === highlightCell ? 2.5 : 1;
    ctx.stroke();
  }
}

/**
 * 고양이 하나. 전투 중에는 셀이 아니라 전장 좌표에 그린다.
 *
 * 돌진 연출은 화면 좌표가 아니라 전장 좌표에서 fx를 살짝 밀어 계산한다.
 * 그래야 가로/세로 어느 방향이든 "적 쪽으로 들이받는" 방향이 저절로 맞는다.
 */
function drawCat(ctx: CanvasRenderingContext2D, L: Layout, cat: Cat, dimmed: boolean): void {
  const dir = cat.side === "ally" ? 1 : -1;
  const { x: cx, y: cy } = fieldToScreen(L, cat.fx + dir * 0.22 * cat.lunge, cat.fy);

  const size = L.cell * CAT_SCALE;
  const x = cx - size / 2;
  const y = cy - size / 2 - L.cell * 0.03;

  // 발밑 그림자. 유닛이 바닥에 서 있는 느낌을 주고 겹칠 때 앞뒤를 읽게 해준다.
  if (cat.alive) {
    ctx.save();
    ctx.globalAlpha = dimmed ? 0.12 : 0.3;
    ctx.beginPath();
    ctx.ellipse(cx, cy + size * 0.44, size * 0.3, size * 0.1, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#000";
    ctx.fill();
    ctx.restore();
  }

  ctx.save();
  if (!cat.alive) ctx.globalAlpha = 0.32;
  else if (dimmed) ctx.globalAlpha = 0.35;

  const img = spriteFor(cat.breed.id, cat.pose);
  if (img) {
    if (cat.flash > 0) ctx.filter = "brightness(2.4) saturate(0.6)";
    ctx.drawImage(img, x, y, size, size);
    ctx.filter = "none";
  } else {
    ctx.fillStyle = cat.side === "ally" ? T.ally : T.enemy;
    roundRect(ctx, { x, y, w: size, h: size }, size * 0.2);
    ctx.fill();
  }
  ctx.restore();

  if (!cat.alive) return;

  // 체력 바 — 셀이 아니라 고양이 크기에 맞춘다
  const bw = size * 0.88;
  const bh = Math.max(3, size * 0.1);
  const bx = cx - bw / 2;
  const by = cy + size * 0.5;
  const frac = Math.max(0, Math.min(1, cat.hp / cat.maxHp));

  roundRect(ctx, { x: bx - 1, y: by - 1, w: bw + 2, h: bh + 2 }, (bh + 2) / 2);
  ctx.fillStyle = "rgba(12,8,6,0.8)";
  ctx.fill();
  roundRect(ctx, { x: bx, y: by, w: Math.max(bh, bw * frac), h: bh }, bh / 2);
  ctx.fillStyle = cat.side === "ally" ? T.ally : T.enemy;
  ctx.fill();

  // 근접/원거리 뱃지. 작은 화면에서는 글자가 뭉개지므로 생략한다.
  if (size >= 34) {
    const ranged = cat.breed.kind === "ranged";
    const rad = size * 0.2;
    const bxc = cx + size * 0.44;
    const byc = cy - size * 0.44;
    ctx.beginPath();
    ctx.arc(bxc, byc, rad, 0, Math.PI * 2);
    ctx.fillStyle = T.inkDeep;
    ctx.fill();
    ctx.strokeStyle = ranged ? T.ranged : T.melee;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    uiText(ctx, ranged ? "원" : "근", bxc, byc + rad * 0.06, rad * 1.25, ranged ? T.ranged : T.melee, {
      align: "center",
      weight: 800,
    });
  }

  // 레벨은 픽셀 숫자로. 스프라이트 무늬에 묻히지 않게 뱃지 위에 얹는다.
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
    pixelText(ctx, String(cat.level), lx, ly, Math.max(1, rad * 0.24), T.gold, "center", false);
  }
}

/** 원거리 투사체. 피해는 이미 적용됐고 이건 순수 연출이다. */
function drawShots(ctx: CanvasRenderingContext2D, L: Layout): void {
  for (const s of shots) {
    const t = 1 - s.life / SHOT_LIFE_MS;
    const fx = s.fromX + (s.toX - s.fromX) * t;
    const fy = s.fromY + (s.toY - s.fromY) * t;
    const { x, y } = fieldToScreen(L, fx, fy);
    const rad = Math.max(2.5, L.cell * 0.05);
    const color = s.ally ? T.gold : T.enemy;

    const back = fieldToScreen(L, fx - (s.toX - s.fromX) * 0.14, fy - (s.toY - s.fromY) * 0.14);
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

function drawPops(ctx: CanvasRenderingContext2D, L: Layout): void {
  for (const p of damagePops) {
    const { x, y } = fieldToScreen(L, p.fx, p.fy);
    const t = 1 - p.life / POP_LIFE_MS;
    ctx.save();
    ctx.globalAlpha = Math.max(0, 1 - t * t);
    const ox = x + p.jitter * L.cell;
    const oy = y - L.cell * 0.34 - t * L.cell * 0.55;
    if (p.text === "회피") {
      uiText(ctx, "빗나감", ox, oy, Math.max(9, L.cell * 0.16), T.paperDim, {
        align: "center",
        weight: 700,
        outline: true,
      });
    } else {
      pixelText(ctx, p.text, ox, oy, Math.max(1, L.cell * (p.crit ? 0.036 : 0.028)), p.crit ? T.gold : "#FFFFFF", "center");
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
  const put = (x: number, y: number, text: string, color: string, align: CanvasTextAlign) => {
    uiText(ctx, text, x, y, fs, color, {
      align,
      weight: 800,
      tracking: fs * 0.1,
      outline: true,
    });
  };

  if (L.portrait) {
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
  if (L.portrait) {
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

  const cx = L.portrait ? L.w / 2 : (L.allyBoard.x + L.allyBoard.w + L.enemyBoard.x) / 2;
  const cy = L.portrait
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
  pixelText(ctx, "VS", cx, cy, Math.max(1, rad * 0.2), T.muted, "center", false);
}

/* ------------------------------------------------------------------ */
/* 하단: 팀 상태 / 보상 카드                                            */
/* ------------------------------------------------------------------ */

export function offerRects(L: Layout, count: number): Rect[] {
  const r = L.offers;
  const n = Math.max(1, count);
  const gap = r.w * 0.022;
  const cw = (r.w - gap * (n - 1)) / n;
  return Array.from({ length: count }, (_, i) => ({ x: r.x + i * (cw + gap), y: r.y, w: cw, h: r.h }));
}

/**
 * 보상 단계가 아닐 때 카드 자리를 비워 두면 화면 아래가 휑하다.
 * 대신 팀 구성을 보여준다 — 근접/원거리 균형은 배치를 정할 때 실제로 필요한 정보다.
 */
function drawTeamStrip(ctx: CanvasRenderingContext2D, L: Layout, s: RunState): void {
  const r = L.offers;
  const cats = livingCats(s.ally);
  const melee = cats.filter((c) => c.breed.kind === "melee").length;
  const ranged = cats.length - melee;
  const foes = livingCats(s.enemy).length;

  const cap = Math.max(9, r.h * 0.17);
  const px = Math.max(2, Math.round(r.h * 0.048));
  const cols = 3;
  const cw = r.w / cols;

  const stat = (i: number, caption: string, value: string, color: string) => {
    const cx = r.x + cw * i + cw / 2;
    uiText(ctx, caption, cx, r.y + r.h * 0.3, cap, T.muted, { align: "center", weight: 700 });
    pixelText(ctx, value, cx, r.y + r.h * 0.66, px, color, "center", false);
  };

  stat(0, "근접", String(melee), T.melee);
  stat(1, "원거리", String(ranged), T.ranged);
  stat(2, "상대", String(foes), T.enemy);

  // 칸 사이 얇은 구분선
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

function drawOffers(ctx: CanvasRenderingContext2D, L: Layout, s: RunState): void {
  const rects = offerRects(L, s.offers.length);
  const fs = Math.max(11, L.offers.h * 0.2);

  s.offers.forEach((o: Offer, i) => {
    const cr = rects[i];
    if (!cr) return;
    const afford = s.gold >= o.cost;

    bevelPanel(
      ctx,
      cr,
      cr.h * 0.16,
      afford ? "rgba(239,224,198,0.10)" : "rgba(239,224,198,0.035)",
      afford ? "rgba(232,145,60,0.35)" : "rgba(0,0,0,0.25)",
      3,
    );
    roundRect(ctx, cr, cr.h * 0.16);
    ctx.strokeStyle = afford ? T.action : "rgba(239,224,198,0.12)";
    ctx.lineWidth = afford ? 2 : 1;
    ctx.stroke();

    if (o.breed) {
      const img = spriteFor(o.breed.id, "wink");
      const sz = cr.h * 0.5;
      if (img) ctx.drawImage(img, cr.x + cr.w / 2 - sz / 2, cr.y + cr.h * 0.04, sz, sz);
    }

    uiText(ctx, o.label, cr.x + cr.w / 2, cr.y + cr.h * 0.7, fs, afford ? T.text : T.muted, {
      align: "center",
      weight: 800,
      maxWidth: cr.w * 0.92,
    });

    // 종류 · 가격. 가격은 픽셀 숫자로 통일해 HUD의 생선과 같은 언어를 쓴다.
    const kind = o.breed ? (o.breed.kind === "ranged" ? "원거리" : "근접") : "강화";
    const kc = o.breed ? (o.breed.kind === "ranged" ? T.ranged : T.melee) : T.gold;
    const cs = fs * 0.72;
    const px = Math.max(1, cr.h * 0.03);
    const numW = pixelTextWidth(String(o.cost), px);
    // 폭을 재기 전에 실제로 쓸 폰트를 세팅해야 한다. 직전 상태로 재면 어긋난다.
    ctx.font = `700 ${Math.round(cs)}px "Pretendard", "Apple SD Gothic Neo", system-ui, sans-serif`;
    const kindW = ctx.measureText(kind).width;
    const total = kindW + cr.w * 0.05 + numW;
    const startX = cr.x + cr.w / 2 - total / 2;
    uiText(ctx, kind, startX, cr.y + cr.h * 0.9, cs, kc, { align: "left", weight: 700 });
    pixelText(
      ctx,
      String(o.cost),
      cr.x + cr.w / 2 + total / 2,
      cr.y + cr.h * 0.9,
      px,
      afford ? T.fish : T.muted,
      "right",
      false,
    );
  });
}

function drawBottomZone(ctx: CanvasRenderingContext2D, L: Layout, s: RunState): void {
  const reward = s.phase === "reward" && s.offers.length > 0;

  if (reward && !L.roomy) {
    ctx.fillStyle = "rgba(12,8,6,0.55)";
    ctx.fillRect(0, 0, L.w, L.h);
  }

  const panel = L.offersPanel;
  ctx.fillStyle = reward ? "rgba(20,14,11,0.96)" : "rgba(20,14,11,0.55)";
  ctx.fillRect(panel.x, panel.y, panel.w, panel.h);
  ctx.strokeStyle = "rgba(239,224,198,0.09)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, panel.y + 0.5);
  ctx.lineTo(L.w, panel.y + 0.5);
  ctx.stroke();

  if (reward) {
    uiText(
      ctx,
      "생선을 쓰거나, 그냥 다음 웨이브로",
      L.w / 2,
      panel.y + (L.offers.y - panel.y) * 0.55,
      Math.max(10, L.offers.h * 0.16),
      T.muted,
      { align: "center", weight: 600 },
    );
    drawOffers(ctx, L, s);
  } else {
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
function drawSynergies(ctx: CanvasRenderingContext2D, L: Layout, s: RunState): void {
  const r = L.synergyBar;
  const n = Math.max(1, s.synergies.length);
  const gap = r.w * 0.016;
  const cw = (r.w - gap * (n - 1)) / n;
  const units = boardUnits(s);
  const fs = Math.max(10, r.h * 0.27);

  s.synergies.forEach((syn, i) => {
    const on = s.activeSynergyIds.has(syn.id);
    const hue = TRIGGER_COLOR[syn.trigger] ?? T.gold;
    const { have, need } = synergyProgress(syn.trigger, units);
    const cr: Rect = { x: r.x + i * (cw + gap), y: r.y, w: cw, h: r.h };

    roundRect(ctx, cr, r.h * 0.22);
    ctx.fillStyle = on ? "rgba(240,186,74,0.13)" : "rgba(239,224,198,0.035)";
    ctx.fill();
    ctx.strokeStyle = on ? hue : "rgba(239,224,198,0.10)";
    ctx.lineWidth = on ? 2 : 1;
    ctx.stroke();

    const padX = r.h * 0.26;
    const inner = cr.w - padX * 2;

    // 왼쪽: 조건과 진행도. 오른쪽: 얻는 효과.
    uiText(ctx, triggerLabel(syn.trigger), cr.x + padX, cr.y + r.h * 0.34, fs * 0.86, on ? hue : T.muted, {
      align: "left",
      weight: 700,
      maxWidth: inner * 0.55,
    });

    const px = Math.max(1, r.h * 0.032);
    const prog = `${Math.min(have, need)}/${need}`;
    pixelText(ctx, prog, cr.x + padX, cr.y + r.h * 0.72, px, on ? hue : T.muted, "left", false);

    uiText(ctx, syn.name, cr.x + cr.w - padX, cr.y + r.h * 0.34, fs * 0.86, on ? T.text : T.muted, {
      align: "right",
      weight: 800,
      maxWidth: inner * 0.5,
    });
    uiText(
      ctx,
      effectLabel(syn.effect),
      cr.x + cr.w - padX,
      cr.y + r.h * 0.72,
      fs * 0.8,
      on ? T.gold : "rgba(156,139,118,0.6)",
      { align: "right", weight: 600, maxWidth: inner * 0.6 },
    );
  });
}

export function buttonText(s: RunState): string {
  switch (s.phase) {
    case "prepare":
      return "전투 시작";
    case "battle":
      return "전투 중";
    case "reward":
      return "다음 웨이브";
    case "gameover":
      return "다시 도전";
  }
}

function drawButton(ctx: CanvasRenderingContext2D, L: Layout, s: RunState): void {
  const r = L.button;
  const idle = s.phase === "battle";
  const face = idle ? "rgba(239,224,198,0.07)" : T.action;
  const edge = idle ? "rgba(0,0,0,0.3)" : "#A85E1E";

  bevelPanel(ctx, r, r.h * 0.26, face, edge, idle ? 2 : Math.max(3, r.h * 0.08));

  if (!idle) {
    // 위쪽 하이라이트. 눌리는 물건처럼 보이게 하는 최소한의 장치.
    roundRect(ctx, { x: r.x + r.w * 0.06, y: r.y + r.h * 0.13, w: r.w * 0.88, h: r.h * 0.22 }, r.h * 0.11);
    ctx.fillStyle = "rgba(255,255,255,0.16)";
    ctx.fill();
  }

  uiText(ctx, buttonText(s), r.x + r.w / 2, r.y + r.h / 2, Math.max(15, r.h * 0.36), idle ? T.muted : T.actionInk, {
    align: "center",
    weight: 800,
    tracking: r.h * 0.02,
  });
}

function drawNotice(ctx: CanvasRenderingContext2D, L: Layout, s: RunState): void {
  if (!s.notice || s.phase === "gameover") return;
  const r = L.notice;
  uiText(ctx, s.notice, L.w / 2, r.y + r.h / 2, Math.max(11, r.h * 0.58), T.paperDim, {
    align: "center",
    weight: 600,
  });
}

function drawGameOver(ctx: CanvasRenderingContext2D, L: Layout, s: RunState): void {
  if (s.phase !== "gameover") return;
  ctx.fillStyle = "rgba(14,10,8,0.84)";
  ctx.fillRect(0, 0, L.w, L.h);

  const cy = L.h / 2;
  const px = Math.max(3, Math.round(L.scale * 9));
  const num = String(s.wave);

  uiText(ctx, "도달", L.w / 2, cy - L.scale * 62, L.scale * 15, T.muted, {
    align: "center",
    weight: 700,
    tracking: L.scale * 3,
  });
  pixelText(ctx, num, L.w / 2, cy - L.scale * 22, px, T.paper, "center", false);
  uiText(ctx, "웨이브", L.w / 2, cy + L.scale * 16, L.scale * 16, T.muted, { align: "center", weight: 700 });

  if (s.lossReason === "timeout") {
    uiText(ctx, "시간 안에 정리하지 못했습니다", L.w / 2, cy + L.scale * 42, L.scale * 13, T.enemy, {
      align: "center",
      weight: 600,
    });
  }
  uiText(
    ctx,
    s.recordBroken ? "최고 기록 갱신" : `최고 기록 ${s.best}웨이브`,
    L.w / 2,
    cy + L.scale * (s.lossReason === "timeout" ? 64 : 44),
    L.scale * 14,
    s.recordBroken ? T.gold : T.muted,
    { align: "center", weight: 700 },
  );
}

/* ------------------------------------------------------------------ */

export function render(
  ctx: CanvasRenderingContext2D,
  L: Layout,
  s: RunState,
  drag: DragState,
  hoverCell: number,
): void {
  drawBackground(ctx, L);
  drawArena(ctx, L);
  drawHud(ctx, L, s);

  drawDivider(ctx, L);
  drawSideLabels(ctx, L);
  drawBoard(ctx, L, "ally", T.ally, hoverCell);
  drawBoard(ctx, L, "enemy", T.enemy, -1);

  // 화면 아래쪽 고양이가 위에 그려지도록 y로 정렬한다.
  // 전투 중에는 양쪽이 뒤섞이므로 이게 없으면 겹칠 때 앞뒤가 뒤집혀 보인다.
  const drawList: { cat: Cat; y: number; dimmed: boolean }[] = [];
  for (let i = 0; i < BOARD_SIZE; i++) {
    const e = s.enemy[i];
    if (e) drawList.push({ cat: e, y: fieldToScreen(L, e.fx, e.fy).y, dimmed: false });
    const a = s.ally[i];
    if (a) {
      drawList.push({
        cat: a,
        y: fieldToScreen(L, a.fx, a.fy).y,
        dimmed: drag.active && drag.fromCell === i,
      });
    }
  }
  drawList.sort((p, q) => p.y - q.y);
  for (const d of drawList) drawCat(ctx, L, d.cat, d.dimmed);

  drawShots(ctx, L);

  // 드래그 중인 고양이는 손가락을 따라다닌다.
  if (drag.active) {
    const cat = s.ally[drag.fromCell];
    if (cat) {
      const size = L.cell * CAT_SCALE;
      const img = spriteFor(cat.breed.id, "move");
      ctx.save();
      ctx.globalAlpha = 0.95;
      if (img) ctx.drawImage(img, drag.x - size / 2, drag.y - size / 2, size, size);
      ctx.restore();
    }
  }

  drawPops(ctx, L);
  drawBottomZone(ctx, L, s);
  drawSynergies(ctx, L, s);
  drawButton(ctx, L, s);
  drawNotice(ctx, L, s);
  drawGameOver(ctx, L, s);
}
