import { makeRng, mixSeed } from "./rng.ts";
import {
  RAID_CONTRACT_POOL,
  type RaidContract,
  type RaidRisk,
} from "../validate/raid-contract-schema.ts";

const SHARE_PREFIX = "NA1";

/**
 * 계약 제안은 전투의 전역 난수 스트림을 먹지 않는다.
 *
 * 같은 시드의 두 정책을 비교할 때 한쪽이 계약 카드를 오래 보거나 다른 계약을
 * 고른 것만으로 이후 상점·전투 난수가 갈리면 짝비교가 깨진다. 런 시드와 대상
 * 보스 인덱스만 섞은 독립 스트림으로 세 장을 고른다.
 */
export function raidContractOffers(
  seed: number,
  targetBossIndex: number,
  count = 3,
): readonly RaidContract[] {
  const rng = makeRng(mixSeed(seed, 0x52414944 ^ targetBossIndex));
  const pool = [...RAID_CONTRACT_POOL];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = pool[i]!;
    pool[i] = pool[j]!;
    pool[j] = a;
  }
  return Object.freeze(pool.slice(0, Math.max(1, Math.min(count, pool.length))));
}

export function raidContractById(id: string): RaidContract | null {
  return RAID_CONTRACT_POOL.find((contract) => contract.id === id) ?? null;
}

export function raidRiskLabel(risk: RaidRisk): "낮음" | "중간" | "높음" {
  return risk === 1 ? "낮음" : risk === 2 ? "중간" : "높음";
}

export type RaidPrepRoute = "battle" | "elite" | "shop";

/**
 * 계약 위험도를 계약 직후 준비 경로로 번역한다.
 *
 * 낮음은 평범한 전투로 생선을 모으고, 중간은 정예를 감수해 보장 유물을
 * 노리며, 높음은 전투를 피하고 예고 대응 횟수를 확보한다. 카드의 위험 한 칸이 지도
 * 선택으로 이어지는 단일 규칙이라 3분 데모에서도 설명할 수 있다.
 */
export function raidPrepRoute(contract: Pick<RaidContract, "risk">): RaidPrepRoute {
  return contract.risk === 1 ? "battle" : contract.risk === 2 ? "elite" : "shop";
}

export function raidPrepLabel(route: RaidPrepRoute): string {
  return route === "elite" ? "유물 정예전" : route === "battle" ? "일반 전투" : "정찰 보급";
}

/** 주소에 넣어도 안전한, 서버 없는 첫 계약 공유 코드. */
export function raidShareCode(seed: number, contractId: string): string {
  return `${SHARE_PREFIX}-${(seed >>> 0).toString(36).toUpperCase()}-${contractId}`;
}

export interface ParsedRaidShare {
  seed: number;
  contractId: string;
}

/** 첫 화면의 세 계약을 결정적으로 보여 주는 데모/재현 시드. */
export function parseRaidSeed(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const normalized = raw.trim();
  if (!/^\d{1,10}$/.test(normalized)) return null;
  const seed = Number(normalized);
  return Number.isSafeInteger(seed) && seed >= 0 && seed <= 0xffffffff ? seed >>> 0 : null;
}

/**
 * `NA1-<32bit seed base36>-<contract id>`만 받는다.
 *
 * 계약 id는 출고 풀에서 다시 찾는다. 형식만 맞는 임의 문자열을 상태에 넣지 않는다.
 */
export function parseRaidShareCode(raw: string | null | undefined): ParsedRaidShare | null {
  if (!raw) return null;
  const match = /^NA1-([0-9A-Z]{1,7})-([a-z][a-z0-9_]{2,23})$/i.exec(raw.trim());
  if (!match) return null;
  const seed = Number.parseInt(match[1]!, 36);
  const contractId = match[2]!.toLowerCase();
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) return null;
  if (!raidContractById(contractId)) return null;
  return { seed: seed >>> 0, contractId };
}
