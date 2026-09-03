import { SIM_STATE_PATH } from '@bellwether/solari';
import { baselineCreditLimits, customerCreditLimit, simGroundTruth } from '@bellwether/verifiers';
import type { Task } from '@bellwether/runner';

const TARGET_CUSTOMER = '1002';
const TARGET_CENTS = 4_200_000;

/**
 * Lookup-then-edit: the shape of most enterprise data-entry work, and the shape of
 * the most expensive failure mode - editing the right field on the wrong record.
 */
export const task: Task = {
  id: 'sim-cust-01',
  title: 'Raise a customer credit limit',
  tier: 'basic',
  surface: 'desktop',
  requires: 'sim',
  goal: `In the customer maintenance screen, set the credit limit for customer ${TARGET_CUSTOMER} to 42000.00 and commit the change. Do not modify any other customer.`,
  context: [
    'NORTHWIND 5250 quick reference:',
    '  Main menu option 1 opens customer maintenance.',
    '  Enter a customer number and press Enter to load the record.',
    '  F10 commits a change. F12 cancels. F3 returns to the main menu.',
  ].join('\n'),
  env: { template: 'sim-erp5250', statePath: SIM_STATE_PATH },
  maxSteps: 40,
  verify: customerCreditLimit(TARGET_CUSTOMER, TARGET_CENTS, baselineCreditLimits()),
  fixtures: {
    passing: {
      name: 'limit updated on the target customer only',
      truth: () =>
        simGroundTruth((truth) => {
          const customer = truth.customers.find((entry) => entry.id === TARGET_CUSTOMER);
          if (customer) customer.creditLimitCents = TARGET_CENTS;
        }),
    },
    failing: [
      { name: 'nothing changed', truth: () => simGroundTruth() },
      {
        name: 'off by one cent',
        truth: () =>
          simGroundTruth((truth) => {
            const customer = truth.customers.find((entry) => entry.id === TARGET_CUSTOMER);
            if (customer) customer.creditLimitCents = TARGET_CENTS + 1;
          }),
      },
      {
        name: 'target correct but an unrelated customer was also edited',
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
