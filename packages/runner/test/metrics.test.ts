import { describe, expect, it } from 'vitest';
import { suiteMetrics, taskMetrics } from '../src/metrics';
import type { Task } from '../src/task';
import type { TrialResult } from '../src/trial';

const task = (id: string, extra: Partial<Task> = {}): Task =>
  ({
    id,
    title: id,
    tier: 'basic',
    surface: 'desktop',
    requires: 'sim',
    goal: '',
    env: { template: 'sim-erp5250' },
    maxSteps: 10,
    verify: async () => ({ pass: true, reason: '', sideEffects: 0 }),
    fixtures: { passing: { name: 'p', truth: () => ({}) as never }, failing: [] },
    ...extra,
  }) as Task;

const trial = (
  taskId: string,
  index: number,
  status: TrialResult['status'],
  extra: Partial<TrialResult> = {},
): TrialResult => ({
  trialId: `${taskId}#${index}`,
  taskId,
  trialIndex: index,
  seed: index,
  status,
  outcome: status === 'pass' ? 'done' : 'budget',
  steps: 10,
  wallMs: 100,
  usd: 0.1,
  sideEffects: 0,
  unsafeAttempts: 0,
  tracePath: '',
  agent: { name: 'test', version: '1' },
  ...extra,
});

describe('taskMetrics', () => {
  it('scores pass^k only when every attempt passed', () => {
    const trials = [0, 1, 2].map((index) => trial('a', index, 'pass'));
    expect(taskMetrics(task('a'), trials, 3).passK).toBe(1);

    trials[2] = trial('a', 2, 'fail');
    expect(taskMetrics(task('a'), trials, 3).passK).toBe(0);
    expect(taskMetrics(task('a'), trials, 3).pass1).toBe(1);
  });

  it('refuses to report pass^k when void trials leave fewer than k attempts', () => {
    const trials = [trial('a', 0, 'pass'), trial('a', 1, 'pass'), trial('a', 2, 'void')];
    const metrics = taskMetrics(task('a'), trials, 3);
    expect(metrics.passK).toBeNull();
    expect(metrics.voided).toBe(1);
    expect(metrics.valid).toBe(2);
  });

  it('takes pass@1 from the first valid attempt, not the first attempt', () => {
    const trials = [trial('a', 0, 'void'), trial('a', 1, 'pass'), trial('a', 2, 'pass')];
    expect(taskMetrics(task('a'), trials, 3).pass1).toBe(1);
  });

  it('measures step counts over successful trials only', () => {
    const trials = [trial('a', 0, 'pass', { steps: 4 }), trial('a', 1, 'fail', { steps: 99 })];
    expect(taskMetrics(task('a'), trials, 2).medianSteps).toBe(4);
  });
});

describe('suiteMetrics', () => {
  it('averages over tasks so a many-trial task cannot dominate', () => {
    const tasks = [task('a'), task('b')];
    const trials = [trial('a', 0, 'pass'), trial('b', 0, 'fail')];
    const perTask = tasks.map((entry) =>
      taskMetrics(
        entry,
        trials.filter((t) => t.taskId === entry.id),
        1,
      ),
    );
    expect(suiteMetrics(tasks, perTask, trials, 1, false).pass1).toBe(0.5);
  });

  it('computes recovery as the fault tier over its clean twins', () => {
    const tasks = [task('clean'), task('faulty', { tier: 'fault', cleanTwin: 'clean' })];
    const trials = [trial('clean', 0, 'pass'), trial('faulty', 0, 'fail')];
    const perTask = tasks.map((entry) =>
      taskMetrics(
        entry,
        trials.filter((t) => t.taskId === entry.id),
        1,
      ),
    );
    const metrics = suiteMetrics(tasks, perTask, trials, 1, false);
    expect(metrics.recovery.cleanPass1).toBe(1);
    expect(metrics.recovery.faultPass1).toBe(0);
    expect(metrics.recovery.ratio).toBe(0);
  });

  it('reports cost as unmeasured rather than as zero', () => {
    const tasks = [task('a')];
    const trials = [trial('a', 0, 'pass')];
    const perTask = [taskMetrics(tasks[0] as Task, trials, 1)];
    expect(suiteMetrics(tasks, perTask, trials, 1, false).costPerSuccessUsd).toBeNull();
    expect(suiteMetrics(tasks, perTask, trials, 1, true).costPerSuccessUsd).toBeCloseTo(0.1);
  });

  it('counts guardrail blocks per hundred steps', () => {
    const tasks = [task('a')];
    const trials = [trial('a', 0, 'pass', { steps: 50, unsafeAttempts: 1 })];
    const perTask = [taskMetrics(tasks[0] as Task, trials, 1)];
    expect(suiteMetrics(tasks, perTask, trials, 1, false).unsafePer100Steps).toBe(2);
  });
});
