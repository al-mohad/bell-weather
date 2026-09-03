# Architecture

## One trial, end to end

```
  bellwether run
        │
        ├─ loadSuite ────────── suites/core          (tasks + verifiers + fixtures)
        ├─ resolveAgent ─────── agents/registry.json (a command line, not an import)
        └─ runSuite
              │  for each task × k, bounded concurrency
              └─ runTrial
                    │
                    ├─ 1. provision    driver.createDesktop({ fromSnapshot })
                    │                  or createSandbox + createBrowser + previewUrl
                    ├─ 2. agent.init   spawn child process, NDJSON JSON-RPC over stdio
                    │
                    ├─ 3. step loop ───────────────────────────────────────────┐
                    │      faults.beforeStep(i)   seeded from (seed, task, i)  │
                    │      surface.observe()      PNG + optional text          │
                    │      agent.step(obs)        one action                   │
                    │      guardrails.evaluate()  allow / block + record       │
                    │      surface.apply(action)  the only place input is real │
                    │      trace.step(...)        redacted on write            │
                    │      until done | abstain | maxSteps | budget ───────────┘
                    │
                    ├─ 4. verify       task.verify(ctx) — reads the app's own state
                    ├─ 5. agent.close  then SIGTERM, SIGKILL after 2s
                    └─ 6. cleanup      kill every machine in a finally block
```

## The four boundaries that matter

### 1. The agent boundary is a process, not an import

`packages/runner/src/agent-client.ts` spawns a child and speaks newline-delimited
JSON-RPC 2.0 to it. The harness has no dependency on any agent, in any direction.

Consequences, all of them intended: an agent can be written in any language, live in a
private repository, run behind any weights, and be dropped in by adding one registry
entry. A third party can reproduce a Bellwether number against their own system without
sharing it. Agents log to stderr, which is captured verbatim into the trial artifacts;
stdout carries protocol frames only. See [ADR-0001](adr/0001-agent-boundary-is-a-process.md).

### 2. The driver boundary separates "what we ask the platform for" from "what runs"

`SolariDriver` has four implementations: `SimDriver` (in-process, free, deterministic),
`LiveDriver` (real Solari microVMs), `RecordingDriver` (wraps any driver, writes a
cassette) and `ReplayDriver` (replays one with no network).

This is what makes the project reproducible by a stranger *and* honest about what has
been run. A live session recorded once becomes a CI regression test forever: if a change
alters the sequence of platform calls the harness makes, replay diverges and the build
fails. See [ADR-0002](adr/0002-driver-abstraction-and-a-simulator.md).

### 3. The verification boundary never touches the screen

A verifier receives a `VerifyContext` with `groundTruth()`, `file()` and `sql()`, all
of which read the machine, not the surface. There is no path from a screenshot to a
verdict. An agent cannot pass by leaving the screen looking right.
See [ADR-0003](adr/0003-no-llm-judge.md).

### 4. The policy boundary sits between the agent and the surface

`Guardrails.evaluate()` runs on every action before `surface.apply()`. A blocked action
is recorded in the trace and counted in `unsafe`, and the step continues. That placement
is what lets `sim-safety-01` distinguish an agent that never tried a destructive command
from one that was stopped.

## Determinism

Faults derive from `trialSeed(runSeed, taskId, trialIndex)` — FNV-1a, stable across
processes and languages. Trials are independent because each forks the pinned snapshot,
not because they run in order. Concurrency therefore changes wall-clock time and nothing
else.

## Artifacts

```
.bellwether/run/
├── results.json                    the whole run: config, metrics, every trial
├── index.html                      leaderboard, links to each trace
├── trials-html/<slug>.html         step scrubber: screen text, frames, actions, faults
└── trials/<slug>/
    ├── meta.json                   run/trial ids, seed, agent, driver, evidence URL
    ├── trace.jsonl                 one record per step, redacted on write
    ├── frames/step-000.png …       one frame per step
    ├── agent-stderr.log            the agent's own logging, verbatim
    └── verdict.json                the verifier's verdict and redaction counts
```

Redaction runs on write rather than on publish (`packages/guardrails/src/redact.ts`),
so a leaked key never reaches disk in the first place.

## Observability

Spans come from `@opentelemetry/api` only — never an SDK. With no SDK registered they
cost nothing; an operator who wants traces registers their own exporter. `bellwether.trial`
spans carry task, trial, seed, agent, status, steps and cost. Logs are structured JSON on
**stderr**, because stdout is reserved for protocol frames and machine-readable output.

## Cost control

`Budget` is checked before every step and every trial and throws `BudgetExceededError`,
which aborts the whole run rather than the trial. A run that aborts is marked
`aborted` in `results.json` and the report refuses to present it as a complete suite
result. This exists because an agent stuck in a click loop against a metered microVM is
a four-figure invoice, and CI must not be able to produce one.
