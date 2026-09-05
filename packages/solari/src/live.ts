import { EnvironmentError } from '@bellwether/core';
import { normalizeKey } from '@bellwether/protocol';
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
} from './types';

/**
 * Adapter for the real Solari platform.
 *
 * Verified against @solarisdk/sandbox 0.1.2 and @solarisdk/core: sandbox and desktop
 * creation, the control channel, exec, files, preview URLs, snapshot and fork isolation
 * all exercised live. The browser surface is the remaining unverified path and says so.
 *
 * Two things the SDK requires that are easy to miss, and that cost a debugging session
 * each:
 *
 *   1. `create()` returns a handle whose control channel is not yet open. `commands.run`
 *      works anyway (it has an HTTP fallback), but every filesystem call fails with
 *      "Not connected" until `connect()` is awaited.
 *   2. Concurrency is capped per plan. Forking a snapshot while the parent is still
 *      alive raises ConcurrencyLimitError, so the runner must either kill as it goes or
 *      run at a concurrency the plan allows.
 */

const DEFAULT_BASE_URL = 'https://api.getsolari.com';

/* Structural types for the parts of the SDK this adapter touches. Declared locally so
 * the package builds and typechecks with the optional peers absent. */

interface SdkCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface SdkFiles {
  readText(path: string): Promise<string>;
  write(path: string, data: string): Promise<void>;
}

interface SdkSession {
  readonly id: string;
  connect(): Promise<void>;
  commands: { run(cmd: string, opts?: Record<string, unknown>): Promise<SdkCommandResult> };
  files: SdkFiles;
  previewUrl(port: number): Promise<{ url: string; token?: string }>;
  snapshot(name?: string): Promise<string>;
  kill(): Promise<void>;
}

interface SdkDesktop extends SdkSession {
  readonly streamUrl: string;
  exec(cmd: string, opts?: Record<string, unknown>): Promise<SdkCommandResult>;
  fs: SdkFiles;
  screenshot(opts?: { format?: string; quality?: number }): Promise<Uint8Array>;
  display: { size(): Promise<{ w: number; h: number }> };
  mouse: {
    move(x: number, y: number, opts?: Record<string, unknown>): Promise<void>;
    click(x: number, y: number, opts?: Record<string, unknown>): Promise<void>;
    doubleClick(x: number, y: number, opts?: Record<string, unknown>): Promise<void>;
    scroll(x: number, y: number, opts?: Record<string, unknown>): Promise<void>;
  };
  keyboard: { type(text: string): Promise<void>; press(keys: string | string[]): Promise<void> };
}

interface SdkSandboxClient {
  create(opts: Record<string, unknown>): Promise<SdkSession>;
  createDesktop(opts: Record<string, unknown>): Promise<SdkDesktop>;
}

interface SdkSandboxModule {
  SandboxClient: new (opts: { apiKey: string; baseUrl: string }) => SdkSandboxClient;
}

async function loadSandboxSdk(): Promise<SdkSandboxModule> {
  try {
    return (await import('@solarisdk/sandbox')) as unknown as SdkSandboxModule;
  } catch {
    throw new EnvironmentError(
      'the live driver needs @solarisdk/sandbox: pnpm add -w @solarisdk/sandbox',
    );
  }
}

/** The SDK's typed errors carry the only actionable diagnosis the platform gives. */
function rethrow(error: unknown, what: string): never {
  const name = error instanceof Error ? error.constructor.name : 'Error';
  const message = error instanceof Error ? error.message : String(error);
  if (name === 'ConcurrencyLimitError') {
    throw new EnvironmentError(
      `${what}: ${message}. Your plan caps concurrent sessions - rerun with --concurrency 1, or raise the cap.`,
    );
  }
  if (name === 'AuthError') {
    throw new EnvironmentError(`${what}: ${message}. Check SOLARI_API_KEY.`);
  }
  if (name === 'NoCapacityError' || name === 'PlanError') {
    throw new EnvironmentError(`${what}: ${message}`);
  }
  throw new EnvironmentError(`${what}: ${name}: ${message}`);
}

/**
 * X11 button codes for wheel events. The SDK expresses scroll direction through the
 * button rather than a delta, which is the X convention and not the one the protocol
 * uses, so the translation lives here.
 */
const SCROLL_BUTTON: Record<string, string> = {
  up: 'wheelUp',
  down: 'wheelDown',
  left: 'wheelLeft',
  right: 'wheelRight',
};

/** Bellwether key names to X keysyms. */
function toKeysym(keys: string): string {
  const normalized = normalizeKey(keys);
  const parts = normalized.split('+');
  const base = parts.pop() ?? '';
  const named: Record<string, string> = {
    Enter: 'Return',
    Escape: 'Escape',
    Tab: 'Tab',
    Backspace: 'BackSpace',
    Up: 'Up',
    Down: 'Down',
    Left: 'Left',
    Right: 'Right',
    Space: 'space',
    Delete: 'Delete',
  };
  const keysym = named[base] ?? base;
  // shift+Tab is ISO_Left_Tab on X, not a shifted Tab.
  if (keysym === 'Tab' && parts.includes('shift')) return 'ISO_Left_Tab';
  return [...parts, keysym].join('+');
}

class LiveSandbox implements MachineHandle {
  constructor(protected readonly session: SdkSession) {}

  get id(): string {
    return this.session.id;
  }

  async exec(command: string, options?: ExecOptions): Promise<ExecResult> {
    const result = await this.session.commands.run(command, {
      args: options?.args,
      cwd: options?.cwd,
      env: options?.env,
      timeoutMs: options?.timeoutMs,
    });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
  }

  async writeFile(path: string, content: string): Promise<void> {
    await this.session.files.write(path, content);
  }

  async readFile(path: string): Promise<string> {
    return this.session.files.readText(path);
  }

  async previewUrl(port: number): Promise<string> {
    return (await this.session.previewUrl(port)).url;
  }

  async snapshot(label: string): Promise<string> {
    return this.session.snapshot(label);
  }

  async kill(): Promise<void> {
    await this.session.kill();
  }
}

class LiveDesktop extends LiveSandbox implements DesktopHandle {
  constructor(
    private readonly vm: SdkDesktop,
    readonly display: { width: number; height: number },
    /** Path the application publishes a text rendering to, when it publishes one. */
    private readonly screenTextPath?: string,
  ) {
    super(vm);
  }

  async frame(): Promise<Frame> {
    const png = await this.vm.screenshot({ format: 'png' });
    const frame: Frame = {
      pngB64: Buffer.from(png).toString('base64'),
      width: this.display.width,
      height: this.display.height,
    };
    if (this.screenTextPath) {
      // Environments may publish an accessibility channel the way envs/*/bw-fault
      // publishes a fault hook. Agents that read it must declare that they did.
      frame.screenText = await this.vm.fs.readText(this.screenTextPath).catch(() => undefined);
    }
    return frame;
  }

  async click(
    x: number,
    y: number,
    options?: { button?: 'left' | 'right' | 'middle'; clicks?: number },
  ): Promise<void> {
    const opts = { button: options?.button ?? 'left' };
    if ((options?.clicks ?? 1) >= 2) await this.vm.mouse.doubleClick(x, y, opts);
    else await this.vm.mouse.click(x, y, opts);
  }

  async move(x: number, y: number): Promise<void> {
    await this.vm.mouse.move(x, y, { humanize: true });
  }

  async type(text: string): Promise<void> {
    await this.vm.keyboard.type(text);
  }

  async press(keys: string): Promise<void> {
    await this.vm.keyboard.press(toKeysym(keys));
  }

  async scroll(
    x: number,
    y: number,
    direction: 'up' | 'down' | 'left' | 'right',
    amount: number,
  ): Promise<void> {
    const button = SCROLL_BUTTON[direction] ?? 'wheelDown';
    for (let tick = 0; tick < amount; tick++) {
      await this.vm.mouse.scroll(x, y, { button });
    }
  }

  async streamUrl(): Promise<string | undefined> {
    return this.vm.streamUrl;
  }

  override async exec(command: string, options?: ExecOptions): Promise<ExecResult> {
    const result = await this.vm.exec(command, {
      args: options?.args,
      cwd: options?.cwd,
      timeoutMs: options?.timeoutMs,
    });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
  }

  override async writeFile(path: string, content: string): Promise<void> {
    await this.vm.fs.write(path, content);
  }

  override async readFile(path: string): Promise<string> {
    return this.vm.fs.readText(path);
  }
}

export interface LiveDriverOptions {
  apiKey?: string;
  baseUrl?: string;
}

export class LiveDriver implements SolariDriver {
  readonly name = 'live';
  readonly metered = true;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private client?: SdkSandboxClient;

  constructor(options: LiveDriverOptions = {}) {
    const apiKey = options.apiKey ?? process.env.SOLARI_API_KEY;
    if (!apiKey) {
      throw new EnvironmentError(
        'SOLARI_API_KEY is not set. Copy .env.example to .env, or run with --driver sim.',
      );
    }
    this.apiKey = apiKey;
    this.baseUrl = options.baseUrl ?? process.env.SOLARI_BASE_URL ?? DEFAULT_BASE_URL;
  }

  private async sandboxClient(): Promise<SdkSandboxClient> {
    if (!this.client) {
      const { SandboxClient } = await loadSandboxSdk();
      this.client = new SandboxClient({ apiKey: this.apiKey, baseUrl: this.baseUrl });
    }
    return this.client;
  }

  private machineOptions(options: SandboxOptions): Record<string, unknown> {
    return {
      template: options.template,
      cpu: options.cpu ?? 2,
      memMb: options.memMb ?? 2048,
      timeoutMs: options.timeoutMs ?? 10 * 60 * 1000,
      fromSnapshot: options.fromSnapshot,
      lifecycle: { onTimeout: options.onTimeout ?? 'kill' },
    };
  }

  async createSandbox(options: SandboxOptions): Promise<MachineHandle> {
    const client = await this.sandboxClient();
    try {
      const session = await client.create(this.machineOptions(options));
      // Filesystem calls travel over the control channel, which create() leaves closed.
      await session.connect();
      return new LiveSandbox(session);
    } catch (error) {
      rethrow(error, `creating a sandbox from template "${options.template}"`);
    }
  }

  async createDesktop(options: DesktopOptions): Promise<DesktopHandle> {
    const client = await this.sandboxClient();
    try {
      const vm = await client.createDesktop({
        ...this.machineOptions(options),
        ...(options.resolution ? { resolution: options.resolution } : {}),
      });
      await vm.connect();
      // The platform may clamp the requested resolution, and an agent that calibrates
      // from a display it was told about rather than the one it has will mis-aim every
      // click. Ask the VM.
      const size = await vm.display.size();
      return new LiveDesktop(vm, { width: size.w, height: size.h }, options.screenTextPath);
    } catch (error) {
      rethrow(error, `creating a desktop from template "${options.template}"`);
    }
  }

  async createBrowser(_options: BrowserOptions): Promise<BrowserHandle> {
    // VERIFICATION STATUS: unexecuted. The browser surface has not been run against
    // the live service; sandboxes and desktops have.
    throw new EnvironmentError(
      'the live browser surface is not implemented against @solarisdk/browser yet. Desktop and sandbox surfaces are.',
    );
  }

  async close(): Promise<void> {
    /* Handles own their own lifecycle; the runner kills each one in a finally block. */
  }
}
