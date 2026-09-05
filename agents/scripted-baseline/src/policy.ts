import type { Action } from '@bellwether/protocol';
import { cellFromDisplay, fieldCenter, parseScreen } from './screen';
import type { Display, Screen } from './screen';

export type Goal =
  | { kind: 'credit'; customerId: string; amount: string }
  | { kind: 'po'; quoteId: string }
  | { kind: 'unsupported'; why: string };

/** The agent reads its objective out of the task's own wording, like an operator would. */
export function parseGoal(goalText: string): Goal {
  const credit = /credit limit for customer (\d+) to ([\d.]+)/i.exec(goalText);
  if (credit?.[1] && credit[2]) {
    return { kind: 'credit', customerId: credit[1], amount: credit[2] };
  }
  const quote = /quote (Q-\d+)/i.exec(goalText);
  if (quote?.[1]) return { kind: 'po', quoteId: quote[1] };
  return {
    kind: 'unsupported',
    why: 'this flow only covers customer credit limit changes and vendor quote transcription; the instruction is outside it',
  };
}

/**
 * How the flow moves the cursor between fields.
 *
 * `click` aims at a pixel derived from the display geometry - fine on a surface that is
 * exactly the character grid, useless on a real desktop where the terminal sits in a
 * window with a title bar at an arbitrary offset.
 *
 * `keyboard` presses Tab until the screen says the right field is focused. Slower by a
 * few steps and independent of geometry entirely, which is what a live GUI needs.
 */
export type FocusStrategy = 'click' | 'keyboard';

export interface PolicyStep {
  action: Action;
  /** Field the action was aimed at, if any. Used by the flaky wrapper. */
  field?: string;
}

/**
 * A goal-directed policy rather than a fixed keystroke script.
 *
 * Every step re-reads the screen and asks "what is still wrong?", so a dropped
 * click, a modal, or a session expiry self-corrects. That robustness is the point:
 * it is the ceiling a stochastic agent is measured against, and it is what makes
 * the flaky baseline's failures attributable to unnoticed errors rather than to
 * interruptions.
 */
export class Erp5250Policy {
  private quoteLines: { sku: string; qty: string; price: string }[] | null = null;
  private vendorId: string | null = null;
  /** Fields the agent believes it has already entered correctly. */
  private readonly trusted = new Set<string>();

  private readonly cell: { width: number; height: number };

  constructor(
    private readonly goal: Goal,
    display: Display = { width: 1280, height: 768 },
    private readonly focus: FocusStrategy = 'click',
  ) {
    this.cell = cellFromDisplay(display);
  }

  /** Character cell in pixels, calibrated from the display at init. */
  get cellSize(): { width: number; height: number } {
    return this.cell;
  }

  /** Called by wrappers that corrupt an action: the agent still thinks it worked. */
  trust(field: string): void {
    this.trusted.add(field);
  }

  next(screenText: string): PolicyStep {
    const screen = parseScreen(screenText);

    if (screen.kind === 'MODAL')
      return { action: { kind: 'key', keys: 'Escape', rationale: 'dismiss the notice' } };
    if (screen.kind === 'SIGNON') {
      if ((screen.values.password ?? '') === '') {
        return {
          action: { kind: 'type', text: 'PASS', rationale: 're-authenticate' },
          field: 'password',
        };
      }
      return { action: { kind: 'key', keys: 'Enter', rationale: 'submit sign on' } };
    }

    if (this.goal.kind === 'unsupported') {
      return { action: { kind: 'abstain', reason: this.goal.why } };
    }
    if (this.goal.kind === 'credit') return this.creditStep(screen, this.goal);
    return this.poStep(screen, this.goal);
  }

  private creditStep(screen: Screen, goal: Extract<Goal, { kind: 'credit' }>): PolicyStep {
    switch (screen.kind) {
      case 'MENU':
        if (/CUSTOMER \d+ UPDATED/.test(screen.message)) {
          return { action: { kind: 'done', summary: screen.message } };
        }
        return this.driveMenu(screen, '1');
      case 'CUST_LOOKUP':
        if ((screen.values.custId ?? '') !== goal.customerId) {
          return this.setField(screen, 'custId', goal.customerId);
        }
        return { action: { kind: 'key', keys: 'Enter', rationale: 'load the customer record' } };
      case 'CUST_EDIT':
        if ((screen.values.creditLimit ?? '') !== goal.amount) {
          return this.setField(screen, 'creditLimit', goal.amount);
        }
        return {
          action: { kind: 'key', keys: 'F10', rationale: 'commit the credit limit change' },
        };
      default:
        return { action: { kind: 'key', keys: 'F3', rationale: 'return to the main menu' } };
    }
  }

  private poStep(screen: Screen, goal: Extract<Goal, { kind: 'po' }>): PolicyStep {
    if (/NOT ON FILE/.test(screen.message)) {
      return {
        action: {
          kind: 'abstain',
          reason: `the application rejected the quote: "${screen.message}". The quote cannot be entered exactly as written, so nothing was committed.`,
        },
      };
    }

    switch (screen.kind) {
      case 'MENU':
        if (/CREATED/.test(screen.message)) {
          return { action: { kind: 'done', summary: screen.message } };
        }
        return this.driveMenu(screen, this.quoteLines === null ? '3' : '2');

      case 'QUOTES': {
        const quote = screen.quotes.find((candidate) => candidate.id === goal.quoteId);
        if (!quote) {
          return {
            action: {
              kind: 'abstain',
              reason: `quote ${goal.quoteId} is not listed on the quotes screen`,
            },
          };
        }
        if (quote.lines.length > 3) {
          return {
            action: {
              kind: 'abstain',
              reason: `quote ${goal.quoteId} has ${quote.lines.length} lines but the entry screen has only three slots`,
            },
          };
        }
        this.quoteLines = quote.lines;
        this.vendorId = quote.vendorId;
        return { action: { kind: 'key', keys: 'F3', rationale: 'quote read; return to the menu' } };
      }

      case 'PO_ENTRY': {
        const desired = this.desiredPoFields();
        for (const [field, value] of Object.entries(desired)) {
          if (this.trusted.has(field)) continue;
          if ((screen.values[field] ?? '') !== value) return this.setField(screen, field, value);
        }
        return { action: { kind: 'key', keys: 'F10', rationale: 'confirm the purchase order' } };
      }

      default:
        return { action: { kind: 'key', keys: 'F3', rationale: 'return to the main menu' } };
    }
  }

  private desiredPoFields(): Record<string, string> {
    const desired: Record<string, string> = { vendorId: this.vendorId ?? '' };
    for (const index of [1, 2, 3]) {
      const line = this.quoteLines?.[index - 1];
      desired[`item${index}`] = line?.sku ?? '';
      desired[`qty${index}`] = line?.qty ?? '';
      desired[`price${index}`] = line?.price ?? '';
    }
    return desired;
  }

  private driveMenu(screen: Screen, selection: string): PolicyStep {
    if ((screen.values.selection ?? '') !== selection) {
      return this.setField(screen, 'selection', selection);
    }
    return { action: { kind: 'key', keys: 'Enter', rationale: `open menu option ${selection}` } };
  }

  /**
   * Three-state field editing: focus it, clear it, fill it. One action per step,
   * re-derived from the screen every time, so an input that never landed is simply
   * attempted again on the next step.
   */
  private setField(screen: Screen, field: string, value: string): PolicyStep {
    if (screen.focused !== field) {
      if (this.focus === 'keyboard') {
        // Fields cycle, and the screen reports which one holds the cursor, so Tab
        // always reaches the target and this terminates rather than guessing.
        return {
          action: { kind: 'key', keys: 'Tab', rationale: `move focus toward ${field}` },
          field,
        };
      }
      const { x, y } = fieldCenter(screen.kind, field, this.cell);
      return {
        action: { kind: 'click', x, y, button: 'left', clicks: 1, rationale: `focus ${field}` },
        field,
      };
    }
    const current = screen.values[field] ?? '';
    if (current !== '' && !value.startsWith(current)) {
      return { action: { kind: 'key', keys: 'Backspace', rationale: `clear ${field}` }, field };
    }
    const remainder = value.slice(current.length);
    if (remainder === '') {
      return { action: { kind: 'key', keys: 'Backspace', rationale: `trim ${field}` }, field };
    }
    return { action: { kind: 'type', text: remainder, rationale: `enter ${field}` }, field };
  }
}
