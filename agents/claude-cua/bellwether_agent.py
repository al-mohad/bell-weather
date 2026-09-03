"""Minimal Bellwether agent loop. Copy this file to write an agent in Python.

The whole contract: read one JSON object per line from stdin, write one JSON
object per line to stdout, log to stderr. Nothing else. That is why an agent can
live in any language, in a private repository, behind any weights.
"""

from __future__ import annotations

import json
import sys
from typing import Any, Callable

PROTOCOL_VERSION = "1.0"


def serve(
    init: Callable[[dict[str, Any]], dict[str, Any]],
    step: Callable[[dict[str, Any]], dict[str, Any]],
    close: Callable[[dict[str, Any]], None] | None = None,
) -> None:
    handlers = {"agent.init": init, "agent.step": step}

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        request = json.loads(line)
        method = request.get("method")
        try:
            if method == "agent.close":
                if close:
                    close(request.get("params") or {})
                respond(request["id"], {})
                return
            handler = handlers.get(method)
            if handler is None:
                error(request["id"], -32601, f"unknown method {method}")
                continue
            respond(request["id"], handler(request.get("params") or {}))
        except Exception as exc:  # noqa: BLE001 - the harness needs the message, not a traceback
            error(request.get("id"), -32603, f"{type(exc).__name__}: {exc}")


def respond(request_id: Any, result: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps({"jsonrpc": "2.0", "id": request_id, "result": result}) + "\n")
    sys.stdout.flush()


def error(request_id: Any, code: int, message: str) -> None:
    sys.stdout.write(
        json.dumps({"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}}) + "\n"
    )
    sys.stdout.flush()


def log(message: str) -> None:
    sys.stderr.write(message + "\n")
    sys.stderr.flush()
