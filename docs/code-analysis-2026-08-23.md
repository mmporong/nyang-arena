# 전체 코드 분석 · 리뷰 — 2026-08-23

> 읽기 전용 분석 기록(Claude Code, architect 에이전트, 커밋 105abb0 기준). 파일 수정 없이
> 모든 게이트를 직접 실행해 근거를 확보했다. 이 문서의 Top 10 중 저위험 항목(1~8)은 같은
> 날 후속 커밋으로 처리했고, 처리 여부는 §6에 적는다. 줄 번호는 분석 시점의 것이라
> 이후 커밋에서 어긋날 수 있다.

---

## 1. 아키텍처 지도

**의존 방향** (단방향 유지, 순환 없음)

```
types.ts (좌표·도메인 타입, 의존 0)
  ↓
balance · breeds · bosses · relics · map · rng · stages · theme   (데이터·규칙)
  ↓
run.ts        RunState 소유, 국면 전이의 유일한 자리
  ↓
battle.ts     고정 스텝 전투 → run.ts의 finishWave 호출
  ↓
render.ts     읽기 전용 그리기        main.ts  입력·프레임·텔레메트리
```

**RunState 수명주기** — `newRun` → `phase:"map"` → `chooseNode`가 `buildEnemyWave`+`rollOffers`를
부르고 `"reward"` → `leaveShop` → `"prepare"` → `startBattle` → `"battle"` → `stepBattle` →
`finishWave` → `"map"` 또는 `"gameover"`. 상점 칸만 `step`을 먹고 `wave`는 안 먹는다.

**결합 핫스팟**
- `RunState` 참조 수: render.ts 32 · run.ts 30 · battle.ts 27 · main.ts 5. 세 파일이 같은 가변
  객체를 공유하고 쓰기는 run/battle만 한다(render.ts는 실측 확인 — 게임 상태 대입 0건).
- **레이어 역전 1건**: `skills.ts`가 `SWARM_PACK`·`BULWARK_UNIT`·`LURE_UNIT`을 `run.ts`에서
  가져온다. 전투 데이터가 런 상태 모듈에 산다.
- `map.ts`·`stages.ts`의 `run.ts` 임포트는 type-only(`WaveKind`)라 무해.
- 하네스: `scripts/` 중 `main.ts`를 임포트하는 것은 0개, `render.ts`는 `layout-probe.mjs`(4개 함수)뿐.

---

## 2. 코드 품질 리뷰 (심각도별)

### HIGH

**H1 — 관문 7개 중 3개가 아무것도 막지 않는다.**
`measure-all.sh`의 `AXES=(sim decisions placement intervention gold map relics)` 중 `sim`·`decisions`·
`gold`는 `process.exit`/`exitCode`가 **0건**이다. 실측: `npm run sim`이 "판정: 궁합이 약하다"를 찍고도
exit 0. 그런데 `measure-all.sh`는 "관문 통과 — 결정 축 7개가 전부 기준 안"을 출력한다. AGENTS.md가
기록한 "관문 안에 있던 것만 살아 있었다"의 재발이고, AGENTS 규칙(`sim` 중앙값 10~15)에는 자동 강제가 없다.

**H2 — 구매 정책 사본이 다시 갈라져 있다.**
`decision-space.mjs`가 `bot-policy.mjs`의 `shopStep`을 손복사했는데 **무료 재추첨 분기가 빠졌다**.
`balance-sweep.mjs`도 같은 사본. `gold-curve.mjs`는 무료/유료 재추첨 **순서가 반대**다. AGENTS.md가
"`shopStep` 하나만 쓴다 / 사본은 늘 후하게 재는 쪽으로 틀린다"며 같은 결함 4건(map-space 1.4→0.7,
relic-space 4.3→3.9)을 적어 둔 바로 그 자리다.

**H3 — 가장 강한 검사가 체인 밖.**
`npm run invariants`는 300런·615,328스텝에서 34종 불변식을 전수 검사하고 실측 통과하는데, `verify`에도
CI에도 없다. CI(`.github/workflows/deploy.yml`)는 `test`·`probe`·`build`만 돈다.

**H4 — 보스 주기 상수가 복제돼 있다.**
`run.ts`의 `bossesSeen`이 `perStage = 2`와 `step > 5 / > 2`를 하드코딩한다. 같은 파일 `bossIndexAt`은
임포트한 `BOSSES_PER_STAGE`·`bossOrdinalInStage`를 쓰는데 바로 아래 함수만 사본이다. `map.ts`의
`BOSS_STEPS = new Set([2,5])`, `BOSSES_PER_STAGE = BOSS_STEPS.size`가 진짜 출처.

### MEDIUM

- **M1** `skills.ts` `runSkill`의 switch에 `default`/`assertNever` 없음 → `SkillId`를 늘리면 `SKILLS`
  Record는 컴파일 에러를 내지만 여기는 조용히 `empty()`로 떨어지고 평타로 영원히 대체된다.
- **M2** `run.ts` `RUNS_KEY`/`RunRecord`/`loadRuns`는 **쓰기 전용**이다. 소비처는 `validator-test.mjs`
  하나뿐이고 UI에 안 붙었다. 오늘 추가된 코드 중 유일하게 소비자가 없는 것.
- **M3** `run.ts` `v as RunRecord[]` — `loadCodex`는 원소 타입을 거르는데 이쪽은 통째 캐스트.
- **M4** `run.ts` `newRun`이 `setNotice`를 우회해 `state.notice`에 직접 대입. 선언 파일 자신이 계약을 어긴다
  (현재는 `noticeKind` 기본값이 같아 증상 없음).
- **M5 거대 함수**: `battle.ts makeTelegraph`(**309줄**, 패턴 8종 분기) · `stepBattle`(262) ·
  `render.ts drawCat`(279) · `drawFxVectors`(213) · `drawMap`(207) · `drawOffers`(199) · `drawGameOver`(183) ·
  `battle.ts fireTelegraph`(155) · `tickBoss`(143) · `castSkill`(134).
- **M6** `map.ts openLanes`는 `taken[step-1]`이 미설정(-1)이면 빈 배열이 아니라 **전 lane**을 돌려준다.
  순차 UI 흐름에서는 무해하나 미리보기 기능이 생기면 잠재 함정. `checkStage`는 런타임 호출 0건 —
  `validator-test.mjs`에서만 불린다.
- **M7** `battle.ts` `pop({ fx, fy } as Cat, ...)` — 2필드 객체를 `Cat`으로 캐스트.
- **M8** `battle.ts creepZones`·`sweepZones`는 `fxs`·`damagePops`·`shots`와 달리 원소 상한이 없다.
- **M9** `bosses.ts`의 4칸 `phase2Patterns`에 도달 불가능한 인덱스가 있다(`PHASE2_FROM_IDX`와의 조합).

### LOW

- `run.ts` `let statBoost = 1` — 재대입 없는 죽은 손잡이.
- `types.ts` — `Intervention` 앞 고아 JSDoc이 폐기된 "짧게 탭/꾹 누르기" 조작을 설명한다.
- `render.ts` `codexCacheFor`가 `RunState` 강참조를 물고 있어 죽은 판 하나가 통째로 살아남는다.
- `skills.ts` `SkillResult.shots`는 채워지고 소비처가 없다. 동명 `drawCrown` 두 개(시그니처 다름).
- `render.ts` `drawList` 매 프레임 재할당 + 정렬. `theme.ts`는 매 프레임 텍스트 재측정(메모이제이션 없음).
- 비-null 단언(`!`) 광범위 사용: battle.ts 5곳, map.ts 15곳, bosses.ts 2곳.

---

## 3. 검증 커버리지 지도

| 명령 | 실제 단언 | 실행 결과 |
|---|---|---|
| `npm test` | 적대 입력 폐기·클램프 / 유물 테이블 / 지도 DAG(시드200×스테이지4) / 보스 신원 / 명단 미러 12쌍 / 예고 기하 / 재진입 고리 / 인접 보너스 | 전부 통과 |
| `npm run probe` | 10기기 5구간, 세로줄 구성 카드-보드 0% 겹침, 죽은 화면 세 버튼 | 통과 |
| `npm run dodge:test` | `inTelegraph` 그대로 재사용, 26검사 | 통과 |
| `npm run invariants` | 300런 615,328스텝 34종 | 통과 (**체인 밖**) |
| `npm run typecheck` | `tsc --noEmit` | 통과 |
| `npm run sim` | 도달 웨이브 분포 · 궁합표 | 판정 출력만, **exit 0 고정** |

**자동 검사 0인 경로**: `main.ts` 전체(입력·프레임·텔레메트리·키보드), `render.ts` 드로잉 본체,
`audio.ts`·`sprites.ts`·`backdrop.ts`·`icons.ts`, 스킬 13종 개별 판정, `localStorage` 실패 경로.

---

## 4. 개선 항목 Top 10 (가치/노력 순)

| # | 항목 | 왜 | 어디 | 노력 | 위험 | 검증 |
|---|---|---|---|---|---|---|
| 1 | `sim`·`decisions`·`gold`에 exit 코드 부여 | 관문이 거짓 초록을 찍는다(H1) | `balance-sim.mjs`·`decision-space.mjs`·`gold-curve.mjs` 판정 줄 | S | 낮음 | 기준을 일부러 깨고 `measure-all.sh` exit 1 확인 |
| 2 | `invariants`를 `verify` 맨 뒤에 추가 | 가장 강한 검사가 무방비(H3) | `package.json` `verify` | S | 없음 | `npm run verify` |
| 3 | `decision-space`·`balance-sweep`의 구매 루프를 `shopStep`으로 교체 | 사본 갈라짐 재발(H2) | decision-space.mjs · balance-sweep.mjs | M | 중(축 값이 내려갈 것) | 교체 전후 축 값 비교 — **내려가면 맞은 것** |
| 4 | `bossesSeen`을 `bossOrdinalInStage`/`BOSSES_PER_STAGE`로 재작성 | 주기 상수 복제(H4) | run.ts | S | 낮음 | `npm test` 보스 신원 계약 + `invariants` |
| 5 | `loadRuns`/`RUNS_KEY`/`RunRecord` 삭제 | 소비자 0, 삭제 우선 원칙(M2) | run.ts | S | 낮음 | 테스트 단언 함께 제거 후 `npm test` |
| 6 | `runSkill` switch에 `assertNever` | 새 스킬이 조용히 무효화(M1) | skills.ts | S | 없음 | 가짜 `SkillId` 추가 시 `tsc` 실패 확인 |
| 7 | CI에 `dodge:test`·`invariants` 추가 | 배포 게이트가 검증기·프로브뿐 | deploy.yml | S | 없음 | CI 로그 |
| 8 | `state.notice` 직접 대입 → `setNotice` | 선언 파일이 자기 계약 위반(M4) | run.ts | S | 없음 | `grep '\.notice = ' src/` |
| 9 | `makeTelegraph`를 패턴→빌더 테이블로 분해 | 309줄 8분기(M5) | battle.ts | M | 중 | `dodge:test` + `invariants` + `sim` 분포 불변 |
| 10 | `drawCat`/`drawMap`/`drawOffers` 분할 | 렌더 3대 함수 685줄 | render.ts | L | 회귀 그물 없음 | 먼저 순수 기하 함수를 `probe`로 더 덮은 뒤 |

---

## 5. 건드리지 말 것 (의도된 계약)

- **`rng` 단일 전역 스트림 + `makeRng(mixSeed(seed, stage))` 분리** — 지도를 전역 스트림으로 되돌리면
  "1스테이지에서 몇 대 때렸나"가 2스테이지 지도를 바꾼다.
- **연출 난수는 `Math.random`** — 시드 스트림에 태우면 브라우저와 헤드리스의 난수 소비 횟수가 갈려
  재현성이 깨진다.
- **`prepare` 국면 존치** — UI는 그 화면을 안 그리지만 하네스 열여섯 개가 이 전이를 기준으로 잰다.
- **`battleSpeed`를 실시간 dt에만 곱한다** — 하네스는 `stepBattle(s, 100)`을 직접 부른다.
- **상점 칸이 `step`만 먹고 `wave`는 안 먹는 것.**
- **소환수가 `state.summons`에 따로 사는 것** — 보드에 넣으면 `livingCats` 24곳이 오염된다.
- **`WAVE_STRIDE=7` / `UNIT_STRIDE=11`** — 명단 길이와 서로소여야 하고 `npm test`가 단언한다.
- **`unitCapBase`(4) > `starterCount`(3).**
- **`best`/`modeBest` 분리와 `recordBroken`** — 도전 판이 전체 최고를 안 건드리는 것은 테스트가 지키는 계약.
- **`measure-all.sh`가 `&&` 대신 실패를 모아 마지막에 판정하는 것.**
- **`.ts` 확장자 임포트 · 런타임 의존성 0 · 네트워크 0.**

### 한 줄 요약
코드 자체의 결함보다 **검증 체계의 구멍이 더 크다** — 7개 축 중 3개가 exit 0 고정이고, 가장 강한
검사(invariants, 615k 스텝)는 체인 밖이며, AGENTS.md가 네 번 밟았다고 기록한 "구매 정책 사본" 결함이
`decision-space`·`balance-sweep`에 그대로 남아 있다. Top 10의 1~4번(전부 S~M, 저위험)이 이걸 닫는다.

## 6. 처리 기록

(후속 커밋에서 갱신)
