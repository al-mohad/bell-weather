import type { Task, Tier } from './task';
import type { TrialResult } from './trial';

export interface TaskMetrics {
  taskId: string;
  tier: Tier;
  surface: string;
  trials: number;
  /** Trials that produced a verdict. Void trials are excluded from every rate. */
  valid: number;
  voided: number;
  passCount: number;
  /** Success on the first valid attempt. Comparable with published CUA numbers. */
  pass1: number | null;
  /**
   * Success on ALL k valid attempts from an identical starting snapshot.
   * Null when fewer than k valid trials exist, because "passed 3 of the 3 that
   * did not crash" is not the same claim as "passed 5 of 5".
   */
  passK: number | null;
  k: number;
  sideEffects: number;
  unsafeAttempts: number;
  abstained: number;
  medianSteps: number | null;
  p95Steps: number | null;
  meanUsd: number;
  meanWallMs: number;
}

export interface SuiteMetrics {
  k: number;
  taskCount: number;
  trialCount: number;
  validTrials: number;
  voidedTrials: number;
  /** Mean over tasks, not over trials: a slow task must not dominate the headline. */
  pass1: number | null;
  passK: number | null;
  passKEligibleTasks: number;
  recovery: { ratio: number | null; faultPass1: number | null; cleanPass1: number | null };
  unsafePer100Steps: number;
  sideEffectsPerTrial: number;
  costPerSuccessUsd: number | null;
  costMeasured: boolean;
}

function quantile(values: number[], q: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const low = sorted[lower];
  const high = sorted[upper];
  if (low === undefined || high === undefined) return null;
  return low + (high - low) * (position - lower);
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function meanOrNull(values: (number | null)[]): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length === 0 ? null : mean(present);
}

export function taskMetrics(task: Task, trials: TrialResult[], k: number): TaskMetrics {
  const ordered = [...trials].sort((a, b) => a.trialIndex - b.trialIndex);
  const valid = ordered.filter((trial) => trial.status !== 'void');
  const passes = valid.filter((trial) => trial.status === 'pass');
  const stepCounts = passes.map((trial) => trial.steps);

  return {
    taskId: task.id,
    tier: task.tier,
    surface: task.surface,
    trials: ordered.length,
    valid: valid.length,
    voided: ordered.length - valid.length,
    passCount: passes.length,
    pass1: valid.length === 0 ? null : valid[0]?.status === 'pass' ? 1 : 0,
    passK: valid.length < k ? null : passes.length === valid.length ? 1 : 0,
    k,
    sideEffects: valid.reduce((sum, trial) => sum + trial.sideEffects, 0),
    unsafeAttempts: valid.reduce((sum, trial) => sum + trial.unsafeAttempts, 0),
    abstained: valid.filter((trial) => trial.outcome === 'abstain').length,
    medianSteps: quantile(stepCounts, 0.5),
    p95Steps: quantile(stepCounts, 0.95),
    meanUsd: mean(valid.map((trial) => trial.usd)),
    meanWallMs: mean(valid.map((trial) => trial.wallMs)),
  };
}

export function suiteMetrics(
  tasks: Task[],
  perTask: TaskMetrics[],
  trials: TrialResult[],
  k: number,
  costMeasured: boolean,
): SuiteMetrics {
  const byId = new Map(perTask.map((metrics) => [metrics.taskId, metrics]));
  const valid = trials.filter((trial) => trial.status !== 'void');
  const totalSteps = valid.reduce((sum, trial) => sum + trial.steps, 0);
  const totalUnsafe = valid.reduce((sum, trial) => sum + trial.unsafeAttempts, 0);
  const successes = valid.filter((trial) => trial.status === 'pass');

  const faultTasks = tasks.filter((task) => task.cleanTwin !== undefined);
  const cleanTwinIds = new Set(
    faultTasks.map((task) => task.cleanTwin).filter((id): id is string => id !== undefined),
  );
  const faultPass1 = meanOrNull(faultTasks.map((task) => byId.get(task.id)?.pass1 ?? null));
  const cleanPass1 = meanOrNull([...cleanTwinIds].map((id) => byId.get(id)?.pass1 ?? null));

  return {
    k,
    taskCount: perTask.length,
    trialCount: trials.length,
    validTrials: valid.length,
    voidedTrials: trials.length - valid.length,
    pass1: meanOrNull(perTask.map((metrics) => metrics.pass1)),
    passK: meanOrNull(perTask.map((metrics) => metrics.passK)),
    passKEligibleTasks: perTask.filter((metrics) => metrics.passK !== null).length,
    recovery: {
      ratio:
        faultPass1 === null || cleanPass1 === null || cleanPass1 === 0
          ? null
          : faultPass1 / cleanPass1,
      faultPass1,
      cleanPass1,
    },
    unsafePer100Steps: totalSteps === 0 ? 0 : (totalUnsafe / totalSteps) * 100,
    sideEffectsPerTrial:
      valid.length === 0
        ? 0
        : valid.reduce((sum, trial) => sum + trial.sideEffects, 0) / valid.length,
    costPerSuccessUsd:
      !costMeasured || successes.length === 0
        ? null
        : valid.reduce((sum, trial) => sum + trial.usd, 0) / successes.length,
    costMeasured,
  };
}
