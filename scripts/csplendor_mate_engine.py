#!/usr/bin/env python3
"""Persistent JSON-lines bridge for lazy csplendor mate expansion."""

from __future__ import annotations

import json
import sys
import traceback
from collections import OrderedDict
from typing import Any

from csplendor.mate_frontier import expand_mate_frontier, load_mate_frontier_game

PROTOCOL_VERSION = 1
MAX_CACHE_ENTRIES = 64

_CACHE: OrderedDict[tuple[object, ...], dict[str, Any]] = OrderedDict()


def _bounded_int(
    payload: dict[str, Any], name: str, default: int, minimum: int, maximum: int
) -> int:
    value = int(payload.get(name, default))
    if value < minimum or value > maximum:
        raise ValueError(f"{name}は{minimum}以上{maximum}以下で指定してください。")
    return value


def _bounded_float(
    payload: dict[str, Any], name: str, default: float, minimum: float, maximum: float
) -> float:
    value = float(payload.get(name, default))
    if value < minimum or value > maximum:
        raise ValueError(f"{name}は{minimum}以上{maximum}以下で指定してください。")
    return value


def _preferred_attacker_actions(payload: dict[str, Any]) -> list[int]:
    raw_actions = payload.get("preferred_attacker_actions", [])
    if not isinstance(raw_actions, list) or len(raw_actions) > 32:
        raise ValueError("preferred_attacker_actionsは32要素以下の配列で指定してください。")
    actions: list[int] = []
    for raw_action in raw_actions:
        action = int(raw_action)
        if action < 0 or action >= 1 << 64:
            raise ValueError("preferred_attacker_actionsに不正なaction codeがあります。")
        actions.append(action)
    return actions


def _expand(payload: dict[str, Any]) -> dict[str, Any]:
    position_value = payload.get("position")
    state_value = payload.get("state")
    position = position_value if isinstance(position_value, str) else None
    state = state_value if isinstance(state_value, str) else None
    if state is not None and len(state) > 1_000_000:
        raise ValueError("stateが大きすぎます。")
    if position is not None and len(position) > 100_000:
        raise ValueError("positionが大きすぎます。")

    attacker = _bounded_int(payload, "attacker", 0, 0, 1)
    depth = _bounded_int(payload, "depth", 0, 0, 31)
    max_nodes = _bounded_int(payload, "max_nodes", 5_000_000, 0, 20_000_000)
    time_limit = _bounded_float(
        payload, "time_limit_seconds", 30.0, 0.0, 600.0
    )
    edge_limit = _bounded_int(payload, "edge_limit", 250_000, 0, 1_000_000)
    preferred_attacker_actions = _preferred_attacker_actions(payload)
    source = state or position or ""
    source_kind = "state" if state else "position"
    cache_key = (
        source_kind,
        source,
        attacker,
        depth,
        max_nodes,
        time_limit,
        edge_limit,
        tuple(preferred_attacker_actions),
    )
    cached = _CACHE.get(cache_key)
    if cached is not None:
        _CACHE.move_to_end(cache_key)
        return cached

    game = load_mate_frontier_game(position=position, state=state)
    result = expand_mate_frontier(
        game,
        attacker=attacker,
        depth=depth,
        max_nodes=max_nodes,
        time_limit_seconds=time_limit,
        edge_limit=edge_limit,
        preferred_attacker_actions=preferred_attacker_actions,
    )
    _CACHE[cache_key] = result
    _CACHE.move_to_end(cache_key)
    while len(_CACHE) > MAX_CACHE_ENTRIES:
        _CACHE.popitem(last=False)
    return result


def _handle(command: str, payload: dict[str, Any]) -> dict[str, Any]:
    if command == "ping":
        return {
            "ready": True,
            "protocol_version": PROTOCOL_VERSION,
            "cached_frontiers": len(_CACHE),
        }
    if command == "expand_frontier":
        return _expand(payload)
    raise ValueError(f"未対応のcommandです: {command}")


def _write_response(response: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(response, ensure_ascii=False, separators=(",", ":")))
    sys.stdout.write("\n")
    sys.stdout.flush()


def main() -> None:
    for raw_line in sys.stdin:
        if not raw_line.strip():
            continue
        request_id: str | int | None = None
        try:
            request = json.loads(raw_line)
            if not isinstance(request, dict):
                raise ValueError("requestはJSON objectである必要があります。")
            request_id = request.get("request_id")
            command = str(request.get("command", ""))
            payload = request.get("payload", {})
            if not isinstance(payload, dict):
                raise ValueError("payloadはJSON objectである必要があります。")
            _write_response(
                {
                    "request_id": request_id,
                    "ok": True,
                    "result": _handle(command, payload),
                }
            )
        except Exception as error:  # Keep serving later expansion requests.
            traceback.print_exc(file=sys.stderr)
            _write_response(
                {
                    "request_id": request_id,
                    "ok": False,
                    "error": str(error) or error.__class__.__name__,
                }
            )


if __name__ == "__main__":
    main()
