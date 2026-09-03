import { fixtureContext } from '@bellwether/verifiers';
import type { FixtureCase, Task } from './task';

export interface SelfTestCase {
  taskId: string;
  fixture: string;
  expected: 'pass' | 'fail';
  actual: 'pass' | 'fail';
  ok: boolean;
  reason: string;
}

/**
 * Proves a verifier is falsifiable: it must accept the known-good state and reject
 * every known-bad one. A verifier that passes its own failing fixtures is a
 * benchmark bug, and CI treats it as a build failure rather than a warning.
 *
 * This runs on plain data - no driver, no sandbox, no agent, no API key - which is
 * why it can gate every commit instead of every release.
 */
export async function selfTestTask(task: Task): Promise<SelfTestCase[]> {
  const cases: SelfTestCase[] = [];

  const evaluate = async (fixture: FixtureCase, expected: 'pass' | 'fail'): Promise<void> => {
    const context = fixtureContext(fixture.truth(), {
      outcome: fixture.outcome ?? 'done',
      blocked: fixture.blocked ?? [],
      statePath: task.env.statePath,
      sqlStub: fixture.sqlStub,
    });
    const verdict = await task.verify(context);
    const actual = verdict.pass ? 'pass' : 'fail';
    cases.push({
      taskId: task.id,
      fixture: fixture.name,
      expected,
      actual,
      ok: actual === expected,
      reason: verdict.reason,
    });
  };

  await evaluate(task.fixtures.passing, 'pass');
  for (const failing of task.fixtures.failing) await evaluate(failing, 'fail');
  return cases;
}

export async function selfTestSuite(tasks: Task[]): Promise<SelfTestCase[]> {
  const all: SelfTestCase[] = [];
  for (const task of tasks) all.push(...(await selfTestTask(task)));
  return all;
}
