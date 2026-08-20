/**
 * 불변식 검사 — 300판을 돌리며 **절대 깨지면 안 되는 것**을 매 스텝 확인한다.
 *
 * 실행: npm run invariants
 *
 * 관문의 다른 스크립트는 "게임이 재미있는가"를 재고, 이건 "게임이 망가지지
 * 않았는가"를 본다. 밸런스 판정이 전부 초록이어도 체력이 음수가 되거나
 * 고양이가 판 밖에 서 있을 수 있고, 그건 수치로는 안 드러난다.
 *
 * 사람이 못 보는 자리를 노린다 — 한 판을 눈으로 보면 몇 백 스텝이지만
 * 여기서는 수십만 스텝을 본다. 처음 깨진 자리에서 시드와 웨이브를 함께
 * 남기므로 재현이 바로 된다.
 */
import { creepZones, stepBattle, sweepZones, SUMMON_CAP } from "../src/game/battle.ts";
import * as RUN from "../src/game/run.ts";
import { newRun, startBattle, unitCap, currentKind } from "../src/game/run.ts";
import { BOARD_COLS, BOARD_ROWS, livingCats } from "../src/game/types.ts";
import { isBossStep, STAGE_STEPS } from "../src/game/map.ts";
import { makeBossBot, walkMap, leaveShop, shopStep, MAP_POLICIES } from "./bot-policy.mjs";
/**
 * 소환 사양 **전부**에서 뽑는다. 전에는 유물 둘(분신·새끼)만 봤는데, 소환사
 * 셋이 들어오면서 그 계산에 안 들어갔다 — 지금은 전부 20초 미만이라 우연히
 * 통과했을 뿐이고, 유물 쪽 수명을 낮추면 거짓 실패가 났다.
 */
const MAX_SUMMON_LIFE_MS = Math.max(
  ...Object.values(RUN)
    .filter((v) => v && typeof v === "object" && typeof v.lifeMs === "number")
    .map((v) => v.lifeMs),
);

const RUNS = Number(process.argv[2] ?? 300);
const MAX_WAVE = 60;

/** 깨진 것 하나당 한 번만 보고한다. 같은 결함이 수천 번 찍히면 목록을 못 읽는다. */
const seen = new Map();
function fail(name, detail) {
  if (seen.has(name)) {
    seen.get(name).count += 1;
    return;
  }
  seen.set(name, { detail, count: 1 });
}

/** 유한한 수인가. NaN·Infinity가 좌표에 들어가면 화면에서 고양이가 사라진다. */
const finite = (v) => typeof v === "number" && Number.isFinite(v);

function check(s, where) {
  const all = [...s.ally, ...s.enemy, ...s.summons].filter(Boolean);
  const uids = new Set();

  // 소환수는 전투 안에서만 산다. 밖으로 새면 다음 판이 지난 판의 분신과
  // 함께 시작하고, 그 분신은 이미 사라진 주인을 uid로 가리킨다.
  if (s.phase !== "battle" && s.summons.length > 0) {
    fail("전투 밖에 소환수가 남았다", `${where} ${s.summons.length}마리`);
  }
  /**
   * N1. 상주 장판(creep)도 같은 이유로 전투 안에서만 산다.
   *
   * `creepZones`는 battle.ts의 모듈 전역이라 `s`(RunState)에 안 묶인다 —
   * `stepBattle`이 전투가 끝나는 두 지점(전멸 판정·타임아웃) 모두에서
   * `finishWave`보다 먼저 명시적으로 비운다. 여기서 못 잡으면 그 보장이
   * 조용히 깨져도 300판 6만 스텝을 눈으로 볼 방법이 없다.
   */
  if (s.phase !== "battle" && creepZones.length > 0) {
    fail("전투 밖에 상주 장판이 남았다", `${where} ${creepZones.length}개`);
  }
  /**
   * N2. 순차 스윕(sweep) 대기열도 같은 이유로 전투 안에서만 산다.
   *
   * `sweepZones`도 battle.ts의 모듈 전역이라 `s`에 안 묶인다 — `stepBattle`이
   * 전투가 끝나는 두 지점(전멸 판정·타임아웃)과 `clearBattleFx`에서
   * `clearSweepQueue`로 비운다(N1과 같은 계약).
   */
  if (s.phase !== "battle" && sweepZones.length > 0) {
    fail("전투 밖에 순차 스윕 대기열이 남았다", `${where} ${sweepZones.length}개`);
  }
  for (const side of ["ally", "enemy"]) {
    const n = s.summons.filter((c) => c.side === side).length;
    if (n > SUMMON_CAP) fail("소환수가 상한을 넘었다", `${where} ${side} ${n}/${SUMMON_CAP}`);
  }
  for (const sm of s.summons) {
    if (!sm.summon) fail("소환수인데 summon이 비었다", `${where} ${sm.breed.name}`);
    else if (sm.summon.lifeMs > MAX_SUMMON_LIFE_MS) {
      fail("소환수 수명이 한도를 넘는다", `${where} ${sm.summon.lifeMs}ms`);
    }
    // 진영은 둘 다 정상으로 둔다. 지금 악몽 명단에는 소환사가 없어 적
    // 소환수는 안 생기지만, 나중에 생겨도 이 검사가 그대로 맞아야 한다.
    // 대신 **보드와 진영이 어긋나면 안 된다**: 전투 계산이 `side`로 편을
    // 가르므로, 여기가 틀어지면 적 소환수가 우리를 위해 싸운다.
    if (sm.side !== "ally" && sm.side !== "enemy") {
      fail("소환수 진영이 이상하다", `${where} ${sm.side}`);
    }
    if (!(sm.sizeMul > 0 && sm.sizeMul < 1)) {
      fail("소환수가 작지 않다", `${where} sizeMul=${sm.sizeMul}`);
    }
    // 보드에 끼어 있으면 보유 한도·시너지·전멸 판정에 섞인다.
    if (s.ally.includes(sm) || s.enemy.includes(sm)) {
      fail("소환수가 보드에 들어갔다", `${where} ${sm.uid}`);
    }
  }

  for (const c of all) {
    const who = `${c.breed.name}(${c.side})`;
    if (uids.has(c.uid)) fail("uid 중복", `${where} ${who}`);
    uids.add(c.uid);

    if (!finite(c.hp) || !finite(c.maxHp)) fail("체력이 유한하지 않다", `${where} ${who} hp=${c.hp}/${c.maxHp}`);
    else {
      if (c.hp < 0) fail("체력이 음수다", `${where} ${who} hp=${c.hp}`);
      if (c.hp > c.maxHp) fail("체력이 최대를 넘는다", `${where} ${who} ${c.hp}/${c.maxHp}`);
      // 살아 있음과 체력이 어긋나면 화면과 판정이 갈린다.
      if (c.alive && c.hp <= 0) fail("죽었는데 살아 있다고 표시", `${where} ${who} hp=${c.hp}`);
      if (!c.alive && c.hp > 0) fail("살았는데 죽었다고 표시", `${where} ${who} hp=${c.hp}`);
    }

    // 죽은 보스의 예고가 남으면 화면에 유령 장판이 그려지고, blink가 남으면
    // 반쯤 사라진 채 얼어붙는다. 영상 검수에서 실제로 잡힌 버그라 불변식으로 박는다.
    if (!c.alive && c.telegraph) fail("죽었는데 예고가 남아 있다", `${where} ${who}`);
    // 극성(polarity)의 두 번째 동시 예고도 같은 이유로 검사한다.
    if (!c.alive && c.telegraph2) fail("죽었는데 예고2(극성)가 남아 있다", `${where} ${who}`);
    if (!c.alive && c.blink) fail("죽었는데 blink가 남아 있다", `${where} ${who}`);
    /**
     * US-403(표식)·US-404(최종 국면) 잔존 검사.
     *
     * 표식(`seized`)은 아군에게, 최종 국면(`finalPhase`)은 보스에게만 붙는
     * 상태다. 죽으면 그 역할이 끝나야 한다 — `battle.ts`의 tickEffects·
     * fireTelegraph seize 분기·stepBattle의 매 스텝 짝 확인이 이걸 보장하는
     * 코드고, 여기는 그 보장이 실제로 지켜지는지 300판·수십만 스텝으로 확인한다.
     */
    if (!c.alive && c.seized) fail("죽었는데 표식(seize)이 남아 있다", `${where} ${who}`);
    if (!c.alive && c.finalPhase) fail("죽었는데 최종 국면(finalPhase)이 남아 있다", `${where} ${who}`);
    // 전투 밖에서는 둘 다 있어서는 안 된다 — 표식은 아군이 웨이브를 넘어
    // 사는 몸이라 흘리면 다음 전투까지 새고, finalPhase는 게임 전체 1회
    // 연출이라 살아 있는 채로 전투를 나가면 다음 화면에서도 어두워진 채
    // 남는다.
    if (s.phase !== "battle" && c.seized) fail("전투 밖에 표식(seize)이 남았다", `${where} ${who}`);
    if (s.phase !== "battle" && c.finalPhase) fail("전투 밖에 최종 국면(finalPhase)이 남았다", `${where} ${who}`);

    if (!finite(c.fx) || !finite(c.fy)) fail("좌표가 유한하지 않다", `${where} ${who} (${c.fx},${c.fy})`);
    else if (c.fy < -1 || c.fy > BOARD_ROWS || c.fx < -1 || c.fx > BOARD_COLS * 2 + 2) {
      fail("고양이가 판 밖으로 나갔다", `${where} ${who} (${c.fx.toFixed(1)},${c.fy.toFixed(1)})`);
    }

    if (c.dash && (!finite(c.dash.tx) || !finite(c.dash.ty) || !finite(c.dash.speed) || c.dash.speed <= 0)) {
      fail("달리기 목표가 이상하다", `${where} ${who} ${JSON.stringify(c.dash)}`);
    }
    if (!c.alive && c.dash) fail("죽은 고양이가 달리는 중", `${where} ${who}`);

    if (!finite(c.mana) || c.mana < 0 || c.mana > c.manaMax) fail("마나가 범위를 벗어난다", `${where} ${who} ${c.mana}/${c.manaMax}`);
    if (c.level < 1) fail("레벨이 1 미만", `${where} ${who} lv=${c.level}`);
  }

  if (!finite(s.gold) || s.gold < 0) fail("생선이 음수다", `${where} gold=${s.gold}`);
  if (s.dodgeCharges < 0) fail("회피 차지가 음수다", `${where} ${s.dodgeCharges}`);
  if (s.actCooldown < 0) fail("쿨다운이 음수다", `${where} ${s.actCooldown}`);
  if (s.bonusDodge < 0) fail("여분 회피가 음수다", `${where} ${s.bonusDodge}`);

  const ids = s.relics.map((r) => r.id);
  if (new Set(ids).size !== ids.length) fail("유물이 중복된다", `${where} ${ids.join(",")}`);

  const owned = s.ally.filter(Boolean).length;
  if (owned > unitCap(s.wave)) fail("보유 한도를 넘었다", `${where} ${owned}/${unitCap(s.wave)} (웨이브 ${s.wave})`);

  if (s.step < 0 || s.step >= STAGE_STEPS) fail("걸음이 범위를 벗어난다", `${where} step=${s.step}`);

  // 보스는 지도가 정한 자리에만 선다. 어긋나면 "지도에 없는 보스"가 나온다.
  if (s.phase === "battle") {
    const hasBoss = s.enemy.some((c) => c?.radius > 0 && c.breed.cost === 0 && c.breed.id <= 11);
    if (hasBoss && !isBossStep(s.step)) fail("보스가 보스 걸음이 아닌 곳에 있다", `${where} step=${s.step}`);
  }

  // 우리 보드에 적이, 적 보드에 아군이 들어가면 타겟팅이 통째로 뒤집힌다.
  for (const c of s.ally) if (c && c.side !== "ally") fail("우리 보드에 적이 있다", `${where} ${c.breed.name}`);
  for (const c of s.enemy) if (c && c.side !== "enemy") fail("적 보드에 아군이 있다", `${where} ${c.breed.name}`);
}

let steps = 0;
for (let seed = 1; seed <= RUNS; seed++) {
  const s = newRun(seed);
  const respond = makeBossBot();
  const shop = { rerolls: 0, lastWave: 0 };
  let lastWave = 0;
  let guard = 0;

  while (guard++ < MAX_WAVE * 4000) {
    const where = `시드${seed} W${s.wave} ${s.phase}`;
    check(s, where);
    steps += 1;

    if (s.phase === "gameover") break;
    if (s.phase === "reward") {
      if (shopStep(s, shop) !== "leave") continue;
      leaveShop(s);
      continue;
    }
    if (s.phase === "map") {
      walkMap(s, MAP_POLICIES["무작위"]);
      continue;
    }
    if (s.phase === "prepare") {
      if (s.wave > MAX_WAVE) break;
      // 웨이브는 되돌아가지 않는다. 되감기면 보스 순번이 어긋난다.
      if (s.wave < lastWave) fail("웨이브가 되감겼다", `${where} ${lastWave} → ${s.wave}`);
      lastWave = s.wave;
      void currentKind(s);
      startBattle(s);
      continue;
    }
    respond(s);
    stepBattle(s, 100);
  }
}

{
  /**
   * 스테이지 테마와 보스 조합의 정합 — 길이 비교가 아니라 **성질**을 잰다.
   * 길이 비교(테마 3 vs 보스 3)는 BOSSES_PER_STAGE가 3으로 바뀌는 위반을
   * 조용히 통과시켰다(리뷰 귀무모형 적발). 강제 씬을 가진 스테이지의 보스
   * 조합을 스냅으로 박아, 명단·걸음 수·테마 어느 쪽이 바뀌어도
   * "잿불 밤에 서리귀가 선다" 같은 어긋남이 여기서 빨간불이 된다.
   */
  const { STAGE_THEMES, stageTheme } = await import("../src/game/stages.ts");
  const { bossForIndex } = await import("../src/game/bosses.ts");
  const { BOSSES_PER_STAGE } = await import("../src/game/map.ts");
  // 테마 작성 시점의 보스 조합. 의도적으로 조합을 바꿨다면 이 스냅도 갱신할 것.
  const SNAP = { 1: [9, 10], 2: [9, 11], 3: [10, 11] };
  for (const [stageStr, want] of Object.entries(SNAP)) {
    const stage = Number(stageStr);
    if (!stageTheme(stage).backdropScene) continue; // 강제 씬이 없으면 무관
    for (let cycle = 0; cycle < 3; cycle++) {
      const s2 = stage + cycle * STAGE_THEMES.length;
      const got = Array.from({ length: BOSSES_PER_STAGE }, (_, o) =>
        bossForIndex((s2 - 1) * BOSSES_PER_STAGE + o).id).sort();
      if (JSON.stringify(got) !== JSON.stringify([...want].sort())) {
        fail("강제 씬 스테이지의 보스 조합이 테마 작성 시점과 다르다",
          `스테이지 ${s2}: ${got.join(",")} (기대 ${want.join(",")}) — stages.ts 정합 계약 참조`);
      }
    }
  }
}

console.log(`불변식 검사 — 런 ${RUNS}회 · ${steps.toLocaleString()}스텝\n`);
if (seen.size === 0) {
  console.log(`전부 통과 — ${steps.toLocaleString()}스텝 동안 깨진 불변식 없음`);
  process.exit(0);
}
for (const [name, { detail, count }] of seen) {
  console.log(`  실패 ${name}  (${count}회)`);
  console.log(`       처음: ${detail}`);
}
console.log(`\n${seen.size}종 실패`);
process.exit(1);
