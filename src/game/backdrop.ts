/**
 * 픽셀 배경 씬.
 *
 * 단색 갈색 바닥을 걷어내고 고양이와 **같은 격자**로 그린 씬을 깐다. 새 아트는
 * 없다 — 전부 `fillRect`로 찍는 띠·실루엣·점이다.
 *
 * 핵심은 **어디에 그리느냐**다. 최종 해상도 캔버스에 그리면 안티에일리어싱된
 * 곡선이 나와서 고양이만 픽셀이고 배경은 다른 그림이 된다. 저해상도 버퍼에
 * 그린 뒤 `imageSmoothingEnabled = false`로 확대하면 같은 코드가 그대로
 * 픽셀 아트가 된다.
 *
 * 비용은 캐시로 없앤다. 씬은 정적이므로 매 프레임 다시 그릴 이유가 없다 —
 * 오프스크린에 한 번 그려 두고 `drawImage` 한 번으로 끝낸다. 캐시 키에 크기가
 * 들어가는 이유는 창을 줄이면 버퍼 해상도가 달라지기 때문이다.
 *
 * 판(아레나)은 이 위에 얹히는 반투명 슬랩이다. 배경이 아무리 화려해도 판 위의
 * 신호가 이겨야 하므로, 씬은 **가장 조용한 겹**으로 남는다.
 */

/** 보스마다 다른 무대. 성격을 공간이 먼저 말한다. */
export type Scene = "forest" | "stone" | "alley" | "frost" | "ember" | "blight";

/** 최종 화면 픽셀 몇 개가 씬 픽셀 하나인가. 클수록 굵고 거칠다. */
const PIXEL = 4;

type Ctx = CanvasRenderingContext2D;

/* ------------------------------------------------------------------ */
/* 그리기 도구 — 전부 fillRect 한 번으로 환원된다                        */
/* ------------------------------------------------------------------ */

/** 씬 전용 난수. 시드가 고정이라 같은 씬은 언제나 같은 그림이다. */
function rand(seed: number): () => number {
  let x = seed >>> 0 || 1;
  return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function F(c: Ctx, x: number, y: number, w: number, h: number, col: string): void {
  c.fillStyle = col;
  c.fillRect(x | 0, y | 0, Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
}

function bands(c: Ctx, w: number, h: number, list: readonly (readonly [number, string])[]): void {
  let y = 0;
  for (const [f, col] of list) {
    const hh = Math.round(h * f);
    F(c, 0, y, w, hh, col);
    y += hh;
  }
  const last = list[list.length - 1];
  if (y < h && last) F(c, 0, y, w, h - y, last[1]);
}

/**
 * 띠 경계의 체커 디더.
 *
 * 그라디언트를 쓰면 부드럽지만 그 순간 픽셀 아트가 아니게 된다. 두 색을
 * 바둑판으로 섞으면 색 수를 늘리지 않고 전환만 부드러워진다 — 옛날 기기가
 * 쓰던 방법이고, 여기서도 같은 이유로 쓴다.
 */
function ditherSeam(c: Ctx, w: number, y: number, depth: number, col: string): void {
  for (let i = 0; i < depth; i++) {
    for (let x = i % 2; x < w; x += 2) {
      if (((x >> 1) + i) % 2 === 0) F(c, x, y + i, 1, 1, col);
    }
  }
}

function stars(c: Ctx, w: number, h: number, n: number, r: () => number, cols: readonly string[]): void {
  for (let i = 0; i < n; i++) {
    F(c, Math.floor(r() * w), Math.floor(r() * h), 1, 1, cols[Math.floor(r() * cols.length)] ?? cols[0]!);
  }
}

/** 픽셀 원. arc를 쓰면 매끈해지므로 줄 단위로 채운다. */
function disc(c: Ctx, cx: number, cy: number, rad: number, col: string): void {
  for (let dy = -rad; dy <= rad; dy++) {
    const dx = Math.floor(Math.sqrt(Math.max(0, rad * rad - dy * dy)));
    F(c, cx - dx, cy + dy, dx * 2 + 1, 1, col);
  }
}

function conifer(c: Ctx, x: number, base: number, ht: number, col: string, tip?: string): void {
  const step = 3;
  const n = Math.max(3, Math.round(ht / step));
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const half = Math.max(1, Math.round((1 - t) * ht * 0.3) + 1);
    F(c, x - half, base - (i + 1) * step, half * 2, step + 1, i === n - 1 && tip ? tip : col);
  }
  F(c, x - 1, base - 3, 2, 4, col);
}

function ridge(c: Ctx, w: number, h: number, baseY: number, amp: number, col: string, r: () => number): void {
  let x = 0;
  let y = baseY - Math.round(r() * amp);
  const tops: number[] = [];
  while (x < w) {
    const seg = 4 + Math.floor(r() * 8);
    const ny = baseY - Math.round(r() * amp);
    for (let i = 0; i < seg && x < w; i++, x++) tops.push(Math.round(y + (ny - y) * (i / seg)));
    y = ny;
  }
  for (let i = 0; i < w; i++) F(c, i, tops[i] ?? baseY, 1, h - (tops[i] ?? baseY), col);
}

function roof(c: Ctx, x: number, y: number, wid: number, h: number, body: string, edge: string): void {
  const half = wid / 2;
  for (let j = 0; j < wid; j++) {
    const dy = Math.round(Math.abs(j - half) * 0.5);
    F(c, x + j, y + dy, 1, h - dy, body);
    F(c, x + j, y + dy, 1, 1, edge);
  }
}

/* ------------------------------------------------------------------ */
/* 하루의 시각 — 일반 웨이브의 숲에만 적용된다                           */
/* ------------------------------------------------------------------ */

const HX = (s: string): [number, number, number] => [
  parseInt(s.slice(1, 3), 16),
  parseInt(s.slice(3, 5), 16),
  parseInt(s.slice(5, 7), 16),
];

function MIX(a: string, b: string, k: number): string {
  const A = HX(a);
  const B = HX(b);
  return (
    "#" +
    [0, 1, 2]
      .map((i) => Math.round(A[i]! + (B[i]! - A[i]!) * k).toString(16).padStart(2, "0"))
      .join("")
  );
}

interface DayKey {
  readonly t: number;
  readonly sky: readonly [string, string, string, string, string];
  readonly tree: readonly [string, string, string, string];
  readonly orb: string;
  readonly star: number;
  readonly fire: number;
  readonly orbY: number;
}

/**
 * 아침에서 밤까지 여섯 지점. 사이는 선형 보간한다.
 *
 * 여섯을 고른 이유는 해가 뜨고 지는 곡선이 균등하지 않아서다 — 낮은 오래
 * 비슷하고 노을은 짧게 급격하다. 균등 간격으로 잡으면 그 급함이 사라진다.
 */
const DAY: readonly DayKey[] = [
  { t: 0.0, sky: ["#7FB2CE", "#A9CFD6", "#CFE5C4", "#EAD9A0", "#33503A"], tree: ["#4E7E58", "#31563A", "#24422D", "#40704A"], orb: "#FFF6D2", star: 0, fire: 0, orbY: 0.3 },
  { t: 0.22, sky: ["#4E96C8", "#7ABADA", "#ACD6C6", "#CDE4A6", "#2E4834"], tree: ["#487A54", "#2C5136", "#203D28", "#3B6844"], orb: "#FFFDF0", star: 0, fire: 0, orbY: 0.11 },
  { t: 0.46, sky: ["#4A80B0", "#71A6C4", "#9DC2A8", "#C6C88A", "#2B4030"], tree: ["#3F6A4A", "#274830", "#1C3524", "#33593C"], orb: "#FFF1C0", star: 0, fire: 0.06, orbY: 0.17 },
  { t: 0.68, sky: ["#3C4E7E", "#7C5A8E", "#C4718A", "#EA9A5E", "#27312D"], tree: ["#3A5050", "#243434", "#1A2726", "#2C4238"], orb: "#FFC066", star: 0.1, fire: 0.34, orbY: 0.31 },
  { t: 0.86, sky: ["#243A58", "#3A4670", "#5C4E72", "#8C5A62", "#1D2B27"], tree: ["#2C4440", "#1C2E2A", "#14211E", "#22362E"], orb: "#F2E2B0", star: 0.55, fire: 0.72, orbY: 0.24 },
  { t: 1.0, sky: ["#1B3A46", "#2A5150", "#3C6B52", "#54864F", "#1D2E24"], tree: ["#2C4E3C", "#1B3329", "#16241C", "#284436"], orb: "#F2EFCE", star: 1, fire: 1, orbY: 0.16 },
];

function dayMix(t: number): {
  sky: string[];
  tree: string[];
  orb: string;
  star: number;
  fire: number;
  orbY: number;
} {
  const clamped = Math.max(0, Math.min(1, t));
  let i = 0;
  while (i < DAY.length - 2 && clamped > DAY[i + 1]!.t) i++;
  const a = DAY[i]!;
  const b = DAY[i + 1]!;
  const k = (clamped - a.t) / (b.t - a.t);
  return {
    sky: a.sky.map((c, j) => MIX(c, b.sky[j]!, k)),
    tree: a.tree.map((c, j) => MIX(c, b.tree[j]!, k)),
    orb: MIX(a.orb, b.orb, k),
    star: a.star + (b.star - a.star) * k,
    fire: a.fire + (b.fire - a.fire) * k,
    orbY: a.orbY + (b.orbY - a.orbY) * k,
  };
}

/* ------------------------------------------------------------------ */
/* 씬 다섯                                                              */
/* ------------------------------------------------------------------ */

/** 숲 — 일반 웨이브. 가장 오래 보는 배경이라 가장 조용하다. */
function forest(c: Ctx, w: number, h: number, t: number): void {
  const r = rand(7);
  const P = dayMix(t);
  const [s0, s1, s2, s3, s4] = P.sky as [string, string, string, string, string];
  bands(c, w, h, [[0.2, s0], [0.14, s1], [0.14, s2], [0.16, s3], [0.36, s4]]);
  ditherSeam(c, w, Math.round(h * 0.2), 4, s1);
  ditherSeam(c, w, Math.round(h * 0.34), 4, s2);
  ditherSeam(c, w, Math.round(h * 0.48), 4, s3);
  if (P.star > 0.02) {
    stars(c, w, Math.round(h * 0.34), Math.round(70 * P.star), r, [
      `rgba(240,248,255,${P.star.toFixed(2)})`,
      `rgba(190,215,240,${(P.star * 0.7).toFixed(2)})`,
    ]);
  }
  const ox = Math.round(w * 0.8);
  const oy = Math.round(h * P.orbY);
  const orr = Math.round(h * (0.055 + 0.012 * (1 - P.star)));
  disc(c, ox, oy, Math.round(orr * 1.7), "rgba(255,246,214,0.11)");
  disc(c, ox, oy, orr, P.orb);
  // 밤에만 달의 크레이터. 낮에는 해라서 무늬가 없어야 한다.
  if (P.star > 0.5) {
    disc(c, ox + Math.round(orr * 0.35), oy - Math.round(orr * 0.3), Math.round(orr * 0.22), MIX(P.orb, "#8C8464", 0.35));
  }
  const g = Math.round(h * 0.64);
  const [t0, t1, t2, t3] = P.tree as [string, string, string, string];
  for (let i = 0; i < w; i += 5) conifer(c, i + Math.floor(r() * 4), g - Math.round(h * 0.04), Math.round(h * (0.13 + r() * 0.09)), t0);
  for (let i = 0; i < w; i += 7) conifer(c, i + Math.floor(r() * 5), g + Math.round(h * 0.02), Math.round(h * (0.19 + r() * 0.12)), t1, t3);
  F(c, 0, g + Math.round(h * 0.02), w, h, t2);
  for (let i = 0; i < w; i += 3) F(c, i, g + Math.round(h * 0.02), 2, 1 + Math.floor(r() * 2), t3);
  // 반딧불은 해가 지고 나서만 뜬다. 시각이 바뀐 것을 가장 먼저 알리는 신호다.
  if (P.fire > 0.03) {
    const n = Math.round(40 * P.fire);
    for (let i = 0; i < n; i++) {
      const x = Math.floor(r() * w);
      const y = Math.round(h * 0.4 + r() * h * 0.35);
      F(c, x, y, 1, 1, "#D8F27A");
      F(c, x, y, 2, 2, "rgba(216,242,122,0.22)");
    }
  }
}

/** 사암 투기장 — 무쇠발톱. 정면 대결이라는 성격을 공간이 말한다. */
function stone(c: Ctx, w: number, h: number): void {
  const r = rand(21);
  bands(c, w, h, [[0.16, "#3A2242"], [0.13, "#5B2F46"], [0.13, "#8E4A47"], [0.12, "#C2733F"], [0.46, "#2A1A26"]]);
  ditherSeam(c, w, Math.round(h * 0.16), 4, "#5B2F46");
  ditherSeam(c, w, Math.round(h * 0.29), 4, "#8E4A47");
  ditherSeam(c, w, Math.round(h * 0.42), 5, "#C2733F");
  disc(c, Math.round(w * 0.22), Math.round(h * 0.44), Math.round(h * 0.085), "#F4C060");

  const tier = (y: number, ah: number, aw: number, col: string, gapCol: string): void => {
    for (let x = 2; x < w; x += aw + 3) {
      F(c, x, y, aw, ah, col);
      const rr = Math.round(aw / 2);
      for (let dy = 0; dy < rr; dy++) {
        const dx = Math.floor(Math.sqrt(Math.max(0, rr * rr - (rr - dy) * (rr - dy))));
        F(c, x + rr - dx, y + dy, dx * 2, 1, gapCol);
      }
    }
  };
  const y1 = Math.round(h * 0.4);
  F(c, 0, y1, w, Math.round(h * 0.16), "#4A2E3A");
  tier(y1 + 2, Math.round(h * 0.13), 9, "#4A2E3A", "#22131E");
  const y2 = Math.round(h * 0.55);
  F(c, 0, y2, w, Math.round(h * 0.13), "#5C3A42");
  tier(y2 + 2, Math.round(h * 0.1), 13, "#5C3A42", "#2A1822");

  F(c, 0, Math.round(h * 0.66), w, h, "#3A2530");
  for (let i = 0; i < w; i += 11) F(c, i, Math.round(h * 0.66), 1, h, "rgba(0,0,0,0.22)");
  for (let j = Math.round(h * 0.7); j < h; j += 7) F(c, 0, j, w, 1, "rgba(0,0,0,0.18)");

  for (const fx of [Math.round(w * 0.1), Math.round(w * 0.9)]) {
    F(c, fx - 2, Math.round(h * 0.6), 5, Math.round(h * 0.1), "#241520");
    disc(c, fx, Math.round(h * 0.58), 3, "#FF9A3C");
    disc(c, fx, Math.round(h * 0.56), 2, "#FFE07A");
    disc(c, fx, Math.round(h * 0.58), 7, "rgba(255,154,60,0.16)");
  }
  for (let i = 0; i < 20; i++) F(c, Math.floor(r() * w), Math.round(h * (0.45 + r() * 0.2)), 1, 1, "rgba(255,200,120,0.5)");
}

/** 달빛 기와 골목 — 살금이. 겹친 지붕이 사라졌다 나타날 자리를 미리 암시한다. */
function alley(c: Ctx, w: number, h: number): void {
  const r = rand(43);
  bands(c, w, h, [[0.3, "#120F33"], [0.16, "#1E1B4E"], [0.14, "#33306B"], [0.4, "#0C0A22"]]);
  ditherSeam(c, w, Math.round(h * 0.3), 5, "#1E1B4E");
  ditherSeam(c, w, Math.round(h * 0.46), 5, "#33306B");
  stars(c, w, Math.round(h * 0.48), 60, r, ["#EFE9D2", "#9E96D8", "#6C67A8"]);
  disc(c, Math.round(w * 0.68), Math.round(h * 0.18), Math.round(h * 0.1), "#F5EFD0");
  disc(c, Math.round(w * 0.68), Math.round(h * 0.18), Math.round(h * 0.135), "rgba(245,239,208,0.10)");
  disc(c, Math.round(w * 0.705), Math.round(h * 0.155), Math.round(h * 0.022), "#E4DCBC");

  roof(c, Math.round(-w * 0.05), Math.round(h * 0.46), Math.round(w * 0.46), h, "#221E45", "#4A448A");
  roof(c, Math.round(w * 0.4), Math.round(h * 0.52), Math.round(w * 0.48), h, "#1A1738", "#3C3878");
  roof(c, Math.round(w * 0.12), Math.round(h * 0.62), Math.round(w * 0.62), h, "#100E28", "#2E2B60");
  F(c, 0, Math.round(h * 0.8), w, h, "#0A0820");

  for (const lx of [Math.round(w * 0.18), Math.round(w * 0.52), Math.round(w * 0.84)]) {
    const ly = Math.round(h * 0.7);
    F(c, lx, Math.round(h * 0.6), 1, ly - Math.round(h * 0.6), "#2A2650");
    F(c, lx - 2, ly, 5, 6, "#FF6B4A");
    F(c, lx - 1, ly + 1, 3, 4, "#FFC96B");
    disc(c, lx, ly + 3, 8, "rgba(255,140,80,0.13)");
  }
  for (let i = 0; i < 26; i++) F(c, Math.floor(r() * w), Math.round(h * (0.55 + r() * 0.4)), 1, 1, "rgba(180,170,255,0.30)");
}

/** 서리 호수 — 서리귀. 한색 배경이라 분홍 예고가 가장 세게 튄다. */
function frost(c: Ctx, w: number, h: number): void {
  const r = rand(91);
  bands(c, w, h, [[0.26, "#07182C"], [0.14, "#0E2C46"], [0.12, "#134459"], [0.48, "#0A2334"]]);
  ditherSeam(c, w, Math.round(h * 0.26), 5, "#0E2C46");
  ditherSeam(c, w, Math.round(h * 0.4), 5, "#134459");
  stars(c, w, Math.round(h * 0.3), 48, r, ["#DCF4FF", "#7FB8D8"]);

  for (let k = 0; k < 3; k++) {
    const col = ["rgba(63,227,190,0.30)", "rgba(122,155,232,0.24)", "rgba(63,227,190,0.16)"][k]!;
    for (let x = 0; x < w; x++) {
      const y = Math.round(h * (0.1 + k * 0.05) + Math.sin((x / w) * 6.5 + k * 1.7) * h * 0.045);
      F(c, x, y, 1, Math.round(h * (0.1 - k * 0.02)), col);
    }
  }
  ridge(c, w, h, Math.round(h * 0.56), Math.round(h * 0.16), "#1B4D63", r);
  ridge(c, w, h, Math.round(h * 0.66), Math.round(h * 0.1), "#123648", r);

  const ice = Math.round(h * 0.72);
  F(c, 0, ice, w, h, "#123C50");
  F(c, 0, ice, w, 2, "#4FE3C0");
  for (let i = 0; i < 26; i++) {
    const x = Math.floor(r() * w);
    const y = ice + Math.floor(r() * (h - ice));
    F(c, x, y, 3 + Math.floor(r() * 6), 1, "rgba(180,240,255,0.20)");
  }
  for (let i = 0; i < 12; i++) {
    const x = Math.floor(r() * w);
    const y = ice + Math.floor(r() * (h - ice));
    F(c, x, y, 1, 2 + Math.floor(r() * 3), "rgba(120,200,230,0.22)");
  }
  for (let i = 0; i < 60; i++) F(c, Math.floor(r() * w), Math.floor(r() * h), 1, 1, "rgba(230,250,255,0.55)");
}

/**
 * 잿불 벌판 — 스테이지 1(불) 전용 무대(`stages.ts`의 `backdropScene`).
 *
 * 보통은 보스 종류가 씬을 고른다(무쇠발톱=콜로세움, 살금이=골목, 서리귀=
 * 서리 호수). 스테이지 1은 이 셋 중 무쇠발톱·살금이만 서는데, 스테이지
 * 테마가 "화산" 전체를 말하므로 잔몹전이든 보스전이든 이 씬 하나로
 * 통일한다 — 서리귀(frost)는 스테이지 1에 안 나오는 보스라 손대지 않는다.
 */
function ember(c: Ctx, w: number, h: number): void {
  const r = rand(67);
  bands(c, w, h, [[0.18, "#2A0E0C"], [0.14, "#4A150F"], [0.14, "#7A2A12"], [0.14, "#B5501C"], [0.4, "#1C0906"]]);
  ditherSeam(c, w, Math.round(h * 0.18), 4, "#4A150F");
  ditherSeam(c, w, Math.round(h * 0.32), 4, "#7A2A12");
  ditherSeam(c, w, Math.round(h * 0.46), 5, "#B5501C");

  // 해·달 자리엔 분화구 불빛을 건다.
  disc(c, Math.round(w * 0.76), Math.round(h * 0.16), Math.round(h * 0.15), "rgba(255,140,60,0.14)");
  disc(c, Math.round(w * 0.76), Math.round(h * 0.16), Math.round(h * 0.09), "#FFB25A");

  ridge(c, w, h, Math.round(h * 0.56), Math.round(h * 0.14), "#241009", r);
  ridge(c, w, h, Math.round(h * 0.66), Math.round(h * 0.09), "#160A06", r);

  const floor = Math.round(h * 0.72);
  F(c, 0, floor, w, h, "#1A0906");
  // 갈라진 바닥 틈으로 새는 용암 줄기.
  for (let i = 0; i < 6; i++) {
    const x = Math.floor(r() * w);
    let y = floor + Math.floor(r() * (h - floor) * 0.4);
    for (let k = 0; k < 5; k++) {
      F(c, x + Math.floor((r() - 0.5) * 4), y, 2, 3, "#FF8A3C");
      y += 3;
    }
  }
  for (let i = 0; i < 20; i++) {
    F(c, Math.floor(r() * w), floor + Math.floor(r() * (h - floor)), 1, 1, "rgba(255,190,120,0.5)");
  }
  // 위로 떠오르는 잿불. 별·반딧불과 반대로 아래→위라 열기가 올라간다는 것이 읽힌다.
  for (let i = 0; i < 40; i++) {
    const x = Math.floor(r() * w);
    const y = Math.floor(r() * h * 0.7);
    F(c, x, y, 1, 1, "#FFC97A");
    F(c, x, y, 2, 2, "rgba(255,180,90,0.16)");
  }
}

/**
 * 역병의 밤 — 스테이지 2 전용 무대(`stages.ts`의 `backdropScene`).
 *
 * 안개를 불투명한 띠로 쌓고 나무를 먼저 어둡게 눌러야 판 위의 고양이와
 * 신호가 묻히지 않는다. 포자는 바닥에서 위로만 흘려 역병이 퍼지는 방향을
 * 읽게 하며, 고정 난수로 창 크기가 같을 때 같은 불길함을 유지한다.
 */
function blight(c: Ctx, w: number, h: number): void {
  const r = rand(113);
  const fog = ["#1A1230", "#2B1A43", "#432755", "#17252B", "#101A20"];
  bands(c, w, h, [[0.18, fog[0]!], [0.14, fog[1]!], [0.16, fog[2]!], [0.14, fog[3]!], [0.38, fog[4]!]]);
  ditherSeam(c, w, Math.round(h * 0.18), 4, fog[1]!);
  ditherSeam(c, w, Math.round(h * 0.32), 4, fog[2]!);
  ditherSeam(c, w, Math.round(h * 0.48), 5, fog[3]!);

  // 달빛 대신 독성 안개에 갇힌 보라색 광원을 둔다.
  disc(c, Math.round(w * 0.72), Math.round(h * 0.2), Math.round(h * 0.14), "rgba(143,77,184,0.14)");
  disc(c, Math.round(w * 0.72), Math.round(h * 0.2), Math.round(h * 0.075), "#8F4DB8");
  disc(c, Math.round(w * 0.75), Math.round(h * 0.18), Math.round(h * 0.018), "#C68BE0");

  ridge(c, w, h, Math.round(h * 0.57), Math.round(h * 0.12), "#21152D", r);
  ridge(c, w, h, Math.round(h * 0.68), Math.round(h * 0.08), "#130F1B", r);

  const ground = Math.round(h * 0.73);
  F(c, 0, ground, w, h, "#0C1518");
  // 잎이 없고 갈라진 가지뿐인 나무를 전경에 겹쳐 부패한 숲의 윤곽을 만든다.
  const bareTree = (x: number, base: number, ht: number, col: string): void => {
    const trunk = Math.max(2, Math.round(ht * 0.045));
    F(c, x - Math.floor(trunk / 2), base - ht, trunk, ht, col);
    for (const [at, side, len] of [[0.28, -1, 0.22], [0.42, 1, 0.27], [0.58, -1, 0.19], [0.7, 1, 0.16]] as const) {
      const y = base - Math.round(ht * at);
      const end = Math.round(ht * len);
      F(c, side < 0 ? x - end : x, y, end, 2, col);
      F(c, x + side * Math.round(end * 0.65), y - Math.round(ht * 0.12), 2, Math.round(ht * 0.12), col);
    }
  };
  for (let i = 0; i < 9; i++) {
    const x = Math.round((i / 8) * w) + Math.floor(r() * 8 - 4);
    bareTree(x, ground + 3, Math.round(h * (0.2 + r() * 0.18)), i % 2 ? "#171322" : "#24152D");
  }

  // 안개는 세 층으로 낮게 깔아 배경 깊이는 남기고 전장을 평평하게 만든다.
  for (let layer = 0; layer < 3; layer++) {
    const y = Math.round(h * (0.42 + layer * 0.105));
    for (let x = 0; x < w; x += 7) {
      const wobble = Math.round(Math.sin(x * 0.08 + layer * 2.1) * 3);
      F(c, x, y + wobble, 9 + Math.floor(r() * 8), 2 + layer, `rgba(104,168,76,${0.12 - layer * 0.02})`);
    }
  }

  // 포자는 바닥에서 떠오르며, 큰 점과 잔광을 함께 찍어 움직임을 암시한다.
  for (let i = 0; i < 42; i++) {
    const x = Math.floor(r() * w);
    const y = Math.round(ground - r() * h * 0.52);
    const col = i % 3 === 0 ? "#9DD65C" : "#67B85A";
    F(c, x, y, i % 4 === 0 ? 2 : 1, i % 4 === 0 ? 2 : 1, col);
    F(c, x - 1, y - 1, 3, 3, "rgba(157,214,92,0.14)");
  }
}

/* ------------------------------------------------------------------ */
/* 캐시                                                                 */
/* ------------------------------------------------------------------ */

interface Cached {
  canvas: HTMLCanvasElement;
}

const cache = new Map<string, Cached>();
/** 창 크기 몇 개 × 시각 몇 단계면 충분하다. 넘으면 가장 오래된 것을 버린다. */
const CACHE_MAX = 14;

/**
 * 시각을 몇 단계로 끊는가.
 *
 * 연속으로 두면 웨이브마다 새 버퍼를 그린다. 열두 단계면 한 하루가 열두 장이고,
 * 사람 눈에는 이어져 보이면서 캐시가 실제로 맞는다.
 */
const DAY_STEPS = 12;

function build(scene: Scene, bw: number, bh: number, t: number): HTMLCanvasElement {
  const cv = document.createElement("canvas");
  cv.width = bw;
  cv.height = bh;
  const c = cv.getContext("2d")!;
  c.imageSmoothingEnabled = false;
  if (scene === "stone") stone(c, bw, bh);
  else if (scene === "alley") alley(c, bw, bh);
  else if (scene === "frost") frost(c, bw, bh);
  else if (scene === "ember") ember(c, bw, bh);
  else if (scene === "blight") blight(c, bw, bh);
  else forest(c, bw, bh, t);
  return cv;
}

/**
 * 씬을 화면에 깐다.
 *
 * `t`는 하루의 진행(0=아침, 1=밤)이고 숲에만 쓰인다. 보스 무대는 그 자체가
 * 시각을 정하므로(노을 콜로세움, 달밤 골목, 얼어붙은 밤) 시각 순환이 없다.
 */
export function drawScene(ctx: CanvasRenderingContext2D, w: number, h: number, scene: Scene, t: number): void {
  const bw = Math.max(8, Math.round(w / PIXEL));
  const bh = Math.max(8, Math.round(h / PIXEL));
  const tq = scene === "forest" ? Math.round(t * DAY_STEPS) : 0;
  const key = `${scene}|${bw}x${bh}|${tq}`;

  let hit = cache.get(key);
  if (!hit) {
    hit = { canvas: build(scene, bw, bh, tq / DAY_STEPS) };
    cache.set(key, hit);
    if (cache.size > CACHE_MAX) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
  }

  const prev = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(hit.canvas, 0, 0, w, h);
  ctx.imageSmoothingEnabled = prev;
}
