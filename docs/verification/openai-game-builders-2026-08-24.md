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

최종 GitHub Actions
[32688784697](https://github.com/mmporong/nyang-arena/actions/runs/32688784697)은
`fe63458f4c8be6d15e55484e60ce91b75d7f1d32`와 tree
`93e289c46efcd057c63c19e2ca95f63d3bafdf22`에서 전체 verify·증거 artifact·Pages
배포를 통과했다. 내려받은 artifact의 6개 원시 로그 SHA를 다시 계산한 값이
manifest와 metrics에 6/6 일치했다. 최종 배포 뒤 `npm run qa:manual -- --AutomatedOnly`도
통과했고, 로컬·공개 JavaScript 번들 SHA-256이 일치했다.

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
- 계약 UI: 10기기 카드 3장·터치 영역·겹침·카피 예산 PASS
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
