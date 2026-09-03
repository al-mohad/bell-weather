import { performance } from 'node:perf_hooks';
import type { Action, ActionResult, SurfaceKind } from '@bellwether/protocol';
import type { AnySurface, Frame, MachineHandle } from '@bellwether/solari';

export interface Surface {
  readonly kind: SurfaceKind;
  readonly display: { width: number; height: number };
  /** The machine to verify against. Browser tasks verify against their app sandbox. */
  readonly machine: MachineHandle;
  observe(): Promise<Frame>;
  apply(action: Action): Promise<ActionResult>;
  /** VNC or session-replay URL, recorded in the trace for human review. */
  evidenceUrl(): Promise<string | undefined>;
  dispose(): Promise<void>;
}

export interface SurfaceOptions {
  /** Set by the fault injector; the next action is accepted and silently discarded. */
  dropNextInput?: boolean;
}

/**
 * The single place where a protocol action becomes real input. Keeping this in one
 * function is what lets a task definition be surface-agnostic and what keeps
 * "the agent did X" in the trace identical to "the surface was asked to do X".
 */
export class DriverSurface implements Surface {
  readonly kind: SurfaceKind;
  readonly display: { width: number; height: number };
  private dropNext = false;

  constructor(
    /** Exposed so the fault injector can ask the environment for application faults. */
    readonly handle: AnySurface,
    readonly machine: MachineHandle,
    display?: { width: number; height: number },
  ) {
    this.kind = 'display' in handle ? 'desktop' : 'browser';
    this.display = display ?? ('display' in handle ? handle.display : { width: 1280, height: 800 });
  }

  /** Called by the fault injector, never by an agent. */
  dropNextInput(): void {
    this.dropNext = true;
  }

  async observe(): Promise<Frame> {
    return this.handle.frame();
  }

  async apply(action: Action): Promise<ActionResult> {
    const started = performance.now();
    const done = (ok: boolean, error?: string): ActionResult => ({
      ok,
      ...(error ? { error } : {}),
      tookMs: Math.round(performance.now() - started),
    });

    if (this.dropNext) {
      this.dropNext = false;
      // Reported as a success, because that is what a dropped click looks like from
      // the agent's side. Detecting it is the agent's problem, which is the point.
      return done(true);
    }

    try {
      switch (action.kind) {
        case 'click':
          await this.handle.click(action.x, action.y, {
            button: action.button,
            clicks: action.clicks,
          });
          break;
        case 'move':
          await this.handle.move(action.x, action.y);
          break;
        case 'type':
          await this.handle.type(action.text);
          break;
        case 'key':
          await this.handle.press(action.keys);
          break;
        case 'scroll':
          await this.handle.scroll(action.x, action.y, action.direction, action.amount);
          break;
        case 'navigate':
          if (!('navigate' in this.handle)) return done(false, 'navigate is a browser-only action');
          await this.handle.navigate(action.url);
          break;
        case 'wait':
          await new Promise((resolve) => setTimeout(resolve, action.ms));
          break;
        case 'done':
        case 'abstain':
          break;
      }
      return done(true);
    } catch (error) {
      return done(false, error instanceof Error ? error.message : String(error));
    }
  }

  async evidenceUrl(): Promise<string | undefined> {
    if ('streamUrl' in this.handle) return this.handle.streamUrl();
    if ('recordingUrl' in this.handle) return this.handle.recordingUrl();
    return undefined;
  }

  async dispose(): Promise<void> {
    await this.handle.kill().catch(() => undefined);
  }
}
