import { seedDb } from '@bellwether/solari';
import type { MachineHandle } from '@bellwether/solari';
import type { BlockedAction } from '@bellwether/guardrails';
import { createVerifyContext } from './context';
import type { GroundTruth, Outcome, VerifyContext } from './types';

/**
 * Builds a ground-truth document from the seed data, optionally mutated.
 * Fixtures are plain data, so a verifier self-test needs no driver, no sandbox and
 * no agent - which is the only reason the self-tests can run on every commit.
 */
export function simGroundTruth(mutate?: (truth: GroundTruth) => void): GroundTruth {
  const db = seedDb();
  const truth: GroundTruth = {
    customers: db.customers,
    vendors: db.vendors,
    items: db.items,
    quotes: db.quotes,
    purchaseOrders: db.purchaseOrders,
    auditLog: db.auditLog,
    destructiveAttempts: [],
    signOnCount: 1,
    screen: 'MENU',
  };
  mutate?.(truth);
  return truth;
}

export function baselineCreditLimits(): Record<string, number> {
  return Object.fromEntries(seedDb().customers.map((c) => [c.id, c.creditLimitCents]));
}

/** A MachineHandle backed by an in-memory ground-truth document. */
export function fixtureMachine(truth: GroundTruth, statePath: string): MachineHandle {
  return {
    id: 'fixture',
    async exec() {
      return { stdout: '', stderr: 'fixture machine has no shell', exitCode: 127 };
    },
    async writeFile() {
      throw new Error('fixture machine is read-only');
    },
    async readFile(path: string) {
      if (path !== statePath) throw new Error(`fixture machine has no file ${path}`);
      return JSON.stringify(truth);
    },
    async previewUrl(port: number) {
      return `https://fixture.invalid/${port}`;
    },
    async snapshot() {
      return 'fixture-snapshot';
    },
    async kill() {},
  };
}

export interface FixtureContextOptions {
  outcome?: Outcome;
  blocked?: readonly BlockedAction[];
  statePath?: string;
  /** Canned rows for verifiers that read a real database. */
  sqlStub?: (query: string) => unknown[];
}

export function fixtureContext(
  truth: GroundTruth,
  options: FixtureContextOptions = {},
): VerifyContext {
  const statePath = options.statePath ?? '/var/lib/simapp/state.json';
  return createVerifyContext({
    machine: fixtureMachine(truth, statePath),
    blocked: options.blocked ?? [],
    outcome: options.outcome ?? 'done',
    statePath,
    sqlStub: options.sqlStub,
  });
}
