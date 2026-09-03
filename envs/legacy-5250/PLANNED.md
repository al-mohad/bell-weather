# Green-screen 5250 — planned

The environment that would make a live run say something the simulator cannot: a real
X session, a real terminal emulator, no DOM, and an agent that has to read pixels.

Target tasks: `leg-01` (look up a customer, change a credit limit, commit with an F-key)
and `leg-02` (batch-update five records through a modal-heavy Java Swing client).

Needed before a task can land here:

- A desktop template with X, a window manager, `tn5250` and a Swing runtime.
- A backing application. `tn5250` needs a host to talk to; the pragmatic substitute is a
  TN5250-speaking service or a curses application driven over `telnetd` — decided in an
  ADR before any work starts, because the choice determines whether results transfer to
  real IBM i systems at all.
- File-diff verifiers: for a legacy binary there is no SQL, so ground truth is the
  application's own data file, compared against a known-good copy.
- A `bw-fault` hook driving the emulator's own session timeout.

Not started. The simulator in `packages/solari/src/sim/` models this environment's
*shape* — F-key commits, focus that moves with Tab, form state lost on expiry — but it
is a character grid behind a text API, and no visual-grounding claim can rest on it.
