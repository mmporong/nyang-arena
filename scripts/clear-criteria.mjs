/**
 * clear 기준은 출력용 비율이 아니라 원시 성공 건수로 판정한다. 60%/20%처럼
 * 정확히 경계인 값도 부동소수점으로 나누고 빼면 3배·40%p보다 작아질 수 있다.
 */
export function evaluateClearCriteria(mindless, skilled) {
  if (mindless.runs !== skilled.runs || mindless.runs <= 0) {
    throw new Error(`clear 표본 수 불일치: 무의식 ${mindless.runs}, 조건 충족 ${skilled.runs}`);
  }
  const runs = mindless.runs;
  const mindlessS2 = mindless.counts[1];
  const mindlessS3 = mindless.counts[2];
  const skilledS1 = skilled.counts[0];
  const skilledS2 = skilled.counts[1];
  const skilledS3 = skilled.counts[2];
  const ratio = mindlessS3 > 0 ? skilledS3 / mindlessS3 : Infinity;

  return [
    ["완주 게이트 조건÷무의식 ≥ 3배", mindlessS3 > 0 ? skilledS3 >= mindlessS3 * 3 : skilledS3 * 5 >= runs, ratio],
    ["무의식 완주 S3 ≤ 20%", mindlessS3 * 5 <= runs, mindlessS3 / runs],
    ["깊이 확대 격차 S2 ≥ 40%p", (skilledS2 - mindlessS2) * 5 >= runs * 2, (skilledS2 - mindlessS2) / runs],
    ["깊이 확대 격차 S3 ≥ 40%p", (skilledS3 - mindlessS3) * 5 >= runs * 2, (skilledS3 - mindlessS3) / runs],
    ["조건 충족 S1 ≥ 85%", skilledS1 * 20 >= runs * 17, skilledS1 / runs],
  ];
}
