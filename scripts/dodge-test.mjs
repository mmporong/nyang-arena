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
import { clearBattleFx, creepZones, hazardsActive, inTelegraph, stepBattle, sweepZones } from "../src/game/battle.ts";
import { BALANCE } from "../src/game/balance.ts";
import { walkMap, leaveShop } from "./bot-policy.mjs";
import { isBossStep, STAGE_STEPS } from "../src/game/map.ts";
import { buildEnemyWave, makeCat, newRun, startBattle, currentKind } from "../src/game/run.ts";
import { breedById } from "../src/game/breeds.ts";
import { BOSS_BREEDS } from "../src/game/bosses.ts";
import { emptyBoard } from "../src/game/types.ts";

let failed = 0;

function check(name, ok, detail = "") {
  if (!ok) failed += 1;
  console.log(`  ${ok ? "OK  " : "실패"} ${name}${detail ? `  — ${detail}` : ""}`);
}

/** 보스 웨이브를 만들고 예고가 뜰 때까지 돌린다. */
/**
 * `bossBreedId` — 보스를 특정 품종으로 강제한다. 첫 보스 걸음의 킷이 avoid만
 * 쓰면 gather 표본이 영영 없으므로, 모임을 재려면 gather 킷(살금이 10)을
 * 직접 세워야 한다. 체력·공격은 원래 보스 것을 물려받아 스케일을 지킨다.
 */
/**
 * @param want 발동 시점을 잡을 예고를 고른다. 기본은 아무 예고나 — 특정
 *   패턴(순차 스윕 등)만 노리려면 `tg.fuseMax`처럼 그 패턴만 갖는 값으로
 *   가려낸다. 원하는 예고가 뜰 때까지 계속 지나친다.
 * @param respond 예고를 기다리는 동안 매 스텝 불린다. 기본은 아무것도 안
 *   한다(1~8절의 기존 계약 그대로) — 첫 예고만 있으면 충분했다. **순번이
 *   있는 패턴**(순차 스윕 등)처럼 두 번째 이상의 문턱을 기다려야 하면, 그
 *   전 문턱들을 안 피하고 지나칠 때 팀이 먼저 전멸할 수 있다. 그럴 때만
 *   반응 함수를 넘겨 앞선 예고를 스스로 피하게 한다.
 */
function bossFightWithTelegraph(arrange, seed = 1, bossBreedId = null, want = () => true, respond = () => {}) {
  const s = newRun(seed);
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
  if (bossBreedId !== null) {
    const i = s.enemy.findIndex((c) => c && c.radius > 0);
    if (i >= 0) {
      const prev = s.enemy[i];
      const bossBreed = BOSS_BREEDS.find((b) => b.id === bossBreedId);
      if (!bossBreed) throw new Error(`보스 명단에 없는 id: ${bossBreedId}`);
      const swapped = makeCat(bossBreed, "enemy", prev.cell);
      swapped.maxHp = prev.maxHp; swapped.hp = prev.hp;
      swapped.atk = prev.atk; swapped.radius = prev.radius;
      swapped.fx = prev.fx; swapped.fy = prev.fy;
      s.enemy[i] = swapped;
    }
  }
  startBattle(s);

  // 예고가 뜬 것만으로는 부족하다. **위험 구간 안에 아군이 실제로 들어간**
  // 순간을 잡아야 회피가 할 일이 있다.
  for (let i = 0; i < 600; i++) {
    respond(s);
    stepBattle(s, 100);
    if (s.phase !== "battle") return null;
    const boss = s.enemy.find((c) => c?.telegraph && want(c.telegraph));
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

    // 옮겨졌는지는 `dash`로 본다. 예전에는 moveLock을 흔적으로 썼는데,
    // 이제 **안전한 고양이도 붙잡는다**(장판 안으로 걸어 들어가지 않게)므로
    // moveLock은 "옮겨졌다"를 뜻하지 않는다. dash는 옮길 때만 붙는다.
    const wronglyMoved = outside.filter((c) => c.dash !== null);
    check("구간 밖 고양이는 자리를 옮기지 않는다", wronglyMoved.length === 0,
      `${wronglyMoved.length}마리가 옮겨짐`);
    // 대신 제자리에 붙잡혀야 한다. 안 그러면 1.2초 동안 평소처럼 보스를 향해
    // 걸어가다 장판 안으로 들어간다 — 계측에서 예고에 걸린 고양이의 22%가
    // 이 경우였고, 플레이어 입장에서는 분명히 눌렀는데 맞은 것이다.
    const notHeld = outside.filter((c) => c.moveLock <= 0);
    check("구간 밖 고양이는 제자리에 붙잡힌다", notHeld.length === 0,
      `${notHeld.length}마리가 안 잡힘`);

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

// ── 7. 도적 도약도 순간이동이 아니다 ──────────────────────────
/**
 * 이 게임에서 가장 큰 이동이다 — 개전 순간 여덟 칸을 건너 상대 뒷줄로 뛰어든다.
 * 회피를 달리기로 바꾸고도 여기만 `c.fx = to.fx`로 남아 있었다.
 *
 * 양쪽 도적을 다 본다. `tickDashes`에서 적을 빠뜨리면 적 도적이 허공에 멈춘다.
 */
{
  const s = newRun(11);
  [10, 11, 12, 16, 6].forEach((cell, i) => {
    s.ally[cell] = makeCat(breedById((i % 8) + 1), "ally", cell);
  });
  s.step = 0;
  s.wave = 4;
  s.nodeWave = "mixed";
  buildEnemyWave(s);
  startBattle(s);

  const rogues = [...s.ally, ...s.enemy].filter((c) => c?.alive && c.breed.cls === "rogue");
  const before = new Map(rogues.map((c) => [c.uid, { x: c.fx, y: c.fy }]));

  let frames = 0;
  let biggest = 0;
  const prev = new Map([...before].map(([k, v]) => [k, { ...v }]));
  for (let i = 0; i < 60; i++) {
    stepBattle(s, 16);
    if (s.phase !== "battle") break;
    frames += 1;
    let flying = false;
    for (const c of rogues) {
      if (!c.alive) continue;
      const p = prev.get(c.uid);
      if (!p) continue;
      biggest = Math.max(biggest, Math.hypot(c.fx - p.x, c.fy - p.y));
      prev.set(c.uid, { x: c.fx, y: c.fy });
      if (c.dash) flying = true;
    }
    if (!flying) break;
  }
  let total = 0;
  for (const c of rogues) {
    const p = before.get(c.uid);
    if (p && c.alive) total = Math.max(total, Math.hypot(c.fx - p.x, c.fy - p.y));
  }
  const stuck = rogues.filter((c) => c.alive && c.dash);

  check("도적이 있는 판을 잡는다", rogues.length > 0, `${rogues.length}마리`);
  check("도약이 여러 프레임에 나뉜다", frames >= 3, `${frames}프레임 · 총 ${total.toFixed(2)}칸`);
  check("한 프레임에 통째로 건너뛰지 않는다", total < 0.05 || biggest < total * 0.5,
    `한 프레임 최대 ${biggest.toFixed(3)}칸`);
  check("허공에 멈춘 도적이 없다 (양쪽 다 처리된다)", stuck.length === 0, `${stuck.length}마리 멈춤`);
}


// ── 8. 원버튼 계약 ────────────────────────────────────────────
/**
 * 화면은 `act` 하나만 보낸다. 세 가지를 묶는다.
 *  ⓐ 상황에 맞게 갈린다 (붉은 예고 → 흩어짐, 청록 → 뭉침, 취약 창 → 약점 공격)
 *  ⓑ 차지가 있으면 예고에 아무도 안 맞는다
 *  ⓒ 연타해도 차지는 하나만 나가고, 예고가 없으면 아예 안 나간다
 */
{
  // ⓐ·ⓑ — 예고가 뜬 순간 act 한 번
  const r = bossFightWithTelegraph(clustered);
  if (r) {
    const { s, boss } = r;
    const tg = boss.telegraph;
    s.dodgeCharges = 9; // 계약 검사이므로 자원 부족과 섞지 않는다
    s.pending.push({ kind: "act" });
    while (boss.telegraph && s.phase === "battle") stepBattle(s, 16);
    // 피해 판정과 같은 pad로 잰다 — pad=0으로 재면 실제보다 무른 기준이 된다.
    const caught = s.ally.filter(
      (c) =>
        c?.alive &&
        (tg.mode === "gather"
          ? !inTelegraph(tg, c.fx, c.fy, BALANCE.telegraphBodyPad)
          : inTelegraph(tg, c.fx, c.fy, BALANCE.telegraphBodyPad)),
    );
    check(`원버튼 한 번으로 ${tg.mode === "gather" ? "청록" : "붉은"} 예고를 아무도 안 맞는다`,
      caught.length === 0, `${caught.length}마리 걸림`);
  }

  // ⓒ — 예고가 없을 때 연타
  const r2 = bossFightWithTelegraph(clustered);
  if (r2) {
    const { s, boss } = r2;
    while (boss.telegraph && s.phase === "battle") stepBattle(s, 16);
    const before = s.dodgeCharges;
    for (let i = 0; i < 30; i++) { s.pending.push({ kind: "act" }); stepBattle(s, 16); }
    check("예고가 없으면 연타해도 차지가 안 나간다", s.dodgeCharges === before,
      `${before} → ${s.dodgeCharges}`);
  }

  // ⓒ — 한 예고 동안 연타
  const r3 = bossFightWithTelegraph(clustered);
  if (r3) {
    const { s, boss } = r3;
    s.dodgeCharges = 9;
    const before = s.dodgeCharges;
    let n = 0;
    while (boss.telegraph && s.phase === "battle" && n < 200) {
      s.pending.push({ kind: "act" }); stepBattle(s, 16); n += 1;
    }
    check("한 예고에 연타해도 차지는 하나만 나간다", before - s.dodgeCharges <= 1,
      `${n}번 눌러 ${before} → ${s.dodgeCharges}`);
  }

  // 약점 공격은 쿨다운과 무관해야 한다 — 연타가 곧 화력이다
  const r4 = bossFightWithTelegraph(clustered);
  if (r4) {
    const { s } = r4;
    let guard = 0;
    while (!s.enemy.some((c) => c?.alive && c.vulnerableMs > 0) && s.phase === "battle" && guard++ < 12000) {
      const tg = s.enemy.find((c) => c?.telegraph)?.telegraph;
      if (tg) s.pending.push({ kind: "act" });
      stepBattle(s, 16);
    }
    const boss = s.enemy.find((c) => c?.alive && c.radius > 0);
    if (boss && boss.vulnerableMs > 0) {
      const before = s.dodgeCharges;
      let taps = 0;
      while (boss.vulnerableMs > 0 && s.phase === "battle" && taps < 300) {
        s.pending.push({ kind: "act" }); stepBattle(s, 16); taps += 1;
      }
      check("취약 창에서는 쿨다운 없이 콤보가 쌓인다", boss.strikeCombo >= 5,
        `콤보 ${boss.strikeCombo} · 차지 ${before} → ${s.dodgeCharges}`);
    }
  }
}


// ── 9. 발동 시점 실효성 ──────────────────────────────────────
/**
 * "버튼이 제대로 작동하는가"를 눌린 직후가 아니라 **터지는 순간**으로 잰다.
 * 눌린 직후는 통과하는데 발동 때 도로 들어가 있으면 화면에서는 버튼이
 * 고장 난 것이다. 판정은 피해 판정과 같은 pad를 써서 화면·피해·검사가
 * 전부 같은 기하를 본다.
 *
 * 판 단위 성공(발동 시점에 잘못 선 고양이 0마리)의 비율로 판정한다.
 * 마리 단위 평균은 팀 크기에 따라 후해져서 판끼리 비교가 안 된다.
 */
{
  const PAD = BALANCE.telegraphBodyPad;
  const tallies = { avoid: { ok: 0, all: 0 }, gather: { ok: 0, all: 0 } };
  // 모드마다 그 모드를 확실히 쓰는 보스를 세운다 — 무쇠발톱(9)은 전부 avoid,
  // 살금이(10)는 첫 예고가 gather다. 자연 표본을 기다리면 청록이 영영 없다.
  const runs = [];
  for (let seed = 1; seed <= 40; seed++) runs.push([seed, 9], [seed, 10]);
  for (const [seed, breed] of runs) {
    const r = bossFightWithTelegraph(clustered, seed, breed);
    if (!r) continue;
    const { s, boss } = r;
    const tg = boss.telegraph;
    s.dodgeCharges = 9; // 실효성 검사이므로 자원 부족과 섞지 않는다
    s.pending.push({ kind: "act" });
    while (boss.telegraph && s.phase === "battle") stepBattle(s, 16);
    const wrong = s.ally.filter(
      (c) => c?.alive && (tg.mode === "gather" ? !inTelegraph(tg, c.fx, c.fy, PAD) : inTelegraph(tg, c.fx, c.fy, PAD)),
    );
    const t = tallies[tg.mode];
    t.all += 1;
    if (wrong.length === 0) t.ok += 1;
  }
  for (const [mode, t] of Object.entries(tallies)) {
    const name = mode === "gather" ? "청록(모임)" : "붉음(흩어짐)";
    if (t.all === 0) {
      // 첫 보스 걸음의 킷 구성에 따라 한쪽 모드가 표본에 없을 수 있다.
      // 그건 실패가 아니라 표본 부족이므로 사실만 적는다.
      console.log(`  표본 없음: ${name} — 첫 보스 걸음에 이 모드가 안 나왔다`);
      continue;
    }
    const rate = (t.ok / t.all) * 100;
    check(`${name} 예고: 발동 시점 성공률 90% 이상`, rate >= 90,
      `${t.ok}/${t.all}판 (${rate.toFixed(0)}%)`);
  }
}

// ── 10. 순차 스윕(sweep) 발동 시점 회피 ─────────────────────
/**
 * N4. 9절과 같은 방식(발동 순간 판정)을 **새 큐 구조(B3→C3)에 맞게 다시 짠다.**
 *
 * sweep은 더 이상 `boss.telegraph`에 안 산다 — 문턱 하나가 **파동 둘**(홀수
 * 행 묶음 → 짝수 행 묶음)을 한 번에 `sweepZones`(battle.ts의 모듈 전역,
 * `creepZones`와 같은 전례)에 예약하고, 그 뒤로는 보스의 판단과 무관하게
 * 스스로 돈다. `bossFightWithTelegraph`의 `want(c.telegraph)`는
 * `boss.telegraph`만 보므로 이제 sweep을 못 잡는다 — 이 절만 그 헬퍼를 안
 * 쓰고 `sweepZones`를 직접 본다.
 *
 * **한 파동에 행이 여럿(최대 3개, 예: 0·2·4)이다.** 그중 하나만 걸렸다고
 * 성공을 판정하면 안 된다 — 같은 파동의 나머지 행에 걸려 있어도 놓친다.
 * 그래서 캡처 시점의 파동 전체(`sweepZones`의 스냅샷)를 기억해 두고, 그
 * 파동이 통째로 꺼진 뒤 **행 전부**에 대해 무피해를 확인한다.
 *
 * "sweep 자체는 손대지 않는다"는 옛 respond의 조건문(`wantSweep` 예외)이
 * 새 구조에서는 공짜로 성립한다 — sweep이 도는 동안 `boss.telegraph`가
 * 계속 null이라 아래 act 조건(`s.enemy.some(c => c?.telegraph) || ...`)이
 * 저절로 꺼진다.
 */
{
  const PAD = BALANCE.telegraphBodyPad;
  let all = 0;
  let ok = 0;
  for (let seed = 1; seed <= 40; seed++) {
    /**
     * `sweepZones`(와 `creepZones`)는 battle.ts의 모듈 전역이라 `newRun`이
     * 안 건드린다 — 실제 게임은 전투가 끝날 때마다(finishWave 경로) 저절로
     * 비워지지만, 이 절은 sweep 행 하나가 터지는 순간 곧바로 다음 시드로
     * 넘어가 전투를 안 끝낸다. 안 비우면 이전 시드의 미완료 큐가 다음 시드로
     * 새어 들어간다(실측: 그대로 두면 40시드 중 26개가 엉뚱한 행에서 실패했다).
     */
    clearBattleFx();
    const s = newRun(seed);
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
    leaveShop(s);
    if (currentKind(s) !== "boss") continue;
    s.ally = emptyBoard();
    clustered(s);
    buildEnemyWave(s);
    // 무쇠발톱(9)으로 강제한다 — sweep을 쓰는 유일한 킷이다.
    const bi = s.enemy.findIndex((c) => c && c.radius > 0);
    if (bi >= 0) {
      const prev = s.enemy[bi];
      const bossBreed = BOSS_BREEDS.find((b) => b.id === 9);
      const swapped = makeCat(bossBreed, "enemy", prev.cell);
      swapped.maxHp = prev.maxHp;
      swapped.hp = prev.hp;
      swapped.atk = prev.atk;
      swapped.radius = prev.radius;
      swapped.fx = prev.fx;
      swapped.fy = prev.fy;
      s.enemy[bi] = swapped;
    }
    startBattle(s);

    // sweep이 뜨기 전까지는 act로 앞선 문턱(무쇠발톱 첫 자리 quake)을 스스로
    // 처리한다 — 그걸 넘겨야 sweep(둘째 자리)이 뜬다. 위험 구간 안에 아군이
    // 실제로 들어간 순간만 표본으로 잡는다(9절과 같은 기준).
    let wave = null; // 캡처 시점 파동 전체(행 여러 개)의 스냅샷
    const first = () => sweepZones[0] ?? null;
    for (let t = 0; t < 600 && s.phase === "battle" && !wave; t++) {
      if (
        s.dodgeCharges > 0 &&
        (s.enemy.some((c) => c?.telegraph) || s.enemy.some((c) => c?.alive && c.vulnerableMs > 0))
      ) {
        s.pending.push({ kind: "act" });
      }
      stepBattle(s, 100);
      if (sweepZones.length > 0) {
        const inside = s.ally.filter((c) => c?.alive && sweepZones.some((z) => inTelegraph(z, c.fx, c.fy)));
        if (inside.length > 0) wave = [...sweepZones];
      }
    }
    if (!wave) continue;

    s.dodgeCharges = 9; // 실효성 검사이므로 자원 부족과 섞지 않는다
    s.pending.push({ kind: "act" });
    // 이 파동(`wave`)이 터질 때까지만 돈다 — 터지면 `sweepZones`의 첫 원소가
    // 다음 파동으로 바뀌거나(참조가 달라짐) 큐가 빈다(길이 0), 둘 다
    // 아래 조건을 깬다.
    while (sweepZones.length > 0 && first() === wave[0] && s.phase === "battle") {
      stepBattle(s, 16);
    }
    // 파동에 속한 행 전부에 대해 무피해를 확인한다 — 하나만 보면 같은
    // 파동의 나머지 행에 걸린 것을 놓친다.
    const wrong = s.ally.filter((c) => c?.alive && wave.some((z) => inTelegraph(z, c.fx, c.fy, PAD)));
    all += 1;
    if (wrong.length === 0) ok += 1;
  }
  if (all === 0) {
    console.log("  표본 없음: 순차 스윕 — 40시드 안에 sweep 예고가 안 나왔다");
  } else {
    const rate = (ok / all) * 100;
    check("순차 스윕: 발동 시점 성공률 90% 이상", rate >= 90, `${ok}/${all}판 (${rate.toFixed(0)}%)`);
  }
}

// ── 11. hazardsActive — creep/sweep만 떠 있어도 참 (하네스 실명 재발 방지) ──
/**
 * 2차 반려 진단: "96.6%를 못 보는 봇으로 잰 수치는 '게임이 어려워졌다'와
 * '봇이 눈이 멀었다'를 구분하지 못한다." — creep·sweep은 `state.enemy[].
 * telegraph`가 아니라 battle.ts의 별도 배열(`creepZones`·`sweepZones`)에
 * 산다. `s.enemy.some(c => c?.telegraph)`만 보는 사본이 하나라도 다시
 * 생기면 그 사본은 이 스텝을 "위험 없음"으로 잘못 읽는다 — 이 절이 그
 * 사본 갈라짐을 관문에서 잡는다.
 *
 * 문턱을 강제로 옮겨서 잰다(자연 진행을 기다리지 않는다) — 도달 자체가
 * 아니라 "도달했을 때 hazardsActive가 참인가"만 재는 절이라, 몇백 스텝을
 * 태워 자연스럽게 그 지점까지 가는 것은 낭비다.
 */
{
  function forceHazard(bossId, thresholdIdx, hpFrac, extra) {
    let checked = 0;
    let ok = 0;
    for (let seed = 1; seed <= 40 && checked < 10; seed++) {
      clearBattleFx();
      const s = newRun(seed);
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
      leaveShop(s);
      if (currentKind(s) !== "boss") continue;
      s.ally = emptyBoard();
      clustered(s);
      buildEnemyWave(s);
      const bi = s.enemy.findIndex((c) => c && c.radius > 0);
      if (bi < 0) continue;
      const prev = s.enemy[bi];
      const bossBreed = BOSS_BREEDS.find((b) => b.id === bossId);
      const swapped = makeCat(bossBreed, "enemy", prev.cell);
      swapped.maxHp = prev.maxHp;
      swapped.hp = prev.hp;
      swapped.atk = prev.atk;
      swapped.radius = prev.radius;
      swapped.fx = prev.fx;
      swapped.fy = prev.fy;
      s.enemy[bi] = swapped;
      startBattle(s);
      const boss = s.enemy.find((c) => c && c.radius > 0);
      if (!boss) continue;
      boss.thresholdIdx = thresholdIdx;
      boss.vulnerableUsed = true;
      boss.hp = Math.round(boss.maxHp * hpFrac);
      if (extra) extra(boss);
      for (let t = 0; t < 60 && s.phase === "battle"; t++) {
        s.dodgeCharges = Math.max(s.dodgeCharges, 9);
        const active = bossId === 9 ? sweepZones.length > 0 : creepZones.length > 0;
        if (active && !s.enemy.some((c) => c?.telegraph)) {
          checked += 1;
          if (hazardsActive(s)) ok += 1;
          break;
        }
        if (s.enemy.some((c) => c?.telegraph) || s.enemy.some((c) => c?.alive && c.vulnerableMs > 0)) {
          s.pending.push({ kind: "act" });
        }
        stepBattle(s, 100);
      }
    }
    return { checked, ok };
  }

  // sweep: 무쇠발톱(9) phase1 패턴 [quake, sweep, gather, cone] — 인덱스1이 sweep.
  const sw = forceHazard(9, 1, 0.69);
  check(
    "hazardsActive: sweep만 떠 있어도(boss.telegraph는 null) 참",
    sw.checked > 0 && sw.ok === sw.checked,
    `${sw.ok}/${sw.checked}`,
  );

  // creep: 서리귀(11) phase2 패턴 [hearth, quake, hearth, creep] — 문턱 idx3(=인덱스3)이 creep.
  const cr = forceHazard(11, 3, 0.39, (boss) => {
    boss.phase2 = true;
  });
  check(
    "hazardsActive: creep만 떠 있어도(boss.telegraph는 null) 참",
    cr.checked > 0 && cr.ok === cr.checked,
    `${cr.ok}/${cr.checked}`,
  );
}

console.log(failed === 0 ? "\n전부 통과 — 회피는 위험 구간만 비우고, 비운 채로 유지된다" : `\n${failed}건 실패`);
process.exit(failed === 0 ? 0 : 1);
