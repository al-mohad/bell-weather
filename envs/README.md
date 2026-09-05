# Environments

An environment is a real application, seeded to a known state, snapshotted once, and
forked per trial. Environments are **not** built during a benchmark run — see
[ADR-0005](../docs/adr/0005-pinned-snapshots-and-a-suite-lockfile.md).

## Status

| environment | surface | status | tasks |
| --- | --- | --- | --- |
| `sim-erp5250` | desktop | **verified** — deterministic, in-process, no key, renders real glyphs | 7 |
| `odoo-18-seeded` | browser | recipe written, **never seeded or executed** | 1 |
| `legacy-5250` | desktop | **verified live** — seeded on a Solari desktop VM, snapshot pinned in `suite.lock.json` | 1 |
| `osticket` | browser | planned | 0 |

The simulator lives in `packages/solari/src/sim/`, not here, because it is code rather
than a container. Everything in this directory targets `--driver live`.

`legacy-5250` is the environment that lets a result say something the simulator cannot: Xvfb, a real terminal emulator and a real curses application, driven with
xdotool and observed only through screenshots — no character grid behind it. The
application (`northwind5250.py`) implements the same screens, field positions and
commit semantics as the simulator, so every verifier works against it unchanged, and
its logic is proved by a self-test. It has been seeded and run: see the live row in
[docs/methodology.md](../docs/methodology.md).

It runs under `xterm`, not the desktop template's `xfce4-terminal`. GTK claims F10 as
the menu accelerator and F10 is how this application commits a record, so under
xfce4-terminal every trial reached the commit and nothing was written — a silent failure
that only ground-truth verification catches. The Dockerfile here builds the same
environment for other hosts; `scripts/seed-env.ts legacy-5250` is what was actually
executed.

## The contract

An environment directory supplies:

| file | purpose |
| --- | --- |
| `compose.yaml` | Brings the application up inside the sandbox. |
| `wait-for-*.sh` | Blocks until the app answers. Seeding must not race the app. |
| `seed.sh` / `seed.sql` | Puts the application in the exact state every trial starts from. |
| `bw-fault` | Hook script the fault injector calls for application-level faults. |

Then seed it once and pin the result:

```bash
SOLARI_API_KEY=slr_live_... pnpm tsx scripts/seed-env.ts odoo
# → prints a snapshot id to paste into suites/core/suite.lock.json
```

## Why `bw-fault` exists

Faults split by where they can honestly be produced.

`drop-input` and `latency` are properties of the **transport** between the agent and the
surface, so the harness injects them against any driver. `modal` and `session-expiry` are
properties of the **application**, and no harness can conjure them from outside: it has
to ask the app.

So each environment ships a `bw-fault` script, and the fault injector records
`applied: false` when an environment cannot produce a fault rather than pretending it
did. The simulator implements the same interface in-process via `injectEnvFault()`.

```sh
#!/bin/sh
# bw-fault modal            -> make a modal dialog appear for the current session
# bw-fault session-expiry   -> invalidate the session and discard in-flight form state
```

## Licensing

The applications under test are third-party software under their own licences and are
**not** redistributed here: each recipe pulls the upstream image at build time. See
[NOTICE](../NOTICE).

Environments contain synthetic data only. Putting real customer data in a benchmark
environment is a policy failure that redaction does not fix.
