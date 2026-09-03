# 0002 — A driver abstraction with a deterministic simulator

- Status: Accepted
- Date: 2026-09-02

## Context

Running the suite requires a paid Solari key and spends real money per trial. Three
things break if that is the only path: CI cannot run the benchmark, a reader cannot
reproduce a published number, and the harness cannot be tested without mocking the
world.

The temptation is to mock the SDK in tests and call it done. Mocks assert that the code
calls what you expected, which is not the same as asserting the harness works.

## Decision

Define `SolariDriver` — `createSandbox`, `createDesktop`, `createBrowser` — with four
implementations:

- `SimDriver`: an in-process 24×80 terminal ERP. Free, offline, byte-deterministic.
- `LiveDriver`: real Solari microVMs.
- `RecordingDriver`: wraps any driver and writes a JSONL cassette of every call.
- `ReplayDriver`: replays a cassette with no network and no key.

The simulator is a real application with a real state machine, real commit semantics
and real ground truth — not a mock. Verifiers query it exactly as they query Postgres.

## Consequences

Good:

- The full suite runs at k=5 on every pull request, free, in about a second.
- A live session recorded once becomes a permanent regression test: if a change alters
  which platform calls the harness makes, replay diverges and the build fails.
- The determinism the benchmark claims is *asserted*, not assumed — two fresh simulator
  instances must render identically, and a snapshot fork must be isolated from its parent.

Bad, and accepted:

- **The simulator is not a vision problem.** It exposes a character grid, so simulator
  results say nothing about visual grounding. This is stated first in
  `docs/methodology.md`, on the ink-map encoder, and on the driver itself.
- Two code paths can drift. Mitigated by the shared driver interface, by cassettes, and
  by the live adapter carrying an explicit unverified banner until a live run exists.
- The simulator is one application. Nothing measured on it generalises across apps.
