/**
 * Seeds a real environment on Solari and prints the snapshot id to pin in
 * suites/core/suite.lock.json.
 *
 * `legacy-5250` has been executed and its snapshot is pinned. `odoo` has not.
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
  kind: 'sandbox' | 'desktop';
  template: string;
  port?: number;
  /** Files uploaded into the machine before boot, as destination -> repo-relative source. */
  upload?: Record<string, string>;
  boot: string[];
  ready: string;
  cpu: number;
  memMb: number;
  resolution?: `${number}x${number}`;
}

const RECIPES: Record<string, Recipe> = {
  /**
   * NORTHWIND 5250 under xterm on a real X display.
   *
   * xterm rather than the desktop's xfce4-terminal because GTK claims F10 as the menu
   * accelerator and F10 is how this application commits a record - the flow reached the
   * commit on every trial and the record never changed, which is the most expensive
   * kind of silent failure a benchmark can have.
   */
  'legacy-5250': {
    kind: 'desktop',
    template: 'default',
    resolution: '1280x720',
    cpu: 2,
    memMb: 2048,
    upload: { '/opt/northwind5250.py': 'envs/legacy-5250/northwind5250.py' },
    boot: [
      'DEBIAN_FRONTEND=noninteractive apt-get -qq update && DEBIAN_FRONTEND=noninteractive apt-get -qq install -y xterm xfonts-base',
      'mkdir -p /var/lib/simapp && chmod +x /opt/northwind5250.py',
      'DISPLAY=:0 setsid xterm -geometry 80x24+0+0 -fn 10x20 -b 0 -bw 0 -bg black -fg green -title NORTHWIND -e python3 /opt/northwind5250.py >/tmp/term.log 2>&1 </dev/null & sleep 3',
    ],
    ready: 'test -f /var/lib/simapp/state.json',
  },
  odoo: {
    kind: 'sandbox',
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
const machineOptions = {
  template: recipe.template,
  cpu: recipe.cpu,
  memMb: recipe.memMb,
  timeoutMs: 30 * 60 * 1000,
  onTimeout: 'kill' as const,
};
const sandbox =
  recipe.kind === 'desktop'
    ? await driver.createDesktop({ ...machineOptions, resolution: recipe.resolution })
    : await driver.createSandbox(machineOptions);

try {
  const root = new URL('..', import.meta.url).pathname;
  if (recipe.upload) {
    for (const [destination, source] of Object.entries(recipe.upload)) {
      await sandbox.writeFile(destination, readFileSync(join(root, source), 'utf8'));
      logger.info('uploaded', { destination });
    }
  } else {
    for (const file of ['compose.yaml', 'wait-for-odoo.sh', 'seed.sh', 'seed.sql']) {
      await sandbox.writeFile(
        `/opt/app/${file}`,
        readFileSync(join(root, 'envs', name as string, file), 'utf8'),
      );
    }
    await sandbox.exec('sh', { args: ['-c', 'chmod +x /opt/app/*.sh'] });
  }

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
