/**
 * Seeds a real environment on Solari and prints the snapshot id to pin in
 * suites/core/suite.lock.json.
 *
 * Seeding is deliberately a separate, manual step from benchmarking: a benchmark run
 * must never build its own environment, or "identical starting state" stops being true.
 * See docs/adr/0005-pinned-snapshots-and-a-suite-lockfile.md.
 *
 *   SOLARI_API_KEY=slr_live_... pnpm tsx scripts/seed-env.ts odoo
 *
 * VERIFICATION STATUS: unexecuted. No environment has been seeded from this repository.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createLogger } from '@bellwether/core';
import { LiveDriver } from '@bellwether/solari';

interface Recipe {
  template: string;
  port: number;
  boot: string[];
  ready: string;
  cpu: number;
  memMb: number;
}

const RECIPES: Record<string, Recipe> = {
  odoo: {
    template: 'base',
    port: 8069,
    boot: [
      'mkdir -p /opt/app',
      // envs/odoo is uploaded before boot; see envs/README.md for the full recipe.
      'cd /opt/app && docker compose up -d',
      'cd /opt/app && ./wait-for-odoo.sh',
      'cd /opt/app && ./seed.sh',
    ],
    ready: 'curl -fsS http://localhost:8069/web/health',
    cpu: 4,
    memMb: 8192,
  },
};

const name = process.argv[2];
const recipe = name ? RECIPES[name] : undefined;
if (!recipe) {
  console.error(`usage: tsx scripts/seed-env.ts <${Object.keys(RECIPES).join('|')}>`);
  process.exit(2);
}

const logger = createLogger();
const driver = new LiveDriver();
const sandbox = await driver.createSandbox({
  template: recipe.template,
  cpu: recipe.cpu,
  memMb: recipe.memMb,
  timeoutMs: 30 * 60 * 1000,
  onTimeout: 'kill',
});

try {
  const root = new URL('../envs/', import.meta.url).pathname;
  for (const file of ['compose.yaml', 'wait-for-odoo.sh', 'seed.sh', 'seed.sql']) {
    const source = join(root, name as string, file);
    await sandbox.writeFile(`/opt/app/${file}`, readFileSync(source, 'utf8'));
  }
  await sandbox.exec('sh', { args: ['-c', 'chmod +x /opt/app/*.sh'] });

  for (const command of recipe.boot) {
    logger.info('boot', { command });
    const result = await sandbox.exec('sh', { args: ['-c', command], timeoutMs: 20 * 60 * 1000 });
    if (result.exitCode !== 0) {
      throw new Error(`boot failed (${result.exitCode}): ${command}\n${result.stderr}`);
    }
  }

  const ready = await sandbox.exec('sh', { args: ['-c', recipe.ready] });
  if (ready.exitCode !== 0) throw new Error(`readiness check failed: ${ready.stderr}`);

  const snapshotId = await sandbox.snapshot(`${name}-seeded`);
  logger.info('snapshot created', { snapshotId });
  console.log(`\nPin this in suites/core/suite.lock.json:\n\n  "snapshotId": "${snapshotId}"\n`);
  console.log('Then re-run every published number measured against this environment.\n');
} finally {
  await sandbox.kill().catch(() => undefined);
  await driver.close();
}
