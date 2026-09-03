import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Budget, createLogger } from '@bellwether/core';
import { SimDriver } from '@bellwether/solari';
import { customerCreditLimit, baselineCreditLimits } from '@bellwether/verifiers';
import { runSuite } from '../src/suite';
import { runTrial } from '../src/trial';
import type { Suite, Task } from '../src/task';

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

    // The agent's stderr must survive even though it died before init returned. This
    // regressed once: without it, every spawn failure looked like an empty void trial
    // and the actual error - a syntax error in the agent - was unrecoverable.
    const stderr = readFileSync(join(result.tracePath, 'agent-stderr.log'), 'utf8');
    expect(stderr).toContain('definitely-not-a-binary');
  }, 30_000);
});

/**
 * A zero-dependency agent, written to a temp file, that claims to spend money.
 *
 * Doubles as proof that the protocol is implementable with nothing but a JSON
 * parser: this is the whole client, in plain Node, no imports from this repo.
 */
function spendthriftAgent(usdPerStep: number): string {
  const dir = mkdtempSync(join(tmpdir(), 'bw-agent-'));
  const file = join(dir, 'agent.mjs');
  // console.log rather than process.stdout.write: it appends the newline itself, so
  // the child source needs no escape sequence. A "\n" here would be collapsed by the
  // test file's own transform and the child would die on a syntax error.
  writeFileSync(
    file,
    `import { createInterface } from 'node:readline';
const usd = ${usdPerStep};
const send = (id, result) => console.log(JSON.stringify({ jsonrpc: '2.0', id, result }));
for await (const line of createInterface({ input: process.stdin })) {
  if (!line.trim()) continue;
  const request = JSON.parse(line);
  if (request.method === 'agent.init') {
    send(request.id, { agent: 'spendthrift', version: '1.0.0', protocol: '1.0' });
  } else if (request.method === 'agent.step') {
    send(request.id, { action: { kind: 'key', keys: 'F5' }, usage: { usd } });
  } else {
    send(request.id, {});
    if (request.method === 'agent.close') break;
  }
}
`,
  );
  return file;
}

describe('budget guard', () => {
  it('aborts the run rather than letting an agent spend past the ceiling', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'bw-budget-'));
    const suite: Suite = { id: 'budget', title: 'budget', tasks: [task] };

    const result = await runSuite(suite, {
      driver: new SimDriver(),
      agent: { name: 'spendthrift', command: 'node', args: [spendthriftAgent(0.4)] },
      k: 3,
      maxUsd: 1,
      concurrency: 1,
      outDir,
      logger: createLogger('error'),
    });

    expect(result.aborted).toMatch(/budget exceeded/);
    // A truncated run must never be presentable as a suite result.
    expect(result.metrics.passK).toBeNull();
  }, 60_000);

  it('lets a run inside the ceiling finish normally', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'bw-budget-'));
    const suite: Suite = { id: 'budget', title: 'budget', tasks: [{ ...task, maxSteps: 3 }] };

    const result = await runSuite(suite, {
      driver: new SimDriver(),
      agent: { name: 'spendthrift', command: 'node', args: [spendthriftAgent(0.001)] },
      k: 1,
      maxUsd: 5,
      concurrency: 1,
      outDir,
      logger: createLogger('error'),
    });

    expect(result.aborted).toBeUndefined();
    expect(result.trials[0]?.usd).toBeGreaterThan(0);
  }, 60_000);
});
