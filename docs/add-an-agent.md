# Add an agent

The harness never imports an agent. Yours runs as a child process and speaks
newline-delimited JSON-RPC 2.0 on stdio. That is the entire contract, and it means
your agent can be in any language, in a private repository, behind any weights.

## 1. Speak three methods

```
→ agent.init   { protocol, taskId, goal, context?, surface, budget, display, seed }
← { agent, version, protocol, capabilities? }

→ agent.step   { observation: { stepIndex, screenshotPngB64, width, height,
                                screenText?, url?, lastResult?, remaining } }
← { action, usage? }

→ agent.close  { reason, verdict }
← {}
```

One JSON object per line on stdout. **Logs go to stderr** — anything else on stdout
corrupts the protocol. Your stderr is captured verbatim into every trial directory, so
log freely; it is the first thing anyone reads when a trial fails.

Actions (`packages/protocol/src/actions.ts`):

```
click{x,y,button?,clicks?}  move{x,y}  type{text}  key{keys}
scroll{x,y,direction,amount}  navigate{url}  wait{ms}
done{summary?}  abstain{reason}
```

`abstain` is a first-class result, not a surrender. On tasks that cannot be completed
correctly it is the *passing* action, and guessing is the failure.

## 2. Write the loop

Python — the whole thing, and `agents/claude-cua/bellwether_agent.py` is this file:

```python
import json, sys

def respond(rid, result):
    sys.stdout.write(json.dumps({"jsonrpc": "2.0", "id": rid, "result": result}) + "\n")
    sys.stdout.flush()

for line in sys.stdin:
    if not line.strip():
        continue
    req = json.loads(line)
    if req["method"] == "agent.init":
        respond(req["id"], {"agent": "my-agent", "version": "0.1.0", "protocol": "1.0"})
    elif req["method"] == "agent.step":
        obs = req["params"]["observation"]
        respond(req["id"], {"action": {"kind": "abstain", "reason": "not implemented"}})
    elif req["method"] == "agent.close":
        respond(req["id"], {})
        break
```

TypeScript agents can use the helper instead:

```ts
import { PROTOCOL_VERSION, serveAgent } from '@bellwether/protocol';

await serveAgent({
  init: () => ({ agent: 'my-agent', version: '0.1.0', protocol: PROTOCOL_VERSION }),
  step: ({ observation }) => ({ action: decide(observation) }),
});
```

## 3. Register it

```json
{
  "agents": {
    "my-agent": {
      "command": "python3",
      "args": ["path/to/my_agent.py"],
      "description": "One line, shown by `bellwether list`."
    }
  }
}
```

Relative paths resolve against the repository root.

```bash
bellwether run --driver sim --agent my-agent --k 5
```

## Rules that keep a result comparable

- **Report `usage`.** Token counts and dollars make `cost_usd` measured rather than
  estimated. Omit them and the report says "not measured", which is the honest default.
- **Declare whether you read `screenText`.** Solving from the character grid is a
  different skill from solving from pixels, and mixing them makes a number
  uninterpretable. Put `text-screen` in `capabilities` if you use it, and say so beside
  any figure you publish. The `claude-cua` reference ignores `screenText` unless
  `BELLWETHER_ALLOW_TEXT=1`.
- **Derive any randomness from `seed`.** Reproducibility is the point.
- **Respect `remaining`.** Abstain rather than overrun; a budget overrun scores nothing.
- **Do not read the repository.** Reading a task's verifier or fixtures makes the number
  meaningless. Nothing enforces this — it is the one thing the harness cannot check for
  you.

## Make it testable without spending money

The single most useful thing you can do for anyone who wants to reproduce your number:
put the model call behind an interface with a canned second implementation.

`agents/claude-cua` does this with two transports selected by
`BELLWETHER_MODEL_TRANSPORT` — the real API, and a `scripted` one that replays actions
from a JSONL file. The scripted path needs no key, no SDK and no network, so the entire
agent runs through the real harness against the real verifier in CI on every commit, and
what remains unverified is exactly the network call and nothing more.

An agent whose only code path requires a paid API is an agent nobody can check — not
you after a refactor, not a reviewer, not the person trying to reproduce your result.

## Compatibility

`agent.init` carries the harness's protocol version and your reply carries yours. The
harness refuses to run against a different MAJOR. Additive, optional fields are a MINOR
bump and old agents keep working.
