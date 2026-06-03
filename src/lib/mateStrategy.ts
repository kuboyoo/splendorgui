import { CARDS } from '@/constants/gameData';
import { applyMateMove, parsePositionSnapshot, type MateKifuMove } from '@/lib/mateKifu';
import { type PaymentVec, type PositionSnapshot, sanitizeSnapshot } from '@/lib/positionSnapshot';

type PlayerIndex = 0 | 1;

export interface MateStrategyEdge {
  actionCode: number;
  revealCard: number | null;
  oracleCard: number | null;
  oracleReserve: boolean;
  oracleReserveCard: number | null;
  oracleReturnColor: number | null;
  oracleGoldAs: number[];
  child: number;
}

export interface MateStrategyNode {
  id: number;
  player: PlayerIndex;
  depth: number;
  kind: string;
  resolution: string | null;
  children: MateStrategyEdge[];
}

export interface MateStrategyReplay {
  position: string;
  attacker: PlayerIndex;
  forcedWinDepth: number;
  root: number;
  nodes: Map<number, MateStrategyNode>;
  initialSnapshot: PositionSnapshot;
  initialDeckCounts: [number, number, number];
}

export interface MateStrategyStep {
  nodeId: number;
  snapshot: PositionSnapshot;
  deckCounts: [number, number, number];
  label: string;
}

const cardById = new Map(CARDS.map((card) => [card.id, card] as const));
const LETTERS = 'WUGRKD';

function integer(value: unknown, fallback = -1): number {
  return typeof value === 'number' && Number.isInteger(value) ? value : fallback;
}

function nullableInteger(value: unknown): number | null {
  const parsed = integer(value);
  return parsed >= 0 ? parsed : null;
}

function asObject(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function cloneSnapshot(snapshot: PositionSnapshot): PositionSnapshot {
  return sanitizeSnapshot(snapshot);
}

function parseDeckCounts(position: string): [number, number, number] {
  const match = position.match(/(?:^|\|\s*)decks:(\d+),(\d+),(\d+)(?:\s*\||$)/u);
  if (!match) throw new Error('初期局面の山札枚数がありません。');
  return [
    Number.parseInt(match[1], 10),
    Number.parseInt(match[2], 10),
    Number.parseInt(match[3], 10),
  ];
}

function decodeAction(code: number) {
  const bits = BigInt(code);
  const type = Number(bits & BigInt(7));
  const read = (shift: number, mask: bigint) => Number((bits >> BigInt(shift)) & mask);
  const returns: PaymentVec = [0, 0, 0, 0, 0, 0];
  if (type === 0 || type === 1) {
    const take = [0, 1, 2, 3, 4].map((index) => read(3 + index * 2, BigInt(3)));
    for (let index = 0; index < 6; index += 1) returns[index] = read(13 + index * 4, BigInt(15));
    return { type, take, returns };
  }
  if (type === 2) {
    for (let index = 0; index < 6; index += 1) returns[index] = read(10 + index * 4, BigInt(15));
    return { type, cardId: read(3, BigInt(127)) - 1, returns };
  }
  if (type === 3) {
    for (let index = 0; index < 6; index += 1) returns[index] = read(5 + index * 4, BigInt(15));
    return { type, deckLevel: read(3, BigInt(3)), returns };
  }
  if (type === 4) {
    return {
      type,
      cardId: read(3, BigInt(127)) - 1,
      fromReserved: read(10, BigInt(1)) === 1,
      goldAs: [0, 1, 2, 3, 4].map((index) => read(11 + index * 3, BigInt(7))),
    };
  }
  if (type === 5) return { type, nobleId: read(3, BigInt(31)) - 1 };
  return { type };
}

function countsToLetters(values: number[]): string {
  return values.map((count, index) => LETTERS[index].repeat(count)).join('');
}

function countsToToken(values: number[]): string {
  return values.map((count, index) => `${LETTERS[index]}${count}`).join('');
}

function returnSuffix(values: number[]): string {
  const letters = countsToLetters(values);
  return letters ? `/return:${letters}` : '';
}

export function strategyEdgeLabel(edge: MateStrategyEdge, snapshot: PositionSnapshot): string {
  if (edge.oracleReserve) return `oracle reserve:C${edge.oracleReserveCard ?? '?'}${edge.oracleReturnColor === null ? '' : `/return:${LETTERS[edge.oracleReturnColor]}`}`;
  if (edge.oracleCard !== null) return `oracle buy:C${edge.oracleCard}/pay:${oraclePayment(edge, snapshot).map((value, index) => `${LETTERS[index]}${value}`).join('')}`;
  const action = decodeAction(edge.actionCode);
  if (action.type === 0 || action.type === 1) return `take:${countsToLetters(action.take ?? [])}${returnSuffix(action.returns ?? [])}`;
  if (action.type === 2) return `reserve:C${action.cardId}${returnSuffix(action.returns ?? [])}`;
  if (action.type === 3) return `reserve:L${action.deckLevel}${returnSuffix(action.returns ?? [])}`;
  if (action.type === 4) return `buy:C${action.cardId}/pay:${countsToToken(purchasePayment(action.cardId ?? -1, action.goldAs ?? [], snapshot))}`;
  if (action.type === 5) return `noble:N${action.nobleId}`;
  return 'resolved';
}

function purchasePayment(cardId: number, goldAs: number[], snapshot: PositionSnapshot): PaymentVec {
  const card = cardById.get(cardId);
  const player = snapshot.currentPlayer;
  if (!card) throw new Error(`カード C${cardId} が見つかりません。`);
  const payment: PaymentVec = [0, 0, 0, 0, 0, 0];
  for (let color = 0; color < 5; color += 1) {
    const cost = Math.max(0, card.cost[color] - snapshot.purchasedCounts[player][color]);
    payment[color] = cost - (goldAs[color] ?? 0);
    payment[5] += goldAs[color] ?? 0;
  }
  return payment;
}

function oraclePayment(edge: MateStrategyEdge, snapshot: PositionSnapshot): PaymentVec {
  return purchasePayment(edge.oracleCard ?? -1, edge.oracleGoldAs, snapshot);
}

function applyOracleEdge(snapshot: PositionSnapshot, edge: MateStrategyEdge, nextPlayer: PlayerIndex): PositionSnapshot {
  const next = cloneSnapshot(snapshot);
  const player = next.currentPlayer;
  if (edge.oracleReserve) {
    if (edge.oracleReserveCard === null) throw new Error('oracle 予約カードIDがありません。');
    const slot = next.reservedCards[player].indexOf(-1);
    if (slot < 0) throw new Error('oracle 予約枠がありません。');
    const bankGold = 5 - next.playerGems[0][5] - next.playerGems[1][5];
    if (bankGold > 0) next.playerGems[player][5] += 1;
    if (edge.oracleReturnColor !== null) next.playerGems[player][edge.oracleReturnColor] -= 1;
    next.reservedCards[player][slot] = edge.oracleReserveCard;
  } else if (edge.oracleCard !== null) {
    const card = cardById.get(edge.oracleCard);
    if (!card) throw new Error(`oracle 購入カード C${edge.oracleCard} がありません。`);
    const payment = oraclePayment(edge, next);
    next.playerGems[player] = next.playerGems[player].map((value, index) => value - payment[index]) as PaymentVec;
    next.purchasedCounts[player][card.bonus as 0 | 1 | 2 | 3 | 4] += 1;
    next.purchasedCardIds[player].push(edge.oracleCard);
    next.playerPoints[player] += card.points;
  }
  next.currentPlayer = nextPlayer;
  return next;
}

export function applyStrategyEdge(replay: MateStrategyReplay, snapshot: PositionSnapshot, edge: MateStrategyEdge): PositionSnapshot {
  const child = replay.nodes.get(edge.child);
  if (!child) throw new Error(`DAG ノード ${edge.child} がありません。`);
  if (edge.oracleReserve || edge.oracleCard !== null) return applyOracleEdge(snapshot, edge, child.player);
  const action = decodeAction(edge.actionCode);
  const move: MateKifuMove = {
    player: snapshot.currentPlayer,
    usi: strategyEdgeLabel(edge, snapshot),
    comment: edge.revealCard === null ? '' : `reveal:C${edge.revealCard}`,
  };
  if (action.type < 0 || action.type > 5) throw new Error('未対応の action_code です。');
  return applyMateMove(snapshot, move, child.player);
}

export function applyStrategyDeckCounts(deckCounts: [number, number, number], edge: MateStrategyEdge): [number, number, number] {
  const next = [...deckCounts] as [number, number, number];
  if (edge.oracleReserve || edge.oracleCard !== null) return next;
  const action = decodeAction(edge.actionCode);
  let level: number | null = null;
  if (action.type === 2 && action.cardId !== undefined) level = cardById.get(action.cardId)?.level ?? null;
  else if (action.type === 3) level = action.deckLevel ?? null;
  else if (action.type === 4 && !action.fromReserved && action.cardId !== undefined) level = cardById.get(action.cardId)?.level ?? null;
  if (level !== null && level >= 1 && level <= 3 && next[level - 1] > 0) next[level - 1] -= 1;
  return next;
}

export function edgeMatchesBoardTarget(edge: MateStrategyEdge, target: { kind: 'card'; cardId: number } | { kind: 'deck'; level: number } | { kind: 'noble'; nobleId: number }): boolean {
  if (target.kind === 'card') {
    if (edge.oracleCard === target.cardId || edge.oracleReserveCard === target.cardId) return true;
    const action = decodeAction(edge.actionCode);
    return (action.type === 2 || action.type === 4) && action.cardId === target.cardId;
  }
  const action = decodeAction(edge.actionCode);
  if (target.kind === 'deck') return action.type === 3 && action.deckLevel === target.level;
  return action.type === 5 && action.nobleId === target.nobleId;
}

export function parseMateStrategy(text: string): MateStrategyReplay {
  const root = asObject(JSON.parse(text) as unknown, 'strategy.json が JSON オブジェクトではありません。');
  if (root.format !== 'csplendor_mate_strategy_v1') throw new Error('未対応の strategy.json 形式です。');
  const dag = asObject(root.strategy_dag, 'strategy_dag がありません。');
  if (dag.complete !== true) throw new Error('完全な strategy DAG が必要です。');
  const nodes = new Map<number, MateStrategyNode>();
  for (const rawNode of Array.isArray(dag.nodes) ? dag.nodes : []) {
    const node = asObject(rawNode, 'DAG ノードが不正です。');
    const id = integer(node.id);
    const children = (Array.isArray(node.children) ? node.children : []).map((rawEdge) => {
      const edge = asObject(rawEdge, 'DAG エッジが不正です。');
      return {
        actionCode: integer(edge.action_code, 0),
        revealCard: nullableInteger(edge.reveal_card),
        oracleCard: nullableInteger(edge.oracle_card),
        oracleReserve: edge.oracle_reserve === true,
        oracleReserveCard: nullableInteger(edge.oracle_reserve_card),
        oracleReturnColor: nullableInteger(edge.oracle_return_color),
        oracleGoldAs: Array.isArray(edge.oracle_gold_as) ? edge.oracle_gold_as.map((value) => integer(value, 0)) : [0, 0, 0, 0, 0],
        child: integer(edge.child),
      };
    });
    nodes.set(id, {
      id,
      player: integer(node.player) === 1 ? 1 : 0,
      depth: integer(node.depth, 0),
      kind: typeof node.kind === 'string' ? node.kind : 'state',
      resolution: typeof node.resolution === 'string' ? node.resolution : null,
      children,
    });
  }
  const rootId = integer(dag.root);
  const position = typeof root.position === 'string' ? root.position : '';
  if (!nodes.has(rootId)) throw new Error('DAG ルートノードがありません。');
  if (!position) throw new Error('初期局面がありません。');
  return {
    position,
    attacker: integer(root.attacker) === 1 ? 1 : 0,
    forcedWinDepth: integer(root.forced_win_depth, 0),
    root: rootId,
    nodes,
    initialSnapshot: parsePositionSnapshot(position),
    initialDeckCounts: parseDeckCounts(position),
  };
}
