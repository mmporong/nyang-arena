/**
 * 기준 수치를 한 파일로 뽑는다.
 *
 * 문서마다 손으로 적은 숫자가 서로 어긋나 있었다 — 외부 검토가 P0으로 잡은
 * 문제다. 보스 빈도를 17%라고 쓴 문서와 33.3%인 코드가 몇 주째 공존했고,
 * 어느 쪽이 현재인지 읽는 사람이 알 방법이 없었다.
 *
 * 그래서 **생성 원본을 하나만 둔다.** 모든 공개 문서는 여기서 나온 값을 인용하고,
 * 손으로 고치지 않는다. 커밋·시드 범위·Node 버전·스키마 버전을 함께 박아 두는
 * 이유는, 나중에 이 표를 보는 사람이 **언제 어떤 코드에서 나온 값인지**를 알아야
 * 하기 때문이다.
 *
 * 실행: npm run metrics
 */
import { execSync } from "node:child_process";
import { mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stepBattle } from "../src/game/battle.ts";
import { BALANCE } from "../src/game/balance.ts";
import { isBossStep, STAGE_STEPS } from "../src/game/map.ts";
import {
  currentKind,
  newRun,
  startBattle,
} from "../src/game/run.ts";
import { makeBossBot, walkMap, leaveShop, shopStep, MAP_POLICIES } from "./bot-policy.mjs";

const SCHEMA = 1;
const RUNS = Number(process.argv[2] ?? 300);
const MAX_WAVE = 60;
const mapPick = MAP_POLICIES["무작위"];

const finals = [];
/** 한 판의 **전투 시간 합계**(초). 상점·지도에서 고르는 시간은 안 들어간다. */
const sessionSec = [];
const tried = new Map();
const lost = new Map();
const dur = new Map();

function note(map, key, v = 1) {
  map.set(key, (map.get(key) ?? 0) + v);
}

for (let seed = 1; seed <= RUNS; seed++) {
  const s = newRun(seed);
  const respond = makeBossBot();
  const shop = { rerolls: 0, lastWave: 0 };
  let kind = null;
  let runSec = 0;
  let guard = 0;
  while (guard++ < MAX_WAVE * 4000) {
    if (s.phase === "gameover") {
      if (kind) note(lost, kind);
      break;
    }
    if (s.phase === "reward") {
      // 구매 정책은 bot-policy의 shopStep 한 곳에만 있다. 예전에는 이 파일이
      // 제 나름의 사본을 갖고 있었고 — 바로 위에 "balance-sim과 한 글자도
      // 다르면 안 된다"고 적어 두고도 — 재추첨 예산 리셋 시점과 무료 재추첨
      // 처리가 갈려 같은 코드에서 p25가 8과 9로 달라졌다. 복사해 놓고 같기를
      // 바라는 대신 부를 수 있는 것 하나로 만들었다.
      const act = shopStep(s, shop);
      if (act !== "leave") continue;
      leaveShop(s);
      continue;
    }
    if (s.phase === "map") {
      walkMap(s, mapPick);
      continue;
    }
    if (s.phase === "prepare") {
      if (s.wave > MAX_WAVE) break;
      kind = currentKind(s);
      note(tried, kind);
      startBattle(s);
      if (s.phase !== "battle") break;
      continue;
    }
    respond(s);
    stepBattle(s, 100);
    if (s.phase !== "battle" && kind) {
      const list = dur.get(kind) ?? [];
      list.push(s.battleElapsed / 1000);
      dur.set(kind, list);
      runSec += s.battleElapsed / 1000;
    }
  }
  finals.push(Math.min(s.wave, MAX_WAVE));
  sessionSec.push(runSec);
}

finals.sort((a, b) => a - b);
sessionSec.sort((a, b) => a - b);
const pct = (a, p) => a[Math.min(a.length - 1, Math.floor(a.length * p))];
const passRate = (k) => {
  const t = tried.get(k) ?? 0;
  return t ? Number((((t - (lost.get(k) ?? 0)) / t) * 100).toFixed(1)) : null;
};
const durPct = (k, p) => {
  const list = (dur.get(k) ?? []).slice().sort((a, b) => a - b);
  return list.length ? Number(pct(list, p).toFixed(1)) : null;
};

/** 빌드 산출물 크기. 문서가 낡은 값을 고르지 않도록 매번 다시 잰다. */
function bundleBytes() {
  try {
    const dir = "dist/assets";
    const js = readdirSync(dir).filter((f) => f.endsWith(".js"));
    return js.reduce((a, f) => a + statSync(join(dir, f)).size, 0);
  } catch {
    return null;
  }
}
const git = (cmd) => {
  try {
    return execSync(cmd, { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
};

/**
 * 작업 트리가 더러우면 이 산출물은 **어느 커밋으로도 재현되지 않는다.**
 *
 * `dirty: true`를 적어 두기만 하고 조용히 넘어가고 있었다. 그래서 저장소에
 * 커밋된 기준 수치가 "커밋 f7de9d5 (작업 트리 변경 있음)"에서 나온 값이었고,
 * 그 커밋을 체크아웃해도 같은 값이 안 나온다. 기준 수치의 존재 이유가
 * 재현인데 그게 깨져 있었다.
 *
 * 그래서 이제 시끄럽게 알린다. 막지는 않는다 — 개발 중에는 더러운 트리에서
 * 돌려 보는 것이 정상이고, 관문을 여기서 막으면 verify를 못 돌린다. 대신
 * **커밋할 산출물은 깨끗한 트리에서 다시 뽑아야 한다**는 것을 산출물 자신이
 * 말하게 한다.
 */
const dirty = git("git status --porcelain") !== "";
if (dirty) {
  console.warn("경고: 작업 트리에 변경이 있다. 이 산출물은 어느 커밋으로도 재현되지 않는다.");
  console.warn("      커밋할 값을 뽑으려면 먼저 커밋하고 다시 돌릴 것.");
}

const metrics = {
  schema: SCHEMA,
  generatedFrom: {
    commit: git("git rev-parse --short HEAD"),
    dirty,
    /** 이 값이 false면 표의 숫자를 공개 문서에 인용하면 안 된다. */
    reproducible: !dirty,
    node: process.version,
    seeds: { from: 1, to: RUNS },
    runs: RUNS,
    maxWave: MAX_WAVE,
  },
  structure: {
    stageSteps: STAGE_STEPS,
    bossSteps: Array.from({ length: STAGE_STEPS }, (_, i) => i).filter(isBossStep),
    bossSharePct: Number(
      ((Array.from({ length: STAGE_STEPS }, (_, i) => i).filter(isBossStep).length / STAGE_STEPS) * 100).toFixed(1),
    ),
  },
  distribution: {
    min: finals[0],
    p25: pct(finals, 0.25),
    median: pct(finals, 0.5),
    p75: pct(finals, 0.75),
    max: finals[finals.length - 1],
    mean: Number((finals.reduce((a, b) => a + b, 0) / finals.length).toFixed(2)),
    hitMaxWave: finals.filter((w) => w >= MAX_WAVE).length,
  },
  /**
   * 한 판의 전투 시간 합계. 세션 길이를 말할 때 쓰는 값이다 — 다만 상점·지도에서
   * **고르는 시간은 안 들어간다.** 그쪽은 사람마다 다르고 하네스가 즉시 고른다.
   */
  session: {
    battleSecP25: Number(pct(sessionSec, 0.25).toFixed(1)),
    battleSecMedian: Number(pct(sessionSec, 0.5).toFixed(1)),
    battleSecP75: Number(pct(sessionSec, 0.75).toFixed(1)),
  },
  waveKinds: Object.fromEntries(
    ["mixed", "rush", "snipe", "boss"].map((k) => [
      k,
      { tried: tried.get(k) ?? 0, passPct: passRate(k), p50Sec: durPct(k, 0.5), p90Sec: durPct(k, 0.9) },
    ]),
  ),
  balance: {
    enemyScale: BALANCE.enemyScale,
    levelScale: BALANCE.levelScale,
    upgradeCostBase: BALANCE.upgradeCostBase,
    upgradeCostGrowth: BALANCE.upgradeCostGrowth,
    goldBase: BALANCE.goldBase,
    goldPerWave: BALANCE.goldPerWave,
    telegraphDmg: BALANCE.telegraphDmg,
    dodgeCharges: BALANCE.dodgeCharges,
  },
  build: { bundleBytes: bundleBytes() },
  /**
   * 미해결 축. **관문이 빨간불인 이유를 산출물이 스스로 말해야 한다.**
   *
   * 실패하는 시험을 관문에서 빼면 녹색이 되지만 그건 거짓말이다. 넣어 두고
   * 빨간불인 채로 두되, 왜 빨간지가 이 파일에 적혀 있어야 읽는 사람이
   * "고장인가 미완인가"를 구분할 수 있다.
   */
  openIssues: [
    {
      id: "buy-depth-below-bar",
      what: "구매 깊이가 기준 아래로 내려갔다",
      measured: "깊이 1.3웨이브 (기준 1.5) · 몰빵 피벗이 무작위 구매를 이기는 시드 54%",
      diagnosis:
        "한 걸음의 순서를 map → reward → prepare로 바꾸면서 rollOffers가 전투 직후에서 길을 고른 뒤로 옮겨 갔다. 같은 시드가 다른 카드를 내므로 이건 같은 것을 다시 잰 값이 아니라 다른 표본이다. 그래도 기준을 못 넘은 것은 사실이고, 54%는 짝비교로도 동전 던지기에 가깝다",
      history: "순서를 바꾸기 전 2.5 (같은 스크립트·같은 시드 범위)",
      consequence:
        "제출 문서가 내세우던 '깊은 축 셋(구매·유물·개입)'은 이 수치로는 둘이다. 되돌릴지 다시 튜닝할지는 측정으로 정한다",
      gate: "npm run decisions가 판정만 찍고 막지 않는다 (exit 0)",
    },
    {
      id: "placement-no-depth",
      what: "배치에 깊이가 없다 — 드래그가 장식이다",
      measured: "폭 3.1웨이브(고의적 최악 대비) / 깊이 0.2웨이브(자동 배치 대비)",
      diagnosis:
        "자동 배치(bestFreeCell)가 이미 최선에 가깝다. 관문은 폭으로 잡고 있어 통과하지만, 그 관문은 '배치를 망칠 수 있는가'를 재는 회귀 감시지 '배치가 결정인가'의 증명이 아니다",
      /**
       * 보스전 밸런스를 재설계해 배치를 살리려 했고, 손잡이 셋을 전부 재고
       * 전부 기각했다. 다시 시도하는 사람이 같은 길을 또 걷지 않도록 남긴다.
       */
      tried: [
        "보스 평타 램프(bossAtkMulFirst 신설) — 탱킹이 없던 문제. 깊이 0.2→0.7, 중앙값 11. 단독으로는 기준 미달",
        "예고 고정 피해(telegraphFlatShare 신설) — 비율 피해라 전사 190과 마법사 94가 같은 횟수에 죽던 문제. 깊이 0.6, 중앙값 16",
        "둘을 합침 — 깊이 0.2로 되돌아가고 중앙값 8. bot-policy.mjs에 적힌 '보스가 세지면 축이 압축된다'가 재현됐다",
        "회피를 순간이동에서 고정거리 밀어내기로 — 배치 깊이 0.2→0.7이지만 구매 깊이가 2.5→1.2로 떨어져 순손실. 되돌렸다",
      ],
      diagnosisRoot:
        "개입하면 예고를 70~100% 회피하고, 안 맞으면 위치가 결과에 안 닿는다. 통제 아레나(npm run formation)에서 회피 차지를 6에서 1로 줄여도 12칸이 전부 승률 100%였다",
      gate: "npm run placement가 폭으로만 판정하고 깊이는 판정만 찍는다 (exit 0)",
    },
    {
      id: "strike-not-a-choice",
      what: "취약 창 연타가 선택이 아니다",
      measured: "회피만 83.3% → 읽고 판단 85.7% (합산 기준 +2.4%p)",
      diagnosis:
        "연타에 비용이 없고 창이 3초로 제한돼 있어 '열리면 무조건 누른다'가 유일한 답이다. 화면에서 가장 화려한 연출인데 결정으로서는 가장 작다",
      consequence: "강화하거나(비용·상충 부여), 결정이 아닌 보상 연출로 인정하고 그렇게 설명해야 한다",
    },
    {
      id: "map-axis",
      what: "지도(경로 선택)가 결정 기준을 못 넘는다",
      measured: "격차 0.9웨이브 (기준 1.5)",
      tried: ["정예 보상 강화", "노드를 성격으로 분화", "환전 불가 전술 슬롯(회피 +2/4/6)"],
      diagnosis: "자원이 생선 하나뿐이라 모든 경로 선택이 '더 벌까 덜 쓸까'로 수렴한다",
      gate: "npm run map이 exit 1을 내고 npm run verify가 그것 때문에 빨간불이다",
    },
    {
      id: "matchup-metric-noisy",
      what: "궁합 표(팀 성격 x 웨이브 성격)가 결정에 쓸 만큼 안정적이지 않다",
      measured: "같은 코드·같은 시드 범위에서 4.2%p와 7.6%p가 나온다. 무관한 변수를 바꾸면 9.2%p와 5.0%p",
      diagnosis:
        "팀 성격 분류가 봇이 그때그때 어떤 팀을 갖게 되느냐에 달려 있어 칸마다 표본이 들쭉날쭉하다",
      consequence:
        "이 수치로 '일반 웨이브에 궁합이 있다/없다'를 말하면 안 된다. WS4(일반 웨이브에 역할 주기)는 지표를 고치기 전까지 보류",
      stable: "보스 열만은 일관되다 — 근접 87% vs 원거리 75%, 세 번 잰 값이 모두 12~15%p",
    },
  ],
};

mkdirSync("docs/generated", { recursive: true });
writeFileSync("docs/generated/metrics-current.json", JSON.stringify(metrics, null, 2) + "\n");

const d = metrics.distribution;
const wk = metrics.waveKinds;
const md = `<!-- 이 파일은 npm run metrics가 생성한다. 손으로 고치지 말 것. -->
# 기준 수치

- 커밋 \`${metrics.generatedFrom.commit}\`${metrics.generatedFrom.dirty ? " — **작업 트리 변경 있음. 이 값은 어느 커밋으로도 재현되지 않으므로 인용하지 말 것**" : ""}
- 시드 ${metrics.generatedFrom.seeds.from}~${metrics.generatedFrom.seeds.to} · Node ${metrics.generatedFrom.node} · 스키마 v${SCHEMA}

## 구조

- 한 여정 ${metrics.structure.stageSteps}걸음, 보스는 ${metrics.structure.bossSteps.join("·")}번째 걸음
- **보스 비중 ${metrics.structure.bossSharePct}%**

## 도달 웨이브

| 최소 | p25 | 중앙값 | p75 | 최대 | 평균 | ${MAX_WAVE}웨이브 도달 |
|---|---|---|---|---|---|---|
| ${d.min} | ${d.p25} | **${d.median}** | ${d.p75} | ${d.max} | ${d.mean} | ${d.hitMaxWave}건 |

## 한 판 전투 시간 합계

상점·지도에서 고르는 시간은 빠져 있다 — 하네스가 즉시 고르기 때문이다.

| p25 | 중앙값 | p75 |
|---|---|---|
| ${metrics.session.battleSecP25}초 | **${(metrics.session.battleSecMedian / 60).toFixed(1)}분** (${metrics.session.battleSecMedian}초) | ${metrics.session.battleSecP75}초 |

## 웨이브 성격별

| 성격 | 시도 | 통과율 | p50(초) | p90(초) |
|---|---|---|---|---|
${["mixed", "rush", "snipe", "boss"]
  .map((k) => `| ${k} | ${wk[k].tried} | ${wk[k].passPct}% | ${wk[k].p50Sec} | ${wk[k].p90Sec} |`)
  .join("\n")}

## 밸런스 상수

적 성장 \`${metrics.balance.enemyScale}^(웨이브-1)\` · 수입 \`${metrics.balance.goldBase} + ${metrics.balance.goldPerWave}×웨이브\` ·
강화 비용 \`${metrics.balance.upgradeCostBase} × ${metrics.balance.upgradeCostGrowth}^(Lv-1)\` · 레벨 효과 \`${metrics.balance.levelScale}^(Lv-1)\`

## 빌드

${metrics.build.bundleBytes ? `번들 ${(metrics.build.bundleBytes / 1024).toFixed(1)} KB` : "빌드 산출물 없음 — npm run build 후 다시 생성할 것"}
`;
writeFileSync("docs/generated/metrics-current.md", md);

console.log("docs/generated/metrics-current.json");
console.log("docs/generated/metrics-current.md");
console.log(
  `중앙값 ${d.median} · 보스 통과율 ${wk.boss.passPct}% · 보스 비중 ${metrics.structure.bossSharePct}% · 커밋 ${metrics.generatedFrom.commit}`,
);
