/**
 * 음악.
 *
 * 규칙 하나가 이 파일의 모양을 거의 다 정한다 — **소리는 게임 로직에 못 들어간다.**
 * 헤드리스 하네스(`npm run sim`)가 브라우저 없이 같은 `stepBattle`을 300번 돌리는데
 * 거기엔 AudioContext가 없다. 그래서 `battle.ts`도 `run.ts`도 이 파일을 부르지
 * 않는다. 상태를 **밖에서 관찰**해서 `main.ts`가 튼다. 막(curtain)이 이미 쓰는
 * 방식과 같다.
 *
 * ## 자동재생
 *
 * 브라우저는 사용자 입력 전에는 소리를 안 낸다. 그래서 `unlockAudio()`가 첫
 * 탭·첫 키에서 불린다. 그 전에 `setBed()`가 불려도 죽지 않고 **원하는 곡을
 * 기억만 해 둔다** — 잠금이 풀리는 순간 그 곡이 시작된다.
 *
 * ## 요청
 *
 * `fetch`를 쓴다. 스프라이트 48장을 이미 같은 출처에서 받고 있고, 제출 조건은
 * "요청 0건"이 아니라 **"외부 요청 0건"**이다. 여기서 부르는 주소는 전부
 * `import.meta.env.BASE_URL` 아래, 즉 게임이 올라간 그 자리다.
 *
 * base64로 모듈에 박아 `fetch(` 문자열을 없앨 수도 있었지만 그건 grep을
 * 통과하려고 구조를 비트는 것이고, 청크 요청은 그대로 나가므로 실제로 달라지는
 * 게 없다. 용량만 33% 붇는다.
 */

/* ------------------------------------------------------------------ */
/* 곡                                                                   */
/* ------------------------------------------------------------------ */

export type TrackName = "prepare" | "boss" | "title" | "outro";

interface Track {
  /**
   * 루프 길이(초). null이면 원샷.
   *
   * 파일 길이를 그냥 쓰지 않고 **여기 박아 두는 이유**는 MP3 폴백 때문이다.
   * MP3는 인코더가 앞뒤에 패딩을 붙여서 디코딩된 버퍼가 원본보다 길다. 버퍼
   * 끝까지 재생하면 그 패딩만큼 정적이 끼어 루프가 절뚝인다. `loopEnd`를
   * 실제 음악 길이로 못박으면 그 구간을 안 밟는다.
   *
   * 값은 마디에 맞춰 자른 결과다 — 준비곡 8마디(71.8 BPM), 보스곡 12마디(132.5 BPM).
   */
  loop: number | null;
  gain: number;
}

const TRACKS: Record<TrackName, Track> = {
  prepare: { loop: 26.740907, gain: 1 },
  boss: { loop: 21.735828, gain: 1 },
  title: { loop: null, gain: 0.9 },
  outro: { loop: null, gain: 1 },
};

/** 음악 전체 음량. 효과음이 위에 앉을 자리를 남긴다(곡은 -20dBFS로 맞춰 뒀다). */
const MASTER = 0.85;
/** 준비곡 ↔ 보스곡 전환. 둘 다 A#(B♭)이라 겹쳐도 부딪히지 않는다(측정: -1.7dB). */
const CROSSFADE = 0.8;
const MUTE_KEY = "nyang.muted";

/* ------------------------------------------------------------------ */
/* 상태                                                                 */
/* ------------------------------------------------------------------ */

let ac: AudioContext | null = null;
let master: GainNode | null = null;
let muted = readMuted();

const buffers = new Map<TrackName, AudioBuffer>();
const jobs = new Map<TrackName, Promise<void>>();

interface Playing {
  name: TrackName;
  src: AudioBufferSourceNode;
  gain: GainNode;
}
let bed: Playing | null = null;
/**
 * 지금 **틀고 싶은** 곡. 실제로 트는 것(`bed`)과 다를 수 있다.
 *
 * 잠금이 아직 안 풀렸거나 파일이 아직 안 왔을 때 여기 남는다. 둘 중 하나가
 * 해결되는 순간 이 값을 보고 시작한다. 이게 없으면 "받는 동안 국면이 또
 * 바뀌었는데 옛날 곡이 뒤늦게 시작되는" 일이 난다.
 */
let wanted: TrackName | null = null;

/** Vorbis를 못 여는 브라우저(사파리 17 미만)는 MP3로 받는다. */
const EXT = (() => {
  try {
    const probe = document.createElement("audio");
    return probe.canPlayType('audio/ogg; codecs="vorbis"') !== "" ? "ogg" : "mp3";
  } catch {
    return "mp3";
  }
})();

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    // 사생활 모드에서 localStorage가 던진다. 음소거 기억을 못 할 뿐이다.
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* 잠금 해제                                                            */
/* ------------------------------------------------------------------ */

/**
 * 첫 사용자 입력에서 부른다. 두 번째부터는 사실상 공짜다.
 *
 * 여기서 곡을 **한 번에 다 받지 않는다.** 준비곡부터 받아 바로 틀고, 그게
 * 끝나면 나머지를 뒤로 받는다. 보스곡은 보스 칸을 밟기까지 최소 몇 걸음이
 * 남아 있고, 부검곡은 죽어야 쓴다 — 급할 이유가 없다.
 */
export function unlockAudio(): void {
  if (ac) {
    if (ac.state === "suspended") void ac.resume();
    return;
  }
  try {
    ac = new AudioContext();
  } catch {
    return; // AudioContext가 없는 환경. 게임은 그대로 돈다
  }
  master = ac.createGain();
  master.gain.value = muted ? 0 : MASTER;
  master.connect(ac.destination);

  void load(wanted ?? "prepare").then(() => {
    for (const n of ["prepare", "title", "boss", "outro"] as TrackName[]) void load(n);
  });
}

/* ------------------------------------------------------------------ */
/* 로딩                                                                 */
/* ------------------------------------------------------------------ */

function load(name: TrackName): Promise<void> {
  const hit = jobs.get(name);
  if (hit) return hit;

  const job = (async () => {
    if (!ac) return;
    const url = `${import.meta.env.BASE_URL}bgm/${name}.${EXT}`;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(String(res.status));
      buffers.set(name, await ac.decodeAudioData(await res.arrayBuffer()));
      // 받는 동안 이 곡이 필요해졌을 수 있다.
      if (wanted === name && bed?.name !== name) startBed(name);
    } catch {
      // 한 곡 실패해도 게임은 돈다. 스프라이트와 같은 원칙이다.
      console.warn(`음악 로드 실패: ${name}`);
    } finally {
      /**
       * **실패했으면 기록을 지운다.**
       *
       * 안 지우면 `jobs`에 이미 resolve된 Promise가 남고, 다음 요청이 그걸
       * 그대로 돌려받아 즉시 끝난다 — fetch를 다시 하지 않는다. 네트워크가
       * 한 번 끊겼을 뿐인데 그 곡은 **세션 내내 침묵**한다.
       */
      if (!buffers.has(name)) jobs.delete(name);
    }
  })();

  jobs.set(name, job);
  return job;
}

/* ------------------------------------------------------------------ */
/* 재생                                                                 */
/* ------------------------------------------------------------------ */

/**
 * 등파워 페이드 곡선.
 *
 * 선형으로 겹치면 가운데서 3dB 꺼진다 — 두 곡이 상관없는 소리일 때 합쳐진
 * 에너지가 진폭의 합이 아니라 제곱합의 제곱근이기 때문이다. 보스가 등장하는
 * 순간에 음악이 잠깐 주저앉으면 그 순간의 무게가 깎인다.
 */
const FADE_STEPS = 24;
function fadeCurve(from: number, to: number): Float32Array {
  const c = new Float32Array(FADE_STEPS);
  for (let i = 0; i < FADE_STEPS; i++) {
    const t = i / (FADE_STEPS - 1);
    c[i] = Math.sqrt(from * from * (1 - t) + to * to * t);
  }
  return c;
}

/**
 * 게인을 지금 값에서 `to`로 끈다.
 *
 * `setValueCurveAtTime`은 **이미 걸린 커브와 겹치면 `NotSupportedError`를 던진다.**
 * 그 예외가 이벤트 핸들러까지 올라가면 음악 하나 때문에 입력 처리가 죽는다.
 *
 * 크로미움은 `cancelScheduledValues`가 진행 중인 커브까지 지워 줘서 실제로는
 * 안 던진다(브라우저에서 확인함). 하지만 스펙을 엄격히 읽으면 취소 시각보다
 * **먼저 시작한** 자동화는 남는다 — 다른 엔진에서 어떻게 될지는 여기서 확인할
 * 수 없다. 0.8초 안에 곡이 두 번 바뀌거나 음소거를 연타하면 그 자리다.
 *
 * 등파워 커브를 먼저 시도하고, 거부당하면 선형 램프로 물러선다. 선형은 겹쳐도
 * 예외를 안 던진다 — 전환 한 번이 3dB 주저앉는 것이 게임이 멈추는 것보다 낫다.
 */
function ramp(param: AudioParam, to: number, dur: number): void {
  if (!ac) return;
  const t = ac.currentTime;
  const from = param.value;
  try {
    param.cancelScheduledValues(t);
    param.setValueCurveAtTime(fadeCurve(from, to), t, dur);
  } catch {
    try {
      param.cancelScheduledValues(t);
      param.setValueAtTime(from, t);
      param.linearRampToValueAtTime(to, t + dur);
    } catch {
      param.value = to;
    }
  }
}

function fadeOutAndStop(p: Playing): void {
  if (!ac) return;
  ramp(p.gain.gain, 0, CROSSFADE);
  /**
   * **멈추는 것은 페이드와 별개로 반드시 한다.**
   *
   * 예전에는 둘을 한 try 안에 뒀는데, 페이드가 던지면 `stop()`에 못 갔다.
   * 루프 곡이 안 멈추면 새 곡과 **겹쳐서 영원히** 난다 — 조용해지는 것보다
   * 나쁘다.
   */
  try {
    p.src.stop(ac.currentTime + CROSSFADE + 0.05);
  } catch {
    // 이미 끝난 원샷을 다시 멈추려 하면 던진다. 끝난 건 끝난 거다.
  }
}

/** 끝난 노드는 그래프에서 뗀다. 안 떼면 판이 길어질수록 게인 노드가 쌓인다. */
function releaseOnEnd(src: AudioBufferSourceNode, gain: GainNode): void {
  src.onended = () => {
    try {
      src.disconnect();
      gain.disconnect();
    } catch {
      // 이미 떼였다
    }
  };
}

function startBed(name: TrackName): void {
  if (!ac || !master) return;
  const buf = buffers.get(name);
  if (!buf || bed?.name === name) return;

  const spec = TRACKS[name];
  const gain = ac.createGain();
  gain.gain.value = 0;
  gain.connect(master);

  const src = ac.createBufferSource();
  src.buffer = buf;
  if (spec.loop !== null) {
    src.loop = true;
    src.loopStart = 0;
    src.loopEnd = spec.loop;
  }
  src.connect(gain);
  releaseOnEnd(src, gain);

  // **옛 곡을 먼저 재운다.** 새 곡을 먼저 틀어 놓고 재우다 실패하면 둘이
  // 겹쳐서 난다. 순서를 이렇게 두면 최악의 경우에도 한쪽만 난다.
  if (bed) fadeOutAndStop(bed);

  src.start();
  ramp(gain.gain, spec.gain, CROSSFADE);
  bed = { name, src, gain };
}

/**
 * 지금 깔릴 곡. 같은 곡을 다시 부르면 아무 일도 안 일어난다 —
 * **매 프레임 불러도 안전하다.**
 *
 * 그래야 부르는 쪽이 "국면이 바뀌었나"를 따로 기억하지 않는다. 그 기억을
 * 양쪽에 두면 언젠가 갈라진다.
 */
export function setBed(name: TrackName | null): void {
  if (wanted === name) return;
  wanted = name;

  if (!ac) return; // 아직 잠겨 있다. unlockAudio가 이 값을 보고 시작한다
  if (name === null) {
    if (bed) fadeOutAndStop(bed);
    bed = null;
    return;
  }
  if (buffers.has(name)) startBed(name);
  else void load(name);
}

/** 원샷. 깔린 곡 위에 얹는다(타이틀 스팅). */
export function playSting(name: TrackName): void {
  if (!ac || !master) return;
  const buf = buffers.get(name);
  if (!buf) return;
  const gain = ac.createGain();
  gain.gain.value = TRACKS[name].gain;
  gain.connect(master);
  const src = ac.createBufferSource();
  src.buffer = buf;
  src.connect(gain);
  releaseOnEnd(src, gain);
  src.start();
}

/* ------------------------------------------------------------------ */
/* 음소거                                                               */
/* ------------------------------------------------------------------ */

export function isMuted(): boolean {
  return muted;
}

/** 브라우저 게임은 소리부터 끄는 사람이 많다. 선택은 기억한다(네트워크 아님). */
export function toggleMute(): boolean {
  // 소리를 **먼저** 바꾸고 플래그를 나중에 뒤집는다. 반대로 하면 게인 조작이
  // 실패했을 때 아이콘은 꺼진 모양인데 소리는 계속 나는 상태가 되고,
  // 그 어긋난 값이 localStorage에 저장돼 새로고침해도 안 맞는다.
  const next = !muted;
  if (ac && master) ramp(master.gain, next ? 0 : MASTER, 0.15);
  muted = next;
  try {
    localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  } catch {
    // 기억을 못 할 뿐, 이번 판에는 적용된다
  }
  return muted;
}
