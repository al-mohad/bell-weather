"""Tests for the reference computer-use agent.

Standard library only - no pytest, no anthropic SDK, no API key - so CI verifies the
whole agent on every commit. What these cannot cover is the network call itself; that
boundary is stated on AnthropicTransport and in docs/methodology.md.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import unittest
from pathlib import Path

AGENT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(AGENT_DIR))

from action_schema import ACTION_JSON_SCHEMA, ActionError, KINDS, to_protocol_action  # noqa: E402
from model import Pricing, ScriptedTransport, Usage, prune  # noqa: E402

DISPLAY = {"width": 1280, "height": 768}


class ActionMapping(unittest.TestCase):
    def test_every_kind_maps(self) -> None:
        samples = {
            "click": {"kind": "click", "x": 10, "y": 20},
            "move": {"kind": "move", "x": 1, "y": 2},
            "type": {"kind": "type", "text": "42000.00"},
            "key": {"kind": "key", "keys": "F10"},
            "scroll": {"kind": "scroll", "x": 5, "y": 5, "direction": "down", "amount": 3},
            "wait": {"kind": "wait", "ms": 100},
            "done": {"kind": "done", "summary": "committed"},
            "abstain": {"kind": "abstain", "reason": "item not on file"},
        }
        self.assertEqual(set(samples), set(KINDS))
        for kind, raw in samples.items():
            with self.subTest(kind=kind):
                self.assertEqual(to_protocol_action(raw, DISPLAY)["kind"], kind)

    def test_schema_lists_every_property_as_required(self) -> None:
        # Structured outputs reject a schema whose `required` omits a property.
        self.assertEqual(
            sorted(ACTION_JSON_SCHEMA["required"]),
            sorted(ACTION_JSON_SCHEMA["properties"]),
        )
        self.assertFalse(ACTION_JSON_SCHEMA["additionalProperties"])

    def test_clamps_out_of_frame_coordinates_and_records_it(self) -> None:
        action = to_protocol_action({"kind": "click", "x": 9999, "y": -5, "rationale": "aim"}, DISPLAY)
        self.assertEqual((action["x"], action["y"]), (1279, 0))
        self.assertIn("clamped from (9999,-5)", action["rationale"])

    def test_rejects_actions_that_cannot_be_executed(self) -> None:
        for raw in (
            {"kind": "click", "x": None, "y": 3},
            {"kind": "type", "text": ""},
            {"kind": "key", "keys": "   "},
            {"kind": "scroll", "x": 1, "y": 1, "direction": "sideways"},
            {"kind": "abstain", "reason": None, "rationale": ""},
            {"kind": "teleport"},
        ):
            with self.subTest(raw=raw), self.assertRaises(ActionError):
                to_protocol_action(raw, DISPLAY)

    def test_clamps_scroll_amount_into_the_protocol_range(self) -> None:
        self.assertEqual(to_protocol_action(
            {"kind": "scroll", "x": 0, "y": 0, "direction": "up", "amount": 999}, DISPLAY
        )["amount"], 30)


class HistoryPruning(unittest.TestCase):
    def _turns(self, count: int) -> list[dict[str, object]]:
        return [
            {
                "role": "user" if index % 2 == 0 else "assistant",
                "content": [
                    {"type": "image", "source": {"data": "x"}},
                    {"type": "text", "text": f"step {index}"},
                ],
            }
            for index in range(count)
        ]

    def test_keeps_only_the_most_recent_images(self) -> None:
        pruned = prune(self._turns(10))
        images = [b for turn in pruned for b in turn["content"] if b.get("type") == "image"]
        self.assertEqual(len(images), 3)
        # The surviving images must be the last ones, not the first.
        tail = pruned[-1]["content"]
        self.assertTrue(any(b.get("type") == "image" for b in tail))

    def test_always_starts_with_a_user_turn(self) -> None:
        # The API rejects a history that opens with an assistant turn.
        for count in range(1, 16):
            with self.subTest(count=count):
                pruned = prune(self._turns(count))
                if pruned:
                    self.assertEqual(pruned[0]["role"], "user")

    def test_preserves_text_when_it_drops_an_image(self) -> None:
        pruned = prune(self._turns(10))
        texts = [b["text"] for turn in pruned for b in turn["content"] if b.get("type") == "text"]
        self.assertIn("step 9", texts)
        self.assertIn("[earlier screenshot omitted]", texts)


class PricingMath(unittest.TestCase):
    def test_computes_dollars_from_published_rates(self) -> None:
        pricing = Pricing()
        usage = Usage(input_tokens=1_000_000, output_tokens=1_000_000)
        rates = pricing.data["models"]["claude-opus-5"]
        self.assertAlmostEqual(
            pricing.usd("claude-opus-5", usage),
            rates["inputPerMTok"] + rates["outputPerMTok"],
            places=6,
        )

    def test_prices_cache_reads_below_fresh_input(self) -> None:
        pricing = Pricing()
        fresh = pricing.usd("claude-opus-5", Usage(input_tokens=100_000))
        cached = pricing.usd("claude-opus-5", Usage(cache_read_tokens=100_000))
        self.assertLess(cached, fresh)

    def test_returns_none_rather_than_zero_for_an_unpriced_model(self) -> None:
        # Reporting $0.00 for an unknown model would be a lie; None makes the report
        # say "not measured".
        self.assertIsNone(Pricing().usd("claude-not-a-model", Usage(input_tokens=10)))

    def test_usage_omits_usd_when_it_is_unknown(self) -> None:
        self.assertNotIn("usd", Usage(input_tokens=5).to_protocol())
        self.assertIn("usd", Usage(input_tokens=5, usd=0.1).to_protocol())


class ScriptedTransportBehaviour(unittest.TestCase):
    def test_plays_the_fixture_in_order_then_abstains(self) -> None:
        script = AGENT_DIR / "fixtures" / "sim-cust-01.script.jsonl"
        transport = ScriptedTransport(str(script))
        first = transport.act("system", [])
        self.assertEqual(first.action["kind"], "type")
        for _ in range(len(transport.actions)):
            last = transport.act("system", [])
        self.assertEqual(last.action["kind"], "abstain")
        self.assertIn("ran out of actions", last.action["reason"])

    def test_requires_a_script_path(self) -> None:
        saved = os.environ.pop("BELLWETHER_MODEL_SCRIPT", None)
        try:
            with self.assertRaises(RuntimeError):
                ScriptedTransport()
        finally:
            if saved is not None:
                os.environ["BELLWETHER_MODEL_SCRIPT"] = saved


class StdioRoundTrip(unittest.TestCase):
    """Drives the real process over the real protocol, with a scripted model."""

    def _rpc(self, process: subprocess.Popen[str], method: str, params: dict, request_id: int) -> dict:
        process.stdin.write(json.dumps({"jsonrpc": "2.0", "id": request_id, "method": method, "params": params}) + "\n")
        process.stdin.flush()
        return json.loads(process.stdout.readline())

    def test_init_step_close(self) -> None:
        env = {
            **os.environ,
            "BELLWETHER_MODEL_TRANSPORT": "scripted",
            "BELLWETHER_MODEL_SCRIPT": str(AGENT_DIR / "fixtures" / "sim-cust-01.script.jsonl"),
        }
        process = subprocess.Popen(
            [sys.executable, str(AGENT_DIR / "main.py")],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env=env,
        )
        try:
            init = self._rpc(
                process,
                "agent.init",
                {
                    "protocol": "1.0",
                    "taskId": "sim-cust-01",
                    "goal": "set the credit limit",
                    "surface": "desktop",
                    "budget": {"steps": 40, "usd": 1},
                    "display": DISPLAY,
                    "seed": 1,
                },
                1,
            )
            self.assertEqual(init["result"]["agent"], "claude-cua")
            self.assertIn("transport:scripted", init["result"]["capabilities"])
            self.assertNotIn("text-screen", init["result"]["capabilities"])

            step = self._rpc(
                process,
                "agent.step",
                {
                    "observation": {
                        "stepIndex": 0,
                        "screenshotPngB64": "",
                        "width": DISPLAY["width"],
                        "height": DISPLAY["height"],
                        "remaining": {"steps": 40, "usd": 1},
                    }
                },
                2,
            )
            self.assertEqual(step["result"]["action"], {"kind": "type", "text": "1", "rationale": "enter selection"})
            self.assertEqual(step["result"]["usage"]["inputTokens"], 1200)

            unknown = self._rpc(process, "agent.dance", {}, 3)
            self.assertEqual(unknown["error"]["code"], -32601)

            closed = self._rpc(process, "agent.close", {"reason": "done", "verdict": "pass"}, 4)
            self.assertEqual(closed["result"], {})
            self.assertEqual(process.wait(timeout=10), 0)
        finally:
            if process.poll() is None:
                process.kill()
            for pipe in (process.stdin, process.stdout, process.stderr):
                if pipe is not None:
                    pipe.close()


if __name__ == "__main__":
    unittest.main()
