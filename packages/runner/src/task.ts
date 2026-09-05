import type { FaultSpec } from '@bellwether/faults';
import type { BlockedAction, Policy } from '@bellwether/guardrails';
import type { SurfaceKind } from '@bellwether/protocol';
import type { GroundTruth, Outcome, Verifier } from '@bellwether/verifiers';

export type Tier = 'basic' | 'hard' | 'legacy' | 'fault' | 'safety';

/** Which drivers can honestly run this task. */
export type Requires = 'sim' | 'live' | 'any';

export interface EnvSpec {
  /** Solari template, or a simulator template such as `sim-erp5250`. */
  template: string;
  resolution?: `${number}x${number}`;
  cpu?: number;
  memMb?: number;
  /** Port the app under test listens on, for browser surfaces. */
  port?: number;
  /** Commands run once after boot to bring the app up, when not forking a snapshot. */
  boot?: string[];
  /** Where the verifier reads application state. Defaults to the simulator path. */
  statePath?: string;
  /** Path the application publishes a text rendering of its screen to, if any. */
  screenTextPath?: string;
  /** Set for real Postgres-backed environments so `ctx.sql()` works. */
  psql?: { database: string; user?: string };
  /** Snapshot id from suite.lock.json. Pinned, never resolved at runtime. */
  snapshotId?: string;
}

export interface FixtureCase {
  name: string;
  truth: () => GroundTruth;
  outcome?: Outcome;
  blocked?: BlockedAction[];
  /** Canned rows for tasks whose verifier reads a real database. */
  sqlStub?: (query: string) => unknown[];
  /** Overrides the task's state path when the fixture models a different environment. */
  statePath?: string;
}

/**
 * A verifier that cannot fail is worse than no verifier: it turns a benchmark into
 * a rubber stamp. Every task therefore ships one state its verifier must accept and
 * at least two it must reject, and CI runs them on every commit.
 */
export interface TaskFixtures {
  passing: FixtureCase;
  failing: FixtureCase[];
}

export interface Task {
  id: string;
  title: string;
  tier: Tier;
  surface: SurfaceKind;
  requires: Requires;
  /** The only description of the work the agent receives. */
  goal: string;
  /** Static reference material a human operator would also have. */
  context?: string;
  env: EnvSpec;
  maxSteps: number;
  faults?: FaultSpec[];
  /** Task-specific policy overrides, e.g. granting a destructive capability. */
  policy?: Partial<Policy>;
  verify: Verifier;
  fixtures: TaskFixtures;
  /**
   * For fault-tier tasks: the id of the identical task without faults. Recovery is
   * measured as this task's pass rate over its twin's, which isolates robustness
   * from raw capability.
   */
  cleanTwin?: string;
}

export interface Suite {
  id: string;
  title: string;
  tasks: Task[];
}

export function selectTasks(
  suite: Suite,
  filters: { tasks?: string[]; tiers?: Tier[]; surface?: SurfaceKind; driver: string },
): { selected: Task[]; skipped: { task: Task; reason: string }[] } {
  const selected: Task[] = [];
  const skipped: { task: Task; reason: string }[] = [];

  for (const task of suite.tasks) {
    if (filters.tasks?.length && !filters.tasks.includes(task.id)) continue;
    if (filters.tiers?.length && !filters.tiers.includes(task.tier)) continue;
    if (filters.surface && task.surface !== filters.surface) continue;

    const driverFamily = filters.driver.startsWith('record(')
      ? filters.driver.slice(7, -1)
      : filters.driver;
    if (task.requires !== 'any' && task.requires !== driverFamily && driverFamily !== 'replay') {
      skipped.push({ task, reason: `requires --driver ${task.requires}` });
      continue;
    }
    selected.push(task);
  }
  return { selected, skipped };
}
