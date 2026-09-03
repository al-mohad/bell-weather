import { readFileSync } from 'node:fs';
import { FlowCursor, PROTOCOL_VERSION } from './deps';
import type { Flow } from './deps';
import { serveAgent } from '@bellwether/protocol';
import type { InitParams } from '@bellwether/protocol';

/**
 * Enters compiled flows into the same benchmark, under the same verifiers, as the
 * agents. That comparison is the point: if a compiled flow scores far higher at
 * pass^k on a task an agent has already solved once, the operational answer is to
 * compile the flow and keep the agent for discovery and drift.
 *
 * BELLWETHER_FLOW_DIR holds one <taskId>.json per compiled flow.
 */
const flowDir = process.env.BELLWETHER_FLOW_DIR ?? '.bellwether/flows';

let cursor: FlowCursor | undefined;
let loadError: string | undefined;

await serveAgent({
  init(params: InitParams) {
    try {
      const flow = JSON.parse(readFileSync(`${flowDir}/${params.taskId}.json`, 'utf8')) as Flow;
      cursor = new FlowCursor(flow, { params: readParams() });
      process.stderr.write(`compiled-flow: ${flow.id} (${flow.steps.length} steps)\n`);
    } catch (error) {
      loadError = `no compiled flow for ${params.taskId} in ${flowDir}: ${
        error instanceof Error ? error.message : String(error)
      }`;
      process.stderr.write(`compiled-flow: ${loadError}\n`);
    }
    return {
      agent: 'compiled-flow',
      version: '0.1.0',
      protocol: PROTOCOL_VERSION,
      capabilities: ['deterministic', 'drift-detection'],
    };
  },
  step({ observation }) {
    if (!cursor) return { action: { kind: 'abstain', reason: loadError ?? 'no flow loaded' } };
    return { action: cursor.next(observation.screenText) };
  },
});

function readParams(): Record<string, string> {
  const raw = process.env.BELLWETHER_FLOW_PARAMS;
  if (!raw) return {};
  return JSON.parse(raw) as Record<string, string>;
}
