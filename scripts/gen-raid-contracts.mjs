import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validateRaidContracts } from "../src/validate/raid-contract-schema.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const CANDIDATES = resolve(HERE, "raid-contract-candidates.json");
const ADVERSARIAL = resolve(HERE, "raid-contract-adversarial.json");
const OUTPUT = resolve(ROOT, "src/data/raid-contracts.json");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function candidateId(raw) {
  return typeof raw === "object" && raw !== null && "id" in raw ? String(raw.id) : "(id 없음)";
}

const candidates = validateRaidContracts(readJson(CANDIDATES));
if (candidates.rejected.length > 0 || candidates.accepted.length !== 6) {
  for (const rejection of candidates.rejected) {
    console.error(`후보 거절: ${candidateId(rejection.raw)} — ${rejection.reason}`);
  }
  throw new Error(`출고 후보는 정확히 6개여야 합니다 (현재 ${candidates.accepted.length}개)`);
}

const adversarial = validateRaidContracts(readJson(ADVERSARIAL));
console.log(`출고 후보 6개 → 채택 ${candidates.accepted.length}개, 거절 ${candidates.rejected.length}개`);
console.log(`적대 후보 → 채택 ${adversarial.accepted.length}개, 거절 ${adversarial.rejected.length}개`);
for (const rejection of adversarial.rejected) {
  console.log(`  거절: ${candidateId(rejection.raw)} — ${rejection.reason}`);
}
for (const accepted of adversarial.accepted) {
  const raw = readJson(ADVERSARIAL).find((candidate) => candidate.id === accepted.id);
  if (raw && raw.risk !== accepted.risk) console.log(`  클램프: ${accepted.id}.risk ${raw.risk} → ${accepted.risk}`);
  if (raw && raw.rewardFish !== accepted.rewardFish) {
    console.log(`  클램프: ${accepted.id}.rewardFish ${raw.rewardFish} → ${accepted.rewardFish}`);
  }
}

writeFileSync(OUTPUT, `${JSON.stringify(candidates.accepted, null, 2)}\n`, "utf8");
console.log(`출고: ${OUTPUT}`);
