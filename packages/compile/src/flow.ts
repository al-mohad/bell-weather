import type { Action } from '@bellwether/protocol';

/**
 * An assertion about the screen, derived from the trace rather than written by hand.
 *
 * `title` and `message` come from the first and last non-empty lines of the text
 * rendering. That is a heuristic and it is stated as one: it holds for fixed-layout
 * terminal surfaces, and a browser surface needs a DOM-aware equivalent before
 * these assertions mean anything there.
 */
export interface ScreenAssertion {
  title?: string;
  message?: string;
  fieldValues?: Record<string, string>;
}

export interface FlowStep {
  index: number;
  action: Action;
  /** The screen the recorded run saw before acting. Drift is detected here. */
  expect?: ScreenAssertion;
  /** Parameter name when this step's literal was hoisted into an input. */
  parameter?: string;
}

export interface FlowParameter {
  name: string;
  /** The literal observed in the recorded run, kept as the default. */
  example: string;
}

export interface Flow {
  id: string;
  taskId: string;
  sourceTrialId: string;
  sourceRunId: string;
  createdAt: string;
  surface: string;
  parameters: FlowParameter[];
  steps: FlowStep[];
}

export interface FlowRunResult {
  ok: boolean;
  /** Step index where the screen stopped matching the recording. */
  driftAt?: number;
  reason?: string;
  stepsExecuted: number;
}

export function summarizeScreen(screenText: string | undefined): ScreenAssertion {
  if (!screenText) return {};
  const lines = screenText.split('\n').map((line) => line.trim());
  const nonEmpty = lines.filter((line) => line !== '');
  return { title: nonEmpty[0], message: nonEmpty[nonEmpty.length - 1] };
}

export function assertionMatches(
  expected: ScreenAssertion | undefined,
  actual: ScreenAssertion,
): { ok: true } | { ok: false; reason: string } {
  if (!expected) return { ok: true };
  if (expected.title !== undefined && expected.title !== actual.title) {
    return {
      ok: false,
      reason: `expected screen "${expected.title}", found "${actual.title ?? '(none)'}"`,
    };
  }
  if (expected.message !== undefined && expected.message !== actual.message) {
    return {
      ok: false,
      reason: `expected status line "${expected.message}", found "${actual.message ?? '(none)'}"`,
    };
  }
  return { ok: true };
}
