export type GemType = 0 | 1 | 2 | 3 | 4 | 5;
export const GEM_NAMES = ['Diamond', 'Sapphire', 'Emerald', 'Ruby', 'Onyx', 'Gold'] as const;

export enum ActionType {
  TAKE_GEMS = 0,
  TAKE_TWO_GEMS = 1,
  RESERVE_CARD = 2,
  RESERVE_DECK = 3,
  PURCHASE = 4,
  VISIT_NOBLE = 5
}

export interface CardData {
  id: number;
  level: 1 | 2 | 3;
  points: number;
  bonus: GemType;
  cost: [number, number, number, number, number];
}

export interface NobleData {
  id: number;
  points: number;
  requirement: [number, number, number, number, number];
}

export interface PlayerState {
  index: number;
  gems: [number, number, number, number, number, number];
  bonuses: [number, number, number, number, number];
  points: number;
  reserved_cards: number[];
  purchased_cards: number[];
  acquired_nobles: number[];
}

export interface BoardState {
  bank: [number, number, number, number, number, number];
  visible_cards: [number[], number[], number[]];
  deck_counts: [number, number, number];
  nobles: number[];
  current_player: 0 | 1;
  turn: number;
  waiting_noble: boolean;
  game_over: boolean;
  winner: -1 | -2 | 0 | 1;  // -1: ongoing, -2: draw
}

export interface Action {
  type: ActionType; // ActionType
  take: [number, number, number, number, number, number];
  card_id: number | null;
  deck_level: number | null;
  from_reserved: boolean;
  gold_as: [number, number, number, number, number];
  return_gems: [number, number, number, number, number, number];
  noble_choice: number | null;
  usi?: string | null;
}

export interface GameState {
  board: BoardState;
  players: [PlayerState, PlayerState];
  legal_actions: Action[];
}
