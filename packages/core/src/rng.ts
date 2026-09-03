/**
 * Deterministic RNG. Every stochastic decision in Bellwether - fault injection,
 * flaky-agent misclicks, tie-breaking - draws from one of these, seeded from
 * (runSeed, taskId, trialIndex). Two runs with the same seed produce byte-identical
 * traces, which is what makes a published pass^k number auditable.
 */
export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform integer in [min, max]. */
  int(min: number, max: number): number;
  /** True with probability p. */
  chance(p: number): boolean;
  pick<T>(items: readonly T[]): T;
}

/** mulberry32 - small, fast, good enough for test scaffolding, fully portable. */
export function makeRng(seed: number): Rng {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    chance: (p) => next() < p,
    pick: <T>(items: readonly T[]): T => {
      if (items.length === 0) throw new Error('pick() on empty array');
      return items[Math.floor(next() * items.length)] as T;
    },
  };
}

/** FNV-1a. Stable across processes and languages, unlike Object hashing. */
export function hashSeed(...parts: (string | number)[]): number {
  let hash = 0x811c9dc5;
  for (const part of parts) {
    const text = String(part);
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    hash ^= 0x2f;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Seed for one trial. Same run seed + task + index => same faults, every time. */
export function trialSeed(runSeed: number, taskId: string, trialIndex: number): number {
  return hashSeed(runSeed, taskId, trialIndex);
}
