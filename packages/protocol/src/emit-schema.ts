/**
 * Emits the protocol as JSON Schema so agents in any language can validate and
 * codegen against it. Run: pnpm --filter @bellwether/protocol schema
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { ActionSchema } from './actions';
import { ObservationSchema } from './observation';
import {
  CloseParamsSchema,
  InitParamsSchema,
  InitResultSchema,
  StepParamsSchema,
  StepResultSchema,
} from './rpc';
import { PROTOCOL_VERSION } from './version';

const outDir = process.argv[2] ?? 'schema';
mkdirSync(outDir, { recursive: true });

const schemas = {
  action: ActionSchema,
  observation: ObservationSchema,
  'init-params': InitParamsSchema,
  'init-result': InitResultSchema,
  'step-params': StepParamsSchema,
  'step-result': StepResultSchema,
  'close-params': CloseParamsSchema,
} as const;

for (const [name, schema] of Object.entries(schemas)) {
  const json = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' });
  const doc = { $id: `https://bellwether.dev/schema/${PROTOCOL_VERSION}/${name}.json`, ...json };
  writeFileSync(join(outDir, `${name}.json`), `${JSON.stringify(doc, null, 2)}\n`);
  console.log(`wrote ${outDir}/${name}.json`);
}
