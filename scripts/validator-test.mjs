/**
 * 검증기 적대 테스트 — 모델이 규칙을 어겼을 때 실제로 막히는지 증명한다.
 *
 * "LLM이 스키마를 지킬 것"이라고 믿으면 안 된다. scripts/synergy-adversarial.json은
 * 흔한 이탈 유형(없는 트리거, 없는 효과 키, 문자열 수치, 무한대, id 중복,
 * 태그 삽입, 범위 초과)을 모아둔 것이고, 이 테스트는 각각이 폐기되거나
 * 안전한 값으로 눌리는지 확인한다.
 *
 * 실행: npm test
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { EFFECT_RANGE, validateAll } from "../src/validate/synergy-schema.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(readFileSync(resolve(HERE, "synergy-adversarial.json"), "utf8"));

const { accepted, rejected } = validateAll(raw);

console.log(`적대 입력 ${raw.length}개 → 폐기 ${rejected.length}개, 통과 ${accepted.length}개\n`);
console.log("폐기된 항목:");
for (const r of rejected) {
  const id = typeof r.raw === "object" && r.raw !== null ? r.raw.id : String(r.raw).slice(0, 24);
  console.log(`  ${String(id).padEnd(14)} ${r.reason}`);
}
console.log("\n통과했지만 값이 눌린 항목:");
for (const a of accepted) {
  console.log(`  ${a.id.padEnd(14)} name="${a.name}" ${a.effect.key}=${a.effect.value}`);
}

const failures = [];

// 1) 통과분은 전부 허용 범위 안이어야 한다.
for (const a of accepted) {
  const [lo, hi] = EFFECT_RANGE[a.effect.key];
  if (a.effect.value < lo || a.effect.value > hi) {
    failures.push(`${a.id}: 값 ${a.effect.value}가 범위 [${lo}, ${hi}] 밖`);
  }
}

// 2) 통과분 이름에 꺾쇠가 남아 있으면 안 된다.
for (const a of accepted) {
  if (/[<>]/.test(a.name) || /[<>]/.test(a.desc)) failures.push(`${a.id}: 이름/설명에 꺾쇠 잔존`);
}

// 3) 명백히 불법인 항목은 반드시 폐기돼야 한다.
const mustReject = ["quad_color", "finisher", "9bad_id", "stringy", "no_effect", "nan_value"];
// 같은 id가 두 번 오면 두 번째만 폐기되고 첫 번째는 살아야 한다.
if (accepted.filter((a) => a.id === "dup_id").length !== 1) failures.push("dup_id: 정확히 1개만 통과했어야 함");
const acceptedIds = new Set(accepted.map((a) => a.id));
for (const id of mustReject) {
  if (acceptedIds.has(id)) failures.push(`${id}: 폐기됐어야 하는데 통과함`);
}

// 4) 범위 초과 항목은 폐기가 아니라 클램프여야 한다 (규칙을 잃지 않기 위해).
const clamped = accepted.find((a) => a.id === "overshoot");
if (!clamped) failures.push("overshoot: 클램프되어 통과했어야 함");
else if (clamped.effect.value !== EFFECT_RANGE.atk_mul[1]) {
  failures.push(`overshoot: 상한 ${EFFECT_RANGE.atk_mul[1]}로 눌렸어야 하는데 ${clamped.effect.value}`);
}

if (failures.length > 0) {
  console.log("\n실패:");
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log("\n전부 통과 — 검증기가 적대 입력을 모두 막거나 안전한 값으로 눌렀다.");
