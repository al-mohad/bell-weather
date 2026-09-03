import { z } from 'zod';
import { ActionSchema } from './actions';
import { ObservationSchema } from './observation';

export const SurfaceKind = z.enum(['browser', 'desktop']);
export type SurfaceKind = z.infer<typeof SurfaceKind>;

export const InitParamsSchema = z.object({
  protocol: z.string(),
  taskId: z.string(),
  /** The natural-language instruction. The only task description the agent gets. */
  goal: z.string(),
  surface: SurfaceKind,
  /** Static context a human operator would also have: a policy doc, an SOP. */
  context: z.string().optional(),
  budget: z.object({ steps: z.number().int().positive(), usd: z.number().min(0) }),
  /** Screen geometry, so the agent can scale coordinates before the first frame. */
  display: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }),
  /** Deterministic seed. Agents that sample should derive their RNG from it. */
  seed: z.number().int(),
});
export type InitParams = z.infer<typeof InitParamsSchema>;

export const InitResultSchema = z.object({
  agent: z.string().min(1),
  version: z.string().min(1),
  protocol: z.string().min(1),
  /** Optional self-declared capabilities, for reporting only. */
  capabilities: z.array(z.string()).optional(),
});
export type InitResult = z.infer<typeof InitResultSchema>;

export const StepParamsSchema = z.object({ observation: ObservationSchema });
export type StepParams = z.infer<typeof StepParamsSchema>;

export const StepResultSchema = z.object({
  action: ActionSchema,
  /** Cost the agent incurred producing this action. Rolled into cost_usd. */
  usage: z
    .object({
      inputTokens: z.number().int().min(0).optional(),
      outputTokens: z.number().int().min(0).optional(),
      usd: z.number().min(0).optional(),
    })
    .optional(),
});
export type StepResult = z.infer<typeof StepResultSchema>;

export const CloseParamsSchema = z.object({
  reason: z.enum(['done', 'abstain', 'budget', 'error', 'timeout']),
  /** Filled in after verification, so an agent can log its own hit rate. */
  verdict: z.enum(['pass', 'fail', 'unknown']),
});
export type CloseParams = z.infer<typeof CloseParamsSchema>;

export const METHODS = {
  init: 'agent.init',
  step: 'agent.step',
  close: 'agent.close',
} as const;

/* ------------------------------ JSON-RPC 2.0 ------------------------------ */

export const RpcRequestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.number().int(), z.string()]),
  method: z.string(),
  params: z.unknown().optional(),
});
export type RpcRequest = z.infer<typeof RpcRequestSchema>;

export const RpcErrorSchema = z.object({
  code: z.number().int(),
  message: z.string(),
  data: z.unknown().optional(),
});

export const RpcResponseSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.number().int(), z.string(), z.null()]),
  result: z.unknown().optional(),
  error: RpcErrorSchema.optional(),
});
export type RpcResponse = z.infer<typeof RpcResponseSchema>;

/** JSON-RPC reserved range, plus the codes this protocol adds. */
export const RPC_ERRORS = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
  /** Agent declared an incompatible protocol MAJOR. */
  incompatibleProtocol: -32000,
  /** Agent exceeded its per-step wall clock. */
  stepTimeout: -32001,
} as const;
