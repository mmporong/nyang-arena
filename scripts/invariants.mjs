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
import { stepBattle } from "../src/game/battle.ts";
import { newRun, startBattle, unitCap, currentKind } from "../src/game/run.ts";
import { BOARD_COLS, BOARD_ROWS, livingCats } from "../src/game/types.ts";
import { isBossStep, STAGE_STEPS } from "../src/game/map.ts";
import { makeBossBot, walkMap, leaveShop, shopStep, MAP_POLICIES } from "./bot-policy.mjs";

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
  const all = [...s.ally, ...s.enemy].filter(Boolean);
  const uids = new Set();

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
