import { CARDS, NOBLES } from '@/constants/gameData';
import {
  buildEmptySnapshot,
  type BonusVec,
  type NobleSlots,
  type PaymentVec,
  type PositionSnapshot,
  sanitizeSnapshot,
} from '@/lib/positionSnapshot';

export interface MateKifuMove {
  player: 0 | 1;
  usi: string;
  comment: string;
}

export interface MateKifuReplay {
  headers: Record<string, string>;
  result: string;
  moves: MateKifuMove[];
  snapshots: PositionSnapshot[];
}

const DEFAULT_BANK: PaymentVec = [4, 4, 4, 4, 4, 5];
const GEM_INDEX = new Map([... 'WUGRKD'].map((letter, index) => [letter, index]));
const cardById = new Map(CARDS.map((card) => [card.id, card] as const));
const nobleById = new Map(NOBLES.map((noble) => [noble.id, noble] as const));

function cloneSnapshot(snapshot: PositionSnapshot): PositionSnapshot {
  return sanitizeSnapshot(snapshot);
}

function parseCounts(token: string, size: 5 | 6): number[] {
  const counts = Array.from({ length: size }, () => 0);
  const pattern = /([WUGRKD])(\d+)/gu;
  let position = 0;
  for (const match of token.toUpperCase().matchAll(pattern)) {
    if (match.index !== position) throw new Error(`宝石表記が不正です: ${token}`);
    const index = GEM_INDEX.get(match[1]);
    if (index === undefined || index >= size) throw new Error(`宝石表記が不正です: ${token}`);
    counts[index] = Number.parseInt(match[2], 10);
    position += match[0].length;
  }
  if (position !== token.length) throw new Error(`宝石表記が不正です: ${token}`);
  return counts;
}

function parseLetters(token = ''): PaymentVec {
  const counts: PaymentVec = [0, 0, 0, 0, 0, 0];
  for (const letter of token.toUpperCase()) {
    const index = GEM_INDEX.get(letter);
    if (index === undefined) throw new Error(`宝石表記が不正です: ${token}`);
    counts[index] += 1;
  }
  return counts;
}

function parseIds(token: string, expectedLength?: number): number[] {
  const match = token.trim().match(/^\[([^\]]*)\]$/u);
  if (!match) throw new Error(`ID 一覧が不正です: ${token}`);
  const values = match[1].trim()
    ? match[1].split(',').map((value) => value.trim() === '-' ? -1 : Number.parseInt(value.trim(), 10))
    : [];
  if (expectedLength !== undefined && values.length !== expectedLength) {
    throw new Error(`ID 一覧の要素数が不正です: ${token}`);
  }
  return values;
}

function parseVisible(token: string): number[][] {
  const levels: number[][] = [];
  const body = token.replace(/^visible:/u, '');
  for (const match of body.matchAll(/L([123])(\[[^\]]*\])/gu)) {
    if (Number.parseInt(match[1], 10) !== levels.length + 1) throw new Error('公開カードのレベル順が不正です。');
    levels.push(parseIds(match[2], 4));
  }
  if (levels.length !== 3) throw new Error('公開カードは L1, L2, L3 が必要です。');
  return levels;
}

function parsePlayer(token: string, player: 0 | 1) {
  if (!token.startsWith(`P${player}:`)) throw new Error(`P${player} の局面情報がありません。`);
  const fields = new Map<string, string>();
  for (const part of token.slice(3).split(';')) {
    const separator = part.indexOf(':');
    if (separator < 0) continue;
    fields.set(part.slice(0, separator), part.slice(separator + 1));
  }
  const gems = parseCounts(fields.get('gems') ?? '', 6) as PaymentVec;
  const bonuses = parseCounts(fields.get('bonuses') ?? '', 5) as BonusVec;
  const nobles = parseIds(fields.get('nobles') ?? '[]').filter((id) => id >= 0);
  const reserved = parseIds(fields.get('reserved') ?? '[]').filter((id) => id >= 0);
  return {
    name: fields.get('name')?.trim() || `Player${player}`,
    gems,
    bonuses,
    points: Number.parseInt(fields.get('points') ?? '0', 10),
    nobles: [...nobles, -1, -1, -1].slice(0, 3) as NobleSlots,
    reserved: [...reserved, -1, -1, -1].slice(0, 3),
  };
}

function parseSpn(spn: string): PositionSnapshot {
  if (/^startpos\b/u.test(spn)) throw new Error('GUI 再生には完全な SPN 初期局面が必要です。');
  const sections = spn.split('|').map((part) => part.trim());
  if (sections.length < 7) throw new Error('SPN のセクション数が不足しています。');
  const players = [parsePlayer(sections[4], 0), parsePlayer(sections[5], 1)] as const;
  const snapshot = buildEmptySnapshot();
  snapshot.visibleCards = parseVisible(sections[1]);
  snapshot.boardNobles = [...parseIds(sections[3].replace(/^nobles:/u, '')), -1, -1, -1].slice(0, 3) as NobleSlots;
  snapshot.reservedCards = [[...players[0].reserved], [...players[1].reserved]];
  snapshot.playerNobles = [[...players[0].nobles] as NobleSlots, [...players[1].nobles] as NobleSlots];
  snapshot.purchasedCounts = [[...players[0].bonuses] as BonusVec, [...players[1].bonuses] as BonusVec];
  snapshot.playerGems = [[...players[0].gems] as PaymentVec, [...players[1].gems] as PaymentVec];
  snapshot.playerPoints = [players[0].points, players[1].points];
  snapshot.playerNames = [players[0].name, players[1].name];
  snapshot.currentPlayer = Number.parseInt(sections[sections.length - 1], 10) === 1 ? 1 : 0;
  return snapshot;
}

function deriveBank(snapshot: PositionSnapshot): PaymentVec {
  return DEFAULT_BANK.map((value, index) => (
    value - snapshot.playerGems[0][index] - snapshot.playerGems[1][index]
  )) as PaymentVec;
}

function findVisible(snapshot: PositionSnapshot, cardId: number): { level: number; slot: number } | null {
  for (let level = 0; level < 3; level += 1) {
    const slot = snapshot.visibleCards[level].indexOf(cardId);
    if (slot >= 0) return { level, slot };
  }
  return null;
}

function revealCard(comment: string): number | null {
  const match = comment.match(/(?:^|\s)reveal:C(\d+)(?:\s|$)/u);
  return match ? Number.parseInt(match[1], 10) : null;
}

function applyMove(snapshot: PositionSnapshot, move: MateKifuMove, nextPlayer: 0 | 1): PositionSnapshot {
  const next = cloneSnapshot(snapshot);
  const player = move.player;
  next.currentPlayer = player;
  const reveal = revealCard(move.comment);
  const returnMatch = move.usi.match(/\/return:([WUGRKD]+)/u);
  const returns = parseLetters(returnMatch?.[1]);

  const takeMatch = move.usi.match(/^take:([WUGRKD]+)/u);
  if (takeMatch) {
    const take = parseLetters(takeMatch[1]);
    next.playerGems[player] = next.playerGems[player].map((value, index) => value + take[index] - returns[index]) as PaymentVec;
  } else {
    const reserveVisible = move.usi.match(/^reserve:C(\d+)/u);
    const reserveDeck = move.usi.match(/^reserve:L([123])/u);
    const buy = move.usi.match(/^buy:C(\d+)(?:\/pay:([WUGRKD0-9]+))?/u);
    const noble = move.usi.match(/^noble:N(\d+)/u);

    if (reserveVisible) {
      const cardId = Number.parseInt(reserveVisible[1], 10);
      const visible = findVisible(next, cardId);
      const slot = next.reservedCards[player].indexOf(-1);
      if (!visible || slot < 0) throw new Error(`予約対象 C${cardId} を反映できません。`);
      if (deriveBank(next)[5] > 0) next.playerGems[player][5] += 1;
      next.playerGems[player] = next.playerGems[player].map((value, index) => value - returns[index]) as PaymentVec;
      next.reservedCards[player][slot] = cardId;
      next.visibleCards[visible.level][visible.slot] = reveal ?? -1;
    } else if (reserveDeck) {
      const slot = next.reservedCards[player].indexOf(-1);
      if (slot < 0 || reveal === null) throw new Error('山札予約には reveal:C<id> 注釈が必要です。');
      if (deriveBank(next)[5] > 0) next.playerGems[player][5] += 1;
      next.playerGems[player] = next.playerGems[player].map((value, index) => value - returns[index]) as PaymentVec;
      next.reservedCards[player][slot] = reveal;
    } else if (buy) {
      const cardId = Number.parseInt(buy[1], 10);
      const card = cardById.get(cardId);
      if (!card) throw new Error(`カード C${cardId} が見つかりません。`);
      const payment = parseCounts(buy[2] ?? '', 6) as PaymentVec;
      next.playerGems[player] = next.playerGems[player].map((value, index) => value - payment[index]) as PaymentVec;
      const reservedSlot = next.reservedCards[player].indexOf(cardId);
      const visible = findVisible(next, cardId);
      if (reservedSlot >= 0) next.reservedCards[player][reservedSlot] = -1;
      else if (visible) next.visibleCards[visible.level][visible.slot] = reveal ?? -1;
      else throw new Error(`購入対象 C${cardId} が見つかりません。`);
      next.purchasedCounts[player][card.bonus as 0 | 1 | 2 | 3 | 4] += 1;
      next.playerPoints[player] += card.points;
    } else if (noble) {
      const nobleId = Number.parseInt(noble[1], 10);
      const nobleData = nobleById.get(nobleId);
      const boardSlot = next.boardNobles.indexOf(nobleId);
      const playerSlot = next.playerNobles[player].indexOf(-1);
      if (!nobleData || boardSlot < 0 || playerSlot < 0) throw new Error(`貴族 N${nobleId} を反映できません。`);
      next.boardNobles[boardSlot] = -1;
      next.playerNobles[player][playerSlot] = nobleId;
      next.playerPoints[player] += nobleData.points;
    } else if (move.usi !== 'pass') {
      throw new Error(`未対応の指し手です: ${move.usi}`);
    }
  }

  next.currentPlayer = nextPlayer;
  return next;
}

export function parseMateKifu(text: string): MateKifuReplay {
  const headers: Record<string, string> = {};
  const moves: MateKifuMove[] = [];
  let position = '';
  let result = '';

  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const move = line.match(/^\d+\.\s+P([01])\s+(\S+)(?:\s+\[\d+\])?(?:\s+#\s*(.*))?$/u);
    if (move) {
      moves.push({ player: Number.parseInt(move[1], 10) as 0 | 1, usi: move[2], comment: move[3] ?? '' });
      continue;
    }
    const separator = line.indexOf(':');
    if (separator < 0) continue;
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1).trim();
    if (key === 'Position') position = value;
    else if (key === 'Result') result = value;
    else if (!['FinalScores', 'TotalTurns'].includes(key)) headers[key] = value;
  }

  if (!position) throw new Error('Position セクションがありません。');
  const snapshots = [parseSpn(position)];
  moves.forEach((move, index) => {
    const nextPlayer = moves[index + 1]?.player ?? (move.player === 0 ? 1 : 0);
    snapshots.push(applyMove(snapshots[snapshots.length - 1], move, nextPlayer));
  });
  return { headers, result, moves, snapshots };
}
