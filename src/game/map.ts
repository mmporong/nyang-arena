import { makeRng, mixSeed } from "./rng.ts";

/** 난수기 하나. 지도는 전투와 다른 줄기를 쓴다. */
type Rand = () => number;
import type { WaveKind } from "./run.ts";

/**
 * 여정 지도.
 *
 * 지금까지 웨이브 순서는 `["mixed","rush","boss","mixed","snipe","boss"]` 고정
 * 이었다. 판이 어떻게 흘러갈지에 대한 결정이 **하나도 없었다** — 구매·배치·개입
 * 셋을 측정해 온 것과 달리 이 축은 아예 비어 있었다.
 *
 * 구조는 **트리가 아니라 수렴하는 DAG**다. 트리로 짜면 잎이 기하급수로 늘어
 * 보스를 여럿 둬야 하고, 아무 데서나 아무 데로 갈 수 있는 그물로 짜면 "지금
 * 고르는 것이 다음 선택지를 좁힌다"는 감각이 사라진다. 그 감각이 지도의 본체다.
 *
 * 생성 방식도 슬레이 더 스파이어를 따른다 — **칸을 먼저 놓고 잇는 게 아니라
 * 길을 먼저 긋고 안 밟힌 칸을 버린다.** 처음엔 반대로 짰는데(걸음마다 폭을
 * 정하고 선을 이었다) 닿을 수 없는 칸이 생겨 계약 테스트가 476건을 잡아냈다.
 * 길을 먼저 그으면 연결성과 도달성이 **구성에 의해** 보장된다.
 *
 * 보스 자리는 고정이다(세 걸음마다). 난이도 곡선을 보스 순번으로 잡아 두었고
 * (W3 100% → W15 32%), 보스 위치가 흔들리면 그 곡선을 처음부터 다시 재야 한다.
 * 고를 수 있는 것은 **보스로 가는 길**이지 보스가 언제 오느냐가 아니다.
 */

/** 한 걸음의 성격. */
export type NodeKind =
  | "battle" // 평범한 전투. 안전하고 보상도 평범하다
  | "elite" // 저격대. 어렵지만 생선이 많고 유물 카드가 보장된다
  | "shop" // 전투 없음. 생선을 받고 카드를 더 본다
  | "boss"; // 스테이지의 끝. 모든 길이 여기서 만난다

export interface MapNode {
  readonly kind: NodeKind;
  /** 전투 노드가 실제로 낼 웨이브 성격. 상점 노드에서는 쓰이지 않는다. */
  readonly wave: WaveKind;
  /** 격자에서의 줄 번호. 그리기 전용이라 칸이 버려져도 자리가 유지된다. */
  readonly lane: number;
  /** 다음 걸음의 몇 번째 칸으로 갈 수 있는가(배열 인덱스). */
  readonly next: number[];
}

export interface StageMap {
  /** 몇 번째 스테이지인가. 1부터. */
  readonly stage: number;
  readonly steps: MapNode[][];
  /** 걸음마다 고른 칸. 아직 안 고른 걸음은 -1. */
  taken: number[];
}

/** 한 스테이지의 길이. 보스가 세 걸음마다 오므로 여섯이면 보스 둘이다. */
export const STAGE_STEPS = 6;
/** 이 걸음들은 언제나 보스다. `waveKind`의 주기와 반드시 같아야 한다. */
const BOSS_STEPS = new Set([2, 5]);
/** 격자의 줄 수. 넷을 넘으면 세로로 겹치고 고르기도 어려워진다. */
const LANES = 4;
/**
 * 그을 길의 수.
 *
 * 슬더슬은 15층에 여섯을 긋는다. 여기는 여섯 걸음이라 다섯이면 밀도가 비슷하다.
 * 적으면 갈래가 안 생기고, 많으면 거의 모든 칸이 살아남아 격자가 된다.
 */
const PATHS = 5;

export function isBossStep(step: number): boolean {
  return BOSS_STEPS.has(step % STAGE_STEPS);
}

/** 한 여정에 보스가 몇인가. `BOSS_STEPS`에서 파생되므로 주기를 바꿔도 안 어긋난다. */
export const BOSSES_PER_STAGE = BOSS_STEPS.size;

/**
 * 이 걸음이 그 여정의 몇 번째 보스인가 (0부터). 보스 걸음이 아니면 -1.
 *
 * **보스의 신원은 걸음에서만 나와야 한다.** 예전에는 신원을 웨이브 번호로
 * (`bossIndexForWave`), 램프를 걸음으로(`bossRampFor`), 지도 라벨을 또 다른
 * 식으로 계산했다. 상점 칸이 걸음만 먹고 웨이브는 안 먹으므로 셋이 갈라졌고,
 * 상점을 여럿 밟은 여정에서 **같은 이름의 보스가 두 번 나왔다.**
 */
export function bossOrdinalInStage(step: number): number {
  if (!isBossStep(step)) return -1;
  let n = 0;
  for (let i = 0; i < step % STAGE_STEPS; i++) if (isBossStep(i)) n += 1;
  return n;
}

/** 보스 걸음은 한 칸뿐이다 — 모든 길이 여기서 만난다. */
function laneCount(step: number): number {
  return isBossStep(step) ? 1 : LANES;
}

/**
 * 길 하나를 왼쪽에서 오른쪽으로 긋는다.
 *
 * 다음 줄은 현재 줄에서 위아래 한 칸까지만 간다. 그리고 **이미 그어진 길과
 * 교차하지 않는다** — 슬더슬이 명시적으로 두는 규칙이고, 이유는 그리기다.
 * 선이 X자로 만나면 화면에서 어느 선이 내 선인지 따라갈 수가 없다.
 */
function drawPath(startLane: number, edges: Set<string>[], rng: Rand): number[] {
  const lanes: number[] = [];
  let cur = startLane;
  lanes.push(cur);

  for (let step = 0; step < STAGE_STEPS - 1; step++) {
    const width = laneCount(step + 1);
    const options: number[] = [];
    for (let d = -1; d <= 1; d++) {
      const to = cur + d;
      if (to < 0 || to >= width) continue;
      // 교차 검사: 이 걸음에 이미 있는 선 (a → b)와 (cur → to)가 엇갈리는가.
      let crosses = false;
      for (const e of edges[step]!) {
        const [a, b] = e.split(">").map(Number) as [number, number];
        if ((a < cur && b > to) || (a > cur && b < to)) {
          crosses = true;
          break;
        }
      }
      if (!crosses) options.push(to);
    }
    // 갈 곳이 없으면 제자리로 간다. 폭이 좁아지는 보스 걸음에서 생길 수 있다.
    const pick = options.length > 0
      ? options[Math.floor(rng() * options.length)]!
      : Math.min(cur, width - 1);
    edges[step]!.add(`${cur}>${pick}`);
    cur = pick;
    lanes.push(cur);
  }
  return lanes;
}

/**
 * 한 걸음 안의 전투 칸들에 **서로 다른 성격**을 나눠 준다.
 *
 * 예전에는 칸마다 따로 굴렸다(`rng() < 0.45 ? rush : mixed`). 그러면 한 줄의
 * 세 칸이 전부 같은 성격이 되는 일이 흔했고, 그때 지도는 **고를 것이 없는
 * 갈림길**이 된다 — 어느 발바닥을 눌러도 같은 적이 나온다.
 *
 * 정예는 이미 `snipe`로 고정이므로, 전투 칸은 그것과도 겹치지 않게 `mixed`와
 * `rush`를 먼저 쓰고 모자랄 때만 `snipe`를 꺼낸다. 순서를 시드로 섞어야 판마다
 * 어느 줄이 어느 성격인지가 달라진다.
 */
function battleWaves(count: number, hasElite: boolean, rng: Rand): WaveKind[] {
  // 앞의 둘은 섞고 `snipe`는 뒤에 붙인다. 정예가 이미 `snipe`이므로 전투 칸이
  // 셋 이상일 때만 꺼내 쓴다 — 겹치더라도 **같은 전투 칸끼리 겹치는 것보다
  // 정예와 겹치는 편이 낫다.** 전자는 고를 것이 없어지고 후자는 난이도만 겹친다.
  const head: WaveKind[] = ["mixed", "rush"];
  for (let i = head.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [head[i], head[j]] = [head[j]!, head[i]!];
  }
  const pool: WaveKind[] = hasElite ? [...head, "snipe"] : (rng() < 0.5 ? [...head, "snipe"] : ["snipe", ...head]);
  const out: WaveKind[] = [];
  for (let i = 0; i < count; i++) out.push(pool[i % pool.length]!);
  return out;
}

/**
 * 살아남은 칸에 성격을 붙인다.
 *
 * 슬더슬의 배치 규칙을 이 게임 크기에 맞게 옮겼다.
 * - **첫 걸음은 전부 전투.** 시작하자마자 고민을 시키면 아직 아무 정보가 없다
 * - **정예와 상점이 한 걸음을 통째로 덮지 않는다.** 슬더슬이 엘리트·상점·휴식을
 *   연속으로 두지 않는 것과 같은 이유다. 같은 성격이 붙으면 그 구간이 한 색이 된다
 * - **한 걸음에 상점 하나까지.** 둘이면 고르는 게 아니라 상점 구간이 된다
 * - **걸음마다 전투가 최소 하나.** 생선을 벌 길이 막히면 안 된다
 *
 * 슬더슬에는 있지만 여기엔 **안 옮긴** 규칙이 하나 있다. "엘리트는 보스 직전에
 * 두지 않는다"는 그 게임에서 체력이 층을 넘어 이어지기 때문이다. 이 게임은
 * 웨이브마다 전원이 완전히 회복하므로(finishWave), 정예에서 깎인 것이 보스로
 * 넘어가지 않는다. 그 규칙을 그대로 옮겼다가 보스가 세 걸음마다 오는 구조와
 * 겹쳐서 **정예가 한 번도 안 뜨는** 지도가 나왔다 — 규칙은 그 게임의 사정에서
 * 나온 것이지 보편이 아니다.
 */
function assignKinds(steps: number[][], stage: number, rng: Rand): NodeKind[][] {
  const ramp = Math.min(1, (stage - 1) / 4);
  const out: NodeKind[][] = [];

  for (let step = 0; step < steps.length; step++) {
    const lanes = steps[step]!;
    if (isBossStep(step)) {
      out.push(lanes.map(() => "boss" as NodeKind));
      continue;
    }
    const prev = out[step - 1] ?? [];
    const first = step === 0;
    const kinds: NodeKind[] = [];
    let shopUsed = false;

    for (let i = 0; i < lanes.length; i++) {
      // 앞 걸음이 통째로 정예/상점이었으면 이번엔 쉬어 간다.
      const prevAllSpecial = prev.length > 0 && prev.every((k) => k === "elite" || k === "shop");
      if (first || prevAllSpecial) {
        kinds.push("battle");
        continue;
      }
      const roll = rng();
      const eliteChance = 0.3 + ramp * 0.16;
      if (roll < eliteChance) kinds.push("elite");
      else if (!shopUsed && roll < eliteChance + 0.28) {
        shopUsed = true;
        kinds.push("shop");
      } else kinds.push("battle");
    }
    // 전투가 하나도 없으면 한 칸을 전투로 되돌린다.
    if (!kinds.includes("battle")) kinds[0] = "battle";
    /**
     * 그리고 **전투만 있는 걸음도 없어야 한다.**
     *
     * 측정이 이걸 잡았다. 성격을 확률로만 뿌렸더니 갈림길 대부분이 전투 대
     * 전투였고, 그래서 "정예 몰빵" 정책이 판당 정예를 2.0번밖에 못 만났다
     * (아무 길이나 가는 기준선이 1.4번). **고를 것이 없으니 정책이 달라도
     * 겪는 것이 같았고**, 도달 웨이브 격차가 1.0에 머물렀다.
     *
     * 갈림길은 성격이 갈려야 갈림길이다. 전투 대 전투는 선택이 아니라 두 번
     * 그린 같은 칸이다.
     */
    const nonBattle = kinds.filter((k) => k !== "battle").length;
    if (!first && lanes.length >= 2 && nonBattle === 0) {
      const idx = Math.floor(rng() * lanes.length);
      kinds[idx] = rng() < 0.55 ? ("elite" as NodeKind) : ("shop" as NodeKind);
      // 되돌린 칸이 유일한 전투였을 수 있다. 그러면 다른 칸을 전투로 준다.
      if (!kinds.includes("battle")) kinds[(idx + 1) % kinds.length] = "battle";
    }
    out.push(kinds);
  }
  return out;
}

/**
 * 스테이지 하나를 만든다.
 *
 * `rng`를 쓰므로 같은 시드는 같은 지도를 낸다 — 시드 하나로 판 전체를 재현할 수
 * 있다는 이 저장소의 규칙이 지도에도 그대로 적용된다.
 */
/**
 * 여정 지도를 만든다.
 *
 * **전투와 다른 난수 줄기를 쓴다.** 전역 스트림은 회피 판정이 공격 횟수만큼
 * 먹으므로, 지도를 거기서 뽑으면 "1스테이지에서 몇 대 때렸나"가 2스테이지
 * 지도를 바꾼다. 그러면 같은 시드로 두 정책을 비교해도 서로 다른 지도를
 * 걷게 되어 짝비교가 성립하지 않는다 — 결정 축의 잡음이 넓었던 이유다.
 *
 * @param runSeed 런 시드. 스테이지와 섞어 이 지도만의 줄기를 만든다.
 */
export function makeStage(stage: number, runSeed = 0): StageMap {
  const rng = makeRng(mixSeed(runSeed, stage));
  // 걸음별 간선 집합. 교차 검사가 이걸 본다.
  const edges: Set<string>[] = Array.from({ length: STAGE_STEPS - 1 }, () => new Set<string>());
  const paths: number[][] = [];

  for (let p = 0; p < PATHS; p++) {
    let start = Math.floor(rng() * LANES);
    // 처음 두 길은 서로 다른 줄에서 시작한다. 같으면 첫 걸음에 갈래가 없다.
    if (p === 1 && start === paths[0]![0]) start = (start + 1 + Math.floor(rng() * (LANES - 1))) % LANES;
    paths.push(drawPath(start, edges, rng));
  }

  // 밟힌 줄만 살린다. 안 밟힌 칸은 그려 봐야 못 가는 곳이다.
  const used: number[][] = [];
  for (let step = 0; step < STAGE_STEPS; step++) {
    const set = new Set<number>();
    for (const path of paths) set.add(path[step]!);
    used.push([...set].sort((a, b) => a - b));
  }

  const kinds = assignKinds(used, stage, rng);
  const steps: MapNode[][] = [];

  for (let step = 0; step < STAGE_STEPS; step++) {
    const lanes = used[step]!;
    const nextLanes = used[step + 1] ?? [];
    // 이 걸음의 전투 칸들이 쓸 성격을 미리 나눠 둔다. 칸마다 따로 굴리면 겹친다.
    const rowKinds = lanes.map((_, i) => kinds[step]![i] ?? "battle");
    const battleWaveQueue = battleWaves(
      rowKinds.filter((k) => k === "battle").length,
      rowKinds.some((k) => k === "elite"),
      rng,
    );
    let battleAt = 0;
    const row: MapNode[] = lanes.map((lane, i) => {
      // 이 칸에서 실제로 그어진 간선만 다음 걸음의 **인덱스**로 옮긴다.
      const outs = new Set<number>();
      if (step < STAGE_STEPS - 1) {
        for (const e of edges[step]!) {
          const [a, b] = e.split(">").map(Number) as [number, number];
          if (a !== lane) continue;
          const idx = nextLanes.indexOf(b);
          if (idx >= 0) outs.add(idx);
        }
      }
      const kind = kinds[step]![i] ?? "battle";
      return {
        kind,
        /**
         * 큐는 **전투 칸만** 먹는다. 상점 칸까지 소비하면 `battle | shop | battle`
         * 줄에서 상점이 가운데 값을 가져가 두 전투가 같은 성격이 된다
         * (상점은 이 값을 쓰지도 않는다).
         */
        wave:
          kind === "boss" ? "boss"
          : kind === "elite" ? "snipe"
          : kind === "battle" ? (battleWaveQueue[battleAt++] ?? "mixed")
          : "mixed",
        lane,
        next: [...outs].sort((a, b) => a - b),
      };
    });
    steps.push(row);
  }

  return { stage, steps, taken: new Array<number>(STAGE_STEPS).fill(-1) };
}

/**
 * 지금 걸음에서 고를 수 있는 칸들.
 *
 * 첫 걸음은 전부 열려 있고, 그다음부터는 직전에 고른 칸에서 선이 닿는 곳만
 * 열린다. 이게 없으면 지도가 그냥 매 걸음 무작위 삼지선다가 된다.
 */
export function openLanes(map: StageMap, step: number): number[] {
  const row = map.steps[step];
  if (!row) return [];
  if (step === 0) return row.map((_, i) => i);
  const prevIdx = map.taken[step - 1];
  const prev = prevIdx !== undefined && prevIdx >= 0 ? map.steps[step - 1]?.[prevIdx] : undefined;
  if (!prev) return row.map((_, i) => i);
  return prev.next.filter((i) => i < row.length);
}

/**
 * 다음 보스가 무엇이고 무엇을 노리는가.
 *
 * 측정에서 나온 것을 화면으로 옮기는 일이다 — **보스전은 팀 성격에 따라 통과율이
 * 12%p 갈린다**(근접 위주 87% vs 원거리 위주 75%, 표본 157/229). 그 차이가
 * 이미 존재하는데 플레이어는 볼 방법이 없었다. 지도에서 미리 알려 주면 새 자원도
 * 새 시스템도 없이 결정 하나가 생긴다 — "저 보스에는 앞줄을 더 세울까".
 *
 * 정답은 안 알려준다. 보스가 **무엇을 하는지**만 말하고, 그래서 무엇을 해야
 * 하는지는 플레이어가 정한다.
 */
export function bossHint(breedId: number): string {
  switch (breedId) {
    case 10:
      return "살금이 — 사라졌다 나타나요. 떨어져 있으면 하나씩 데려가니 붙어 있어야 해요";
    case 11:
      return "서리귀 — 제자리에서 넓게 뿌려요. 평소엔 흩어지고, 얼기 시작하면 붙어서 녹여야 해요";
    default:
      return "무쇠발톱 — 곧장 걸어와요. 앞이 버티고, 부를 땐 그 앞으로 모여야 해요";
  }
}

/** 사람이 읽을 이름과 한 줄 설명. 카드와 같은 어투를 쓴다. */
export function nodeInfo(kind: NodeKind): { name: string; hint: string } {
  switch (kind) {
    case "elite":
      return { name: "가위눌림", hint: "무거워요. 밀어내면 뭔가 하나 떨어뜨리고 가요" };
    case "shop":
      // 종류 id는 shop이지만 하는 일은 정찰이다. 다음 보스를 대비하는 자리다.
      return { name: "숨 돌리기", hint: "아무것도 안 와요. 생선과 다시 뽑기, 다음 악몽에 쓸 회피까지 챙겨요" };
    case "boss":
      return { name: "악몽", hint: "되풀이되는 거예요. 예고를 잘 보고 움직이세요" };
    // 보스별 안내는 bossHint가 따로 만든다 — 어느 보스가 오는지 알아야 해서다.
    case "battle":
      return { name: "얕은 잠", hint: "자잘한 것들이에요. 밀어내기 어렵지 않아요" };
  }
}

/**
 * 지도가 실제로 갈림길인지 검사한다. `npm test`가 이걸 단언한다.
 *
 * 생성기가 조용히 망가지면(모든 걸음이 한 갈래가 되거나, 닿을 수 없는 칸이
 * 생기거나) 지도는 화면에만 남고 결정은 사라진다. 눈으로는 잘 안 보이는
 * 고장이라 계약으로 묶는다.
 */
export function checkStage(map: StageMap): string[] {
  const problems: string[] = [];
  if (map.steps.length !== STAGE_STEPS) problems.push(`걸음 수가 ${map.steps.length}`);

  map.steps.forEach((row, i) => {
    if (row.length === 0) problems.push(`${i}걸음이 비었다`);
    if (isBossStep(i)) {
      if (row.length !== 1 || row[0]?.kind !== "boss") problems.push(`${i}걸음이 보스가 아니다`);
      return;
    }
    if (row.some((n) => n.kind === "boss")) problems.push(`${i}걸음에 보스가 섞였다`);
    if (!row.some((n) => n.kind === "battle")) problems.push(`${i}걸음에 전투가 없다`);
    if (row.filter((n) => n.kind === "shop").length > 1) problems.push(`${i}걸음에 상점이 둘`);
    if (i === 0 && row.some((n) => n.kind !== "battle")) problems.push("첫 걸음이 전투가 아니다");
    // 갈림길은 성격이 갈려야 한다. 전투 대 전투는 두 번 그린 같은 칸이다.
    if (i > 0 && row.length >= 2 && row.every((n) => n.kind === "battle")) {
      problems.push(`${i}걸음이 전부 전투다 — 고를 것이 없다`);
    }
    for (const n of row) {
      if (n.next.length === 0) problems.push(`${i}걸음 ${n.lane}줄에서 갈 곳이 없다`);
      for (const t of n.next) {
        if (t < 0 || t >= (map.steps[i + 1]?.length ?? 0)) {
          problems.push(`${i}걸음 ${n.lane}줄의 선이 ${t}로 벗어난다`);
        }
      }
    }
  });

  // 선은 교차하지 않는다. 교차하면 화면에서 자기 길을 따라갈 수 없다.
  for (let i = 0; i < map.steps.length - 1; i++) {
    const row = map.steps[i]!;
    const next = map.steps[i + 1]!;
    const links: [number, number][] = [];
    for (const n of row) for (const b of n.next) links.push([n.lane, next[b]!.lane]);
    for (const [a1, b1] of links) {
      for (const [a2, b2] of links) {
        if ((a1 < a2 && b1 > b2) || (a1 > a2 && b1 < b2)) {
          problems.push(`${i}걸음에서 선이 교차한다 (${a1}→${b1} × ${a2}→${b2})`);
        }
      }
    }
  }

  // 모든 칸에 닿을 수 있어야 한다. 못 닿는 칸은 그려 봐야 미끼다.
  const reach = new Set<string>();
  const walk = (step: number, idx: number): void => {
    const k = `${step}:${idx}`;
    if (reach.has(k)) return;
    reach.add(k);
    for (const t of map.steps[step]?.[idx]?.next ?? []) walk(step + 1, t);
  };
  map.steps[0]?.forEach((_, i) => walk(0, i));
  map.steps.forEach((row, i) => {
    row.forEach((_, j) => {
      if (!reach.has(`${i}:${j}`)) problems.push(`${i}걸음 ${j}줄에 닿을 수 없다`);
    });
  });

  return problems;
}
