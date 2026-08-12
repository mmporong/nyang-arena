/**
 * 한 판을 처음부터 끝까지 웨이브별로 따라간다.
 *
 * 분포는 `npm run sim`이 보여주지만, 그건 300판의 요약이라 "한 판이 어떻게
 * 흘러가는가"는 안 보인다. 이 스크립트는 딱 한 판을 사람이 읽을 수 있게 편다 —
 * 무엇을 샀고, 어떤 적이 나왔고, 보스전에서 예고가 몇 번 떴고, 어디서 끝났는지.
 *
 * 시드를 고정하므로 같은 명령은 같은 판을 재현한다.
 *
 * 실행: npm run trace [시드] [--dodge]
 */
import { walkMap, leaveShop } from "./bot-policy.mjs";
import { stepBattle } from "../src/game/battle.ts";
import { buyOffer, newRun, startBattle, unitCap, relicActive, currentKind } from "../src/game/run.ts";
import { livingCats, CLASS_ORDER, CLASS_SHORT, zeroByClass } from "../src/game/types.ts";

const SEED = Number(process.argv[2] ?? 7);
const DODGE = process.argv.includes("--dodge");
const DT = 100;

const KIND_LABEL = { mixed: "혼합", rush: "돌격", snipe: "저격", boss: "보스" };

const s = newRun(SEED);
console.log(`시드 ${SEED} · 회피 ${DODGE ? "함(예고 뜨면 즉시)" : "안 함"}\n`);

// ── 시작 상점 ──────────────────────────────────────────────────
const buyPhase = () => {
  const bought = [];
  for (let guard = 0; guard < 20; guard++) {
    const afford = s.offers
      .filter((o) => o && o.cost <= s.gold)
      .sort((a, b) => (a.kind === "replace" ? 1 : 0) - (b.kind === "replace" ? 1 : 0) || b.cost - a.cost);
    const pick = afford[0];
    if (!pick) break;
    if (buyOffer(s, pick)) bought.push(`${pick.label}(${pick.cost})`);
    else s.offers = s.offers.map((o) => (o === pick ? null : o));
  }
  return bought;
};

const team = () => {
  const cats = livingCats(s.ally);
  // 직업 목록을 손으로 적지 않는다. `tsconfig.json`의 include가 `src`뿐이라
  // **여기는 tsc가 안 본다** — 직업을 늘려도 컴파일 오류가 안 나고 새 직업만
  // 조용히 이 줄에서 사라진다. types.ts에서 받아 쓰면 그럴 수 없다.
  const by = zeroByClass();
  for (const c of cats) by[c.breed.cls] += 1;
  return CLASS_ORDER.map((k) => `${CLASS_SHORT[k]}${by[k]}`).join(" ");
};

// 판은 지도에서 시작한다. 길을 골라야 상대가 정해지고, 그 상대를 보고 산다.
walkMap(s);
const opening = buyPhase();
console.log(`시작 상점  생선 ${s.gold + opening.reduce((a, b) => a + Number(b.match(/\((\d+)\)/)?.[1] ?? 0), 0)} → ${s.gold}`);
console.log(`           구매: ${opening.join(", ") || "없음"}`);
console.log(`           팀: ${team()}  (한도 ${unitCap(s.wave)})\n`);
leaveShop(s);

// ── 웨이브 루프 ────────────────────────────────────────────────
console.log("웨이브  성격   적  전투    예고/회피   결과   팀           생선");
console.log("──────────────────────────────────────────────────────────────────");

for (let guard = 0; guard < 200; guard++) {
  if (s.phase === "gameover") break;
  if (s.phase === "map") {
    walkMap(s);
    continue;
  }
  if (s.phase === "reward") {
    const got = buyPhase();
    if (got.length > 0) console.log(`        └ 구매: ${got.join(", ")}`);
    leaveShop(s);
    continue;
  }

  const wave = s.wave;
  const kind = currentKind(s);
  const enemies = livingCats(s.enemy).length;
  startBattle(s);
  if (s.phase !== "battle") break;

  let telegraphs = 0;
  let dodged = 0;
  let wasUp = false;
  const before = livingCats(s.ally).length;

  while (s.phase === "battle") {
    const up = s.enemy.some((c) => c?.telegraph);
    if (up && !wasUp) telegraphs += 1;
    wasUp = up;
    if (DODGE && up && s.dodgeCharges > 0) {
      const had = s.dodgeCharges;
      s.pending.push({ kind: "dodge" });
      stepBattle(s, DT);
      if (s.dodgeCharges < had) dodged += 1;
      continue;
    }
    stepBattle(s, DT);
  }

  const secs = (s.battleElapsed / 1000).toFixed(1);
  const alive = livingCats(s.ally).length;
  const won = s.phase !== "gameover";
  const tel = kind === "boss" ? `${telegraphs}회/${dodged}회` : "—";
  console.log(
    `  W${String(wave).padStart(2)}  ${KIND_LABEL[kind]}  ${String(enemies).padStart(3)}  ` +
      `${secs.padStart(5)}초  ${tel.padStart(9)}  ${won ? "승" : "패"}  ` +
      `${before}→${alive} ${team().padEnd(14)} ${String(s.gold).padStart(3)}`,
  );
  if (!won) break;
}

console.log("──────────────────────────────────────────────────────────────────");
console.log(`\n결과: ${s.wave}웨이브 도달 · ${s.lossReason === "timeout" ? "시간 초과" : "전멸"}`);
console.log(`시너지: ${s.synergies.map((x) => `${x.name}(${x.trigger})`).join(" / ")}`);
