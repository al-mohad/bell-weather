import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createLogger } from '@bellwether/core';
import { SimDriver } from '@bellwether/solari';
import { baselineCreditLimits, customerCreditLimit, simGroundTruth } from '@bellwether/verifiers';
import { runSuite } from '../src/suite';
import type { Suite, Task } from '../src/task';
import { selectTasks } from '../src/task';

const scriptedAgent = fileURLToPath(
  new URL('../../../agents/scripted-baseline/src/main.ts', import.meta.url),
);
const agent = { name: 'scripted', command: 'node', args: ['--import', 'tsx', scriptedAgent] };

const creditTask: Task = {
  id: 'sim-cust-01',
  title: 'credit limit',
  tier: 'basic',
  surface: 'desktop',
  requires: 'sim',
  goal: 'In the customer maintenance screen, set the credit limit for customer 1002 to 42000.00 and commit the change.',
  env: { template: 'sim-erp5250' },
  maxSteps: 40,
  verify: customerCreditLimit('1002', 4_200_000, baselineCreditLimits()),
  fixtures: { passing: { name: 'p', truth: () => simGroundTruth() }, failing: [] },
};

const liveOnlyTask: Task = { ...creditTask, id: 'live-only', requires: 'live', surface: 'browser' };

const suite: Suite = { id: 'test', title: 'test suite', tasks: [creditTask, liveOnlyTask] };

describe('selectTasks', () => {
  it('skips tasks the driver cannot honestly run, with a reason', () => {
    const { selected, skipped } = selectTasks(suite, { driver: 'sim' });
    expect(selected.map((task) => task.id)).toEqual(['sim-cust-01']);
    expect(skipped[0]).toMatchObject({ reason: 'requires --driver live' });
  });

  it('filters by tier and surface', () => {
    expect(selectTasks(suite, { driver: 'sim', tiers: ['fault'] }).selected).toHaveLength(0);
    expect(selectTasks(suite, { driver: 'live', surface: 'browser' }).selected).toHaveLength(1);
  });
});

describe('runSuite', () => {
  it('runs k trials per task, writes results.json and reports skips', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'bw-suite-'));
    const result = await runSuite(suite, {
      driver: new SimDriver(),
      agent,
      k: 2,
      runSeed: 7,
      concurrency: 2,
      outDir,
      logger: createLogger('error'),
    });

    expect(result.trials).toHaveLength(2);
    expect(result.metrics.k).toBe(2);
    expect(result.metrics.pass1).toBe(1);
    expect(result.metrics.passK).toBe(1);
    expect(result.metrics.voidedTrials).toBe(0);
    expect(result.skipped).toEqual([{ taskId: 'live-only', reason: 'requires --driver live' }]);
    expect(result.config).toMatchObject({ driver: 'sim', k: 2, runSeed: 7, costMeasured: false });

    expect(existsSync(join(outDir, 'results.json'))).toBe(true);
    const persisted = JSON.parse(readFileSync(join(outDir, 'results.json'), 'utf8'));
    expect(persisted.runId).toBe(result.runId);
  }, 120_000);

  it('is reproducible: the same seed yields the same per-trial seeds', async () => {
    const run = async (): Promise<number[]> => {
      const outDir = mkdtempSync(join(tmpdir(), 'bw-suite-'));
      const result = await runSuite(suite, {
        driver: new SimDriver(),
        agent,
        k: 2,
        runSeed: 4242,
        concurrency: 2,
        outDir,
        logger: createLogger('error'),
      });
      return result.trials.map((trial) => trial.seed);
    };
    expect(await run()).toEqual(await run());
  }, 180_000);
});
