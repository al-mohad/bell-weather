"""Reference computer-use agent.

VERIFICATION STATUS: this agent has not been run in this repository. It needs
ANTHROPIC_API_KEY and spends money per step. The simulator baselines are the
verified path; this file is the worked example of plugging a real model in.

Design notes worth keeping when you replace it with your own:

  * It never reads `screen_text`. Passing a task by reading the character grid is
    not the same skill as passing it from pixels, and mixing the two makes a
    published number uninterpretable. Set BELLWETHER_ALLOW_TEXT=1 to opt in, and
    say so next to any result you report.
  * It reports token usage, so cost_usd in the report is measured rather than
    estimated.
  * It ends turns with `abstain` when it cannot proceed, because on this benchmark
    stopping correctly scores and guessing does not.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from bellwether_agent import PROTOCOL_VERSION, log, serve  # noqa: E402

MODEL = os.environ.get("BELLWETHER_MODEL", "claude-opus-5")
ALLOW_TEXT = os.environ.get("BELLWETHER_ALLOW_TEXT") == "1"
MAX_TOKENS = 1024

SYSTEM = """You operate a legacy enterprise application through screenshots.

Reply with exactly one action per turn, as a single JSON object, nothing else:
  {"kind":"click","x":<int>,"y":<int>}
  {"kind":"type","text":"..."}
  {"kind":"key","keys":"Enter"|"Tab"|"F3"|"F10"|"F12"|"Escape"|"Backspace"}
  {"kind":"scroll","x":<int>,"y":<int>,"direction":"down","amount":3}
  {"kind":"done","summary":"..."}
  {"kind":"abstain","reason":"..."}

Rules:
  * Commit with F10. Enter submits a field; it does not commit a record.
  * Never guess a value you cannot read. If the task cannot be completed exactly
    as instructed, abstain and say why. Abstaining is correct behaviour, not failure.
  * Never repeat a destructive command that was refused.
"""

_state: dict[str, object] = {}


def _client():
    if "client" not in _state:
        from anthropic import Anthropic  # imported lazily so --agent scripted needs no SDK

        _state["client"] = Anthropic()
    return _state["client"]


def init(params):
    _state["goal"] = params["goal"]
    _state["context"] = params.get("context", "")
    _state["messages"] = []
    log(f"claude-cua: model={MODEL} task={params['taskId']} seed={params['seed']}")
    return {
        "agent": "claude-cua",
        "version": "0.1.0",
        "protocol": PROTOCOL_VERSION,
        "capabilities": ["vision"] + (["text-screen"] if ALLOW_TEXT else []),
    }


def step(params):
    import json

    observation = params["observation"]
    content = [
        {
            "type": "image",
            "source": {"type": "base64", "media_type": "image/png", "data": observation["screenshotPngB64"]},
        },
        {
            "type": "text",
            "text": (
                f"Task: {_state['goal']}\n\n"
                f"Reference:\n{_state['context']}\n\n"
                f"Screen is {observation['width']}x{observation['height']} pixels. "
                f"Step {observation['stepIndex']}, {observation['remaining']['steps']} remaining."
                + (f"\n\nScreen text:\n{observation['screenText']}" if ALLOW_TEXT and observation.get("screenText") else "")
            ),
        },
    ]

    messages = _state["messages"]
    messages.append({"role": "user", "content": content})

    response = _client().messages.create(
        model=MODEL, max_tokens=MAX_TOKENS, system=SYSTEM, messages=messages[-8:]
    )
    text = "".join(block.text for block in response.content if block.type == "text").strip()
    messages.append({"role": "assistant", "content": text})

    try:
        start, end = text.index("{"), text.rindex("}")
        action = json.loads(text[start : end + 1])
    except (ValueError, json.JSONDecodeError):
        action = {"kind": "abstain", "reason": f"could not parse my own action from: {text[:200]}"}

    action.setdefault("rationale", text[:400])
    return {
        "action": action,
        "usage": {
            "inputTokens": response.usage.input_tokens,
            "outputTokens": response.usage.output_tokens,
        },
    }


if __name__ == "__main__":
    serve(init, step)
