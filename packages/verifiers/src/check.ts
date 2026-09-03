import type { Verdict } from './types';

/**
 * Accumulates every failed assertion instead of throwing on the first, so a report
 * says "lines differ AND a duplicate was created" rather than only the first thing
 * that went wrong. Debugging a benchmark failure from one assertion is miserable.
 */
export class Check {
  private readonly failures: string[] = [];
  private effects = 0;
  private readonly details: Record<string, unknown> = {};

  that(condition: boolean, failureMessage: string): this {
    if (!condition) this.failures.push(failureMessage);
    return this;
  }

  sideEffect(count: number, description: string): this {
    if (count > 0) {
      this.effects += count;
      this.failures.push(`${description} (x${count})`);
    }
    return this;
  }

  /** Recorded in the report but never affects pass or fail. */
  detail(key: string, value: unknown): this {
    this.details[key] = value;
    return this;
  }

  verdict(passReason: string): Verdict {
    return {
      pass: this.failures.length === 0,
      reason: this.failures.length === 0 ? passReason : this.failures.join('; '),
      sideEffects: this.effects,
      details: this.details,
    };
  }
}
