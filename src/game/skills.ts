import { fieldDistance, type Cat, type PassiveId, type SkillId } from "./types.ts";

/**
 * 스킬 여덟 개. 직업이 같아도 메커니즘이 겹치지 않게 짰다.
 *
 * WoW 계보를 참고했다 — 전사는 물리 광역과 제어(Whirlwind·Shockwave),
 * 도적은 단일 폭딜과 다단히트(Ambush·Sinister Strike), 궁수는 관통과 다중
 * 사격(Piercing Shot·Multi-Shot), 마법사는 지속 피해와 범위 제어(Immolate·Frost Nova).
 *
 * 여기서는 상태를 바꾸기만 하고 연출은 battle.ts가 큐에 쌓는다.
 * 그래야 헤드리스 시뮬레이션에서도 같은 코드가 그대로 돈다.
 */

/**
 * 직업 패시브 — 마나 없이 항상 작동한다.
 *
 * WoW에서 가져왔다. 도적의 Slice and Dice는 콤보 포인트로 **공격 속도**를 올린다
 * ("때릴수록 세진다"의 WoW식 답은 피해량이 아니라 속도다). 궁수는 Multi-Shot 계열의
 * 연쇄 사격이다.
 *
 * 여덟 마리 중 둘만 패시브를 갖는다. 나머지 여섯은 마나가 차면 터지는 액티브다.
 */
/** 연격 한 단계당 공격 속도 증가분, 최대 단계 */
export const COMBO_STEP = 0.1;
export const COMBO_MAX = 5;
/** 도탄이 튀는 대상 수와 피해 비율 */
export const RICOCHET_TARGETS = 2;
export const RICOCHET_MUL = 0.4;
export interface PassiveMeta {
  name: string;
  desc: string;
}

export const PASSIVES: Record<PassiveId, PassiveMeta> = {
  ricochet: { name: "도탄", desc: "공격이 근처의 다른 적 둘에게도 튄다" },
  combo: { name: "연격", desc: "같은 적을 계속 때릴수록 손이 빨라진다" },
};

export interface SkillMeta {
  name: string;
  /** 카드와 도감에 뜨는 한 줄 설명 */
  desc: string;
}

export const SKILLS: Record<SkillId, SkillMeta> = {
  whirlwind: { name: "회전베기", desc: "주변의 적 전부를 크게 후려친다" },
  shockwave: { name: "대지 강타", desc: "주변의 적을 잠시 기절시킨다" },
  shadow_strike: { name: "그림자 일격", desc: "가장 약한 적을 단숨에 노린다" },
  pierce: { name: "꿰뚫기", desc: "일직선 위의 적을 전부 관통한다" },
  ember: { name: "불씨", desc: "목표를 태워 한동안 계속 피해를 준다" },
  frost_nova: { name: "서리 발톱", desc: "주변의 적을 얼려 묶어 둔다" },
};

/** 스킬 한 번이 만들어내는 결과. battle.ts가 실제 피해 적용과 연출을 맡는다. */
export interface SkillHit {
  target: Cat;
  /** 공격력 배수 */
  mul: number;
}

export interface SkillResult {
  hits: SkillHit[];
  /** 기절시킬 대상과 시간(ms) */
  stuns: { target: Cat; ms: number }[];
  /** 지속 피해를 걸 대상 */
  dots: { target: Cat; dps: number; ms: number }[];
  /** 발동 시점에 시전자가 되돌려받는 마나 */
  manaRefund: number;
  /** 연출용 — 여러 발을 쏘는 스킬인지 */
  shots: Cat[];
}

function empty(): SkillResult {
  return { hits: [], stuns: [], dots: [], manaRefund: 0, shots: [] };
}

const AURA = 1.6;

/** 시전자 주변 반경 안의 적. */
function nearby(caster: Cat, foes: Cat[], radius: number): Cat[] {
  return foes.filter((f) => fieldDistance(caster, f) <= radius);
}

/**
 * 목표 방향 직선에서 폭 width 안에 들어오는 적.
 * 정확한 기하 대신 시전자→목표 벡터에 사영해 거리를 잰다. 관통이라는 느낌만 나면 된다.
 */
function inLine(caster: Cat, target: Cat, foes: Cat[], width: number): Cat[] {
  const dx = target.fx - caster.fx;
  const dy = target.fy - caster.fy;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  return foes.filter((f) => {
    const rx = f.fx - caster.fx;
    const ry = f.fy - caster.fy;
    const along = rx * ux + ry * uy;
    if (along < 0) return false; // 뒤쪽은 맞지 않는다
    const perp = Math.abs(rx * uy - ry * ux);
    return perp <= width;
  });
}

export function runSkill(caster: Cat, target: Cat, foes: Cat[], allies: Cat[]): SkillResult {
  const r = empty();

  switch (caster.breed.skill) {
    // ── 전사 ──────────────────────────────────────────
    case "whirlwind": {
      // 주변 전부를 후린다. 몰려 있을수록 강하다.
      for (const f of nearby(caster, foes, AURA)) r.hits.push({ target: f, mul: 1.5 });
      break;
    }
    case "shockwave": {
      // 피해는 작지만 주변을 묶는다. 탱커가 판을 정지시키는 역할.
      for (const f of nearby(caster, foes, AURA)) {
        r.hits.push({ target: f, mul: 0.7 });
        r.stuns.push({ target: f, ms: 1100 });
      }
      break;
    }

    // ── 도적 ──────────────────────────────────────────
    case "shadow_strike": {
      // 체력이 가장 낮은 적을 노린다. 마무리 담당.
      const prey = [...foes].sort((a, b) => a.hp - b.hp)[0] ?? target;
      r.hits.push({ target: prey, mul: 2.6 });
      // 처치로 이어지면 마나를 절반 돌려받아 연속으로 터뜨린다.
      if (prey.hp <= caster.atk * 2.6) r.manaRefund = 50;
      break;
    }

    // ── 궁수 ──────────────────────────────────────────
    case "pierce": {
      const line = inLine(caster, target, foes, 0.7);
      const list = line.length > 0 ? line : [target];
      for (const f of list) r.hits.push({ target: f, mul: 1.35 });
      r.shots = list;
      break;
    }

    // ── 마법사 ────────────────────────────────────────
    case "ember": {
      // 즉발은 약하고 지속 피해가 본체. 오래 버티는 적일수록 아프다.
      r.hits.push({ target, mul: 0.5 });
      r.dots.push({ target, dps: caster.atk * 0.55, ms: 4000 });
      r.shots = [target];
      break;
    }
    case "frost_nova": {
      // 목표 주변을 얼린다. 피해는 덤이고 시간을 버는 게 목적.
      const hitList = nearby(target, foes, AURA * 0.9);
      const list = hitList.length > 0 ? hitList : [target];
      for (const f of list) {
        r.hits.push({ target: f, mul: 0.55 });
        r.stuns.push({ target: f, ms: 1500 });
      }
      r.shots = [target];
      break;
    }
  }

  void allies;
  return r;
}
