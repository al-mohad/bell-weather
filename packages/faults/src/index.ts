import type { Rng } from '@bellwether/core';
import { isEnvFaultCapable } from '@bellwether/solari';
import type { DriverSurface } from '@bellwether/surfaces';

export type FaultSpec =
  /** An application modal appears and must be dismissed before work continues. */
  | { kind: 'modal'; atStep?: number; probability?: number }
  /** The session expires; in-flight form state is lost and must not be double-committed. */
  | { kind: 'session-expiry'; atStep?: number; probability?: number }
  /** One input is accepted by the transport and never reaches the application. */
  | { kind: 'drop-input'; probability: number }
  /** Added latency, to expose agents that race the UI. */
  | { kind: 'latency'; ms: number; probability: number };

export interface InjectedFault {
  stepIndex: number;
  kind: FaultSpec['kind'];
  /** False when the environment could not produce this fault; recorded, not hidden. */
  applied: boolean;
  detail?: string;
}

/**
 * Fires faults from a seeded RNG so a trial is reproducible from
 * (runSeed, taskId, trialIndex) alone. `atStep` pins a fault to an exact step for
 * tasks that must always see it; `probability` is for wear-and-tear tasks.
 *
 * Faults never depend on wall-clock time or on the agent's behaviour, because a
 * benchmark whose difficulty varies with the agent cannot compare two agents.
 */
export class FaultInjector {
  private readonly injected: InjectedFault[] = [];

  constructor(
    private readonly specs: readonly FaultSpec[],
    private readonly rng: Rng,
  ) {}

  get log(): readonly InjectedFault[] {
    return this.injected;
  }

  async beforeStep(stepIndex: number, surface: DriverSurface): Promise<void> {
    for (const spec of this.specs) {
      if (!this.shouldFire(spec, stepIndex)) continue;

      switch (spec.kind) {
        case 'drop-input':
          surface.dropNextInput();
          this.injected.push({ stepIndex, kind: spec.kind, applied: true });
          break;

        case 'latency':
          await new Promise((resolve) => setTimeout(resolve, spec.ms));
          this.injected.push({ stepIndex, kind: spec.kind, applied: true, detail: `${spec.ms}ms` });
          break;

        case 'modal':
        case 'session-expiry': {
          const handle: unknown = surface.handle;
          if (!isEnvFaultCapable(handle)) {
            this.injected.push({
              stepIndex,
              kind: spec.kind,
              applied: false,
              detail: 'environment exposes no bw-fault hook',
            });
            break;
          }
          const applied = await handle.injectEnvFault(spec.kind);
          this.injected.push({ stepIndex, kind: spec.kind, applied });
          break;
        }
      }
    }
  }

  private shouldFire(spec: FaultSpec, stepIndex: number): boolean {
    if ('atStep' in spec && spec.atStep !== undefined) return stepIndex === spec.atStep;
    const probability = 'probability' in spec ? spec.probability : undefined;
    if (probability === undefined) return false;
    return this.rng.chance(probability);
  }
}
