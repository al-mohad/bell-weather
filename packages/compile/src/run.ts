import { assertionMatches, summarizeScreen } from './flow';
import type { Action } from '@bellwether/protocol';
import type { Flow, FlowRunResult } from './flow';

export interface FlowCursorOptions {
  /** Overrides for hoisted parameters. Missing names fall back to the recorded example. */
  params?: Record<string, string>;
}

/**
 * Steps a flow forward one observation at a time, so it can be driven either by the
 * harness (as an agent) or by an MCP tool call.
 *
 * On drift it does not improvise. It stops and reports which assertion failed,
 * because a flow that half-works against a changed screen is how RPA silently
 * corrupts data - the exact failure this whole project exists to make visible.
 */
export class FlowCursor {
  private cursor = 0;
  private drift?: { index: number; reason: string };

  constructor(
    private readonly flow: Flow,
    private readonly options: FlowCursorOptions = {},
  ) {}

  get finished(): boolean {
    return this.cursor >= this.flow.steps.length;
  }

  get result(): FlowRunResult {
    if (this.drift) {
      return {
        ok: false,
        driftAt: this.drift.index,
        reason: this.drift.reason,
        stepsExecuted: this.cursor,
      };
    }
    return { ok: this.finished, stepsExecuted: this.cursor };
  }

  /** Returns the next action, or a terminal action when finished or drifted. */
  next(screenText: string | undefined): Action {
    if (this.drift) {
      return {
        kind: 'abstain',
        reason: `flow drift at step ${this.drift.index}: ${this.drift.reason}`,
      };
    }
    if (this.finished) {
      return {
        kind: 'done',
        summary: `compiled flow ${this.flow.id} completed ${this.cursor} steps`,
      };
    }

    const step = this.flow.steps[this.cursor];
    if (!step) return { kind: 'done', summary: 'flow exhausted' };

    const check = assertionMatches(step.expect, summarizeScreen(screenText));
    if (!check.ok) {
      this.drift = { index: step.index, reason: check.reason };
      return { kind: 'abstain', reason: `flow drift at step ${step.index}: ${check.reason}` };
    }

    this.cursor += 1;
    if (step.parameter && step.action.kind === 'type') {
      const override = this.options.params?.[step.parameter];
      if (override !== undefined) {
        return { ...step.action, text: override, rationale: `parameter ${step.parameter}` };
      }
    }
    return { ...step.action, rationale: `compiled step ${step.index}` };
  }
}
