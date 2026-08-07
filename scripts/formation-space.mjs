/**
 * 보스 원형마다 최적 대형이 다른가?
 *
 * 배치 축은 깊이가 0.2다(자동 11.3 vs 최선 11.5). 그런데 그 판정은 **상황을
 * 안 읽는 고정 대형 넷**을 비교해서 나온 값이다 — 구매 축에서 똑같은 실수를
 * 했다가 로스터를 읽는 정책을 넣으니 0.9가 2.5로 바뀌었다.
 *
 * 그래서 여기서는 다른 질문을 던진다. **보스가 누구냐에 따라 좋은 대형이
 * 달라지는가?** 달라진다면 "다음 보스를 보고 대형을 고른다"가 결정이 되고,
 * 안 달라진다면 대형 선택은 또 하나의 무의미한 버튼이 된다.
 *
 * ## 왜 판 진행이 아니라 통제된 아레나인가
 *
 * 보스 순환이 고정이라(1번째 무쇠발톱, 2번째 살금이, 3번째 서리귀) 판을
 * 진행시켜 재면 2·3번째 보스는 **거기까지 살아남은 런만** 표본에 들어간다.
 * 오늘 개입 측정에서 정확히 그 편향을 걷어냈다 — 비개입 봇의 W6 통과율이
 * W3보다 높게 나왔던 것이 증거였다.
 *
 * 그래서 판을 안 돌린다. 같은 팀, 같은 보스 체력·공격력을 주고 **원형(이동
 * 속도·사거리·기믹)과 대형만** 바꾼다. 이건 게임 전체가 아니라 한 장면이지만,
 * 지금 묻는 것이 정확히 그 한 장면이다.
 *
 * ## 개입을 켜고 끄고 두 번 잰다
 *
 * `doDodge`는 위험 구간 안의 고양이를 각자 안전한 칸으로 순간이동시킨다.
 * 즉 **개입이 대형을 지운다.** 그게 배치 깊이가 0표인 진짜 원인이라는 가설이
 * 있고, 켜고 끈 두 표를 비교하면 그 가설이 바로 판정된다.
 *
 * 실행: npm run formation
 */
import { stepBattle } from "../src/game/battle.ts";
import { makeCat, newRun, startBattle } from "../src/game/run.ts";
import { BOSS_BREEDS, BOSS_RADIUS, bossKit } from "../src/game/bosses.ts";
import { breedById } from "../src/game/breeds.ts";
import { BOARD_COLS, emptyBoard, livingCats } from "../src/game/types.ts";
import { BALANCE } from "../src/game/balance.ts";
import { makeBossBot } from "./bot-policy.mjs";

/** 호위로 쓸 품종. 근접 하나 원거리 하나 — 뒷줄이 위험해야 대형이 걸린다. */
const ESCORTS = [1, 8];

const RUNS = Number(process.argv[2] ?? 300);
const LEVEL = 3;
const WAVE = 6;

/**
 * 난이도는 **보스 체력**으로 맞춘다. 공격력이 아니다.
 *
 * 처음에는 공격력으로 맞추려 했는데 보정이 무쇠발톱 4000을 뱉었다. 실제 게임
 * 값이 11이니 360배다. 원인은 이렇다 — **보스의 위협은 평타가 아니라 예고**이고,
 * 예고 피해는 `battle.ts`에서 맞는 쪽 최대 체력의 비율로 들어간다:
 *
 *     frac = (telegraphDmgFirst + (telegraphDmg - telegraphDmgFirst) * ramp) * kit.power
 *     damage(f, f.maxHp * frac)          // boss.atk이 안 들어간다
 *
 * 게다가 `bossAtkMul = 0.28`로 평타를 일부러 죽여 놨다. 그래서 공격력을 올려도
 * 사거리 3.2인 서리귀만 세지고, 사거리 0.8에 이동 0.45인 무쇠발톱은 아예 안 닿아
 * 4000에서도 승률 90%가 나왔다. **틀린 손잡이였다.**
 *
 * 체력을 손잡이로 쓰면 전투가 길어지고 → 예고를 더 많이 맞고 → 난이도가 오른다.
 * 이건 게임 안에서 실제로 일어나는 경로(`bossHpMulFirst`→`bossHpMul` 램프)와 같다.
 */
const TARGET_WIN = 0.6;
/**
 * 보정도 측정과 **같은 표본**으로 한다.
 *
 * 40판으로 맞추고 120판으로 쟀더니 목표 60%가 88%로 흘렀다. 보정점이
 * 표본 잡음 위에 서 있으면 그 위에서 잰 표도 그만큼 흔들린다.
 */
const CAL_RUNS = Number(process.env.CAL_RUNS ?? RUNS);
/** 포화된 칸(0%·100%)은 대형 차이를 못 담는다. 판정에서 뺀다. */
/**
 * 회피 차지를 바꿔 볼 수 있게 연다.
 *
 * 기본 6인데 보스전 예고가 4~6회다. **정확히 전부 막을 수 있는 수다.** 개입하면
 * 예고를 다 피하고, 예고를 안 맞으면 어디에 서 있었는지가 무의미해진다 —
 * 배치 깊이가 0.2인 진짜 이유가 이것이라는 가설을 여기서 시험한다.
 */
const DODGE = process.env.DODGE ? Number(process.env.DODGE) : null;

const SAT_LO = 3;
const SAT_HI = 97;

/** 근접 3 · 원거리 3. 어느 대형이든 같은 팀으로 시작한다. */
const TEAM = [
  { id: 1, kind: "melee" }, // 턱시도 전사
  { id: 7, kind: "melee" }, // 몽실이 전사
  { id: 3, kind: "melee" }, // 까망이 도적
  { id: 8, kind: "ranged" }, // 호랑이 궁수
  { id: 6, kind: "ranged" }, // 삼색이 궁수
  { id: 5, kind: "ranged" }, // 하양이 마법사
];

const cell = (row, col) => row * BOARD_COLS + col;

/**
 * 실제 게임이 이 웨이브의 보스에게 주는 체력.
 *
 * **보정하지 않는다.** 이 스크립트가 묻는 것은 "이 보스에게 어느 대형이 나은가"
 * (열 안 비교)지 "어느 보스가 센가"(열 간 비교)가 아니다. 열 안에서만 비교하면
 * 보스마다 난이도가 달라도 상관없다.
 *
 * 보정을 넣었더니 오히려 비교가 망가졌다 — 같은 승률을 만들려니 체력이 8,864와
 * 96,140으로 11배 벌어졌고, 전투 시간이 10.9초와 115.2초가 됐다. 실제 보스전은
 * p50 18.2초다. **115초짜리 전투에서 좋은 대형은 이 게임의 답이 아니다.**
 */
function gameHp(breed) {
  const scale = Math.pow(BALANCE.enemyScale, WAVE - 1);
  const ramp = 0.5; // 첫 보스와 후반 보스의 중간
  const hpMul = (BALANCE.bossHpMulFirst + (BALANCE.bossHpMul - BALANCE.bossHpMulFirst) * ramp) * bossKit(breed.id).power;
  return Math.round(breed.hp * scale * hpMul);
}

/**
 * 대형 넷. `[근접 셋의 자리, 원거리 셋의 자리]`로 적는다.
 *
 * 열 4가 적과 맞닿는 앞줄, 열 0이 우리 뒷줄이다.
 */
const FORMATIONS = {
  // 교과서. 근접이 앞줄에서 받고 원거리가 뒷줄에서 쏜다.
  "정석 (근접 앞)": {
    melee: [cell(1, 4), cell(2, 4), cell(3, 4)],
    ranged: [cell(1, 0), cell(2, 0), cell(3, 0)],
  },
  // 한 덩어리. 광역에 통째로 맞지만 서로 붙어 있어 집중이 쉽다.
  "뭉침 (가운데)": {
    melee: [cell(1, 3), cell(2, 3), cell(3, 3)],
    ranged: [cell(1, 2), cell(2, 2), cell(3, 2)],
  },
  // 최대한 벌린다. 광역 하나에 전원이 들어가지 않는다.
  "분산 (모서리)": {
    melee: [cell(0, 4), cell(2, 4), cell(4, 4)],
    ranged: [cell(0, 0), cell(2, 0), cell(4, 0)],
  },
  // 원거리를 가운데 두고 근접이 둘러싼다. 뒷줄로 파고드는 보스를 겨냥한 대형.
  "감싸기 (원거리 보호)": {
    melee: [cell(1, 2), cell(2, 3), cell(3, 2)],
    ranged: [cell(1, 1), cell(2, 1), cell(3, 1)],
  },
};

/** 보스 원형 셋. 체력·공격력을 같게 주고 이동 속도·사거리·기믹만 다르게 둔다. */
const ARCHETYPES = BOSS_BREEDS.map((b) => ({
  breed: b,
  label: `${b.name}(${{ warrior: "전사", rogue: "도적", mage: "마법사" }[b.cls] ?? b.cls})`,
}));

/**
 * 한 판. 판 진행 없이 보스전 한 장면만 돌린다.
 *
 * 대형은 셀에 놓기만 하면 `startBattle`이 `resetPositions`로 좌표를 잡아 준다 —
 * 브라우저와 같은 경로다.
 */
function fight(formation, archetype, seed, intervene, hp) {
  const s = newRun(seed);

  s.ally = emptyBoard();
  let mi = 0;
  let ri = 0;
  for (const t of TEAM) {
    const spot = t.kind === "melee" ? formation.melee[mi++] : formation.ranged[ri++];
    if (spot === undefined) continue;
    s.ally[spot] = makeCat(breedById(t.id), "ally", spot, LEVEL);
  }

  s.enemy = emptyBoard();
  const scale = Math.pow(BALANCE.enemyScale, WAVE - 1);
  const bossCell = cell(2, 2);
  const boss = makeCat(archetype.breed, "enemy", bossCell);
  boss.radius = BOSS_RADIUS;
  // 난이도는 보스 체력으로 맞춘다. 이유는 calibrate() 주석에 있다.
  boss.maxHp = hp;
  boss.hp = hp;
  // 평타는 게임 공식 그대로. 여기를 만지면 존재할 수 없는 상태를 재게 된다.
  boss.atk = Math.round(boss.atk * scale * BALANCE.bossAtkMul);
  s.enemy[bossCell] = boss;

  // 호위 2기. 실제 보스 웨이브에 있고, 뒷줄을 노리므로 대형이 걸리는 대상이다.
  for (let i = 0; i < BALANCE.bossEscortCount; i++) {
    const spot = cell(1 + i * 2, 0);
    const e = makeCat(breedById(ESCORTS[i % ESCORTS.length]), "enemy", spot);
    e.maxHp = Math.round(e.maxHp * scale);
    e.hp = e.maxHp;
    e.atk = Math.round(e.atk * scale);
    s.enemy[spot] = e;
  }

  // 걸음을 보스 자리에 둬야 `currentKind`가 boss를 돌려주고 보스 타임아웃이 걸린다.
  s.step = 2;
  s.wave = WAVE;
  s.phase = "prepare";

  startBattle(s);
  if (s.phase !== "battle") return null;
  if (DODGE !== null) s.dodgeCharges = DODGE;

  const respond = intervene ? makeBossBot() : null;
  for (let g = 0; g < 4000; g++) {
    if (s.phase !== "battle") break;
    if (respond) respond(s);
    stepBattle(s, 100);
  }
  /**
   * 승패만 돌려주면 0%·100% 칸이 왜 그런지 알 수 없다. 그래서 **어떻게** 끝났는지를
   * 같이 돌려준다 — 전멸인지 타임아웃인지, 예고를 몇 번 맞았는지, 보스를 얼마나
   * 깎았는지. 0%가 "예고에 녹았다"인지 "보스를 못 깎아 시간이 다 됐다"인지에 따라
   * 고칠 곳이 완전히 다르다.
   */
  const bossNow = s.enemy.find((c) => c?.radius > 0);
  const bossDead = livingCats(s.enemy).length === 0;
  const allyLeft = livingCats(s.ally).length;
  return {
    win: bossDead && allyLeft > 0,
    wipe: allyLeft === 0,
    timeout: !bossDead && allyLeft > 0,
    sec: s.battleElapsed / 1000,
    seen: s.telegraphsSeen,
    eaten: s.telegraphsEaten,
    bossLeft: bossNow ? Math.max(0, bossNow.hp) / Math.max(1, bossNow.maxHp) : 0,
    allyLeft,
  };
}

/** 어떤 설정에서의 승률. */
/** 승률만 필요할 때. 보정 이분 탐색이 쓴다. */
function winRate(formation, arch, intervene, hp, runs) {
  return detail(formation, arch, intervene, hp, runs).winPct / 100;
}

/** 승률과 함께 **어떻게 끝났는지**를 모은다. */
function detail(formation, arch, intervene, hp, runs) {
  const acc = { n: 0, win: 0, wipe: 0, timeout: 0, sec: 0, seen: 0, eaten: 0, bossLeft: 0, allyLeft: 0 };
  for (let i = 0; i < runs; i++) {
    const r = fight(formation, arch, i + 1, intervene, hp);
    if (r === null) continue;
    acc.n += 1;
    if (r.win) acc.win += 1;
    if (r.wipe) acc.wipe += 1;
    if (r.timeout) acc.timeout += 1;
    acc.sec += r.sec;
    acc.seen += r.seen;
    acc.eaten += r.eaten;
    acc.bossLeft += r.bossLeft;
    acc.allyLeft += r.allyLeft;
  }
  const d = Math.max(1, acc.n);
  return {
    winPct: (acc.win / d) * 100,
    wipePct: (acc.wipe / d) * 100,
    timeoutPct: (acc.timeout / d) * 100,
    sec: acc.sec / d,
    seen: acc.seen / d,
    eaten: acc.eaten / d,
    bossLeftPct: (acc.bossLeft / d) * 100,
    allyLeft: acc.allyLeft / d,
  };
}

/**
 * 정석 대형으로 목표 승률이 나오는 공격력을 찾는다.
 *
 * 공격력이 오르면 승률은 단조 감소하므로 이분 탐색이 성립한다. 개입을 끈
 * 상태로 맞춘다 — 개입을 켜고 맞추면 개입 효과가 보정에 흡수돼 버린다.
 */
/**
 * 정석 대형이 목표 승률이 되는 **보스 체력**을 찾는다.
 *
 * ## 왜 체력인가
 *
 * 난이도를 조절할 값으로 셋을 시도했고 앞의 둘은 틀렸다.
 *
 *   공격력  보스의 위협은 평타가 아니라 예고인데, 예고 피해는 맞는 쪽 최대
 *           체력 비율로 들어가고 boss.atk과 무관하다. 게다가 bossAtkMul이
 *           0.28로 평타를 죽여 놨다. 그래서 무쇠발톱은 공격력 4000(정상값의
 *           360배)에서도 승률 90%였다.
 *   예고 피해  개입하면 예고를 피해 버려서 0이 된다. 개입을 켠 쪽에서는
 *           아무리 올려도 승률이 안 내려간다.
 *   체력    전투가 길어져 예고를 더 맞고, 취약 창(한 판에 한 번, 최대 체력의
 *           24.5%)의 비중도 상대적으로 줄어든다. **개입을 켜든 끄든 통한다.**
 *
 * ## 못 찾으면 에러를 낸다
 *
 * 예전 구현은 탐색 범위(20만)를 못 벗어나면 그 경계값을 조용히 답으로 돌려줬다.
 * 체력 20만에서도 승률이 70%였는데 "보정 완료"로 읽혔고, 그 위에서 만든 표를
 * 믿었다가 결과가 이상하니 코드 버그를 의심하며 시간을 버렸다.
 * **못 찾은 것과 찾은 것은 구분돼야 한다.**
 */
const HP_LO = 100;
const HP_HI = 10_000_000;

function calibrate(arch, intervene) {
  const base = FORMATIONS["정석 (근접 앞)"];
  let lo = HP_LO;
  let hi = HP_HI;
  // 경계에서 목표를 감싸는지 먼저 확인한다. 안 감싸면 이분 탐색이 무의미하다.
  const atLo = winRate(base, arch, intervene, HP_LO, CAL_RUNS);
  const atHi = winRate(base, arch, intervene, HP_HI, CAL_RUNS);
  if (atLo < TARGET_WIN || atHi > TARGET_WIN) {
    throw new Error(
      `보정 실패: ${arch.label} (개입 ${intervene ? "O" : "X"}) — ` +
        `체력 ${HP_LO}에서 승률 ${(atLo * 100).toFixed(0)}%, ${HP_HI}에서 ${(atHi * 100).toFixed(0)}%. ` +
        `목표 ${(TARGET_WIN * 100).toFixed(0)}%가 이 범위 밖이다. 범위를 넓히거나 팀/웨이브를 조정할 것.`,
    );
  }
  for (let i = 0; i < 24; i++) {
    const mid = Math.round((lo + hi) / 2);
    if (winRate(base, arch, intervene, mid, CAL_RUNS) > TARGET_WIN) lo = mid;
    else hi = mid;
  }
  return lo;
}

function table(intervene, hpOf) {
  const rows = {};
  for (const [fname, formation] of Object.entries(FORMATIONS)) {
    rows[fname] = {};
    for (const arch of ARCHETYPES) {
      rows[fname][arch.label] = detail(formation, arch, intervene, hpOf[arch.label], RUNS);
    }
  }
  return rows;
}

function print(title, rows) {
  const labels = ARCHETYPES.map((a) => a.label);
  console.log(`\n${title}`);
  console.log(`${"대형".padEnd(22)}${labels.map((l) => l.padStart(16)).join("")}   최선-최악`);
  for (const [fname, byArch] of Object.entries(rows)) {
    const vals = labels.map((l) => byArch[l].winPct);
    const spread = Math.max(...vals) - Math.min(...vals);
    console.log(
      `${fname.padEnd(22)}${vals.map((v) => `${v.toFixed(1)}%`.padStart(16)).join("")}   ${spread.toFixed(1)}%p`,
    );
  }
  // 보스마다 어느 대형이 이겼나. 여기가 이 스크립트의 질문이다.
  console.log(`${"".padEnd(22)}${labels.map((l) => "─".repeat(14).padStart(16)).join("")}`);
  const best = {};
  for (const l of labels) {
    let bn = null;
    let bv = -1;
    for (const [fname, byArch] of Object.entries(rows)) {
      if (byArch[l].winPct > bv) {
        bv = byArch[l].winPct;
        bn = fname;
      }
    }
    best[l] = { name: bn, val: bv };
  }
  console.log(`${"최선 대형".padEnd(22)}${labels.map((l) => best[l].name.split(" ")[0].padStart(16)).join("")}`);

  /**
   * **왜 그 승률인지**를 칸마다 편다. 승률만 보면 0%가 전멸인지 시간초과인지
   * 알 수 없고, 그 둘은 고칠 곳이 완전히 다르다.
   */
  console.log(`\n  [상세] 전멸% · 시간초과% · 전투초 · 예고 본/맞은 · 보스잔여% · 생존마리`);
  for (const [fname, byArch] of Object.entries(rows)) {
    for (const l of labels) {
      const d = byArch[l];
      console.log(
        `  ${fname.padEnd(20)} ${l.padEnd(16)} ` +
          `전멸 ${d.wipePct.toFixed(0).padStart(3)}% · 시간초과 ${d.timeoutPct.toFixed(0).padStart(3)}% · ` +
          `${d.sec.toFixed(1).padStart(5)}초 · 예고 ${d.seen.toFixed(1).padStart(4)}/${d.eaten.toFixed(1).padStart(4)} · ` +
          `보스잔여 ${d.bossLeftPct.toFixed(0).padStart(3)}% · 생존 ${d.allyLeft.toFixed(1)}마리`,
      );
    }
  }
  return best;
}

console.log(`보스전 ${RUNS}판 x 대형 ${Object.keys(FORMATIONS).length} x 원형 ${ARCHETYPES.length}`);
console.log(`팀 고정(근접3·원거리3, Lv${LEVEL}) · W${WAVE} 기준 · 호위 ${BALANCE.bossEscortCount}기 · 시드 1~${RUNS}`);

const hpOf = {};
for (const arch of ARCHETYPES) hpOf[arch.label] = gameHp(arch.breed);
console.log(
  `\n보스 체력 — 실제 게임 값 그대로(W${WAVE}): ` +
    ARCHETYPES.map((a) => `${a.label} ${hpOf[a.label].toLocaleString()}`).join(" · "),
);
console.log("  보정하지 않는다. 열 안에서만 비교하므로 보스별 난이도 차이는 문제가 아니다.");

const hpOff = hpOf;
const hpOn = hpOf;
const off = table(false, hpOff);
const bestOff = print("개입 없음 — 대형만의 효과", off);

const on = table(true, hpOn);
const bestOn = print("개입 있음 — 같은 난이도로 다시 맞춘 뒤", on);

console.log("\n판정");

const labels = ARCHETYPES.map((a) => a.label);
const distinctOff = new Set(labels.map((l) => bestOff[l].name)).size;
const distinctOn = new Set(labels.map((l) => bestOn[l].name)).size;

/**
 * 이 스크립트가 묻는 것은 둘이다.
 *
 *   1. 개입 없이 보스마다 최선 대형이 갈리는가  → 설계가 성립하는가
 *   2. 개입을 켜면 그 갈림이 살아남는가        → doDodge를 고쳐야 하는가
 */
console.log(`  보스마다 최선 대형이 갈리는가   개입 없음 ${distinctOff}종 / 개입 있음 ${distinctOn}종 (3이면 셋 다 다름)`);

const spreadOf = (rows) =>
  labels.map((l) => {
    const vals = Object.values(rows).map((r) => r[l]);
    return Math.max(...vals) - Math.min(...vals);
  });
const so = spreadOf(off);
const sn = spreadOf(on);
const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
console.log(`  대형이 만드는 승률 폭(평균)     개입 없음 ${avg(so).toFixed(1)}%p / 개입 있음 ${avg(sn).toFixed(1)}%p`);

/**
 * **포화 검사.** 판정 줄이 초록불이어도 표가 0%·100%로 붙어 있으면 아무 말도
 * 안 한 것과 같다.
 *
 * 실제로 이 스크립트는 같은 코드에서 120판일 때 최선 대형을 뭉침/정석/분산으로,
 * 200판일 때 뭉침/뭉침/분산으로 냈다. 포화된 칸은 난이도가 넓은 구간에서 똑같이
 * 100%라 순위가 표본 잡음으로 뒤집힌다. 그래서 순위를 말하기 전에 **말할 자격이
 * 있는지**를 먼저 찍는다.
 */
const cells = [...Object.values(off), ...Object.values(on)].flatMap((r) => Object.values(r).map((d) => d.winPct));
const sat = cells.filter((v) => v <= SAT_LO || v >= SAT_HI).length;
const satPct = (sat / cells.length) * 100;
console.log(`  포화된 칸(<=${SAT_LO}% 또는 >=${SAT_HI}%)  ${sat}/${cells.length} (${satPct.toFixed(0)}%)`);
if (satPct > 30) {
  console.log(
    "\n판정 보류: 표의 " +
      `${satPct.toFixed(0)}%가 포화됐다. 대형이 승률을 크게 가른다는 것까지는 말할 수 있지만,\n` +
      "  **어느 대형이 어느 보스에 최선인지는 이 표로 정할 수 없다** — 순위가 표본에 따라 뒤집힌다.\n" +
      "  칸을 20~80%에 넣으려면 대형을 덜 극단적으로 잡거나 난이도를 대형마다 따로 맞춰야 한다.",
  );
  process.exitCode = 1;
}

if (avg(so) < 5) {
  console.log("\n판정: 대형 자체가 승률을 안 가른다 — 개입 이전에 수치(이동속도·사거리·기믹)를 벌려야 한다");
  process.exitCode = 1;
} else if (avg(sn) < avg(so) * 0.5) {
  console.log("\n판정: 대형은 갈리는데 개입이 그것을 지운다 — doDodge가 대형을 보존하도록 고쳐야 한다");
} else if (distinctOn >= 2) {
  console.log("\n판정: 보스마다 최선 대형이 다르고 개입 뒤에도 남는다 — '다음 보스를 보고 대형을 고른다'가 결정이 된다");
} else {
  console.log("\n판정: 대형은 갈리지만 어느 보스에나 같은 대형이 최선이다 — 고를 이유가 없다");
  process.exitCode = 1;
}
