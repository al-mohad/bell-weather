# 0005 — Environments are pinned in a suite lockfile

- Status: Accepted
- Date: 2026-09-02

## Context

`pass^k` means "k attempts from an identical starting state". If the environment is
built at run time — `docker compose up`, an upstream image tag, a seeded database —
then attempts start from *similar* states, and the number degrades into noise the moment
an upstream image changes.

Worse, it degrades silently: a benchmark that quietly gets easier or harder between runs
still prints a number.

## Decision

`suites/core/suite.lock.json` pins one snapshot id per environment. Tasks read
`env.snapshotId` from it and never resolve an environment at run time. Boot commands run
only when no snapshot is pinned, which is the seeding path (`scripts/seed-env.ts`), not
the benchmark path.

Changing a snapshot id is a breaking change to the benchmark: it requires a suite version
bump and a re-run of every published number.

## Consequences

Good:

- Every trial genuinely starts from the same bytes, so trial independence is structural
  rather than a convention that concurrency could violate.
- Forking a memory snapshot is also far cheaper than booting an application per trial,
  which is what makes k=5 across a suite affordable.
- The lockfile is a visible, reviewable record of what a published number was measured
  against.

Bad, and accepted:

- Seeding is a separate, manual step, and a task is skipped until its environment has
  been seeded. `null` in the lockfile means "never seeded" and the runner reports the
  skip with a reason rather than inventing an environment.
- Snapshots age. An environment pinned a year ago is no longer representative of the
  application it was cut from, and there is no automatic signal for that.
