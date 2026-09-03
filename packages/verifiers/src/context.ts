import { VerifierError } from '@bellwether/core';
import { SIM_STATE_PATH } from '@bellwether/solari';
import type { MachineHandle } from '@bellwether/solari';
import type { BlockedAction } from '@bellwether/guardrails';
import type { GroundTruth, Outcome, VerifyContext } from './types';

export interface ContextOptions {
  machine: MachineHandle;
  blocked: readonly BlockedAction[];
  outcome: Outcome;
  /** Where application state lives. Defaults to the simulator's path. */
  statePath?: string;
  /** Set for real environments; `sql()` throws without it. */
  psql?: { database: string; user?: string };
  /**
   * Canned SQL responses, for verifier self-tests. Present only in fixtures - a
   * real run has no stub, so a verifier cannot accidentally be tested against one.
   */
  sqlStub?: (query: string) => unknown[];
}

export function createVerifyContext(options: ContextOptions): VerifyContext {
  let cached: GroundTruth | undefined;

  return {
    machine: options.machine,
    blocked: options.blocked,
    outcome: options.outcome,

    async file(path: string): Promise<string> {
      return options.machine.readFile(path);
    },

    async groundTruth(): Promise<GroundTruth> {
      if (cached) return cached;
      const raw = await options.machine.readFile(options.statePath ?? SIM_STATE_PATH);
      try {
        cached = JSON.parse(raw) as GroundTruth;
      } catch {
        throw new VerifierError(`application state at ${options.statePath} is not valid JSON`);
      }
      return cached;
    },

    async sql<T>(query: string): Promise<T[]> {
      if (options.sqlStub) return options.sqlStub(query) as T[];
      if (!options.psql) {
        throw new VerifierError(
          'sql() needs a psql target. The simulator has no database - use groundTruth() instead.',
        );
      }
      // -tA: unaligned, no headers. row_to_json keeps the result parseable without
      // a client-side driver, which is why no Postgres dependency appears anywhere.
      const wrapped = `select coalesce(json_agg(t), '[]') from (${query.replace(/;\s*$/, '')}) t`;
      const result = await options.machine.exec('psql', {
        args: [
          '-tA',
          '-d',
          options.psql.database,
          '-U',
          options.psql.user ?? 'postgres',
          '-c',
          wrapped,
        ],
      });
      if (result.exitCode !== 0) {
        throw new VerifierError(`psql exited ${result.exitCode}: ${result.stderr.trim()}`);
      }
      try {
        return JSON.parse(result.stdout.trim() || '[]') as T[];
      } catch {
        throw new VerifierError(`psql returned unparseable output: ${result.stdout.slice(0, 200)}`);
      }
    },
  };
}
