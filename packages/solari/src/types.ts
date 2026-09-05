import type { SurfaceKind } from '@bellwether/protocol';

export interface ExecOptions {
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Everything a Solari sandbox can do that the harness relies on. */
export interface MachineHandle {
  readonly id: string;
  exec(command: string, options?: ExecOptions): Promise<ExecResult>;
  writeFile(path: string, content: string): Promise<void>;
  readFile(path: string): Promise<string>;
  /** Public HTTPS URL for a port inside the machine. */
  previewUrl(port: number): Promise<string>;
  /** Freeze current state and return an id usable as `fromSnapshot`. */
  snapshot(label: string): Promise<string>;
  kill(): Promise<void>;
}

export interface Frame {
  /** Base64 PNG. */
  pngB64: string;
  width: number;
  height: number;
  /** Character grid or accessibility tree, when the surface can produce one cheaply. */
  screenText?: string;
  url?: string;
}

/** A Solari desktop VM: a machine you can also see and drive. */
export interface DesktopHandle extends MachineHandle {
  readonly display: { width: number; height: number };
  frame(): Promise<Frame>;
  click(
    x: number,
    y: number,
    options?: { button?: 'left' | 'right' | 'middle'; clicks?: number },
  ): Promise<void>;
  move(x: number, y: number): Promise<void>;
  type(text: string): Promise<void>;
  press(keys: string): Promise<void>;
  scroll(
    x: number,
    y: number,
    direction: 'up' | 'down' | 'left' | 'right',
    amount: number,
  ): Promise<void>;
  /** Live VNC URL. The human-takeover path; recorded in the trace. */
  streamUrl(): Promise<string | undefined>;
}

/** A Solari cloud browser: a CDP endpoint, not a machine you exec on. */
export interface BrowserHandle {
  readonly id: string;
  readonly cdpUrl: string;
  frame(): Promise<Frame>;
  navigate(url: string): Promise<void>;
  click(
    x: number,
    y: number,
    options?: { button?: 'left' | 'right' | 'middle'; clicks?: number },
  ): Promise<void>;
  move(x: number, y: number): Promise<void>;
  type(text: string): Promise<void>;
  press(keys: string): Promise<void>;
  scroll(
    x: number,
    y: number,
    direction: 'up' | 'down' | 'left' | 'right',
    amount: number,
  ): Promise<void>;
  /** Downloadable session replay, if recording was enabled. */
  recordingUrl(): Promise<string | undefined>;
  kill(): Promise<void>;
}

export interface SandboxOptions {
  template: string;
  cpu?: number;
  memMb?: number;
  timeoutMs?: number;
  fromSnapshot?: string;
  onTimeout?: 'pause' | 'kill';
}

export interface DesktopOptions extends SandboxOptions {
  resolution?: `${number}x${number}`;
  /**
   * Path the application under test publishes a text rendering of its screen to, if it
   * publishes one. Surfaced as `observation.screenText`; agents that read it must
   * declare `text-screen` in their capabilities.
   */
  screenTextPath?: string;
}

export interface BrowserOptions {
  /** Reuse cookies and site data from a named profile. */
  profileId?: string;
  stealth?: boolean;
  proxy?: 'none' | 'datacenter' | 'residential';
  recordSession?: boolean;
  viewport?: { width: number; height: number };
  timeoutMs?: number;
}

export interface SolariDriver {
  readonly name: string;
  /** True when trials cost real money. The runner refuses to ignore the budget when true. */
  readonly metered: boolean;
  createSandbox(options: SandboxOptions): Promise<MachineHandle>;
  createDesktop(options: DesktopOptions): Promise<DesktopHandle>;
  createBrowser(options: BrowserOptions): Promise<BrowserHandle>;
  close(): Promise<void>;
}

export type AnySurface = DesktopHandle | BrowserHandle;

export function surfaceKindOf(surface: AnySurface): SurfaceKind {
  return 'display' in surface ? 'desktop' : 'browser';
}
