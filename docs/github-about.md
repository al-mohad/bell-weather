# Repository metadata

Paste-ready text for the GitHub repository settings. Keeping it in the repo means the
description and the README cannot drift apart unnoticed.

## Description (the "About" field, 350 characters max)

> Does a computer-use agent do the job *every* time? Bellwether measures pass^k on
> legacy enterprise screens: snapshot-forked trials, ground-truth verifiers that must
> prove they can fail, seeded fault injection, and a compiler that turns solved traces
> into deterministic MCP tools. Runs offline, no API key.

*(291 characters.)*

### Shorter variant, if you prefer the one-liner

> A reproducible reliability benchmark for computer-use agents on legacy enterprise
> software - and a compiler that turns the flows they solve into deterministic tools.

## Website

`https://al-mohad.github.io/bell-weather` - the nightly report, published by
`.github/workflows/nightly-bench.yml`.

## Topics

```
computer-use  ai-agents  benchmark  reliability  reproducibility  evaluation
llm-evaluation  agent-evaluation  rpa  legacy-systems  enterprise-automation
mcp  typescript  python  solari
```

GitHub allows 20 topics; the 15 above leave room for whatever the project grows into.

## Social preview

Use `docs/images/frame-quotes.png` - a real observation from the benchmark, which is
more informative than a logo and is the image the README leads with.

## Publishing

The release workflow is inert until the npm scope is claimed and trusted publishing is
configured, so that a project which is not yet publishing does not accumulate failed
workflow runs:

```
gh variable set RELEASE_ENABLED --body true
```

## Release notes template

Every release that changes a published number states the six coordinates:

```
Suite core v0.1.0 - driver sim - agent <name> <version> - k=5 - seed 20260902
- suite.lock.json: <sha>
```
