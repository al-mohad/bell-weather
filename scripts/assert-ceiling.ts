/**
 * CI gate: the hand-written baseline must score a perfect pass^k.
 *
 * This is the calibration instrument. If the ceiling cannot clear the suite, the suite
 * is broken and any agent number measured against it is meaningless — so the build
 * fails here rather than publishing a plausible-looking result. It has already earned
 * its place once; see docs/methodology.md.
 *
 *   tsx scripts/assert-ceiling.ts <results.json>
 */
import { readFileSync } from 'node:fs';

interface Results {
  config: { agent: string; k: number };
  metrics: { passK: number | null; voidedTrials: number; trialCount: number };
  tasks: { taskId: string; passK: number | null; passCount: number; valid: number }[];
}

const path = process.argv[2];
if (!path) {
  console.error('usage: tsx scripts/assert-ceiling.ts <results.json>');
  process.exit(2);
}

const results = JSON.parse(readFileSync(path, 'utf8')) as Results;
const problems: string[] = [];

if (results.metrics.voidedTrials > 0) {
  problems.push(
    `${results.metrics.voidedTrials}/${results.metrics.trialCount} trials were void: the harness or the environment is unreliable`,
  );
}
for (const task of results.tasks) {
  if (task.passK !== 1) {
    problems.push(
      `${task.taskId}: baseline passed ${task.passCount}/${task.valid} — the task is broken, not hard`,
    );
  }
}

if (problems.length > 0) {
  console.error(
    `calibration ceiling failed for agent "${results.config.agent}" at k=${results.config.k}:\n`,
  );
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(
  `calibration ok: ${results.config.agent} scored pass^${results.config.k} = 100% with no void trials`,
);
