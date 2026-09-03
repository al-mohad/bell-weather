# 0007 — The simulator renders real glyphs

- Status: Accepted
- Date: 2026-09-03
- Amends: [0002](0002-driver-abstraction-and-a-simulator.md)

## Context

[ADR-0002](0002-driver-abstraction-and-a-simulator.md) accepted a consequence: "the
simulator is not a vision problem". Its frames were an *ink map* — one filled block per
non-blank cell — legible to nothing, so every simulator result was silently confined to
agents reading `observation.screenText`.

That confinement was costing more than it saved. It meant no vision agent could be
pointed at the suite at all without first standing up a live environment, which put the
most interesting measurement behind a paid key and an unexecuted code path. And a
benchmark whose cheap tier cannot exercise the expensive tier's skill is two benchmarks
pretending to be one.

The intended fix was a containerised X display — Xvfb, a terminal emulator, xdotool —
which is a genuinely real surface. It also adds a container runtime to the list of
things a reader needs before they can reproduce a number, and it was ruled out for this
repository.

## Decision

Render the character grid with a real 8×16 bitmap font (Spleen, BSD-2-Clause),
phosphor green on black, at 2× — 1280×768 for 80×24. The font is generated from the
upstream BDF by `scripts/generate-font.ts` and committed, so a build needs no network.

Geometry stays exact: cell `(col, row)` occupies pixels `[col*w, col*w+w) × [row*h,
row*h+h)`, `pixelToCell` is its inverse, and the two are asserted against each other at
three scales.

Agents no longer hard-code the cell size. They calibrate it from the `display` handed to
them at `agent.init` — which is what an operator's script would do, and which is why
changing the scale from 1× to 2× did not require touching a single task.

`screenText` remains available. Agents declare in `capabilities` whether they use it,
because solving from the grid and solving from pixels are different skills and a number
that mixes them is uninterpretable.

## Consequences

Good:

- A vision agent can now be pointed at the free, offline tier with one command. The
  frames are legible: `docs/images/frame-quotes.png` is an actual observation.
- Reproducibility is unchanged — no container runtime, no display server, no network.
- The change is *falsifiable and was falsified*: re-running all three entrants at seed
  20260902 produced byte-identical metrics to the ink-map runs, which is exactly what
  should happen when only the pixels change and every entrant reads `screenText`.
- Removing the hard-coded cell constant from the agents removed a latent bug class:
  the scale change would have silently mis-aimed every click.

Bad, and accepted:

- **This is still not a real GUI.** It is a faithful raster of a character grid: no
  anti-aliasing, no window chrome, no compositor, no font the agent has not seen. A
  vision result here is evidence about reading a terminal, not about operating a
  desktop. `envs/legacy-5250/` holds the X-based recipe that would close that gap, and
  it remains unexecuted.
- Frames are ~11 KB rather than ~1 KB, and cross the agent boundary as base64. Measured
  at about 13 ms per frame and roughly 10 MB of artifacts per full run — cheap enough
  not to matter, and the reason `deflate` dropped from level 9 to 6.
