/**
 * 목표(시너지) 난이도 라벨의 실측 검증.
 *
 * `synergy-schema.ts`의 `TRIGGER_DIFFICULTY`는 **실측 라벨**이다 — 계산 모형을
 * 두 번 세웠고 두 번 다 실측이 부정해서 라벨을 측정에 직접 묶었다. 그 라벨이
 * 낡았는지 재는 것이 이 스크립트다. 로스터·상점·자동 배치가 바뀌면 달성률이
 * 움직이는데, 라벨은 하드코딩이라 아무도 모르게 어긋난다.
 *
 * 잰다: 전투 시작 시점에 각 난이도의 목표가 활성인 비율(500런).
 * 판정: easy > medium > hard 층이 유지되는가 (경계는 5%p 여유).
 *
 * 실행: npm run tiers  (관문 아님 — measure-all에 안 들어간다. 라벨을 만졌거나
 * 상점·명단·자동 배치를 바꿨을 때 돌려서 주석의 수치를 갱신할 것)
 */
import { newRun, startBattle, leaveShop } from "../src/game/run.ts";
import { triggerDifficulty } from "../src/validate/synergy-schema.ts";
import { stepBattle } from "../src/game/battle.ts";
import { walkMap, shopStep, makeBossBot } from "./bot-policy.mjs";

const RUNS = Number(process.argv[2] ?? 500);
const FROM = Number(process.argv[3] ?? 1);
const on = { easy: 0, medium: 0, hard: 0 };
const tot = { easy: 0, medium: 0, hard: 0 };

for (let seed = FROM; seed < FROM + RUNS; seed++) {
  const s = newRun(seed);
  const bot = makeBossBot();
  const st = { rerolls: 0, lastWave: 0 };
  let guard = 0;
  while (s.phase !== "gameover" && guard++ < 200000) {
    if (s.wave > 30) break;
    if (s.phase === "map") { walkMap(s); continue; }
    if (s.phase === "reward" || s.phase === "prepare") {
      if (shopStep(s, st) === "leave") {
        leaveShop(s);
        if (s.phase === "prepare") {
          startBattle(s); // applySynergies가 여기서 돈다
          for (const rule of s.synergies) {
            const d = triggerDifficulty(rule.trigger);
            tot[d] += 1;
            if (s.activeSynergyIds.has(rule.id)) on[d] += 1;
          }
        }
      }
      continue;
    }
    if (s.phase !== "battle") break;
    bot(s);
    stepBattle(s, 100);
  }
}

const rate = {};
for (const d of ["easy", "medium", "hard"]) {
  rate[d] = tot[d] ? (on[d] / tot[d]) * 100 : NaN;
  console.log(`${d.padEnd(7)} 전투 시작 시점 활성 ${on[d]}/${tot[d]} = ${rate[d].toFixed(1)}%`);
}

const MARGIN = 5; // 잡음 대비 여유(%p). 이보다 좁으면 층이라 부를 수 없다.
const ok = rate.easy - rate.medium >= MARGIN && rate.medium - rate.hard >= MARGIN;
console.log(
  ok
    ? `\n판정: 층이 유지된다 (easy−medium ${(rate.easy - rate.medium).toFixed(1)}%p · medium−hard ${(rate.medium - rate.hard).toFixed(1)}%p)`
    : "\n판정: 층이 무너졌다 — TRIGGER_DIFFICULTY 라벨이나 원인(상점·명단·배치)을 다시 볼 것",
);
process.exit(ok ? 0 : 1);
