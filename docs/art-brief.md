# 냥 아레나 — 아트·연출 브리프 (Codex 핸드오프)

> 이 문서 하나만 읽고 수행 가능하게 쓴다. Codex에게 맡기는 것: **(1) 게임 비주얼 분석
> 리포트, (2) 상황이 맞는 연출 명세, (3) 구현(PR)**. 범위는 인게임 VFX·연출 + 인게임 아트
> 에셋, 산출은 명세 + 실제 코드까지.
>
> 실행 한 줄: 로컬 `~/nyang-arena`에서 *"docs/art-brief.md를 읽고 그대로 수행하라"*.

---

## 1. 게임 정체성·톤

- **한밤의 고양이 다방 결투장.** 픽셀 고양이 오토배틀러. 아늑하지만 긴장이 흐른다.
- 팔레트 원칙(`src/game/theme.ts`의 `T`): 온기 일색(종이 `#EFE0C6`·바닥 `#241A14`·테라코타
  계열)에서 **신호 3색만 채도를 독점**한다 — 위험 `#FF3F6E`(사선 해칭), 집합 `#2BE3B4`(동심원),
  취약 `#FFE24A`(채운 고리). 진영·직업·화폐는 전부 저채도로 물러난다. 판 밖 액션 버튼만 고채도
  주황 `#F5A03C`. **색맹 대응으로 세 신호는 형태로도 구분**된다.
- 연출을 더할 때 이 규율을 깨지 말 것: **판 위에서 새 고채도 색을 신호 3색 말고 쓰지 않는다.**

## 2. 현재 비주얼 파이프라인 (있는 것 — 처음부터 그리는 게 아니다)

- **스프라이트 186장**: `public/sprites/NN_pose.png`, 31품종 × 6포즈(idle/sleep/wink/move/back/run).
  우리 8종 + 악몽 8종 + 보스/저격대. 로더는 `src/game/sprites.ts`(`spriteFor(breedId, pose)`).
- **아이콘 논리 17종**: `icons.ts`의 Canvas 2D 패스 17종 · 이미지 요청 0건.
- **BGM**: `public/bgm/`(title/prepare/boss/outro, mp3+ogg). 오디오는 `src/game/audio.ts`.
- **아트 소스 파이프라인**:
  - 원본 시트 `CatCharacterSheet.png`(20마리, **레포 밖** — `PKM/06_Ideas/assets/`, 환경변수
    `NYANG_SHEET`로 경로 지정). 용량 때문에 커밋하지 않는다.
  - `npm run slice`(`scripts/slice-sprites.py`) — 시트를 6열×20행 격자로 슬라이싱, 197×197 균일 셀.
  - `npm run recolor`(`scripts/recolor-sprites.py`) — 시트에 20마리뿐이라 **밝기 순서만 남기고
    색상·채도를 덮어써** 21~31품종을 만든다(런타임 hue-rotate가 아니라 미리 굽는다).
  - 산출물은 `public/sprites/`에 커밋된다(원본과 같은 취급).
- **렌더**: `src/game/render.ts`가 `spriteFor()`로 그리고, **로드 실패 시 `src/game/icons.ts`의
  폴백 도형**을 그린다. 배경은 `src/game/backdrop.ts`. 텍스트·토큰은 `theme.ts`.
- **VFX·연출은 코드다**(스프라이트가 아니다): 예고(`drawTelegraphs` — 위험/집합/취약),
  타격·데미지·화면 연출 등은 전부 Canvas 2D에 그린다. `TELEGRAPH_FUSE_MS = 1200`(`bosses.ts`).

## 3. 하드 제약 (어기면 리뷰·verify에서 막힌다)

1. **런타임 의존성 0 · 런타임 네트워크 0.** 파티클/트윈/애니메이션 라이브러리 추가 금지 —
   연출은 전부 Canvas 2D 손코딩. (레포 `AGENTS.md` 원본 규칙)
2. **밸런스·전투 로직 불가침.** `scripts/measure-all.sh`의 관문 6축
   (`sim` · `decisions` · `placement` · `intervention` · `map` · `relics`)과 `metrics`는
   **헤드리스 시뮬레이션 수치**다. 시각 작업은 아래 파일 안에서만 한다:
   - 만져도 되는(시각) 파일: `render.ts` · `theme.ts` · `icons.ts` · `backdrop.ts` ·
     `sprites.ts` · `audio.ts` · `layout.ts`(레이아웃) · `public/**`
   - **로직 파일 금지**: `balance.ts` · `battle.ts` · `run.ts` · `map.ts` · `skills.ts` ·
     `relics.ts` · `breeds.ts` · `bosses.ts` · `stages.ts`의 **수치·규칙**.
   - 검증: 시각 변경 후 `npm run verify`의 6축·metrics 수치가 **이전과 바이트 동일**해야 한다.
     달라지면 시각 변경이 로직으로 샌 것 = 버그. (perf-roadmap이 렌더 최적화 때 쓴 것과 같은 규율)
3. **지도 축은 이미 미달**(격차 1.1 < 기준 1.5, 설계 판단 진행 중 — `map-depth-2026-08-23.md`).
   그래서 `verify`가 지도 때문에 exit 1인 것은 **정상**이다. 다른 축에서 **새 미달을 만들지 말 것.**
4. **성능 예산.** 렌더는 이미 최적화돼 있다(격자 캐시·숨김 탭 정지·그라디언트 메모 — `perf-roadmap`).
   새 연출도: rAF 예산 안에서, `prefers-reduced-motion` 존중, **숨김 탭(`document.hidden`)에서 정지**.
5. **한글 주석 · 파일별 스테이징(`git add .`/`-A` 금지) · 한글 Conventional Commit**
   (`type(scope): 설명`, 끝에 마침표 없음). 커밋 co-author: `Co-Authored-By: Claude Fable 5 …`는
   Codex가 아니라 사람/도구 규칙이니 Codex는 자기 규칙대로.

## 4. "상황이 맞는" 연출 — 측정이 준 우선순위

먼저 읽을 근거 문서(레포에 다 있다):
`docs/research-2026-08-23.md`, `docs/readability-study.md`, `docs/difficulty-qa-2026-08-23.md`,
`docs/map-depth-2026-08-23.md`, `docs/code-analysis-2026-08-23.md`, `docs/perf-roadmap-2026-08-23.md`.

측정·리서치가 지목한 연출 우선순위:

1. **예고 가독성 최우선**(`readability-study`). 위험/집합/취약 예고는 **0.5초 안에 탭이냐 꾹이냐**를
   가르는 게임의 심장이다. 예고 연출을 가장 또렷하게 — 형태(해칭/동심원/고리) + 신호색 + 타이밍
   (`TELEGRAPH_FUSE_MS`)이 서로를 보강하게. 여기가 연출 투자 1순위.
2. **"보스는 벽이 아니라 사건"**(`balance.ts` 원칙, `difficulty-qa` 확인). 보스는 어렵게 만드는
   대상이 아니라 **사건으로 연출**하는 대상 — 등장 배너·잠깐의 정지·카메라 강조. 난이도를 올리는
   연출(화면을 가려 예고를 못 보게 하는 등)은 금지.
3. **정예 = 저격대(위협감)**. 정예 등장·정예 노드에 위협의 결. 단 **지도 깊이는 5실험으로 기각**됐으니
   지도 노드 연출에 과투자하지 말 것(가벼운 예고면 충분).
4. **승/패 리듬**. 재진입 고리(같은 시드·오늘의 시드·도전 +1)를 살리는 게임오버·승리 연출.

## 5. 두 트랙 — 능력 경계를 정직하게

### 트랙 A — 인게임 VFX·연출 (코드) · **Codex 강함, 완전 구현 가능**
타격 플래시 · 데미지 팝업 · 히트스톱(짧은 정지) · 화면 흔들림 · 예고 강조 · 보스 등장 스테이징 ·
승/패 연출 · 상점·보상 피드백. **전부 Canvas 2D 코드.** → 명세 + 실제 PR까지 수행.

### 트랙 B — 인게임 아트 에셋 · **Codex 부분 (경계를 지킬 것)**
- Codex가 **할 수 있는 것**: `slice`/`recolor` 파이프라인 정리·확장, 기존 프레임 조합으로 만드는
  연출(포즈 전환·잔상), **새 포즈/이펙트 시트의 명세**(무엇을·규격 197×197·앵커·색), 폴백 도형
  (`icons.ts`) 개선.
- Codex가 **못 하는 것**: 새 포즈(공격·피격·기절·시전)나 보스 원화 같은 **새 픽셀아트 프레임을
  직접 그리는 일**. 이건 소스 시트(레포 밖) 확장이나 이미지 생성 모델·아티스트가 필요하다. Codex는
  이런 것을 "필요 에셋 목록"(무엇을 몇 장, 규격, 왜)으로 정리해 사람에게 넘긴다 — 억지로 저품질
  프레임을 만들지 말 것.

## 6. 산출물 (3부)

1. **비주얼 분석 리포트** — `docs/shots/*.png`(01~08 화면 캡처)와 코드 기준으로 현재 화면을 진단하고
   개선 지점을 우선순위와 함께. → `docs/art-analysis.md`.
2. **상황별 연출 명세** — 이벤트별(타격·보스 등장·예고·승/패·상점…) *무엇을 / 어느 팔레트 토큰 /
   타이밍(ms) / 형태 / 성능 주의*. → `docs/art-direction.md`.
3. **구현 PR** — 트랙 A 코드. 파일별 커밋, 커밋마다 `npm run verify`의 6축·metrics **불변 증거** 첨부.

## 7. 검증·완료 조건

- `npm run verify` 통과 — **6축(sim·decisions·placement·intervention·relics + map)·metrics 수치가
  변경 전과 바이트 동일**(= 로직 불변 증명). 지도 미달은 기존과 동일한 상태여야 한다.
- `npm run build`(= `tsc --noEmit && vite build`) 성공.
- 숨김 탭에서 애니메이션 정지 확인 · `prefers-reduced-motion` 확인.
- 바뀐 화면은 `docs/shots/` 갱신 또는 새 캡처 첨부.

## 8. Codex 실행 메모

- 로컬 `~/nyang-arena`에서 실행. 레포는 최신(main)이 GitHub에 푸시돼 있다.
- 소스 시트가 필요하면: `NYANG_SHEET=<CatCharacterSheet.png 경로> npm run slice` 후 `npm run recolor`.
- 시작 지시 예: **"docs/art-brief.md를 읽어라. 트랙 A(인게임 VFX·연출)의 분석·명세·구현을
  먼저 끝내고, 트랙 B(아트 에셋)는 파이프라인 정리 + 필요 에셋 목록까지만. 하드 제약 §3을 반드시
  지키고, 각 커밋에서 verify 6축·metrics 불변을 증거로 남겨라."**
