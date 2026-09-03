import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import type { RpcRequest, RpcResponse } from './rpc';
import { RpcRequestSchema, RpcResponseSchema } from './rpc';

/**
 * Newline-delimited JSON over stdio.
 *
 * Chosen over LSP-style Content-Length framing because it is trivially
 * implementable in every language an agent might be written in - a Python agent
 * needs `json.loads(sys.stdin.readline())` and nothing else. Cost: agents must
 * never write anything but protocol frames to stdout. Logs go to stderr, which
 * the harness captures into the trace.
 */
export class NdjsonChannel {
  private readonly lines: AsyncIterableIterator<string>;

  constructor(
    private readonly input: Readable,
    private readonly output: Writable,
  ) {
    this.lines = createInterface({ input, crlfDelay: Infinity })[Symbol.asyncIterator]();
  }

  send(frame: RpcRequest | RpcResponse): void {
    this.output.write(`${JSON.stringify(frame)}\n`);
  }

  async receive(): Promise<unknown | undefined> {
    const next = await this.lines.next();
    if (next.done) return undefined;
    const line = next.value.trim();
    if (line === '') return this.receive();
    return JSON.parse(line);
  }

  async receiveResponse(): Promise<RpcResponse> {
    const raw = await this.receive();
    if (raw === undefined) throw new Error('agent closed stdout before responding');
    return RpcResponseSchema.parse(raw);
  }

  async receiveRequest(): Promise<RpcRequest | undefined> {
    const raw = await this.receive();
    if (raw === undefined) return undefined;
    return RpcRequestSchema.parse(raw);
  }
}
