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
import type { CatColor } from "../game/types.ts";

export const TRIGGERS = ["same_color_3", "same_breed_2", "all_different_5"] as const;
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

/** 제어문자·태그 제거. 캔버스에 그리므로 XSS는 아니지만 렌더 깨짐을 막는다. */
function cleanText(s: string, max: number): string {
  return s
    .replace(/[\u0000-\u001f<>]/g, "")
    .trim()
    .slice(0, max);
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

  return {
    ok: true,
    rule: {
      id,
      name: cleanText(name, MAX_NAME),
      desc: cleanText(desc, MAX_DESC),
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
    id: "night_pack",
    name: "야행성",
    desc: "같은 색 3마리가 어둠 속에서 발톱을 세운다",
    trigger: "same_color_3",
    effect: { key: "atk_mul", value: 1.35 },
  },
  {
    id: "litter_bond",
    name: "한배 형제",
    desc: "같은 품종 2마리가 서로 등을 맡긴다",
    trigger: "same_breed_2",
    effect: { key: "hp_mul", value: 1.3 },
  },
  {
    id: "motley_crew",
    name: "잡색 부대",
    desc: "전부 다른 색 5마리가 어수선하게 흩어진다",
    trigger: "all_different_5",
    effect: { key: "evade_add", value: 0.18 },
  },
];

/** 활성 시너지 판정: 아군 보드 구성이 트리거 조건을 만족하는지. */
export function isTriggered(trigger: Trigger, colors: CatColor[], breedIds: number[]): boolean {
  switch (trigger) {
    case "same_color_3": {
      const count = new Map<string, number>();
      for (const c of colors) count.set(c, (count.get(c) ?? 0) + 1);
      return [...count.values()].some((n) => n >= 3);
    }
    case "same_breed_2": {
      const count = new Map<number, number>();
      for (const b of breedIds) count.set(b, (count.get(b) ?? 0) + 1);
      return [...count.values()].some((n) => n >= 2);
    }
    case "all_different_5":
      return colors.length >= 5 && new Set(colors).size === colors.length;
  }
}
