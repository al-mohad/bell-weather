import { NdjsonChannel } from './transport';
import { METHODS, RPC_ERRORS } from './rpc';
import type { CloseParams, InitParams, InitResult, StepParams, StepResult } from './rpc';
import { CloseParamsSchema, InitParamsSchema, StepParamsSchema } from './rpc';

export interface AgentHandlers {
  init(params: InitParams): Promise<InitResult> | InitResult;
  step(params: StepParams): Promise<StepResult> | StepResult;
  close?(params: CloseParams): Promise<void> | void;
}

/**
 * Runs an agent's stdio loop. TypeScript agents call this; agents in other
 * languages reimplement it (see agents/claude-cua/bellwether_agent.py, ~40 lines).
 */
export async function serveAgent(
  handlers: AgentHandlers,
  io: { input?: NodeJS.ReadStream; output?: NodeJS.WriteStream } = {},
): Promise<void> {
  const channel = new NdjsonChannel(io.input ?? process.stdin, io.output ?? process.stdout);

  for (;;) {
    const request = await channel.receiveRequest();
    if (!request) return;

    try {
      let result: unknown;
      switch (request.method) {
        case METHODS.init:
          result = await handlers.init(InitParamsSchema.parse(request.params));
          break;
        case METHODS.step:
          result = await handlers.step(StepParamsSchema.parse(request.params));
          break;
        case METHODS.close:
          await handlers.close?.(CloseParamsSchema.parse(request.params));
          result = {};
          break;
        default:
          channel.send({
            jsonrpc: '2.0',
            id: request.id,
            error: { code: RPC_ERRORS.methodNotFound, message: `unknown method ${request.method}` },
          });
          continue;
      }
      channel.send({ jsonrpc: '2.0', id: request.id, result });
      if (request.method === METHODS.close) return;
    } catch (error) {
      channel.send({
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: RPC_ERRORS.internalError,
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }
}
