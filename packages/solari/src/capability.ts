/**
 * Faults split in two by where they can honestly be produced.
 *
 * `drop-input` and `latency` are properties of the *transport* between agent and
 * surface, so the surface adapter can inject them against any driver, live or
 * simulated. `modal` and `session-expiry` are properties of the *application*, so
 * only the environment can produce them: the simulator does it directly, and a
 * real environment ships a `bw-fault` hook script (see envs/README.md).
 *
 * Nothing pretends to inject an application fault it cannot actually cause.
 */
export type EnvFaultKind = 'modal' | 'session-expiry';

export interface EnvFaultCapable {
  /** Returns false when the environment cannot produce this fault. */
  injectEnvFault(kind: EnvFaultKind): Promise<boolean>;
}

export function isEnvFaultCapable(value: unknown): value is EnvFaultCapable {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { injectEnvFault?: unknown }).injectEnvFault === 'function'
  );
}
