import type { CatColor } from "./types.ts";
import type { WaveKind } from "./run.ts";
import type { Scene } from "./backdrop.ts";
import { STAGE_TINT } from "./theme.ts";

/**
 * 스테이지 테마 — 레이드 3부작(docs/raid-design.md)의 "구현 웨이브 1".
 *
 * 스테이지마다 다른 겉모습을 이 한 파일에 모은다. 실제로 값을 읽는 곳은
 * 셋이다 — 배경(`render.ts`의 `sceneForWave` → `backdrop.ts`), 보스 배너
 * 칭호(`render.ts`의 `drawBossBanner`), 잔몹 색조(`render.ts`의 `drawCat`,
 * 이 파일의 `tintForEnemy`가 `STAGE_TINT`와 이어 준다). **`map.ts`는
 * 의도적으로 안 읽는다** — 이유는 `waveOrder` 필드 주석에 남겨 둔다.
 *
 * 스테이지 4부터는 3부작이 되풀이된다(raid-design.md "(4+) 순환 재시작" —
 * 배율만 계속 오르고 겉모습은 스테이지 1로 돌아간다). 그래서 이 배열은
 * 정확히 셋만 담고, `stageTheme`가 나머지를 셋으로 접는다.
 */
export interface StageTheme {
  /** 이 레코드가 대표하는 스테이지 번호(1..3). 실제 게임의 스테이지 번호는 순환한다. */
  readonly stage: number;
  /** 배너·지도에 쓰는 짧은 이름. "N번째 밤 · 이름" 꼴로 기존 커튼 문구에 붙는다. */
  readonly name: string;
  /** 이름 아래 한 줄. 스테이지 전환 커튼의 부제로 쓴다. */
  readonly subtitle: string;
  /**
   * 배경이 쓸 색 축의 메모. 지금은 스테이지 1만 실제로 소비한다
   * (`backdropScene`이 그 결과물이다). 2·3은 코드 어디서도 안 읽는 값이라
   * 다음 웨이브가 씬을 그릴 때 참고할 팔레트 메모로만 남긴다.
   */
  readonly palette: { readonly base: string; readonly accent: string };
  /**
   * 악몽 잔몹에 덮어씌울 색조. 비어 있으면 `tintForEnemy`가 null을 돌려주고
   * 원래 스프라이트 색 그대로 나간다(스테이지 2·3은 아직 비어 있다).
   */
  readonly mobColors: readonly CatColor[];
  /**
   * 설계 문서 표의 웨이브 성격 순서 — 보스가 서는 두 걸음(2·5)을 뺀 나머지
   * 네 걸음(0·1·3·4) 몫이라 정확히 4칸이다.
   *
   * **참고용 메모일 뿐 `map.ts`는 이 값을 읽지 않는다.** `assignKinds`가
   * 먼저 한 걸음 안의 전투 칸들에 서로 다른 성격을 나눠 준 뒤에야
   * `battleWaves`가 그 성격을 채우고, 둘 다 스테이지 전용 난수 줄기
   * (`mixSeed(seed, stage)`)를 걸음 순서대로 이어 쓴다. 이 순서를 강제하려면
   * 걸음별로 셔플을 건너뛰거나 pool 구성 자체(예: rush를 더 자주)를 바꿔야
   * 하는데, 후자는 스테이지 1의 실제 체감 난도를 움직인다 — "rush 위주"로
   * 치우치면 이 스테이지의 잔몹 구성이 실제로 근접 쪽으로 기울고, 그건
   * `npm run sim` 중앙값이 10~15에 그대로 있어야 한다는 이번 웨이브의 관문과
   * 정면으로 부딪힌다. 게다가 `assignKinds`는 이미 "갈림길은 성격이 갈려야
   * 한다"는 계약으로 한 걸음 안에 mixed/rush/snipe를 섞어 주므로, 이 표가
   * 말하려는 "성격이 고루 나온다"는 취지 자체는 손대지 않아도 이미 산다.
   * 그래서 이번 웨이브는 이 값을 **읽지 않는 채로** 남긴다 — 정말 순서를
   * 강제하려면 `npm run sim`·`npm run map`으로 스테이지별 난도를 다시 재는
   * 것부터 시작해야 하고, 그건 "새 메커니즘 0"인 웨이브 1의 범위 밖이다.
   */
  readonly waveOrder: readonly Exclude<WaveKind, "boss">[];
  /**
   * 배경 씬 강제 오버라이드. null이면 기존 로직(보스 종류로 고르는
   * stone/alley/frost, 없으면 forest)을 그대로 쓴다 — 스테이지 2·3이 이번
   * 웨이브에는 이쪽이다.
   */
  readonly backdropScene: Scene | null;
  /**
   * 중간보스·우두머리 배너의 칭호 오버라이드. null이면 기존 문구
   * ("되풀이되는 것" 등)를 그대로 쓴다. 보스의 킷·수치는 안 건드리고
   * 문구(그리고 `tintForEnemy`를 통한 리스킨)만 갈아 끼운다.
   */
  readonly bossTitles: {
    readonly mid: string;
    readonly bossPhase1: string;
    readonly bossPhase2: string;
  } | null;
}

export const STAGE_THEMES: readonly StageTheme[] = [
  // 스테이지 1 — 불. 이번 웨이브가 실제로 겉모습을 입히는 유일한 스테이지다.
  {
    stage: 1,
    name: "펄펄 끓는 밤",
    subtitle: "이불 속이 용암 같은 밤이에요",
    palette: { base: "#2A0E0C", accent: "#FF8A3C" },
    mobColors: ["orange", "crimson", "gold"],
    waveOrder: ["mixed", "rush", "snipe", "mixed"],
    backdropScene: "ember",
    bossTitles: {
      mid: "잿불을 두른 것",
      bossPhase1: "불씨를 몰고 온 것",
      bossPhase2: "재 속에 숨어든 것",
    },
  },
  // 스테이지 2 — 역병(자리만 잡아 둔다). 다음 웨이브가 N1·N4·C1과 함께 채운다.
  {
    stage: 2,
    name: "곪은 밤",
    subtitle: "만지면 안 되는 것들이 있어요",
    palette: { base: "#241733", accent: "#6FAE4A" },
    mobColors: [],
    waveOrder: ["mixed", "snipe", "rush", "mixed"],
    backdropScene: null,
    bossTitles: null,
  },
  // 스테이지 3 — 얼음(자리만 잡아 둔다). 다음 웨이브가 신드라고사·리치왕과 함께 채운다.
  {
    stage: 3,
    name: "얼어붙는 밤",
    subtitle: "숨이 하얗게 얼어붙는 밤이에요",
    palette: { base: "#0A2334", accent: "#7A9BE8" },
    mobColors: [],
    waveOrder: ["rush", "snipe", "mixed", "mixed"],
    backdropScene: null,
    bossTitles: null,
  },
];

/**
 * 스테이지 번호로 테마를 찾는다.
 *
 * 4부터는 3부작이 되풀이된다(raid-design.md "(4+) 순환 재시작") — 배율만
 * 계속 오르고 겉모습은 스테이지 1로 돌아간다.
 */
/**
 * ## 3스테이지 주기의 정합 계약
 *
 * 보스 조합의 주기 = BOSS_BREEDS(3종) × BOSSES_PER_STAGE(2) → 정확히
 * 3스테이지마다 반복이고, STAGE_THEMES.length도 3이라 둘이 맞물린다 —
 * 그래서 "잿불 스테이지에 서리귀가 안 선다"(backdrop 주석)가 4·7·10스테이지
 * 에서도 참이다. **보스를 넷으로 늘리거나 보스 걸음을 3개로 바꾸면 이 주기가
 * 갈라져 테마와 보스가 조용히 어긋난다** — 그때는 이 배열 길이도 함께 볼 것.
 * (scripts/invariants.mjs가 강제 씬 스테이지의 보스 조합 스냅으로 단언한다)
 */
export function stageTheme(stage: number): StageTheme {
  const idx = (Math.max(1, stage) - 1) % STAGE_THEMES.length;
  return STAGE_THEMES[idx] ?? STAGE_THEMES[0]!;
}

/**
 * 이 적 품종이 이번 스테이지에서 덮어쓸 색조. 테마에 잔몹 색조가 없으면
 * (스테이지 2·3, 아직 미배선) null — 원래 스프라이트 색 그대로 나간다.
 *
 * 품종 id로 팔레트 안 고정 인덱스를 골라 결정적으로 배정한다. 같은 웨이브를
 * 다시 봐도 같은 적이 같은 색으로 나와야 "이 잔몹이 그 잔몹이다"가 화면에서도
 * 유지된다.
 */
export function tintForEnemy(stage: number, breedId: number): string | null {
  const theme = stageTheme(stage);
  if (theme.mobColors.length === 0) return null;
  const color = theme.mobColors[breedId % theme.mobColors.length]!;
  return STAGE_TINT[color] ?? null;
}
