# 트랙 B 기존 포즈 재사용 검증

- `01-hit-pose-reuse.png`: 실제 브라우저 웨이브 1 전투에서 피격 플래시와 `wink`
  스프라이트가 동시에 렌더된 순간.

CDP 계측은 `CanvasRenderingContext2D.drawImage`의 이미지 URL과 현재 필터를 함께 읽었다.
관측값은 `sprites/01_wink.png`와 `brightness(2.4) saturate(0.6)`의 동시 호출 1회다.
따라서 카드의 평상시 눈깜빡임이 아니라 실제 피격 반응임을 구분한다.

이 구현은 새 `hit` 원화가 들어오기 전의 임시 조합이다. 전투가 이미 제공하는 160ms
`cat.flash`를 읽기만 하고 `Cat` 상태·전투 타이머·피해 판정은 바꾸지 않는다.
