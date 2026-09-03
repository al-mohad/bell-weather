import { describe, expect, it } from 'vitest';
import { DEFAULT_POLICY, Guardrails, redact, redactDeep } from '../src/index';

const key = (keys: string) => ({ kind: 'key' as const, keys });

describe('policy', () => {
  it('blocks a destructive key by default', () => {
    const guardrails = new Guardrails();
    const decision = guardrails.evaluate(key('F16'));
    expect(decision.allow).toBe(false);
    expect(decision.rule).toBe('denied-key');
  });

  it('allows it once the task grants the capability', () => {
    const guardrails = new Guardrails({
      ...DEFAULT_POLICY,
      grantedCapabilities: ['destructive:purge'],
    });
    expect(guardrails.evaluate(key('F16')).allow).toBe(true);
  });

  it('normalises chord spelling before matching', () => {
    const guardrails = new Guardrails();
    expect(guardrails.evaluate(key('f16')).allow).toBe(false);
    expect(guardrails.evaluate(key('Shift+F10')).allow).toBe(false);
  });

  it('caps a single type action', () => {
    const guardrails = new Guardrails();
    expect(guardrails.evaluate({ kind: 'type', text: 'x'.repeat(600) }).rule).toBe('type-too-long');
  });

  it('enforces an allowlist when a task sets one', () => {
    const guardrails = new Guardrails({ ...DEFAULT_POLICY, allowedUrlPatterns: ['sandbox'] });
    expect(
      guardrails.evaluate({ kind: 'navigate', url: 'https://sandbox.example/app' }).allow,
    ).toBe(true);
    expect(guardrails.evaluate({ kind: 'navigate', url: 'https://evil.example' }).rule).toBe(
      'url-not-allowed',
    );
  });

  it('records only the blocked attempts', () => {
    const guardrails = new Guardrails();
    guardrails.record(1, key('F16'), guardrails.evaluate(key('F16')));
    guardrails.record(2, key('F10'), guardrails.evaluate(key('F10')));
    expect(guardrails.blockedActions).toHaveLength(1);
    expect(guardrails.blockedActions[0]?.stepIndex).toBe(1);
  });
});

describe('redaction', () => {
  it('removes provider keys', () => {
    expect(redact('key slr_live_abcdef123456 here').text).toContain('slr_[REDACTED]');
    expect(redact('sk-ant-abcdefghijklmno').text).toContain('sk-ant-[REDACTED]');
  });

  it('removes card-shaped digits and addresses', () => {
    expect(redact('4111 1111 1111 1111').text).toBe('[CARD]');
    expect(redact('mail ops@example.com now').text).toContain('[EMAIL]');
  });

  it('walks nested structures and counts what it hit', () => {
    const { value, hits } = redactDeep({
      a: ['sk-ant-abcdefghijklmno'],
      b: { c: 'ops@example.com' },
    });
    expect(JSON.stringify(value)).not.toContain('sk-ant-abcdefghijklmno');
    expect(hits['anthropic-key']).toBe(1);
    expect(hits.email).toBe(1);
  });

  it('leaves ordinary text alone', () => {
    expect(redact('PO-5001 CREATED').text).toBe('PO-5001 CREATED');
  });
});
