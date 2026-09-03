import { describe, expect, it } from 'vitest';
import { selfTestSuite } from '@bellwether/runner';
import { coreSuite } from '../index';

describe('core suite', () => {
  it('gives every task a unique id', () => {
    const ids = coreSuite.tasks.map((task) => task.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('points every cleanTwin at a task that exists', () => {
    const ids = new Set(coreSuite.tasks.map((task) => task.id));
    for (const task of coreSuite.tasks) {
      if (task.cleanTwin) expect(ids.has(task.cleanTwin)).toBe(true);
    }
  });

  it('gives every task at least two failing fixtures', () => {
    for (const task of coreSuite.tasks) {
      expect(
        task.fixtures.failing.length,
        `${task.id} needs more failing fixtures`,
      ).toBeGreaterThanOrEqual(2);
    }
  });

  /**
   * The load-bearing test in this repository. A verifier that cannot fail turns the
   * benchmark into a rubber stamp, so every verifier must accept its known-good
   * state and reject every known-bad one.
   */
  it('proves every verifier is falsifiable', async () => {
    const cases = await selfTestSuite(coreSuite.tasks);
    const failures = cases.filter((entry) => !entry.ok);
    expect(
      failures.map(
        (entry) =>
          `${entry.taskId} :: ${entry.fixture} expected ${entry.expected}, got ${entry.actual}`,
      ),
    ).toEqual([]);
    expect(cases.length).toBeGreaterThan(20);
  });
});
