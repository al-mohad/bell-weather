import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  ActionSchema,
  NdjsonChannel,
  ObservationSchema,
  PROTOCOL_VERSION,
  isCompatible,
  isTerminal,
  serveAgent,
} from '../src/index';

describe('action schema', () => {
  it('applies documented defaults', () => {
    const action = ActionSchema.parse({ kind: 'click', x: 10, y: 20 });
    expect(action).toMatchObject({ kind: 'click', button: 'left', clicks: 1 });
  });

  it('rejects an unknown action kind rather than passing it through', () => {
    expect(() => ActionSchema.parse({ kind: 'teleport' })).toThrow();
  });

  it('rejects negative coordinates', () => {
    expect(() => ActionSchema.parse({ kind: 'click', x: -1, y: 0 })).toThrow();
  });

  it('requires a reason for abstention, because the reason is the result', () => {
    expect(() => ActionSchema.parse({ kind: 'abstain' })).toThrow();
    expect(ActionSchema.parse({ kind: 'abstain', reason: 'item not on file' }).kind).toBe(
      'abstain',
    );
  });

  it('knows which actions end a trial', () => {
    expect(isTerminal(ActionSchema.parse({ kind: 'done' }))).toBe(true);
    expect(isTerminal(ActionSchema.parse({ kind: 'abstain', reason: 'x' }))).toBe(true);
    expect(isTerminal(ActionSchema.parse({ kind: 'key', keys: 'F10' }))).toBe(false);
  });
});

describe('observation schema', () => {
  it('requires the frame and the remaining budget', () => {
    expect(() =>
      ObservationSchema.parse({ stepIndex: 0, screenshotPngB64: 'x', width: 10, height: 10 }),
    ).toThrow();
  });
});

describe('protocol version', () => {
  it('accepts a matching major and rejects a different one', () => {
    expect(isCompatible(PROTOCOL_VERSION)).toBe(true);
    expect(isCompatible('1.7')).toBe(true);
    expect(isCompatible('2.0')).toBe(false);
  });
});

describe('ndjson transport', () => {
  it('round-trips a frame', async () => {
    const stream = new PassThrough();
    const channel = new NdjsonChannel(stream, stream);
    channel.send({ jsonrpc: '2.0', id: 1, method: 'agent.init', params: { a: 1 } });
    expect(await channel.receive()).toMatchObject({ id: 1, method: 'agent.init' });
  });

  it('skips blank lines instead of failing on them', async () => {
    const stream = new PassThrough();
    const channel = new NdjsonChannel(stream, stream);
    stream.write('\n\n{"jsonrpc":"2.0","id":9,"method":"agent.step"}\n');
    expect(await channel.receive()).toMatchObject({ id: 9 });
  });
});

describe('serveAgent', () => {
  it('answers init, step and close over one stdio pair', async () => {
    const toAgent = new PassThrough();
    const fromAgent = new PassThrough();
    const harness = new NdjsonChannel(fromAgent, toAgent);

    const served = serveAgent(
      {
        init: () => ({ agent: 'test', version: '1', protocol: PROTOCOL_VERSION }),
        step: () => ({ action: { kind: 'done' as const } }),
      },
      { input: toAgent as never, output: fromAgent as never },
    );

    harness.send({
      jsonrpc: '2.0',
      id: 1,
      method: 'agent.init',
      params: {
        protocol: PROTOCOL_VERSION,
        taskId: 't',
        goal: 'g',
        surface: 'desktop',
        budget: { steps: 10, usd: 1 },
        display: { width: 640, height: 384 },
        seed: 1,
      },
    });
    expect((await harness.receiveResponse()).result).toMatchObject({ agent: 'test' });

    harness.send({
      jsonrpc: '2.0',
      id: 2,
      method: 'agent.step',
      params: {
        observation: {
          stepIndex: 0,
          screenshotPngB64: '',
          width: 640,
          height: 384,
          remaining: { steps: 10, usd: 1 },
        },
      },
    });
    expect((await harness.receiveResponse()).result).toMatchObject({ action: { kind: 'done' } });

    harness.send({
      jsonrpc: '2.0',
      id: 3,
      method: 'agent.close',
      params: { reason: 'done', verdict: 'pass' },
    });
    await harness.receiveResponse();
    await served;
  });

  it('reports an unknown method as a JSON-RPC error rather than crashing', async () => {
    const toAgent = new PassThrough();
    const fromAgent = new PassThrough();
    const harness = new NdjsonChannel(fromAgent, toAgent);
    const served = serveAgent(
      {
        init: () => ({ agent: 'test', version: '1', protocol: PROTOCOL_VERSION }),
        step: () => ({ action: { kind: 'done' as const } }),
      },
      { input: toAgent as never, output: fromAgent as never },
    );

    harness.send({ jsonrpc: '2.0', id: 1, method: 'agent.dance' });
    expect((await harness.receiveResponse()).error?.code).toBe(-32601);
    harness.send({
      jsonrpc: '2.0',
      id: 2,
      method: 'agent.close',
      params: { reason: 'done', verdict: 'unknown' },
    });
    await harness.receiveResponse();
    await served;
  });
});
