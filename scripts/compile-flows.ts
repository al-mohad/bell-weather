/**
 * Recompiles the committed flows in results/flows from a calibrated scripted run.
 *
 *   pnpm bench:sim && pnpm flows
 *
 * Flows are compiled from the *scripted* baseline because a flow can only come from a
 * trial that actually succeeded, and that entrant is the one guaranteed to have one.
 * The mapping in results/flows/index.json is hand-maintained: it records which tasks
 * deliberately share a flow.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileTrace, emitFlowModule, emitMcpServer } from '@bellwether/compile';
import type { Flow } from '@bellwether/compile';

const runDir = process.argv[2] ?? '.bellwether/sim';
const outDir = process.argv[3] ?? 'results/flows';
mkdirSync(outDir, { recursive: true });

const sources: { taskId: string; params?: Record<string, string> }[] = [
  { taskId: 'sim-po-01' },
  { taskId: 'sim-po-02' },
  { taskId: 'sim-cust-01', params: { creditLimit: '42000.00' } },
];

const flows: Flow[] = [];
for (const source of sources) {
  const trial = join(runDir, 'trials', `${source.taskId}-t0`);
  const flow = compileTrace(trial, { parameters: source.params });
  writeFileSync(join(outDir, `${source.taskId}.json`), `${JSON.stringify(flow, null, 2)}\n`);
  flows.push(flow);
  console.log(`compiled ${source.taskId} from ${trial} (${flow.steps.length} steps)`);
}

const primary = flows[0];
if (primary) writeFileSync(join(outDir, `${primary.taskId}.flow.ts`), emitFlowModule(primary));
writeFileSync(join(outDir, 'mcp-server.mjs'), emitMcpServer(flows));

// Fail loudly if the hand-maintained map points at a file that no longer exists.
const index = JSON.parse(readFileSync(join(outDir, 'index.json'), 'utf8')) as {
  flows: Record<string, string>;
};
for (const [taskId, file] of Object.entries(index.flows)) {
  if (!existsSync(join(outDir, file))) {
    throw new Error(`index.json maps ${taskId} to ${file}, which was not compiled`);
  }
}
console.log(`wrote ${outDir}`);
