/** 디버그 계측 전용 프레임 표본. 게임 상태와 렌더 결과에는 영향을 주지 않는다. */
export interface FramePerformanceObservation {
  phase: string;
  frameWorkMs: number;
  rafTimestampMs: number;
}

export interface PerformanceMetricSnapshot {
  sampleCount: number;
  p50Ms: number | null;
  p95Ms: number | null;
  maxMs: number | null;
  longCount: number;
  longRate: number;
}

export interface PerformanceScopeSnapshot {
  sampleCount: number;
  elapsedMs: number;
  cadenceHz: number | null;
  frameWorkMs: PerformanceMetricSnapshot;
  rafIntervalMs: PerformanceMetricSnapshot;
}

export interface FramePerformanceSnapshot extends PerformanceScopeSnapshot {
  capacity: number;
  longThresholdMs: number;
  phases: Readonly<Record<string, PerformanceScopeSnapshot>>;
}

export interface FramePerformanceObserver {
  observe(observation: FramePerformanceObservation): void;
  snapshot(): FramePerformanceSnapshot;
  clear(): void;
}

type StoredObservation = FramePerformanceObservation;

const DEFAULT_CAPACITY = 720;
const DEFAULT_LONG_THRESHOLD_MS = 16.7;

function requireFiniteNonNegative(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a finite non-negative number`);
  }
}

function nearestRank(sorted: readonly number[], percentile: number): number | null {
  if (sorted.length === 0) return null;
  const rank = Math.ceil(percentile * sorted.length);
  return sorted[Math.max(0, rank - 1)] ?? null;
}

function summarizeMetric(values: readonly number[], longThresholdMs: number): PerformanceMetricSnapshot {
  const sorted = [...values].sort((a, b) => a - b);
  const longCount = values.reduce((count, value) => count + Number(value > longThresholdMs), 0);
  return {
    sampleCount: values.length,
    p50Ms: nearestRank(sorted, 0.5),
    p95Ms: nearestRank(sorted, 0.95),
    maxMs: sorted.at(-1) ?? null,
    longCount,
    longRate: values.length === 0 ? 0 : longCount / values.length,
  };
}

function summarizeScope(
  observations: readonly StoredObservation[],
  longThresholdMs: number,
): PerformanceScopeSnapshot {
  const first = observations[0];
  const last = observations.at(-1);
  const elapsedMs = first && last ? last.rafTimestampMs - first.rafTimestampMs : 0;
  const intervalValues = observations.slice(1).map(
    (observation, index) => observation.rafTimestampMs - observations[index]!.rafTimestampMs,
  );
  return {
    sampleCount: observations.length,
    elapsedMs,
    cadenceHz:
      observations.length >= 2 && elapsedMs > 0 ? ((observations.length - 1) * 1000) / elapsedMs : null,
    frameWorkMs: summarizeMetric(
      observations.map((observation) => observation.frameWorkMs),
      longThresholdMs,
    ),
    rafIntervalMs: summarizeMetric(intervalValues, longThresholdMs),
  };
}

/**
 * 최근 프레임만 고정 용량으로 보관한다. 스냅샷 계산은 디버그 UI가 요청할 때만
 * 수행해 실제 프레임 루프의 관찰 비용과 게임 동작을 분리한다.
 */
export function createFramePerformanceObserver(options: {
  capacity?: number;
  longThresholdMs?: number;
} = {}): FramePerformanceObserver {
  const capacity = options.capacity ?? DEFAULT_CAPACITY;
  const longThresholdMs = options.longThresholdMs ?? DEFAULT_LONG_THRESHOLD_MS;
  if (!Number.isInteger(capacity) || capacity < 2) {
    throw new RangeError("capacity must be an integer of at least 2");
  }
  requireFiniteNonNegative("longThresholdMs", longThresholdMs);

  const ring = new Array<StoredObservation | undefined>(capacity);
  let head = 0;
  let size = 0;
  let previousRafTimestampMs: number | null = null;

  function chronological(): StoredObservation[] {
    const result: StoredObservation[] = [];
    for (let index = 0; index < size; index += 1) {
      const value = ring[(head + index) % capacity];
      if (value) result.push(value);
    }
    return result;
  }

  return {
    observe(observation): void {
      if (typeof observation.phase !== "string" || observation.phase.trim().length === 0) {
        throw new TypeError("phase must be a non-empty string");
      }
      requireFiniteNonNegative("frameWorkMs", observation.frameWorkMs);
      requireFiniteNonNegative("rafTimestampMs", observation.rafTimestampMs);
      const rafIntervalMs =
        previousRafTimestampMs === null ? null : observation.rafTimestampMs - previousRafTimestampMs;
      if (rafIntervalMs !== null) requireFiniteNonNegative("rafIntervalMs", rafIntervalMs);

      const stored: StoredObservation = { ...observation };
      if (size < capacity) {
        ring[(head + size) % capacity] = stored;
        size += 1;
      } else {
        ring[head] = stored;
        head = (head + 1) % capacity;
      }
      previousRafTimestampMs = observation.rafTimestampMs;
    },

    snapshot(): FramePerformanceSnapshot {
      const all = chronological();
      const byPhase = new Map<string, StoredObservation[]>();
      let previousPhase: string | null = null;
      for (const observation of all) {
        // 같은 phase가 다시 등장하면 앞 에피소드와의 공백을 이어 붙이지 않는다.
        // 각 phase의 가장 최근 연속 구간만 공개해 cadence/interval을 보존한다.
        if (observation.phase !== previousPhase) byPhase.set(observation.phase, []);
        const phase = byPhase.get(observation.phase)!;
        phase.push(observation);
        previousPhase = observation.phase;
      }
      return {
        ...summarizeScope(all, longThresholdMs),
        capacity,
        longThresholdMs,
        phases: Object.fromEntries(
          [...byPhase.entries()].map(([phase, observations]) => [
            phase,
            summarizeScope(observations, longThresholdMs),
          ]),
        ),
      };
    },

    clear(): void {
      ring.fill(undefined);
      head = 0;
      size = 0;
      previousRafTimestampMs = null;
    },
  };
}
