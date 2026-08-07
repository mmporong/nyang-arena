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
  buyOffer,
  currentKind,
  newRun,
  rerollOffers,
  startBattle,
} from "../src/game/run.ts";
import { affordable, makeBossBot, walkMap, MAP_POLICIES } from "./bot-policy.mjs";

const SCHEMA = 1;
const RUNS = Number(process.argv[2] ?? 300);
const MAX_WAVE = 60;
const mapPick = MAP_POLICIES["무작위"];
const byCost = (a, b) => (a.kind === "replace" ? 1 : 0) - (b.kind === "replace" ? 1 : 0) || b.cost - a.cost;

const finals = [];
const tried = new Map();
const lost = new Map();
const dur = new Map();

function note(map, key, v = 1) {
  map.set(key, (map.get(key) ?? 0) + v);
}

for (let seed = 1; seed <= RUNS; seed++) {
  const s = newRun(seed);
  const respond = makeBossBot();
  let kind = null;
  let guard = 0;
  while (guard++ < MAX_WAVE * 4000) {
    if (s.phase === "gameover") {
      if (kind) note(lost, kind);
      break;
    }
    if (s.phase === "reward") {
      for (let k = 0; k < 40; k++) {
        const aff = affordable(s);
        const pick = aff.length > 0 ? [...aff].sort(byCost)[0] : null;
        if (!pick) break;
        if (!buyOffer(s, pick)) s.offers = s.offers.map((o) => (o === pick ? null : o));
      }
      /**
       * 재추첨 뒤에 **다시 산다.** balance-sim과 한 글자도 다르면 안 된다 —
       * 처음엔 재추첨만 하고 안 샀더니 같은 코드에서 중앙값이 11과 12로
       * 갈렸다. 기준 수치를 내는 자리에서 그런 차이가 나면, 이 파일이 고치려던
       * 문제(문서마다 숫자가 다르다)를 그대로 재현하는 것이다.
       */
      const buyAll = () => {
        for (let k = 0; k < 40; k++) {
          const aff = affordable(s);
          const pick = aff.length > 0 ? [...aff].sort(byCost)[0] : null;
          if (!pick) break;
          if (!buyOffer(s, pick)) s.offers = s.offers.map((o) => (o === pick ? null : o));
        }
      };
      let rolls = 0;
      while (rolls < 4 && s.gold >= 12 && rerollOffers(s)) {
        rolls += 1;
        buyAll();
      }
      while (s.freeRerolls > 0) {
        rerollOffers(s);
        buyAll();
      }
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
    }
  }
  finals.push(Math.min(s.wave, MAX_WAVE));
}

finals.sort((a, b) => a - b);
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
      id: "placement-no-depth",
      what: "배치에 깊이가 없다 — 드래그가 장식이다",
      measured: "폭 3.1웨이브(고의적 최악 대비) / 깊이 0.2웨이브(자동 배치 대비)",
      diagnosis:
        "자동 배치(bestFreeCell)가 이미 최선에 가깝다. 관문은 폭으로 잡고 있어 통과하지만, 그 관문은 '배치를 망칠 수 있는가'를 재는 회귀 감시지 '배치가 결정인가'의 증명이 아니다",
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
