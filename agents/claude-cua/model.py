"""Model transports for the reference computer-use agent.

Two implementations behind one interface:

  anthropic  - the real thing. Claude Opus 5, adaptive thinking, structured outputs,
               a cached system prefix, bounded image history, refusals mapped to
               abstention, and measured cost.
  scripted   - plays canned actions from a JSONL file. Costs nothing, needs no key,
               and lets the whole agent - stdio framing, action mapping, usage
               reporting - be verified end to end through the real harness in CI.

The second one is why this agent is testable at all. An agent whose only code path
requires a paid API is an agent nobody can check.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

MODEL = os.environ.get("BELLWETHER_MODEL", "claude-opus-5")
EFFORT = os.environ.get("BELLWETHER_EFFORT", "high")
MAX_TOKENS = int(os.environ.get("BELLWETHER_MAX_TOKENS", "4096"))
# How many recent screenshots stay in the history. Older turns keep their text and
# lose their image: on a 60-step trial, resending every frame is most of the bill.
MAX_IMAGES = int(os.environ.get("BELLWETHER_MAX_IMAGES", "3"))
# Conversation turns kept at all. Both caps are deliberate and reported in the trace.
MAX_TURNS = int(os.environ.get("BELLWETHER_MAX_TURNS", "12"))


@dataclass
class Usage:
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    usd: float | None = None
    served_by: str | None = None

    def to_protocol(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "inputTokens": self.input_tokens,
            "outputTokens": self.output_tokens,
        }
        if self.usd is not None:
            payload["usd"] = self.usd
        return payload


@dataclass
class ModelResult:
    action: dict[str, Any] | None
    usage: Usage = field(default_factory=Usage)
    """Set when the model declined. The agent turns this into an abstention."""
    refusal: str | None = None


class Pricing:
    """Token counts become dollars only when a rate is actually known."""

    def __init__(self, path: str | None = None) -> None:
        source = path or os.environ.get("BELLWETHER_PRICING")
        default = Path(__file__).with_name("pricing.json")
        self.data = json.loads(Path(source).read_text()) if source else json.loads(default.read_text())

    def usd(self, model: str, usage: Usage) -> float | None:
        rates = self.data.get("models", {}).get(model)
        if not rates:
            return None
        per_input = rates["inputPerMTok"] / 1_000_000
        per_output = rates["outputPerMTok"] / 1_000_000
        write_mult = self.data.get("cacheWriteMultiplier", 1.25)
        read_mult = self.data.get("cacheReadMultiplier", 0.1)
        return (
            usage.input_tokens * per_input
            + usage.output_tokens * per_output
            + usage.cache_write_tokens * per_input * write_mult
            + usage.cache_read_tokens * per_input * read_mult
        )


class ScriptedTransport:
    """Replays actions from a JSONL file: one action object, or {"action": {...}}, per line."""

    name = "scripted"

    def __init__(self, script_path: str | None = None) -> None:
        path = script_path or os.environ.get("BELLWETHER_MODEL_SCRIPT")
        if not path:
            raise RuntimeError(
                "BELLWETHER_MODEL_SCRIPT must point at a JSONL file when "
                "BELLWETHER_MODEL_TRANSPORT=scripted"
            )
        script = Path(path)
        if not script.exists():
            script = Path(__file__).parent / path
        if not script.exists():
            raise RuntimeError(f"scripted transport cannot find {path}")

        self.actions: list[dict[str, Any]] = []
        for line in script.read_text().splitlines():
            if not line.strip():
                continue
            record = json.loads(line)
            self.actions.append(record.get("action", record))
        self.cursor = 0

    def act(self, system: str, turns: list[dict[str, Any]]) -> ModelResult:  # noqa: ARG002
        if self.cursor >= len(self.actions):
            return ModelResult(
                action={
                    "kind": "abstain",
                    "reason": "the scripted transport ran out of actions",
                    "rationale": "scripted",
                }
            )
        action = self.actions[self.cursor]
        self.cursor += 1
        # A plausible token bill, so the usage plumbing is exercised rather than skipped.
        return ModelResult(action=action, usage=Usage(input_tokens=1200, output_tokens=40))


class AnthropicTransport:
    """The real model call.

    VERIFICATION STATUS: never executed. This code path has not made a request from
    this repository - no key, no live run. Everything around it (stdio framing, action
    mapping, clamping, usage reporting, abstention) is verified through the scripted
    transport, so what remains unverified is precisely the network call and the
    response shape. Do not report a Bellwether number from this transport until
    docs/methodology.md records the run.
    """

    name = "anthropic"

    def __init__(self, pricing: Pricing | None = None) -> None:
        try:
            import anthropic  # noqa: PLC0415 - optional: the scripted path must not need it
        except ImportError as exc:  # pragma: no cover - exercised only without the SDK
            raise RuntimeError(
                "the anthropic SDK is not installed: pip install -r agents/claude-cua/requirements.txt"
            ) from exc
        self.anthropic = anthropic
        self.client = anthropic.Anthropic()
        self.pricing = pricing or Pricing()
        # A server-side fallback would silently answer from a different model, which
        # is fine for an application and wrong for a benchmark: the result would no
        # longer describe the model named in results.json. Off unless asked for, and
        # `served_by` is recorded whenever it is on.
        self.fallbacks = os.environ.get("BELLWETHER_FALLBACKS")

    def act(self, system: str, turns: list[dict[str, Any]]) -> ModelResult:
        from action_schema import OUTPUT_FORMAT  # noqa: PLC0415 - local import keeps this file importable alone

        request: dict[str, Any] = {
            "model": MODEL,
            "max_tokens": MAX_TOKENS,
            # The system prompt is byte-stable across every step of every trial, so it
            # is the one thing worth caching. The message history changes each step by
            # design (a new frame), and image pruning rewrites it, so caching further
            # in would never hit.
            "system": [{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
            "messages": prune(turns),
            "thinking": {"type": "adaptive"},
            "output_config": {"effort": EFFORT, "format": OUTPUT_FORMAT},
        }

        try:
            if self.fallbacks:
                response = self.client.beta.messages.create(
                    betas=["server-side-fallback-2026-07-01"], fallbacks="default", **request
                )
            else:
                response = self.client.messages.create(**request)
        except self.anthropic.BadRequestError as exc:
            raise RuntimeError(f"the API rejected the request: {exc.message}") from exc
        except self.anthropic.AuthenticationError as exc:
            raise RuntimeError("ANTHROPIC_API_KEY is missing or invalid") from exc
        except self.anthropic.RateLimitError as exc:
            # The SDK already retried; a trial that cannot proceed is void, not failed.
            raise RuntimeError(f"rate limited after SDK retries: {exc}") from exc
        except self.anthropic.APIStatusError as exc:
            raise RuntimeError(f"API error {exc.status_code}: {exc.message}") from exc
        except self.anthropic.APIConnectionError as exc:
            raise RuntimeError(f"could not reach the API: {exc}") from exc

        usage = Usage(
            input_tokens=getattr(response.usage, "input_tokens", 0) or 0,
            output_tokens=getattr(response.usage, "output_tokens", 0) or 0,
            cache_read_tokens=getattr(response.usage, "cache_read_input_tokens", 0) or 0,
            cache_write_tokens=getattr(response.usage, "cache_creation_input_tokens", 0) or 0,
            served_by=getattr(response, "model", None),
        )
        usage.usd = self.pricing.usd(usage.served_by or MODEL, usage)

        # A refusal is an outcome, not an exception: the correct benchmark record is an
        # abstention with the category, which the suite already knows how to score.
        if getattr(response, "stop_reason", None) == "refusal":
            details = getattr(response, "stop_details", None)
            category = getattr(details, "category", None) if details else None
            return ModelResult(action=None, usage=usage, refusal=f"model declined ({category or 'unspecified'})")

        text = "".join(block.text for block in response.content if block.type == "text").strip()
        if not text:
            return ModelResult(action=None, usage=usage, refusal="model returned no text block")
        try:
            return ModelResult(action=json.loads(text), usage=usage)
        except json.JSONDecodeError:
            return ModelResult(action=None, usage=usage, refusal=f"unparseable response: {text[:200]}")


def prune(turns: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Keep the last MAX_TURNS turns and strip images from all but the last MAX_IMAGES.

    Returned history always starts with a user turn, because the API requires it.
    """
    kept = turns[-MAX_TURNS:] if MAX_TURNS > 0 else list(turns)
    while kept and kept[0].get("role") != "user":
        kept = kept[1:]

    budget = MAX_IMAGES
    pruned: list[dict[str, Any]] = []
    for turn in reversed(kept):
        content = turn.get("content")
        if not isinstance(content, list):
            pruned.append(turn)
            continue
        blocks: list[dict[str, Any]] = []
        for block in content:
            if block.get("type") != "image":
                blocks.append(block)
                continue
            if budget > 0:
                budget -= 1
                blocks.append(block)
            else:
                blocks.append({"type": "text", "text": "[earlier screenshot omitted]"})
        pruned.append({**turn, "content": blocks})
    return list(reversed(pruned))


def build_transport() -> ScriptedTransport | AnthropicTransport:
    kind = os.environ.get("BELLWETHER_MODEL_TRANSPORT", "anthropic")
    if kind == "scripted":
        return ScriptedTransport()
    if kind == "anthropic":
        return AnthropicTransport()
    raise RuntimeError(f"unknown BELLWETHER_MODEL_TRANSPORT {kind!r} (expected anthropic or scripted)")
