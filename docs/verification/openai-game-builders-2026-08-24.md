# OpenAI Game Builder 제출 버전 검증 증거 — 2026-08-24

## 대상

- 기능 커밋: `06a775f8aa15bc604614026df98b1e7ae3b0d923`
- Git tree: `563b78cc7e0278fe9b09b9a0e3e7bf925c08898c`
- 런타임: Node `v24.12.0`
- 명령: `npm run verify`
- 결과: 종료 코드 `0`
- 출처 상태: `dirty:false`, `reproducible:true`, provenance `MATCH`

검증은 기능 커밋 직후 깨끗한 작업 트리에서 실행했다. 생성된 기준 파일은
`docs/generated/metrics-current.json`과 `docs/generated/metrics-current.md`다.

후속 릴리스에서 Windows PowerShell 5.1의 `Get-FileHash` 자동 로딩 충돌을 제거한
수동 QA 호환성 수정 `c28493e`를 추가했다. 깨끗한 해당 커밋에서 전체 verify를 다시
실행한 결과 분포·밸런스·번들 크기·아래 6축 로그 SHA는 기능 기준과 모두 같았고,
`dirty:false`, `reproducible:true`, provenance `MATCH`를 유지했다. 그 결과는 증거
커밋 `fe63458`에 기록했다.

## UI/UX 간격 개선 증거

- 기능 커밋: `f2538cdb6b8b893788e087db0d4edf4c556c542b`
- Git tree: `b20f96b125595f53b57c0b5d94591fe323a9829a`
- 명령: 깨끗한 기능 커밋에서 `npm run verify`
- 결과: 종료 코드 `0`, `dirty:false`, `reproducible:true`, provenance `MATCH`
- 반응형: 대표 16기기와 `320..900 × 275..900` 20px 간격 960경계에서 카드·footer·
  header·지도 라벨·44px 입력·행동 구역 겹침 0
- 독립 코드 리뷰: HIGH/MEDIUM/LOW finding 0, 자동 기하·타입 기준 승인

UI 변경 전 생성 기준과 새 JSON을 기계 비교했다. `generatedFrom`, UI 변경으로
의도적으로 달라지는 `build.bundleBytes`, 그리고 커밋·tree를 포함하는 증거 출처와
그 출처까지 해시하는 evidence SHA만 비교에서 제외했다. 나머지 게임 분포·세션·
웨이브·밸런스·계약·지도·유물 지표는 바이트 직렬화 기준으로 같았고, 아래 6축 원시
로그 SHA도 6/6 같았다. 번들은 `171,623 → 175,524 bytes`로 `3,901 bytes` 늘었으며
이는 새 UI 기하·라벨·접근성 렌더 코드의 의도된 출고 비용이다.

최종 GitHub Actions
[32688784697](https://github.com/mmporong/nyang-arena/actions/runs/32688784697)은
`fe63458f4c8be6d15e55484e60ce91b75d7f1d32`와 tree
`93e289c46efcd057c63c19e2ca95f63d3bafdf22`에서 전체 verify·증거 artifact·Pages
배포를 통과했다. 내려받은 artifact의 6개 원시 로그 SHA를 다시 계산한 값이
manifest와 metrics에 6/6 일치했다. 최종 배포 뒤 `npm run qa:manual -- --AutomatedOnly`도
통과했고, 로컬·공개 JavaScript 번들 SHA-256이 일치했다.

## 계약 선택·구매 반응 개선 증거

- 기능 커밋: `9e291e3b60910d1d3c1476e01d154a3ac4ec6723`
- Git tree: `c6d8ea9b17056aefe7a7cb85db217bed8f7c85bf`
- 명령: 깨끗한 기능 커밋에서 `npm run verify`
- 결과: 종료 코드 `0`, `dirty:false`, `reproducible:true`, provenance `MATCH`,
  6축 `allSixPassed:true`
- 변경 경계: `DESIGN.md`, 렌더·오디오와 그 검증 스크립트만 변경했다. 전투·밸런스·
  계약 규칙·상태 전이 파일과 런타임 패키지는 변경하지 않았다.
- 독립 코드 리뷰: 최초 제목·본문 겹침, compact 말줄임, reduced-motion 고리 팽창
  finding을 수정한 뒤 CRITICAL/HIGH/MEDIUM/LOW 0건. 독립 검증의 구현 자동 기준 PASS.

사용자 캡처와 같은 `1901×891`에서 카드 한 장은 `420×360`, 제목 `24px`, 본문
`16px`, 내부 밴드 최대 간격 `8px`, 내부 높이 사용률 `90.24%`다. 기존처럼 긴
문장 두 줄 뒤 200px가 넘는 빈 카드 면을 두지 않고 `번호·제목·위험 / 위험 트랙 /
보스 변화 / 내 대응 / 보상·선택`의 다섯 밴드로 채웠다. 큰 비활성 CTA는 없애고
카드 바로 아래에 입력 키 안내를 두었다. 대표 17기기와
`320..900 × 275..900` 20px 간격 960경계에서 제목·본문 실제 글리프 하단, 카드·
footer·guide·44px 입력 영역, 지도 라벨의 겹침이 0임을 프로브가 확인했다.

성공한 계약 선택은 지도 상태를 즉시 반영하면서 선택한 자리의 금색 outline·위험
도장·파편·보상 수치만 최대 360ms 남긴다. 이전 카드 면이나 미선택 카드를 다시
그리지 않아 지도 입력과 보이는 화면이 갈리지 않는다. 성공한 구매·강화는 카드에서
적용 위치로 이어지는 비행, 도착 고리·광선과 `생선 -N` 결과 문구를 남긴다. 실패
입력에는 성공음이 없다. Web Audio 확인음은 기존 master·음소거·자동재생 잠금·숨은
탭 규칙을 재사용하며, 테스트에서 잠금 전 context 0, hidden·muted 신규 노드 0,
재생 종료 뒤 oscillator·gain·bus 해제를 확인했다. `prefers-reduced-motion`에서는
이동·크기 변화·광선·파편을 빼고 고정 반경·고정 선 두께와 alpha 감쇠만 남긴다.

변경 전 `d9bbffa`의 metrics와 새 생성 JSON을 같은 함수로 정규화했다. 모든 깊이에서
`generatedFrom`, `bundleBytes`, `head`, `tree`, `dirty`, `node`, `reproducible`,
`provenanceMatches`, `allSixPassed`, `evidenceSha256` 키를 제외하고 객체·배열 순서를
유지한 compact JSON은 양쪽 모두 4,934 code units / 5,565 UTF-8 bytes이며 SHA-256
`7280fb34f742472e2e63f9faddccd78dca649b5e848eae1fc12006d592e3c2eb`로 바이트
동일하다. 아래 6축 원시 출력 SHA도 6/6 같다. JavaScript 번들은
`175,524 → 184,628 bytes`로 `9,104 bytes` 늘었고, 이는 카드 기하·선택/구매 VFX·
Web Audio 확인음의 의도된 출고 비용이다.

## 상호작용 피드백·입력 자동화 증거

- 기능 커밋: `cadad2fe318c0422957af33dc20e7fbd5c342975`
- Git tree: `54606de83756f6682968e475796ad5f626671289`
- 명령: 깨끗한 기능 커밋에서 `npm run verify`
- 결과: 종료 코드 `0`, `dirty:false`, `reproducible:true`, provenance `MATCH`,
  6축 `allSixPassed:true`
- 독립 코드 리뷰: 두 번째 포인터의 capture 해제가 첫 드래그를 취소하던 P1을
  회귀 테스트와 함께 수정한 뒤 P0/P1/P2 0건으로 승인

재추첨 성공은 새 카드 세 장에 최대 300ms 테두리 sweep와 `새 제안` 봉인을,
실패는 성공음 없는 정적 호박색 경계를 남긴다. 지도 선택과 같은 판·오늘·도전
재진입은 실제 상태를 즉시 적용하고 이전 화면 대신 선택 위치·이름만 최대 320ms
남긴다. 각 연출은 기대 국면을 벗어나면 즉시 폐기되며 `prefers-reduced-motion`에서는
이동·크기 변화 없이 정적 테두리와 alpha만 쓴다. 신규 Web Audio 큐는 기존 master,
자동재생 잠금, 음소거, 숨은 탭, 노드 cleanup 계약을 그대로 통과했다.

포인터·키보드·resize는 production과 Node 테스트가 같은 `dispatchGameInput`과
`executeGameInputAction`을 사용한다. 자동 회귀는 계약·지도·재추첨·다음 런의
포인터/키보드 동등성, 빈 카드 슬롯과 접힌 패널 틈의 입력 삼킴, 소유 포인터만
drop/cancel/lost-capture 가능, 회전 뒤 최신 레이아웃 hit-test, phase lock보다
음소거 우선, Space/G 반복 허용과 다른 반복키 차단을 실제 `run.ts` 전이로 확인했다.
인앱 브라우저 연결은 사용 가능한 인스턴스 0개라 픽셀 캡처 없이 자동 관문만
사용했으며 사람의 수동 확인을 완료 조건으로 두지 않았다.

변경 전후 metrics를 같은 제외 키로 정규화한 compact JSON은 양쪽 모두
4,934 code units / 5,565 UTF-8 bytes이고 SHA-256
`7280fb34f742472e2e63f9faddccd78dca649b5e848eae1fc12006d592e3c2eb`로 동일하다.
아래 6축 원시 출력 SHA도 6/6 같다. JavaScript 번들은
`184,628 → 191,361 bytes`로 `6,733 bytes` 늘었으며, 이는 공용 입력 dispatcher·
회귀 가능한 실행 포트·세 선택 피드백 VFX와 합성음의 의도된 출고 비용이다.
상태 불변식은 300런·518,665스텝 위반 0, 반응형 기하는 17기기와 960경계 PASS,
런타임 의존성과 외부 origin 요청은 계속 0이다.

## 결정 축 6개

| 축 | 시드 | 종료 | 원시 출력 SHA-256 |
|---|---|---:|---|
| sim | 1..300 | 0 | `2669a4111fec1bc77a97b35e3bf3ec8e6c3a5e9e8bd7b70a4f9fe6982be9b171` |
| decisions | 1..300 | 0 | `3b672c668687f9badc3b076b9d17f640215947f1c5735acce28aa32d40f6375a` |
| placement | 1..1200 | 0 | `96827b0f780b53b60c0fe2028c70e75220214ff18eb348e6a442e9d29a9ee235` |
| intervention | 1..300 | 0 | `b61761ac4cc996e4641576ccc3db4965227a7967602bed334090bedf745d8ab9` |
| map | 준비 1..300, 정책 1..1500 | 0 | `6345a6e7678898265ed0db4d7f7442aa7a7564ab6e2f151d5bb167eb555c6aae` |
| relics | 1..2000 | 0 | `858ecb62eb874f364c4dd19b94bd491bc6773790f7e669336714d0db9f4cfd24` |

manifest 여섯 행의 HEAD·tree·Node·dirty가 모두 대상과 같고, 저장 로그를 다시
해시한 값도 여섯 행 모두 일치했다.

## 신규 핵심 루프 증거

- 계약 검증: 출고 6개, 적대 입력 거절 6개, 범위 클램프 2개
- 계약 흐름: 첫 화면 3장, 공유 코드 왕복, 대상 보스 패턴·후반 패턴 교체,
  승리 보상 지급·패배 보상 0
- 계약 홀드아웃: 1800런, 계약-aware 중앙값 20 vs 보상-only 11,
  첫 두 보스 93.8% vs 78.1%, 출고 계약 평균 폭 1.22웨이브
- 준비 경로: 위험 3단계 × 300시드 접근·보상 전달 100%, 고위험 준비 시
  첫 보스 74.0% → 91.7%
- 지도: 1500런, 정책 효과 2.6웨이브, 읽는 정책 15.1 ≥ 무작위 13.6
- 유물: 2000시드, 최선 집중 빌드가 무유물보다 +4.3웨이브,
  상위 두 직업 격차 0.6, 동일 정책 유물 한계효과 평균 +0.72

## 회귀·출고 증거

- 상태 불변식: 300런, 518,665스텝, 위반 0
- 계약 UI: 대표 16기기 + 960경계 카드 3장·터치 영역·겹침·카피 예산 PASS
- 회피: 위험·집결·스윕 대응과 도적 도약을 포함한 전 항목 PASS
- 오디오·에셋 계약 PASS: Canvas 아이콘 17종, BGM 8개, 스프라이트 186장
- 프로덕션 빌드 PASS: `dist/index.html` 3.38KB,
  JavaScript 171.62KB(gzip 60.03KB)
- 런타임 패키지: `npm ls --omit=dev --depth=0` 결과 0개
- 런타임 OpenAI API와 외부 origin 요청은 추가하지 않았다

## 제약 해석

`docs/art-brief.md` §3의 전투 로직 불가침·기존 metrics 바이트 불변은 트랙 A
시각 변경을 격리하기 위한 계약이었다. 이후 사용자가 해커톤 적합성을 위해 게임의
방향과 근간 변경을 명시적으로 허용했으므로 악몽 계약·지도 준비·유물 드래프트는
의도적으로 새 기준을 만든다. 변경 전 수치와 같다고 주장하지 않고, 위 6축과 별도
홀드아웃을 새 기능 커밋에 결박해 회귀 기준으로 삼았다. 런타임 의존성 0,
외부 API 0, 접근성·권리·명시적 스테이징 제약은 계속 지켰다.

## 자동화 밖에 남은 항목

- 인앱 브라우저 연결이 없어 실제 포인터·키보드·모바일·스피커 수동 QA는 미확인
- 기존 썸네일은 형식 검증만 통과하고 새 계약 첫 화면을 보여 주지 않으며,
  새 핵심 루프를 담은 3분 이내 실플레이 영상 파일도 없음
- 공식 페이지 원문은 08/26 일정·제출 버튼·완료 상태 마크업을 함께 포함하므로,
  계정별 기존 제출 수정 가능 여부와 최종 영수증은 로그인 세션에서 확인 필요

자동화가 증명하지 못한 위 항목을 완료로 표기하지 않는다.
