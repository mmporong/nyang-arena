# CLAUDE.md

Claude Code용 프로젝트 지침. **규칙 본문은 `AGENTS.md`에 있고, 이 파일은 그것을
그대로 따른다.** 두 파일을 나눠 둔 이유는 Codex와 Claude Code가 각자 읽는 파일이
달라서이고, 내용이 갈라지면 안 된다.

작업 전에 `AGENTS.md`를 읽을 것. 특히:

- 런타임 네트워크 호출 금지 (배포 게임은 외부 요청 0건)
- LLM 출력은 `src/validate/synergy-schema.ts`를 반드시 통과
- 밸런스 수정 후 `npm run sim` 필수
- 런타임 의존성 0개 유지
- 커밋 squash 금지

## 이 저장소에만 해당하는 것

- 스프라이트 원본은 저장소 밖에 있다: `~/PKM/06_Ideas/assets/CatCharacterSheet.png`.
  `npm run slice`는 그 경로를 읽으므로, 다른 기기에서는 시트를 먼저 옮겨야 한다.
  `public/sprites/`의 결과물은 커밋되어 있으므로 보통은 다시 돌릴 필요가 없다.
- `scripts/synergy-candidates.json`은 출고용 후보(전부 정상),
  `scripts/synergy-adversarial.json`은 검증기 테스트용 불량 입력이다. **둘을 섞지 말 것.**
  섞으면 새니타이즈된 깨진 이름이 실제 게임에 노출된다(실제로 한 번 그랬다).
- `npm run gen:synergies`는 `OPENAI_API_KEY`가 있으면 API를, 없으면 세션에서
  만든 후보 파일을 쓴다. 어느 쪽이든 검증기는 동일하게 적용된다.

## 커밋

Conventional Commits, description은 한글, 마침표 없음.
