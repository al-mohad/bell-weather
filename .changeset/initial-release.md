---
'@bellwether/protocol': minor
'@bellwether/core': minor
'@bellwether/solari': minor
'@bellwether/surfaces': minor
'@bellwether/faults': minor
'@bellwether/guardrails': minor
'@bellwether/verifiers': minor
'@bellwether/runner': minor
'@bellwether/report': minor
'@bellwether/compile': minor
'bellwether': minor
---

First public release.

A reproducible reliability benchmark for computer-use agents on legacy enterprise
software: seeded snapshot forks per trial, ground-truth verifiers with mandatory
falsifiability fixtures, pass^k as the headline metric, seeded fault injection, a
policy layer between agent and surface, and a compiler that turns a solved trace into
a deterministic flow and an MCP server.

The simulator path is verified end to end and runs offline with no API key. The live
Solari path is written and self-tested but has not been executed; every affected file
carries a verification-status note.
