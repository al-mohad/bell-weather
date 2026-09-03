import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashSeed } from '@bellwether/core';
import type { Action } from '@bellwether/protocol';
import { summarizeScreen } from './flow';
import type { Flow, FlowParameter, FlowStep } from './flow';

interface TraceRecord {
  stepIndex: number;
  screenText?: string;
  action?: Action;
  result?: { ok: boolean };
  blocked?: { rule: string };
}

interface TraceMeta {
  runId: string;
  trialId: string;
  taskId: string;
  surface: string;
}

export interface CompileOptions {
  /**
   * Literals to hoist into named inputs, e.g. { creditLimit: '42000.00' }.
   * A flow with no parameters is a recording; a flow with parameters is a tool.
   */
  parameters?: Record<string, string>;
}

/**
 * Turns one successful trial into a deterministic flow.
 *
 * The claim this supports is narrow and worth stating precisely: an agent is how
 * you *discover* a workflow on a system with no API, and a compiled flow is how you
 * *run* it ten thousand times. The compiler does not make the agent better - it
 * removes the agent from the hot path once the path is known, and asserts loudly
 * when the UI moves.
 *
 * Blocked actions are dropped: a flow must never encode something policy refused.
 */
export function compileTrace(traceDir: string, options: CompileOptions = {}): Flow {
  const meta = JSON.parse(readFileSync(join(traceDir, 'meta.json'), 'utf8')) as TraceMeta;
  const records = readFileSync(join(traceDir, 'trace.jsonl'), 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as TraceRecord);

  const parameters: FlowParameter[] = [];
  const steps: FlowStep[] = [];

  for (const record of records) {
    if (!record.action || record.blocked) continue;
    if (record.result && !record.result.ok) continue;
    if (record.action.kind === 'done' || record.action.kind === 'abstain') continue;

    const action = record.action;
    let parameter: string | undefined;

    if (action.kind === 'type' && options.parameters) {
      for (const [name, literal] of Object.entries(options.parameters)) {
        if (action.text !== literal) continue;
        parameter = name;
        if (!parameters.some((entry) => entry.name === name)) {
          parameters.push({ name, example: literal });
        }
        break;
      }
    }

    steps.push({
      index: steps.length,
      action,
      expect: summarizeScreen(record.screenText),
      ...(parameter ? { parameter } : {}),
    });
  }

  return {
    id: `flow_${meta.taskId}_${hashSeed(meta.trialId).toString(16)}`,
    taskId: meta.taskId,
    sourceTrialId: meta.trialId,
    sourceRunId: meta.runId,
    createdAt: new Date().toISOString(),
    surface: meta.surface,
    parameters,
    steps,
  };
}
