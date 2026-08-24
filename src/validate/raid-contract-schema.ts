import type { BossPattern } from "../game/bosses.ts";
import shippedContracts from "../data/raid-contracts.json" with { type: "json" };

/** 런타임이 실행할 수 있는 보스 패턴의 닫힌 목록. */
export const RAID_PATTERN_TOKENS = [
  "circle",
  "line",
  "cone",
  "gather",
  "stomp",
  "hearth",
  "quake",
  "creep",
  "sweep",
  "polarity",
  "seize",
] as const satisfies readonly BossPattern[];

export type RaidPatternToken = (typeof RAID_PATTERN_TOKENS)[number];
export type RaidRisk = 1 | 2 | 3;

export const RAID_RISK_RANGE = [1, 3] as const;
export const RAID_REWARD_RANGE = [2, 6] as const;

export interface RaidContract {
  readonly id: string;
  readonly name: string;
  readonly rule: string;
  readonly counter: string;
  readonly risk: RaidRisk;
  readonly rewardFish: number;
  readonly patterns: readonly RaidPatternToken[];
  readonly phase2Patterns?: readonly RaidPatternToken[];
  readonly proofCode: string;
}

export interface ContractAdjustment {
  id: string;
  field: "risk" | "reward";
  from: number;
  to: number;
}

export interface ContractValidationResult {
  accepted: RaidContract[];
  rejected: { raw: unknown; reason: string }[];
}

type SingleValidation =
  | { ok: true; contract: RaidContract; adjustments: ContractAdjustment[] }
  | { ok: false; reason: string };

const ID_RE = /^[a-z][a-z0-9_]{2,23}$/;
const PROOF_RE = /^[A-Z0-9-]{3,12}$/;
const MIN_NAME = 2;
const MAX_NAME = 7;
const MAX_COPY = 34;
const MIN_PATTERNS = 3;
const MAX_PATTERNS = 4;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function cleanText(value: string, max: number): string {
  return [...value
    .replace(/[\u0000-\u001f\u007f<>]/g, "")
    .replace(/\p{Cf}/gu, "")
    .trim()]
    .slice(0, max)
    .join("");
}

function validatePatterns(raw: unknown, field: string): RaidPatternToken[] | string {
  if (!Array.isArray(raw)) return `${field}가 배열이 아님`;
  if (raw.length < MIN_PATTERNS) return `${field}가 최소 ${MIN_PATTERNS}개보다 적음`;
  if (raw.length > MAX_PATTERNS) return `${field}가 최대 ${MAX_PATTERNS}개를 초과함`;

  const patterns: RaidPatternToken[] = [];
  for (const token of raw) {
    if (typeof token !== "string" || !(RAID_PATTERN_TOKENS as readonly string[]).includes(token)) {
      return `${field}에 허용되지 않은 패턴: ${String(token)}`;
    }
    patterns.push(token as RaidPatternToken);
  }
  return patterns;
}

/** 무신뢰 단일 후보를 실행 가능한 계약으로 새니타이즈한다. */
export function validateRaidContract(raw: unknown): SingleValidation {
  if (!isRecord(raw)) return { ok: false, reason: "객체가 아님" };

  const { id, name, rule, counter, risk, rewardFish, patterns, phase2Patterns, proofCode } = raw;
  if (typeof id !== "string" || !ID_RE.test(id)) return { ok: false, reason: "id 형식 위반" };
  if (typeof name !== "string") return { ok: false, reason: "name이 문자열이 아님" };
  if (typeof rule !== "string") return { ok: false, reason: "rule이 문자열이 아님" };
  if (typeof counter !== "string") return { ok: false, reason: "counter가 문자열이 아님" };
  if (typeof risk !== "number" || !Number.isFinite(risk)) {
    return { ok: false, reason: "risk가 유한한 수가 아님" };
  }
  if (typeof rewardFish !== "number" || !Number.isFinite(rewardFish)) {
    return { ok: false, reason: "rewardFish가 유한한 수가 아님" };
  }
  if (typeof proofCode !== "string" || !PROOF_RE.test(proofCode)) {
    return { ok: false, reason: "proofCode 형식 위반" };
  }

  const cleanName = cleanText(name, MAX_NAME);
  const cleanRule = cleanText(rule, MAX_COPY);
  const cleanCounter = cleanText(counter, MAX_COPY);
  if ([...cleanName].length === 0) return { ok: false, reason: "name이 새니타이즈 후 비었음" };
  if ([...cleanName].length < MIN_NAME) {
    return { ok: false, reason: `name이 새니타이즈 후 최소 ${MIN_NAME}글자보다 짧음` };
  }
  if (cleanRule.length === 0) return { ok: false, reason: "rule이 새니타이즈 후 비었음" };
  if (cleanCounter.length === 0) return { ok: false, reason: "counter가 새니타이즈 후 비었음" };

  const cleanPatterns = validatePatterns(patterns, "patterns");
  if (typeof cleanPatterns === "string") return { ok: false, reason: cleanPatterns };

  let cleanPhase2: RaidPatternToken[] | undefined;
  if (phase2Patterns !== undefined) {
    const validated = validatePatterns(phase2Patterns, "phase2Patterns");
    if (typeof validated === "string") return { ok: false, reason: validated };
    cleanPhase2 = validated;
  }

  const cleanRisk = clamp(Math.round(risk), RAID_RISK_RANGE[0], RAID_RISK_RANGE[1]) as RaidRisk;
  const cleanReward = clamp(Math.round(rewardFish), RAID_REWARD_RANGE[0], RAID_REWARD_RANGE[1]);
  const adjustments: ContractAdjustment[] = [];
  if (cleanRisk !== risk) adjustments.push({ id, field: "risk", from: risk, to: cleanRisk });
  if (cleanReward !== rewardFish) adjustments.push({ id, field: "reward", from: rewardFish, to: cleanReward });

  const contract: RaidContract = {
    id,
    name: cleanName,
    rule: cleanRule,
    counter: cleanCounter,
    risk: cleanRisk,
    rewardFish: cleanReward,
    patterns: cleanPatterns,
    proofCode,
    ...(cleanPhase2 === undefined ? {} : { phase2Patterns: cleanPhase2 }),
  };
  return { ok: true, contract, adjustments };
}

/** 입력 순서를 보존하며 중복 ID의 두 번째 이후 항목을 거절한다. */
export function validateRaidContracts(raw: unknown): ContractValidationResult {
  const result: ContractValidationResult = { accepted: [], rejected: [] };
  if (!Array.isArray(raw)) {
    result.rejected.push({ raw, reason: "최상위 값이 배열이 아님" });
    return result;
  }

  const seen = new Set<string>();
  for (const candidate of raw) {
    const validation = validateRaidContract(candidate);
    if (!validation.ok) {
      result.rejected.push({ raw: candidate, reason: validation.reason });
      continue;
    }
    if (seen.has(validation.contract.id)) {
      result.rejected.push({ raw: candidate, reason: `id 중복: ${validation.contract.id}` });
      continue;
    }
    seen.add(validation.contract.id);
    result.accepted.push(validation.contract);
  }
  return result;
}

const SAFE_FALLBACKS: readonly RaidContract[] = [
  {
    id: "safe_paws",
    name: "고요한 밤",
    rule: "보스가 원형 예고를 차례로 펼칩니다.",
    counter: "예고 원 밖으로 이동하세요.",
    risk: 1,
    rewardFish: 2,
    patterns: ["circle", "line", "gather"],
    proofCode: "SAFE-01",
  },
  {
    id: "safe_steps",
    name: "안전한 걸음",
    rule: "보스가 직선과 부채꼴 예고를 번갈아 펼칩니다.",
    counter: "예고가 없는 옆 공간으로 이동하세요.",
    risk: 1,
    rewardFish: 2,
    patterns: ["line", "cone", "circle"],
    proofCode: "SAFE-02",
  },
  {
    id: "safe_gather",
    name: "달빛 집결",
    rule: "보스가 집결 뒤 원형 예고를 펼칩니다.",
    counter: "먼저 모인 뒤 원 밖으로 빠져나가세요.",
    risk: 1,
    rewardFish: 2,
    patterns: ["gather", "circle", "line"],
    proofCode: "SAFE-03",
  },
];

function freezeContract(contract: RaidContract): RaidContract {
  return Object.freeze({
    ...contract,
    patterns: Object.freeze([...contract.patterns]),
    ...(contract.phase2Patterns === undefined
      ? {}
      : { phase2Patterns: Object.freeze([...contract.phase2Patterns]) }),
  });
}

/** 출고 계약은 정확히 6개가 모두 유효할 때만 원자적으로 채택한다. */
export function resolveRaidContractPool(raw: unknown): readonly RaidContract[] {
  const validation = validateRaidContracts(raw);
  const source = validation.accepted.length === 6 && validation.rejected.length === 0
    ? validation.accepted
    : SAFE_FALLBACKS;
  return Object.freeze(source.map(freezeContract));
}

export interface RaidContractPoolStatus {
  readonly valid: boolean;
  readonly usingFallback: boolean;
  readonly accepted: number;
  readonly expected: 6;
  readonly rejected: readonly string[];
}

/** 폴백은 안전하게 유지하되 원본 출고 풀이 왜 거절됐는지 숨기지 않는다. */
export function raidContractPoolStatus(raw: unknown): RaidContractPoolStatus {
  const validation = validateRaidContracts(raw);
  const valid = validation.accepted.length === 6 && validation.rejected.length === 0;
  return Object.freeze({
    valid,
    usingFallback: !valid,
    accepted: validation.accepted.length,
    expected: 6,
    rejected: Object.freeze(validation.rejected.map(({ reason }) => reason)),
  });
}

/** 출고 JSON조차 신뢰하지 않고 같은 검증기를 거친 뒤 공개하는 런타임 풀. */
export const RAID_CONTRACT_POOL_STATUS = raidContractPoolStatus(shippedContracts);
export const RAID_CONTRACT_POOL: readonly RaidContract[] = resolveRaidContractPool(shippedContracts);

export function raidContractPool(): readonly RaidContract[] {
  return RAID_CONTRACT_POOL;
}
