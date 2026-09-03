---
'@bellwether/runner': patch
---

The agent's stderr now survives an init failure.

When an agent process died before `agent.init` returned, no `TraceWriter` existed yet
and its stderr was dropped — so every spawn failure looked like an empty void trial with
no evidence. The trial directory is now created and the stderr written on that path too.

Found by writing the budget-guard test: a generated child agent had a syntax error and
the harness could only report "agent closed stdout before responding".
