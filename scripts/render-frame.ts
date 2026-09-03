/**
 * Renders sample simulator frames for the documentation.
 *
 *   pnpm tsx scripts/render-frame.ts docs/images
 *
 * These are the actual frames an agent receives — produced by the same function the
 * runner calls, not mocked up for the README.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Erp5250Sim, renderTerminalPng } from '@bellwether/solari';

const outDir = process.argv[2] ?? 'docs/images';
mkdirSync(outDir, { recursive: true });

const frames: Record<string, (sim: Erp5250Sim) => void> = {
  'frame-quotes': (sim) => {
    sim.type('3');
    sim.press('Enter');
  },
  'frame-po-entry': (sim) => {
    sim.type('2');
    sim.press('Enter');
    sim.type('2001');
    sim.press('Tab');
    sim.type('AX-100');
    sim.press('Tab');
    sim.type('12');
    sim.press('Tab');
    sim.type('14.25');
  },
  'frame-session-expiry': (sim) => {
    sim.type('2');
    sim.press('Enter');
    sim.type('2001');
    sim.expireSession();
  },
};

for (const [name, drive] of Object.entries(frames)) {
  const sim = new Erp5250Sim();
  drive(sim);
  const path = join(outDir, `${name}.png`);
  writeFileSync(path, renderTerminalPng(sim.render()));
  console.log(`wrote ${path}`);
}
