import { CARDS } from '@/constants/gameData';
import { applyMateMove, parsePositionSnapshot, type MateKifuMove } from '@/lib/mateKifu';
import { type PaymentVec, type PositionSnapshot } from '@/lib/positionSnapshot';

type PlayerIndex = 0 | 1;

export interface MateStrategyEdge {
  actionCode: number;
  actionUsi?: string;
  revealCard: number | null;
  revealCards?: number[];
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
  expanded: boolean;
  preferredAttackerActions: number[];
  position?: string;
  state?: string;
  searchNodes?: number;
  elapsedMs?: number;
}

export interface MateStrategyReplay {
  position: string;
  attacker: PlayerIndex;
  forcedWinDepth: number;
  root: number;
  nodes: Map<number, MateStrategyNode>;
  lazy: boolean;
  nodeIndex: Map<string, number>;
  nextNodeId: number;
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

function optionalInteger(value: unknown): number | null {
  const parsed = integer(value);
  return parsed < 0 ? null : parsed;
}

function asObject(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function parsePreferredAttackerActions(
  root: Record<string, unknown>,
  attacker: PlayerIndex,
): number[] {
  const actions: number[] = [];
  for (const rawEntry of Array.isArray(root.principal_line) ? root.principal_line : []) {
    if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) continue;
    const entry = rawEntry as Record<string, unknown>;
    if (integer(entry.player) !== attacker) continue;
    const rawAction = entry.action;
    if (!rawAction || typeof rawAction !== 'object' || Array.isArray(rawAction)) continue;
    const action = rawAction as Record<string, unknown>;
    const code = integer(action.pack, integer(entry.action_code));
    if (code >= 0 && Number.isSafeInteger(code)) actions.push(code);
  }
  return actions;
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

function edgeRevealCard(edge: MateStrategyEdge): number | null {
  return edge.revealCard ?? edge.revealCards?.[0] ?? null;
}

function isOracleEdge(edge: MateStrategyEdge): boolean {
  return edge.oracleCard !== null || edge.oracleReserve || edge.oracleReserveCard !== null || edge.oracleReturnColor !== null;
}

function assertReplayableEdge(edge: MateStrategyEdge): void {
  if (isOracleEdge(edge)) throw new Error('strategy.json に再生不能な oracle 手が含まれています。再生成してください。');
}

export function strategyEdgeLabel(edge: MateStrategyEdge, snapshot: PositionSnapshot): string {
  assertReplayableEdge(edge);
  if (edge.actionUsi) return edge.actionUsi;
  const action = decodeAction(edge.actionCode);
  if (action.type === 0 || action.type === 1) return `take:${countsToLetters(action.take ?? [])}${returnSuffix(action.returns ?? [])}`;
  if (action.type === 2) return `reserve:C${action.cardId}${returnSuffix(action.returns ?? [])}`;
  if (action.type === 3) return `reserve:L${action.deckLevel}${returnSuffix(action.returns ?? [])}`;
  if (action.type === 4) return `buy:C${action.cardId}/pay:${countsToToken(purchasePayment(action.cardId ?? -1, action.goldAs ?? [], snapshot))}`;
  if (action.type === 5) return `noble:N${action.nobleId}`;
  return 'resolved';
}

export function strategyEdgeOutcomeLabel(edge: MateStrategyEdge, snapshot: PositionSnapshot): string {
  const action = strategyEdgeLabel(edge, snapshot);
  const reveals = edge.revealCards?.length ? edge.revealCards : edge.revealCard === null ? [] : [edge.revealCard];
  if (reveals.length === 0) return action;
  return `${action} # reveal:${reveals.map((card) => `C${card}`).join(',')}`;
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

export function applyStrategyEdge(replay: MateStrategyReplay, snapshot: PositionSnapshot, edge: MateStrategyEdge): PositionSnapshot {
  const child = replay.nodes.get(edge.child);
  if (!child) throw new Error(`DAG ノード ${edge.child} がありません。`);
  assertReplayableEdge(edge);
  const action = decodeAction(edge.actionCode);
  const move: MateKifuMove = {
    player: snapshot.currentPlayer,
    usi: strategyEdgeLabel(edge, snapshot),
    comment: edgeRevealCard(edge) === null ? '' : `reveal:C${edgeRevealCard(edge)}`,
  };
  if (action.type < 0 || action.type > 5) throw new Error('未対応の action_code です。');
  if (child.position) return parsePositionSnapshot(child.position);
  return applyMateMove(snapshot, move, child.player);
}

export function applyStrategyDeckCounts(replay: MateStrategyReplay, deckCounts: [number, number, number], edge: MateStrategyEdge): [number, number, number] {
  assertReplayableEdge(edge);
  const child = replay.nodes.get(edge.child);
  if (child?.position) return parseDeckCounts(child.position);
  const next = [...deckCounts] as [number, number, number];
  const action = decodeAction(edge.actionCode);
  let level: number | null = null;
  if (action.type === 2 && action.cardId !== undefined) level = cardById.get(action.cardId)?.level ?? null;
  else if (action.type === 3) level = action.deckLevel ?? null;
  else if (action.type === 4 && !action.fromReserved && action.cardId !== undefined) level = cardById.get(action.cardId)?.level ?? null;
  if (level !== null && level >= 1 && level <= 3 && next[level - 1] > 0) next[level - 1] -= 1;
  return next;
}

export function edgeMatchesBoardTarget(edge: MateStrategyEdge, target: { kind: 'card'; cardId: number } | { kind: 'deck'; level: number } | { kind: 'noble'; nobleId: number }): boolean {
  assertReplayableEdge(edge);
  if (target.kind === 'card') {
    const action = decodeAction(edge.actionCode);
    return (action.type === 2 || action.type === 4) && action.cardId === target.cardId;
  }
  const action = decodeAction(edge.actionCode);
  if (target.kind === 'deck') return action.type === 3 && action.deckLevel === target.level;
  return action.type === 5 && action.nobleId === target.nobleId;
}

function decodeCardMaskHex(maskHex: string): number[] {
  const cards: number[] = [];
  for (let byteIndex = 0; byteIndex < Math.floor(maskHex.length / 2); byteIndex += 1) {
    const byte = Number.parseInt(maskHex.slice(byteIndex * 2, byteIndex * 2 + 2), 16);
    if (!Number.isFinite(byte)) continue;
    for (let bit = 0; bit < 8; bit += 1) {
      const card = byteIndex * 8 + bit;
      if (card < 90 && (byte & (1 << bit)) !== 0) cards.push(card);
    }
  }
  return cards;
}

function parseCompactStrategyDag(dag: Record<string, unknown>): Map<number, MateStrategyNode> {
  if (dag.reveal_group_encoding !== 'card_bitset_le_hex_v1') throw new Error('未対応の compact reveal group 形式です。');
  const kindStrings = Array.isArray(dag.kind_strings) ? dag.kind_strings.map(String) : [];
  const resolutionStrings = Array.isArray(dag.resolution_strings) ? dag.resolution_strings.map(String) : [];
  const actionTemplates = Array.isArray(dag.action_templates) ? dag.action_templates : [];
  const revealGroups = Array.isArray(dag.reveal_groups) ? dag.reveal_groups.map(String) : [];
  const edgeRows = Array.isArray(dag.edges) ? dag.edges : [];
  const nodes = new Map<number, MateStrategyNode>();
  const edgeCache = new Map<number, MateStrategyEdge[]>();

  actionTemplates.forEach((template, index) => {
    const rawAction = Array.isArray(template) ? template : [];
    const edge: MateStrategyEdge = {
      actionCode: integer(rawAction[0], 0),
      revealCard: null,
      oracleCard: optionalInteger(rawAction[1]),
      oracleReserve: integer(rawAction[2], 0) === 1,
      oracleReserveCard: optionalInteger(rawAction[3]),
      oracleReturnColor: optionalInteger(rawAction[4]),
      oracleGoldAs: Array.isArray(rawAction[5]) ? rawAction[5].map((value) => integer(value, 0)) : [0, 0, 0, 0, 0],
      child: -1,
    };
    if (isOracleEdge(edge)) throw new Error(`strategy.json の action_templates[${index}] に再生不能な oracle 手が含まれています。再生成してください。`);
  });

  const edgeAt = (index: number): MateStrategyEdge => {
    const rawEdge = Array.isArray(edgeRows[index]) ? edgeRows[index] : [];
    const actionIndex = integer(rawEdge[0], 0);
    const revealGroupIndex = integer(rawEdge[1], -1);
    const rawAction = Array.isArray(actionTemplates[actionIndex]) ? actionTemplates[actionIndex] : [];
    const revealCards = revealGroupIndex >= 0 ? decodeCardMaskHex(revealGroups[revealGroupIndex] ?? '') : [];
    return {
      actionCode: integer(rawAction[0], 0),
      revealCard: revealCards.length > 0 ? revealCards[0] : null,
      revealCards,
      oracleCard: optionalInteger(rawAction[1]),
      oracleReserve: integer(rawAction[2], 0) === 1,
      oracleReserveCard: optionalInteger(rawAction[3]),
      oracleReturnColor: optionalInteger(rawAction[4]),
      oracleGoldAs: Array.isArray(rawAction[5]) ? rawAction[5].map((value) => integer(value, 0)) : [0, 0, 0, 0, 0],
      child: integer(rawEdge[2]),
    };
  };

  for (const rawNode of Array.isArray(dag.nodes) ? dag.nodes : []) {
    const row = Array.isArray(rawNode) ? rawNode : [];
    const id = integer(row[0]);
    const edgeStart = integer(row[5], 0);
    const edgeCount = integer(row[6], 0);
    nodes.set(id, {
      id,
      player: integer(row[1]) === 1 ? 1 : 0,
      depth: integer(row[2], 0),
      kind: kindStrings[integer(row[3], 0)] ?? 'state',
      resolution: optionalInteger(row[4]) === null ? null : resolutionStrings[integer(row[4], -1)] ?? null,
      expanded: true,
      preferredAttackerActions: [],
      get children() {
        const cached = edgeCache.get(id);
        if (cached) return cached;
        const materialized = Array.from({ length: edgeCount }, (_unused, offset) => edgeAt(edgeStart + offset));
        edgeCache.set(id, materialized);
        return materialized;
      },
    });
  }
  return nodes;
}

export function parseMateStrategy(text: string): MateStrategyReplay {
  const root = asObject(JSON.parse(text) as unknown, 'strategy.json が JSON オブジェクトではありません。');
  if (root.format !== 'csplendor_mate_strategy_v1') throw new Error('未対応の strategy.json 形式です。');
  const dag = asObject(root.strategy_dag, 'strategy_dag がありません。');
  const position = typeof root.position === 'string' ? root.position : '';
  if (!position) throw new Error('初期局面がありません。');
  const attacker = integer(root.attacker) === 1 ? 1 : 0;
  const forcedWinDepth = integer(root.forced_win_depth, 0);
  const preferredAttackerActions = parsePreferredAttackerActions(root, attacker);
  const initialSnapshot = parsePositionSnapshot(position);
  const initialDeckCounts = parseDeckCounts(position);
  if (dag.complete !== true) {
    const verification = asObject(root.verification, 'verification がありません。');
    if (verification.all_reveals_verified !== true) {
      throw new Error('全めくれ検証済みの strategy.json が必要です。');
    }
    const rootId = 0;
    const nodes = new Map<number, MateStrategyNode>([[rootId, {
      id: rootId,
      player: initialSnapshot.currentPlayer,
      depth: forcedWinDepth,
      kind: 'state',
      resolution: null,
      children: [],
      expanded: false,
      preferredAttackerActions,
      position,
    }]]);
    return {
      position,
      attacker,
      forcedWinDepth,
      root: rootId,
      nodes,
      lazy: true,
      nodeIndex: new Map([[`root:${forcedWinDepth}:${position}`, rootId]]),
      nextNodeId: 1,
      initialSnapshot,
      initialDeckCounts,
    };
  }
  const nodes = dag.format === 'strategy_dag_compact_v1'
    ? parseCompactStrategyDag(dag)
    : new Map<number, MateStrategyNode>();
  if (dag.format !== 'strategy_dag_compact_v1') {
    for (const rawNode of Array.isArray(dag.nodes) ? dag.nodes : []) {
      const node = asObject(rawNode, 'DAG ノードが不正です。');
      const id = integer(node.id);
      const children = (Array.isArray(node.children) ? node.children : []).map((rawEdge) => {
        const edge = asObject(rawEdge, 'DAG エッジが不正です。');
        const parsedEdge: MateStrategyEdge = {
          actionCode: integer(edge.action_code, 0),
          revealCard: nullableInteger(edge.reveal_card),
          oracleCard: nullableInteger(edge.oracle_card),
          oracleReserve: edge.oracle_reserve === true,
          oracleReserveCard: nullableInteger(edge.oracle_reserve_card),
          oracleReturnColor: nullableInteger(edge.oracle_return_color),
          oracleGoldAs: Array.isArray(edge.oracle_gold_as) ? edge.oracle_gold_as.map((value) => integer(value, 0)) : [0, 0, 0, 0, 0],
          child: integer(edge.child),
        };
        assertReplayableEdge(parsedEdge);
        return parsedEdge;
      });
      nodes.set(id, {
        id,
        player: integer(node.player) === 1 ? 1 : 0,
        depth: integer(node.depth, 0),
        kind: typeof node.kind === 'string' ? node.kind : 'state',
        resolution: typeof node.resolution === 'string' ? node.resolution : null,
        children,
        expanded: true,
        preferredAttackerActions: [],
      });
    }
  }
  const rootId = integer(dag.root);
  if (!nodes.has(rootId)) throw new Error('DAG ルートノードがありません。');
  let nextNodeId = 0;
  for (const id of nodes.keys()) nextNodeId = Math.max(nextNodeId, id + 1);
  return {
    position,
    attacker,
    forcedWinDepth,
    root: rootId,
    nodes,
    lazy: false,
    nodeIndex: new Map(),
    nextNodeId,
    initialSnapshot,
    initialDeckCounts,
  };
}

function lazyNodeKey(depth: number, state: string): string {
  return `${depth}:${state}`;
}

export function mergeLazyMateFrontier(
  replay: MateStrategyReplay,
  parentId: number,
  payloadValue: unknown,
): MateStrategyReplay {
  if (!replay.lazy) return replay;
  const payload = asObject(payloadValue, '遅延応手APIの応答が不正です。');
  if (payload.format !== 'csplendor_mate_frontier_v1') throw new Error('未対応の遅延応手形式です。');
  if (payload.proven !== true || payload.complete !== true) {
    const reason = typeof payload.unknown_reason === 'string'
      ? payload.unknown_reason
      : typeof payload.reason === 'string' ? payload.reason : '証明できませんでした。';
    throw new Error(`このノードの応手を完全展開できませんでした: ${reason}`);
  }
  const parent = replay.nodes.get(parentId);
  if (!parent) throw new Error(`遅延DAGノード ${parentId} がありません。`);
  if (integer(payload.attacker) !== replay.attacker) throw new Error('遅延応手の攻め方が一致しません。');
  if (integer(payload.depth) !== parent.depth || integer(payload.player) !== parent.player) {
    throw new Error('遅延応手の局面情報が一致しません。');
  }

  const nodes = new Map(replay.nodes);
  const nodeIndex = new Map(replay.nodeIndex);
  let nextNodeId = replay.nextNodeId;
  const parentState = typeof payload.state === 'string' ? payload.state : parent.state;
  if (parentState) nodeIndex.set(lazyNodeKey(parent.depth, parentState), parentId);
  const children: MateStrategyEdge[] = [];
  for (const rawEdge of Array.isArray(payload.edges) ? payload.edges : []) {
    const edge = asObject(rawEdge, '遅延応手のエッジが不正です。');
    const childPosition = typeof edge.child_position === 'string' ? edge.child_position : '';
    const childState = typeof edge.child_state === 'string' ? edge.child_state : '';
    const childDepth = integer(edge.child_depth);
    if (!childPosition || !childState || childDepth < 0) throw new Error('遅延応手の子局面が不正です。');
    const actionCode = integer(edge.action_code, 0);
    const matchingHint = parent.player === replay.attacker
      && parent.preferredAttackerActions[0] === actionCode;
    const consumedHints = matchingHint
      ? 1
      : Math.min(Math.max(0, parent.depth - childDepth), parent.preferredAttackerActions.length);
    const childPreferredAttackerActions = parent.preferredAttackerActions.slice(consumedHints);
    const key = lazyNodeKey(childDepth, childState);
    let childId = nodeIndex.get(key);
    if (childId === undefined) {
      childId = nextNodeId;
      nextNodeId += 1;
      nodeIndex.set(key, childId);
      const kind = typeof edge.child_kind === 'string' ? edge.child_kind : 'state';
      nodes.set(childId, {
        id: childId,
        player: integer(edge.child_player) === 1 ? 1 : 0,
        depth: childDepth,
        kind,
        resolution: typeof edge.child_resolution === 'string' ? edge.child_resolution : null,
        children: [],
        expanded: kind === 'terminal',
        preferredAttackerActions: childPreferredAttackerActions,
        position: childPosition,
        state: childState,
      });
    } else {
      const existing = nodes.get(childId);
      if (existing && existing.preferredAttackerActions.length === 0 && childPreferredAttackerActions.length > 0) {
        nodes.set(childId, { ...existing, preferredAttackerActions: childPreferredAttackerActions });
      }
    }
    children.push({
      actionCode,
      actionUsi: typeof edge.action_usi === 'string' ? edge.action_usi : undefined,
      revealCard: nullableInteger(edge.reveal_card),
      oracleCard: null,
      oracleReserve: false,
      oracleReserveCard: null,
      oracleReturnColor: null,
      oracleGoldAs: [0, 0, 0, 0, 0],
      child: childId,
    });
  }
  const stats = payload.stats && typeof payload.stats === 'object' && !Array.isArray(payload.stats)
    ? payload.stats as Record<string, unknown>
    : {};
  nodes.set(parentId, {
    ...parent,
    kind: typeof payload.kind === 'string' ? payload.kind : parent.kind,
    resolution: typeof payload.resolution === 'string' ? payload.resolution : null,
    position: typeof payload.position === 'string' ? payload.position : parent.position,
    state: parentState,
    children,
    expanded: true,
    searchNodes: integer(stats.nodes, 0),
    elapsedMs: typeof stats.elapsed_ms === 'number' ? stats.elapsed_ms : undefined,
  });
  return { ...replay, nodes, nodeIndex, nextNodeId };
}
