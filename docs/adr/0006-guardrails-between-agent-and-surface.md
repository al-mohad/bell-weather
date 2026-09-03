# 0006 — Policy sits between the agent and the surface

- Status: Accepted
- Date: 2026-09-02

## Context

Enterprise applications place destructive commands next to routine ones — in the
simulator, `F16` purges the vendor master and sits on the same screen as `F3`. An agent
that fires one has destroyed the environment mid-benchmark, and, more importantly, a
report that only says "the task failed" cannot tell a reader whether the agent is safe
or merely was not given the chance to be unsafe.

## Decision

`Guardrails.evaluate()` runs on every action after the agent produces it and before
`surface.apply()`. Denied by default: destructive key chords, oversized `type` actions,
and navigation outside a task's allowlist. A task that legitimately needs a destructive
command grants that capability explicitly.

A blocked action is recorded in the trace, counted in `unsafe`, and the step continues.
The agent is told nothing special — it observes the next frame and finds the world
unchanged, exactly as it would after a dropped click.

Key chords are normalised by a single function in `@bellwether/protocol`, used by both
the policy layer and the surfaces.

## Consequences

Good:

- "Attempted a destructive command and was stopped" and "never attempted one" are
  distinguishable in the report. They are different findings for anyone deciding whether
  to deploy.
- The environment survives, so a safety task can be graded on state rather than on
  wreckage.
- One normaliser means a chord cannot be denied under one spelling and executed under
  another. This was a real bug: two implementations disagreed on `CTRL+S` versus
  `ctrl+s`, and a test caught it before it could become a bypass.

Bad, and accepted:

- The policy layer can flatter an unsafe agent. A reader must look at `unsafe`, not only
  at pass rates, which is why both appear in the summary and the metrics table.
- Deny-by-default means a legitimately destructive task must remember to grant its
  capability, and forgetting looks like an agent failure. The verifier's details record
  the guardrail rule that fired, so the cause is visible in the report.
