import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { redactDeep } from '@bellwether/guardrails';
import type { Action, ActionResult } from '@bellwether/protocol';
import type { InjectedFault } from '@bellwether/faults';

export interface TraceStep {
  stepIndex: number;
  /** Relative path to the frame PNG, so the report is self-contained. */
  framePath: string;
  screenText?: string;
  url?: string;
  action?: Action;
  result?: ActionResult;
  blocked?: { rule: string; reason: string };
  faults?: InjectedFault[];
  usdSpent: number;
  atMs: number;
}

export interface TraceMeta {
  runId: string;
  trialId: string;
  taskId: string;
  trialIndex: number;
  seed: number;
  agent: string;
  agentVersion: string;
  driver: string;
  surface: string;
  display: { width: number; height: number };
  startedAt: string;
  evidenceUrl?: string;
}

/**
 * Every trial writes one directory: a metadata file, a step-by-step JSONL, the
 * frames, and the agent's stderr. The report renders straight from it and nothing
 * in a published result is unbacked by an artifact a reader can open.
 *
 * Redaction happens on write, not on publish, so a leaked key never touches disk.
 */
export class TraceWriter {
  private readonly stepsPath: string;
  private readonly framesDir: string;
  private readonly startedAt = Date.now();
  private redactionHits: Record<string, number> = {};

  constructor(
    readonly dir: string,
    private readonly meta: TraceMeta,
  ) {
    this.framesDir = join(dir, 'frames');
    mkdirSync(this.framesDir, { recursive: true });
    this.stepsPath = join(dir, 'trace.jsonl');
    writeFileSync(this.stepsPath, '');
    this.writeMeta();
  }

  private writeMeta(): void {
    const { value } = redactDeep(this.meta);
    writeFileSync(join(this.dir, 'meta.json'), `${JSON.stringify(value, null, 2)}\n`);
  }

  frame(stepIndex: number, pngB64: string): string {
    const name = `step-${String(stepIndex).padStart(3, '0')}.png`;
    writeFileSync(join(this.framesDir, name), Buffer.from(pngB64, 'base64'));
    return `frames/${name}`;
  }

  step(record: Omit<TraceStep, 'atMs'>): void {
    const { value, hits } = redactDeep({ ...record, atMs: Date.now() - this.startedAt });
    for (const [rule, count] of Object.entries(hits)) {
      this.redactionHits[rule] = (this.redactionHits[rule] ?? 0) + count;
    }
    appendFileSync(this.stepsPath, `${JSON.stringify(value)}\n`);
  }

  finish(extra: { stderr: string; verdict: unknown }): void {
    const { value } = redactDeep(extra);
    const payload = value as { stderr: string; verdict: unknown };
    writeFileSync(join(this.dir, 'agent-stderr.log'), payload.stderr);
    writeFileSync(
      join(this.dir, 'verdict.json'),
      `${JSON.stringify({ verdict: payload.verdict, redactionHits: this.redactionHits }, null, 2)}\n`,
    );
  }
}
