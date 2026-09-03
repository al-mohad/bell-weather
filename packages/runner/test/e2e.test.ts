import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Budget, createLogger } from '@bellwether/core';
import { SimDriver } from '@bellwether/solari';
import { customerCreditLimit, baselineCreditLimits } from '@bellwether/verifiers';
import { runTrial } from '../src/trial';
import type { Task } from '../src/task';

const scriptedAgent = fileURLToPath(
  new URL('../../../agents/scripted-baseline/src/main.ts', import.meta.url),
);

const task: Task = {
  id: 'sim-cust-01',
  title: 'e2e',
  tier: 'basic',
  surface: 'desktop',
  requires: 'sim',
  goal: 'In the customer maintenance screen, set the credit limit for customer 1002 to 42000.00 and commit the change.',
  env: { template: 'sim-erp5250' },
  maxSteps: 40,
  verify: customerCreditLimit('1002', 4_200_000, baselineCreditLimits()),
  fixtures: { passing: { name: 'p', truth: () => ({}) as never }, failing: [] },
};

/**
 * Exercises the whole loop for real: a child agent process, NDJSON framing, the
 * simulator, guardrails, the trace writer and a ground-truth verifier. If the
 * contract between any two of those breaks, this fails rather than a mocked unit.
 */
describe('end to end', () => {
  it('runs a trial through a real child agent and passes its verifier', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'bw-e2e-'));
    const result = await runTrial(task, {
      runId: 'run_test',
      runSeed: 1,
      trialIndex: 0,
      driver: new SimDriver(),
      agent: { name: 'scripted', command: 'node', args: ['--import', 'tsx', scriptedAgent] },
      budget: new Budget(40, 10),
      outDir,
      logger: createLogger('error'),
    });

    expect(result.status).toBe('pass');
    expect(result.outcome).toBe('done');
    expect(result.agent.name).toBe('scripted-baseline');
    expect(result.steps).toBeGreaterThan(3);

    const trace = readFileSync(join(result.tracePath, 'trace.jsonl'), 'utf8').trim().split('\n');
    expect(trace.length).toBe(result.steps);
    expect(JSON.parse(trace[0] as string)).toHaveProperty('framePath');
    expect(
      JSON.parse(readFileSync(join(result.tracePath, 'verdict.json'), 'utf8')).verdict.pass,
    ).toBe(true);
  }, 60_000);

  it('records a void trial when the agent process cannot start', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'bw-e2e-'));
    const result = await runTrial(task, {
      runId: 'run_test',
      runSeed: 1,
      trialIndex: 1,
      driver: new SimDriver(),
      agent: { name: 'broken', command: 'definitely-not-a-binary', args: [] },
      budget: new Budget(40, 10),
      outDir,
      logger: createLogger('error'),
    });
    expect(result.status).toBe('void');
    expect(result.voidReason).toBeTruthy();
  }, 30_000);
});
