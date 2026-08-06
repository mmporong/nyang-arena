/**
 * 회피 동작 검사.
 *
 * 리뷰가 짚은 함정이 여기 있다 — 회피 직후 한 틱만 단언하면 테스트는 통과하는데
 * 플레이에서는 실패한다. 빼낸 고양이가 다음 틱부터 목표를 향해 걸어 돌아가기
 * 때문이다(도적은 0.6초면 위험 구간에 재진입한다). 그래서 **회피 후 일정 시간
 * 동안** 안전한지까지 본다.
 *
 * 판정은 전부 battle.ts의 `inTelegraph`를 그대로 쓴다. 여기서 기하를 다시
 * 구현하면 보이는 곳과 맞는 곳이 갈라진다.
 *
 * 실행: npm run dodge:test
 */
import { inTelegraph, stepBattle } from "../src/game/battle.ts";
import { buildEnemyWave, makeCat, newRun, startBattle, waveKind } from "../src/game/run.ts";
import { breedById } from "../src/game/breeds.ts";
import { emptyBoard } from "../src/game/types.ts";

let failed = 0;

function check(name, ok, detail = "") {
  if (!ok) failed += 1;
  console.log(`  ${ok ? "OK  " : "실패"} ${name}${detail ? `  — ${detail}` : ""}`);
}

/** 보스 웨이브를 만들고 예고가 뜰 때까지 돌린다. */
function bossFightWithTelegraph(arrange) {
  const s = newRun(1);
  // 보스 웨이브를 **찾는다**. 번호를 박아 두면 주기를 바꿀 때 조용히 깨진다 —
  // 실제로 보스를 5웨이브마다에서 3웨이브마다로 옮겼을 때 이 테스트가 저격
  // 웨이브를 보스로 알고 400틱 동안 예고를 기다렸다.
  let bossWave = 3;
  for (let w = 1; w <= 30; w++) {
    if (waveKind(w) === "boss") {
      bossWave = w;
      break;
    }
  }
  s.wave = bossWave;
  s.phase = "prepare";
  s.ally = emptyBoard();
  arrange(s);
  // 웨이브 번호만 바꾸면 적은 여전히 1웨이브 것이다. 다시 만들어야 보스가 나온다.
  buildEnemyWave(s);
  startBattle(s);

  // 예고가 뜬 것만으로는 부족하다. **위험 구간 안에 아군이 실제로 들어간**
  // 순간을 잡아야 회피가 할 일이 있다.
  for (let i = 0; i < 600; i++) {
    stepBattle(s, 100);
    if (s.phase !== "battle") return null;
    const boss = s.enemy.find((c) => c?.telegraph);
    if (!boss?.telegraph) continue;
    const inside = s.ally.filter((c) => c?.alive && inTelegraph(boss.telegraph, c.fx, c.fy));
    if (inside.length > 0) return { s, boss };
  }
  return null;
}

/** 아군 다섯을 한 칸에 몰아 둔다 — 어떤 예고든 대부분이 걸린다. */
function clustered(s) {
  [10, 11, 12, 16, 6].forEach((cell, i) => {
    s.ally[cell] = makeCat(breedById((i % 8) + 1), "ally", cell);
  });
}

console.log("회피 동작 검사\n");

// ── 1. 위험 구간 안의 고양이가 빠져나온다 ──────────────────────
{
  const r = bossFightWithTelegraph(clustered);
  if (!r) {
    check("예고가 뜬다", false, "400틱 안에 예고가 안 떴다");
  } else {
    const { s, boss } = r;
    const tg = boss.telegraph;
    const inside = s.ally.filter((c) => c?.alive && inTelegraph(tg, c.fx, c.fy));
    const outside = s.ally.filter((c) => c?.alive && !inTelegraph(tg, c.fx, c.fy));
    const charges = s.dodgeCharges;

    check("위험 구간 안에 아군이 있는 순간을 잡는다", inside.length > 0, `${tg.shape}, 안에 ${inside.length}마리`);

    s.pending.push({ kind: "dodge" });
    stepBattle(s, 100);

    const stillInside = inside.filter((c) => c.alive && inTelegraph(tg, c.fx, c.fy));
    check("구간 안의 고양이가 빠져나온다", stillInside.length < inside.length,
      `${inside.length} → ${stillInside.length}`);

    // 위치로 비교하면 안 된다. 같은 스텝에 평범한 걸음도 일어나므로 회피가
    // 옮긴 것과 걸어간 것을 구분할 수 없다. moveLock은 회피만 남기는 흔적이다.
    const wronglyDodged = outside.filter((c) => c.moveLock > 0);
    check("구간 밖 고양이는 회피 대상이 아니다", wronglyDodged.length === 0,
      `${wronglyDodged.length}마리가 회피 처리됨`);

    check("회피 횟수가 하나 줄었다", s.dodgeCharges === charges - 1, `${charges} → ${s.dodgeCharges}`);
  }
}

// ── 2. 되돌아가지 않는다 (moveLock) ────────────────────────────
{
  const r = bossFightWithTelegraph(clustered);
  if (r) {
    const { s, boss } = r;
    const tg = { ...boss.telegraph };
    s.pending.push({ kind: "dodge" });
    stepBattle(s, 100);
    const dodged = s.ally.filter((c) => c?.alive && c.moveLock > 0);

    // 1.2초 뒤(예고가 터지는 시점)까지 되돌아가지 않아야 한다
    let reentered = 0;
    for (let i = 0; i < 12; i++) {
      stepBattle(s, 100);
      for (const c of dodged) if (c.alive && inTelegraph(tg, c.fx, c.fy)) reentered += 1;
    }
    check("회피 후 예고가 터질 때까지 재진입하지 않는다", reentered === 0,
      `${dodged.length}마리 중 재진입 ${reentered}회`);
  }
}

// ── 3. 차지가 없으면 아무 일도 없다 ────────────────────────────
{
  const r = bossFightWithTelegraph(clustered);
  if (r) {
    const { s } = r;
    s.dodgeCharges = 0;
    const before = s.ally.filter(Boolean).map((c) => `${c.fx.toFixed(2)},${c.fy.toFixed(2)}`).join("|");
    s.pending.push({ kind: "dodge" });
    stepBattle(s, 100);
    // 전투가 계속 도니 위치는 바뀔 수 있다. 차지가 음수로 내려가지 않는 것만 본다.
    check("차지가 0이면 소비되지 않는다", s.dodgeCharges === 0, `남은 ${s.dodgeCharges}`);
    void before;
  }
}

// ── 4. 큐 상한 ────────────────────────────────────────────────
{
  const r = bossFightWithTelegraph(clustered);
  if (r) {
    const { s } = r;
    for (let i = 0; i < 50; i++) s.pending.push({ kind: "dodge" });
    const startCharges = s.dodgeCharges;
    stepBattle(s, 100);
    check("한 스텝에 의도를 하나만 소비한다", startCharges - s.dodgeCharges <= 1,
      `${startCharges} → ${s.dodgeCharges}`);
    check("큐가 상한을 넘지 않는다", s.pending.length <= 4, `${s.pending.length}개 남음`);
  }
}

console.log(failed === 0 ? "\n전부 통과 — 회피는 위험 구간만 비우고, 비운 채로 유지된다" : `\n${failed}건 실패`);
process.exit(failed === 0 ? 0 : 1);
