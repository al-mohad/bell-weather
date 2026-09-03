# Security policy

## Reporting a vulnerability

Report security issues through GitHub's private vulnerability reporting on this
repository, or by email to the address in `.github/CODEOWNERS`. Please do not
open a public issue for anything exploitable.

Include the affected version or commit, what an attacker gains, and a minimal
reproduction. We aim to acknowledge within three working days.

## What is in scope

This repository runs untrusted-ish workloads by design, so the boundary matters
more than usual. In scope:

- **Secret leakage through artifacts.** A trace, report, cassette or log that
  contains an API key, credential or personal data is a vulnerability, not a
  cosmetic bug. Redaction runs on write (`packages/guardrails/src/redact.ts`);
  a bypass is in scope.
- **Guardrail bypass.** A crafted action that reaches the surface despite a
  policy that should have denied it — including through key-chord spelling,
  URL parsing or action-schema coercion.
- **Cassette or flow deserialisation.** A malicious cassette or compiled flow
  that achieves code execution or arbitrary file write when replayed.
- **Budget bypass.** Anything that lets a run spend past `--budget-usd`, since
  the ceiling is what makes CI safe to point at a metered API.
- **Dependency supply chain.** Install-time script execution is denied by
  default in `pnpm-workspace.yaml`; a way around that is in scope.

## What is not in scope

- The agent under test misbehaving inside its own microVM. That is the
  measurement, not a vulnerability — isolation is Solari's microVM boundary.
- Prompt injection succeeding *against an agent*. That is a benchmark result;
  see `suites/core/tasks/sim-safety-01.ts` and `docs/threat-model.md`. Prompt
  injection that escapes the harness is in scope.
- Anything requiring a `SOLARI_API_KEY` or `ANTHROPIC_API_KEY` you already own
  to be used as designed.

## Handling of credentials

The harness reads `SOLARI_API_KEY` and `ANTHROPIC_API_KEY` from the environment,
passes them to a driver or agent process, and never writes them to disk. CI uses
short-lived OIDC-scoped secrets and never exposes them to pull requests from
forks. See `docs/threat-model.md`.
