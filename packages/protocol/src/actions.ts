import { z } from 'zod';

/**
 * Fields every action may carry. Kept out of the discriminated union members so
 * adding one is a MINOR protocol bump rather than a rewrite of every variant.
 */
const provenance = {
  /** Free text. Recorded in the trace, never parsed by the harness. */
  rationale: z.string().max(2000).optional(),
  /** Self-reported confidence. Used only for reporting and abstention analysis. */
  confidence: z.number().min(0).max(1).optional(),
};

export const MouseButton = z.enum(['left', 'right', 'middle']);
export const ScrollDirection = z.enum(['up', 'down', 'left', 'right']);

export const ActionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('click'),
    x: z.number().int().min(0),
    y: z.number().int().min(0),
    button: MouseButton.default('left'),
    clicks: z.number().int().min(1).max(3).default(1),
    ...provenance,
  }),
  z.object({
    kind: z.literal('move'),
    x: z.number().int().min(0),
    y: z.number().int().min(0),
    ...provenance,
  }),
  z.object({
    kind: z.literal('type'),
    text: z.string().max(4096),
    ...provenance,
  }),
  z.object({
    /** Chord or named key: "Enter", "F3", "ctrl+s", "shift+Tab". */
    kind: z.literal('key'),
    keys: z.string().min(1).max(64),
    ...provenance,
  }),
  z.object({
    kind: z.literal('scroll'),
    x: z.number().int().min(0),
    y: z.number().int().min(0),
    direction: ScrollDirection,
    amount: z.number().int().min(1).max(30).default(3),
    ...provenance,
  }),
  z.object({
    kind: z.literal('navigate'),
    url: z.string().url(),
    ...provenance,
  }),
  z.object({
    kind: z.literal('wait'),
    ms: z.number().int().min(0).max(30_000),
    ...provenance,
  }),
  /** The agent believes the task is complete. The verifier decides whether it is. */
  z.object({
    kind: z.literal('done'),
    summary: z.string().max(2000).optional(),
    ...provenance,
  }),
  /**
   * The agent believes the task cannot be completed correctly and is stopping.
   * On tasks designed to be unresolvable this is the *passing* action.
   */
  z.object({
    kind: z.literal('abstain'),
    reason: z.string().min(1).max(2000),
    ...provenance,
  }),
]);

export type Action = z.infer<typeof ActionSchema>;
export type ActionKind = Action['kind'];

/** Actions that end the trial. */
export const TERMINAL_ACTIONS = ['done', 'abstain'] as const satisfies readonly ActionKind[];

export function isTerminal(action: Action): boolean {
  return (TERMINAL_ACTIONS as readonly string[]).includes(action.kind);
}

/**
 * Canonical form for a key chord, shared by every layer that reasons about keys.
 *
 * This lives in the protocol package deliberately: guardrails deny chords and
 * surfaces execute them, and two normalisers that disagree by a letter case is a
 * policy bypass, not a style issue.
 *
 *   "CTRL+S" -> "ctrl+s"      "Control+shift+s" -> "ctrl+shift+s"
 *   "f10"    -> "F10"         "return"          -> "Enter"
 */
export function normalizeKey(keys: string): string {
  const parts = keys
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean);

  const modifiers: string[] = [];
  let base = '';
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === 'ctrl' || lower === 'control') modifiers.push('ctrl');
    else if (lower === 'shift') modifiers.push('shift');
    else if (lower === 'alt' || lower === 'option') modifiers.push('alt');
    else if (lower === 'meta' || lower === 'cmd' || lower === 'command') modifiers.push('meta');
    else base = part;
  }

  const named: Record<string, string> = {
    enter: 'Enter',
    return: 'Enter',
    esc: 'Escape',
    escape: 'Escape',
    tab: 'Tab',
    backspace: 'Backspace',
    up: 'Up',
    arrowup: 'Up',
    down: 'Down',
    arrowdown: 'Down',
    left: 'Left',
    arrowleft: 'Left',
    right: 'Right',
    arrowright: 'Right',
    space: 'Space',
    delete: 'Delete',
  };

  const lowerBase = base.toLowerCase();
  const canonical = /^f\d{1,2}$/.test(lowerBase)
    ? lowerBase.toUpperCase()
    : (named[lowerBase] ?? (base.length === 1 ? lowerBase : base));

  return [...new Set(modifiers)].sort().concat(canonical).join('+');
}
