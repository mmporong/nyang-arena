import assert from "node:assert/strict";
import { createFramePerformanceObserver } from "../src/game/performance.ts";

function observeSeries(observer, phase, workValues, rafTimestamps) {
  assert.equal(workValues.length, rafTimestamps.length);
  for (let index = 0; index < workValues.length; index += 1) {
    observer.observe({
      phase,
      frameWorkMs: workValues[index],
      rafTimestampMs: rafTimestamps[index],
    });
  }
}

const stats = createFramePerformanceObserver({ capacity: 10 });
observeSeries(stats, "battle", [1, 2, 3, 4, 100], [0, 10, 30, 60, 100]);
const statsSnapshot = stats.snapshot();
assert.deepEqual(
  statsSnapshot.frameWorkMs,
  { sampleCount: 5, p50Ms: 3, p95Ms: 100, maxMs: 100, longCount: 1, longRate: 0.2 },
  "frame work는 nearest-rank 백분위와 16.7ms 초과율을 계산해야 한다",
);
assert.deepEqual(
  statsSnapshot.rafIntervalMs,
  { sampleCount: 4, p50Ms: 20, p95Ms: 40, maxMs: 40, longCount: 3, longRate: 0.75 },
  "raw rAF 간격은 첫 표본을 제외한 실제 간격으로 집계해야 한다",
);
assert.equal(statsSnapshot.elapsedMs, 100);
assert.equal(statsSnapshot.cadenceHz, 40, "cadence는 (n-1)*1000/elapsed 공식을 따라야 한다");

const phases = createFramePerformanceObserver({ capacity: 10 });
observeSeries(phases, "map", [2, 4], [0, 10]);
observeSeries(phases, "battle", [20, 30, 40], [30, 60, 100]);
const phaseSnapshot = phases.snapshot();
assert.deepEqual(Object.keys(phaseSnapshot.phases), ["map", "battle"]);
assert.equal(phaseSnapshot.phases.map?.sampleCount, 2);
assert.equal(phaseSnapshot.phases.map?.frameWorkMs.p50Ms, 2);
assert.equal(phaseSnapshot.phases.map?.cadenceHz, 100);
assert.equal(phaseSnapshot.phases.battle?.sampleCount, 3);
assert.equal(phaseSnapshot.phases.battle?.frameWorkMs.p50Ms, 30);
assert.equal(phaseSnapshot.phases.battle?.rafIntervalMs.p50Ms, 30);
assert.equal(phaseSnapshot.phases.battle?.cadenceHz, (2 * 1000) / 70);

const repeatedPhase = createFramePerformanceObserver({ capacity: 10 });
observeSeries(repeatedPhase, "battle", [1, 1], [0, 10]);
observeSeries(repeatedPhase, "reward", [1, 1], [20, 30]);
observeSeries(repeatedPhase, "battle", [2, 2], [100, 110]);
const repeatedSnapshot = repeatedPhase.snapshot();
assert.equal(repeatedSnapshot.phases.battle?.sampleCount, 2, "가장 최근 battle 에피소드만 집계해야 한다");
assert.equal(repeatedSnapshot.phases.battle?.elapsedMs, 10);
assert.equal(repeatedSnapshot.phases.battle?.cadenceHz, 100);
assert.equal(repeatedSnapshot.phases.battle?.rafIntervalMs.p95Ms, 10);

const ring = createFramePerformanceObserver({ capacity: 3 });
observeSeries(ring, "prepare", [1, 2, 3, 4], [0, 10, 20, 30]);
const ringSnapshot = ring.snapshot();
assert.equal(ringSnapshot.sampleCount, 3, "ring은 용량을 넘겨 커지면 안 된다");
assert.equal(ringSnapshot.frameWorkMs.p50Ms, 3, "가장 오래된 표본을 먼저 축출해야 한다");
assert.equal(ringSnapshot.frameWorkMs.maxMs, 4);
assert.equal(ringSnapshot.elapsedMs, 20);
assert.equal(ringSnapshot.cadenceHz, 100);
assert.equal(ringSnapshot.rafIntervalMs.sampleCount, 2, "ring 밖 표본과의 간격은 현재 창에 포함하면 안 된다");
assert.equal(ringSnapshot.rafIntervalMs.p50Ms, 10);

ring.clear();
assert.deepEqual(ring.snapshot(), {
  capacity: 3,
  longThresholdMs: 16.7,
  sampleCount: 0,
  elapsedMs: 0,
  cadenceHz: null,
  frameWorkMs: { sampleCount: 0, p50Ms: null, p95Ms: null, maxMs: null, longCount: 0, longRate: 0 },
  rafIntervalMs: { sampleCount: 0, p50Ms: null, p95Ms: null, maxMs: null, longCount: 0, longRate: 0 },
  phases: {},
});

assert.throws(() => createFramePerformanceObserver({ capacity: 1 }), RangeError);
assert.throws(() => createFramePerformanceObserver({ capacity: 2.5 }), RangeError);
assert.throws(() => createFramePerformanceObserver({ longThresholdMs: Number.NaN }), RangeError);
assert.throws(() => createFramePerformanceObserver({ longThresholdMs: -1 }), RangeError);

const invalid = createFramePerformanceObserver();
assert.throws(() => invalid.observe({ phase: "battle", frameWorkMs: Number.NaN, rafTimestampMs: 0 }), RangeError);
assert.throws(() => invalid.observe({ phase: "battle", frameWorkMs: -1, rafTimestampMs: 0 }), RangeError);
assert.throws(() => invalid.observe({ phase: "battle", frameWorkMs: 1, rafTimestampMs: Number.NaN }), RangeError);
assert.throws(() => invalid.observe({ phase: "battle", frameWorkMs: 1, rafTimestampMs: -1 }), RangeError);
assert.throws(() => invalid.observe({ phase: "", frameWorkMs: 1, rafTimestampMs: 0 }), TypeError);
invalid.observe({ phase: "battle", frameWorkMs: 1, rafTimestampMs: 10 });
assert.throws(
  () => invalid.observe({ phase: "battle", frameWorkMs: 1, rafTimestampMs: 9 }),
  RangeError,
  "역행 rAF 시각으로 생기는 음수 간격도 거절해야 한다",
);
assert.equal(invalid.snapshot().sampleCount, 1, "거절된 표본은 observer 상태를 바꾸면 안 된다");

console.log("performance observer tests passed");
