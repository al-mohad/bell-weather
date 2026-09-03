/**
 * Protocol version. Bumped independently of the package version.
 *
 * MAJOR - a field an agent must understand changed or was removed.
 * MINOR - additive, optional fields only. Old agents keep working.
 *
 * The harness refuses to run against an agent reporting an incompatible MAJOR.
 */
export const PROTOCOL_VERSION = '1.0' as const;

export function isCompatible(agentProtocol: string): boolean {
  const [major] = agentProtocol.split('.');
  const [ourMajor] = PROTOCOL_VERSION.split('.');
  return major === ourMajor;
}
