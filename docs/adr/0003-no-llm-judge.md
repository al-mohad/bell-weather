# 0003 — Verdicts come from application state, never a model

- Status: Accepted
- Date: 2026-09-02

## Context

Grading GUI work is awkward. The cheap option is to show a model the final screenshot
and the goal and ask whether the task was done. It scales to any application with no
per-task work, which is why so many agent benchmarks do it.

It also fails in the two places that matter here. A judge cannot see a duplicate record
created three screens away; and both the agent and the judge are language models with
correlated blind spots, so a plausible-looking wrong answer is graded as right by the
same reasoning that produced it.

## Decision

Every verdict is a deterministic query against the application's own state:
`ctx.groundTruth()` for the simulator, `ctx.sql()` inside the machine for real
environments. No verifier receives a screenshot. There is no model anywhere in the
grading path.

Every verifier must be **falsifiable**: each task ships one known-good state and at
least two known-bad ones, and CI fails if a verifier accepts a bad one.

## Consequences

Good:

- Verdicts are reproducible and auditable. Two people running the suite get the same
  answer, and a disputed result is settled by reading a query.
- Side effects become measurable. "Completed the task and also raised a second purchase
  order" is expressible; to a screenshot judge it is invisible.
- Grading cannot be gamed by leaving the screen looking right.

Bad, and accepted:

- Every task needs a hand-written verifier. This is the main cost of adding a task, and
  it is why the suite is seven tasks rather than seventy.
- Tasks whose success is genuinely subjective ("write a polite reply") cannot be graded
  this way, so they are out of scope. That is a real limitation of what this benchmark
  can measure, not a temporary one.
- `sql()` runs `psql` inside the machine and parses JSON, which keeps a database driver
  out of the dependency tree but ties real environments to Postgres-shaped access.
