import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { baselineCreditLimits, customerCreditLimit, simGroundTruth } from '@bellwether/verifiers';
import type { Task } from '@bellwether/runner';

interface SuiteLock {
  environments: Record<string, { snapshotId: string | null; template?: string }>;
}

const lock = JSON.parse(
  readFileSync(fileURLToPath(new URL('../suite.lock.json', import.meta.url)), 'utf8'),
) as SuiteLock;
const environment = lock.environments['legacy-5250'];

const TARGET_CUSTOMER = '1002';
const TARGET_CENTS = 4_200_000;
const STATE_PATH = '/var/lib/simapp/state.json';

/**
 * The same work as sim-cust-01, on a real desktop.
 *
 * NORTHWIND 5250 runs as a curses application inside a terminal emulator on a real X
 * display in a Solari desktop VM: window chrome, a compositor, a window manager, real
 * font rendering, and input delivered as real X events. There is no character grid
 * behind the pixels - the observation is a screenshot of a desktop.
 *
 * The application publishes a text rendering alongside its state file, the way the
 * environments in envs/ publish a `bw-fault` hook. Agents that read it must declare
 * `text-screen`; a vision agent should be run without it.
 *
 * Because the terminal sits in a window at an arbitrary offset, a flow that aims clicks
 * at coordinates derived from the display will miss. Use `--agent scripted-keyboard`,
 * which moves focus with Tab.
 */
export const task: Task = {
  id: 'leg-01',
  title: 'Raise a customer credit limit on a real terminal',
  tier: 'legacy',
  surface: 'desktop',
  requires: 'live',
  goal: `In the customer maintenance screen, set the credit limit for customer ${TARGET_CUSTOMER} to 42000.00 and commit the change. Do not modify any other customer.`,
  context: [
    'NORTHWIND 5250 quick reference:',
    '  Main menu option 1 opens customer maintenance.',
    '  Enter a customer number and press Enter to load the record.',
    '  Tab moves the cursor between fields. F10 commits. F12 cancels. F3 exits.',
  ].join('\n'),
  env: {
    template: environment?.template ?? 'default',
    resolution: '1280x720',
    statePath: STATE_PATH,
    screenTextPath: '/var/lib/simapp/screen.txt',
    // Pinned in suite.lock.json by `pnpm tsx scripts/seed-env.ts legacy-5250`.
    snapshotId: environment?.snapshotId ?? undefined,
  },
  maxSteps: 60,
  verify: customerCreditLimit(TARGET_CUSTOMER, TARGET_CENTS, baselineCreditLimits()),
  fixtures: {
    passing: {
      name: 'limit updated on the target customer only',
      truth: () =>
        simGroundTruth((truth) => {
          const customer = truth.customers.find((entry) => entry.id === TARGET_CUSTOMER);
          if (customer) customer.creditLimitCents = TARGET_CENTS;
        }),
      statePath: STATE_PATH,
    },
    failing: [
      { name: 'nothing changed', truth: () => simGroundTruth(), statePath: STATE_PATH },
      {
        name: 'target correct but an unrelated customer was also edited',
        statePath: STATE_PATH,
        truth: () =>
          simGroundTruth((truth) => {
            const target = truth.customers.find((entry) => entry.id === TARGET_CUSTOMER);
            if (target) target.creditLimitCents = TARGET_CENTS;
            const bystander = truth.customers.find((entry) => entry.id === '1001');
            if (bystander) bystander.creditLimitCents = 1;
          }),
      },
    ],
  },
};
