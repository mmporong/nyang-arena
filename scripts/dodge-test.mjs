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
import { walkMap, leaveShop } from "./bot-policy.mjs";
import { isBossStep, STAGE_STEPS } from "../src/game/map.ts";
import { buildEnemyWave, makeCat, newRun, startBattle, currentKind } from "../src/game/run.ts";
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
  // 보스 **걸음**을 찾는다. 웨이브 번호가 아니라 걸음이 보스를 정하므로
  // (상점 칸이 걸음만 먹어서 둘이 어긋난다) 걸음을 직접 맞춘다.
  let bossStep = 2;
  for (let i = 0; i < STAGE_STEPS; i++) {
    s.step = i;
    if (isBossStep(i)) {
      bossStep = i;
      break;
    }
  }
  s.step = bossStep;
  s.wave = bossStep + 1;
  walkMap(s);
  // 길을 고르면 상점이 열린다. 이 테스트는 사는 것을 재지 않으므로 그냥 나선다.
  leaveShop(s);
  if (currentKind(s) !== "boss") throw new Error("보스 걸음을 못 찾았다");
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
    const fuseAtPress = tg.fuse;
    stepBattle(s, 100);

    // 개입은 순간이동이 아니라 **달리기**다. 그래서 계약은 "한 스텝 만에
    // 나온다"가 아니라 "예고가 터지기 전에 나온다"여야 한다. 여기서 한 스텝을
    // 요구하면 순간이동으로만 통과하는 검사가 되고, 그건 우리가 방금 없앤 것이다.
    let ms = 100;
    while (inside.some((c) => c.alive && inTelegraph(tg, c.fx, c.fy)) && ms < fuseAtPress) {
      stepBattle(s, 100);
      ms += 100;
    }
    const stillInside = inside.filter((c) => c.alive && inTelegraph(tg, c.fx, c.fy));
    check("구간 안의 고양이가 예고가 터지기 전에 빠져나온다", stillInside.length === 0,
      `${inside.length} → ${stillInside.length}, ${ms}ms 걸림 (도화선 ${fuseAtPress}ms)`);
    // `c.alive &&`로 거르므로 **구간 안에서 죽으면 빠져나온 것으로 세어진다.**
    // 그 구멍을 따로 막는다 — 전원이 장판에서 몰살당해도 위 검사는 통과한다.
    const died = inside.filter((c) => !c.alive);
    check("빠져나오다 죽은 고양이는 없다", died.length === 0, `${died.length}마리 사망`);
    // 도화선을 거의 다 쓰면 사람이 조금만 늦게 눌러도 못 빠져나온다.
    check("빠져나오는 데 도화선의 절반을 넘기지 않는다", ms <= fuseAtPress / 2,
      `${ms}ms / ${fuseAtPress}ms`);

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

// ── 5. 순간이동이 아니라 달리기다 ─────────────────────────────
/**
 * 위 검사들은 **전부 순간이동으로도 통과한다.** 도착 시점만 보기 때문이다.
 * 그래서 좌표가 여러 프레임에 나뉘어 움직였는지를 따로 묶는다.
 *
 * 브라우저 프레임 간격(16ms)으로 돌린다. `stepBattle`은 받은 dt를 그대로
 * 서브스텝으로 쓰므로 이게 실제 화면에서 일어나는 일이다.
 */
{
  const r = bossFightWithTelegraph(clustered);
  if (r) {
    const { s } = r;
    const before = new Map(s.ally.filter((c) => c?.alive).map((c) => [c.uid, { x: c.fx, y: c.fy }]));
    s.pending.push({ kind: "dodge" });

    let frames = 0;
    let biggest = 0; // 한 프레임에 움직인 최대 거리
    const prev = new Map([...before].map(([k, v]) => [k, { ...v }]));
    for (let i = 0; i < 80; i++) {
      stepBattle(s, 16);
      if (s.phase !== "battle") break;
      frames += 1;
      let anyDashing = false;
      for (const c of s.ally) {
        if (!c?.alive) continue;
        const p = prev.get(c.uid);
        if (!p) continue;
        biggest = Math.max(biggest, Math.hypot(c.fx - p.x, c.fy - p.y));
        prev.set(c.uid, { x: c.fx, y: c.fy });
        if (c.dash) anyDashing = true;
      }
      if (!anyDashing && i > 0) break;
    }

    // 가장 멀리 간 고양이의 총 이동 거리
    let total = 0;
    for (const c of s.ally) {
      if (!c?.alive) continue;
      const p = before.get(c.uid);
      if (p) total = Math.max(total, Math.hypot(c.fx - p.x, c.fy - p.y));
    }

    check("개입 이동이 여러 프레임에 나뉜다", frames >= 3, `${frames}프레임`);
    // 한 프레임에 총 이동의 절반 이상을 갔으면 사실상 순간이동이다.
    check("한 프레임에 통째로 옮기지 않는다", total < 0.05 || biggest < total * 0.5,
      `총 ${total.toFixed(2)}칸 · 한 프레임 최대 ${biggest.toFixed(3)}칸`);
  }
}

// ── 6. 못 갈 거리면 차지를 쓰지 않는다 ────────────────────────
/**
 * 이동에 시간이 걸리게 되면서 새로 생긴 실패다. 도화선이 얼마 안 남았을 때
 * 누르면 출발은 하는데 터질 때까지 못 빠져나온다 — 그때도 차지를 쓰면
 * **한정 자원만 날리고 아무 일도 안 일어난다.** 순간이동 시절에는 없던 일이라
 * 회귀로 보고 막았고, 계약으로 묶어 둔다.
 */
{
  for (const [forced, shouldSpend] of [[1200, true], [60, false]]) {
    const r = bossFightWithTelegraph(clustered);
    if (!r) continue;
    const { s, boss } = r;
    boss.telegraph.fuse = forced;
    const before = s.dodgeCharges;
    s.pending.push({ kind: "dodge" });
    stepBattle(s, 100);
    const spent = s.dodgeCharges < before;
    check(
      shouldSpend ? "갈 수 있으면 차지를 쓴다" : "못 갈 거리면 차지를 아낀다",
      spent === shouldSpend,
      `도화선 ${forced}ms · ${before} → ${s.dodgeCharges}`,
    );
  }
}

console.log(failed === 0 ? "\n전부 통과 — 회피는 위험 구간만 비우고, 비운 채로 유지된다" : `\n${failed}건 실패`);
process.exit(failed === 0 ? 0 : 1);
