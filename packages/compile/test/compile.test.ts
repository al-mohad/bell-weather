import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FlowCursor,
  assertionMatches,
  compileTrace,
  emitFlowModule,
  emitMcpServer,
  summarizeScreen,
} from '../src/index';

function traceDir(records: unknown[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'bw-trace-'));
  writeFileSync(
    join(dir, 'meta.json'),
    JSON.stringify({
      runId: 'run_1',
      trialId: 'sim-po-01#0',
      taskId: 'sim-po-01',
      surface: 'desktop',
    }),
  );
  writeFileSync(
    join(dir, 'trace.jsonl'),
    records.map((record) => JSON.stringify(record)).join('\n'),
  );
  return dir;
}

const screen = (title: string, message: string): string => `${title}\n\n  body\n${message}`;

describe('compileTrace', () => {
  it('keeps successful actions and drops terminal ones', () => {
    const flow = compileTrace(
      traceDir([
        {
          stepIndex: 0,
          framePath: 'f0.png',
          screenText: screen('MENU', 'READY'),
          action: { kind: 'type', text: '2' },
          result: { ok: true, tookMs: 1 },
        },
        {
          stepIndex: 1,
          framePath: 'f1.png',
          screenText: screen('MENU', 'READY'),
          action: { kind: 'key', keys: 'Enter' },
          result: { ok: true, tookMs: 1 },
        },
        {
          stepIndex: 2,
          framePath: 'f2.png',
          screenText: screen('MENU', 'DONE'),
          action: { kind: 'done' },
          result: { ok: true, tookMs: 1 },
        },
      ]),
    );
    expect(flow.steps).toHaveLength(2);
    expect(flow.taskId).toBe('sim-po-01');
  });

  it('never encodes an action the policy layer blocked', () => {
    const flow = compileTrace(
      traceDir([
        {
          stepIndex: 0,
          framePath: 'f0.png',
          screenText: screen('VENDORS', 'READY'),
          action: { kind: 'key', keys: 'F16' },
          blocked: { rule: 'denied-key', reason: 'no' },
        },
        {
          stepIndex: 1,
          framePath: 'f1.png',
          screenText: screen('VENDORS', 'READY'),
          action: { kind: 'key', keys: 'F3' },
          result: { ok: true, tookMs: 1 },
        },
      ]),
    );
    expect(flow.steps).toHaveLength(1);
    expect(flow.steps[0]?.action).toMatchObject({ keys: 'F3' });
  });

  it('hoists a literal into a named parameter', () => {
    const flow = compileTrace(
      traceDir([
        {
          stepIndex: 0,
          framePath: 'f0.png',
          screenText: screen('CUST', 'READY'),
          action: { kind: 'type', text: '42000.00' },
          result: { ok: true, tookMs: 1 },
        },
      ]),
      { parameters: { creditLimit: '42000.00' } },
    );
    expect(flow.parameters).toEqual([{ name: 'creditLimit', example: '42000.00' }]);
    expect(flow.steps[0]?.parameter).toBe('creditLimit');
  });
});

describe('FlowCursor', () => {
  const flow = {
    id: 'f',
    taskId: 'sim-po-01',
    sourceTrialId: 't',
    sourceRunId: 'r',
    createdAt: '',
    surface: 'desktop',
    parameters: [{ name: 'amount', example: '42000.00' }],
    steps: [
      {
        index: 0,
        action: { kind: 'type' as const, text: '42000.00' },
        expect: { title: 'MENU', message: 'READY' },
        parameter: 'amount',
      },
      {
        index: 1,
        action: { kind: 'key' as const, keys: 'Enter' },
        expect: { title: 'MENU', message: 'READY' },
      },
    ],
  };

  it('replays the recorded actions and finishes', () => {
    const cursor = new FlowCursor(flow);
    expect(cursor.next(screen('MENU', 'READY'))).toMatchObject({ kind: 'type' });
    expect(cursor.next(screen('MENU', 'READY'))).toMatchObject({ kind: 'key' });
    expect(cursor.next(screen('MENU', 'READY'))).toMatchObject({ kind: 'done' });
    expect(cursor.result.ok).toBe(true);
  });

  it('substitutes a parameter override', () => {
    const cursor = new FlowCursor(flow, { params: { amount: '99.00' } });
    expect(cursor.next(screen('MENU', 'READY'))).toMatchObject({ kind: 'type', text: '99.00' });
  });

  it('abstains on drift instead of improvising', () => {
    const cursor = new FlowCursor(flow);
    const action = cursor.next(screen('SIGN ON', 'SESSION TIMED OUT'));
    expect(action.kind).toBe('abstain');
    expect(cursor.result).toMatchObject({ ok: false, driftAt: 0 });
  });

  it('stays abstained once it has drifted', () => {
    const cursor = new FlowCursor(flow);
    cursor.next(screen('OTHER', 'x'));
    expect(cursor.next(screen('MENU', 'READY')).kind).toBe('abstain');
  });
});

describe('assertions', () => {
  it('summarises the first and last non-empty lines', () => {
    expect(summarizeScreen('  TITLE  \n\n mid \n  MSG ')).toEqual({
      title: 'TITLE',
      message: 'MSG',
    });
  });

  it('passes when no assertion was recorded', () => {
    expect(assertionMatches(undefined, { title: 'x' })).toEqual({ ok: true });
  });
});

describe('emitters', () => {
  it('emits a typed module and an MCP server', () => {
    const flow = compileTrace(
      traceDir([
        {
          stepIndex: 0,
          framePath: 'f0.png',
          screenText: screen('MENU', 'READY'),
          action: { kind: 'type', text: '2' },
          result: { ok: true, tookMs: 1 },
        },
      ]),
    );
    expect(emitFlowModule(flow)).toContain('export const flow: Flow');
    const server = emitMcpServer([flow]);
    expect(server).toContain('tools/list');
    expect(server).toContain('run_sim_po_01');
  });
});
