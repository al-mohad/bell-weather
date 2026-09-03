# Contributing

## Before anything else

This is a measuring instrument. The bar for a change is not "does it work" but
"does it keep the numbers honest". Two rules follow from that, and they are not
negotiable:

1. **Every verifier must be able to fail.** A task ships one known-good fixture and
   at least two known-bad ones, and `pnpm verify:verifiers` proves the verifier
   accepts the first and rejects the rest. A verifier that passes its own failing
   fixtures is a build failure.
2. **No number is published that the harness did not produce.** Placeholder figures,
   illustrative percentages and "roughly" do not appear in the README, the report or
   a commit message. If it has not been run, say so on the file.

## Setup

```bash
pnpm install
pnpm check      # format, lint, typecheck, test — the same gate CI runs
```

Node ≥ 22.11, pnpm 11. No API key is needed for anything in CI.

## Workflow

- Branch from `main`. Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`,
  `test:`, `chore:`); the scope is the package (`feat(runner): ...`).
- Add a changeset for anything user-visible: `pnpm changeset`.
- Sign off your commits (`git commit -s`) — the repo requires a DCO.
- Decisions that shape the design get an ADR in `docs/adr/`, numbered and dated.
  If a reviewer would reasonably ask "why is it like this?", write the ADR.

## What a good pull request contains

| change | also needs |
| --- | --- |
| A new task | ≥2 failing fixtures, a tier, a `requires`, and a note in `suite.lock.json` if it needs an environment |
| A new metric | a definition in the README table and a test in `packages/runner/test/metrics.test.ts` |
| A change to the trial loop | a case in `packages/runner/test/e2e.test.ts` |
| A change to the protocol | a version bump in `packages/protocol/src/version.ts` and a note on compatibility |
| A change to the simulator | a determinism test — two fresh instances must render identically |
| Anything that alters a published number | a re-run, updated `results/`, and a line in `docs/methodology.md` |

## Adding a task

See [docs/add-a-task.md](docs/add-a-task.md). The short version: real ground truth,
two failing fixtures, and a goal statement that a competent operator could follow
without seeing the verifier.

## Adding an agent

See [docs/add-an-agent.md](docs/add-an-agent.md). The harness never imports an agent,
so yours can live anywhere, in any language. Agents in this repo are references, not
the point.

## Reporting a benchmark bug

A task that is impossible, ambiguous, or that the `scripted` baseline cannot pass is a
bug in the benchmark, not a hard task. Open an issue with the trial directory attached —
`meta.json`, `trace.jsonl` and the frames are enough to reproduce it exactly.
