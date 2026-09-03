# claude-cua — reference computer-use agent

Claude Opus 5, driving a legacy enterprise screen through screenshots.

```bash
export ANTHROPIC_API_KEY=sk-ant-...
bellwether run --driver sim --agent claude-cua --k 5
```

That is the whole setup. `pip install -r requirements.txt` first if the `anthropic`
SDK isn't already available.

## Verification status

| part | status |
| --- | --- |
| stdio protocol loop, action mapping, coordinate clamping, usage reporting, abstention | **verified** — 15 unit tests plus a full run through the real harness against the real verifier, offline |
| the model call itself (request shape, response shape) | **never executed** — no key, no live run |

The second row is the honest remainder. Everything around the network call is exercised
by `BELLWETHER_MODEL_TRANSPORT=scripted`, which replays canned actions:

```bash
bellwether run --driver sim --agent claude-cua-scripted --tasks sim-cust-01 --k 3
cd agents/claude-cua && python3 -m unittest discover -s tests
```

The unit tests need nothing but the standard library — no pytest, no SDK, no key — so
CI runs them on every commit. An agent whose only code path requires a paid API is an
agent nobody can check.

## What it does, and why

**Vision only.** It ignores `observation.screenText` unless `BELLWETHER_ALLOW_TEXT=1`.
Solving from the character grid is a different skill from solving from pixels, and a
number that mixes them cannot be interpreted. The capability list it reports at `init`
says which one it used; repeat that next to any figure you publish.

**Structured outputs, not prose parsing.** Actions come back through
`output_config.format` against the schema in `action_schema.py`. An agent that
occasionally emits an unparseable action doesn't fail loudly — it fails as a wasted
step, and a benchmark cannot tell that apart from a wrong click.

**Adaptive thinking, effort `high`.** Set `BELLWETHER_EFFORT` to trade quality for
spend (`low`…`max`).

**Cached system prefix, bounded image history.** The system block is byte-stable across
every step, so it is the one thing worth caching. Only the last 3 screenshots stay in
the history (`BELLWETHER_MAX_IMAGES`); on a 60-step trial, resending every frame is most
of the bill. Pruning rewrites the message prefix, so caching further in would never hit
— that trade is deliberate.

**A refusal is an abstention.** `stop_reason: "refusal"` becomes
`{kind: "abstain", reason: "model declined (<category>)"}`. On this suite, stopping
correctly scores and guessing does not, so a decline is a result rather than a crash.

**A malformed action costs a step.** Not an abstention — that would hand it free credit
on the abstention tasks. Three in a row does become one.

**Out-of-frame coordinates are clamped, and the original is recorded in the rationale.**
An out-of-frame click is an agent mistake that should cost a step and appear in the
trace, not a protocol violation that voids the trial and hides the mistake.

**Cost is measured, or reported as unmeasured.** Token counts become dollars using
`pricing.json`, which carries its own `asOf` date and source. An unpriced model yields
`null`, not `$0.00`; the report then says "not measured". Override with
`BELLWETHER_PRICING=/path/to/pricing.json`, and verify the rates before publishing a
cost figure.

**Server-side refusal fallbacks are off by default.** A fallback would answer from a
different model, which is reasonable for an application and wrong for a benchmark — the
result would no longer describe the model named in `results.json`. Set
`BELLWETHER_FALLBACKS=default` to enable it; when it is on, the agent logs the
`served_by` model whenever it differs from the one requested.

## Environment

| variable | default | effect |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | — | required for the real transport |
| `BELLWETHER_MODEL` | `claude-opus-5` | model id |
| `BELLWETHER_EFFORT` | `high` | `low` … `max` |
| `BELLWETHER_MAX_TOKENS` | `4096` | per-step output cap |
| `BELLWETHER_MAX_IMAGES` | `3` | screenshots kept in history |
| `BELLWETHER_MAX_TURNS` | `12` | conversation turns kept |
| `BELLWETHER_ALLOW_TEXT` | unset | `1` lets it read `screenText` |
| `BELLWETHER_MODEL_TRANSPORT` | `anthropic` | or `scripted` |
| `BELLWETHER_MODEL_SCRIPT` | — | JSONL of canned actions for `scripted` |
| `BELLWETHER_PRICING` | bundled | path to a pricing file |
| `BELLWETHER_FALLBACKS` | unset | `default` enables server-side refusal fallbacks |
| `BELLWETHER_MAX_MALFORMED` | `3` | unusable actions tolerated before abstaining |

## Cost before you run it

A trial is one model call per step. `sim-cust-01` takes ~16 steps for a flow that
knows the application; a model finding its way will take more. At `--k 5` across seven
tasks, budget accordingly and keep `--budget-usd` set — the runner aborts the whole run
at the ceiling rather than discovering it on your invoice.
