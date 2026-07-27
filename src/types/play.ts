import type { GameState } from './game';

export type PlayMode = 'human-vs-ai' | 'ai-vs-ai';
export type PlayTerminationReason = 'rules' | 'max-turns' | null;

export interface PlayModelOption {
  id: string;
  kind: 'checkpoint' | 'rule';
  family: string;
  iteration: number;
  label: string;
  note: string;
  recommended: boolean;
  available: boolean;
}

export interface PlayEngineInfo {
  ready: boolean;
  protocol_version: number;
  device: string;
  torch_threads: number;
  state_dim: number;
  action_dim: number;
  loaded_models: number;
  sessions: number;
}

export interface PlayMove {
  number: number;
  player: 0 | 1;
  actor: 'human' | 'ai';
  usi: string;
  model_id?: string;
}

export interface PlayAiMove extends PlayMove {
  model_id: string;
  action_id: number;
  simulations: number;
  value: number;
  elapsed_ms: number;
  tree_reused: boolean;
}

export interface PlayGamePayload {
  session_id: string;
  mode: PlayMode;
  player_model_ids: [string | null, string | null];
  /** Human-vs-AI compatibility field. Prefer player_model_ids for display. */
  model_id: string;
  human_seat: 0 | 1 | null;
  simulations: number;
  seed: number;
  max_game_turns: number;
  termination_reason: PlayTerminationReason;
  state: GameState;
  public_reserved_card_ids: number[];
  /** Hidden reservation levels keyed by "<player>:<slot>"; card IDs stay private. */
  hidden_reserved_levels: Record<string, 1 | 2 | 3>;
  moves: PlayMove[];
  last_move: PlayMove | null;
  ai_move: PlayAiMove | null;
  model_load_ms?: number;
}
