import assert from "node:assert/strict";
import { BOSS_SIGNAL_CONTRACT, UI_CUE_CONTRACT, createBossSignalObserver } from "../src/game/audio.ts";

function zone(mode, extra = {}) {
  return { mode, ...extra };
}

function boss(uid, vulnerableMs) {
  return { uid, alive: true, radius: 1, vulnerableMs };
}

const names = ["avoid", "gather", "vulnerable"];
assert.deepEqual(BOSS_SIGNAL_CONTRACT, {
  avoid: { durationSec: 0.3, targetBrightnessHz: 1782, attackMs: 0 },
  gather: { durationSec: 0.6, targetBrightnessHz: 2466, attackMs: 246 },
  vulnerable: { durationSec: 0.9, targetBrightnessHz: 5745, attackMs: 3 },
});
for (let i = 0; i < names.length; i += 1) {
  for (let j = i + 1; j < names.length; j += 1) {
    const a = BOSS_SIGNAL_CONTRACT[names[i]];
    const b = BOSS_SIGNAL_CONTRACT[names[j]];
    const distinctAxes = [
      a.durationSec !== b.durationSec,
      a.targetBrightnessHz !== b.targetBrightnessHz,
      a.attackMs !== b.attackMs,
    ].filter(Boolean).length;
    assert.ok(distinctAxes >= 2, `${names[i]}와 ${names[j]}는 최소 두 축에서 달라야 한다`);
  }
}

assert.deepEqual(
  Object.fromEntries(
    Object.entries(UI_CUE_CONTRACT).map(([kind, spec]) => [
      kind,
      {
        motif: spec.motif,
        durationSec: spec.durationSec,
        frequenciesHz: spec.voices.map((voice) => voice.frequencyHz),
        offsetsSec: spec.voices.map((voice) => voice.offsetSec),
      },
    ]),
  ),
  {
    contract: {
      motif: "snap-stamp-approve",
      durationSec: 0.34,
      frequenciesHz: [1640, 110, 660, 990],
      offsetsSec: [0, 0.045, 0.14, 0.22],
    },
    purchase: {
      motif: "two-note",
      durationSec: 0.18,
      frequenciesHz: [660, 990],
      offsetsSec: [0, 0.07],
    },
    upgrade: {
      motif: "rising-three-note",
      durationSec: 0.25,
      frequenciesHz: [523, 659, 784],
      offsetsSec: [0, 0.065, 0.13],
    },
    reroll: {
      motif: "shuffle-three-note",
      durationSec: 0.19,
      frequenciesHz: [740, 620, 820],
      offsetsSec: [0, 0.055, 0.11],
    },
    map: {
      motif: "route-confirm",
      durationSec: 0.22,
      frequenciesHz: [440, 660, 880],
      offsetsSec: [0, 0.04, 0.1],
    },
    reentry: {
      motif: "launch-octaves",
      durationSec: 0.28,
      frequenciesHz: [196, 392, 784],
      offsetsSec: [0, 0.07, 0.14],
    },
  },
  "상호작용별 UI 큐는 구분되는 소리 문법을 유지해야 한다",
);
for (const [kind, spec] of Object.entries(UI_CUE_CONTRACT)) {
  assert.ok(spec.durationSec <= 0.36, `${kind}: 선택 피드백 전체 길이는 360ms 이내`);
  const lastVoiceEnd = Math.max(...spec.voices.map((voice) => voice.offsetSec + voice.lengthSec));
  assert.ok(Math.abs(lastVoiceEnd - spec.durationSec) < 1e-9, `${kind}: 선언 길이와 실제 마지막 음 끝이 일치`);
}
assert.ok(
  UI_CUE_CONTRACT.upgrade.voices.every(
    (voice, index, voices) => index === 0 || voice.frequencyHz > voices[index - 1].frequencyHz,
  ),
  "강화 큐는 상승 3음이어야 한다",
);
assert.ok(
  UI_CUE_CONTRACT.reroll.voices[1].frequencyHz < UI_CUE_CONTRACT.reroll.voices[0].frequencyHz &&
    UI_CUE_CONTRACT.reroll.voices[2].frequencyHz > UI_CUE_CONTRACT.reroll.voices[0].frequencyHz,
  "재추첨 큐는 아래로 섞고 위로 확정하는 3음이어야 한다",
);
assert.deepEqual(
  UI_CUE_CONTRACT.reentry.voices.map((voice) => voice.frequencyHz),
  [196, 392, 784],
  "재진입 큐는 옥타브 단위로 상승해야 한다",
);

const emitted = [];
const observe = createBossSignalObserver((signal) => emitted.push(signal));
const avoid = zone("avoid");

observe({ phase: "battle", zones: [avoid], bosses: [] });
observe({ phase: "battle", zones: [avoid], bosses: [] });
assert.deepEqual(emitted, ["avoid"], "같은 예고 객체는 한 번만 신호해야 한다");

const sweepA = zone("avoid");
const sweepB = zone("avoid");
observe({ phase: "battle", zones: [sweepA, sweepB], bosses: [] });
assert.deepEqual(emitted, ["avoid", "avoid"], "한 스윕의 같은 모드 여러 행은 한 번만 신호해야 한다");

const polarityAvoid = zone("avoid");
const polarityGather = zone("gather");
observe({ phase: "battle", zones: [polarityAvoid, polarityGather], bosses: [] });
assert.deepEqual(emitted.slice(-2), ["avoid", "gather"], "극성 두 모드는 각각 한 번 신호해야 한다");

const creep = zone("avoid", { idleMs: 0 });
observe({ phase: "battle", zones: [creep], bosses: [] });
observe({ phase: "battle", zones: [{ ...creep, idleMs: 100 }], bosses: [] });
assert.equal(emitted.length, 4, "상주 장판은 생성·변형돼도 재신호하면 안 된다");

observe({ phase: "battle", zones: [], bosses: [boss("boss-1", 800)] });
observe({ phase: "battle", zones: [], bosses: [boss("boss-1", 400)] });
observe({ phase: "battle", zones: [], bosses: [boss("boss-1", 0)] });
observe({ phase: "battle", zones: [], bosses: [boss("boss-1", 700)] });
assert.deepEqual(emitted.slice(-2), ["vulnerable", "vulnerable"], "취약 창이 닫힌 뒤 재개방되면 다시 신호해야 한다");

observe({ phase: "map", zones: [], bosses: [] });
observe({ phase: "battle", zones: [avoid], bosses: [] });
assert.equal(emitted.at(-1), "avoid", "전투 밖을 거친 뒤 같은 객체도 새 전투 예고로 신호해야 한다");

const hostileEmitted = [];
const observeHostile = createBossSignalObserver((signal) => hostileEmitted.push(signal));
observeHostile({
  phase: "battle",
  zones: [zone("avoid"), zone("gather")],
  bosses: [null, { ...boss("dead", 900), alive: false }, { ...boss("minion", 900), radius: 0 }],
});
assert.deepEqual(hostileEmitted, ["avoid", "gather"], "null·사망·일반 적은 취약 신호를 열면 안 된다");

observeHostile({
  phase: "battle",
  zones: [],
  bosses: [boss("boss-a", 900), boss("boss-b", 900)],
});
assert.deepEqual(
  hostileEmitted,
  ["avoid", "gather", "vulnerable"],
  "같은 프레임에 여러 보스의 취약 창이 열려도 신호는 한 번으로 합쳐야 한다",
);

observeHostile({ phase: "battle", zones: [], bosses: [boss("boss-a", 400), boss("boss-b", 0)] });
assert.equal(hostileEmitted.length, 3, "유지 중인 취약 창과 닫힌 창은 추가 신호를 만들면 안 된다");

console.log("audio signal tests passed");
