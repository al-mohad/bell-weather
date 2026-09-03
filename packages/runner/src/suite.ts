import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  Budget,
  BudgetExceededError,
  createLogger,
  hashSeed,
  runId as makeRunId,
} from '@bellwether/core';
import type { Logger } from '@bellwether/core';
import type { SolariDriver } from '@bellwether/solari';
import type { SurfaceKind } from '@bellwether/protocol';
import { selectTasks } from './task';
import type { Suite, Task, Tier } from './task';
import { runTrial } from './trial';
import type { TrialResult } from './trial';
import { suiteMetrics, taskMetrics } from './metrics';
import type { SuiteMetrics, TaskMetrics } from './metrics';
import { costIsMeasured, FREE } from './cost';
import type { CostModel } from './cost';
import type { AgentSpec } from './agent-client';

export interface RunOptions {
  driver: SolariDriver;
  agent: AgentSpec;
  k?: number;
  runSeed?: number;
  maxUsd?: number;
  concurrency?: number;
  cost?: CostModel;
  outDir: string;
  filters?: { tasks?: string[]; tiers?: Tier[]; surface?: SurfaceKind };
  logger?: Logger;
}

export interface RunResult {
  runId: string;
  suiteId: string;
  startedAt: string;
  finishedAt: string;
  config: {
    driver: string;
    agent: string;
    agentVersion: string;
    k: number;
    runSeed: number;
    maxUsd: number;
    concurrency: number;
    costMeasured: boolean;
    filters: RunOptions['filters'];
  };
  environment: { node: string; platform: string };
  skipped: { taskId: string; reason: string }[];
  tasks: TaskMetrics[];
  trials: TrialResult[];
  metrics: SuiteMetrics;
  /** Set when the run stopped early. A truncated run is never reported as complete. */
  aborted?: string;
}

/** Bounded-concurrency map that preserves input order in the output. */
async function pool<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index] as T, index);
    }
  });
  await Promise.all(runners);
  return results;
}

/**
 * Runs every selected task k times.
 *
 * Trials are independent by construction: each one forks the pinned snapshot, so
 * ordering and concurrency cannot leak state between attempts. That is the property
 * that makes pass^k mean what it says.
 */
export async function runSuite(suite: Suite, options: RunOptions): Promise<RunResult> {
  const logger = options.logger ?? createLogger();
  const k = options.k ?? 5;
  const runSeed = options.runSeed ?? hashSeed(suite.id, options.agent.name, '1');
  const maxUsd = options.maxUsd ?? Number(process.env.BELLWETHER_BUDGET_USD ?? 25);
  const concurrency = options.concurrency ?? 4;
  const cost = options.cost ?? FREE;
  const runId = makeRunId();
  const startedAt = new Date().toISOString();

  mkdirSync(options.outDir, { recursive: true });

  const { selected, skipped } = selectTasks(suite, {
    ...options.filters,
    driver: options.driver.name,
  });
  logger.info('run starting', {
    runId,
    suite: suite.id,
    driver: options.driver.name,
    agent: options.agent.name,
    tasks: selected.length,
    k,
    runSeed,
  });

  const budget = new Budget(
    Math.max(...selected.map((task) => task.maxSteps), 1),
    options.driver.metered ? maxUsd : maxUsd,
  );

  const jobs = selected.flatMap((task) =>
    Array.from({ length: k }, (_unused, trialIndex) => ({ task, trialIndex })),
  );

  let aborted: string | undefined;
  const trials: TrialResult[] = [];

  try {
    const results = await pool(jobs, concurrency, async ({ task, trialIndex }) =>
      runTrial(task, {
        runId,
        runSeed,
        trialIndex,
        driver: options.driver,
        agent: options.agent,
        budget,
        cost,
        outDir: options.outDir,
        logger,
      }),
    );
    trials.push(...results);
  } catch (error) {
    if (error instanceof BudgetExceededError) {
      aborted = error.message;
      logger.error('run aborted on budget', { reason: error.message });
    } else {
      throw error;
    }
  }

  const perTask: TaskMetrics[] = selected.map((task: Task) =>
    taskMetrics(
      task,
      trials.filter((trial) => trial.taskId === task.id),
      k,
    ),
  );

  const result: RunResult = {
    runId,
    suiteId: suite.id,
    startedAt,
    finishedAt: new Date().toISOString(),
    config: {
      driver: options.driver.name,
      agent: options.agent.name,
      agentVersion: trials[0]?.agent.version ?? 'unknown',
      k,
      runSeed,
      maxUsd,
      concurrency,
      costMeasured: costIsMeasured(cost),
      filters: options.filters,
    },
    environment: { node: process.version, platform: process.platform },
    skipped: skipped.map((entry) => ({ taskId: entry.task.id, reason: entry.reason })),
    tasks: perTask,
    trials: [...trials].sort((a, b) => a.trialId.localeCompare(b.trialId)),
    metrics: suiteMetrics(selected, perTask, trials, k, costIsMeasured(cost)),
    ...(aborted ? { aborted } : {}),
  };

  writeFileSync(join(options.outDir, 'results.json'), `${JSON.stringify(result, null, 2)}\n`);
  logger.info('run finished', {
    runId,
    pass1: result.metrics.pass1,
    passK: result.metrics.passK,
    voided: result.metrics.voidedTrials,
  });
  return result;
}
