import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { EnvironmentError } from '@bellwether/core';
import type {
  BrowserHandle,
  BrowserOptions,
  DesktopHandle,
  DesktopOptions,
  MachineHandle,
  SandboxOptions,
  SolariDriver,
} from './types';

export interface CassetteEntry {
  seq: number;
  /** Stable alias assigned in creation order, so replay does not depend on server ids. */
  handle: string;
  method: string;
  args: unknown[];
  result?: unknown;
  error?: string;
  /** Static properties captured at creation (id, display, cdpUrl). */
  props?: Record<string, unknown>;
}

const HANDLE_PROPS = ['id', 'display', 'cdpUrl'] as const;
const NON_METHOD_KEYS = new Set([
  'then',
  'catch',
  'finally',
  Symbol.toStringTag as unknown as string,
]);

/**
 * Records every driver call to a JSONL cassette, and replays one without a network
 * or an API key.
 *
 * This is how a live run becomes a CI regression test. Once a cassette exists,
 * `--driver replay` re-runs the identical sequence of Solari interactions, so a
 * change to the runner that alters what the harness asks the platform for fails
 * the build instead of silently changing a published benchmark number.
 */
export class RecordingDriver implements SolariDriver {
  readonly name: string;
  readonly metered: boolean;
  private seq = 0;
  private handles = 0;

  constructor(
    private readonly inner: SolariDriver,
    private readonly cassettePath: string,
  ) {
    this.name = `record(${inner.name})`;
    this.metered = inner.metered;
    mkdirSync(dirname(cassettePath), { recursive: true });
    appendFileSync(cassettePath, '');
  }

  private write(entry: CassetteEntry): void {
    appendFileSync(this.cassettePath, `${JSON.stringify(entry)}\n`);
  }

  private wrap<T extends object>(handle: T, alias: string): T {
    const props: Record<string, unknown> = {};
    for (const key of HANDLE_PROPS) {
      if (key in handle) props[key] = (handle as Record<string, unknown>)[key];
    }
    this.write({ seq: this.seq++, handle: alias, method: '@create', args: [], props });

    return new Proxy(handle, {
      get: (target, property, receiver) => {
        const value = Reflect.get(target, property, receiver);
        if (typeof value !== 'function' || typeof property !== 'string') return value;
        return async (...args: unknown[]) => {
          const seq = this.seq++;
          try {
            const result = await (value as (...a: unknown[]) => Promise<unknown>).apply(
              target,
              args,
            );
            this.write({ seq, handle: alias, method: property, args, result });
            return result;
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.write({ seq, handle: alias, method: property, args, error: message });
            throw error;
          }
        };
      },
    });
  }

  async createSandbox(options: SandboxOptions): Promise<MachineHandle> {
    const alias = `h${this.handles++}`;
    this.write({ seq: this.seq++, handle: alias, method: '@createSandbox', args: [options] });
    return this.wrap(await this.inner.createSandbox(options), alias);
  }

  async createDesktop(options: DesktopOptions): Promise<DesktopHandle> {
    const alias = `h${this.handles++}`;
    this.write({ seq: this.seq++, handle: alias, method: '@createDesktop', args: [options] });
    return this.wrap(await this.inner.createDesktop(options), alias);
  }

  async createBrowser(options: BrowserOptions): Promise<BrowserHandle> {
    const alias = `h${this.handles++}`;
    this.write({ seq: this.seq++, handle: alias, method: '@createBrowser', args: [options] });
    return this.wrap(await this.inner.createBrowser(options), alias);
  }

  async close(): Promise<void> {
    await this.inner.close();
  }
}

export class ReplayDriver implements SolariDriver {
  readonly name = 'replay';
  readonly metered = false;
  private readonly entries: CassetteEntry[];
  private cursor = 0;
  private handles = 0;

  constructor(cassettePath: string) {
    this.entries = readFileSync(cassettePath, 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line) as CassetteEntry);
    if (this.entries.length === 0) throw new EnvironmentError(`cassette ${cassettePath} is empty`);
  }

  private take(expected: { handle?: string; method: string; args?: unknown[] }): CassetteEntry {
    const entry = this.entries[this.cursor];
    if (!entry) {
      throw new EnvironmentError(
        `cassette exhausted: expected ${expected.method} but the recording ended. The harness now makes more platform calls than when this cassette was recorded - re-record it.`,
      );
    }
    if (entry.method !== expected.method || (expected.handle && entry.handle !== expected.handle)) {
      throw new EnvironmentError(
        `cassette divergence at seq ${entry.seq}: recorded ${entry.handle}.${entry.method}, harness asked for ${expected.handle ?? '?'}.${expected.method}`,
      );
    }
    if (
      expected.args &&
      !isDeepStrictEqual(entry.args, JSON.parse(JSON.stringify(expected.args)))
    ) {
      throw new EnvironmentError(
        `cassette divergence at seq ${entry.seq} (${entry.method}): arguments differ from the recording`,
      );
    }
    this.cursor += 1;
    return entry;
  }

  private handleFor<T extends object>(alias: string): T {
    const created = this.take({ handle: alias, method: '@create' });
    const props = created.props ?? {};
    return new Proxy(
      {},
      {
        get: (_target, property) => {
          if (typeof property !== 'string' || NON_METHOD_KEYS.has(property)) return undefined;
          if (property in props) return props[property];
          return async (...args: unknown[]) => {
            const entry = this.take({ handle: alias, method: property, args });
            if (entry.error) throw new EnvironmentError(entry.error);
            return entry.result;
          };
        },
      },
    ) as T;
  }

  async createSandbox(options: SandboxOptions): Promise<MachineHandle> {
    const alias = `h${this.handles++}`;
    this.take({ handle: alias, method: '@createSandbox', args: [options] });
    return this.handleFor<MachineHandle>(alias);
  }

  async createDesktop(options: DesktopOptions): Promise<DesktopHandle> {
    const alias = `h${this.handles++}`;
    this.take({ handle: alias, method: '@createDesktop', args: [options] });
    return this.handleFor<DesktopHandle>(alias);
  }

  async createBrowser(options: BrowserOptions): Promise<BrowserHandle> {
    const alias = `h${this.handles++}`;
    this.take({ handle: alias, method: '@createBrowser', args: [options] });
    return this.handleFor<BrowserHandle>(alias);
  }

  async close(): Promise<void> {
    /* nothing to release */
  }
}
