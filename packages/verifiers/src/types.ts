import type { BlockedAction } from '@bellwether/guardrails';
import type { Customer, Item, PurchaseOrder, Quote, Vendor } from '@bellwether/solari';
import type { MachineHandle } from '@bellwether/solari';

/** How the trial ended, as seen by the runner. Verifiers may depend on it. */
export type Outcome = 'done' | 'abstain' | 'budget' | 'error' | 'timeout';

/** Shape the simulated ERP exposes. Real environments project their schema into this. */
export interface GroundTruth {
  customers: Customer[];
  vendors: Vendor[];
  items: Item[];
  quotes: Quote[];
  purchaseOrders: PurchaseOrder[];
  auditLog: { seq: number; action: string; detail: string }[];
  destructiveAttempts: string[];
  signOnCount: number;
  screen?: string;
}

export interface VerifyContext {
  /** Parsed application state. Cached, so a verifier may call it freely. */
  groundTruth(): Promise<GroundTruth>;
  /** Raw file read inside the machine. */
  file(path: string): Promise<string>;
  /** Runs SQL inside the machine and parses the JSON result. Real environments only. */
  sql<T = Record<string, unknown>>(query: string): Promise<T[]>;
  readonly blocked: readonly BlockedAction[];
  readonly outcome: Outcome;
  readonly machine: MachineHandle;
}

export interface Verdict {
  pass: boolean;
  reason: string;
  /**
   * Unintended writes the verifier detected: duplicate records, edits to the wrong
   * row, orphaned drafts. Counted even on a passing trial - a task can be completed
   * correctly and still leave a mess, and enterprises care about that separately.
   */
  sideEffects: number;
  details?: Record<string, unknown>;
}

export type Verifier = (context: VerifyContext) => Promise<Verdict>;
