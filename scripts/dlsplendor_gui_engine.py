#!/usr/bin/env python3
"""Local JSON-lines bridge from splendorgui to csplendor/dlsplendor.

The process owns live game sessions and loaded neural networks.  Rules and
search remain delegated to the sibling Python packages; this file only adapts
their APIs to JSON for the Next.js server.
"""

from __future__ import annotations

import copy
import json
import os
import secrets
import sys
import time
import traceback
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import csplendor
import torch
from csplendor.api.usi_kifu import action_to_usi
from dlsplendor.config import Config
from dlsplendor.evaluation.rule_based_player import (
    COST_EFFICIENCY_RULE_ID,
    CostEfficiencyRulePlayer,
)
from dlsplendor.network.action_encoder import ActionEncoder
from dlsplendor.network.encoder import StateEncoder
from dlsplendor.network.model import SplendorNetwork
from dlsplendor.search.mcts import MCTS


MAX_SESSIONS = 24
MAX_GAME_TURNS = 150
PROTOCOL_VERSION = 7


def _positive_int_env(name: str, default: int) -> int:
    try:
        value = int(os.environ.get(name, str(default)))
    except ValueError:
        return default
    return max(1, value)


torch.set_num_threads(_positive_int_env("DLSPLENDOR_GUI_TORCH_THREADS", 2))
try:
    torch.set_num_interop_threads(1)
except RuntimeError:
    pass


def _resolve_device() -> torch.device:
    requested = os.environ.get("DLSPLENDOR_GUI_DEVICE", "auto").strip().lower()
    if requested == "auto":
        if torch.cuda.is_available():
            return torch.device("cuda")
        if torch.backends.mps.is_available():
            return torch.device("mps")
        return torch.device("cpu")
    if requested == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("DLSPLENDOR_GUI_DEVICE=cudaですが、CUDAを利用できません。")
    if requested == "mps" and not torch.backends.mps.is_available():
        raise RuntimeError("DLSPLENDOR_GUI_DEVICE=mpsですが、MPSを利用できません。")
    if requested not in {"cpu", "cuda", "mps"}:
        raise ValueError(
            "DLSPLENDOR_GUI_DEVICEはcpu、cuda、mps、autoのいずれかです。"
        )
    return torch.device(requested)


DEVICE = _resolve_device()
DEFAULT_CONFIG = Config.from_preset("standard")
DEFAULT_ENCODER = StateEncoder(DEFAULT_CONFIG.game)
ACTION_ENCODER = ActionEncoder()


@dataclass
class LoadedModel:
    model_id: str
    kind: str
    path: str | None
    config_path: str | None
    config: Config | None
    encoder: StateEncoder | None
    network: SplendorNetwork | None


@dataclass
class GameSession:
    session_id: str
    mode: str
    models_by_seat: tuple[LoadedModel | None, LoadedModel | None]
    human_seat: int | None
    simulations: int
    seed: int
    game: csplendor.Game
    mcts_by_seat: tuple[
        MCTS | CostEfficiencyRulePlayer | None,
        MCTS | CostEfficiencyRulePlayer | None,
    ]
    max_game_turns: int = MAX_GAME_TURNS
    adjudicated_draw: bool = False
    moves: list[dict[str, Any]] = field(default_factory=list)
    created_at: float = field(default_factory=time.monotonic)

    def is_over(self) -> bool:
        return self.adjudicated_draw or self.game.is_game_over()

    def update_adjudication(self) -> None:
        if (
            not self.game.is_game_over()
            and int(self.game.turn) >= self.max_game_turns
        ):
            self.adjudicated_draw = True


MODELS: dict[tuple[str, str, str | None], LoadedModel] = {}
SESSIONS: dict[str, GameSession] = {}


def _load_model(
    model_id: str,
    model_path: str,
    model_config_path: str | None,
) -> tuple[LoadedModel, float]:
    resolved_path = str(Path(model_path).expanduser().resolve())
    resolved_config_path = (
        str(Path(model_config_path).expanduser().resolve())
        if model_config_path
        else None
    )
    cache_key = (model_id, resolved_path, resolved_config_path)
    cached = MODELS.get(cache_key)
    if cached is not None:
        return cached, 0.0

    path = Path(resolved_path)
    if not path.is_file() or path.suffix != ".pt":
        raise FileNotFoundError(f"モデルが見つかりません: {resolved_path}")
    if resolved_config_path is not None:
        config_path = Path(resolved_config_path)
        if not config_path.is_file() or config_path.suffix not in {".yaml", ".yml"}:
            raise FileNotFoundError(
                f"モデル設定が見つかりません: {resolved_config_path}"
            )
        config = Config.from_yaml(resolved_config_path)
    else:
        config = Config.from_preset("standard")
    encoder = StateEncoder(config.game)

    started = time.perf_counter()
    checkpoint = torch.load(path, map_location=DEVICE, weights_only=False)
    if not isinstance(checkpoint, dict) or "model_state_dict" not in checkpoint:
        raise ValueError(f"未対応のcheckpoint形式です: {resolved_path}")

    expected_state_dim = encoder.get_state_dim()
    expected_action_dim = ACTION_ENCODER.action_dim
    checkpoint_state_dim = checkpoint.get("state_dim")
    checkpoint_action_dim = checkpoint.get("action_dim")
    if checkpoint_state_dim is not None and int(checkpoint_state_dim) != expected_state_dim:
        raise ValueError(
            f"state_dim={checkpoint_state_dim}、期待値={expected_state_dim}です。"
        )
    if checkpoint_action_dim is not None and int(checkpoint_action_dim) != expected_action_dim:
        raise ValueError(
            f"action_dim={checkpoint_action_dim}、期待値={expected_action_dim}です。"
        )

    network = SplendorNetwork(
        expected_state_dim,
        expected_action_dim,
        config.model,
    ).to(DEVICE)
    network.load_compatible_state_dict(checkpoint["model_state_dict"])
    network.eval()
    loaded = LoadedModel(
        model_id=model_id,
        kind="checkpoint",
        path=resolved_path,
        config_path=resolved_config_path,
        config=config,
        encoder=encoder,
        network=network,
    )
    MODELS[cache_key] = loaded
    elapsed_ms = (time.perf_counter() - started) * 1_000.0
    print(
        f"[dlsplendor-gui] loaded {model_id} on {DEVICE.type} "
        f"in {elapsed_ms:.0f} ms",
        file=sys.stderr,
        flush=True,
    )
    return loaded, elapsed_ms


def _optional_id(value: Any) -> int | None:
    parsed = int(value)
    return parsed if parsed >= 0 else None


def _serialize_action(game: csplendor.Game, action: csplendor.Action) -> dict[str, Any]:
    take = [int(value) for value in action.take]
    return_gems = [int(value) for value in action.return_gems]
    gold_as = [int(value) for value in action.gold_as]
    return {
        "type": int(action.type),
        "take": take,
        "card_id": _optional_id(action.card_id),
        "deck_level": _optional_id(action.deck_level),
        "from_reserved": bool(action.from_reserved),
        "gold_as": gold_as,
        "return_gems": return_gems,
        "noble_choice": _optional_id(action.noble_choice),
        "usi": action_to_usi(action, game=game),
    }


def _serialize_state(
    game: csplendor.Game,
    *,
    adjudicated_draw: bool = False,
    private_player: int | None = None,
) -> dict[str, Any]:
    board = game.board
    players: list[dict[str, Any]] = []
    public_reserved_card_ids: list[int] = []
    hidden_reserved_levels: dict[str, int] = {}

    for player_index in range(2):
        player = board.players[player_index]
        reserved_cards: list[int] = []
        for slot_index, card_id_raw in enumerate(player.reserved):
            card_id = int(card_id_raw)
            if card_id < 0:
                reserved_cards.append(-1)
                continue
            is_hidden = (
                slot_index < len(player.reserved_is_hidden)
                and bool(player.reserved_is_hidden[slot_index])
            )
            if is_hidden and player_index != private_player:
                reserved_cards.append(-1)
                hidden_reserved_levels[f"{player_index}:{slot_index}"] = (
                    1 if card_id <= 39 else 2 if card_id <= 69 else 3
                )
            else:
                reserved_cards.append(card_id)
                if not is_hidden:
                    public_reserved_card_ids.append(card_id)

        players.append(
            {
                "index": player_index,
                "gems": [int(value) for value in player.gems],
                "bonuses": [int(value) for value in player.bonuses],
                "points": int(player.points),
                "reserved_cards": reserved_cards,
                "purchased_cards": [
                    int(card_id)
                    for card_id in player.purchased_cards
                    if int(card_id) >= 0
                ],
                "acquired_nobles": [
                    int(noble_id)
                    for noble_id in player.acquired_nobles
                    if int(noble_id) >= 0
                ],
            }
        )

    state = {
        "board": {
            "bank": [int(value) for value in board.bank],
            "visible_cards": [
                [int(card_id) for card_id in row] for row in board.visible
            ],
            "deck_counts": [len(deck) for deck in board.decks],
            "nobles": [
                int(noble_id) for noble_id in board.nobles if int(noble_id) >= 0
            ],
            "current_player": int(board.current_player),
            "turn": int(board.turn),
            "waiting_noble": bool(board.waiting_noble),
            "game_over": bool(game.is_game_over() or adjudicated_draw),
            "winner": -2 if adjudicated_draw else int(board.winner),
        },
        "players": players,
        # Legal actions can contain the ID of a hidden reserved card.  They are
        # only needed by the human client on that player's own turn.
        "legal_actions": (
            [_serialize_action(game, action) for action in game.legal_actions]
            if not adjudicated_draw
            and private_player is not None
            and int(board.current_player) == private_player
            else []
        ),
    }
    return {
        "state": state,
        "public_reserved_card_ids": public_reserved_card_ids,
        "hidden_reserved_levels": hidden_reserved_levels,
    }


def _session_payload(
    session: GameSession,
    *,
    ai_move: dict[str, Any] | None = None,
    model_load_ms: float | None = None,
) -> dict[str, Any]:
    payload = _serialize_state(
        session.game,
        adjudicated_draw=session.adjudicated_draw,
        private_player=session.human_seat,
    )
    payload.update(
        {
            "session_id": session.session_id,
            "mode": session.mode,
            "player_model_ids": [
                model.model_id if model is not None else None
                for model in session.models_by_seat
            ],
            # Kept for compatibility with clients created before spectator mode.
            "model_id": next(
                model.model_id
                for model in session.models_by_seat
                if model is not None
            ),
            "human_seat": session.human_seat,
            "simulations": session.simulations,
            "seed": session.seed,
            "max_game_turns": session.max_game_turns,
            "termination_reason": (
                "max-turns"
                if session.adjudicated_draw
                else "rules"
                if session.game.is_game_over()
                else None
            ),
            "moves": list(session.moves),
            "last_move": session.moves[-1] if session.moves else None,
            "ai_move": ai_move,
        }
    )
    if model_load_ms is not None:
        payload["model_load_ms"] = round(model_load_ms)
    return payload


def _require_session(session_id: str) -> GameSession:
    session = SESSIONS.get(session_id)
    if session is None:
        raise KeyError("対局セッションが見つかりません。新しい対局を開始してください。")
    return session


def _append_and_apply(
    session: GameSession,
    action: csplendor.Action,
    *,
    actor: str,
    model_id: str | None = None,
) -> dict[str, Any]:
    game = session.game
    player = int(game.current_player)
    usi = action_to_usi(action, game=game)
    action_id = ACTION_ENCODER.encode(action, game)
    before = game.clone_light()
    if not game.apply(action):
        raise RuntimeError(f"合法手の適用に失敗しました: {usi}")
    for mcts in session.mcts_by_seat:
        if mcts is not None:
            mcts.observe_transition(before, action_id, game)
    session.update_adjudication()
    move = {
        "number": len(session.moves) + 1,
        "player": player,
        "actor": actor,
        "usi": usi,
    }
    if model_id is not None:
        move["model_id"] = model_id
    session.moves.append(move)
    return move


def _new_game(payload: dict[str, Any]) -> dict[str, Any]:
    mode = str(payload.get("mode", "human-vs-ai")).strip()
    if mode not in {"human-vs-ai", "ai-vs-ai"}:
        raise ValueError("modeはhuman-vs-aiまたはai-vs-aiで指定してください。")

    raw_human_seat = payload.get("human_seat")
    human_seat = (
        None if raw_human_seat is None else int(raw_human_seat)
    )
    if mode == "human-vs-ai" and human_seat not in (0, 1):
        raise ValueError("human-vs-aiではhuman_seatに0または1が必要です。")
    if mode == "ai-vs-ai" and human_seat is not None:
        raise ValueError("ai-vs-aiではhuman_seatを指定できません。")

    raw_model_ids = payload.get("model_ids")
    raw_model_paths = payload.get("model_paths")
    raw_model_config_paths = payload.get("model_config_paths")
    raw_player_kinds = payload.get("player_kinds")
    if raw_player_kinds is None and isinstance(raw_model_ids, list):
        raw_player_kinds = [
            None if model_id is None else "checkpoint"
            for model_id in raw_model_ids
        ]
    if (
        not isinstance(raw_model_ids, list)
        or len(raw_model_ids) != 2
        or not isinstance(raw_model_paths, list)
        or len(raw_model_paths) != 2
        or not isinstance(raw_model_config_paths, list)
        or len(raw_model_config_paths) != 2
        or not isinstance(raw_player_kinds, list)
        or len(raw_player_kinds) != 2
    ):
        raise ValueError(
            "player_kinds、model_ids、model_paths、model_config_pathsには"
            "P0・P1の2要素が必要です。"
        )

    simulations = int(payload.get("simulations", 400))
    if simulations < 1:
        raise ValueError("simulationsは1以上で指定してください。")

    raw_seed = payload.get("seed")
    # Keep automatically generated seeds exactly representable by JavaScript.
    seed = secrets.randbits(52) if raw_seed is None else int(raw_seed)
    if seed < 0:
        raise ValueError("seedは0以上で指定してください。")

    loaded_models: list[LoadedModel | None] = []
    model_load_ms = 0.0
    for seat, (
        raw_player_kind,
        raw_model_id,
        raw_model_path,
        raw_model_config_path,
    ) in enumerate(
        zip(
            raw_player_kinds,
            raw_model_ids,
            raw_model_paths,
            raw_model_config_paths,
        )
    ):
        if (
            raw_player_kind is None
            and raw_model_id is None
            and raw_model_path is None
        ):
            if mode != "human-vs-ai" or seat != human_seat:
                raise ValueError(f"P{seat}のモデルが必要です。")
            if raw_model_config_path is not None:
                raise ValueError(f"P{seat}にはモデル設定を指定できません。")
            loaded_models.append(None)
            continue
        player_kind = str(raw_player_kind or "").strip()
        model_id = str(raw_model_id or "").strip()
        if player_kind == "rule":
            if model_id != COST_EFFICIENCY_RULE_ID:
                raise ValueError(f"未対応のルールAIです: {model_id}")
            if raw_model_path is not None or raw_model_config_path is not None:
                raise ValueError("ルールAIにはモデル・設定ファイルを指定できません。")
            loaded_models.append(
                LoadedModel(
                    model_id=model_id,
                    kind="rule",
                    path=None,
                    config_path=None,
                    config=None,
                    encoder=None,
                    network=None,
                )
            )
            continue
        if player_kind != "checkpoint":
            raise ValueError(f"P{seat}のplayer kindが不正です。")

        model_path = str(raw_model_path or "").strip()
        model_config_path = (
            None
            if raw_model_config_path is None
            else str(raw_model_config_path).strip()
        )
        if not model_id or not model_path:
            raise ValueError(f"P{seat}のmodel_idとmodel_pathが必要です。")
        if model_config_path == "":
            raise ValueError(f"P{seat}のmodel_config_pathが空です。")
        loaded_model, elapsed_ms = _load_model(
            model_id,
            model_path,
            model_config_path,
        )
        loaded_models.append(loaded_model)
        model_load_ms += elapsed_ms

    game = csplendor.Game(seed=seed)
    mcts_by_seat: list[MCTS | CostEfficiencyRulePlayer | None] = []
    for seat, loaded_model in enumerate(loaded_models):
        if loaded_model is None:
            mcts_by_seat.append(None)
            continue
        if loaded_model.kind == "rule":
            mcts_by_seat.append(
                CostEfficiencyRulePlayer(
                    seed=seed ^ (0x9E3779B97F4A7C15 + seat)
                )
            )
            continue
        if (
            loaded_model.config is None
            or loaded_model.encoder is None
            or loaded_model.network is None
        ):
            raise RuntimeError(f"P{seat}のcheckpoint構成が不完全です。")
        search_config = copy.deepcopy(loaded_model.config.search)
        search_config.num_simulations = simulations
        search_config.playout_cap_randomization = False
        mcts_by_seat.append(
            MCTS(
                loaded_model.network,
                loaded_model.encoder,
                search_config,
                seed=seed ^ (0x9E3779B97F4A7C15 + seat),
            )
        )

    session_id = str(uuid.uuid4())
    session = GameSession(
        session_id=session_id,
        mode=mode,
        models_by_seat=(loaded_models[0], loaded_models[1]),
        human_seat=human_seat,
        simulations=simulations,
        seed=seed,
        game=game,
        mcts_by_seat=(mcts_by_seat[0], mcts_by_seat[1]),
        max_game_turns=MAX_GAME_TURNS,
    )
    SESSIONS[session_id] = session

    if len(SESSIONS) > MAX_SESSIONS:
        oldest = min(SESSIONS.values(), key=lambda item: item.created_at)
        if oldest.session_id != session_id:
            SESSIONS.pop(oldest.session_id, None)

    return _session_payload(session, model_load_ms=model_load_ms)


def _human_action(payload: dict[str, Any]) -> dict[str, Any]:
    session = _require_session(str(payload.get("session_id", "")))
    game = session.game
    if session.is_over():
        raise ValueError("対局は既に終了しています。")
    if session.mode != "human-vs-ai" or session.human_seat is None:
        raise ValueError("AI対AI観戦では人間の着手を適用できません。")
    if int(game.current_player) != session.human_seat:
        raise ValueError("現在はAIの手番です。")

    action_index = int(payload.get("action_index", -1))
    legal_actions = game.legal_actions
    if action_index < 0 or action_index >= len(legal_actions):
        raise ValueError("選択した合法手は現在の局面では利用できません。")
    _append_and_apply(session, legal_actions[action_index], actor="human")
    return _session_payload(session)


def _ai_action(payload: dict[str, Any]) -> dict[str, Any]:
    session = _require_session(str(payload.get("session_id", "")))
    game = session.game
    if session.is_over():
        raise ValueError("対局は既に終了しています。")
    player = int(game.current_player)
    if session.human_seat is not None and player == session.human_seat:
        raise ValueError("現在は人間の手番です。")
    model = session.models_by_seat[player]
    mcts = session.mcts_by_seat[player]
    if model is None or mcts is None:
        raise RuntimeError(f"P{player}のAIが設定されていません。")

    started = time.perf_counter()
    with torch.inference_mode():
        action_id, search_info = mcts.search(
            game,
            num_simulations=session.simulations,
            add_root_noise=False,
        )
    elapsed_ms = (time.perf_counter() - started) * 1_000.0
    action = ACTION_ENCODER.decode(action_id, game)
    if action is None:
        raise RuntimeError(f"MCTSが非合法なaction idを返しました: {action_id}")
    move = _append_and_apply(
        session,
        action,
        actor="ai",
        model_id=model.model_id,
    )
    ai_move = {
        **move,
        "action_id": int(action_id),
        "simulations": int(search_info.get("simulations", 0)),
        "value": float(search_info.get("value", 0.0)),
        "elapsed_ms": round(elapsed_ms),
        "tree_reused": bool(search_info.get("tree_reused", False)),
    }
    return _session_payload(session, ai_move=ai_move)


def _delete_game(payload: dict[str, Any]) -> dict[str, Any]:
    session_id = str(payload.get("session_id", ""))
    removed = SESSIONS.pop(session_id, None)
    return {"deleted": removed is not None}


def _handle(command: str, payload: dict[str, Any]) -> dict[str, Any]:
    if command == "ping":
        return {
            "ready": True,
            "protocol_version": PROTOCOL_VERSION,
            "device": DEVICE.type,
            "torch_threads": torch.get_num_threads(),
            "state_dim": DEFAULT_ENCODER.get_state_dim(),
            "action_dim": ACTION_ENCODER.action_dim,
            "loaded_models": len(MODELS),
            "sessions": len(SESSIONS),
        }
    if command == "new_game":
        return _new_game(payload)
    if command == "human_action":
        return _human_action(payload)
    if command == "ai_action":
        return _ai_action(payload)
    if command == "delete_game":
        return _delete_game(payload)
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
            result = _handle(command, payload)
            _write_response(
                {"request_id": request_id, "ok": True, "result": result}
            )
        except Exception as error:  # Keep the worker alive for the next request.
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
