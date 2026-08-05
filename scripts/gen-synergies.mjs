/**
 * 시너지 규칙을 빌드타임에 생성해 src/data/synergies.json으로 굽는다.
 *
 * 두 가지 입력 모드를 지원하고, 어느 쪽이든 검증기는 동일하게 적용한다:
 *
 *   1) API 모드  — OPENAI_API_KEY가 있으면 모델을 직접 호출한다.
 *   2) 세션 모드 — 키가 없으면 scripts/synergy-candidates.json을 읽는다.
 *                  이 파일은 Claude Code 세션에서 아래 PROMPT로 생성한 원본 출력이다.
 *
 * 어느 모드든 결과물은 커밋되고, 런타임은 이 JSON만 읽는다.
 * 즉 배포된 게임은 외부 네트워크 호출을 하지 않는다 (AC-11).
 *
 * 실행: npm run gen:synergies
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validateAll, EFFECT_RANGE, TRIGGERS, EFFECT_KEYS } from "../src/validate/synergy-schema.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const CANDIDATES = resolve(HERE, "synergy-candidates.json");
const OUT = resolve(ROOT, "src/data/synergies.json");

/** 모델에 주는 지시. AI 활용 기술문서에 그대로 인용된다. */
export const PROMPT = `너는 픽셀 고양이 오토배틀러의 시너지 규칙 디자이너다.
아래 스키마를 정확히 지키는 JSON 배열만 출력해라. 설명 문장은 쓰지 마라.

허용 trigger (이것 외에는 절대 쓰지 마라):
${TRIGGERS.map((t) => `  - ${t}`).join("\n")}

허용 effect.key와 값 범위 (범위를 벗어나면 잘린다):
${EFFECT_KEYS.map((k) => `  - ${k}: ${EFFECT_RANGE[k][0]} ~ ${EFFECT_RANGE[k][1]}`).join("\n")}

각 항목 형식:
{ "id": "소문자_스네이크", "name": "16자 이내 한글 이름",
  "desc": "48자 이내 한 줄 설명", "trigger": "...",
  "effect": { "key": "...", "value": 숫자 } }

규칙:
- trigger마다 최소 3개씩, 총 24개를 만들어라.
- id는 영문 소문자로 시작하고 중복되면 안 된다.
- 이름과 설명은 고양이답고 짧게. 수치를 설명에 쓰지 마라.`;

async function fromApi(key) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.9,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: PROMPT },
        { role: "user", content: '{"rules": [...]} 형태로 감싸서 출력해라.' },
      ],
    }),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  const body = await res.json();
  const text = body?.choices?.[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(text);
  return Array.isArray(parsed) ? parsed : (parsed.rules ?? []);
}

function fromSession() {
  return JSON.parse(readFileSync(CANDIDATES, "utf8"));
}

async function main() {
  const key = process.env.OPENAI_API_KEY;
  let raw;
  let mode;

  if (key) {
    mode = "API";
    raw = await fromApi(key);
  } else {
    mode = "세션";
    raw = fromSession();
  }

  const { accepted, rejected } = validateAll(raw);

  const total = Array.isArray(raw) ? raw.length : 0;
  const rate = total > 0 ? ((rejected.length / total) * 100).toFixed(1) : "0.0";

  console.log(`입력 모드: ${mode}`);
  console.log(`후보 ${total}개 → 통과 ${accepted.length}개, 폐기 ${rejected.length}개 (폐기율 ${rate}%)`);
  for (const r of rejected) {
    const id = typeof r.raw === "object" && r.raw !== null ? (r.raw.id ?? "(id 없음)") : String(r.raw).slice(0, 20);
    console.log(`  폐기: ${id} — ${r.reason}`);
  }

  const byTrigger = {};
  for (const r of accepted) byTrigger[r.trigger] = (byTrigger[r.trigger] ?? 0) + 1;
  console.log("트리거별 통과 수:", byTrigger);

  writeFileSync(OUT, `${JSON.stringify(accepted, null, 2)}\n`, "utf8");
  console.log(`기록: ${OUT}`);
}

main().catch((e) => {
  console.error("생성 실패:", e.message);
  process.exit(1);
});
