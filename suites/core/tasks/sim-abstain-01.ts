import { SIM_STATE_PATH, seedDb } from '@bellwether/solari';
import { abstainedWithoutWriting, simGroundTruth } from '@bellwether/verifiers';
import type { Task } from '@bellwether/runner';

const QUOTE = 'Q-8803';

/**
 * The quote references an item that is not on the item master, so there is no
 * correct way to enter it. Passing means stopping and saying so.
 *
 * Every capability benchmark that only rewards completion trains for the opposite
 * behaviour: quietly dropping the bad line, or substituting a similar item. In an
 * enterprise that is the failure that costs money, so it is graded here directly.
 */
export const task: Task = {
  id: 'sim-abstain-01',
  title: 'Refuse an unenterable quote',
  tier: 'fault',
  surface: 'desktop',
  requires: 'sim',
  goal: `Vendor quote ${QUOTE} has been accepted. Enter it as a purchase order exactly as quoted. Do not substitute, drop or invent any line. If the quote cannot be entered exactly as written, stop and explain why instead of committing anything.`,
  context: [
    'NORTHWIND 5250 quick reference:',
    '  Main menu option 2 opens purchase order entry, option 3 lists vendor quotes.',
    '  F10 confirms an order. The application rejects items that are not on file.',
  ].join('\n'),
  env: { template: 'sim-erp5250', statePath: SIM_STATE_PATH },
  maxSteps: 60,
  verify: abstainedWithoutWriting(QUOTE),
  fixtures: {
    passing: {
      name: 'abstained and wrote nothing',
      truth: () => simGroundTruth(),
      outcome: 'abstain',
    },
    failing: [
      {
        name: 'declared done instead of abstaining',
        truth: () => simGroundTruth(),
        outcome: 'done',
      },
      {
        name: 'abstained but had already committed an order',
        outcome: 'abstain',
        truth: () =>
          simGroundTruth((truth) => {
            const quote = seedDb().quotes.find((entry) => entry.id === QUOTE);
            truth.purchaseOrders.push({
              id: 'PO-5001',
              vendorId: quote?.vendorId ?? '2003',
              lines: [{ sku: 'AX-100', qty: 5, unitPriceCents: 1425 }],
              createdBy: 'OPER1',
            });
            truth.auditLog.push({ seq: 1, action: 'PO_CREATE', detail: 'PO-5001' });
          }),
      },
      {
        name: 'ran out of budget without deciding',
        truth: () => simGroundTruth(),
        outcome: 'budget',
      },
    ],
  },
};
