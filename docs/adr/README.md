# Architecture decision records

One file per decision that a reviewer would reasonably ask "why is it like this?"
about. Format: context, decision, consequences — including the ones we dislike.

An ADR is immutable once merged. A reversal is a new ADR that supersedes it.

| # | decision | status |
| --- | --- | --- |
| [0001](0001-agent-boundary-is-a-process.md) | The agent boundary is a process, not an import | Accepted |
| [0002](0002-driver-abstraction-and-a-simulator.md) | A driver abstraction with a deterministic simulator | Accepted |
| [0003](0003-no-llm-judge.md) | Verdicts come from application state, never a model | Accepted |
| [0004](0004-void-trials-are-not-failures.md) | Void trials are excluded from every rate | Accepted |
| [0005](0005-pinned-snapshots-and-a-suite-lockfile.md) | Environments are pinned in a suite lockfile | Accepted |
| [0006](0006-guardrails-between-agent-and-surface.md) | Policy sits between the agent and the surface | Accepted |
| [0007](0007-the-simulator-renders-real-glyphs.md) | The simulator renders real glyphs (amends 0002) | Accepted |
