# Methodology

## Limitations first

Every number this repository has produced comes from `--driver sim`. Read this list
before the results, not after.

1. **No vision agent has been run.** Both surfaces now produce frames a vision agent
   can read - the simulator renders real glyphs, and the live desktop returns real
   screenshots of a real X session. None has been run. Every number in `results/` was
   produced by an entrant reading a text channel, and reading a character grid is not
   the same skill as reading a screen.

2. **The live tier is one task on one application.** `leg-01` has been executed against
   real Solari infrastructure and its result is recorded below. That establishes the
   platform path end to end - snapshot fork, desktop VM, X input, ground truth read from
   the guest filesystem - and nothing more. The browser surface and the Odoo environment
   remain unexecuted, and their code says so.

   The live desktop's text channel is published by the application itself, to
   `/var/lib/simapp/screen.txt`, the way the environments in `envs/` publish a
   `bw-fault` hook. It is a property of that environment, not of the platform, and an
   agent that reads it declares `text-screen`.

3. **Eight tasks is a smoke test, not a benchmark.** They cover lookup-then-edit,
   cross-screen transcription, two interruption modes, abstention and one safety case.
   They do not cover multi-application workflows, long-horizon tasks, search and
   pagination, file handling, or anything time- or locale-dependent.
4. **One application.** Every simulator task drives the same fictional 5250 ERP.
   Results do not generalise across applications, and were never claimed to.
5. **`flaky` is a model of an agent, not an agent.** It is the calibrated flow plus a
   seeded per-step error it does not notice. It isolates the arithmetic of compounding
   error; it is not evidence about any real system's error rate.
6. **`compiled` is scored on flows that exist.** A task with no compiled flow abstains.
   On `sim-abstain-01` that abstention is the correct answer, so the entrant scores 5/5
   for a reason unrelated to compilation. Disclosed rather than banked.
7. **Session expiry fires before any commit is possible.** So `sim-fault-02` does not
   test the harder case: re-entering after a timeout when the record may already exist.
   That needs an in-application way to look up existing orders, which the simulator
   lacks and real Odoo has. It is the next task to write.
8. **Cost is unmeasured.** `--vm-usd-per-minute` defaults to 0 and the report says "not
   measured" rather than "$0.00". Publishing an invented rate would be worse than
   publishing none.

## What a result means

A Bellwether result is a tuple: **(suite version, driver, agent, k, run seed,
`suite.lock.json`)**. Change any one and it is a different result. `results.json`
records all six, and the report prints them next to the headline.

### pass@1

The first *valid* attempt succeeded. "Valid" excludes void trials — an agent process
that died, an environment that would not boot, a verifier that could not decide. This
is the number most published CUA work reports, included here only for comparability.

### pass^k

All k valid attempts succeeded, each forked from the same pinned snapshot. This is the
number the project exists to produce.

Two rules keep it honest:

- **If fewer than k valid trials exist, pass^k is `null`, not a fraction.** "Passed the
  3 attempts that did not crash" is a different claim from "passed 5 of 5", and
  reporting them as the same number is the single easiest way to inflate a benchmark.
- **Trials are independent by construction, not by convention.** Each forks the
  snapshot, so concurrency and ordering cannot leak state between attempts.

### recovery

Fault-tier `pass@1` divided by its clean twins' `pass@1`. A task declares its twin
with `cleanTwin`, so the comparison is between the *same* task with and without
interruptions. This separates "cannot do the work" from "cannot survive a modal".

### side_effects

Unintended writes the verifier found: duplicate records, edits to the wrong row,
orphaned drafts. Counted even on passing trials. An agent that completes the task and
also raises a second purchase order has not done the task.

### unsafe

Actions the policy layer refused, per 100 steps. This is deliberately separate from
pass/fail: "safe" and "was prevented from being unsafe" are different findings, and a
report that conflates them cannot inform a deployment decision.

## Determinism contract

Given the same `(runSeed, taskId, trialIndex)`, the harness issues the same faults in
the same order. The seed derivation is FNV-1a over those three values, so it is stable
across processes and languages. Everything else that varies — a model's sampling, real
network timing — is the agent's or the platform's nondeterminism, which is precisely
what pass^k measures.

`packages/solari/test/sim.test.ts` asserts that two fresh simulator instances render
identically and that a snapshot fork is isolated from its parent.

## How not to fool yourself

The failure mode with the highest cost to a benchmark's reputation is a suite that
flatters whoever built it. The countermeasures here, and what each one caught:

**A calibration ceiling.** The `scripted` entrant is a hand-written flow that should
score 100%. If it cannot pass a task, the task is broken, not hard. It has already
earned its place: the first run of this suite scored 43% for `scripted`, and the cause
was a benchmark bug — the agent's screen detector matched the words "SIGN ON" in the
main menu's *status line*, so it typed a password at the menu forever. A capability
benchmark without a ceiling would have published that as an agent result.

**Verifiers proved falsifiable.** 40 fixtures across 8 tasks, each asserting a verifier
accepts a known-good state and rejects known-bad ones — wrong quantity, wrong vendor,
duplicate order, right customer plus a stray edit. Run by `pnpm verify:verifiers` and by
CI on every commit. A verifier that cannot fail is worse than no verifier.

**No LLM judge.** Every verdict is a query against the application's own state. See
[ADR-0003](adr/0003-no-llm-judge.md).

**Void ≠ fail.** Infrastructure failures are counted and reported, never silently
folded into the agent's score.

**Raw data beside every summary.** `results.json` sits next to `index.html`, and every
verdict links to the trace that produced it. A reader who distrusts the headline can
recompute it.

**Fixed seeds, pinned snapshots.** `results/` holds committed runs at seed `20260902`.
Re-running that seed must reproduce them — and when the frame renderer was replaced, it
did, to the digit. A change that should not move the numbers and does is a signal worth
more than a change that does move them.

## Changing the benchmark

Changing a snapshot id in `suite.lock.json`, a verifier, or a task's goal text
invalidates every number measured against it. Such a change requires a suite version
bump and a re-run of every published figure. There is no "small fix" to a benchmark
that has been cited.

## Record of runs

| date | driver | agents | k | seed | note |
| --- | --- | --- | --- | --- | --- |
| 2026-09-02 | sim | scripted, flaky, compiled | 5 | 20260902 | First baseline, ink-map frames. Superseded. |
| 2026-09-05 | **live** | scripted-keyboard | 3 | default | **First live run.** `leg-01` on a Solari desktop VM: pass@1 100%, pass^3 100%, 0 void, 16 steps and ~31s per trial. Snapshot `snap_dl7hv3j3a0i1`, pinned in `suite.lock.json`. Establishes the platform path; not a capability result. |
| 2026-09-03 | sim | scripted, flaky, compiled | 5 | 20260902 | Current simulator baseline in `results/`. Re-run after the surface began rendering real glyphs; **every metric was identical to the 2026-09-02 run**, which is the expected result when only the pixels change and every entrant reads `screenText`. Simulator only; no vision agent. |

*This table is the only place a live figure may be introduced, and it must cite the
`results/` file that backs it. The live row above is backed by
`results/2026-09-05-live-leg-01-scripted-keyboard.json`.*
