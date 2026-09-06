from __future__ import annotations

import unittest
from unittest.mock import patch

import csplendor
from csplendor.api.usi_kifu import game_to_spn

from scripts import csplendor_mate_engine as engine


def _one_turn_mate_position() -> str:
    game = csplendor.Game(seed=0)
    game.board.current_player = 1
    player = game.board.get_player(1)
    player.points = 14
    player.bonuses = [10, 10, 10, 10, 10]
    game.board.set_player(1, player)
    return game_to_spn(
        game,
        reveal_hidden_reserved_ids=True,
        require_purchased_card_ids=True,
    )


class CsplendorMateEngineTest(unittest.TestCase):
    def setUp(self) -> None:
        engine._CACHE.clear()

    def test_ping_reports_protocol(self) -> None:
        self.assertEqual(engine._handle("ping", {})["protocol_version"], 1)

    def test_expand_returns_json_safe_exact_child_states(self) -> None:
        payload = {
            "position": _one_turn_mate_position(),
            "attacker": 1,
            "depth": 1,
            "max_nodes": 100_000,
            "time_limit_seconds": 5,
            "edge_limit": 10_000,
        }

        result = engine._handle("expand_frontier", payload)

        self.assertTrue(result["proven"])
        self.assertTrue(result["complete"])
        self.assertGreater(len(result["edges"]), 0)
        child = result["edges"][0]
        self.assertIsInstance(child["child_position"], str)
        self.assertIsInstance(child["child_state"], str)
        restored = csplendor.decode_mate_frontier_state(child["child_state"])
        self.assertEqual(restored.current_player, child["child_player"])

        cached = engine._handle("expand_frontier", payload)
        self.assertIs(cached, result)
        self.assertEqual(len(engine._CACHE), 1)

    def test_large_frontier_is_not_cached(self) -> None:
        payload = {
            "position": _one_turn_mate_position(),
            "attacker": 1,
            "depth": 1,
        }
        result = {"edges": [{"child_state": "x" * 100}]}

        with (
            patch.object(engine, "MAX_CACHE_ENTRY_BYTES", 32),
            patch.object(engine, "expand_mate_frontier", return_value=result),
        ):
            returned = engine._handle("expand_frontier", payload)

        self.assertIs(returned, result)
        self.assertEqual(len(engine._CACHE), 0)

    def test_cache_evicts_entries_to_stay_within_byte_limit(self) -> None:
        first_payload = {
            "position": _one_turn_mate_position(),
            "attacker": 1,
            "depth": 1,
        }
        second_payload = {**first_payload, "depth": 0}
        first_result = {"edges": [{"child_state": "a" * 40}]}
        second_result = {"edges": [{"child_state": "b" * 40}]}
        entry_bytes = len(
            engine.json.dumps(
                first_result, ensure_ascii=False, separators=(",", ":")
            ).encode("utf-8")
        )

        with (
            patch.object(engine, "MAX_CACHE_ENTRY_BYTES", entry_bytes),
            patch.object(engine, "MAX_CACHE_BYTES", entry_bytes),
            patch.object(
                engine,
                "expand_mate_frontier",
                side_effect=[first_result, second_result],
            ),
        ):
            engine._handle("expand_frontier", first_payload)
            engine._handle("expand_frontier", second_payload)

        self.assertEqual(len(engine._CACHE), 1)
        self.assertIs(next(iter(engine._CACHE.values()))[0], second_result)

    def test_expand_rejects_unbounded_depth(self) -> None:
        with self.assertRaisesRegex(ValueError, "depth"):
            engine._handle(
                "expand_frontier",
                {
                    "position": _one_turn_mate_position(),
                    "attacker": 1,
                    "depth": 32,
                },
            )

    def test_expand_forwards_principal_line_action_hints(self) -> None:
        payload = {
            "position": _one_turn_mate_position(),
            "attacker": 1,
            "depth": 1,
            "preferred_attacker_actions": [2184, 444],
        }

        with patch.object(
            engine,
            "expand_mate_frontier",
            return_value={"proven": True},
        ) as expand:
            engine._handle("expand_frontier", payload)

        self.assertEqual(
            expand.call_args.kwargs["preferred_attacker_actions"],
            [2184, 444],
        )
        self.assertEqual(expand.call_args.kwargs["max_nodes"], 5_000_000)

    def test_expand_rejects_too_many_action_hints(self) -> None:
        with self.assertRaisesRegex(ValueError, "preferred_attacker_actions"):
            engine._handle(
                "expand_frontier",
                {
                    "position": _one_turn_mate_position(),
                    "attacker": 1,
                    "depth": 1,
                    "preferred_attacker_actions": list(range(33)),
                },
            )


if __name__ == "__main__":
    unittest.main()
