import { describe, expect, it, vi } from 'vitest';
import { makeRng } from '@bellwether/core';
import { FaultInjector } from '../src/index';
import type { DriverSurface } from '@bellwether/surfaces';

function fakeSurface(capable: boolean) {
  const injected: string[] = [];
  const dropped = { count: 0 };
  const handle = capable
    ? { injectEnvFault: vi.fn(async (kind: string) => (injected.push(kind), true)) }
    : {};
  return {
    surface: {
      handle,
      dropNextInput: () => {
        dropped.count += 1;
      },
    } as unknown as DriverSurface,
    injected,
    dropped,
  };
}

describe('fault injection', () => {
  it('fires a pinned fault on exactly its step', async () => {
    const { surface, injected } = fakeSurface(true);
    const injector = new FaultInjector([{ kind: 'modal', atStep: 3 }], makeRng(1));
    for (let step = 0; step < 6; step++) await injector.beforeStep(step, surface);
    expect(injected).toEqual(['modal']);
    expect(injector.log[0]?.stepIndex).toBe(3);
  });

  it('is reproducible for a given seed', async () => {
    const run = async (seed: number): Promise<number> => {
      const { surface, dropped } = fakeSurface(true);
      const injector = new FaultInjector([{ kind: 'drop-input', probability: 0.5 }], makeRng(seed));
      for (let step = 0; step < 40; step++) await injector.beforeStep(step, surface);
      return dropped.count;
    };
    expect(await run(99)).toBe(await run(99));
    expect(await run(99)).not.toBe(await run(1234));
  });

  it('records a fault the environment cannot produce instead of hiding it', async () => {
    const { surface } = fakeSurface(false);
    const injector = new FaultInjector([{ kind: 'session-expiry', atStep: 0 }], makeRng(1));
    await injector.beforeStep(0, surface);
    expect(injector.log[0]).toMatchObject({ applied: false });
    expect(injector.log[0]?.detail).toContain('bw-fault');
  });
});
