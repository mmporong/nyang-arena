/**
 * 새 판정 기준이 **아무 의미 없는 것도 통과시키는가.**
 *
 * 실행: npm run null
 *
 * 이 파일은 한 번 크게 틀린 뒤에 생겼다. 지도 축 판정을 "시드별 승자가 절반을
 * 못 넘고 + 신탁 이득 1.5웨이브 이상"으로 바꿔 관문을 초록으로 만들었는데,
 * 아래 귀무모형이 그걸 뒤집었다 — 전략적 차이가 정의상 0인 비교가 **더 잘**
 * 통과했다.
 *
 * **새 지표를 만들면 여기에 먼저 걸어 볼 것.** 진짜 정책이 귀무모형을 뚜렷하게
 * 이기지 못하면 그 지표는 전략이 아니라 잡음을 재고 있다.
 *
 * 귀무모형: 같은 정책 하나를 서로 겹치지 않는 시드 블록 셋에 돌린다. 셋 사이에
 * 전략적 차이가 **정의상 0**이다. 그런데도 topShare<=50% & oracleGain>=1.5가
 * 나오면, 그 기준은 전략이 아니라 "잡음 셋 중 최대값"을 재고 있는 것이다.
 */
import { stepBattle } from "../src/game/battle.ts";
import { newRun, startBattle } from "../src/game/run.ts";
import { makeBossBot, walkMap, leaveShop, shopStep, MAP_POLICIES } from "./bot-policy.mjs";

const RUNS = 300, MAX_WAVE = 60;
function play(pick, seed) {
  const s = newRun(seed); const respond = makeBossBot(); const shop = { rerolls: 0, lastWave: 0 };
  for (let g = 0; g < MAX_WAVE * 4000; g++) {
    if (s.phase === "gameover") return s.wave;
    if (s.phase === "reward") { if (shopStep(s, shop) !== "leave") continue; leaveShop(s); continue; }
    if (s.phase === "map") { walkMap(s, pick); continue; }
    if (s.phase === "prepare") { if (s.wave > MAX_WAVE) return MAX_WAVE; startBattle(s); if (s.phase !== "battle") return s.wave; continue; }
    respond(s); stepBattle(s, 100);
  }
  return s.wave;
}
function judge(label, cols) {
  const names = Object.keys(cols);
  const wins = Object.fromEntries(names.map(n => [n, 0]));
  let oracle = 0; const means = {};
  for (const n of names) means[n] = cols[n].reduce((a,b)=>a+b,0)/RUNS;
  for (let i = 0; i < RUNS; i++) {
    let best = names[0];
    for (const n of names) if (cols[n][i] > cols[best][i]) best = n;
    wins[best] += 1; oracle += cols[best][i];
  }
  oracle /= RUNS;
  const fixedBest = names.reduce((a,b) => means[a] >= means[b] ? a : b);
  const top = Math.max(...Object.values(wins)) / RUNS;
  const gain = oracle - means[fixedBest];
  const pass = top <= 0.5 && gain >= 1.5;
  console.log(`${label.padEnd(30)} 최다 ${(top*100).toFixed(1)}%  신탁이득 ${gain.toFixed(2)}  → ${pass ? "통과 ⚠" : "미달"}`);
}

// ① 진짜 정책 셋
const real = {};
for (const [n, p] of Object.entries(MAP_POLICIES)) { if (n === "무작위") continue; real[n] = []; for (let i=1;i<=RUNS;i++) real[n].push(play(p, i)); }
judge("진짜 정책 셋", real);

// ② 귀무: 같은 정책, 겹치지 않는 시드 블록 셋
const one = MAP_POLICIES["전투만"];
const nul = { A: [], B: [], C: [] };
for (let i=1;i<=RUNS;i++) nul.A.push(play(one, i));
for (let i=1;i<=RUNS;i++) nul.B.push(play(one, i+1000));
for (let i=1;i<=RUNS;i++) nul.C.push(play(one, i+2000));
judge("귀무: 같은 정책 · 다른 시드", nul);
