import { describe, expect, it } from 'vitest';
import { Budget, BudgetExceededError, hashSeed, makeRng, trialSeed, trialSlug } from '../src/index';

describe('rng', () => {
  it('is reproducible from a seed', () => {
    const a = makeRng(42);
    const b = makeRng(42);
    expect(Array.from({ length: 8 }, () => a.next())).toEqual(
      Array.from({ length: 8 }, () => b.next()),
    );
  });

  it('separates streams for different seeds', () => {
    expect(makeRng(1).next()).not.toEqual(makeRng(2).next());
  });

  it('stays inside its bounds', () => {
    const rng = makeRng(7);
    for (let i = 0; i < 500; i++) {
      const value = rng.int(3, 9);
      expect(value).toBeGreaterThanOrEqual(3);
      expect(value).toBeLessThanOrEqual(9);
    }
  });
});

describe('trialSeed', () => {
  it('is stable across processes for the same coordinates', () => {
    expect(trialSeed(100, 'sim-po-01', 3)).toBe(trialSeed(100, 'sim-po-01', 3));
  });

  it('differs per trial index, so k attempts are independent', () => {
    const seeds = new Set([0, 1, 2, 3, 4].map((index) => trialSeed(100, 'sim-po-01', index)));
    expect(seeds.size).toBe(5);
  });

  it('differs per task, so two tasks do not share a fault schedule', () => {
    expect(trialSeed(100, 'sim-po-01', 0)).not.toBe(trialSeed(100, 'sim-po-02', 0));
  });

  it('hashes identically regardless of argument packing', () => {
    expect(hashSeed('a', 'bc')).not.toBe(hashSeed('ab', 'c'));
  });
});

describe('budget', () => {
  it('throws once the ceiling is crossed', () => {
    const budget = new Budget(10, 1);
    budget.chargeUsd(0.6);
    expect(() => budget.chargeUsd(0.5)).toThrow(BudgetExceededError);
  });

  it('reports what is left', () => {
    const budget = new Budget(10, 2);
    budget.chargeUsd(0.5);
    expect(budget.remainingUsd).toBeCloseTo(1.5);
  });
});

describe('ids', () => {
  it('produces filesystem-safe trial slugs', () => {
    expect(trialSlug('sim/po:01', 2)).toBe('sim_po_01-t2');
  });
});
