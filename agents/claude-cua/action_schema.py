"""The action vocabulary, as a JSON Schema for structured outputs.

Why a schema rather than parsing JSON out of prose: a computer-use agent that
occasionally emits an unparseable action does not fail loudly, it fails as a wasted
step, and a benchmark cannot tell that apart from a wrong click. Constraining the
response format removes the failure mode instead of measuring it.

Structured outputs require every property to be listed in `required` with
`additionalProperties: false`, so per-kind optional fields are expressed as nullable
and validated here in `to_protocol_action`.
"""

from __future__ import annotations

from typing import Any

KINDS = ("click", "move", "type", "key", "scroll", "wait", "done", "abstain")

DIRECTIONS = ("up", "down", "left", "right")

ACTION_JSON_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "kind": {"type": "string", "enum": list(KINDS)},
        "rationale": {"type": "string", "description": "One sentence on why this action."},
        "x": {"type": ["integer", "null"], "description": "Pixel X for click/move/scroll."},
        "y": {"type": ["integer", "null"], "description": "Pixel Y for click/move/scroll."},
        "text": {"type": ["string", "null"], "description": "Text for kind=type."},
        "keys": {
            "type": ["string", "null"],
            "description": 'Key or chord for kind=key, e.g. "Enter", "F10", "Backspace", "ctrl+s".',
        },
        "direction": {"type": ["string", "null"], "enum": [*DIRECTIONS, None]},
        "amount": {"type": ["integer", "null"], "description": "Scroll ticks, 1-30."},
        "ms": {"type": ["integer", "null"], "description": "Milliseconds for kind=wait."},
        "summary": {"type": ["string", "null"], "description": "What was accomplished, for kind=done."},
        "reason": {
            "type": ["string", "null"],
            "description": "Why the task cannot be completed correctly, for kind=abstain.",
        },
    },
    "required": [
        "kind",
        "rationale",
        "x",
        "y",
        "text",
        "keys",
        "direction",
        "amount",
        "ms",
        "summary",
        "reason",
    ],
    "additionalProperties": False,
}

OUTPUT_FORMAT = {"type": "json_schema", "schema": ACTION_JSON_SCHEMA}


class ActionError(ValueError):
    """The model produced a well-formed object that is not a usable action."""


def to_protocol_action(raw: dict[str, Any], display: dict[str, int]) -> dict[str, Any]:
    """Convert a model action into a Bellwether protocol action.

    Coordinates are clamped to the display and the original is recorded in the
    rationale. Clamping rather than rejecting is deliberate: an out-of-frame click is
    an agent mistake that should cost a step and show up in the trace, not a protocol
    violation that voids the trial and hides the mistake.
    """
    kind = raw.get("kind")
    if kind not in KINDS:
        raise ActionError(f"unknown action kind {kind!r}")

    rationale = (raw.get("rationale") or "").strip()[:2000]
    action: dict[str, Any] = {"kind": kind}
    notes: list[str] = []

    if kind in ("click", "move", "scroll"):
        x, y = raw.get("x"), raw.get("y")
        if not isinstance(x, int) or not isinstance(y, int):
            raise ActionError(f"{kind} needs integer x and y, got x={x!r} y={y!r}")
        cx = min(max(x, 0), display["width"] - 1)
        cy = min(max(y, 0), display["height"] - 1)
        if (cx, cy) != (x, y):
            notes.append(f"clamped from ({x},{y}) to ({cx},{cy})")
        action["x"], action["y"] = cx, cy

    if kind == "scroll":
        direction = raw.get("direction")
        if direction not in DIRECTIONS:
            raise ActionError(f"scroll needs a direction, got {direction!r}")
        amount = raw.get("amount")
        action["direction"] = direction
        action["amount"] = min(max(amount if isinstance(amount, int) else 3, 1), 30)

    if kind == "type":
        text = raw.get("text")
        if not isinstance(text, str) or text == "":
            raise ActionError("type needs a non-empty text")
        action["text"] = text[:4096]

    if kind == "key":
        keys = raw.get("keys")
        if not isinstance(keys, str) or keys.strip() == "":
            raise ActionError("key needs a non-empty keys")
        action["keys"] = keys.strip()[:64]

    if kind == "wait":
        ms = raw.get("ms")
        action["ms"] = min(max(ms if isinstance(ms, int) else 250, 0), 30_000)

    if kind == "done":
        summary = raw.get("summary")
        if isinstance(summary, str) and summary.strip():
            action["summary"] = summary.strip()[:2000]

    if kind == "abstain":
        reason = raw.get("reason") or rationale
        if not isinstance(reason, str) or reason.strip() == "":
            raise ActionError("abstain needs a reason: the reason is the result")
        action["reason"] = reason.strip()[:2000]

    if notes:
        rationale = f"{rationale} [{'; '.join(notes)}]".strip()
    if rationale:
        action["rationale"] = rationale[:2000]
    return action
