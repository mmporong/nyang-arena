#!/usr/bin/env bash
# 결정 축을 **전부** 재고 나서 판정한다.
#
# 예전에는 package.json의 `verify`가 `&&` 사슬이었다. 그러면 기준 미달인 축이
# 하나만 나와도 거기서 끊겨 뒤의 축과 `metrics` 재생성이 아예 안 돌았다 —
# 실제로 유물 축이 빨개진 뒤로 배치·개입·지도·metrics가 한 번도 실행되지
# 않았고, 그런데도 문서는 "verify가 축 5개를 잰다"고 적고 있었다. 관문이
# 재지도 않은 것을 근거로 쓰는 셈이었다.
#
# 측정은 전부 돌리고 실패를 모아 뒀다가 마지막에 한 번에 판정한다. 그래야
# "무엇이 왜 빨간지"가 한 번에 보이고, metrics도 매번 다시 생성된다.
set -uo pipefail

AXES=(sim decisions placement intervention gold map relics)
failed=()

for axis in "${AXES[@]}"; do
  echo
  echo "──────── $axis ────────"
  if ! npm run --silent "$axis"; then
    failed+=("$axis")
  fi
done

# 수치 파일은 축을 다 잰 뒤에 만든다. 앞에서 끊기면 낡은 채로 남는다.
echo
echo "──────── metrics ────────"
npm run --silent metrics || failed+=(metrics)

echo
if [ ${#failed[@]} -eq 0 ]; then
  echo "관문 통과 — 결정 축 ${#AXES[@]}개가 전부 기준 안"
  exit 0
fi
echo "관문 미달 ${#failed[@]}건: ${failed[*]}"
echo "  (측정은 전부 돌았다. 위의 각 축 판정 줄을 볼 것)"
exit 1
