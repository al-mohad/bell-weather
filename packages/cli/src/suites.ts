import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { coreSuite } from '@bellwether/suite-core';
import type { Suite } from '@bellwether/runner';

/** Built-in suites, plus any local file exporting a Suite as default or `suite`. */
export async function loadSuite(name: string): Promise<Suite> {
  if (name === 'core') return coreSuite;
  const module = (await import(pathToFileURL(resolve(name)).href)) as {
    default?: Suite;
    suite?: Suite;
  };
  const suite = module.default ?? module.suite;
  if (!suite) throw new Error(`${name} does not export a suite (as default or as \`suite\`)`);
  return suite;
}
