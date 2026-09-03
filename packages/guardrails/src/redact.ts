/**
 * Traces are published artifacts: screenshots, keystrokes and agent rationales all
 * end up in a public report. Anything that looks like a secret is replaced before
 * a trace is written, not before it is uploaded, so a leaked key never reaches disk.
 */
const RULES: { name: string; pattern: RegExp; replacement: string }[] = [
  {
    name: 'solari-key',
    pattern: /slr_(live|test)_[A-Za-z0-9]{6,}/g,
    replacement: 'slr_[REDACTED]',
  },
  {
    name: 'anthropic-key',
    pattern: /sk-ant-[A-Za-z0-9_-]{10,}/g,
    replacement: 'sk-ant-[REDACTED]',
  },
  { name: 'openai-key', pattern: /sk-[A-Za-z0-9]{32,}/g, replacement: 'sk-[REDACTED]' },
  { name: 'bearer', pattern: /Bearer\s+[A-Za-z0-9._-]{16,}/gi, replacement: 'Bearer [REDACTED]' },
  { name: 'aws-key', pattern: /AKIA[0-9A-Z]{16}/g, replacement: 'AKIA[REDACTED]' },
  {
    name: 'private-key',
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replacement: '[REDACTED PRIVATE KEY]',
  },
  {
    name: 'email',
    pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
    replacement: '[EMAIL]',
  },
  // 13-19 digits with optional separators: card-shaped. Deliberately broad.
  { name: 'card', pattern: /\b(?:\d[ -]?){13,19}\b/g, replacement: '[CARD]' },
];

export interface RedactionReport {
  text: string;
  hits: Record<string, number>;
}

export function redact(text: string): RedactionReport {
  let output = text;
  const hits: Record<string, number> = {};
  for (const rule of RULES) {
    const matches = output.match(rule.pattern);
    if (matches?.length) hits[rule.name] = matches.length;
    output = output.replace(rule.pattern, rule.replacement);
  }
  return { text: output, hits };
}

/** Deep-redacts a JSON-serialisable value. Used on every trace record. */
export function redactDeep<T>(value: T): { value: T; hits: Record<string, number> } {
  const hits: Record<string, number> = {};
  const walk = (input: unknown): unknown => {
    if (typeof input === 'string') {
      const result = redact(input);
      for (const [name, count] of Object.entries(result.hits)) {
        hits[name] = (hits[name] ?? 0) + count;
      }
      return result.text;
    }
    if (Array.isArray(input)) return input.map(walk);
    if (input && typeof input === 'object') {
      return Object.fromEntries(Object.entries(input).map(([key, item]) => [key, walk(item)]));
    }
    return input;
  };
  return { value: walk(value) as T, hits };
}
