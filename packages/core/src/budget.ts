import { BudgetExceededError } from './errors';

export interface BudgetSnapshot {
  steps: number;
  usd: number;
  spentUsd: number;
  usedSteps: number;
}

/**
 * A hard ceiling, checked before every step and every trial. This exists because
 * an agent stuck in a click loop against a metered microVM is a four-figure
 * invoice, and CI must not be able to produce one.
 */
export class Budget {
  private spentUsd = 0;
  private usedSteps = 0;

  constructor(
    readonly maxStepsPerTrial: number,
    readonly maxUsd: number,
  ) {}

  chargeUsd(amount: number): void {
    this.spentUsd += amount;
    if (this.spentUsd > this.maxUsd) throw new BudgetExceededError(this.spentUsd, this.maxUsd);
  }

  countStep(): void {
    this.usedSteps += 1;
  }

  assertWithinLimit(): void {
    if (this.spentUsd > this.maxUsd) throw new BudgetExceededError(this.spentUsd, this.maxUsd);
  }

  get remainingUsd(): number {
    return Math.max(0, this.maxUsd - this.spentUsd);
  }

  snapshot(): BudgetSnapshot {
    return {
      steps: this.maxStepsPerTrial,
      usd: this.maxUsd,
      spentUsd: this.spentUsd,
      usedSteps: this.usedSteps,
    };
  }
}
