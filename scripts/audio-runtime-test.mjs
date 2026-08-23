import assert from "node:assert/strict";

class FakeAudioParam {
  value = 0;
  events = [];

  cancelScheduledValues(time) {
    this.events.push({ method: "cancelScheduledValues", time });
  }

  setValueCurveAtTime(curve, time, duration) {
    this.events.push({ method: "setValueCurveAtTime", curve, time, duration });
  }

  setValueAtTime(value, time) {
    this.value = value;
    this.events.push({ method: "setValueAtTime", value, time });
  }

  linearRampToValueAtTime(value, time) {
    this.value = value;
    this.events.push({ method: "linearRampToValueAtTime", value, time });
  }

  exponentialRampToValueAtTime(value, time) {
    this.value = value;
    this.events.push({ method: "exponentialRampToValueAtTime", value, time });
  }
}

class FakeAudioNode {
  connections = [];
  disconnectCount = 0;

  connect(target) {
    this.connections.push(target);
    return target;
  }

  disconnect() {
    this.disconnectCount += 1;
  }
}

class FakeGainNode extends FakeAudioNode {
  gain = new FakeAudioParam();
}

class FakeOscillatorNode extends FakeAudioNode {
  frequency = new FakeAudioParam();
  type = "sine";
  starts = [];
  stops = [];
  onended = null;

  start(time = 0) {
    this.starts.push(time);
  }

  stop(time = 0) {
    this.stops.push(time);
  }
}

class FakeAudioContext {
  static instances = [];

  currentTime = 12.5;
  state = "running";
  destination = new FakeAudioNode();
  gains = [];
  oscillators = [];
  suspendCalls = 0;
  resumeCalls = 0;
  suspendBehavior = "resolve";
  resumeBehavior = "resolve";

  constructor() {
    FakeAudioContext.instances.push(this);
  }

  createGain() {
    const gain = new FakeGainNode();
    this.gains.push(gain);
    return gain;
  }

  createOscillator() {
    const oscillator = new FakeOscillatorNode();
    this.oscillators.push(oscillator);
    return oscillator;
  }

  createBufferSource() {
    throw new Error("pending fetch에서는 buffer source를 만들면 안 된다");
  }

  decodeAudioData() {
    throw new Error("pending fetch에서는 decodeAudioData를 부르면 안 된다");
  }

  suspend() {
    this.suspendCalls += 1;
    return transition(this.suspendBehavior, "suspend rejected");
  }

  resume() {
    this.resumeCalls += 1;
    return transition(this.resumeBehavior, "resume rejected");
  }
}

function transition(behavior, message) {
  if (behavior === "throw") throw new Error(message);
  if (behavior === "reject") return Promise.reject(new Error(message));
  return Promise.resolve();
}

function nodeCount(context) {
  return context ? context.gains.length + context.oscillators.length : 0;
}

function lastEvent(param, method) {
  return param.events.findLast((event) => event.method === method);
}

function assertSignalGraph(audio, context, signal, expected) {
  const gainOffset = context.gains.length;
  const oscillatorOffset = context.oscillators.length;
  audio.playBossSignal(signal);

  const createdGains = context.gains.slice(gainOffset);
  const bus = createdGains[0];
  const voiceGains = createdGains.slice(1);
  const oscillators = context.oscillators.slice(oscillatorOffset);

  assert.equal(oscillators.length, expected.voices, `${signal}: oscillator 수`);
  assert.equal(voiceGains.length, expected.voices, `${signal}: voice gain 수`);
  assert.deepEqual(bus.connections, [context.gains[0]], `${signal}: bus는 master에 연결`);

  for (let i = 0; i < expected.voices; i += 1) {
    assert.deepEqual(oscillators[i].connections, [voiceGains[i]], `${signal}: oscillator는 voice gain에 연결`);
    assert.deepEqual(voiceGains[i].connections, [bus], `${signal}: voice gain은 bus에 연결`);
  }

  const firstStart = Math.min(...oscillators.flatMap((oscillator) => oscillator.starts));
  const lastStop = Math.max(...oscillators.flatMap((oscillator) => oscillator.stops));
  assert.ok(Math.abs(lastStop - firstStart - expected.durationSec) < 1e-9, `${signal}: 전체 길이`);

  for (let i = 0; i < voiceGains.length; i += 1) {
    const start = oscillators[i].starts[0];
    const attack = lastEvent(voiceGains[i].gain, "linearRampToValueAtTime");
    if (expected.attackMs === 0) {
      assert.equal(attack, undefined, `${signal}: 0ms attack은 ramp를 만들지 않음`);
      const peak = voiceGains[i].gain.events.filter((event) => event.method === "setValueAtTime")[1];
      assert.equal(peak.time, start, `${signal}: peak는 시작 시각에 즉시 설정`);
    } else {
      assert.ok(attack, `${signal}: attack ramp 존재`);
      assert.ok(Math.abs(attack.time - start - expected.attackMs / 1000) < 1e-9, `${signal}: attack 길이`);
    }
  }

  for (const oscillator of oscillators) oscillator.onended();
  for (const oscillator of oscillators) assert.equal(oscillator.disconnectCount, 1, `${signal}: oscillator 해제`);
  for (const gain of voiceGains) assert.equal(gain.disconnectCount, 1, `${signal}: voice gain 해제`);
  assert.equal(bus.disconnectCount, 1, `${signal}: bus 해제`);
}

globalThis.document = {
  createElement(name) {
    assert.equal(name, "audio");
    return { canPlayType: () => "probably" };
  },
};
globalThis.localStorage = {
  values: new Map(),
  getItem(key) {
    return this.values.get(key) ?? null;
  },
  setItem(key, value) {
    this.values.set(key, value);
  },
};
const fetchCalls = [];
globalThis.fetch = (url) => {
  fetchCalls.push(String(url));
  return new Promise(() => undefined);
};
globalThis.AudioContext = FakeAudioContext;

const unhandled = [];
const recordUnhandled = (reason) => unhandled.push(reason);
process.on("unhandledRejection", recordUnhandled);

try {
  const audio = await import("../src/game/audio.ts");

  audio.playBossSignal("avoid");
  audio.playBossSignal("gather");
  audio.playBossSignal("vulnerable");
  audio.setAudioVisibility(true);
  assert.equal(FakeAudioContext.instances.length, 0, "잠금 전에는 AudioContext를 만들지 않는다");

  audio.unlockAudio();
  const context = FakeAudioContext.instances[0];
  assert.ok(context, "unlock 후 AudioContext를 만든다");
  assert.equal(context.gains.length, 1, "unlock 후 master gain 하나를 만든다");
  assert.deepEqual(context.gains[0].connections, [context.destination], "master는 destination에 연결한다");
  assert.deepEqual(fetchCalls, ["/bgm/prepare.ogg"], "Node 검증에서는 같은 출처 루트의 준비곡만 먼저 요청한다");

  assertSignalGraph(audio, context, "avoid", { voices: 2, durationSec: 0.3, attackMs: 0 });
  assertSignalGraph(audio, context, "gather", { voices: 2, durationSec: 0.6, attackMs: 246 });
  assertSignalGraph(audio, context, "vulnerable", { voices: 4, durationSec: 0.9, attackMs: 3 });

  assert.equal(audio.toggleMute(), true, "toggleMute로 음소거한다");
  const mutedNodeCount = nodeCount(context);
  audio.playBossSignal("avoid");
  audio.playBossSignal("gather");
  audio.playBossSignal("vulnerable");
  assert.equal(nodeCount(context), mutedNodeCount, "음소거 중에는 신호 노드를 만들지 않는다");

  context.suspendBehavior = "reject";
  context.resumeBehavior = "reject";
  audio.setAudioVisibility(true);
  audio.setAudioVisibility(false);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(context.suspendCalls, 1, "hidden에서 suspend를 호출한다");
  assert.equal(context.resumeCalls, 1, "visible에서 resume를 호출한다");
  assert.equal(unhandled.length, 0, "visibility Promise 거부를 처리한다");

  context.suspendBehavior = "throw";
  context.resumeBehavior = "throw";
  assert.doesNotThrow(() => audio.setAudioVisibility(true), "동기 suspend 거부를 흡수한다");
  assert.doesNotThrow(() => audio.setAudioVisibility(false), "동기 resume 거부를 흡수한다");

  context.state = "suspended";
  context.resumeBehavior = "reject";
  const rejectedResumeCalls = context.resumeCalls;
  audio.unlockAudio();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(context.resumeCalls, rejectedResumeCalls + 1, "재입력은 suspended context를 재개한다");
  assert.equal(unhandled.length, 0, "재입력 resume Promise 거부를 처리한다");

  context.resumeBehavior = "throw";
  const thrownResumeCalls = context.resumeCalls;
  assert.doesNotThrow(() => audio.unlockAudio(), "재입력의 동기 resume 거부를 흡수한다");
  assert.equal(context.resumeCalls, thrownResumeCalls + 1, "동기 거부여도 resume를 한 번 시도한다");

  console.log("audio runtime tests passed");
} finally {
  process.off("unhandledRejection", recordUnhandled);
}
