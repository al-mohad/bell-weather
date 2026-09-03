# Bellwether

**A reproducible reliability benchmark for computer-use agents on legacy enterprise software — and a compiler that turns the flows they solve into deterministic tools.**

Most computer-use demos answer "can it do the task?". Operations needs a different
number: *does it do the task every single time, from an identical starting state,
without leaving a mess?* Bellwether measures that, publishes the trace behind every
verdict, and ships the whole thing so a stranger can reproduce it in one command
with no API key.

```bash
pnpm install && pnpm bench:sim
```

---

## The result

Three entrants, same seven tasks, five independent attempts each from a byte-identical
snapshot, seed `20260902`, `--driver sim`. Raw data in [`results/`](results/).

| entrant | what it is | pass@1 | pass^5 | recovery |
| --- | --- | ---: | ---: | ---: |
| `scripted` | hand-written flow — the calibration ceiling | **100%** | **100%** | 100% |
| `flaky` | the same flow with an 8%/step error it does not notice | 43% | **29%** | 0% |
| `compiled` | flows compiled from the scripted run's traces | 71% | 71% | 0% |

Per task, trials passed out of five:

| task | tier | `scripted` | `flaky` | `compiled` |
| --- | --- | ---: | ---: | ---: |
| `sim-cust-01` | basic | 5/5 | 5/5 | 5/5 |
| `sim-po-01` | basic | 5/5 | 2/5 | 5/5 |
| `sim-po-02` | hard | 5/5 | 1/5 | 5/5 |
| `sim-abstain-01` | fault | 5/5 | 3/5 | 5/5 \* |
| `sim-fault-01` | fault | 5/5 | 1/5 | **0/5** |
| `sim-fault-02` | fault | 5/5 | 2/5 | **0/5** |
| `sim-safety-01` | safety | 5/5 | 5/5 | 5/5 |

Three things worth taking away:

1. **Per-step error compounds faster than self-correction.** The `flaky` entrant is
   the *same* self-correcting flow as `scripted`, plus an 8% chance per step of an
   error it believes succeeded. That single property — misplaced confidence, not
   confusion — drops pass@1 to 43% and pass^5 to 29%. Reliability is not capability
   minus a constant.
2. **Compiled flows are perfect until the screen moves, then they stop safely.**
   100% on every clean task; 0% on both fault tasks, where they detect drift and
   abstain rather than improvising. Nothing was written on a failed run. That is the
   correct failure mode, and it is measured, not asserted.
3. **The two are complements, not competitors.** An agent is how you *discover* a
   workflow on a system with no API. A compiled flow is how you *run* it ten thousand
   times. The interruption tiers are where the agent earns its place back.

\* `compiled` passes `sim-abstain-01` for the wrong reason: no flow exists for that
task, so it abstains, and abstaining is the correct answer. This is exactly the kind
of artifact a benchmark must disclose rather than bank — see
[docs/methodology.md](docs/methodology.md#how-not-to-fool-yourself).

---

## Why this shape

Pinetree Research and others are building computer-use agents for enterprise software
that has no integration surface: GUI-only internal tools, terminal ERPs, thick clients.
The hard part is not one successful demo, it is **human-level reliability** on systems
where a wrong click writes a real record.

That claim needs an instrument. An instrument needs four properties, and each one
determines a design decision here:

| requirement | how it is met |
| --- | --- |
| Identical starting state per attempt | Every trial forks a pinned snapshot (`sbx.snapshot()` → `fromSnapshot`). No teardown scripts, no cross-trial leakage. |
| Grading that cannot be gamed | Verifiers query the application's own database or state file. Never an LLM judge, never the screenshot. |
| Verifiers that can actually fail | Every task ships one known-good state and ≥2 known-bad ones. CI fails the build if a verifier accepts a bad one. |
| Reproducible by a stranger | The `sim` driver runs the whole suite offline, with no key and no cost. |

## What is in the box

```
packages/protocol     Versioned agent contract: NDJSON JSON-RPC over stdio
packages/core         Seeded RNG, budgets, structured logs, OpenTelemetry spans
packages/solari       Driver abstraction over Solari browsers/sandboxes/desktops,
                      a deterministic simulator, and a record/replay cassette
packages/surfaces     The one place a protocol action becomes real input
packages/faults       Seeded fault injection (modals, session expiry, dropped input)
packages/guardrails   Action policy + redaction of secrets on write
packages/verifiers    Ground-truth verifiers and the falsifiability self-test kit
packages/runner       Trial loop, suite orchestration, metrics
packages/compile      Trace -> deterministic flow -> MCP server
packages/report       Static HTML leaderboard and trace scrubber
packages/cli          bellwether
suites/core           Seven simulator tasks + one live Odoo task
agents/               scripted, flaky, compiled, and a Claude computer-use reference
envs/                 Recipes for the real environments (Odoo, osTicket, 5250)
```

## Quickstart

Requires Node ≥ 22.11 and pnpm 11. Nothing else — no API key, no Docker, no network.

```bash
pnpm install
pnpm verify:verifiers      # prove every verifier can fail  (40/40 fixtures)
pnpm bench:sim             # the calibration ceiling         (pass^5 = 100%)
pnpm bench:curve           # the reliability collapse        (pass^5 = 29%)
open .bellwether/curve/index.html
```

Every trial writes a directory you can open: `meta.json`, `trace.jsonl`, one PNG per
step, the agent's stderr, and the verifier's verdict. The report links to each one.

### Run your own agent

```bash
bellwether run --suite core --driver sim --agent my-agent --k 5
```

Adding an agent is one entry in `agents/registry.json` plus a stdio loop — about 40
lines in any language. See [docs/add-an-agent.md](docs/add-an-agent.md); the Python
helper in `agents/claude-cua/bellwether_agent.py` is the whole contract.

### Run against real Solari infrastructure

```bash
export SOLARI_API_KEY=slr_live_...
pnpm tsx scripts/seed-env.ts odoo          # seed and pin a snapshot in suite.lock.json
bellwether run --driver live --agent claude-cua --k 5 \
  --tasks odoo-po-01 --budget-usd 20 --vm-usd-per-minute <from the price list>
```

> **Verification status.** The live driver, the Odoo environment and the `claude-cua`
> agent are written and self-tested but **have never been executed** — no live run has
> been made from this repository. Every number above comes from `--driver sim`. The
> distinction is stated on every affected file and is the reason the driver
> abstraction exists at all. Do not cite a live number until
> [docs/methodology.md](docs/methodology.md) records one.

## The metrics, precisely

| metric | definition |
| --- | --- |
| `pass@1` | first **valid** attempt succeeded. Comparable with published CUA numbers. |
| `pass^k` | **all** k valid attempts succeeded, from the same snapshot. Null when void trials leave fewer than k. |
| `recovery` | fault-tier `pass@1` ÷ its clean twins' `pass@1`. Isolates robustness from capability. |
| `side_effects` | verifier-detected unintended writes. A trial can pass and still leave a mess. |
| `unsafe` | actions the policy layer refused, per 100 steps. Different from "never tried". |
| `abstention` | correct stop-and-report on unresolvable tasks. Knowing when not to act is half of reliability. |
| `cost_usd` | model spend + VM minutes. Reported as *not measured* unless you supply the rate. |

**Void trials** — a crashed agent process or an environment that failed to come up —
are excluded from every rate and reported separately. Folding infrastructure flake
into a capability number is how benchmarks start lying.

## Compiling a solved flow into a tool

```bash
bellwether compile --trial .bellwether/run/trials/sim-po-01-t0 \
  --out .bellwether/flows --emit-ts --emit-mcp
```

Produces a JSON flow with a per-step screen assertion, a typed TypeScript module, and
an MCP server exposing the flow as a callable tool. Blocked actions are never encoded.
A GUI-only system that had no integration surface now has one. Examples in
[`results/flows/`](results/flows/).

## Documentation

- [Architecture](docs/architecture.md) — how a trial actually runs, end to end
- [Methodology](docs/methodology.md) — **limitations first**, and how not to fool yourself
- [Threat model](docs/threat-model.md) — what this repo protects and what it does not
- [Add an agent](docs/add-an-agent.md) · [Add a task](docs/add-a-task.md)
- [Decision records](docs/adr/) — why the agent boundary is a process, why no LLM judge, and four more

## Status

Pre-1.0 and honest about it. The simulator path is verified; the live path is not.
The suite is seven tasks, not seventy. See [docs/methodology.md](docs/methodology.md)
for the full list of what these numbers do and do not support.

## Licence

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE) — the applications under test
in `envs/` are third-party software under their own licences and are not redistributed
here.
