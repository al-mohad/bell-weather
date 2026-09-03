import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { AgentError } from '@bellwether/core';
import {
  METHODS,
  NdjsonChannel,
  PROTOCOL_VERSION,
  InitResultSchema,
  StepResultSchema,
  isCompatible,
} from '@bellwether/protocol';
import type {
  CloseParams,
  InitParams,
  InitResult,
  Observation,
  StepResult,
} from '@bellwether/protocol';

export interface AgentSpec {
  /** Registry key, e.g. "scripted". */
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  /** Wall clock allowed for a single agent.step call. */
  stepTimeoutMs?: number;
}

/**
 * Runs an agent as a child process and speaks NDJSON JSON-RPC to it.
 *
 * The harness deliberately never imports an agent. Dropping in a different agent -
 * in any language, behind any weights, inside any private repo - is writing one
 * registry entry and a stdio loop. That property is the whole reason a third party
 * can reproduce a Bellwether number against their own system.
 */
export class AgentClient {
  private child?: ChildProcessWithoutNullStreams;
  private channel?: NdjsonChannel;
  private nextId = 1;
  private stderr = '';
  private readonly stepTimeoutMs: number;

  constructor(private readonly spec: AgentSpec) {
    this.stepTimeoutMs = spec.stepTimeoutMs ?? 120_000;
  }

  get stderrLog(): string {
    return this.stderr;
  }

  async start(params: Omit<InitParams, 'protocol'>): Promise<InitResult> {
    const child = spawn(this.spec.command, this.spec.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...this.spec.env },
    });
    this.child = child;
    child.on('error', (error) => {
      this.stderr += `\n[spawn error] ${error.message}`;
    });
    // Agents log to stderr; stdout carries protocol frames only. Captured verbatim
    // into the trial artifacts so a failure can be debugged without a re-run.
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      this.stderr += chunk;
      if (this.stderr.length > 1_000_000) this.stderr = this.stderr.slice(-500_000);
    });

    this.channel = new NdjsonChannel(child.stdout, child.stdin);

    const result = InitResultSchema.parse(
      await this.request(METHODS.init, { ...params, protocol: PROTOCOL_VERSION }),
    );
    if (!isCompatible(result.protocol)) {
      throw new AgentError(
        `agent "${result.agent}" speaks protocol ${result.protocol}, harness speaks ${PROTOCOL_VERSION}`,
      );
    }
    return result;
  }

  async step(observation: Observation): Promise<StepResult> {
    return StepResultSchema.parse(
      await this.request(METHODS.step, { observation }, this.stepTimeoutMs),
    );
  }

  async close(params: CloseParams): Promise<void> {
    if (!this.channel) return;
    try {
      await this.request(METHODS.close, params, 10_000);
    } catch {
      /* An agent that dies on close has already given us its answers. */
    }
    this.child?.stdin.end();
    this.child?.kill('SIGTERM');
    // Escalate if the child ignores SIGTERM, so a hung agent cannot wedge a suite.
    const child = this.child;
    if (child) setTimeout(() => child.kill('SIGKILL'), 2_000).unref();
  }

  private async request(method: string, params: unknown, timeoutMs?: number): Promise<unknown> {
    const channel = this.channel;
    if (!channel) throw new AgentError('agent process is not running');
    const id = this.nextId++;
    channel.send({ jsonrpc: '2.0', id, method, params });

    const responsePromise = channel.receiveResponse();
    const response = timeoutMs
      ? await withTimeout(responsePromise, timeoutMs, `${method} exceeded ${timeoutMs}ms`)
      : await responsePromise;

    if (response.id !== id) {
      throw new AgentError(`agent replied to id ${String(response.id)}, expected ${id}`);
    }
    if (response.error) {
      throw new AgentError(`agent error on ${method}: ${response.error.message}`);
    }
    return response.result;
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new AgentError(message)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
