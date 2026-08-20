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
import { stepBattle, inTelegraph } from "../src/game/battle.ts";
import { makeCat, newRun, startBattle } from "../src/game/run.ts";
import { BOSS_BREEDS, BOSS_RADIUS, bossKit } from "../src/game/bosses.ts";
import { breedById } from "../src/game/breeds.ts";
import { BOARD_COLS, emptyBoard, livingCats, CLASS_LABEL } from "../src/game/types.ts";
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
/**
 * 보정 목표 — **승률이 아니라 생존 마리 수다.**
 *
 * 승률로 맞추려 했더니 표의 92%가 0%·100%로 포화됐다. 원인은 예고 피해가
 * 맞는 쪽 **최대 체력의 65~77%**라서다(ramp 0.5 기준). 두 방이면 죽으므로
 * 결과가 "여섯 방 다 맞고 전멸 / 두 방 막고 생존"으로 이분화되고, 그 사이에
 * 대형이 들어갈 폭이 거의 없다. 승률은 한 판당 0 아니면 1이라 그 이분법을
 * 그대로 물려받는다.
 *
 * 생존 마리는 여섯 마리의 평균이라 **승률이 0%나 100%인 구간에서도 눈금이
 * 남는다.** 실제로 무쇠발톱 열에서 승률이 0/15/72/100으로 갈릴 때 생존은
 * 0.0/0.9/4.3/6.0으로 같은 순서를 더 곱게 담았다.
 *
 * 절반인 3.0으로 잡는다. 위아래로 대형 차이가 벌어질 자리가 가장 넓다.
 */
const TARGET_SURVIVORS = 3.0;
/** 팀 크기. 생존 마리의 상한이다. */
const TEAM_SIZE = 6;
/**
 * 보정도 측정과 **같은 표본**으로 한다.
 *
 * 40판으로 맞추고 120판으로 쟀더니 목표 60%가 88%로 흘렀다. 보정점이
 * 표본 잡음 위에 서 있으면 그 위에서 잰 표도 그만큼 흔들린다.
 */
const CAL_RUNS = Number(process.env.CAL_RUNS ?? RUNS);
/**
 * 포화 판정 경계. **지킨 체력** 기준이다.
 *
 * 전에는 승률로 봤는데, 승률은 한 판당 0 아니면 1이라 예고 피해가 최대 체력의
 * 65~77%인 이 게임에서는 필연적으로 0%·100%에 붙는다(실제로 22/24가 포화됐다).
 * 지킨 체력은 여섯 마리의 연속량이라 그 함정이 없다.
 */
/**
 * 회피 차지를 바꿔 볼 수 있게 연다.
 *
 * 기본 6인데 보스전 예고가 4~6회다. **정확히 전부 막을 수 있는 수다.** 개입하면
 * 예고를 다 피하고, 예고를 안 맞으면 어디에 서 있었는지가 무의미해진다 —
 * 배치 깊이가 0.2인 진짜 이유가 이것이라는 가설을 여기서 시험한다.
 */
const DODGE = process.env.DODGE ? Number(process.env.DODGE) : null;

/**
 * 보스 평타 배수를 열어 둔다.
 *
 * 기본 0.28이라 W6 보스 공격력이 10인데 우리 고양이 체력은 400~700이다.
 * 한 마리 죽이는 데 40번을 때려야 하니 **평타가 사실상 없다.**
 * `pickTarget`이 가장 가까운 적을 고르므로 탱킹이 성립할 구조는 이미 있는데,
 * 맞아도 안 아프니 앞에 누구를 두든 상관이 없다. 오토배틀러에서 배치의 첫째
 * 이유가 "누가 먼저 맞느냐"인데 그 자리가 비어 있다.
 *
 * 여기를 올리면 배치가 살아나는지 본다.
 */
if (process.env.ATKMUL) BALANCE.bossAtkMul = Number(process.env.ATKMUL);

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
  label: `${b.name}(${CLASS_LABEL[b.cls]})`,
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
  /**
   * 체력은 **전투 중에** 표본한다. `finishWave`가 끝에서 전원을 회복시키므로
   * 루프를 빠져나온 뒤에 재면 언제나 100%다(실제로 그렇게 읽혔다).
   */
  let lastHpFrac = 1;
  /**
   * **노출** — 예고가 터지는 순간 잘못된 자리에 있던 마릿수를 센다.
   *
   * 체력으로 재려던 것을 접었다. 예고 피해를 낮추면 호위와의 난전이 체력을 더
   * 깎아 노출이 아니라 백병전을 재게 되고, 올리면 고양이가 죽기 시작해 다시
   * 절벽이다 — 실제로 배수 0.15에서는 뭉침/분산/뭉침, 0.4에서는 감싸기/분산/
   * 뭉침으로 **답이 배수에 따라 바뀌었다.** 어느 쪽도 대형 자체를 잰 것이 아니다.
   *
   * 여기서는 피해를 아예 거치지 않는다. `avoid`는 안에 있으면 잘못이고
   * `gather`는 밖에 있으면 잘못이다 — 그 마릿수가 곧 대형의 성적이다.
   * 게임의 `inTelegraph`를 그대로 쓰므로 기하가 갈라질 여지도 없다.
   */
  let exposedCats = 0;
  /**
   * **취약도로 가중한 노출.** 마리수로만 세면 감싸기의 값이 원리적으로 안 보인다 —
   * 체력 190인 전사와 90인 마법사를 똑같이 한 마리로 세니, 약한 것을 안쪽에
   * 숨기는 배치가 표에 안 나타난다.
   *
   * 가중치는 **그 고양이가 잃을 체력 비율**이다. 예고 피해가
   * `maxHp*frac*(1-share) + flat*share`이므로 비율로 고치면
   * `frac*(1-share) + flat*share/maxHp` — 즉 `share`가 0보다 클 때만 체력이
   * 갈린다. `share`가 0이면 모든 고양이가 같은 비율을 잃어 가중이 무의미하고,
   * 그것이 이 게임에서 배치가 약한 이유 중 하나다(`telegraphFlatShare` 주석).
   */
  let exposedWeighted = 0;
  let firedCount = 0;
  /** 패턴별 노출 — 어느 모양이 대형을 가르는지 보려면 갈라 세야 한다. */
  const byPat = {};
  // 대형이 유지되는가 — 시작과 예고 시점의 퍼짐(무게중심까지 평균 거리)
  const spreadAt = (cats) => {
    if (cats.length === 0) return 0;
    const cx = cats.reduce((a, c) => a + c.fx, 0) / cats.length;
    const cy = cats.reduce((a, c) => a + c.fy, 0) / cats.length;
    return cats.reduce((a, c) => a + Math.hypot(c.fx - cx, c.fy - cy), 0) / cats.length;
  };
  const spread0 = spreadAt(livingCats(s.ally));
  let spreadSum = 0;
  for (let g = 0; g < 4000; g++) {
    if (s.phase !== "battle") break;
    if (respond) respond(s);
    // 이번 스텝에 터질 예고를 터지기 직전에 잡는다.
    const tg = s.enemy.find((c) => c?.alive && c.telegraph)?.telegraph;
    const firing = tg && tg.fuse <= 100;
    const before = firing ? livingCats(s.ally) : null;
    stepBattle(s, 100);
    if (firing && before && before.length > 0) {
      firedCount += 1;
      spreadSum += spreadAt(before);
      /**
       * 발구르기는 `shape`가 원형이라 그냥 세면 원형과 섞인다. 보스 발밑에
       * 생기는지로 갈라낸다 — 그게 이 패턴의 정의다.
       */
      const bossNow = s.enemy.find((c) => c?.alive && c.radius > 0);
      const atBoss =
        bossNow && Math.hypot(tg.fx - bossNow.fx, tg.fy - bossNow.fy) < 0.05;
      const key =
        tg.mode === "gather" ? "gather" : tg.shape === "circle" && atBoss ? "stomp" : tg.shape;
      byPat[key] ??= { n: 0, exposed: 0 };
      byPat[key].n += 1;
      for (const c of before) {
        // pad=0(중심점 기준)을 유지한다 — 이 축은 대형의 기하만 보고,
        // 판(pad 도입) 전후 수치를 비교할 수 있어야 한다. 피해 모사가 아니다.
        const inside = inTelegraph(tg, c.fx, c.fy);
        if (tg.mode === "gather" ? !inside : inside) {
          exposedCats += 1;
          byPat[key].exposed += 1;
          // 잃을 체력 비율. 상수항은 대형 비교에서 상쇄되므로 변동항만 남긴다.
          /**
           * 실제 피해 공식과 같은 모양으로 센다(`telegraphHit`).
           *   피해 = maxHp*frac*(1-share) + boss.atk*flatMul*(frac/telegraphDmg)*share
           * 이것을 maxHp로 나눈 **잃는 비율**이 곧 취약도 가중치다.
           * `share`가 0이면 모두 `frac`으로 같아져 가중이 무의미해진다 —
           * 그게 지금 상태이고, 배치가 약한 이유 중 하나다.
           */
          const share = BALANCE.telegraphFlatShare;
          const bossAtk = bossNow ? bossNow.atk : 0;
          const flat = bossAtk * BALANCE.telegraphFlatMul;
          exposedWeighted += (1 - share) + (share * flat) / Math.max(1, c.maxHp);
        }
      }
    }
    if (s.phase === "battle") {
      let left = 0;
      let max = 0;
      for (const c of s.ally) {
        if (!c) continue;
        max += c.maxHp;
        left += Math.max(0, c.hp);
      }
      if (max > 0) lastHpFrac = left / max;
    }
  }
  /**
   * 승패만 돌려주면 0%·100% 칸이 왜 그런지 알 수 없다. 그래서 **어떻게** 끝났는지를
   * 같이 돌려준다 — 전멸인지 타임아웃인지, 예고를 몇 번 맞았는지, 보스를 얼마나
   * 깎았는지. 0%가 "예고에 녹았다"인지 "보스를 못 깎아 시간이 다 됐다"인지에 따라
   * 고칠 곳이 완전히 다르다.
   */
  const bossNow = s.enemy.find((c) => c?.radius > 0);
  const bossDead = livingCats(s.enemy).length === 0;
  /**
   * 팀이 지킨 체력 비율. **대형을 재는 진짜 눈금이다.**
   *
   * 승률·생존 마리로는 못 잰다. 예고 한 방이 최대 체력의 65~77%라 두 방이면
   * 죽고, 그래서 결과가 절벽이다 — 예고 피해 배수를 0.75에서 1.0으로 올리면
   * 생존이 6.0에서 0.8로 떨어진다. 그 절벽 위에 보정으로 서려고 하면 표본
   * 잡음에 그대로 흔들린다(같은 배수에서 3.0마리와 5.2마리가 나왔다).
   *
   * 체력 비율은 죽지 않는 낮은 피해에서 재면 절벽이 없다. 그리고 대형이
   * 실제로 통제하는 것 — **예고에 얼마나 노출되는가** — 을 직접 담는다.
   */

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
    hpKept: lastHpFrac,
    exposed: firedCount > 0 ? exposedCats / firedCount : 0,
    exposedW: firedCount > 0 ? exposedWeighted / firedCount : 0,
    spread0,
    spreadFire: firedCount > 0 ? spreadSum / firedCount : 0,
    byPat,
  };
}

/** 보정 이분 탐색이 쓰는 값. 체력이 오르면 단조 감소한다. */
function survivors(formation, arch, intervene, hp, runs) {
  return detail(formation, arch, intervene, hp, runs).allyLeft;
}

/** 승률과 함께 **어떻게 끝났는지**를 모은다. */
function detail(formation, arch, intervene, hp, runs) {
  const acc = { n: 0, win: 0, wipe: 0, timeout: 0, sec: 0, seen: 0, eaten: 0, bossLeft: 0, allyLeft: 0, hpKept: 0, exposed: 0, exposedW: 0, spread0: 0, spreadFire: 0, byPat: {} };
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
    acc.hpKept += r.hpKept;
    acc.exposed += r.exposed;
    acc.exposedW += r.exposedW;
    acc.spread0 += r.spread0;
    acc.spreadFire += r.spreadFire;
    for (const [k, v] of Object.entries(r.byPat)) {
      acc.byPat[k] ??= { n: 0, exposed: 0 };
      acc.byPat[k].n += v.n;
      acc.byPat[k].exposed += v.exposed;
    }
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
    hpKeptPct: (acc.hpKept / d) * 100,
    exposed: acc.exposed / d,
    exposedW: acc.exposedW / d,
    spread0: acc.spread0 / d,
    spreadFire: acc.spreadFire / d,
    byPat: Object.fromEntries(
      Object.entries(acc.byPat).map(([k, v]) => [k, v.n > 0 ? v.exposed / v.n : 0]),
    ),
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
/**
 * 보정 손잡이 — **예고 피해 배수**다. 체력이 아니다.
 *
 * 체력으로 맞추려다 실패했다. 예고는 **보스 체력 문턱**(0.85·0.7·…·0.1)을
 * 넘을 때 나오는데, 체력을 크게 올리면 팀이 문턱을 못 넘겨 **예고가 아예
 * 안 나온다.** 실측: 체력 100에서 생존 6.0마리, 1,000만에서 4.8마리 —
 * 단조가 아니라 중간에서 꺾인다. 이분 탐색이 성립하지 않는다.
 *
 * 예고 피해는 다르다. `frac * kit.power` 만큼 최대 체력을 깎으므로 배수를
 * 올리면 생존이 곧바로 준다. 그리고 이 게임에서 보스의 위협은 평타가 아니라
 * 예고이므로(평타는 `bossAtkMul = 0.28`로 죽여 놨다) 난이도를 지배하는
 * 손잡이를 직접 잡는 것이기도 하다.
 */
const DMG_LO = 0.01;
const DMG_HI = 8;

/**
 * 보스 체력을 조절해 기준 대형이 목표 생존 수에 오게 만든다.
 *
 * **보스마다 따로 맞춘다.** 이 스크립트가 묻는 것은 "이 보스에게 어느 대형이
 * 나은가"(열 안 비교)지 "어느 보스가 센가"(열 간 비교)가 아니므로, 열마다
 * 기준점을 같은 자리에 놓는 것이 비교를 살린다.
 *
 * 개입 켠 표와 끈 표도 따로 맞춘다. 예고를 둘 막느냐 아니냐로 난이도 체계가
 * 통째로 달라져서(끄면 전부 전멸, 켜면 전부 생존) 같은 체력으로는 둘 다
 * 포화한다.
 */
/** 예고 피해 배수를 걸고 재는 헬퍼. 원래 값을 반드시 되돌린다. */
const DMG0 = { first: BALANCE.telegraphDmgFirst, full: BALANCE.telegraphDmg };
function withDmg(mul, fn) {
  BALANCE.telegraphDmgFirst = DMG0.first * mul;
  BALANCE.telegraphDmg = DMG0.full * mul;
  try {
    return fn();
  } finally {
    BALANCE.telegraphDmgFirst = DMG0.first;
    BALANCE.telegraphDmg = DMG0.full;
  }
}

function calibrate(arch, intervene) {
  const base = FORMATIONS["정석 (근접 앞)"];
  const hp = gameHp(arch.breed);
  const at = (mul) => withDmg(mul, () => survivors(base, arch, intervene, hp, CAL_RUNS));
  let lo = DMG_LO;
  let hi = DMG_HI;
  // 배수가 오르면 생존이 준다. 경계가 목표를 감싸는지 먼저 본다.
  const atLo = at(DMG_LO);
  const atHi = at(DMG_HI);
  /**
   * **못 맞추면 죽지 않고 못 맞췄다고 돌려준다.**
   *
   * 실제로 못 맞추는 칸이 있다 — 서리귀 + 개입이 그렇다. 예고 피해를 8배로
   * 올려도 생존이 5.9마리다. 한 번 흩어지면 계속 흩어진 상태라 이후 원형이
   * 아무도 안 맞기 때문이다. 즉 **개입이 이 보스를 무력화한다**는 사실이지
   * 하네스의 고장이 아니다. 던지면 그 사실이 예외로 가려지고 나머지 칸까지
   * 못 본다.
   */
  if (atLo < TARGET_SURVIVORS || atHi > TARGET_SURVIVORS) {
    return {
      failed: true,
      reason:
        `배수 ${DMG_LO}에서 ${atLo.toFixed(1)}마리, ${DMG_HI}에서 ${atHi.toFixed(1)}마리 — ` +
        `목표 ${TARGET_SURVIVORS}마리가 범위 밖`,
    };
  }
  for (let i = 0; i < 22; i++) {
    const mid = (lo + hi) / 2;
    if (at(mid) > TARGET_SURVIVORS) lo = mid;
    else hi = mid;
  }
  return { failed: false, mul: lo };
}

function table(intervene, mulOf) {
  const rows = {};
  for (const [fname, formation] of Object.entries(FORMATIONS)) {
    rows[fname] = {};
    for (const arch of ARCHETYPES) {
      // 보정한 배수를 **측정에도 그대로 건다.** 보정만 하고 원래 값으로 재면
      // 맞춰 놓은 기준점 위에서 재는 것이 아니게 된다.
      const cal = mulOf[arch.label];
      rows[fname][arch.label] = withDmg(cal.failed ? 1 : cal.mul, () =>
        detail(formation, arch, intervene, gameHp(arch.breed), RUNS),
      );
      rows[fname][arch.label].uncalibrated = cal.failed;
    }
  }
  return rows;
}

function print(title, rows) {
  const labels = ARCHETYPES.map((a) => a.label);
  console.log(`\n${title}`);
  console.log(`${"대형".padEnd(22)}${labels.map((l) => l.padStart(16)).join("")}   최선-최악`);
  console.log(`${"".padEnd(22)}${labels.map(() => "예고당 잘못선 마리".padStart(16)).join("")}`);
  for (const [fname, byArch] of Object.entries(rows)) {
    const vals = labels.map((l) => byArch[l].exposed);
    const spread = Math.max(...vals) - Math.min(...vals);
    console.log(
      `${fname.padEnd(22)}` +
        labels
          .map((l, i) => `${vals[i].toFixed(2)}마리`.padStart(16))
          .join("") +
        `   ${spread.toFixed(2)}마리`,
    );
  }
  // 보스마다 어느 대형이 이겼나. 여기가 이 스크립트의 질문이다.
  console.log(`${"".padEnd(22)}${labels.map((l) => "─".repeat(14).padStart(16)).join("")}`);
  const best = {};
  for (const l of labels) {
    let bn = null;
    // **노출은 낮을수록 좋다.** 최선은 최소값이다.
    let bv = Infinity;
    for (const [fname, byArch] of Object.entries(rows)) {
      if (byArch[l].exposed < bv) {
        bv = byArch[l].exposed;
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
  console.log(`\n  [패턴별 노출] 예고 모양마다 잘못 선 마리수 — 어느 모양이 대형을 가르나`);
  for (const l of labels) {
    const pats = new Set();
    for (const byArch of Object.values(rows)) for (const k of Object.keys(byArch[l].byPat)) pats.add(k);
    for (const pat of [...pats].sort()) {
      const line = Object.entries(rows)
        .map(([f, byArch]) => `${f.split(" ")[0]} ${(byArch[l].byPat[pat] ?? 0).toFixed(2)}`)
        .join(" · ");
      console.log(`  ${l.padEnd(14)} ${pat.padEnd(7)} ${line}`);
    }
  }
  console.log(`\n  [상세] 전멸% · 시간초과% · 전투초 · 예고 본/맞은 · 보스잔여% · 생존마리`);
  for (const [fname, byArch] of Object.entries(rows)) {
    for (const l of labels) {
      const d = byArch[l];
      console.log(
        `  ${fname.padEnd(20)} ${l.padEnd(16)} ` +
          `전멸 ${d.wipePct.toFixed(0).padStart(3)}% · 시간초과 ${d.timeoutPct.toFixed(0).padStart(3)}% · ` +
          `${d.sec.toFixed(1).padStart(5)}초 · 예고 ${d.seen.toFixed(1).padStart(4)}/${d.eaten.toFixed(1).padStart(4)} · ` +
          `노출 ${d.exposed.toFixed(2)}마리(가중 ${d.exposedW.toFixed(2)})/예고 · 퍼짐 시작 ${d.spread0.toFixed(2)} → 예고때 ${d.spreadFire.toFixed(2)}`,
      );
    }
  }
  return best;
}

console.log(`보스전 ${RUNS}판 x 대형 ${Object.keys(FORMATIONS).length} x 원형 ${ARCHETYPES.length}`);
console.log(`팀 고정(근접3·원거리3, Lv${LEVEL}) · W${WAVE} 기준 · 호위 ${BALANCE.bossEscortCount}기 · 시드 1~${RUNS}`);

/**
 * 보스별·개입별로 따로 보정한다.
 *
 * 실제 게임 체력을 그대로 쓰면 표의 92%가 포화됐다 — 살금이는 너무 쉽고
 * (넷 중 셋이 100%) 서리귀는 너무 어렵고(전부 0%) 개입을 켜면 열두 칸이
 * 전부 100%였다. 포화된 칸은 대형 차이를 담지 못한다.
 */
const fmtCal = (c) => (c.failed ? `보정불가(${c.reason})` : `x${c.mul.toFixed(2)}`);
if (process.env.CURVE) {
  const base = FORMATIONS["정석 (근접 앞)"];
  for (const arch of ARCHETYPES) {
    const row = [];
    for (const mul of [0.5, 0.75, 1.0, 1.12, 1.25, 1.5, 2.0, 3.0]) {
      row.push(`x${mul}:${withDmg(mul, () => survivors(base, arch, false, gameHp(arch.breed), 80)).toFixed(1)}`);
    }
    console.log(`  ${arch.label.padEnd(14)} ${row.join("  ")}`);
  }
  process.exit(0);
}
/**
 * 노출 측정용 예고 피해 배수.
 *
 * **아무도 안 죽을 만큼 낮게 잡는다.** 기본값에서 예고 한 방이 최대 체력의
 * 65~77%라 두 방이면 죽는데, 죽기 시작하면 그때부터 절벽이고 잡음이다.
 * 0.15면 한 방에 10~12%, 여섯 방을 다 맞아도 70% 남짓이라 아무도 안 죽는다.
 * 그러면 남은 체력이 곧 **예고에 얼마나 노출됐는가**가 된다.
 *
 * 보정을 안 한다. 보정은 절벽 위에 기준점을 세우려는 시도였고, 그 위에서는
 * 같은 배수가 3.0마리와 5.2마리를 내놨다.
 */
const EXPOSE_MUL = process.env.EXPOSE ? Number(process.env.EXPOSE) : 0.15;
const EXPOSE = Object.fromEntries(ARCHETYPES.map((a) => [a.label, { failed: false, mul: EXPOSE_MUL }]));
console.log(
  `\n예고 피해를 x${EXPOSE_MUL}로 낮춰 **노출만** 잰다 (아무도 죽지 않는 구간)` +
    `\n  체력은 실제 게임 W${WAVE} 값 그대로: ` +
    ARCHETYPES.map((a) => `${a.label} ${gameHp(a.breed).toLocaleString()}`).join(" · "),
);

const off = table(false, EXPOSE);
const bestOff = print("개입 없음 — 대형만의 효과", off);

const on = table(true, EXPOSE);
const bestOn = print("개입 있음 — 개입이 대형을 지우는가", on);

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

/**
 * 보스 열마다 **대형이 만드는 지킨 체력 폭**.
 *
 * 전에는 `r[l]`(상세 객체)을 그대로 빼서 NaN이 나왔고, `labels`도 `print()`
 * 안에서만 정의돼 이 자리에서는 undefined였다. 판정 줄이 NaN인데도 아래
 * 판정문은 그대로 찍히고 있었다 — NaN 비교가 전부 false라 마지막 가지로
 * 떨어졌기 때문이다.
 */
const spreadOf = (rows) =>
  ARCHETYPES.map((a) => {
    const vals = Object.values(rows).map((r) => r[a.label].exposed);
    return Math.max(...vals) - Math.min(...vals);
  });
const so = spreadOf(off);
const sn = spreadOf(on);
const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
console.log(`  대형이 만드는 노출 폭(평균)     개입 없음 ${avg(so).toFixed(2)}마리 / 개입 있음 ${avg(sn).toFixed(2)}마리`);

/**
 * **포화 검사.** 판정 줄이 초록불이어도 표가 0%·100%로 붙어 있으면 아무 말도
 * 안 한 것과 같다.
 *
 * 실제로 이 스크립트는 같은 코드에서 120판일 때 최선 대형을 뭉침/정석/분산으로,
 * 200판일 때 뭉침/뭉침/분산으로 냈다. 포화된 칸은 난이도가 넓은 구간에서 똑같이
 * 100%라 순위가 표본 잡음으로 뒤집힌다. 그래서 순위를 말하기 전에 **말할 자격이
 * 있는지**를 먼저 찍는다.
 */
const cells = [...Object.values(off), ...Object.values(on)].flatMap((r) =>
  Object.values(r).map((d) => (d.exposed / TEAM_SIZE) * 100),
);
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

if (avg(so) < 0.5) {
  console.log("\n판정: 대형 자체가 노출을 안 가른다 — 개입 이전에 수치(이동속도·사거리·기믹)를 벌려야 한다");
  process.exitCode = 1;
} else if (avg(sn) < avg(so) * 0.5) {
  console.log("\n판정: 대형은 갈리는데 개입이 그것을 지운다 — doDodge가 대형을 보존하도록 고쳐야 한다");
} else if (distinctOn >= 2) {
  console.log("\n판정: 보스마다 최선 대형이 다르고 개입 뒤에도 남는다 — '다음 보스를 보고 대형을 고른다'가 결정이 된다");
} else {
  console.log("\n판정: 대형은 갈리지만 어느 보스에나 같은 대형이 최선이다 — 고를 이유가 없다");
  process.exitCode = 1;
}
