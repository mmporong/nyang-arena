import { fieldDistance, type Cat, type PassiveId, type SkillId } from "./types.ts";
import { BULWARK_UNIT, LURE_UNIT, SWARM_PACK, type SummonSpec } from "./run.ts";

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
  guard: { name: "감싸기", desc: "주변 우리 편에게 보호막을 씌운다" },
  gouge: { name: "급소치기", desc: "한 마리를 깊게 찌르고 잠시 재운다" },
  volley: { name: "화살비", desc: "적 전체에게 화살을 흩뿌린다" },
  mend: { name: "핥아주기", desc: "가장 다친 우리 편의 상처를 아물린다" },
  swarm: { name: "떼부르기", desc: "작은 그림자 셋을 불러 앞으로 보낸다" },
  bulwark: { name: "버팀목", desc: "커다란 그림자 하나를 세워 막아 낸다" },
  lure: { name: "미끼 세우기", desc: "적의 눈을 끄는 허깨비를 세운다" },
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
  /**
   * 회복시킬 우리 편.
   *
   * 이 게임에 **회복이 없었다.** 여덟 스킬이 전부 적을 어떻게 할지만 정했고,
   * 그래서 전투가 시작되면 팀의 총 체력은 내려가기만 했다. 지키는 쪽 축이
   * 생기면 "누구를 살릴까"가 배치와 구매에 새로 걸린다.
   */
  heals: { target: Cat; amount: number }[];
  /** 보호막을 씌울 우리 편. 회복과 달리 미리 걸어 두는 것이다. */
  shields: { target: Cat; amount: number }[];
  /**
   * 불러낼 소환수.
   *
   * **여기서는 무엇을 부를지만 적고 실제 생성은 `battle.ts`가 한다.**
   * 소환은 `state.summons`를 건드려야 하는데 이 모듈은 `RunState`를 모른다 —
   * 그 경계를 지켜야 헤드리스 시뮬과 브라우저가 같은 코드를 돈다.
   */
  summons: { spec: SummonSpec }[];
  /** 발동 시점에 시전자가 되돌려받는 마나 */
  manaRefund: number;
  /** 연출용 — 여러 발을 쏘는 스킬인지 */
  shots: Cat[];
}

function empty(): SkillResult {
  return {
    hits: [],
    stuns: [],
    dots: [],
    heals: [],
    shields: [],
    summons: [],
    manaRefund: 0,
    shots: [],
  };
}

const AURA = 1.6;

/** 화살비가 한 번에 덮는 최대 마릿수. 상한이 없으면 판이 커질수록 값이 폭주한다. */
const VOLLEY_TARGETS = 4;

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

    // ── 직업당 세 번째 고양이 ─────────────────────────
    //
    // 앞의 여섯과 메커니즘이 겹치지 않게 골랐다. 특히 `guard`·`mend`는 이
    // 게임에 없던 **지키는 쪽**이다 — 그 전까지 스킬 여덟이 전부 적을 어떻게
    // 할지만 정했다.
    case "guard": {
      // 자기 주변 우리 편에게 보호막. 앞에서 버티는 전사가 뒤를 덮는 그림이다.
      // 시전자 자신도 `allies`에 들어 있으므로 같이 받는다.
      const amount = Math.max(1, Math.round(caster.maxHp * 0.22));
      for (const a of nearby(caster, allies, AURA)) r.shields.push({ target: a, amount });
      break;
    }
    case "gouge": {
      // 급소. 회전베기·대지 강타가 광역인 것과 달리 **한 마리를 지목해 끊는다.**
      // 그림자 일격이 가장 약한 적을 마무리하는 것과 달리 지금 때리던 상대다 —
      // 즉 앞에 선 위험한 하나를 잠깐 멈추는 쪽에 가깝다.
      r.hits.push({ target, mul: 2.0 });
      r.stuns.push({ target, ms: 900 });
      break;
    }
    case "volley": {
      // 목표 주변에 넓게 흩뿌린다. 꿰뚫기가 일직선이라 줄 선 적에게 강한 반면
      // 이쪽은 뭉친 덩어리에 강하다.
      //
      // **처음에는 적 전체였는데 그게 판을 망가뜨렸다.** 다른 광역기는 전부
      // 반경 1.6 안인데 이것만 무제한이라, 적이 쓰면 우리 열 마리가 한 번에
      // 맞았다 — 도달 웨이브 중앙값이 11에서 9로, p25가 8에서 3으로 내려갔다.
      // 넷으로 묶는다. 상한이 있어야 판 크기가 커져도 값이 안 폭주한다.
      const near = [...nearby(target, foes, AURA * 1.7)]
        .sort(
          (a, b) =>
            fieldDistance(target, a) - fieldDistance(target, b) ||
            (a.uid < b.uid ? -1 : 1),
        )
        .slice(0, VOLLEY_TARGETS);
      const list = near.length > 0 ? near : [target];
      for (const f of list) r.hits.push({ target: f, mul: 0.75 });
      r.shots = list;
      break;
    }
    case "mend": {
      // 가장 많이 다친 우리 편 하나를 아물린다. 비율로 고르는 이유는 절대량으로
      // 고르면 체력이 큰 전사만 계속 받기 때문이다.
      // 동점은 uid로 갈라 헤드리스 시뮬과 브라우저가 같은 대상을 고르게 한다.
      const hurt = [...allies].sort(
        (a, b) => a.hp / a.maxHp - b.hp / b.maxHp || (a.uid < b.uid ? -1 : 1),
      )[0];
      // 만피면 아무것도 하지 않는다 — `castSkill`이 이 빈 결과를 보고
      // 마나를 안 깎고 평타로 떨어뜨린다.
      if (hurt && hurt.hp < hurt.maxHp) {
        r.heals.push({ target: hurt, amount: Math.max(1, Math.round(caster.atk * 2.4)) });
      }
      break;
    }

    // ── 소환사 ────────────────────────────────────────
    //
    // 셋 다 몸을 내보내지만 값이 어디에 있는지가 다르다 — 숫자, 내구, 되부름.
    // 실제 생성은 `battle.ts`가 한다(`RunState`가 필요해서다).
    case "swarm": {
      r.summons.push({ spec: SWARM_PACK });
      break;
    }
    case "bulwark": {
      // 큰 것 하나. 보호막은 `battle.ts`가 소환된 몸에 바로 걸어 준다 —
      // 여기서는 아직 그 몸이 없으므로 `shields`에 담을 수가 없다.
      r.summons.push({ spec: BULWARK_UNIT });
      break;
    }
    case "lure": {
      // 때리지 못하는 대신 **적의 눈을 끈다.** 떼부르기·버팀목이 몸의 숫자와
      // 내구로 버티는 것과 달리, 이쪽은 누가 맞을지를 바꾼다.
      r.summons.push({ spec: LURE_UNIT });
      break;
    }
    default: {
      // 패시브(`skill: null`)는 스킬이 없어 빈 결과가 맞다. 그 밖의 값은 빠진 분기다 —
      // 새 SkillId를 `SKILLS`에만 넣고 여기를 빠뜨리면 조용히 평타로 떨어졌다. 컴파일에서 잡는다.
      if (caster.breed.skill !== null) {
        const never: never = caster.breed.skill;
        throw new Error(`알 수 없는 스킬: ${String(never)}`);
      }
    }
  }

  return r;
}
