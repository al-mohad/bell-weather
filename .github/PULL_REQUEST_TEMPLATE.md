## What and why

<!-- One paragraph. What changes, and what problem it solves. -->

## Effect on published numbers

<!-- Delete the lines that do not apply. -->

- [ ] No effect: this cannot change any benchmark result.
- [ ] Changes results. I have re-run the affected configurations, updated `results/`,
      and added a line to the run record in `docs/methodology.md`.
- [ ] Changes a verifier, a task goal, or a pinned snapshot. This is a breaking change
      to the benchmark: suite version bumped, every published figure re-run.

## Checklist

- [ ] `pnpm check` passes (format, lint, typecheck, test).
- [ ] `pnpm verify:verifiers` passes — every verifier still accepts its known-good
      state and rejects every known-bad one.
- [ ] `pnpm bench:sim` still scores pass^5 = 100% for the `scripted` ceiling.
- [ ] New tasks ship at least two failing fixtures.
- [ ] A changeset is included for anything user-visible (`pnpm changeset`).
- [ ] An ADR is added if a reviewer would ask "why is it like this?".
- [ ] Commits are signed off (`git commit -s`).

## Anything unverified

<!-- If any code here has not been executed — a live path, a new environment — say so
     here and put a verification-status note on the file itself. -->
