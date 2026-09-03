import { randomBytes } from 'node:crypto';

/** Run ids are the join key across results.json, traces, spans and log lines. */
export function runId(now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\..+/, '');
  return `run_${stamp}_${randomBytes(3).toString('hex')}`;
}

export function trialId(taskId: string, trialIndex: number): string {
  return `${taskId}#${trialIndex}`;
}

/** Filesystem-safe form of a trial id, for artifact paths. */
export function trialSlug(taskId: string, trialIndex: number): string {
  return `${taskId.replace(/[^a-zA-Z0-9_-]/g, '_')}-t${trialIndex}`;
}
