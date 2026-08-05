/**
 * 밸런스 튜너블을 한곳에 모은다.
 *
 * 값이 코드 여기저기 흩어져 있으면 스윕으로 최적점을 찾을 수 없다.
 * scripts/balance-sim.mjs가 이 객체를 덮어쓰고 도달 웨이브 분포를 측정한다.
 */
export const BALANCE = {
  /** 시작 생선 */
  startGold: 8,
  /** 웨이브 클리어 보상 = goldBase + wave * goldPerWave */
  goldBase: 5,
  goldPerWave: 1.5,

  /**
   * 적 스탯 배수 = enemyScale^(wave-1).
   * 스윕으로 잡았다. 같은 중앙값(13)을 내는 조합이 여럿이었는데, 분포 하한이
   * 높은 쪽을 골랐다 — 하한이 낮으면 짧은 런이 잦아 좌절이 늘어난다.
   */
  enemyScale: 1.24,
  /**
   * 적 수 = ceil(wave / enemyCountDivisor), 보유 한도가 상한.
   * 1.4에서 올렸다 — 초반 사망이 19.5%로 너무 높았다.
   */
  enemyCountDivisor: 1.45,

  /** 개별 고양이 레벨당 배수 */
  levelScale: 1.4,
  /**
   * 강화 비용 = upgradeCostBase * upgradeCostGrowth^(level-1)
   *
   * 비용이 선형이면 효과(지수)를 절대 따라잡지 못해 후반에 무한히 강해진다.
   * 실제로 선형 비용 버전은 시뮬 12%가 60웨이브 상한에 걸려 런이 끝나지 않았다.
   */
  upgradeCostBase: 4,
  upgradeCostGrowth: 1.45,

  /**
   * 웨이브를 넘길 때마다 살아남은 전원이 얻는 영구 배수.
   * 이게 없으면 적은 전체가 복리로 크는데 플레이어는 웨이브당 한 마리만
   * 강화하게 되어(9마리 중 1마리 ×1.4 ≈ 팀 전력 +4%) 구조적으로 따라잡힌다.
   */
  veterancy: 1.14,

  /** 시작 고양이 수 */
  starterCount: 3,

  /**
   * 보유 한도 = min(unitCapMax, unitCapBase + floor(wave / unitCapEvery)).
   *
   * 보드가 5x5(25칸)가 되면서 칸 수로는 아무것도 제한되지 않는다. TFT가 레벨로
   * 배치 수를 묶는 것과 같은 이유로 한도를 따로 둔다. 5x5는 칸이 늘어난 게
   * 아니라 **배치 자유도**다.
   */
  unitCapBase: 4,
  unitCapEvery: 2,
  unitCapMax: 10,
};

export type Balance = typeof BALANCE;
