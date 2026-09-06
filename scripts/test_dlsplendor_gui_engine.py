from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

import csplendor

CONFIGURED_DLSPLENDOR_ROOT = os.environ.get("DLSPLENDOR_ROOT", "").strip()
DLSPLENDOR_ROOT = (
    Path(CONFIGURED_DLSPLENDOR_ROOT).expanduser().resolve()
    if CONFIGURED_DLSPLENDOR_ROOT
    else Path(__file__).resolve().parents[2] / "dlsplendor"
)
if DLSPLENDOR_ROOT.is_dir():
    sys.path.insert(0, str(DLSPLENDOR_ROOT))

from scripts import dlsplendor_gui_engine as engine  # noqa: E402


class DeviceResolutionTest(unittest.TestCase):
    def setUp(self) -> None:
        self.original_device = os.environ.pop("DLSPLENDOR_GUI_DEVICE", None)

    def tearDown(self) -> None:
        if self.original_device is None:
            os.environ.pop("DLSPLENDOR_GUI_DEVICE", None)
        else:
            os.environ["DLSPLENDOR_GUI_DEVICE"] = self.original_device

    def test_default_prefers_cuda_over_mps(self) -> None:
        with (
            patch.object(engine.torch.cuda, "is_available", return_value=True),
            patch.object(
                engine.torch.backends.mps, "is_available", return_value=True
            ),
        ):
            self.assertEqual(engine._resolve_device(), engine.torch.device("cuda"))

    def test_default_uses_mps_when_cuda_is_unavailable(self) -> None:
        with (
            patch.object(engine.torch.cuda, "is_available", return_value=False),
            patch.object(
                engine.torch.backends.mps, "is_available", return_value=True
            ),
        ):
            self.assertEqual(engine._resolve_device(), engine.torch.device("mps"))

    def test_default_falls_back_to_cpu_without_accelerator(self) -> None:
        with (
            patch.object(engine.torch.cuda, "is_available", return_value=False),
            patch.object(
                engine.torch.backends.mps, "is_available", return_value=False
            ),
        ):
            self.assertEqual(engine._resolve_device(), engine.torch.device("cpu"))

    def test_explicit_mps_requires_an_available_backend(self) -> None:
        os.environ["DLSPLENDOR_GUI_DEVICE"] = "mps"
        with patch.object(
            engine.torch.backends.mps, "is_available", return_value=False
        ):
            with self.assertRaisesRegex(RuntimeError, "MPSを利用できません"):
                engine._resolve_device()


class GameTurnAdjudicationTest(unittest.TestCase):
    def make_session(self, game: csplendor.Game) -> engine.GameSession:
        model = engine.LoadedModel(
            model_id="test-model",
            kind="rule",
            path=None,
            config_path=None,
            config=None,
            encoder=None,
            network=None,
        )
        return engine.GameSession(
            session_id="test-session",
            mode="ai-vs-ai",
            models_by_seat=(model, model),
            human_seat=None,
            simulations=1,
            seed=1,
            game=game,
            mcts_by_seat=(None, None),
            max_game_turns=engine.MAX_GAME_TURNS,
        )

    def test_game_remains_active_before_max_turns(self) -> None:
        game = csplendor.Game(seed=1)
        game.board.turn = engine.MAX_GAME_TURNS - 1
        session = self.make_session(game)

        session.update_adjudication()
        payload = engine._session_payload(session)

        self.assertFalse(session.adjudicated_draw)
        self.assertFalse(payload["state"]["board"]["game_over"])
        self.assertEqual(payload["state"]["board"]["winner"], -1)
        self.assertIsNone(payload["termination_reason"])
        self.assertGreater(len(game.legal_actions), 0)
        self.assertEqual(payload["state"]["legal_actions"], [])

    def test_second_player_move_at_limit_is_adjudicated_as_draw(self) -> None:
        game = csplendor.Game(seed=1)
        game.board.turn = engine.MAX_GAME_TURNS - 1
        game.board.current_player = 1
        session = self.make_session(game)

        engine._append_and_apply(
            session,
            game.legal_actions[0],
            actor="ai",
            model_id="test-model",
        )
        payload = engine._session_payload(session)

        self.assertEqual(game.turn, engine.MAX_GAME_TURNS)
        self.assertTrue(session.adjudicated_draw)
        self.assertTrue(payload["state"]["board"]["game_over"])
        self.assertEqual(payload["state"]["board"]["winner"], -2)
        self.assertEqual(payload["termination_reason"], "max-turns")
        self.assertEqual(payload["max_game_turns"], engine.MAX_GAME_TURNS)
        self.assertEqual(payload["state"]["legal_actions"], [])


class HiddenReservationPrivacyTest(unittest.TestCase):
    @staticmethod
    def reserve_from_deck(game: csplendor.Game) -> tuple[int, int, int]:
        action = next(
            action for action in game.legal_actions if int(action.type) == 3
        )
        player_index = int(game.current_player)
        game.apply_action_code(action.pack())
        player = game.board.players[player_index]
        slot_index = next(
            index
            for index, is_hidden in enumerate(player.reserved_is_hidden)
            if bool(is_hidden)
        )
        return player_index, slot_index, int(player.reserved[slot_index])

    @staticmethod
    def make_session(
        game: csplendor.Game,
        *,
        human_seat: int | None,
    ) -> engine.GameSession:
        model = engine.LoadedModel(
            model_id="test-model",
            kind="rule",
            path=None,
            config_path=None,
            config=None,
            encoder=None,
            network=None,
        )
        models = (
            (model, model)
            if human_seat is None
            else (None, model)
            if human_seat == 0
            else (model, None)
        )
        return engine.GameSession(
            session_id="privacy-test",
            mode="ai-vs-ai" if human_seat is None else "human-vs-ai",
            models_by_seat=models,
            human_seat=human_seat,
            simulations=1,
            seed=1,
            game=game,
            mcts_by_seat=(None, None),
        )

    def test_spectator_payload_never_exposes_hidden_card_id(self) -> None:
        game = csplendor.Game(seed=1)
        player_index, slot_index, hidden_card_id = self.reserve_from_deck(game)
        payload = engine._session_payload(
            self.make_session(game, human_seat=None)
        )

        self.assertEqual(
            payload["state"]["players"][player_index]["reserved_cards"][
                slot_index
            ],
            -1,
        )
        self.assertEqual(
            payload["hidden_reserved_levels"][f"{player_index}:{slot_index}"],
            1,
        )
        self.assertNotIn(hidden_card_id, payload["public_reserved_card_ids"])
        self.assertNotIn(
            f"{player_index}:{hidden_card_id}",
            payload["hidden_reserved_levels"],
        )
        self.assertEqual(payload["state"]["legal_actions"], [])

    def test_owner_sees_own_hidden_reservation(self) -> None:
        game = csplendor.Game(seed=1)
        player_index, slot_index, hidden_card_id = self.reserve_from_deck(game)
        payload = engine._session_payload(
            self.make_session(game, human_seat=player_index)
        )

        self.assertEqual(
            payload["state"]["players"][player_index]["reserved_cards"][
                slot_index
            ],
            hidden_card_id,
        )
        self.assertNotIn(
            f"{player_index}:{slot_index}",
            payload["hidden_reserved_levels"],
        )
        self.assertEqual(payload["state"]["legal_actions"], [])

    def test_opponent_hidden_id_is_masked_on_human_turn(self) -> None:
        game = csplendor.Game(seed=1)
        player_index, slot_index, hidden_card_id = self.reserve_from_deck(game)
        human_seat = int(game.current_player)
        payload = engine._session_payload(
            self.make_session(game, human_seat=human_seat)
        )

        self.assertEqual(
            payload["state"]["players"][player_index]["reserved_cards"][
                slot_index
            ],
            -1,
        )
        self.assertNotIn(hidden_card_id, payload["public_reserved_card_ids"])
        self.assertGreater(len(payload["state"]["legal_actions"]), 0)


class RulePlayerSessionTest(unittest.TestCase):
    def tearDown(self) -> None:
        engine.SESSIONS.clear()

    def test_rule_player_can_be_selected_without_a_checkpoint(self) -> None:
        payload = engine._new_game(
            {
                "mode": "ai-vs-ai",
                "player_kinds": ["rule", "rule"],
                "model_ids": [
                    "rule-cost-efficiency-3ply",
                    "rule-cost-efficiency-3ply",
                ],
                "model_paths": [None, None],
                "model_config_paths": [None, None],
                "human_seat": None,
                "simulations": 1,
                "seed": 10,
            }
        )

        moved = engine._ai_action({"session_id": payload["session_id"]})

        self.assertEqual(
            moved["player_model_ids"],
            ["rule-cost-efficiency-3ply", "rule-cost-efficiency-3ply"],
        )
        self.assertEqual(len(moved["moves"]), 1)
        self.assertEqual(moved["ai_move"]["simulations"], 0)
        self.assertEqual(
            moved["ai_move"]["model_id"],
            "rule-cost-efficiency-3ply",
        )
        self.assertEqual(moved["ai_move"]["search_profile"]["level"], "rule")
        self.assertFalse(moved["ai_move"]["mate_search_attempted"])


class FullSearchDiagnosticsTest(unittest.TestCase):
    class FakeMcts:
        def search(self, game, *, num_simulations, add_root_noise):
            del add_root_noise
            action_id = engine.ACTION_ENCODER.encode(game.legal_actions[0], game)
            return action_id, {
                "simulations": 0,
                "requested_simulations": num_simulations,
                "value": 1.0,
                "tree_reused": True,
                "reused_visits": 37,
                "chance_nodes": 4,
                "chance_outcomes_scored": 12,
                "mate_search_attempted": True,
                "mate_proven": True,
                "mate_value_proven": True,
                "mate_depth": 2,
                "mate_search_nodes": 321,
                "mate_search_elapsed_ms": 7.5,
                "mate_search_stop_reason": "mate",
            }

        def observe_transition(self, before, action_id, game):
            del before, action_id, game

    def tearDown(self) -> None:
        engine.SESSIONS.clear()

    def test_full_search_profile_and_mate_result_are_returned(self) -> None:
        config = engine.Config.from_yaml(
            str(DLSPLENDOR_ROOT / "configs" / "selfplay16_exact_mate.yaml")
        )
        model = engine.LoadedModel(
            model_id="selfplay17-best",
            kind="checkpoint",
            path="unused.pt",
            config_path="unused.yaml",
            config=config,
            encoder=None,
            network=None,
        )
        session = engine.GameSession(
            session_id="full-search-test",
            mode="human-vs-ai",
            models_by_seat=(model, None),
            human_seat=1,
            simulations=400,
            seed=1,
            game=csplendor.Game(seed=1),
            mcts_by_seat=(self.FakeMcts(), None),
        )
        engine.SESSIONS[session.session_id] = session

        moved = engine._ai_action({"session_id": session.session_id})

        profile = moved["player_search_profiles"][0]
        self.assertEqual(profile["level"], "full")
        self.assertTrue(profile["mate_search_enabled"])
        self.assertTrue(profile["tactical_reserve_enabled"])
        self.assertTrue(profile["strategic_candidates_enabled"])
        self.assertTrue(profile["reserve_plan_enabled"])
        self.assertFalse(profile["root_noise"])
        self.assertEqual(moved["ai_move"]["requested_simulations"], 400)
        self.assertEqual(moved["ai_move"]["simulations"], 0)
        self.assertTrue(moved["ai_move"]["mate_proven"])
        self.assertEqual(moved["ai_move"]["mate_depth"], 2)
        self.assertEqual(moved["ai_move"]["mate_search_nodes"], 321)
        self.assertEqual(moved["ai_move"]["reused_visits"], 37)
        self.assertEqual(moved["ai_move"]["chance_outcomes_scored"], 12)


class LatestCheckpointIntegrationTest(unittest.TestCase):
    DEFINITIONS = (
        (
            "selfplay7-iteration-000030",
            "selfplay7",
            Path("weights") / "iteration_000030.pt",
            "selfplay7",
        ),
        ("selfplay8-best", "selfplay8", Path("best.pt"), "selfplay8"),
        ("selfplay9-best", "selfplay9", Path("best.pt"), "selfplay9"),
        ("selfplay10-best", "selfplay10", Path("best.pt"), "selfplay10"),
        ("selfplay12-best", "selfplay12", Path("best.pt"), "selfplay12"),
        ("selfplay13-best", "selfplay13", Path("best.pt"), "selfplay13"),
        (
            "selfplay16-previous",
            "selfplay14_card_economy",
            Path("best.pt"),
            "selfplay16_exact_mate",
        ),
        (
            "selfplay17-best",
            "selfplay17",
            Path("best.pt"),
            "selfplay16_exact_mate",
        ),
    )

    @classmethod
    def setUpClass(cls) -> None:
        cls.dlsplendor_root = DLSPLENDOR_ROOT
        missing = [
            model_id
            for model_id, family, relative_path, config_name in cls.DEFINITIONS
            if not cls.model_path(family, relative_path).is_file()
            or not cls.config_path(config_name).is_file()
        ]
        if missing:
            raise unittest.SkipTest(
                "checkpointまたはconfigが未配置です: " + ", ".join(missing)
            )

    def tearDown(self) -> None:
        engine.SESSIONS.clear()
        engine.MODELS.clear()

    @classmethod
    def model_path(
        cls,
        family: str,
        relative_path: Path = Path("best.pt"),
    ) -> Path:
        return cls.dlsplendor_root / "models" / family / relative_path

    @classmethod
    def config_path(cls, config_name: str) -> Path:
        return cls.dlsplendor_root / "configs" / f"{config_name}.yaml"

    def test_multihead_models_can_play_human_match(self) -> None:
        for model_id, family, relative_path, config_name in self.DEFINITIONS:
            with self.subTest(family=family):
                payload = engine._new_game(
                    {
                        "mode": "human-vs-ai",
                        "player_kinds": ["checkpoint", None],
                        "model_ids": [model_id, None],
                        "model_paths": [
                            str(self.model_path(family, relative_path)),
                            None,
                        ],
                        "model_config_paths": [
                            str(self.config_path(config_name)),
                            None,
                        ],
                        "human_seat": 1,
                        "simulations": 1,
                        "seed": 100,
                    }
                )

                moved = engine._ai_action(
                    {"session_id": payload["session_id"]}
                )

                self.assertEqual(moved["player_model_ids"], [model_id, None])
                self.assertEqual(len(moved["moves"]), 1)
                self.assertEqual(moved["ai_move"]["model_id"], model_id)
                self.assertEqual(moved["ai_move"]["simulations"], 1)
                engine.SESSIONS.pop(payload["session_id"], None)
                engine.MODELS.clear()

    def test_selfplay7_vs_selfplay9_can_play_spectator_match(self) -> None:
        payload = engine._new_game(
            {
                "mode": "ai-vs-ai",
                "player_kinds": ["checkpoint", "checkpoint"],
                "model_ids": [
                    "selfplay7-iteration-000030",
                    "selfplay9-best",
                ],
                "model_paths": [
                    str(
                        self.model_path(
                            "selfplay7",
                            Path("weights") / "iteration_000030.pt",
                        )
                    ),
                    str(self.model_path("selfplay9")),
                ],
                "model_config_paths": [
                    str(self.config_path("selfplay7")),
                    str(self.config_path("selfplay9")),
                ],
                "human_seat": None,
                "simulations": 1,
                "seed": 150,
            }
        )

        first_move = engine._ai_action({"session_id": payload["session_id"]})
        second_move = engine._ai_action({"session_id": payload["session_id"]})

        self.assertEqual(
            second_move["player_model_ids"],
            ["selfplay7-iteration-000030", "selfplay9-best"],
        )
        self.assertEqual(
            first_move["ai_move"]["model_id"],
            "selfplay7-iteration-000030",
        )
        self.assertEqual(second_move["ai_move"]["model_id"], "selfplay9-best")
        self.assertEqual(
            [move["model_id"] for move in second_move["moves"]],
            ["selfplay7-iteration-000030", "selfplay9-best"],
        )

    def test_selfplay8_vs_selfplay9_can_play_spectator_match(self) -> None:
        payload = engine._new_game(
            {
                "mode": "ai-vs-ai",
                "player_kinds": ["checkpoint", "checkpoint"],
                "model_ids": ["selfplay8-best", "selfplay9-best"],
                "model_paths": [
                    str(self.model_path("selfplay8")),
                    str(self.model_path("selfplay9")),
                ],
                "model_config_paths": [
                    str(self.config_path("selfplay8")),
                    str(self.config_path("selfplay9")),
                ],
                "human_seat": None,
                "simulations": 1,
                "seed": 200,
            }
        )

        first_move = engine._ai_action({"session_id": payload["session_id"]})
        second_move = engine._ai_action({"session_id": payload["session_id"]})

        self.assertEqual(
            second_move["player_model_ids"],
            ["selfplay8-best", "selfplay9-best"],
        )
        self.assertEqual(first_move["ai_move"]["model_id"], "selfplay8-best")
        self.assertEqual(second_move["ai_move"]["model_id"], "selfplay9-best")
        self.assertEqual(
            [move["model_id"] for move in second_move["moves"]],
            ["selfplay8-best", "selfplay9-best"],
        )

    def test_selfplay9_vs_selfplay10_can_play_spectator_match(self) -> None:
        payload = engine._new_game(
            {
                "mode": "ai-vs-ai",
                "player_kinds": ["checkpoint", "checkpoint"],
                "model_ids": ["selfplay9-best", "selfplay10-best"],
                "model_paths": [
                    str(self.model_path("selfplay9")),
                    str(self.model_path("selfplay10")),
                ],
                "model_config_paths": [
                    str(self.config_path("selfplay9")),
                    str(self.config_path("selfplay10")),
                ],
                "human_seat": None,
                "simulations": 1,
                "seed": 250,
            }
        )

        first_move = engine._ai_action({"session_id": payload["session_id"]})
        second_move = engine._ai_action({"session_id": payload["session_id"]})

        self.assertEqual(
            second_move["player_model_ids"],
            ["selfplay9-best", "selfplay10-best"],
        )
        self.assertEqual(first_move["ai_move"]["model_id"], "selfplay9-best")
        self.assertEqual(second_move["ai_move"]["model_id"], "selfplay10-best")
        self.assertEqual(
            [move["model_id"] for move in second_move["moves"]],
            ["selfplay9-best", "selfplay10-best"],
        )

    def test_selfplay10_vs_selfplay12_can_play_spectator_match(self) -> None:
        payload = engine._new_game(
            {
                "mode": "ai-vs-ai",
                "player_kinds": ["checkpoint", "checkpoint"],
                "model_ids": ["selfplay10-best", "selfplay12-best"],
                "model_paths": [
                    str(self.model_path("selfplay10")),
                    str(self.model_path("selfplay12")),
                ],
                "model_config_paths": [
                    str(self.config_path("selfplay10")),
                    str(self.config_path("selfplay12")),
                ],
                "human_seat": None,
                "simulations": 1,
                "seed": 275,
            }
        )

        first_move = engine._ai_action({"session_id": payload["session_id"]})
        second_move = engine._ai_action({"session_id": payload["session_id"]})

        self.assertEqual(
            second_move["player_model_ids"],
            ["selfplay10-best", "selfplay12-best"],
        )
        self.assertEqual(first_move["ai_move"]["model_id"], "selfplay10-best")
        self.assertEqual(second_move["ai_move"]["model_id"], "selfplay12-best")
        self.assertEqual(
            [move["model_id"] for move in second_move["moves"]],
            ["selfplay10-best", "selfplay12-best"],
        )

    def test_previous_champion_vs_selfplay17_can_play_spectator_match(self) -> None:
        payload = engine._new_game(
            {
                "mode": "ai-vs-ai",
                "player_kinds": ["checkpoint", "checkpoint"],
                "model_ids": ["selfplay16-previous", "selfplay17-best"],
                "model_paths": [
                    str(self.model_path("selfplay14_card_economy")),
                    str(self.model_path("selfplay17")),
                ],
                "model_config_paths": [
                    str(self.config_path("selfplay16_exact_mate")),
                    str(self.config_path("selfplay16_exact_mate")),
                ],
                "human_seat": None,
                "simulations": 1,
                "seed": 290,
            }
        )

        first_move = engine._ai_action({"session_id": payload["session_id"]})
        second_move = engine._ai_action({"session_id": payload["session_id"]})

        self.assertEqual(
            second_move["player_model_ids"],
            ["selfplay16-previous", "selfplay17-best"],
        )
        self.assertEqual(
            first_move["ai_move"]["search_profile"]["level"], "full"
        )
        self.assertEqual(
            second_move["ai_move"]["search_profile"]["level"], "full"
        )
        self.assertEqual(
            [move["model_id"] for move in second_move["moves"]],
            ["selfplay16-previous", "selfplay17-best"],
        )

    def test_human_move_can_be_followed_by_selfplay17_move(self) -> None:
        payload = engine._new_game(
            {
                "mode": "human-vs-ai",
                "player_kinds": [None, "checkpoint"],
                "model_ids": [None, "selfplay17-best"],
                "model_paths": [
                    None,
                    str(self.model_path("selfplay17")),
                ],
                "model_config_paths": [
                    None,
                    str(self.config_path("selfplay16_exact_mate")),
                ],
                "human_seat": 0,
                "simulations": 1,
                "seed": 300,
            }
        )

        after_human = engine._human_action(
            {"session_id": payload["session_id"], "action_index": 0}
        )
        after_ai = engine._ai_action({"session_id": payload["session_id"]})

        self.assertEqual(after_human["moves"][0]["actor"], "human")
        self.assertEqual(after_ai["moves"][1]["actor"], "ai")
        self.assertEqual(
            after_ai["moves"][1]["model_id"],
            "selfplay17-best",
        )


if __name__ == "__main__":
    unittest.main()
