import {
  damagePops,
  fxs,
  POP_LIFE_MS,
  shots,
  SHOT_LIFE_MS,
  skillName,
} from "./battle.ts";
import { cellRect, fieldToScreen, type Layout, type Rect } from "./layout.ts";
import { spriteFor } from "./sprites.ts";
import {
  boardUnits,
  OFFER_SLOTS,
  REROLL_COST,
  unitCap,
  waveKind,
  waveKindInfo,
  type Offer,
  type RunState,
} from "./run.ts";
import {
  bevelPanel,
  pixelText,
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
  BOARD_SIZE,
  CLASS_LABEL,
  livingCats,
  type Cat,
  type ClassKind,
  type Pose,
  type Side,
} from "./types.ts";

/**
 * 셀 대비 고양이 그리기 크기.
 * 작을수록 전장이 넓어 보이고 유닛이 겹칠 일이 줄어든다.
 * 체력바·뱃지는 셀이 아니라 이 크기에 비례시켜야 축소해도 비율이 안 깨진다.
 */
const CAT_SCALE = 0.66;

/** 시너지 트리거마다 고유색. TFT가 특성별로 색을 나누는 것과 같은 이유 — 한눈에 구분되게. */
/** 직업 색. 뱃지와 카드에서 같은 색을 쓴다. */
const CLASS_COLOR: Record<ClassKind, string> = {
  warrior: "#E8654A",
  rogue: "#C97BD4",
  archer: "#E8913C",
  mage: "#6FB6DC",
};

/** 뱃지에 넣을 한 글자. 5x5에서는 셀이 작아 한 글자가 한계다. */
const CLASS_CHAR: Record<ClassKind, string> = {
  warrior: "전",
  rogue: "도",
  archer: "궁",
  mage: "법",
};

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
function drawTelegraphs(ctx: CanvasRenderingContext2D, L: Layout, s: RunState): void {
  // 예고는 반경이 커서 그냥 그리면 HUD와 하단 UI까지 침범한다. 전장 안으로 자른다.
  const x0 = Math.min(L.allyBoard.x, L.enemyBoard.x);
  const y0 = Math.min(L.allyBoard.y, L.enemyBoard.y);
  const x1 = Math.max(L.allyBoard.x + L.allyBoard.w, L.enemyBoard.x + L.enemyBoard.w);
  const y1 = Math.max(L.allyBoard.y + L.allyBoard.h, L.enemyBoard.y + L.enemyBoard.h);
  const m = L.cell * 0.25;

  for (const c of s.enemy) {
    const tg = c?.telegraph;
    if (!c || !tg) continue;

    // 0 → 1로 차오른다. 다 차면 터진다.
    const fill = 1 - Math.max(0, tg.fuse) / tg.fuseMax;
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
      ctx.fillStyle = `rgba(194,75,58,${0.10 + fill * 0.28})`;
      ctx.fill();
      ctx.strokeStyle = `rgba(194,75,58,${0.5 + fill * 0.5})`;
      ctx.lineWidth = 2 + fill * 2;
      ctx.stroke();
      // 안쪽에서 차오르는 원. 남은 시간이 한눈에 보인다.
      ctx.beginPath();
      ctx.arc(origin.x, origin.y, r * fill, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(194,75,58,0.22)";
      ctx.fill();
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
      ctx.fillStyle = `rgba(194,75,58,${0.10 + fill * 0.26})`;
      ctx.fill();
      ctx.strokeStyle = `rgba(194,75,58,${0.5 + fill * 0.5})`;
      ctx.lineWidth = 2 + fill * 2;
      ctx.stroke();
    }
    ctx.restore();
  }
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
  const x =
    align === "left"
      ? box.x
      : align === "right"
        ? box.x + box.w
        : box.x + box.w / 2;

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
  hudChip(
    ctx,
    { x: r.x, y: r.y, w: third, h: r.h },
    "웨이브",
    String(s.wave),
    T.text,
    "left",
  );
  hudChip(
    ctx,
    { x: r.x + third, y: r.y, w: third, h: r.h },
    "생선",
    String(s.gold),
    T.fish,
    "center",
  );
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
    ctx.fillStyle =
      i === highlightCell
        ? "rgba(244,227,193,0.13)"
        : "rgba(239,224,198,0.045)";
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
function drawCat(
  ctx: CanvasRenderingContext2D,
  L: Layout,
  cat: Cat,
  dimmed: boolean,
): void {
  const dir = cat.side === "ally" ? 1 : -1;
  const { x: cx, y: cy } = fieldToScreen(
    L,
    cat.fx + dir * 0.22 * cat.lunge,
    cat.fy,
  );

  // 보스는 반경만큼 크게 그린다. 셀 격자에 얽매이지 않고 3x3을 덮는다.
  const size = cat.radius > 0 ? L.cell * cat.radius * 2.1 : L.cell * CAT_SCALE;
  const x = cx - size / 2;
  const y = cy - size / 2 - L.cell * 0.03;

  // 발밑 그림자. 유닛이 바닥에 서 있는 느낌을 주고 겹칠 때 앞뒤를 읽게 해준다.
  if (cat.alive) {
    ctx.save();
    ctx.globalAlpha = dimmed ? 0.12 : 0.3;
    ctx.beginPath();
    ctx.ellipse(
      cx,
      cy + size * 0.44,
      size * 0.3,
      size * 0.1,
      0,
      0,
      Math.PI * 2,
    );
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

  // 마나 바. 체력 바 바로 아래에 얇게. 가득 차면 스킬이 나간다.
  // 스킬이 없는 고양이(패시브·보스)는 마나가 의미 없으므로 아예 그리지 않는다.
  const my = by + bh + 1.5;
  const mh = Math.max(2, bh * 0.62);
  const mfrac = cat.breed.skill
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
      ctx.fillStyle = mfrac >= 1 ? T.gold : T.fish;
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
    uiText(ctx, CLASS_CHAR[cls], bxc, byc + rad * 0.06, rad * 1.25, hue, {
      align: "center",
      weight: 800,
    });
  }

  // 상태이상 — 기절·빙결은 위에 고리, 지속 피해는 아래에 점
  if (cat.stun > 0) {
    ctx.save();
    ctx.strokeStyle = T.ranged;
    ctx.lineWidth = Math.max(1.5, size * 0.05);
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.arc(cx, cy - size * 0.56, size * 0.16, 0, Math.PI * 2);
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
    pixelText(
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

/**
 * 스킬 연출. 종류마다 그리는 방식이 다르다 — 무엇이 터졌는지 색과 모양으로 읽힌다.
 * 판정과 완전히 분리돼 있어서 이 함수를 지워도 전투 결과는 같다.
 */
function drawFx(ctx: CanvasRenderingContext2D, L: Layout): void {
  const pitch = L.cell + L.gap;

  for (const f of fxs) {
    const t = 1 - f.life / f.maxLife; // 0 → 1
    const p = fieldToScreen(L, f.fx, f.fy);
    ctx.save();

    switch (f.kind) {
      case "ring": {
        ctx.globalAlpha = Math.max(0, 0.85 * (1 - t) ** 1.4);
        ctx.strokeStyle = f.color;
        ctx.lineWidth = Math.max(2, L.cell * 0.09 * (1 - t * 0.6));
        ctx.beginPath();
        ctx.arc(p.x, p.y, f.radius * pitch * (0.25 + t * 0.85), 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
      case "slash": {
        // 짧은 호가 바깥으로 퍼지며 사라진다
        ctx.globalAlpha = Math.max(0, 0.95 * (1 - t));
        ctx.strokeStyle = f.color;
        ctx.lineCap = "round";
        ctx.lineWidth = Math.max(2.5, L.cell * 0.075);
        const rr = f.radius * pitch * (0.35 + t * 0.55);
        const a0 = f.angle + t * 1.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, rr, a0, a0 + 0.85);
        ctx.stroke();
        break;
      }
      case "beam": {
        const q = fieldToScreen(L, f.tx, f.ty);
        ctx.globalAlpha = Math.max(0, 0.9 * (1 - t) ** 0.7);
        ctx.strokeStyle = f.color;
        ctx.lineCap = "round";
        ctx.lineWidth = Math.max(2, f.radius * pitch * (1 - t * 0.5));
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(q.x, q.y);
        ctx.stroke();
        break;
      }
      case "streak": {
        // 시작점에서 목표까지 순식간에 지나간 자국
        const q = fieldToScreen(L, f.tx, f.ty);
        const head = {
          x: p.x + (q.x - p.x) * Math.min(1, t * 1.8),
          y: p.y + (q.y - p.y) * Math.min(1, t * 1.8),
        };
        ctx.globalAlpha = Math.max(0, 0.9 * (1 - t));
        ctx.strokeStyle = f.color;
        ctx.lineCap = "round";
        ctx.lineWidth = Math.max(3, L.cell * 0.1);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(head.x, head.y);
        ctx.stroke();
        break;
      }
      case "spark": {
        // 네 갈래로 튀는 짧은 선
        ctx.globalAlpha = Math.max(0, 1 - t);
        ctx.strokeStyle = f.color;
        ctx.lineCap = "round";
        ctx.lineWidth = Math.max(1.5, L.cell * 0.045);
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
        ctx.globalAlpha = Math.max(0, 0.9 * (1 - t) ** 1.5);
        ctx.fillStyle = f.color;
        const rise = t * pitch * 0.9;
        ctx.beginPath();
        ctx.arc(
          p.x,
          p.y - rise,
          Math.max(1.5, f.radius * pitch * (1 - t)),
          0,
          Math.PI * 2,
        );
        ctx.fill();
        break;
      }
      case "frost": {
        // 여섯 갈래 결정. 얼어붙은 대상 위에 오래 남는다
        ctx.globalAlpha = Math.max(0, 0.8 * (1 - t) ** 0.6);
        ctx.strokeStyle = f.color;
        ctx.lineCap = "round";
        ctx.lineWidth = Math.max(1.5, L.cell * 0.04);
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
    }
    ctx.restore();
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
      pixelText(
        ctx,
        p.text,
        ox,
        oy,
        Math.max(1, L.cell * (p.crit ? 0.036 : 0.028)),
        p.crit ? T.gold : "#FFFFFF",
        "center",
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
    const y =
      Math.round((L.enemyBoard.y + L.enemyBoard.h + L.allyBoard.y) / 2) + 0.5;
    ctx.moveTo(L.allyBoard.x, y);
    ctx.lineTo(L.allyBoard.x + L.allyBoard.w, y);
  } else {
    const x =
      Math.round((L.allyBoard.x + L.allyBoard.w + L.enemyBoard.x) / 2) + 0.5;
    ctx.moveTo(x, L.allyBoard.y - L.labelH);
    ctx.lineTo(x, L.allyBoard.y + L.allyBoard.h);
  }
  ctx.stroke();
  ctx.restore();

  const cx = L.portrait
    ? L.w / 2
    : (L.allyBoard.x + L.allyBoard.w + L.enemyBoard.x) / 2;
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
  pixelText(
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
  const h = Math.max(24, Math.min(34, r.h * 0.13));
  const w = Math.max(88, r.w * 0.28);
  return { x: r.x + r.w - w, y: r.y - h - h * 0.34, w, h };
}

/** 슬롯은 늘 세 칸. 하나를 사도 남은 카드가 넓어지지 않는다. */
export function offerRects(L: Layout, count: number = OFFER_SLOTS): Rect[] {
  const r = L.offerCards;
  const n = Math.max(1, count);
  const gap = L.offerGap;
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
  const counts: Record<ClassKind, number> = {
    warrior: 0,
    rogue: 0,
    archer: 0,
    mage: 0,
  };
  for (const c of cats) counts[c.breed.cls] += 1;

  const cap = Math.max(9, r.h * 0.17);
  const px = Math.max(2, Math.round(r.h * 0.048));
  const order: ClassKind[] = ["warrior", "rogue", "archer", "mage"];
  const cols = order.length + 1;
  const cw = r.w / cols;

  order.forEach((cls, i) => {
    const cx = r.x + cw * i + cw / 2;
    uiText(ctx, CLASS_LABEL[cls], cx, r.y + r.h * 0.3, cap, T.muted, {
      align: "center",
      weight: 700,
    });
    pixelText(
      ctx,
      String(counts[cls]),
      cx,
      r.y + r.h * 0.66,
      px,
      CLASS_COLOR[cls],
      "center",
      false,
    );
  });

  const cx = r.x + cw * order.length + cw / 2;
  uiText(ctx, "상대", cx, r.y + r.h * 0.3, cap, T.muted, {
    align: "center",
    weight: 700,
  });
  pixelText(
    ctx,
    String(livingCats(s.enemy).length),
    cx,
    r.y + r.h * 0.66,
    px,
    T.enemy,
    "center",
    false,
  );

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
  const img = spriteFor(breedId, pose);
  // 0.86인 이유: 흔들림 폭(±sz*0.05)까지 우물 안에 들어와야 발이 잘리지 않는다.
  const sz = Math.min(well.w, well.h) * 0.86;
  if (img) {
    ctx.globalAlpha = afford ? 1 : 0.45;
    ctx.drawImage(img, cx - sz / 2, cy - sz / 2 + bob * sz * 0.05, sz, sz);
  }
  ctx.restore();

  roundRect(ctx, well, rad);
  ctx.strokeStyle = afford ? hexA(accent, 0.42) : "rgba(239,224,198,0.10)";
  ctx.lineWidth = 1;
  ctx.stroke();
}

/** 값은 카드 모서리의 동그란 뱃지로. 어느 카드가 얼마인지 훑어보기 좋다. */
function drawCostBadge(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  cost: number,
  afford: boolean,
): void {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(18,12,10,0.94)";
  ctx.fill();
  ctx.strokeStyle = afford ? T.fish : "rgba(239,224,198,0.16)";
  ctx.lineWidth = 2;
  ctx.stroke();
  pixelText(
    ctx,
    String(cost),
    cx,
    cy,
    Math.max(1, r * 0.26),
    afford ? T.fish : T.muted,
    "center",
    false,
  );
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
    if (!o) {
      roundRect(ctx, cr, rad);
      ctx.fillStyle = "rgba(239,224,198,0.02)";
      ctx.fill();
      ctx.setLineDash([4, 5]);
      ctx.strokeStyle = "rgba(239,224,198,0.10)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);
      uiText(
        ctx,
        "샀음",
        cr.x + cr.w / 2,
        cr.y + cr.h / 2,
        Math.max(11, cr.w * 0.1),
        "rgba(156,139,118,0.55)",
        {
          align: "center",
          weight: 600,
        },
      );
      return;
    }

    const afford = s.gold >= o.cost;
    // 영입·교체는 그 고양이의 직업색으로. 카드만 봐도 무엇이 오는지 알 수 있다.
    const accent = o.kind === "upgrade" ? T.gold : CLASS_COLOR[o.breed.cls];

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

    // 무엇을 하는 고양이인지 사기 전에 보여준다.
    const skill = o.breed.skill ? SKILLS[o.breed.skill] : null;
    const passive = o.breed.passive ? PASSIVES[o.breed.passive] : null;
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
        h: cr.h * 0.42,
      };
      drawPortraitWell(
        ctx,
        well,
        o.breed.id,
        o.breed.id * 7 + i,
        accent,
        afford,
        t,
      );
      const br = Math.max(12, cr.w * 0.105);
      drawCostBadge(
        ctx,
        cr.x + cr.w - pad - br * 0.9,
        cr.y + pad + br * 0.9,
        br,
        o.cost,
        afford,
      );

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

    // 카드를 세울 높이가 안 나오는 화면에서는 눕힌다. 초상 왼쪽, 글 오른쪽.
    const side = cr.h - pad * 2;
    const well: Rect = { x: cr.x + pad, y: cr.y + pad, w: side, h: side };
    drawPortraitWell(
      ctx,
      well,
      o.breed.id,
      o.breed.id * 7 + i,
      accent,
      afford,
      t,
    );

    const br = Math.max(11, cr.h * 0.17);
    const fs = Math.max(11, cr.h * 0.19);
    const textX = well.x + well.w + pad;
    const textW = cr.x + cr.w - pad - br * 2.1 - textX;
    const roomy = cr.h >= 84;

    uiText(
      ctx,
      o.label,
      textX,
      cr.y + cr.h * (roomy ? 0.26 : 0.34),
      fs,
      afford ? T.text : T.muted,
      {
        align: "left",
        weight: 800,
        maxWidth: textW,
      },
    );
    uiText(
      ctx,
      abilityLine,
      textX,
      cr.y + cr.h * (roomy ? 0.48 : 0.58),
      fs * 0.74,
      afford ? accent : T.muted,
      {
        align: "left",
        weight: 700,
        maxWidth: textW,
      },
    );
    if (roomy) {
      uiText(
        ctx,
        abilityDesc,
        textX,
        cr.y + cr.h * 0.68,
        fs * 0.68,
        afford ? T.paperDim : T.muted,
        {
          align: "left",
          weight: 500,
          maxWidth: textW,
        },
      );
    }
    drawCostBadge(
      ctx,
      cr.x + cr.w - pad - br,
      cr.y + cr.h / 2,
      br,
      o.cost,
      afford,
    );
  });
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

  if (s.offers.every((o) => o === null)) {
    return `${team} · 다 샀다 — 배치를 다듬고 ${s.wave === 1 ? "시작하자" : "다음 웨이브로"}`;
  }
  if (owned >= cap) return `${team} · 자리가 없다. 강화하거나 바꿔 넣자`;
  if (s.wave === 1) return `${team} · 쓰고 시작해도, 그냥 시작해도 된다`;
  return `${team} · 생선을 쓰거나, 그냥 다음 웨이브로`;
}

function drawBottomZone(
  ctx: CanvasRenderingContext2D,
  L: Layout,
  s: RunState,
): void {
  const reward = s.phase === "reward";
  const rr = rerollRect(L);

  // 보상 단계에는 카드가 보드 위로 자란다. 그동안 보드는 어차피 만질 수 없으므로
  // (main.ts canRearrange) 덮어도 되지만, 덮는다는 걸 눈에 보이게 해야 한다.
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
    ctx.strokeStyle = "rgba(239,224,198,0.09)";
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

    const canRoll = s.gold >= REROLL_COST;
    roundRect(ctx, rr, rr.h * 0.5);
    ctx.fillStyle = canRoll
      ? "rgba(111,182,220,0.14)"
      : "rgba(239,224,198,0.04)";
    ctx.fill();
    ctx.strokeStyle = canRoll ? T.fish : "rgba(239,224,198,0.12)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    const rfs = Math.max(10, rr.h * 0.46);
    uiText(
      ctx,
      "다시 뽑기",
      rr.x + rr.w * 0.42,
      rr.y + rr.h / 2,
      rfs,
      canRoll ? T.text : T.muted,
      {
        align: "right",
        weight: 700,
      },
    );
    pixelText(
      ctx,
      String(REROLL_COST),
      rr.x + rr.w - rr.w * 0.12,
      rr.y + rr.h / 2,
      Math.max(1, rr.h * 0.09),
      canRoll ? T.fish : T.muted,
      "right",
      false,
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
function drawSynergies(
  ctx: CanvasRenderingContext2D,
  L: Layout,
  s: RunState,
): void {
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

    const padX = r.h * 0.22;
    const inner = cr.w - padX * 2;
    const px = Math.max(1, r.h * 0.03);
    const prog = `${Math.min(have, need)}/${need}`;

    // 칩이 좁으면 좌우로 나눌 수 없다. 세로 화면에서 글자가 겹치던 문제.
    const wide = cr.w > r.h * 6;

    if (wide) {
      uiText(
        ctx,
        triggerLabel(syn.trigger),
        cr.x + padX,
        cr.y + r.h * 0.34,
        fs * 0.86,
        on ? hue : T.muted,
        {
          align: "left",
          weight: 700,
          maxWidth: inner * 0.52,
        },
      );
      pixelText(
        ctx,
        prog,
        cr.x + padX,
        cr.y + r.h * 0.72,
        px,
        on ? hue : T.muted,
        "left",
        false,
      );
      uiText(
        ctx,
        syn.name,
        cr.x + cr.w - padX,
        cr.y + r.h * 0.34,
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
        cr.y + r.h * 0.72,
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
      cr.y + r.h * 0.32,
      fs * 0.86,
      on ? hue : T.muted,
      {
        align: "left",
        weight: 800,
        maxWidth: inner * 0.68,
      },
    );
    pixelText(
      ctx,
      prog,
      cr.x + cr.w - padX,
      cr.y + r.h * 0.32,
      px,
      on ? hue : T.muted,
      "right",
      false,
    );
    uiText(
      ctx,
      effectLabel(syn.effect),
      cr.x + cr.w / 2,
      cr.y + r.h * 0.72,
      fs * 0.76,
      on ? T.gold : "rgba(156,139,118,0.6)",
      { align: "center", weight: 600, maxWidth: inner },
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
      // 1웨이브 상점은 전투 뒤가 아니라 전투 앞이다. "다음 웨이브"라고 하면 거짓말이 된다.
      return s.wave === 1 ? "배치하러 가기" : "다음 웨이브";
    case "gameover":
      return "다시 도전";
  }
}

function drawButton(
  ctx: CanvasRenderingContext2D,
  L: Layout,
  s: RunState,
): void {
  const r = L.button;
  const idle = s.phase === "battle";
  const face = idle ? "rgba(239,224,198,0.07)" : T.action;
  const edge = idle ? "rgba(0,0,0,0.3)" : "#A85E1E";

  bevelPanel(
    ctx,
    r,
    r.h * 0.26,
    face,
    edge,
    idle ? 2 : Math.max(3, r.h * 0.08),
  );

  if (!idle) {
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

  uiText(
    ctx,
    buttonText(s),
    r.x + r.w / 2,
    r.y + r.h / 2,
    Math.max(15, r.h * 0.36),
    idle ? T.muted : T.actionInk,
    {
      align: "center",
      weight: 800,
      tracking: r.h * 0.02,
    },
  );
}

/**
 * 안내 띠. 준비 단계에서는 이번 상대의 성격을 알려준다.
 * 무엇이 오는지 모르면 배치를 바꿀 이유가 없다.
 */
function drawNotice(
  ctx: CanvasRenderingContext2D,
  L: Layout,
  s: RunState,
): void {
  if (s.phase === "gameover") return;
  const r = L.notice;
  const size = Math.max(11, r.h * 0.56);
  const cy = r.y + r.h / 2;

  if (s.phase === "prepare") {
    const info = waveKindInfo(waveKind(s.wave));
    const nameW = ctx.measureText(info.name).width;
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
    });
    return;
  }

  if (!s.notice) return;
  uiText(ctx, s.notice, L.w / 2, cy, size, T.paperDim, {
    align: "center",
    weight: 600,
  });
}

function drawGameOver(
  ctx: CanvasRenderingContext2D,
  L: Layout,
  s: RunState,
): void {
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
  uiText(ctx, "웨이브", L.w / 2, cy + L.scale * 16, L.scale * 16, T.muted, {
    align: "center",
    weight: 700,
  });

  if (s.lossReason === "timeout") {
    uiText(
      ctx,
      "시간 안에 정리하지 못했습니다",
      L.w / 2,
      cy + L.scale * 42,
      L.scale * 13,
      T.enemy,
      {
        align: "center",
        weight: 600,
      },
    );
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
  drawTelegraphs(ctx, L, s);

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
  drawList.sort((p, q) => p.y - q.y);
  for (const d of drawList) drawCat(ctx, L, d.cat, d.dimmed);

  drawFx(ctx, L);
  drawShots(ctx, L);

  // 드래그 중인 고양이는 손가락을 따라다닌다.
  if (drag.active) {
    const cat = s.ally[drag.fromCell];
    if (cat) {
      const size = L.cell * CAT_SCALE;
      const img = spriteFor(cat.breed.id, "move");
      ctx.save();
      ctx.globalAlpha = 0.95;
      if (img)
        ctx.drawImage(img, drag.x - size / 2, drag.y - size / 2, size, size);
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
