import { SIM_STATE_PATH, seedDb } from '@bellwether/solari';
import { purchaseOrderMatchesQuote, simGroundTruth } from '@bellwether/verifiers';
import type { FaultSpec } from '@bellwether/faults';
import type { Task, Tier } from '@bellwether/runner';

const CONTEXT = [
  'NORTHWIND 5250 quick reference:',
  '  Main menu option 2 opens purchase order entry.',
  '  Main menu option 3 lists vendor quotes (read only).',
  '  Purchase order entry has a vendor number field and three line slots',
  '  (item, quantity, unit price). F10 confirms. F12 cancels. F3 exits.',
  '  Money is entered as 99999.99. Only items on the item master are accepted.',
].join('\n');

function quoteById(quoteId: string) {
  const quote = seedDb().quotes.find((entry) => entry.id === quoteId);
  if (!quote) throw new Error(`fixture error: unknown quote ${quoteId}`);
  return quote;
}

function withMatchingOrder(quoteId: string) {
  return simGroundTruth((truth) => {
    const quote = quoteById(quoteId);
    truth.purchaseOrders.push({
      id: 'PO-5001',
      vendorId: quote.vendorId,
      lines: quote.lines.map((line) => ({ ...line })),
      createdBy: 'OPER1',
    });
    truth.auditLog.push({ seq: 1, action: 'PO_CREATE', detail: 'PO-5001' });
  });
}

interface PoTaskSpec {
  id: string;
  title: string;
  tier: Tier;
  quoteId: string;
  maxSteps: number;
  faults?: FaultSpec[];
  cleanTwin?: string;
  extraGoal?: string;
}

/**
 * Read-then-transcribe across two screens. The verifier compares against the quote
 * itself, so a transcription that is plausible but wrong fails - which is the only
 * grading standard that means anything for data entry.
 */
function poTask(spec: PoTaskSpec): Task {
  return {
    id: spec.id,
    title: spec.title,
    tier: spec.tier,
    surface: 'desktop',
    requires: 'sim',
    goal: [
      `Vendor quote ${spec.quoteId} has been accepted. Enter it as a purchase order exactly as quoted:`,
      'the same vendor, the same items, the same quantities and the same unit prices.',
      'Create exactly one purchase order. If the quote cannot be entered correctly, stop and explain why.',
      spec.extraGoal ?? '',
    ]
      .filter(Boolean)
      .join(' '),
    context: CONTEXT,
    env: { template: 'sim-erp5250', statePath: SIM_STATE_PATH },
    maxSteps: spec.maxSteps,
    faults: spec.faults,
    cleanTwin: spec.cleanTwin,
    verify: purchaseOrderMatchesQuote(spec.quoteId),
    fixtures: {
      passing: {
        name: 'one order matching the quote',
        truth: () => withMatchingOrder(spec.quoteId),
      },
      failing: [
        { name: 'no order created', truth: () => simGroundTruth() },
        {
          name: 'duplicate orders for the same vendor',
          truth: () => {
            const truth = withMatchingOrder(spec.quoteId);
            const first = truth.purchaseOrders[0];
            if (first) truth.purchaseOrders.push({ ...first, id: 'PO-5002' });
            return truth;
          },
        },
        {
          name: 'quantity mistyped on the first line',
          truth: () => {
            const truth = withMatchingOrder(spec.quoteId);
            const line = truth.purchaseOrders[0]?.lines[0];
            if (line) line.qty += 1;
            return truth;
          },
        },
        {
          name: 'unit price mistyped on the first line',
          truth: () => {
            const truth = withMatchingOrder(spec.quoteId);
            const line = truth.purchaseOrders[0]?.lines[0];
            if (line) line.unitPriceCents += 10;
            return truth;
          },
        },
        {
          name: 'raised against the wrong vendor',
          truth: () => {
            const truth = withMatchingOrder(spec.quoteId);
            const order = truth.purchaseOrders[0];
            if (order) order.vendorId = order.vendorId === '2001' ? '2002' : '2001';
            return truth;
          },
        },
      ],
    },
  };
}

export const simPo01 = poTask({
  id: 'sim-po-01',
  title: 'Transcribe a two-line vendor quote',
  tier: 'basic',
  quoteId: 'Q-8801',
  maxSteps: 60,
});

export const simPo02 = poTask({
  id: 'sim-po-02',
  title: 'Transcribe a three-line vendor quote',
  tier: 'hard',
  quoteId: 'Q-8802',
  maxSteps: 80,
});

/** Identical to sim-po-01 plus interruptions. Recovery is measured against its twin. */
export const simFault01 = poTask({
  id: 'sim-fault-01',
  title: 'Transcribe a quote through a modal interruption and dropped input',
  tier: 'fault',
  quoteId: 'Q-8801',
  maxSteps: 90,
  cleanTwin: 'sim-po-01',
  faults: [
    { kind: 'modal', atStep: 3 },
    { kind: 'modal', atStep: 17 },
    { kind: 'drop-input', probability: 0.12 },
  ],
});

/**
 * Session expiry at step 6 discards in-flight form state. The agent must notice and
 * re-enter without committing twice.
 *
 * Known limitation: the expiry fires before any commit is possible, so this task
 * does not yet test the harder post-commit case - re-entering after a timeout when
 * the order may already exist. That needs an application screen for looking up
 * existing orders, which the simulator does not have and real Odoo does. Tracked in
 * docs/methodology.md.
 */
export const simFault02 = poTask({
  id: 'sim-fault-02',
  title: 'Transcribe a quote across a session expiry',
  tier: 'fault',
  quoteId: 'Q-8801',
  maxSteps: 90,
  cleanTwin: 'sim-po-01',
  faults: [{ kind: 'session-expiry', atStep: 6 }],
});
