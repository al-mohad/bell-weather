import { randomUUID } from 'node:crypto';
import { EnvironmentError } from '@bellwether/core';
import { cellSize, renderTerminalPng } from '../png';
import { Erp5250Sim } from './erp5250';
import type { EnvFaultCapable, EnvFaultKind } from '../capability';
import type {
  BrowserHandle,
  BrowserOptions,
  DesktopHandle,
  DesktopOptions,
  ExecOptions,
  ExecResult,
  Frame,
  MachineHandle,
  SandboxOptions,
  SolariDriver,
} from '../types';

/** Path the simulator serves ground truth from. Verifiers read it like any file. */
export const SIM_STATE_PATH = '/var/lib/simapp/state.json';

const SIM_TEMPLATES = new Set(['sim-erp5250']);

class SimDesktop implements DesktopHandle, EnvFaultCapable {
  readonly id = `sim_vm_${randomUUID().slice(0, 8)}`;
  readonly display: { width: number; height: number };
  private killed = false;

  private readonly cell = cellSize();

  constructor(
    private readonly sim: Erp5250Sim,
    private readonly snapshots: Map<string, string>,
  ) {
    this.display = { width: 80 * this.cell.width, height: 24 * this.cell.height };
  }

  private assertAlive(): void {
    if (this.killed) throw new EnvironmentError(`${this.id} is already destroyed`);
  }

  async frame(): Promise<Frame> {
    this.assertAlive();
    const grid = this.sim.render();
    return {
      pngB64: renderTerminalPng(grid).toString('base64'),
      width: this.display.width,
      height: this.display.height,
      screenText: grid.join('\n'),
    };
  }

  async click(x: number, y: number): Promise<void> {
    this.assertAlive();
    this.sim.click(x, y, this.cell);
  }

  async move(): Promise<void> {
    this.assertAlive();
  }

  async type(text: string): Promise<void> {
    this.assertAlive();
    this.sim.type(text);
  }

  async press(keys: string): Promise<void> {
    this.assertAlive();
    this.sim.press(keys);
  }

  async scroll(): Promise<void> {
    this.assertAlive();
    this.sim.scroll();
  }

  async streamUrl(): Promise<string | undefined> {
    return undefined;
  }

  async injectEnvFault(kind: EnvFaultKind): Promise<boolean> {
    this.assertAlive();
    if (kind === 'modal') this.sim.openSurveyModal();
    else this.sim.expireSession();
    return true;
  }

  async exec(command: string, options?: ExecOptions): Promise<ExecResult> {
    this.assertAlive();
    const argv = [command, ...(options?.args ?? [])].join(' ');
    if (argv === 'bw-sim state') {
      return { stdout: this.sim.groundTruth(), stderr: '', exitCode: 0 };
    }
    return { stdout: '', stderr: `sim: command not found: ${command}`, exitCode: 127 };
  }

  async writeFile(): Promise<void> {
    throw new EnvironmentError('the simulator filesystem is read-only');
  }

  async readFile(path: string): Promise<string> {
    this.assertAlive();
    if (path === SIM_STATE_PATH) return this.sim.groundTruth();
    throw new EnvironmentError(`sim: no such file: ${path}`);
  }

  async previewUrl(port: number): Promise<string> {
    return `https://sim.invalid/${this.id}/${port}`;
  }

  async snapshot(label: string): Promise<string> {
    this.assertAlive();
    const id = `sim_snap_${label}_${randomUUID().slice(0, 8)}`;
    this.snapshots.set(id, this.sim.serialize());
    return id;
  }

  async kill(): Promise<void> {
    this.killed = true;
  }
}

/**
 * In-process simulator. Costs nothing, needs no API key, and is byte-deterministic,
 * so CI can run the whole suite at k=5 on every pull request.
 *
 * It is not a substitute for a live run: it has no real browser, no vision problem
 * and no network. Its job is to make the harness itself falsifiable. Every number
 * published as a Bellwether result must say which driver produced it.
 */
export class SimDriver implements SolariDriver {
  readonly name = 'sim';
  readonly metered = false;
  private readonly snapshots = new Map<string, string>();

  async createDesktop(options: DesktopOptions): Promise<DesktopHandle> {
    if (!SIM_TEMPLATES.has(options.template)) {
      throw new EnvironmentError(
        `simulator has no template "${options.template}" (available: ${[...SIM_TEMPLATES].join(', ')})`,
      );
    }
    const sim = options.fromSnapshot
      ? Erp5250Sim.deserialize(this.restore(options.fromSnapshot))
      : new Erp5250Sim();
    return new SimDesktop(sim, this.snapshots);
  }

  async createSandbox(options: SandboxOptions): Promise<MachineHandle> {
    return this.createDesktop(options);
  }

  async createBrowser(_options: BrowserOptions): Promise<BrowserHandle> {
    throw new EnvironmentError(
      'the simulator has no browser surface. Run browser tasks with --driver live, or filter them out with --surface desktop.',
    );
  }

  private restore(snapshotId: string): string {
    const state = this.snapshots.get(snapshotId);
    if (!state) throw new EnvironmentError(`unknown snapshot ${snapshotId}`);
    return state;
  }

  async close(): Promise<void> {
    this.snapshots.clear();
  }
}
