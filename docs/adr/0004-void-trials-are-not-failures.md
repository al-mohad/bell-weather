# 0004 — Void trials are excluded from every rate

- Status: Accepted
- Date: 2026-09-02

## Context

Trials fail for two unrelated reasons: the agent did the work badly, or the machinery
broke — the agent process died, the environment would not boot, the verifier could not
decide. Counting the second as an agent failure is the easiest way to publish a number
that is quietly wrong, and it biases *against* whoever is being measured, which makes it
feel safe. It is not safe; it is unfalsifiable.

## Decision

A trial has three statuses: `pass`, `fail`, `void`. `AgentError`, `EnvironmentError` and
`VerifierError` produce `void`. Void trials are excluded from `pass@1`, `pass^k`,
`recovery`, step distributions and cost-per-success, and are reported as their own count
in `results.json`, the terminal summary and the report.

`pass@1` is the first **valid** attempt, not the first attempt. `pass^k` is `null` — not
a fraction — when fewer than k valid trials exist.

## Consequences

Good:

- A flaky environment shows up as a void count that demands investigation, instead of
  silently depressing an agent's score.
- "Passed the 3 attempts that did not crash" can no longer be reported as "passed 5 of 5".

Bad, and accepted:

- A run can produce no `pass^k` at all if the environment is unreliable. That is the
  correct outcome: the right response is to fix the environment and re-run, not to
  publish a partial number.
- Classification depends on the harness raising the right error type. A bug that
  misclassifies an agent failure as void would inflate a score, so the error taxonomy is
  narrow and the trial loop re-raises anything it does not recognise.
