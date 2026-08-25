/**
 * LLM이 생성한 시너지 규칙을 게임이 실행해도 안전한 형태로 압축하는 검증기.
 *
 * 설계 원칙: LLM 출력을 "신뢰하고 파싱"하지 않는다. 화이트리스트에 없는 것은
 * 전부 폐기하고, 통과한 값도 게임이 감당하는 범위로 하드 클램프한다.
 * 그 결과 LLM이 무엇을 뱉든 런타임 계약은 깨지지 않는다.
 *
 * 이 파일은 빌드타임 생성 스크립트(scripts/gen-synergies.mjs)와 런타임이
 * 공유한다. 8/26 런타임 프록시로 승격할 때도 같은 검증기를 그대로 쓴다.
 */
import { BOARD_COLS, CLASS_LABEL, type ClassKind } from "../game/types.ts";

/**
 * 시너지 조건.
 *
 * 모든 조건은 **동시에 성립할 수 있어야 한다.** 예전에는 all_different_5(전부 다른 색 5)가
 * 있었는데, 색이 전부 달라야 하므로 same_color_3·same_breed_2와 수학적으로 배타였다.
 * 그런데 UI는 셋을 나란히 놓아 다 모으라는 것처럼 보여줬다. 게다가 그 조건이 켜진
 * 상태에서 중복 색을 영입하면 팀 전력이 영구히 깎이는 함정이기도 했다.
 *
 * front/back 조건은 배치를 요구한다. 구성(무엇을 사는가)과 배치(어디에 놓는가)가
 * 따로 놀지 않게 하려는 것이다.
 */
export const COMPOSITE_TRIGGERS = [
  "mage_3_rogue_3",
  "warrior_3_archer_3",
  "summoner_3_mage_3",
] as const;
export type CompositeTrigger = (typeof COMPOSITE_TRIGGERS)[number];

export const TRIGGERS = [
  "same_breed_2",
  "front_melee_2",
  "back_ranged_2",
  // 중간 난이도를 위해 신설했다. 2마리 배치 조건은 자동 배치가 거의 채워
  // 주지만(빈 팀 시작 뒤 easy 합산 실측 77.2%), 3마리째부터는 그 직업군을 실제로 사 모아야 한다.
  "front_melee_3",
  "back_ranged_3",
  ...COMPOSITE_TRIGGERS,
] as const;
export type Trigger = (typeof TRIGGERS)[number];

export const EFFECT_KEYS = ["atk_mul", "hp_mul", "evade_add", "atkspd_mul"] as const;
export type EffectKey = (typeof EFFECT_KEYS)[number];

/** 효과별 허용 범위. 밖으로 나가면 폐기가 아니라 경계로 클램프한다. */
export const EFFECT_RANGE: Record<EffectKey, readonly [number, number]> = {
  atk_mul: [1.1, 1.6],
  hp_mul: [1.1, 1.6],
  evade_add: [0.05, 0.3],
  atkspd_mul: [1.1, 1.5],
};

export interface SynergyRule {
  id: string;
  name: string;
  desc: string;
  trigger: Trigger;
  effect: { key: EffectKey; value: number };
}

const ID_RE = /^[a-z][a-z0-9_]{1,31}$/;
const MAX_NAME = 16;
const MAX_DESC = 48;

export interface ValidationResult {
  accepted: SynergyRule[];
  rejected: { raw: unknown; reason: string }[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * 제어문자·꺾쇠·유니코드 서식문자를 제거하고 코드포인트 단위로 자른다.
 *
 * 캔버스에 그리므로 XSS는 아니지만 렌더가 깨진다:
 * - U+202E(RTL override) 같은 서식문자는 뒤따르는 글자를 역순으로 그린다
 * - slice()는 UTF-16 코드유닛 기준이라 이모지의 서로게이트 쌍을 반토막 내고,
 *   짝 잃은 서로게이트는 두부 글자로 렌더된다
 */
function cleanText(s: string, max: number): string {
  const stripped = s
    .replace(/[\u0000-\u001f\u007f<>]/g, "")
    .replace(/\p{Cf}/gu, "");
  return [...stripped.trim()].slice(0, max).join("");
}

export function validateRule(raw: unknown): { ok: true; rule: SynergyRule } | { ok: false; reason: string } {
  if (!isRecord(raw)) return { ok: false, reason: "객체가 아님" };

  const { id, name, desc, trigger, effect } = raw;

  if (typeof id !== "string" || !ID_RE.test(id)) return { ok: false, reason: "id 형식 위반" };
  if (typeof name !== "string" || name.trim().length === 0) return { ok: false, reason: "name 없음" };
  if (typeof desc !== "string" || desc.trim().length === 0) return { ok: false, reason: "desc 없음" };
  if (typeof trigger !== "string" || !(TRIGGERS as readonly string[]).includes(trigger))
    return { ok: false, reason: `허용되지 않은 trigger: ${String(trigger)}` };
  if (!isRecord(effect)) return { ok: false, reason: "effect가 객체가 아님" };

  const key = effect["key"];
  const value = effect["value"];
  if (typeof key !== "string" || !(EFFECT_KEYS as readonly string[]).includes(key))
    return { ok: false, reason: `허용되지 않은 effect.key: ${String(key)}` };
  if (typeof value !== "number" || !Number.isFinite(value))
    return { ok: false, reason: "effect.value가 유한한 수가 아님" };

  const ek = key as EffectKey;
  const range = EFFECT_RANGE[ek];

  // 비어있음 검사는 반드시 새니타이즈 "뒤"에 한다.
  // 원본만 검사하면 "<>"나 제어문자로만 이루어진 이름이 통과해서
  // 화면에 이름 없는 시너지 칩이 뜬다.
  const cleanName = cleanText(name, MAX_NAME);
  const cleanDesc = cleanText(desc, MAX_DESC);
  if (cleanName.length === 0) return { ok: false, reason: "name이 새니타이즈 후 비었음" };
  if (cleanDesc.length === 0) return { ok: false, reason: "desc가 새니타이즈 후 비었음" };

  return {
    ok: true,
    rule: {
      id,
      name: cleanName,
      desc: cleanDesc,
      trigger: trigger as Trigger,
      effect: { key: ek, value: Number(clamp(value, range[0], range[1]).toFixed(3)) },
    },
  };
}

export function validateAll(raws: unknown): ValidationResult {
  const out: ValidationResult = { accepted: [], rejected: [] };
  if (!Array.isArray(raws)) return out;

  const seen = new Set<string>();
  for (const raw of raws) {
    const r = validateRule(raw);
    if (!r.ok) {
      out.rejected.push({ raw, reason: r.reason });
      continue;
    }
    if (seen.has(r.rule.id)) {
      out.rejected.push({ raw, reason: `id 중복: ${r.rule.id}` });
      continue;
    }
    seen.add(r.rule.id);
    out.accepted.push(r.rule);
  }
  return out;
}

/** 검증기가 전부 폐기했거나 데이터가 비었을 때 쓰는 최후 폴백. AC-12. */
export const PRESET_SYNERGIES: readonly SynergyRule[] = [
  {
    id: "iron_line",
    name: "철벽 대열",
    desc: "앞줄 근접 셋이 어깨를 맞대 벽이 된다",
    trigger: "front_melee_3",
    effect: { key: "hp_mul", value: 1.42 },
  },
  {
    id: "litter_bond",
    name: "한배 형제",
    desc: "같은 품종 2마리가 서로 등을 맡긴다",
    trigger: "same_breed_2",
    effect: { key: "hp_mul", value: 1.3 },
  },
  {
    id: "vanguard",
    name: "선봉",
    desc: "앞줄에 선 근접들이 발을 굳게 딛는다",
    trigger: "front_melee_2",
    effect: { key: "hp_mul", value: 1.25 },
  },
  {
    id: "covering_fire",
    name: "엄호 사격",
    desc: "뒤에 선 원거리가 침착하게 조준한다",
    trigger: "back_ranged_2",
    effect: { key: "atk_mul", value: 1.3 },
  },
  {
    id: "arcane_heist",
    name: "비전 강탈단",
    desc: "마법사 셋의 주문을 도적 셋이 적진에 꽂는다",
    trigger: "mage_3_rogue_3",
    effect: { key: "atk_mul", value: 1.6 },
  },
];

/** 판정에 필요한 아군 한 마리의 정보. Cat 전체를 끌어오지 않으려고 최소 형태만 받는다. */
export interface BoardUnit {
  breedId: number;
  cls: ClassKind;
  kind: "melee" | "ranged";
  /** 열 인덱스. 0이 뒷줄, 2가 앞줄(적에게 가까운 쪽) */
  col: number;
}

/** 적에게 가장 가까운 열과 가장 먼 열. 보드 폭이 바뀌어도 따라간다. */
const FRONT_COL = BOARD_COLS - 1;
const BACK_COL = 0;

const COMPOSITE_REQUIREMENTS: Record<CompositeTrigger, readonly [ClassKind, ClassKind]> = {
  mage_3_rogue_3: ["mage", "rogue"],
  warrior_3_archer_3: ["warrior", "archer"],
  summoner_3_mage_3: ["summoner", "mage"],
};

export function isCompositeTrigger(trigger: Trigger): trigger is CompositeTrigger {
  return (COMPOSITE_TRIGGERS as readonly string[]).includes(trigger);
}

export interface SynergyProgressPart {
  label: string;
  have: number;
  need: number;
}

export interface SynergyProgress {
  have: number;
  need: number;
  parts: readonly SynergyProgressPart[];
}

function singleProgress(label: string, have: number, need: number): SynergyProgress {
  return { have, need, parts: [{ label, have, need }] };
}

/**
 * 조건 달성도. "몇 개 중 몇 개"를 그대로 화면에 띄우기 위해 불리언이 아니라 수치를 낸다.
 * 조건만 보여주고 진행도를 감추면 플레이어가 무엇을 더 해야 하는지 알 수 없다.
 */
export function synergyProgress(trigger: Trigger, units: BoardUnit[]): SynergyProgress {
  if (isCompositeTrigger(trigger)) {
    const parts = COMPOSITE_REQUIREMENTS[trigger].map((cls) => ({
      label: CLASS_LABEL[cls],
      have: units.filter((u) => u.cls === cls).length,
      need: 3,
    }));
    return {
      have: parts.reduce((sum, part) => sum + Math.min(part.have, part.need), 0),
      need: parts.reduce((sum, part) => sum + part.need, 0),
      parts,
    };
  }

  switch (trigger) {
    case "same_breed_2": {
      const m = new Map<number, number>();
      for (const u of units) m.set(u.breedId, (m.get(u.breedId) ?? 0) + 1);
      return singleProgress("같은 품종", Math.max(0, ...m.values()), 2);
    }
    case "front_melee_2":
      return singleProgress("앞줄 근접", units.filter((u) => u.col === FRONT_COL && u.kind === "melee").length, 2);
    case "back_ranged_2":
      return singleProgress("뒷줄 원거리", units.filter((u) => u.col === BACK_COL && u.kind === "ranged").length, 2);
    case "front_melee_3":
      return singleProgress("앞줄 근접", units.filter((u) => u.col === FRONT_COL && u.kind === "melee").length, 3);
    case "back_ranged_3":
      return singleProgress("뒷줄 원거리", units.filter((u) => u.col === BACK_COL && u.kind === "ranged").length, 3);
  }
}

export function isTriggered(trigger: Trigger, units: BoardUnit[]): boolean {
  return synergyProgress(trigger, units).parts.every((part) => part.have >= part.need);
}

/** 복합 조건은 두 직업을 합계로 뭉개지 않고 각각의 진행도를 보여 준다. */
export function synergyProgressLabel(trigger: Trigger, units: BoardUnit[]): string {
  return synergyProgress(trigger, units).parts
    .map((part) => `${part.label} ${Math.min(part.have, part.need)}/${part.need}`)
    .join(" + ");
}

/**
 * 목표 난이도 — **실측 라벨**이다. 계산 모형이 아니다.
 *
 * 모형을 두 번 세웠고 두 번 다 실측이 부정했다. 처음엔 "배치 제약이 있으면
 * 빡빡하다"(요구 마릿수 × 배치 제약)로 봤는데 front/back이 오히려 제일 쉬웠다 —
 * `bestFreeCell`이 근접은 앞줄, 원거리는 뒷줄에 기본으로 앉히기 때문이다.
 * 다음엔 "요구 마릿수 × 매칭 후보군 크기"로 다시 세웠는데(breed 15종이라
 * same_breed_2를 중간으로 예측), 이것도 실측이 부정했다. 상점 오퍼가 품종을
 * 반복해서 내밀기 때문에 "15종 중 같은 것"이 모형 생각만큼 좁지 않다.
 *
 * 그래서 라벨을 실측에 직접 묶는다. Record라 트리거를 늘리면 컴파일러가
 * 누락을 잡고, 수치가 의심되면 리뷰 계측 스크립트로 다시 잰다(500런 ·
 * 전투 시작 시점 활성 기준). 로스터·상점·자동 배치가 바뀌면 재측정할 것.
 */
const TRIGGER_DIFFICULTY: Record<Trigger, Difficulty> = {
  front_melee_2: "easy", // 빈 팀 시작 500런 easy 합산 77.2%
  back_ranged_2: "easy",
  same_breed_2: "easy", // 두 모형 모두 이걸 중간으로 잘못 예측했다
  front_melee_3: "medium", // 단일 3마리 조건 합산 58.0%
  back_ranged_3: "medium",
  mage_3_rogue_3: "hard", // 이중 직업 3+3 조건 합산 3.0%
  warrior_3_archer_3: "hard",
  summoner_3_mage_3: "hard",
};

export type Difficulty = "easy" | "medium" | "hard";

export function triggerDifficulty(trigger: Trigger): Difficulty {
  return TRIGGER_DIFFICULTY[trigger];
}

/** 효과 키별 기준값. atk_mul 등은 배수라 1이 기준이고, evade_add는 더하는 값이라 0이 기준이다. */
const EFFECT_BASELINE: Record<EffectKey, number> = {
  atk_mul: 1,
  hp_mul: 1,
  atkspd_mul: 1,
  evade_add: 0,
};

/**
 * 난이도별 화면 보너스.
 *
 * 원본 값을 단순 배율로 키우면 효과 종류가 다른 세 칩에서 `+40% → +21%`처럼
 * 마지막 악몽 보상이 더 약해 보였다. 입문·도전은 효과 종류와 무관한 고정 퍼센트,
 * 악몽은 그 효과의 안전 상한을 써 화면과 실제 규칙이 함께 `입문 < 도전 < 악몽`이 된다.
 */
const DIFFICULTY_EFFECT_BONUS: Record<Exclude<Difficulty, "hard">, number> = {
  easy: 0.12,
  medium: 0.2,
};

/**
 * 규칙의 효과 크기를 난이도에 맞게 다시 잰다.
 *
 * 입문은 +12%, 도전은 +20%, 악몽은 효과별 허용 상한이다. 배수 효과는 1에서,
 * 회피는 0에서 더한다. 마지막 클램프는 생성 데이터의 안전 경계를 그대로 지킨다.
 */
export function scaleEffectForDifficulty(
  effect: SynergyRule["effect"],
  difficulty: Difficulty,
): SynergyRule["effect"] {
  const base = EFFECT_BASELINE[effect.key];
  const [lo, hi] = EFFECT_RANGE[effect.key];
  const scaled = difficulty === "hard"
    ? hi
    : base + DIFFICULTY_EFFECT_BONUS[difficulty];
  return { key: effect.key, value: Number(clamp(scaled, lo, hi).toFixed(3)) };
}

/** UI와 접근성 문구가 공유하는 난이도 이름. */
export function difficultyLabel(difficulty: Difficulty): "입문" | "도전" | "악몽" {
  if (difficulty === "easy") return "입문";
  if (difficulty === "medium") return "도전";
  return "악몽";
}

/** 화면에 띄울 조건 문구. */
export function triggerLabel(trigger: Trigger): string {
  switch (trigger) {
    case "same_breed_2":
      return "같은 품종";
    case "front_melee_2":
      return "앞줄 근접";
    case "back_ranged_2":
      return "뒷줄 원거리";
    case "front_melee_3":
      return "앞줄 근접";
    case "back_ranged_3":
      return "뒷줄 원거리";
    case "mage_3_rogue_3":
      return "마법사 3 + 도적 3";
    case "warrior_3_archer_3":
      return "전사 3 + 궁수 3";
    case "summoner_3_mage_3":
      return "소환사 3 + 마법사 3";
  }
}

/** 효과를 사람 말로. 무엇을 얻는지 안 보여주면 목표를 쫓을 이유가 없다. */
export function effectLabel(effect: SynergyRule["effect"]): string {
  const pct = Math.round((effect.value - 1) * 100);
  switch (effect.key) {
    case "atk_mul":
      return `공격력 +${pct}%`;
    case "hp_mul":
      return `체력 +${pct}%`;
    case "atkspd_mul":
      return `공격 속도 +${pct}%`;
    case "evade_add":
      return `회피 +${Math.round(effect.value * 100)}%`;
  }
}
