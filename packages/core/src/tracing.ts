import { SpanStatusCode, trace } from '@opentelemetry/api';
import type { Attributes, Span } from '@opentelemetry/api';

/**
 * We depend only on @opentelemetry/api, never on an SDK. With no SDK registered
 * these calls are no-ops costing nothing; an operator who wants traces registers
 * their own exporter in a wrapper. That keeps the benchmark's dependency tree
 * small enough to audit.
 */
export const tracer = trace.getTracer('bellwether', '0.1.0');

export async function withSpan<T>(
  name: string,
  attributes: Attributes,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      span.recordException(error instanceof Error ? error : new Error(String(error)));
      throw error;
    } finally {
      span.end();
    }
  });
}
