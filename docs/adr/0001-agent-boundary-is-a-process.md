# 0001 — The agent boundary is a process, not an import

- Status: Accepted
- Date: 2026-09-02

## Context

The harness must run agents it did not write. The obvious design is a TypeScript
interface that agents implement and the runner imports. That would have been faster to
build and is what most eval harnesses do.

It also makes the harness unusable by exactly the people whose numbers matter. A lab's
computer-use agent is typically Python, depends on their own model client, and lives in
a private repository. An import boundary asks them to port it, vendor it, or publish it.

## Decision

Agents run as child processes and speak newline-delimited JSON-RPC 2.0 over stdio.
`agent.init` / `agent.step` / `agent.close`. The harness has no dependency on any agent
and no agent has a dependency on the harness beyond the wire format.

NDJSON rather than LSP-style `Content-Length` framing: a Python agent needs
`json.loads(sys.stdin.readline())` and nothing else.

## Consequences

Good:

- An agent can be in any language, private, and behind any weights. A third party can
  reproduce a Bellwether number against their own system without sharing it.
- Crashes, hangs and infinite loops are contained: a dead child is a *void* trial, not a
  harness crash. Per-step timeouts are enforced with SIGTERM and a SIGKILL escalation.
- The protocol is versioned independently and validated with a schema on both sides, so
  an incompatible agent fails at `init` with a clear message rather than mid-run.

Bad, and accepted:

- Process spawn per trial costs tens of milliseconds. Irrelevant next to a microVM boot.
- Observations cross the boundary as base64 PNG in JSON. Wasteful; measured at a few MB
  per trial and not worth a binary channel yet.
- Agents must keep stdout clean. This is a real footgun, so it is stated in
  `docs/add-an-agent.md`, and stderr is captured into every trial directory to make the
  mistake obvious rather than mysterious.
