import { EnvironmentError } from '@bellwether/core';
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
 * ============================ VERIFICATION STATUS ============================
 * This adapter is written against the published Solari SDK surface (sandboxes,
 * desktops, browsers; snapshot/fork; previewUrl; screenshot and input; streamUrl)
 * but has NOT been executed against the live service in this repository, because
 * no live run has been made yet. Treat every method here as unverified until
 * `pnpm bench:live` has produced a result and docs/methodology.md records it.
 *
 * The simulator is the verified path. That distinction is deliberate and is the
 * reason the driver interface exists at all.
 * =============================================================================
 */

/* Minimal structural types for the parts of the SDK we touch. Declared locally so
 * the package builds and typechecks with the optional peers absent. */

interface SdkCommandResult {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
}

interface SdkFiles {
  write(path: string, content: string): Promise<void>;
  readText(path: string): Promise<string>;
}

interface SdkSandbox {
  id?: string;
  commands: { run(command: string, options?: Record<string, unknown>): Promise<SdkCommandResult> };
  files: SdkFiles;
  previewUrl(port: number): Promise<string> | string;
  snapshot(label: string): Promise<string> | string;
  kill(): Promise<void>;
}

interface SdkDesktop extends SdkSandbox {
  streamUrl?: string | (() => Promise<string>);
  screenshot(options?: { format?: string; quality?: number }): Promise<Buffer | string>;
  exec(command: string, options?: Record<string, unknown>): Promise<SdkCommandResult>;
  fs: SdkFiles;
  mouse: {
    move(x: number, y: number, options?: Record<string, unknown>): Promise<void>;
    click(x: number, y: number, options?: Record<string, unknown>): Promise<void>;
    scroll(x: number, y: number, direction: string, amount: number): Promise<void>;
  };
  keyboard: { type(text: string): Promise<void>; press(keys: string): Promise<void> };
}

interface SdkNamespace<T, O> {
  create(options: O): Promise<T>;
}

async function loadModule<T>(specifier: string): Promise<T> {
  try {
    return (await import(/* @vite-ignore */ specifier)) as T;
  } catch {
    throw new EnvironmentError(
      `${specifier} is not installed. The live driver needs it: pnpm add -w ${specifier}`,
    );
  }
}

function toBase64(png: Buffer | string): string {
  return typeof png === 'string' ? png : png.toString('base64');
}

class LiveDesktop implements DesktopHandle {
  constructor(
    readonly id: string,
    readonly display: { width: number; height: number },
    private readonly vm: SdkDesktop,
  ) {}

  async frame(): Promise<Frame> {
    const png = await this.vm.screenshot({ format: 'png' });
    return { pngB64: toBase64(png), width: this.display.width, height: this.display.height };
  }

  async click(
    x: number,
    y: number,
    options?: { button?: 'left' | 'right' | 'middle'; clicks?: number },
  ): Promise<void> {
    await this.vm.mouse.click(x, y, {
      button: options?.button ?? 'left',
      clicks: options?.clicks ?? 1,
    });
  }

  async move(x: number, y: number): Promise<void> {
    await this.vm.mouse.move(x, y, { humanize: true });
  }

  async type(text: string): Promise<void> {
    await this.vm.keyboard.type(text);
  }

  async press(keys: string): Promise<void> {
    await this.vm.keyboard.press(keys);
  }

  async scroll(
    x: number,
    y: number,
    direction: 'up' | 'down' | 'left' | 'right',
    amount: number,
  ): Promise<void> {
    await this.vm.mouse.scroll(x, y, direction, amount);
  }

  async streamUrl(): Promise<string | undefined> {
    const value = this.vm.streamUrl;
    if (typeof value === 'function') return value();
    return value;
  }

  async exec(command: string, options?: ExecOptions): Promise<ExecResult> {
    const result = await this.vm.exec(command, { ...options });
    return {
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      exitCode: result.exitCode ?? 0,
    };
  }

  async writeFile(path: string, content: string): Promise<void> {
    await this.vm.fs.write(path, content);
  }

  async readFile(path: string): Promise<string> {
    return this.vm.fs.readText(path);
  }

  async previewUrl(port: number): Promise<string> {
    return this.vm.previewUrl(port);
  }

  async snapshot(label: string): Promise<string> {
    return this.vm.snapshot(label);
  }

  async kill(): Promise<void> {
    await this.vm.kill();
  }
}

class LiveSandbox implements MachineHandle {
  constructor(
    readonly id: string,
    private readonly sbx: SdkSandbox,
  ) {}

  async exec(command: string, options?: ExecOptions): Promise<ExecResult> {
    const result = await this.sbx.commands.run(command, { ...options });
    return {
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      exitCode: result.exitCode ?? 0,
    };
  }

  async writeFile(path: string, content: string): Promise<void> {
    await this.sbx.files.write(path, content);
  }

  async readFile(path: string): Promise<string> {
    return this.sbx.files.readText(path);
  }

  async previewUrl(port: number): Promise<string> {
    return this.sbx.previewUrl(port);
  }

  async snapshot(label: string): Promise<string> {
    return this.sbx.snapshot(label);
  }

  async kill(): Promise<void> {
    await this.sbx.kill();
  }
}

export interface LiveDriverOptions {
  apiKey?: string;
}

export class LiveDriver implements SolariDriver {
  readonly name = 'live';
  readonly metered = true;
  private readonly apiKey: string;

  constructor(options: LiveDriverOptions = {}) {
    const apiKey = options.apiKey ?? process.env.SOLARI_API_KEY;
    if (!apiKey) {
      throw new EnvironmentError(
        'SOLARI_API_KEY is not set. Copy .env.example to .env, or run with --driver sim.',
      );
    }
    this.apiKey = apiKey;
  }

  async createSandbox(options: SandboxOptions): Promise<MachineHandle> {
    const mod = await loadModule<{ sandboxes: SdkNamespace<SdkSandbox, Record<string, unknown>> }>(
      '@solarisdk/sandbox',
    );
    const sbx = await mod.sandboxes.create(this.machineOptions(options));
    return new LiveSandbox(sbx.id ?? 'sandbox', sbx);
  }

  async createDesktop(options: DesktopOptions): Promise<DesktopHandle> {
    const mod = await loadModule<{ desktops: SdkNamespace<SdkDesktop, Record<string, unknown>> }>(
      '@solarisdk/desktop',
    );
    const resolution = options.resolution ?? '1280x720';
    const [width, height] = resolution.split('x').map(Number);
    const vm = await mod.desktops.create({ ...this.machineOptions(options), resolution });
    return new LiveDesktop(vm.id ?? 'desktop', { width: width ?? 1280, height: height ?? 720 }, vm);
  }

  async createBrowser(options: BrowserOptions): Promise<BrowserHandle> {
    const { createLiveBrowser } = await import('./live-browser');
    return createLiveBrowser(this.apiKey, options);
  }

  private machineOptions(options: SandboxOptions): Record<string, unknown> {
    return {
      apiKey: this.apiKey,
      template: options.template,
      cpu: options.cpu ?? 2,
      memMb: options.memMb ?? 2048,
      timeoutMs: options.timeoutMs ?? 10 * 60 * 1000,
      fromSnapshot: options.fromSnapshot,
      lifecycle: { onTimeout: options.onTimeout ?? 'kill' },
    };
  }

  async close(): Promise<void> {
    /* Handles own their own lifecycle; the runner kills each one in a finally block. */
  }
}
