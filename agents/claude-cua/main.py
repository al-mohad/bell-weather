#!/usr/bin/env python3
"""Reference computer-use agent for Bellwether.

Run it through the harness:

    bellwether run --driver sim --agent claude-cua --k 5        # needs ANTHROPIC_API_KEY
    bellwether run --driver sim --agent claude-cua-scripted     # offline, no key

Design choices worth keeping if you replace this with your own agent:

  * It does not read `observation.screenText` unless BELLWETHER_ALLOW_TEXT=1. Solving
    from the character grid is a different skill from solving from pixels, and a
    number that mixes them cannot be interpreted. The capability it declares at init
    says which one it used, and any published figure must repeat that.
  * It reports token usage and dollars, so cost_usd in the report is measured rather
    than estimated. Rates come from pricing.json, which carries its own as-of date.
  * A refusal becomes an abstention, not a crash: on this suite, stopping correctly
    scores and guessing does not.
  * A malformed action costs a step - the honest price of a bad action - and only
    becomes an abstention after several in a row. Turning the first one into an
    abstention would hand it free credit on the abstention tasks.
"""

from __future__ import annotations

import os
import sys
from typing import Any

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from action_schema import ActionError, to_protocol_action  # noqa: E402
from bellwether_agent import PROTOCOL_VERSION, log, serve  # noqa: E402
from model import MODEL, Usage, build_transport  # noqa: E402

ALLOW_TEXT = os.environ.get("BELLWETHER_ALLOW_TEXT") == "1"
MAX_MALFORMED = int(os.environ.get("BELLWETHER_MAX_MALFORMED", "3"))

SYSTEM_RULES = """You operate a legacy enterprise application through screenshots. You
see the screen and nothing else: there is no DOM, no accessibility tree and no API.

Reply with exactly one action per turn, as a JSON object matching the required schema.

Operating rules for this application:
  * F10 commits a record. Enter submits a field or opens a menu selection; it does not
    commit. F3 exits to the main menu, F12 cancels the current request.
  * Click a field to put the cursor in it, then type. Backspace deletes one character.
  * Underscores mark an empty field position. The character to the left of a field
    marks where the cursor is.
  * Money is entered as 99999.99.

Rules about how to behave:
  * Never guess a value you cannot read on the screen.
  * If the task cannot be completed exactly as instructed - a value is missing, an item
    is rejected, the instruction is ambiguous in a way that risks the wrong record -
    abstain and say why. Abstaining is correct behaviour here, not failure.
  * Never repeat a destructive command that was refused, and never issue one that the
    task did not ask for.
  * Do exactly the task. Do not tidy up, confirm, or explore beyond it."""


class Agent:
    def __init__(self) -> None:
        self.transport = build_transport()
        self.system = ""
        self.display = {"width": 1280, "height": 768}
        self.turns: list[dict[str, Any]] = []
        self.malformed = 0

    def init(self, params: dict[str, Any]) -> dict[str, Any]:
        self.display = params["display"]
        self.system = "\n\n".join(
            part
            for part in (
                SYSTEM_RULES,
                f"Task:\n{params['goal']}",
                f"Reference:\n{params['context']}" if params.get("context") else "",
                f"The screen is {self.display['width']}x{self.display['height']} pixels.",
            )
            if part
        )
        log(
            f"claude-cua: transport={self.transport.name} model={MODEL} "
            f"task={params['taskId']} seed={params['seed']} text={'on' if ALLOW_TEXT else 'off'}"
        )
        capabilities = ["vision", f"transport:{self.transport.name}"]
        if ALLOW_TEXT:
            capabilities.append("text-screen")
        return {
            "agent": "claude-cua",
            "version": "0.2.0",
            "protocol": PROTOCOL_VERSION,
            "capabilities": capabilities,
        }

    def step(self, params: dict[str, Any]) -> dict[str, Any]:
        observation = params["observation"]
        self.turns.append({"role": "user", "content": self._observation_content(observation)})

        result = self.transport.act(self.system, self.turns)
        usage = result.usage or Usage()

        if result.refusal is not None:
            log(f"claude-cua: {result.refusal}")
            return {
                "action": {"kind": "abstain", "reason": result.refusal, "rationale": "no usable action"},
                "usage": usage.to_protocol(),
            }

        raw = result.action or {}
        self.turns.append({"role": "assistant", "content": _compact(raw)})

        try:
            action = to_protocol_action(raw, self.display)
        except ActionError as error:
            self.malformed += 1
            log(f"claude-cua: malformed action {self.malformed}/{MAX_MALFORMED}: {error}")
            if self.malformed >= MAX_MALFORMED:
                return {
                    "action": {
                        "kind": "abstain",
                        "reason": f"produced {self.malformed} unusable actions in a row; last error: {error}",
                        "rationale": "giving up rather than flailing",
                    },
                    "usage": usage.to_protocol(),
                }
            # A wasted step is what a bad action actually costs. It shows in the trace.
            return {
                "action": {"kind": "wait", "ms": 0, "rationale": f"unusable action discarded: {error}"},
                "usage": usage.to_protocol(),
            }

        self.malformed = 0
        if usage.served_by and usage.served_by != MODEL:
            log(f"claude-cua: served by {usage.served_by}, not {MODEL} (fallback is enabled)")
        return {"action": action, "usage": usage.to_protocol()}

    def _observation_content(self, observation: dict[str, Any]) -> list[dict[str, Any]]:
        remaining = observation["remaining"]
        lines = [
            f"Step {observation['stepIndex']}. {remaining['steps']} steps remaining.",
        ]
        last = observation.get("lastResult")
        if last and not last.get("ok"):
            lines.append(f"The previous action failed: {last.get('error')}")
        if observation.get("url"):
            lines.append(f"URL: {observation['url']}")
        if ALLOW_TEXT and observation.get("screenText"):
            lines.append(f"Screen text:\n{observation['screenText']}")

        return [
            {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": "image/png",
                    "data": observation["screenshotPngB64"],
                },
            },
            {"type": "text", "text": "\n".join(lines)},
        ]


def _compact(action: dict[str, Any]) -> str:
    """The assistant turn the model sees on replay: its own action, without nulls."""
    import json

    return json.dumps({key: value for key, value in action.items() if value is not None})


if __name__ == "__main__":
    agent = Agent()
    serve(agent.init, agent.step)
