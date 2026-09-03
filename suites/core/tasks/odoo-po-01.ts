import { Check, simGroundTruth } from '@bellwether/verifiers';
import type { Verifier } from '@bellwether/verifiers';
import type { Task } from '@bellwether/runner';

/** The accepted quote, held in the task rather than read back from the app. */
const EXPECTED_LINES = [
  { sku: 'AX-100', qty: 12, unit_price_cents: 1425 },
  { sku: 'BX-220', qty: 4, unit_price_cents: 8800 },
];
const EXPECTED_VENDOR = 'Kestrel Tooling';

const PO_LINES_SQL = `
  select p.name as po_name,
         v.name as vendor,
         t.default_code as sku,
         l.product_qty::int as qty,
         round(l.price_unit * 100)::int as unit_price_cents
    from purchase_order_line l
    join purchase_order p on p.id = l.order_id
    join res_partner v on v.id = p.partner_id
    join product_product pp on pp.id = l.product_id
    join product_template t on t.id = pp.product_tmpl_id
   order by p.name, t.default_code
`;

interface PoLineRow {
  po_name: string;
  vendor: string;
  sku: string;
  qty: number;
  unit_price_cents: number;
}

/**
 * Reads ground truth out of Odoo's own tables. Nothing about the page is inspected,
 * so an agent cannot pass by leaving the screen looking right.
 */
const verify: Verifier = async (context) => {
  const rows = await context.sql<PoLineRow>(PO_LINES_SQL);
  const check = new Check();

  const orders = new Set(rows.map((row) => row.po_name));
  check.that(orders.size > 0, 'no purchase order exists');
  check.sideEffect(Math.max(0, orders.size - 1), 'more than one purchase order was created');
  check.that(
    rows.every((row) => row.vendor === EXPECTED_VENDOR),
    `purchase order raised against the wrong vendor (expected ${EXPECTED_VENDOR})`,
  );

  const byKey = new Map(rows.map((row) => [row.sku, row]));
  check.that(
    rows.length === EXPECTED_LINES.length,
    `expected ${EXPECTED_LINES.length} lines, found ${rows.length}`,
  );
  for (const expected of EXPECTED_LINES) {
    const actual = byKey.get(expected.sku);
    check.that(actual !== undefined, `line for ${expected.sku} is missing`);
    if (actual) {
      check.that(
        actual.qty === expected.qty,
        `${expected.sku} quantity is ${actual.qty}, expected ${expected.qty}`,
      );
      check.that(
        actual.unit_price_cents === expected.unit_price_cents,
        `${expected.sku} unit price is ${actual.unit_price_cents} cents, expected ${expected.unit_price_cents}`,
      );
    }
  }
  check.detail('rows', rows);
  return check.verdict('purchase order reproduces the accepted quote exactly');
};

function rows(overrides: Partial<PoLineRow>[] = []): PoLineRow[] {
  const base = EXPECTED_LINES.map((line) => ({
    po_name: 'P00001',
    vendor: EXPECTED_VENDOR,
    sku: line.sku,
    qty: line.qty,
    unit_price_cents: line.unit_price_cents,
  }));
  return base.map((row, index) => ({ ...row, ...(overrides[index] ?? {}) }));
}

/**
 * VERIFICATION STATUS: this task has never been executed. It needs --driver live,
 * a seeded Odoo snapshot pinned in suite.lock.json, and a paid Solari key. Its
 * verifier is self-tested against canned rows, which proves the SQL logic is
 * falsifiable but proves nothing about the environment. Do not report a number for
 * this task until docs/methodology.md records a live run.
 */
export const task: Task = {
  id: 'odoo-po-01',
  title: 'Enter an accepted vendor quote in Odoo',
  tier: 'basic',
  surface: 'browser',
  requires: 'live',
  goal: `The attached quote from ${EXPECTED_VENDOR} has been accepted: ${EXPECTED_LINES.map((line) => `${line.qty} x ${line.sku} at ${(line.unit_price_cents / 100).toFixed(2)}`).join(', ')}. Create exactly one purchase order in Odoo that reproduces it. Do not confirm or receive the order.`,
  context: 'Odoo 18. Purchasing > Orders > Purchase Orders > New. Log in as admin / admin.',
  env: {
    template: 'odoo-18-seeded',
    port: 8069,
    psql: { database: 'odoo', user: 'odoo' },
    boot: ['cd /opt/app && docker compose up -d && /opt/app/wait-for-odoo.sh'],
    // Pinned by scripts/seed-env.ts and recorded in suites/core/suite.lock.json.
    snapshotId: undefined,
  },
  maxSteps: 120,
  policy: { allowedUrlPatterns: ['sandbox', 'localhost', '127.0.0.1'] },
  verify,
  fixtures: {
    passing: {
      name: 'one order matching the quote',
      truth: () => simGroundTruth(),
      sqlStub: () => rows(),
    },
    failing: [
      { name: 'no order created', truth: () => simGroundTruth(), sqlStub: () => [] },
      {
        name: 'quantity mistyped',
        truth: () => simGroundTruth(),
        sqlStub: () => rows([{ qty: 21 }]),
      },
      {
        name: 'wrong vendor',
        truth: () => simGroundTruth(),
        sqlStub: () => rows([{ vendor: 'Meridian Steel' }, { vendor: 'Meridian Steel' }]),
      },
      {
        name: 'duplicate orders',
        truth: () => simGroundTruth(),
        sqlStub: () => [...rows(), ...rows().map((row) => ({ ...row, po_name: 'P00002' }))],
      },
    ],
  },
};
