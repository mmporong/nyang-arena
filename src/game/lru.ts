export interface LruCacheOptions<Value> {
  maxEntries: number;
  maxWeight?: number;
  weight?: (value: Value) => number;
}

/**
 * Map의 삽입 순서를 이용한 작고 결정적인 LRU. get은 최근 사용 순서를 갱신하고,
 * set은 엔트리 수와 가중치 상한을 모두 만족할 때만 값을 보관한다.
 */
export class BoundedLru<Key, Value> {
  readonly maxEntries: number;
  readonly maxWeight: number;

  readonly #weightOf: (value: Value) => number;
  readonly #entries = new Map<Key, { value: Value; weight: number }>();
  #weight = 0;

  constructor(options: LruCacheOptions<Value>) {
    if (!Number.isInteger(options.maxEntries) || options.maxEntries < 1) {
      throw new RangeError("maxEntries must be a positive integer");
    }
    const maxWeight = options.maxWeight ?? Number.POSITIVE_INFINITY;
    if (!(maxWeight > 0) || Number.isNaN(maxWeight)) {
      throw new RangeError("maxWeight must be positive");
    }
    this.maxEntries = options.maxEntries;
    this.maxWeight = maxWeight;
    this.#weightOf = options.weight ?? (() => 1);
  }

  get size(): number {
    return this.#entries.size;
  }

  get weight(): number {
    return this.#weight;
  }

  has(key: Key): boolean {
    return this.#entries.has(key);
  }

  get(key: Key): Value | undefined {
    const hit = this.#entries.get(key);
    if (!hit) return undefined;
    this.#entries.delete(key);
    this.#entries.set(key, hit);
    return hit.value;
  }

  set(key: Key, value: Value): boolean {
    const weight = this.#weightOf(value);
    if (!Number.isFinite(weight) || weight < 0) {
      throw new RangeError("entry weight must be a finite non-negative number");
    }
    if (weight > this.maxWeight) return false;

    const previous = this.#entries.get(key);
    if (previous) {
      this.#entries.delete(key);
      this.#weight -= previous.weight;
    }
    while (this.#entries.size >= this.maxEntries || this.#weight + weight > this.maxWeight) {
      const oldest = this.#entries.keys().next();
      if (oldest.done) break;
      const evicted = this.#entries.get(oldest.value)!;
      this.#entries.delete(oldest.value);
      this.#weight -= evicted.weight;
    }
    this.#entries.set(key, { value, weight });
    this.#weight += weight;
    return true;
  }

  keys(): IterableIterator<Key> {
    return this.#entries.keys();
  }
}
