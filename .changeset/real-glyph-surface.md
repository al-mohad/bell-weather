---
'@bellwether/solari': minor
---

The simulator's terminal surface renders real glyphs instead of an ink map.

Frames are now an 80x24 grid drawn with an 8x16 bitmap font (Spleen, BSD-2-Clause) at
2x — 1280x768, phosphor on black — so a vision agent can be pointed at the free,
offline tier for the first time. `renderTerminalPng` replaces `inkMapPng`, and
`pixelToCell` / `cellToPixel` now take the cell size rather than assuming it.

Agents calibrate the character cell from the `display` they are handed at `agent.init`
rather than hard-coding it, which is why the scale change required no task edits. The
bundled reference agents changed with it; they are private and unpublished, so they
carry no changeset of their own.

Re-running all three entrants at seed 20260902 reproduced the previous metrics exactly,
as it should when only the pixels change and every entrant reads `screenText`.
See ADR-0007.
