'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Copy, FileText, FolderOpen, Play, RotateCcw, Save, Undo2, X } from 'lucide-react';
import Header from '@/components/layout/Header';
import Card from '@/components/board/Card';
import Noble from '@/components/board/Noble';
import GameBoard from '@/components/board/GameBoard';
import { CARDS, NOBLES } from '@/constants/gameData';
import { CardData, GameState, GemType, NobleData, PlayerState } from '@/types/game';
import {
  buildSavedPositionPath,
  CANONICAL_EDITOR_PATH,
  type BonusVec,
  type NobleSlots,
  type PaymentVec,
  type PositionSnapshot,
  type SavedPosition,
  DEFAULT_PLAYER_NAMES,
  DEFAULT_SNAPSHOT,
  decodeSnapshotFromShareToken,
  sanitizeSnapshot,
  SHARE_PARAM_KEY,
} from '@/lib/positionSnapshot';
import { parseMateKifu, parsePositionSnapshot, type MateKifuReplay } from '@/lib/mateKifu';
import {
  applyStrategyEdge,
  applyStrategyDeckCounts,
  edgeMatchesBoardTarget,
  mergeLazyMateFrontier,
  parseMateStrategy,
  strategyEdgeLabel,
  strategyEdgeOutcomeLabel,
  type MateStrategyEdge,
  type MateStrategyReplay,
  type MateStrategyStep,
} from '@/lib/mateStrategy';

type Tier = 1 | 2 | 3;
type VisibleSlot = 0 | 1 | 2 | 3;
type BoardNobleSlot = 0 | 1 | 2;
type ReservedSlot = 0 | 1 | 2;
type PlayerNobleSlot = 0 | 1 | 2;
type PlayerIndex = 0 | 1;
type BonusColor = 0 | 1 | 2 | 3 | 4;
type CountEditorTarget =
  | { kind: 'gem'; player: PlayerIndex; index: 0 | 1 | 2 | 3 | 4 | 5 }
  | { kind: 'purchased'; player: PlayerIndex; index: 0 | 1 | 2 | 3 | 4 }
  | { kind: 'points'; player: PlayerIndex };

type PickerTarget =
  | { kind: 'visible'; level: Tier; slot: VisibleSlot }
  | { kind: 'reserved'; player: PlayerIndex; slot: ReservedSlot; level?: Tier };

type NoblePickerTarget =
  | { kind: 'board'; slot: BoardNobleSlot }
  | { kind: 'player'; player: PlayerIndex; slot: PlayerNobleSlot };

type StorageDialogMode = 'save' | 'load' | null;
type MateReplayMode = 'auto' | 'select';
type AnalysisActionMode =
  | 'idle'
  | 'take_gems'
  | 'card_selected'
  | 'deck_selected'
  | 'select_payment'
  | 'return_gems'
  | 'select_reveal'
  | 'select_noble';

type PendingOverflowAction =
  | {
      kind: 'take_gems';
      take: PaymentVec;
      gain: PaymentVec;
      excess: number;
    }
  | {
      kind: 'reserve_visible';
      cardId: number;
      level: Tier;
      slot: VisibleSlot;
      gain: PaymentVec;
      excess: number;
    }
  | {
      kind: 'reserve_deck';
      level: Tier;
      gain: PaymentVec;
      excess: number;
    };

type PendingRevealAction =
  | {
      kind: 'replace_visible';
      level: Tier;
      slot: VisibleSlot;
      moveLabel: string;
      checkNoble: boolean;
    }
  | {
      kind: 'reserve_deck';
      level: Tier;
      slot: ReservedSlot;
      moveLabel: string;
    };

type PendingNobleChoice = {
  player: PlayerIndex;
  eligibleIds: number[];
  moveLabel: string;
};

type AnalysisPosition = {
  snapshot: PositionSnapshot;
  blockedCardIds: number[];
};

type InitialEditorData = {
  snapshot: PositionSnapshot;
  status: string;
  legacyShareToken: string | null;
};

type PositionEditorClientProps = {
  initialSavedPosition?: SavedPosition | null;
};

const DEFAULT_BANK: PaymentVec = [4, 4, 4, 4, 4, 5];
const GEM_LABELS = ['白', '青', '緑', '赤', '黒', '金'] as const;
const CARD_BY_ID = new Map(CARDS.map((card) => [card.id, card] as const));

function zeroGems(): PaymentVec {
  return [0, 0, 0, 0, 0, 0];
}

function parseSavedPosition(raw: unknown): SavedPosition | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const candidate = raw as {
    id?: unknown;
    name?: unknown;
    savedAt?: unknown;
    snapshot?: unknown;
  };

  if (typeof candidate.id !== 'string' || !candidate.id.trim()) {
    return null;
  }

  return {
    id: candidate.id,
    name: typeof candidate.name === 'string' && candidate.name.trim()
      ? candidate.name.trim().slice(0, 80)
      : '無題の局面',
    savedAt: typeof candidate.savedAt === 'string' ? candidate.savedAt : new Date(0).toISOString(),
    snapshot: sanitizeSnapshot(candidate.snapshot),
  };
}

function mergeSavedPositions(entries: SavedPosition[], nextEntry: SavedPosition): SavedPosition[] {
  return [nextEntry, ...entries.filter((entry) => entry.id !== nextEntry.id)]
    .sort((left, right) => right.savedAt.localeCompare(left.savedAt));
}

function parseSavedPositionList(raw: unknown): SavedPosition[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((entry) => parseSavedPosition(entry))
    .filter((entry): entry is SavedPosition => entry !== null);
}

function readInitialEditorData(initialSavedPosition: SavedPosition | null | undefined): InitialEditorData {
  if (initialSavedPosition) {
    return {
      snapshot: initialSavedPosition.snapshot,
      status: '',
      legacyShareToken: null,
    };
  }

  if (typeof window === 'undefined') {
    return {
      snapshot: DEFAULT_SNAPSHOT,
      status: '',
      legacyShareToken: null,
    };
  }

  const token = new URL(window.location.href).searchParams.get(SHARE_PARAM_KEY);
  if (!token) {
    return {
      snapshot: DEFAULT_SNAPSHOT,
      status: '',
      legacyShareToken: null,
    };
  }

  try {
    return {
      snapshot: decodeSnapshotFromShareToken(token),
      status: '',
      legacyShareToken: token,
    };
  } catch {
    return {
      snapshot: DEFAULT_SNAPSHOT,
      status: '旧形式の共有URLを読込めませんでした。',
      legacyShareToken: null,
    };
  }
}

function levelFromCardId(cardId: number): Tier {
  if (cardId <= 39) return 1;
  if (cardId <= 69) return 2;
  return 3;
}

function cloneSnapshot(snapshot: PositionSnapshot): PositionSnapshot {
  return {
    visibleCards: snapshot.visibleCards.map((row) => [...row]),
    boardNobles: [...snapshot.boardNobles] as NobleSlots,
    reservedCards: [
      [...snapshot.reservedCards[0]],
      [...snapshot.reservedCards[1]],
    ],
    playerNobles: [
      [...snapshot.playerNobles[0]] as NobleSlots,
      [...snapshot.playerNobles[1]] as NobleSlots,
    ],
    purchasedCounts: [
      [...snapshot.purchasedCounts[0]] as BonusVec,
      [...snapshot.purchasedCounts[1]] as BonusVec,
    ],
    purchasedCardIds: [
      [...snapshot.purchasedCardIds[0]],
      [...snapshot.purchasedCardIds[1]],
    ],
    playerGems: [
      [...snapshot.playerGems[0]] as PaymentVec,
      [...snapshot.playerGems[1]] as PaymentVec,
    ],
    playerPoints: [...snapshot.playerPoints] as [number, number],
    playerNames: [...snapshot.playerNames] as [string, string],
    currentPlayer: snapshot.currentPlayer,
    annotationArrows: snapshot.annotationArrows.map((arrow) => ({ ...arrow })),
  };
}

function cloneAnalysisPosition(position: AnalysisPosition): AnalysisPosition {
  return {
    snapshot: cloneSnapshot(position.snapshot),
    blockedCardIds: [...position.blockedCardIds],
  };
}

function parseCount(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 0) return 0;
  return parsed;
}

function countsToGemToken(counts: PaymentVec): string {
  return `W${counts[0]}U${counts[1]}G${counts[2]}R${counts[3]}K${counts[4]}D${counts[5]}`;
}

function countsToBonusToken(counts: BonusVec): string {
  return `W${counts[0]}U${counts[1]}G${counts[2]}R${counts[3]}K${counts[4]}`;
}

function deriveBank(playerGems: [PaymentVec, PaymentVec]): PaymentVec {
  const next = [...DEFAULT_BANK] as PaymentVec;
  for (let i = 0; i < 6; i += 1) {
    next[i] -= playerGems[0][i] + playerGems[1][i];
  }
  return next;
}

function countTotalGems(gems: PaymentVec): number {
  return gems.reduce((sum, value) => sum + value, 0);
}

function buildTakeCounts(selectedGems: GemType[]): PaymentVec {
  const counts = zeroGems();
  selectedGems.forEach((gem) => {
    counts[gem] += 1;
  });
  return counts;
}

function countsToLetters(counts: PaymentVec): string {
  const labels = ['W', 'U', 'G', 'R', 'K', 'D'] as const;
  let out = '';
  for (let index = 0; index < labels.length; index += 1) {
    out += labels[index].repeat(counts[index]);
  }
  return out;
}

function toTakeUsi(take: PaymentVec, returns: PaymentVec): string {
  const out = countsToLetters(take);
  const ret = countsToLetters(returns);
  if (ret) return `take:${out}/return:${ret}`;
  return `take:${out}`;
}

function withReturnSuffix(base: string, returns: PaymentVec): string {
  const ret = countsToLetters(returns);
  if (!ret) return base;
  return `${base}/return:${ret}`;
}

function payToToken(pay: PaymentVec): string {
  return `W${pay[0]}U${pay[1]}G${pay[2]}R${pay[3]}K${pay[4]}D${pay[5]}`;
}

function vectorEquals(a: PaymentVec, b: PaymentVec): boolean {
  return a.every((value, index) => value === b[index]);
}

function vectorDistance(a: PaymentVec, b: PaymentVec, skipIndex?: number): number {
  return a.reduce((sum, value, index) => {
    if (index === skipIndex) return sum;
    return sum + Math.abs(value - b[index]);
  }, 0);
}

function buildUsedCardSet(snapshot: PositionSnapshot, blockedCardIds: number[] = []): Set<number> {
  const used = new Set<number>();
  blockedCardIds.forEach((cardId) => {
    if (cardId >= 0) used.add(cardId);
  });
  snapshot.visibleCards.flat().forEach((cardId) => {
    if (cardId >= 0) used.add(cardId);
  });
  snapshot.reservedCards.flat().forEach((cardId) => {
    if (cardId >= 0) used.add(cardId);
  });
  return used;
}

function findVisibleSlot(snapshot: PositionSnapshot, cardId: number): { level: Tier; slot: VisibleSlot } | null {
  for (let level = 0; level < 3; level += 1) {
    for (let slot = 0; slot < 4; slot += 1) {
      if (snapshot.visibleCards[level][slot] === cardId) {
        return { level: (level + 1) as Tier, slot: slot as VisibleSlot };
      }
    }
  }
  return null;
}

function findReservedSlot(snapshot: PositionSnapshot, player: PlayerIndex, cardId: number): ReservedSlot | null {
  for (let slot = 0; slot < 3; slot += 1) {
    if (snapshot.reservedCards[player][slot] === cardId) {
      return slot as ReservedSlot;
    }
  }
  return null;
}

function findEmptyReservedSlot(snapshot: PositionSnapshot, player: PlayerIndex): ReservedSlot | null {
  for (let slot = 0; slot < 3; slot += 1) {
    if (snapshot.reservedCards[player][slot] < 0) {
      return slot as ReservedSlot;
    }
  }
  return null;
}

function findBoardNobleSlot(snapshot: PositionSnapshot, nobleId: number): BoardNobleSlot | null {
  for (let slot = 0; slot < 3; slot += 1) {
    if (snapshot.boardNobles[slot] === nobleId) {
      return slot as BoardNobleSlot;
    }
  }
  return null;
}

function findEmptyPlayerNobleSlot(snapshot: PositionSnapshot, player: PlayerIndex): PlayerNobleSlot | null {
  for (let slot = 0; slot < 3; slot += 1) {
    if (snapshot.playerNobles[player][slot] < 0) {
      return slot as PlayerNobleSlot;
    }
  }
  return null;
}

function generatePaymentOptions(
  card: CardData,
  bonuses: BonusVec,
  playerGems: PaymentVec,
): PaymentVec[] {
  const required = card.cost.map((cost, index) => Math.max(0, cost - bonuses[index])) as [number, number, number, number, number];
  const options: PaymentVec[] = [];
  const seen = new Set<string>();
  const colorPay = [0, 0, 0, 0, 0];

  const dfs = (index: number, usedGold: number) => {
    if (index === 5) {
      if (usedGold > playerGems[5]) return;
      const option: PaymentVec = [colorPay[0], colorPay[1], colorPay[2], colorPay[3], colorPay[4], usedGold];
      const key = option.join(',');
      if (!seen.has(key)) {
        seen.add(key);
        options.push(option);
      }
      return;
    }

    const need = required[index];
    const minColored = Math.max(0, need - (playerGems[5] - usedGold));
    const maxColored = Math.min(need, playerGems[index as GemType]);

    for (let colored = minColored; colored <= maxColored; colored += 1) {
      const goldForColor = need - colored;
      if (usedGold + goldForColor > playerGems[5]) continue;
      colorPay[index] = colored;
      dfs(index + 1, usedGold + goldForColor);
    }
  };

  dfs(0, 0);

  return options.sort((left, right) => {
    if (left[5] !== right[5]) return left[5] - right[5];
    const leftSum = left.reduce((sum, value) => sum + value, 0);
    const rightSum = right.reduce((sum, value) => sum + value, 0);
    if (leftSum !== rightSum) return leftSum - rightSum;
    return left.join(',').localeCompare(right.join(','));
  });
}

function canClaimNoble(noble: NobleData, bonuses: BonusVec): boolean {
  return noble.requirement.every((cost, index) => bonuses[index] >= cost);
}

function buildDeckCounts(visible: number[][], reservedByPlayer: number[][]): [number, number, number] {
  const usedByTier = [0, 0, 0];

  visible.flat().forEach((cid) => {
    if (cid < 0) return;
    usedByTier[levelFromCardId(cid) - 1] += 1;
  });

  reservedByPlayer.flat().forEach((cid) => {
    if (cid < 0) return;
    usedByTier[levelFromCardId(cid) - 1] += 1;
  });

  return [
    Math.max(0, 40 - usedByTier[0]),
    Math.max(0, 30 - usedByTier[1]),
    Math.max(0, 20 - usedByTier[2]),
  ];
}

function createPlayer(
  index: PlayerIndex,
  gems: PaymentVec,
  bonuses: BonusVec,
  points: number,
  reserved: number[],
  nobles: number[],
): PlayerState {
  return {
    index,
    gems,
    bonuses,
    points,
    reserved_cards: reserved,
    purchased_cards: [],
    acquired_nobles: nobles,
  };
}

function buildBlankPurchasedCards(player: PlayerIndex, counts: BonusVec): CardData[] {
  const cards: CardData[] = [];

  counts.forEach((count, color) => {
    for (let i = 0; i < count; i += 1) {
      cards.push({
        id: -1 * (player * 100 + color * 10 + i + 1),
        level: 1,
        points: 0,
        bonus: color as BonusColor,
        cost: [0, 0, 0, 0, 0],
      });
    }
  });

  return cards;
}

function buildPurchasedCards(player: PlayerIndex, counts: BonusVec, cardIds: number[]): CardData[] {
  const cards = cardIds.flatMap((cardId) => {
    const card = CARD_BY_ID.get(cardId);
    return card ? [card] : [];
  });
  const remaining = [...counts] as BonusVec;
  cards.forEach((card) => {
    remaining[card.bonus as BonusColor] = Math.max(0, remaining[card.bonus as BonusColor] - 1);
  });
  return [...cards, ...buildBlankPurchasedCards(player, remaining)];
}

function formatBought(counts: BonusVec, cardIds: number[]): string {
  const total = counts.reduce((sum, value) => sum + value, 0);
  const known = cardIds.filter((cardId) => cardId >= 0).map((cardId) => String(cardId));
  const unknown = Array.from({ length: Math.max(0, total - known.length) }, () => '_');
  return [...known, ...unknown].join(',');
}

function formatSlotIds(ids: number[]): string {
  return ids.map((id) => (id >= 0 ? String(id) : '-')).join(',');
}

function buildAutomaticPositionName(): string {
  return `局面 ${new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date())}`;
}

function extractErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export default function PositionEditorClient({
  initialSavedPosition = null,
}: PositionEditorClientProps) {
  const [initialEditorData] = useState(() => readInitialEditorData(initialSavedPosition));
  const [visibleCards, setVisibleCards] = useState<number[][]>(initialEditorData.snapshot.visibleCards.map((row) => [...row]));
  const [boardNobles, setBoardNobles] = useState<NobleSlots>([...initialEditorData.snapshot.boardNobles] as NobleSlots);
  const [reservedCards, setReservedCards] = useState<[number[], number[]]>([
    [...initialEditorData.snapshot.reservedCards[0]],
    [...initialEditorData.snapshot.reservedCards[1]],
  ]);
  const [playerNobles, setPlayerNobles] = useState<[NobleSlots, NobleSlots]>([
    [...initialEditorData.snapshot.playerNobles[0]] as NobleSlots,
    [...initialEditorData.snapshot.playerNobles[1]] as NobleSlots,
  ]);
  const [purchasedCounts, setPurchasedCounts] = useState<[BonusVec, BonusVec]>([
    [...initialEditorData.snapshot.purchasedCounts[0]] as BonusVec,
    [...initialEditorData.snapshot.purchasedCounts[1]] as BonusVec,
  ]);
  const [purchasedCardIds, setPurchasedCardIds] = useState<[number[], number[]]>([
    [...initialEditorData.snapshot.purchasedCardIds[0]],
    [...initialEditorData.snapshot.purchasedCardIds[1]],
  ]);
  const [playerGems, setPlayerGems] = useState<[PaymentVec, PaymentVec]>([
    [...initialEditorData.snapshot.playerGems[0]] as PaymentVec,
    [...initialEditorData.snapshot.playerGems[1]] as PaymentVec,
  ]);
  const [playerPoints, setPlayerPoints] = useState<[number, number]>([...initialEditorData.snapshot.playerPoints] as [number, number]);
  const [playerNames, setPlayerNames] = useState<[string, string]>([...initialEditorData.snapshot.playerNames] as [string, string]);
  const [currentPlayer, setCurrentPlayer] = useState<PlayerIndex>(initialEditorData.snapshot.currentPlayer);
  const [annotationArrows, setAnnotationArrows] = useState(initialEditorData.snapshot.annotationArrows.map((arrow) => ({ ...arrow })));
  const [pickerTarget, setPickerTarget] = useState<PickerTarget | null>(null);
  const [noblePickerTarget, setNoblePickerTarget] = useState<NoblePickerTarget | null>(null);
  const [countEditorTarget, setCountEditorTarget] = useState<CountEditorTarget | null>(null);
  const [countEditorValue, setCountEditorValue] = useState('0');
  const [nameEditorTarget, setNameEditorTarget] = useState<PlayerIndex | null>(null);
  const [nameEditorValue, setNameEditorValue] = useState('');
  const [saveName, setSaveName] = useState(initialSavedPosition?.name ?? '');
  const [savedPositions, setSavedPositions] = useState<SavedPosition[]>(initialSavedPosition ? [initialSavedPosition] : []);
  const [savedPositionsLoading, setSavedPositionsLoading] = useState(false);
  const [storageStatus, setStorageStatus] = useState(initialEditorData.status);
  const [storageDialogMode, setStorageDialogMode] = useState<StorageDialogMode>(null);
  const [remoteBusy, setRemoteBusy] = useState(false);
  const [currentSavedPositionId, setCurrentSavedPositionId] = useState<string | null>(initialSavedPosition?.id ?? null);
  const [persistedSnapshotKey, setPersistedSnapshotKey] = useState<string | null>(
    initialSavedPosition ? JSON.stringify(initialSavedPosition.snapshot) : null,
  );
  const [legacyShareToken] = useState<string | null>(initialEditorData.legacyShareToken);
  const [legacySnapshotKey] = useState<string | null>(
    initialEditorData.legacyShareToken ? JSON.stringify(initialEditorData.snapshot) : null,
  );
  const [analysisPosition, setAnalysisPosition] = useState<AnalysisPosition | null>(null);
  const [analysisTimeline, setAnalysisTimeline] = useState<AnalysisPosition[]>([]);
  const [analysisMoves, setAnalysisMoves] = useState<string[]>([]);
  const [analysisMode, setAnalysisMode] = useState<AnalysisActionMode>('idle');
  const [analysisStatus, setAnalysisStatus] = useState('');
  const [analysisSelectedGems, setAnalysisSelectedGems] = useState<GemType[]>([]);
  const [analysisSelectedCardId, setAnalysisSelectedCardId] = useState<number | null>(null);
  const [analysisSelectedCardSource, setAnalysisSelectedCardSource] = useState<'visible' | 'reserved' | null>(null);
  const [analysisSelectedVisibleSlot, setAnalysisSelectedVisibleSlot] = useState<{ level: Tier; slot: VisibleSlot } | null>(null);
  const [analysisSelectedDeckLevel, setAnalysisSelectedDeckLevel] = useState<Tier | null>(null);
  const [analysisPaymentOptions, setAnalysisPaymentOptions] = useState<PaymentVec[]>([]);
  const [analysisPayingGems, setAnalysisPayingGems] = useState<PaymentVec>(zeroGems());
  const [pendingOverflow, setPendingOverflow] = useState<PendingOverflowAction | null>(null);
  const [analysisReturningGems, setAnalysisReturningGems] = useState<PaymentVec>(zeroGems());
  const [pendingReveal, setPendingReveal] = useState<PendingRevealAction | null>(null);
  const [pendingNobleChoice, setPendingNobleChoice] = useState<PendingNobleChoice | null>(null);
  const [mateReplay, setMateReplay] = useState<MateKifuReplay | null>(null);
  const [mateReplayStep, setMateReplayStep] = useState(0);
  const [mateKifuDialogOpen, setMateKifuDialogOpen] = useState(false);
  const [mateKifuText, setMateKifuText] = useState('');
  const [mateStrategyText, setMateStrategyText] = useState('');
  const [mateStrategy, setMateStrategy] = useState<MateStrategyReplay | null>(null);
  const [mateStrategyMode, setMateStrategyMode] = useState<MateReplayMode>('auto');
  const [mateStrategySteps, setMateStrategySteps] = useState<MateStrategyStep[]>([]);
  const [mateStrategyChoices, setMateStrategyChoices] = useState<MateStrategyEdge[]>([]);
  const [mateStrategyLoadingNodeId, setMateStrategyLoadingNodeId] = useState<number | null>(null);
  const [mateStrategyFailedNodeId, setMateStrategyFailedNodeId] = useState<number | null>(null);
  const [mateStrategyExpansionError, setMateStrategyExpansionError] = useState('');
  const [positionTextDraft, setPositionTextDraft] = useState<string | null>(null);
  const [positionTextError, setPositionTextError] = useState('');

  const candidateCardsByLevel = useMemo<Record<Tier, CardData[]>>(() => ({
    1: CARDS.filter((card) => card.level === 1),
    2: CARDS.filter((card) => card.level === 2),
    3: CARDS.filter((card) => card.level === 3),
  }), []);
  const cardById = useMemo(() => new Map(CARDS.map((card) => [card.id, card] as const)), []);
  const nobleById = useMemo(() => new Map(NOBLES.map((noble) => [noble.id, noble] as const)), []);

  const editorSnapshot = useMemo<PositionSnapshot>(() => ({
    visibleCards: visibleCards.map((row) => [...row]),
    boardNobles: [...boardNobles] as NobleSlots,
    reservedCards: [
      [...reservedCards[0]],
      [...reservedCards[1]],
    ],
    playerNobles: [
      [...playerNobles[0]] as NobleSlots,
      [...playerNobles[1]] as NobleSlots,
    ],
    purchasedCounts: [
      [...purchasedCounts[0]] as BonusVec,
      [...purchasedCounts[1]] as BonusVec,
    ],
    purchasedCardIds: [
      [...purchasedCardIds[0]],
      [...purchasedCardIds[1]],
    ],
    playerGems: [
      [...playerGems[0]] as PaymentVec,
      [...playerGems[1]] as PaymentVec,
    ],
    playerPoints: [...playerPoints] as [number, number],
    playerNames: [...playerNames] as [string, string],
    currentPlayer,
    annotationArrows: annotationArrows.map((arrow) => ({ ...arrow })),
  }), [annotationArrows, boardNobles, currentPlayer, playerGems, playerNames, playerNobles, playerPoints, purchasedCardIds, purchasedCounts, reservedCards, visibleCards]);

  const activeSnapshot = useMemo<PositionSnapshot>(() => {
    const source = mateStrategySteps.at(-1)?.snapshot ?? mateReplay?.snapshots[mateReplayStep] ?? analysisPosition?.snapshot ?? editorSnapshot;
    return {
      ...cloneSnapshot(source),
      annotationArrows: annotationArrows.map((arrow) => ({ ...arrow })),
    };
  }, [analysisPosition, annotationArrows, editorSnapshot, mateReplay, mateReplayStep, mateStrategySteps]);
  const activeBlockedCardIds = useMemo(
    () => analysisPosition?.blockedCardIds ?? [],
    [analysisPosition],
  );
  const activeDeckCounts = useMemo(
    () => mateStrategySteps.at(-1)?.deckCounts ?? buildDeckCounts(activeSnapshot.visibleCards, activeSnapshot.reservedCards),
    [activeSnapshot, mateStrategySteps],
  );

  const editorUsedCards = useMemo(() => buildUsedCardSet(editorSnapshot), [editorSnapshot]);
  const analysisUsedCards = useMemo(
    () => buildUsedCardSet(activeSnapshot, activeBlockedCardIds),
    [activeBlockedCardIds, activeSnapshot],
  );

  const usedNobles = useMemo(() => {
    const used = new Set<number>();
    boardNobles.forEach((nobleId) => {
      if (nobleId >= 0) used.add(nobleId);
    });
    playerNobles.flat().forEach((nobleId) => {
      if (nobleId >= 0) used.add(nobleId);
    });
    return used;
  }, [boardNobles, playerNobles]);

  const bank = useMemo<PaymentVec>(() => deriveBank(activeSnapshot.playerGems), [activeSnapshot]);

  const bankErrors = useMemo(() => {
    return bank
      .map((count, idx) => (count < 0 ? `${GEM_LABELS[idx]}トークンが ${Math.abs(count)} 枚超過しています。` : null))
      .filter((message): message is string => message !== null);
  }, [bank]);

  const purchasedCardOverrides = useMemo<[CardData[], CardData[]]>(() => ([
    buildPurchasedCards(0, activeSnapshot.purchasedCounts[0], activeSnapshot.purchasedCardIds[0]),
    buildPurchasedCards(1, activeSnapshot.purchasedCounts[1], activeSnapshot.purchasedCardIds[1]),
  ]), [activeSnapshot]);

  const displayState = useMemo<GameState>(() => ({
    board: {
      bank,
      visible_cards: activeSnapshot.visibleCards.map((row) => [...row]) as [number[], number[], number[]],
      deck_counts: activeDeckCounts,
      nobles: activeSnapshot.boardNobles.filter((nobleId) => nobleId >= 0),
      current_player: activeSnapshot.currentPlayer,
      turn: mateStrategy ? Math.max(0, mateStrategySteps.length - 1) : (mateReplay ? mateReplayStep : analysisMoves.length),
      waiting_noble: !!pendingNobleChoice,
      game_over: false,
      winner: -1,
    },
    players: [
      createPlayer(
        0,
        [...activeSnapshot.playerGems[0]] as PaymentVec,
        [...activeSnapshot.purchasedCounts[0]] as BonusVec,
        activeSnapshot.playerPoints[0],
        activeSnapshot.reservedCards[0].filter((id) => id >= 0),
        activeSnapshot.playerNobles[0].filter((id) => id >= 0),
      ),
      createPlayer(
        1,
        [...activeSnapshot.playerGems[1]] as PaymentVec,
        [...activeSnapshot.purchasedCounts[1]] as BonusVec,
        activeSnapshot.playerPoints[1],
        activeSnapshot.reservedCards[1].filter((id) => id >= 0),
        activeSnapshot.playerNobles[1].filter((id) => id >= 0),
      ),
    ],
    legal_actions: [],
  }), [activeDeckCounts, activeSnapshot, analysisMoves.length, bank, mateReplay, mateReplayStep, mateStrategy, mateStrategySteps.length, pendingNobleChoice]);

  const buildLevelMatrixRows = useCallback((level: Tier): Array<{ color: BonusColor; cards: (CardData | null)[] }> => {
    const byColor: Record<BonusColor, CardData[]> = {
      0: [],
      1: [],
      2: [],
      3: [],
      4: [],
    };

    candidateCardsByLevel[level].forEach((card) => {
      byColor[card.bonus as BonusColor].push(card);
    });

    ([0, 1, 2, 3, 4] as BonusColor[]).forEach((color) => {
      byColor[color].sort((a, b) => a.id - b.id);
    });

    const maxColumns = Math.max(...([0, 1, 2, 3, 4] as BonusColor[]).map((color) => byColor[color].length), 0);

    return ([0, 1, 2, 3, 4] as BonusColor[]).map((color) => ({
      color,
      cards: Array.from({ length: maxColumns }, (_, column) => byColor[color][column] ?? null),
    }));
  }, [candidateCardsByLevel]);

  const currentPickerCardId = useMemo(() => {
    if (!pickerTarget) return -1;
    if (pickerTarget.kind === 'visible') {
      return visibleCards[pickerTarget.level - 1][pickerTarget.slot];
    }
    return reservedCards[pickerTarget.player][pickerTarget.slot];
  }, [pickerTarget, reservedCards, visibleCards]);

  const currentPickerNobleId = useMemo(() => {
    if (!noblePickerTarget) return -1;
    if (noblePickerTarget.kind === 'board') {
      return boardNobles[noblePickerTarget.slot];
    }
    return playerNobles[noblePickerTarget.player][noblePickerTarget.slot];
  }, [boardNobles, noblePickerTarget, playerNobles]);

  const visiblePickerRows = useMemo(() => {
    if (!pickerTarget || pickerTarget.kind !== 'visible') return [] as Array<{ color: BonusColor; cards: (CardData | null)[] }>;
    return buildLevelMatrixRows(pickerTarget.level);
  }, [buildLevelMatrixRows, pickerTarget]);

  const reservedPickerRows = useMemo(() => {
    if (!pickerTarget || pickerTarget.kind !== 'reserved' || !pickerTarget.level) return [] as Array<{ color: BonusColor; cards: (CardData | null)[] }>;
    return buildLevelMatrixRows(pickerTarget.level);
  }, [buildLevelMatrixRows, pickerTarget]);

  const currentSnapshot = activeSnapshot;

  const currentSnapshotKey = useMemo(() => JSON.stringify(currentSnapshot), [currentSnapshot]);

  const positionSummary = useMemo(() => {
    const l1 = currentSnapshot.visibleCards[0].map((cardId) => (cardId >= 0 ? String(cardId) : '-')).join(',');
    const l2 = currentSnapshot.visibleCards[1].map((cardId) => (cardId >= 0 ? String(cardId) : '-')).join(',');
    const l3 = currentSnapshot.visibleCards[2].map((cardId) => (cardId >= 0 ? String(cardId) : '-')).join(',');
    const reserved0 = currentSnapshot.reservedCards[0].filter((cardId) => cardId >= 0).join(',');
    const reserved1 = currentSnapshot.reservedCards[1].filter((cardId) => cardId >= 0).join(',');

    return [
      `bank:${countsToGemToken(bank)}`,
      `visible:L1[${l1}]L2[${l2}]L3[${l3}]`,
      `decks:${activeDeckCounts.join(',')}`,
      `nobles:[${formatSlotIds(currentSnapshot.boardNobles)}]`,
      `P0:name:${currentSnapshot.playerNames[0]};gems:${countsToGemToken(currentSnapshot.playerGems[0])};bonuses:${countsToBonusToken(currentSnapshot.purchasedCounts[0])};points:${currentSnapshot.playerPoints[0]};nobles:[${formatSlotIds(currentSnapshot.playerNobles[0])}];reserved:[${reserved0}];bought:[${formatBought(currentSnapshot.purchasedCounts[0], currentSnapshot.purchasedCardIds[0])}]`,
      `P1:name:${currentSnapshot.playerNames[1]};gems:${countsToGemToken(currentSnapshot.playerGems[1])};bonuses:${countsToBonusToken(currentSnapshot.purchasedCounts[1])};points:${currentSnapshot.playerPoints[1]};nobles:[${formatSlotIds(currentSnapshot.playerNobles[1])}];reserved:[${reserved1}];bought:[${formatBought(currentSnapshot.purchasedCounts[1], currentSnapshot.purchasedCardIds[1])}]`,
      `${currentSnapshot.currentPlayer}`,
    ].join(' | ');
  }, [activeDeckCounts, bank, currentSnapshot]);

  const analysisRevealRows = useMemo(() => {
    if (!pendingReveal) return [] as Array<{ color: BonusColor; cards: (CardData | null)[] }>;
    return buildLevelMatrixRows(pendingReveal.level);
  }, [buildLevelMatrixRows, pendingReveal]);

  const analysisModeLabel =
    analysisMode === 'idle' ? '操作待ち' :
    analysisMode === 'take_gems' ? 'トークン取得' :
    analysisMode === 'card_selected' ? 'カード選択中' :
    analysisMode === 'deck_selected' ? '山札選択中' :
    analysisMode === 'select_payment' ? '支払い選択中' :
    analysisMode === 'return_gems' ? '返却トークン選択中' :
    analysisMode === 'select_reveal' ? '公開カード選択中' :
    '貴族選択中';

  const analysisReturnTarget = pendingOverflow?.excess ?? 0;
  const analysisReturnSelectedTotal = analysisReturningGems.reduce((sum, value) => sum + value, 0);

  const activeSavedPositionId = currentSavedPositionId && persistedSnapshotKey === currentSnapshotKey
    ? currentSavedPositionId
    : null;
  const activeLegacyShareToken = !activeSavedPositionId
    && legacyShareToken
    && legacySnapshotKey === currentSnapshotKey
    ? legacyShareToken
    : null;

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const nextUrl = new URL(
      activeSavedPositionId ? buildSavedPositionPath(activeSavedPositionId) : CANONICAL_EDITOR_PATH,
      window.location.origin,
    );

    if (activeLegacyShareToken) {
      nextUrl.searchParams.set(SHARE_PARAM_KEY, activeLegacyShareToken);
    }

    const nextRelative = `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
    const currentRelative = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (nextRelative !== currentRelative) {
      window.history.replaceState({}, '', nextRelative);
    }
  }, [activeLegacyShareToken, activeSavedPositionId]);

  const rememberSavedPosition = useCallback((entry: SavedPosition) => {
    setSavedPositions((prev) => mergeSavedPositions(prev, entry));
  }, []);

  const finalizeSavedPosition = useCallback((entry: SavedPosition) => {
    rememberSavedPosition(entry);
    setSaveName(entry.name);
    setCurrentSavedPositionId(entry.id);
    setPersistedSnapshotKey(JSON.stringify(entry.snapshot));
    return entry;
  }, [rememberSavedPosition]);

  const requestSavedPositions = useCallback(async (): Promise<SavedPosition[]> => {
    const response = await fetch('/api/positions', {
      cache: 'no-store',
    });

    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const message = payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string'
        ? payload.error
        : '局面一覧の取得に失敗しました。';
      throw new Error(message);
    }

    return parseSavedPositionList(payload);
  }, []);

  const refreshSavedPositions = useCallback(async () => {
    setSavedPositionsLoading(true);
    try {
      const entries = await requestSavedPositions();
      setSavedPositions((prev) => entries.reduce((merged, entry) => mergeSavedPositions(merged, entry), prev));
    } catch (error) {
      setStorageStatus(extractErrorMessage(error, '局面一覧の取得に失敗しました。'));
    } finally {
      setSavedPositionsLoading(false);
    }
  }, [requestSavedPositions]);

  useEffect(() => {
    void refreshSavedPositions();
  }, [refreshSavedPositions]);

  const resetAnalysisTransientState = useCallback((nextMode: AnalysisActionMode = 'idle') => {
    setAnalysisMode(nextMode);
    setAnalysisSelectedGems([]);
    setAnalysisSelectedCardId(null);
    setAnalysisSelectedCardSource(null);
    setAnalysisSelectedVisibleSlot(null);
    setAnalysisSelectedDeckLevel(null);
    setAnalysisPaymentOptions([]);
    setAnalysisPayingGems(zeroGems());
    setPendingOverflow(null);
    setAnalysisReturningGems(zeroGems());
  }, []);

  const exitAnalysisMode = useCallback((status?: string) => {
    setAnalysisPosition(null);
    setAnalysisTimeline([]);
    setAnalysisMoves([]);
    setPendingReveal(null);
    setPendingNobleChoice(null);
    resetAnalysisTransientState();
    setAnalysisStatus('');
    if (status) {
      setStorageStatus(status);
    }
  }, [resetAnalysisTransientState]);

  const commitAnalysisMove = useCallback((position: AnalysisPosition, moveLabel: string) => {
    const next = cloneAnalysisPosition(position);
    next.snapshot.currentPlayer = next.snapshot.currentPlayer === 0 ? 1 : 0;
    setAnalysisPosition(next);
    setAnalysisTimeline((prev) => [...prev, cloneAnalysisPosition(next)]);
    setAnalysisMoves((prev) => [...prev, moveLabel]);
    setPendingReveal(null);
    setPendingNobleChoice(null);
    resetAnalysisTransientState();
    setAnalysisStatus(`手を進めました: ${moveLabel}`);
  }, [resetAnalysisTransientState]);

  const awardAnalysisNoble = useCallback((position: AnalysisPosition, player: PlayerIndex, nobleId: number): AnalysisPosition | null => {
    const noble = nobleById.get(nobleId);
    const boardSlot = findBoardNobleSlot(position.snapshot, nobleId);
    const playerSlot = findEmptyPlayerNobleSlot(position.snapshot, player);
    if (!noble || boardSlot === null || playerSlot === null) {
      return null;
    }

    const next = cloneAnalysisPosition(position);
    next.snapshot.boardNobles[boardSlot] = -1;
    next.snapshot.playerNobles[player][playerSlot] = nobleId;
    next.snapshot.playerPoints[player] += noble.points;
    return next;
  }, [nobleById]);

  const maybeFinalizeAnalysisPurchase = useCallback((position: AnalysisPosition, player: PlayerIndex, moveLabel: string) => {
    const eligibleIds = position.snapshot.boardNobles
      .filter((nobleId) => nobleId >= 0)
      .filter((nobleId) => {
        const noble = nobleById.get(nobleId);
        return !!noble && canClaimNoble(noble, position.snapshot.purchasedCounts[player]);
      });

    if (eligibleIds.length === 0) {
      commitAnalysisMove(position, moveLabel);
      return;
    }

    if (eligibleIds.length === 1) {
      const next = awardAnalysisNoble(position, player, eligibleIds[0]);
      if (!next) {
        commitAnalysisMove(position, moveLabel);
        return;
      }
      commitAnalysisMove(next, `${moveLabel}/noble:N${eligibleIds[0]}`);
      return;
    }

    setAnalysisPosition(cloneAnalysisPosition(position));
    setPendingNobleChoice({
      player,
      eligibleIds,
      moveLabel,
    });
    resetAnalysisTransientState('select_noble');
    setAnalysisStatus('獲得する貴族を選択してください。');
  }, [awardAnalysisNoble, commitAnalysisMove, nobleById, resetAnalysisTransientState]);

  const startAnalysisRevealSelection = useCallback((
    position: AnalysisPosition,
    reveal: PendingRevealAction,
    status: string,
  ) => {
    setAnalysisPosition(cloneAnalysisPosition(position));
    setPendingNobleChoice(null);
    setPendingReveal(reveal);
    resetAnalysisTransientState('select_reveal');
    setAnalysisStatus(status);
  }, [resetAnalysisTransientState]);

  const applyAnalysisTakeAction = useCallback((take: PaymentVec, returns: PaymentVec) => {
    if (!analysisPosition) return;
    const next = cloneAnalysisPosition(analysisPosition);
    const player = next.snapshot.currentPlayer;

    for (let index = 0; index < 6; index += 1) {
      next.snapshot.playerGems[player][index] += take[index] - returns[index];
    }

    commitAnalysisMove(next, toTakeUsi(take, returns));
  }, [analysisPosition, commitAnalysisMove]);

  const applyAnalysisReserveVisibleAction = useCallback((cardId: number, level: Tier, slot: VisibleSlot, returns: PaymentVec) => {
    if (!analysisPosition) return;
    const next = cloneAnalysisPosition(analysisPosition);
    const player = next.snapshot.currentPlayer;
    const reservedSlot = findEmptyReservedSlot(next.snapshot, player);
    if (reservedSlot === null) {
      setAnalysisStatus('予約カードは3枚までです。');
      return;
    }

    const bankNow = deriveBank(next.snapshot.playerGems);
    if (bankNow[5] > 0) {
      next.snapshot.playerGems[player][5] += 1;
    }

    for (let index = 0; index < 6; index += 1) {
      next.snapshot.playerGems[player][index] -= returns[index];
    }

    next.snapshot.visibleCards[level - 1][slot] = -1;
    next.snapshot.reservedCards[player][reservedSlot] = cardId;

    startAnalysisRevealSelection(next, {
      kind: 'replace_visible',
      level,
      slot,
      moveLabel: withReturnSuffix(`reserve:C${cardId}`, returns),
      checkNoble: false,
    }, '公開カードを選択してください。');
  }, [analysisPosition, startAnalysisRevealSelection]);

  const applyAnalysisReserveDeckAction = useCallback((level: Tier, returns: PaymentVec) => {
    if (!analysisPosition) return;
    const next = cloneAnalysisPosition(analysisPosition);
    const player = next.snapshot.currentPlayer;
    const reservedSlot = findEmptyReservedSlot(next.snapshot, player);
    if (reservedSlot === null) {
      setAnalysisStatus('予約カードは3枚までです。');
      return;
    }

    const bankNow = deriveBank(next.snapshot.playerGems);
    if (bankNow[5] > 0) {
      next.snapshot.playerGems[player][5] += 1;
    }

    for (let index = 0; index < 6; index += 1) {
      next.snapshot.playerGems[player][index] -= returns[index];
    }

    startAnalysisRevealSelection(next, {
      kind: 'reserve_deck',
      level,
      slot: reservedSlot,
      moveLabel: withReturnSuffix(`reserve:L${level}`, returns),
    }, '山札カードを選択してください。');
  }, [analysisPosition, startAnalysisRevealSelection]);

  const applyAnalysisPurchaseAction = useCallback((
    cardId: number,
    source: 'visible' | 'reserved',
    payment: PaymentVec,
    visiblePos: { level: Tier; slot: VisibleSlot } | null,
  ) => {
    if (!analysisPosition) return;

    const card = cardById.get(cardId);
    if (!card) {
      setAnalysisStatus(`カードID ${cardId} が見つかりません。`);
      return;
    }

    const next = cloneAnalysisPosition(analysisPosition);
    const player = next.snapshot.currentPlayer;

    for (let index = 0; index < 6; index += 1) {
      if (next.snapshot.playerGems[player][index] < payment[index]) {
        setAnalysisStatus('支払いトークンが不足しています。');
        return;
      }
      next.snapshot.playerGems[player][index] -= payment[index];
    }

    if (source === 'reserved') {
      const reservedSlot = findReservedSlot(next.snapshot, player, cardId);
      if (reservedSlot === null) {
        setAnalysisStatus('対象の予約カードが見つかりません。');
        return;
      }
      next.snapshot.reservedCards[player][reservedSlot] = -1;
    }

    if (source === 'visible') {
      const pos = visiblePos ?? findVisibleSlot(next.snapshot, cardId);
      if (!pos) {
        setAnalysisStatus('対象の公開カード位置が見つかりません。');
        return;
      }
      next.snapshot.visibleCards[pos.level - 1][pos.slot] = -1;
    }

    next.snapshot.purchasedCounts[player][card.bonus as BonusColor] += 1;
    next.snapshot.purchasedCardIds[player].push(cardId);
    next.snapshot.playerPoints[player] += card.points;
    if (!next.blockedCardIds.includes(cardId)) {
      next.blockedCardIds.push(cardId);
    }

    const moveLabel = `buy:C${cardId}/pay:${payToToken(payment)}`;

    if (source === 'visible') {
      const pos = visiblePos ?? findVisibleSlot(analysisPosition.snapshot, cardId);
      if (!pos) {
        setAnalysisStatus('公開カード位置の取得に失敗しました。');
        return;
      }
      startAnalysisRevealSelection(next, {
        kind: 'replace_visible',
        level: pos.level,
        slot: pos.slot,
        moveLabel,
        checkNoble: true,
      }, '公開カードを選択してください。');
      return;
    }

    maybeFinalizeAnalysisPurchase(next, player, moveLabel);
  }, [analysisPosition, cardById, maybeFinalizeAnalysisPurchase, startAnalysisRevealSelection]);

  const enterAnalysisMode = useCallback(() => {
    const base: AnalysisPosition = {
      snapshot: cloneSnapshot(editorSnapshot),
      blockedCardIds: [],
    };
    setAnalysisPosition(base);
    setAnalysisTimeline([cloneAnalysisPosition(base)]);
    setAnalysisMoves([]);
    setPendingReveal(null);
    setPendingNobleChoice(null);
    setPickerTarget(null);
    setNoblePickerTarget(null);
    setCountEditorTarget(null);
    setNameEditorTarget(null);
    setStorageDialogMode(null);
    resetAnalysisTransientState();
    setAnalysisStatus('検討モードを開始しました。');
  }, [editorSnapshot, resetAnalysisTransientState]);

  const clearAnalysisActionState = useCallback(() => {
    if (!analysisPosition || pendingReveal || pendingNobleChoice) return;
    resetAnalysisTransientState();
    setAnalysisStatus('選択を解除しました。');
  }, [analysisPosition, pendingNobleChoice, pendingReveal, resetAnalysisTransientState]);

  const undoAnalysisMove = useCallback(() => {
    if (!analysisPosition || pendingReveal || pendingOverflow || pendingNobleChoice) return;
    if (analysisTimeline.length <= 1) return;

    const nextTimeline = analysisTimeline.slice(0, -1);
    const previous = nextTimeline[nextTimeline.length - 1];
    setAnalysisTimeline(nextTimeline);
    setAnalysisPosition(cloneAnalysisPosition(previous));
    setAnalysisMoves((prev) => prev.slice(0, -1));
    resetAnalysisTransientState();
    setPendingReveal(null);
    setPendingNobleChoice(null);
    setAnalysisStatus('1手戻しました。');
  }, [analysisPosition, analysisTimeline, pendingNobleChoice, pendingOverflow, pendingReveal, resetAnalysisTransientState]);

  const handleAnalysisBankGemClick = useCallback((type: GemType) => {
    if (!analysisPosition) return;
    if (pendingReveal || pendingNobleChoice || analysisMode === 'return_gems' || analysisMode === 'select_payment') return;
    if (type === 5) return;

    const player = analysisPosition.snapshot.playerGems[analysisPosition.snapshot.currentPlayer];
    const bankNow = deriveBank(analysisPosition.snapshot.playerGems);
    const count = analysisSelectedGems.filter((gem) => gem === type).length;
    const total = analysisSelectedGems.length;

    const removeOne = () => {
      const index = analysisSelectedGems.indexOf(type);
      if (index < 0) return;
      const next = [...analysisSelectedGems];
      next.splice(index, 1);
      setAnalysisSelectedGems(next);
      setAnalysisMode(next.length > 0 ? 'take_gems' : 'idle');
    };

    if (count === 0) {
      if (total >= 3) return;
      if (bankNow[type] <= 0) return;
      setAnalysisSelectedGems((prev) => [...prev, type]);
      setAnalysisMode('take_gems');
      setAnalysisSelectedCardId(null);
      setAnalysisSelectedCardSource(null);
      setAnalysisSelectedVisibleSlot(null);
      setAnalysisSelectedDeckLevel(null);
      setAnalysisPaymentOptions([]);
      setAnalysisPayingGems(zeroGems());
      return;
    }

    if (count === 1) {
      if (total === 1 && bankNow[type] >= 4 && player[type] + 2 <= 10) {
        setAnalysisSelectedGems((prev) => [...prev, type]);
        setAnalysisMode('take_gems');
      } else {
        removeOne();
      }
      return;
    }

    removeOne();
  }, [analysisMode, analysisPosition, analysisSelectedGems, pendingNobleChoice, pendingReveal]);

  const selectAnalysisCardForAction = useCallback((cardId: number, source: 'visible' | 'reserved') => {
    if (!analysisPosition || pendingReveal || pendingOverflow || pendingNobleChoice) return;

    const card = cardById.get(cardId);
    if (!card) {
      setAnalysisStatus(`カードID ${cardId} が見つかりません。`);
      return;
    }

    const player = analysisPosition.snapshot.currentPlayer;
    if (source === 'reserved') {
      const reservedSlot = findReservedSlot(analysisPosition.snapshot, player, cardId);
      if (reservedSlot === null) {
        setAnalysisStatus(`P${player} の予約カードのみ購入できます。`);
        return;
      }
    }

    const visiblePos = source === 'visible' ? findVisibleSlot(analysisPosition.snapshot, cardId) : null;
    if (source === 'visible' && !visiblePos) {
      setAnalysisStatus('公開カード位置が見つかりません。');
      return;
    }

    const options = generatePaymentOptions(
      card,
      analysisPosition.snapshot.purchasedCounts[player],
      analysisPosition.snapshot.playerGems[player],
    );

    setAnalysisSelectedCardId(cardId);
    setAnalysisSelectedCardSource(source);
    setAnalysisSelectedVisibleSlot(visiblePos);
    setAnalysisSelectedDeckLevel(null);
    setAnalysisSelectedGems([]);
    setPendingOverflow(null);
    setAnalysisReturningGems(zeroGems());
    setAnalysisPaymentOptions(options);

    if (options.length > 0) {
      setAnalysisPayingGems(options[0]);
      setAnalysisMode('select_payment');
    } else {
      setAnalysisPayingGems(zeroGems());
      setAnalysisMode('card_selected');
    }
  }, [analysisPosition, cardById, pendingNobleChoice, pendingOverflow, pendingReveal]);

  const selectAnalysisDeckForAction = useCallback((level: Tier) => {
    if (!analysisPosition || pendingReveal || pendingOverflow || pendingNobleChoice) return;
    setAnalysisSelectedDeckLevel(level);
    setAnalysisSelectedCardId(null);
    setAnalysisSelectedCardSource(null);
    setAnalysisSelectedVisibleSlot(null);
    setAnalysisSelectedGems([]);
    setAnalysisPaymentOptions([]);
    setAnalysisPayingGems(zeroGems());
    setPendingOverflow(null);
    setAnalysisReturningGems(zeroGems());
    setAnalysisMode('deck_selected');
  }, [analysisPosition, pendingNobleChoice, pendingOverflow, pendingReveal]);

  const toggleAnalysisPayGem = useCallback((type: GemType) => {
    if (!analysisPosition || analysisMode !== 'select_payment' || analysisPaymentOptions.length === 0) return;
    const playerGemsNow = analysisPosition.snapshot.playerGems[analysisPosition.snapshot.currentPlayer];
    if (playerGemsNow[type] <= 0 && analysisPayingGems[type] <= 0) return;

    const uniqueValues = [...new Set(analysisPaymentOptions.map((option) => option[type]))].sort((left, right) => left - right);
    if (uniqueValues.length === 0) return;

    const currentIndex = uniqueValues.indexOf(analysisPayingGems[type]);
    const nextValue = uniqueValues[(currentIndex + 1) % uniqueValues.length];
    const candidates = analysisPaymentOptions.filter((option) => option[type] === nextValue);
    if (candidates.length === 0) return;

    const best = candidates.reduce((bestOption, option) => (
      vectorDistance(option, analysisPayingGems, type) < vectorDistance(bestOption, analysisPayingGems, type)
        ? option
        : bestOption
    ));
    setAnalysisPayingGems(best);
  }, [analysisMode, analysisPaymentOptions, analysisPayingGems, analysisPosition]);

  const isAnalysisPaymentSelectable = useCallback((type: GemType): boolean => {
    if (!analysisPosition || analysisMode !== 'select_payment') return false;
    const player = analysisPosition.snapshot.playerGems[analysisPosition.snapshot.currentPlayer];
    return player[type] > 0 || analysisPayingGems[type] > 0;
  }, [analysisMode, analysisPayingGems, analysisPosition]);

  const isAnalysisReturnSelectable = useCallback((type: GemType): boolean => {
    if (!analysisPosition || analysisMode !== 'return_gems' || !pendingOverflow) return false;
    if (analysisReturningGems[type] > 0) return true;
    if (analysisReturnSelectedTotal >= pendingOverflow.excess) return false;

    const player = analysisPosition.snapshot.playerGems[analysisPosition.snapshot.currentPlayer];
    const maxForType = player[type] + pendingOverflow.gain[type];
    return maxForType > 0;
  }, [analysisMode, analysisPosition, analysisReturnSelectedTotal, analysisReturningGems, pendingOverflow]);

  const toggleAnalysisReturnGem = useCallback((type: GemType) => {
    if (!analysisPosition || analysisMode !== 'return_gems' || !pendingOverflow) return;
    const player = analysisPosition.snapshot.playerGems[analysisPosition.snapshot.currentPlayer];
    const maxForType = player[type] + pendingOverflow.gain[type];

    let nextValue = analysisReturningGems[type] + 1;
    if (nextValue > maxForType) nextValue = 0;

    const next = [...analysisReturningGems] as PaymentVec;
    next[type] = nextValue;
    if (next.reduce((sum, value) => sum + value, 0) > pendingOverflow.excess) {
      next[type] = 0;
    }

    setAnalysisReturningGems(next);
  }, [analysisMode, analysisPosition, analysisReturningGems, pendingOverflow]);

  const confirmAnalysisTake = useCallback(() => {
    if (!analysisPosition || analysisMode !== 'take_gems' || analysisSelectedGems.length === 0) return;
    const player = analysisPosition.snapshot.playerGems[analysisPosition.snapshot.currentPlayer];
    const take = buildTakeCounts(analysisSelectedGems);
    const overflow = countTotalGems(player) + analysisSelectedGems.length - 10;

    if (overflow > 0) {
      setPendingOverflow({
        kind: 'take_gems',
        take,
        gain: take,
        excess: overflow,
      });
      setAnalysisReturningGems(zeroGems());
      setAnalysisMode('return_gems');
      setAnalysisStatus('返却トークンを選択してください。');
      return;
    }

    applyAnalysisTakeAction(take, zeroGems());
  }, [analysisMode, analysisPosition, analysisSelectedGems, applyAnalysisTakeAction]);

  const confirmAnalysisReserve = useCallback(() => {
    if (!analysisPosition || pendingReveal || pendingNobleChoice) return;
    const player = analysisPosition.snapshot.currentPlayer;
    const playerReserved = analysisPosition.snapshot.reservedCards[player].filter((cardId) => cardId >= 0);
    if (playerReserved.length >= 3) {
      setAnalysisStatus('予約カードは3枚までです。');
      return;
    }

    const bankNow = deriveBank(analysisPosition.snapshot.playerGems);
    const gain = zeroGems();
    if (bankNow[5] > 0) gain[5] = 1;
    const overflow = countTotalGems(analysisPosition.snapshot.playerGems[player]) + gain[5] - 10;

    if (analysisSelectedDeckLevel !== null) {
      if (activeDeckCounts[analysisSelectedDeckLevel - 1] <= 0) {
        setAnalysisStatus('その山札は残っていません。');
        return;
      }

      if (overflow > 0) {
        setPendingOverflow({
          kind: 'reserve_deck',
          level: analysisSelectedDeckLevel,
          gain,
          excess: overflow,
        });
        setAnalysisReturningGems(zeroGems());
        setAnalysisMode('return_gems');
        setAnalysisStatus('返却トークンを選択してください。');
        return;
      }

      applyAnalysisReserveDeckAction(analysisSelectedDeckLevel, zeroGems());
      return;
    }

    if (analysisSelectedCardSource === 'visible' && analysisSelectedCardId !== null && analysisSelectedVisibleSlot) {
      if (overflow > 0) {
        setPendingOverflow({
          kind: 'reserve_visible',
          cardId: analysisSelectedCardId,
          level: analysisSelectedVisibleSlot.level,
          slot: analysisSelectedVisibleSlot.slot,
          gain,
          excess: overflow,
        });
        setAnalysisReturningGems(zeroGems());
        setAnalysisMode('return_gems');
        setAnalysisStatus('返却トークンを選択してください。');
        return;
      }

      applyAnalysisReserveVisibleAction(
        analysisSelectedCardId,
        analysisSelectedVisibleSlot.level,
        analysisSelectedVisibleSlot.slot,
        zeroGems(),
      );
      return;
    }

    setAnalysisStatus('予約対象を選択してください。');
  }, [
    activeDeckCounts,
    analysisPosition,
    analysisSelectedCardId,
    analysisSelectedCardSource,
    analysisSelectedDeckLevel,
    analysisSelectedVisibleSlot,
    applyAnalysisReserveDeckAction,
    applyAnalysisReserveVisibleAction,
    pendingNobleChoice,
    pendingReveal,
  ]);

  const confirmAnalysisPurchase = useCallback(() => {
    if (!analysisPosition || analysisMode !== 'select_payment' || analysisSelectedCardId === null || !analysisSelectedCardSource) return;
    if (!analysisPaymentOptions.some((option) => vectorEquals(option, analysisPayingGems))) return;
    applyAnalysisPurchaseAction(
      analysisSelectedCardId,
      analysisSelectedCardSource,
      analysisPayingGems,
      analysisSelectedVisibleSlot,
    );
  }, [
    analysisMode,
    analysisPaymentOptions,
    analysisPayingGems,
    analysisPosition,
    analysisSelectedCardId,
    analysisSelectedCardSource,
    analysisSelectedVisibleSlot,
    applyAnalysisPurchaseAction,
  ]);

  const confirmAnalysisReturns = useCallback(() => {
    if (!analysisPosition || analysisMode !== 'return_gems' || !pendingOverflow) return;
    const player = analysisPosition.snapshot.playerGems[analysisPosition.snapshot.currentPlayer];
    if (analysisReturnSelectedTotal !== pendingOverflow.excess) {
      setAnalysisStatus(`返却枚数は ${pendingOverflow.excess} 枚です。`);
      return;
    }

    for (let index = 0; index < 6; index += 1) {
      const maxForType = player[index] + pendingOverflow.gain[index];
      if (analysisReturningGems[index] > maxForType) {
        setAnalysisStatus('返却指定が不正です。');
        return;
      }
    }

    const action = pendingOverflow;
    setPendingOverflow(null);

    if (action.kind === 'take_gems') {
      applyAnalysisTakeAction(action.take, analysisReturningGems);
      return;
    }

    if (action.kind === 'reserve_visible') {
      applyAnalysisReserveVisibleAction(action.cardId, action.level, action.slot, analysisReturningGems);
      return;
    }

    applyAnalysisReserveDeckAction(action.level, analysisReturningGems);
  }, [
    analysisMode,
    analysisPosition,
    analysisReturnSelectedTotal,
    analysisReturningGems,
    applyAnalysisReserveDeckAction,
    applyAnalysisReserveVisibleAction,
    applyAnalysisTakeAction,
    pendingOverflow,
  ]);

  const selectAnalysisRevealCard = useCallback((cardId: number) => {
    if (!analysisPosition || !pendingReveal) return;
    const next = cloneAnalysisPosition(analysisPosition);
    const player = next.snapshot.currentPlayer;

    if (pendingReveal.kind === 'replace_visible') {
      if (cardId >= 0) {
        next.snapshot.visibleCards[pendingReveal.level - 1][pendingReveal.slot] = cardId;
      }

      if (pendingReveal.checkNoble) {
        maybeFinalizeAnalysisPurchase(next, player, pendingReveal.moveLabel);
      } else {
        commitAnalysisMove(next, pendingReveal.moveLabel);
      }
      return;
    }

    if (cardId < 0) return;
    next.snapshot.reservedCards[player][pendingReveal.slot] = cardId;
    commitAnalysisMove(next, pendingReveal.moveLabel);
  }, [analysisPosition, commitAnalysisMove, maybeFinalizeAnalysisPurchase, pendingReveal]);

  const selectAnalysisNoble = useCallback((nobleId: number) => {
    if (!analysisPosition || !pendingNobleChoice || !pendingNobleChoice.eligibleIds.includes(nobleId)) return;
    const next = awardAnalysisNoble(analysisPosition, pendingNobleChoice.player, nobleId);
    if (!next) {
      setAnalysisStatus('貴族の反映に失敗しました。');
      return;
    }
    commitAnalysisMove(next, `${pendingNobleChoice.moveLabel}/noble:N${nobleId}`);
  }, [analysisPosition, awardAnalysisNoble, commitAnalysisMove, pendingNobleChoice]);

  const analysisCanReserve =
    (analysisSelectedDeckLevel !== null && analysisMode === 'deck_selected')
    || (analysisSelectedCardSource === 'visible'
      && analysisSelectedCardId !== null
      && (analysisMode === 'card_selected' || analysisMode === 'select_payment'));

  const analysisCanPurchase =
    analysisSelectedCardId !== null
    && (analysisSelectedCardSource === 'visible' || analysisSelectedCardSource === 'reserved')
    && analysisMode === 'select_payment'
    && analysisPaymentOptions.some((option) => vectorEquals(option, analysisPayingGems));

  const analysisCanConfirmReturn =
    analysisMode === 'return_gems'
    && pendingOverflow !== null
    && analysisReturnSelectedTotal === analysisReturnTarget;

  const analysisCanUndo =
    analysisPosition !== null
    && analysisTimeline.length > 1
    && !pendingReveal
    && !pendingOverflow
    && !pendingNobleChoice;
  const isAnalysisActive = analysisPosition !== null;
  const isMateStrategyActive = mateStrategy !== null;
  const isMateReplayActive = mateReplay !== null || isMateStrategyActive;
  const mateStrategyCurrentStep = mateStrategySteps.at(-1) ?? null;
  const mateStrategyCurrentNode = mateStrategyCurrentStep && mateStrategy
    ? mateStrategy.nodes.get(mateStrategyCurrentStep.nodeId) ?? null
    : null;
  const mateStrategyOutgoing = useMemo(
    () => mateStrategyCurrentNode?.children ?? [],
    [mateStrategyCurrentNode],
  );
  const mateStrategyCurrentNodeLoading = mateStrategyCurrentNode !== null
    && mateStrategyLoadingNodeId === mateStrategyCurrentNode.id;
  const analysisBoardLocked = pendingReveal !== null || pendingNobleChoice !== null;

  useEffect(() => {
    const replay = mateStrategy;
    const node = mateStrategyCurrentNode;
    if (!replay?.lazy || !node || node.expanded || mateStrategyFailedNodeId === node.id) return;

    const nodeId = node.id;
    const controller = new AbortController();
    let cancelled = false;
    setMateStrategyLoadingNodeId(nodeId);
    setMateStrategyExpansionError('');
    void (async () => {
      try {
        const response = await fetch('/api/mate/frontier', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            position: node.position,
            state: node.state,
            attacker: replay.attacker,
            depth: node.depth,
            preferred_attacker_actions: node.preferredAttackerActions,
          }),
          cache: 'no-store',
          signal: controller.signal,
        });
        const payload: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          const message = payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string'
            ? payload.error
            : '詰み応手の展開に失敗しました。';
          throw new Error(message);
        }
        const expanded = mergeLazyMateFrontier(replay, nodeId, payload);
        if (cancelled) return;
        setMateStrategy((current) => current === replay ? expanded : current);
        const expandedNode = expanded.nodes.get(nodeId);
        setStorageStatus(
          `応手を遅延展開しました: ${expandedNode?.children.length ?? 0} 分岐 / ${expandedNode?.searchNodes ?? 0} nodes`,
        );
      } catch (error) {
        if (cancelled || (error instanceof DOMException && error.name === 'AbortError')) return;
        const message = extractErrorMessage(error, '詰み応手の展開に失敗しました。');
        setMateStrategyFailedNodeId(nodeId);
        setMateStrategyExpansionError(message);
        setStorageStatus(message);
      } finally {
        if (!cancelled) {
          setMateStrategyLoadingNodeId((current) => current === nodeId ? null : current);
        }
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
      setMateStrategyLoadingNodeId((current) => current === nodeId ? null : current);
    };
  }, [mateStrategy, mateStrategyCurrentNode, mateStrategyFailedNodeId]);

  const applySnapshot = useCallback((
    snapshot: PositionSnapshot,
    options?: {
      savedPosition?: SavedPosition | null;
      clearSaveName?: boolean;
      status?: string;
    },
  ) => {
    const sanitized = sanitizeSnapshot(snapshot);
    setVisibleCards(sanitized.visibleCards.map((row) => [...row]));
    setBoardNobles([...sanitized.boardNobles] as NobleSlots);
    setReservedCards([
      [...sanitized.reservedCards[0]],
      [...sanitized.reservedCards[1]],
    ]);
    setPlayerNobles([
      [...sanitized.playerNobles[0]] as NobleSlots,
      [...sanitized.playerNobles[1]] as NobleSlots,
    ]);
    setPurchasedCounts([
      [...sanitized.purchasedCounts[0]] as BonusVec,
      [...sanitized.purchasedCounts[1]] as BonusVec,
    ]);
    setPurchasedCardIds([
      [...sanitized.purchasedCardIds[0]],
      [...sanitized.purchasedCardIds[1]],
    ]);
    setPlayerGems([
      [...sanitized.playerGems[0]] as PaymentVec,
      [...sanitized.playerGems[1]] as PaymentVec,
    ]);
    setPlayerPoints([...sanitized.playerPoints] as [number, number]);
    setPlayerNames([...sanitized.playerNames] as [string, string]);
    setCurrentPlayer(sanitized.currentPlayer);
    setAnnotationArrows(sanitized.annotationArrows.map((arrow) => ({ ...arrow })));
    setPickerTarget(null);
    setNoblePickerTarget(null);
    setCountEditorTarget(null);
    setNameEditorTarget(null);
    setStorageDialogMode(null);
    exitAnalysisMode();
    setMateReplay(null);
    setMateReplayStep(0);
    setMateStrategy(null);
    setMateStrategySteps([]);
    setMateStrategyChoices([]);
    setMateStrategyLoadingNodeId(null);
    setMateStrategyFailedNodeId(null);
    setMateStrategyExpansionError('');

    if (options?.savedPosition) {
      finalizeSavedPosition(options.savedPosition);
    } else {
      setCurrentSavedPositionId(null);
      setPersistedSnapshotKey(null);
      if (options?.clearSaveName) {
        setSaveName('');
      }
    }

    if (options?.status) {
      setStorageStatus(options.status);
    }
  }, [exitAnalysisMode, finalizeSavedPosition]);

  const loadMateKifu = useCallback(() => {
    try {
      const replay = parseMateKifu(mateKifuText);
      exitAnalysisMode();
      setMateReplay(replay);
      setMateReplayStep(0);
      setMateStrategy(null);
      setMateStrategySteps([]);
      setMateStrategyChoices([]);
      setMateStrategyLoadingNodeId(null);
      setMateStrategyFailedNodeId(null);
      setMateStrategyExpansionError('');
      setMateKifuDialogOpen(false);
      setStorageStatus(`詰み手順を読み込みました: ${replay.moves.length} 手`);
    } catch (error) {
      setStorageStatus(extractErrorMessage(error, '棋譜を読み込めませんでした。'));
    }
  }, [exitAnalysisMode, mateKifuText]);

  const loadMateStrategy = useCallback(() => {
    try {
      const replay = parseMateStrategy(mateStrategyText);
      exitAnalysisMode();
      setMateReplay(null);
      setMateReplayStep(0);
      setMateStrategy(replay);
      setMateStrategyMode('auto');
      setMateStrategySteps([{
        nodeId: replay.root,
        snapshot: replay.initialSnapshot,
        deckCounts: replay.initialDeckCounts,
        label: '開始局面',
      }]);
      setMateStrategyChoices([]);
      setMateStrategyLoadingNodeId(null);
      setMateStrategyFailedNodeId(null);
      setMateStrategyExpansionError('');
      setMateKifuDialogOpen(false);
      setStorageStatus(replay.lazy
        ? '検証済み戦略を読み込みました。現在局面の応手を遅延展開します。'
        : `完全応手 DAG を読み込みました: ${replay.nodes.size} 局面`);
    } catch (error) {
      setStorageStatus(extractErrorMessage(error, 'strategy.json を読み込めませんでした。'));
    }
  }, [exitAnalysisMode, mateStrategyText]);

  const chooseMateStrategyEdge = useCallback((edge: MateStrategyEdge) => {
    if (!mateStrategy || !mateStrategyCurrentStep) return;
    try {
      const label = strategyEdgeLabel(edge, mateStrategyCurrentStep.snapshot);
      const outcomeLabel = strategyEdgeOutcomeLabel(edge, mateStrategyCurrentStep.snapshot);
      const snapshot = applyStrategyEdge(mateStrategy, mateStrategyCurrentStep.snapshot, edge);
      const deckCounts = applyStrategyDeckCounts(mateStrategy, mateStrategyCurrentStep.deckCounts, edge);
      setMateStrategySteps((prev) => [...prev, { nodeId: edge.child, snapshot, deckCounts, label: outcomeLabel }]);
      setMateStrategyChoices([]);
      setMateStrategyFailedNodeId(null);
      setMateStrategyExpansionError('');
      setStorageStatus(`応手を進めました: ${outcomeLabel || label}`);
    } catch (error) {
      setStorageStatus(extractErrorMessage(error, '応手を反映できませんでした。'));
    }
  }, [mateStrategy, mateStrategyCurrentStep]);

  const chooseMateStrategyBoardTarget = useCallback((target: { kind: 'card'; cardId: number } | { kind: 'deck'; level: number } | { kind: 'noble'; nobleId: number }) => {
    const matches = mateStrategyOutgoing.filter((edge) => edgeMatchesBoardTarget(edge, target));
    if (matches.length === 1) {
      chooseMateStrategyEdge(matches[0]);
      return;
    }
    setMateStrategyChoices(matches);
    setStorageStatus(matches.length > 1 ? '候補が複数あります。応手一覧から選択してください。' : 'その操作は証明 DAG の応手にありません。');
  }, [chooseMateStrategyEdge, mateStrategyOutgoing]);

  const advanceMateStrategy = useCallback(() => {
    if (mateStrategyOutgoing.length > 0) chooseMateStrategyEdge(mateStrategyOutgoing[0]);
  }, [chooseMateStrategyEdge, mateStrategyOutgoing]);

  const undoMateStrategy = useCallback(() => {
    setMateStrategySteps((prev) => prev.length > 1 ? prev.slice(0, -1) : prev);
    setMateStrategyChoices([]);
    setMateStrategyFailedNodeId(null);
    setMateStrategyExpansionError('');
  }, []);

  const closeMateReplay = useCallback(() => {
    setMateReplay(null);
    setMateReplayStep(0);
    setMateStrategy(null);
    setMateStrategySteps([]);
    setMateStrategyChoices([]);
    setMateStrategyLoadingNodeId(null);
    setMateStrategyFailedNodeId(null);
    setMateStrategyExpansionError('');
    setStorageStatus('詰み手順の再生を終了しました。');
  }, []);

  const updatePositionFromText = useCallback((text: string) => {
    setPositionTextDraft(text);
    try {
      applySnapshot(parsePositionSnapshot(text), {
        status: '局面テキストを盤面へ反映しました。',
      });
      setPositionTextError('');
    } catch (error) {
      setPositionTextError(extractErrorMessage(error, '局面テキストを解釈できません。'));
    }
  }, [applySnapshot]);

  const resetAll = useCallback(() => {
    applySnapshot({
      ...DEFAULT_SNAPSHOT,
      visibleCards: DEFAULT_SNAPSHOT.visibleCards.map((row) => [...row]),
      boardNobles: [...DEFAULT_SNAPSHOT.boardNobles] as NobleSlots,
      reservedCards: [
        [...DEFAULT_SNAPSHOT.reservedCards[0]],
        [...DEFAULT_SNAPSHOT.reservedCards[1]],
      ],
      playerNobles: [
        [...DEFAULT_SNAPSHOT.playerNobles[0]] as NobleSlots,
        [...DEFAULT_SNAPSHOT.playerNobles[1]] as NobleSlots,
      ],
      purchasedCounts: [
        [...DEFAULT_SNAPSHOT.purchasedCounts[0]] as BonusVec,
        [...DEFAULT_SNAPSHOT.purchasedCounts[1]] as BonusVec,
      ],
      purchasedCardIds: [
        [...DEFAULT_SNAPSHOT.purchasedCardIds[0]],
        [...DEFAULT_SNAPSHOT.purchasedCardIds[1]],
      ],
      playerGems: [
        [...DEFAULT_SNAPSHOT.playerGems[0]] as PaymentVec,
        [...DEFAULT_SNAPSHOT.playerGems[1]] as PaymentVec,
      ],
      playerPoints: [...DEFAULT_SNAPSHOT.playerPoints] as [number, number],
      playerNames: [...DEFAULT_PLAYER_NAMES],
      annotationArrows: [],
    }, {
      clearSaveName: true,
    });
    setStorageStatus('');
  }, [applySnapshot]);

  const openVisiblePicker = (level: Tier, slot: VisibleSlot) => {
    setPickerTarget({ kind: 'visible', level, slot });
  };

  const openBoardNoblePicker = (slot: BoardNobleSlot) => {
    setNoblePickerTarget({ kind: 'board', slot });
  };

  const openReservedPicker = (player: PlayerIndex, slot: ReservedSlot) => {
    setPickerTarget({ kind: 'reserved', player, slot });
  };

  const openPlayerNoblePicker = (player: PlayerIndex, slot: PlayerNobleSlot) => {
    setNoblePickerTarget({ kind: 'player', player, slot });
  };

  const selectReservedTier = (level: Tier) => {
    setPickerTarget((prev) => {
      if (!prev || prev.kind !== 'reserved') return prev;
      return { ...prev, level };
    });
  };

  const openGemEditor = (player: PlayerIndex, index: 0 | 1 | 2 | 3 | 4 | 5) => {
    setCountEditorTarget({ kind: 'gem', player, index });
    setCountEditorValue(String(playerGems[player][index]));
  };

  const openPurchasedEditor = (player: PlayerIndex, index: 0 | 1 | 2 | 3 | 4) => {
    setCountEditorTarget({ kind: 'purchased', player, index });
    setCountEditorValue(String(purchasedCounts[player][index]));
  };

  const openPointEditor = (player: PlayerIndex) => {
    setCountEditorTarget({ kind: 'points', player });
    setCountEditorValue(String(playerPoints[player]));
  };

  const openNameEditor = (player: PlayerIndex) => {
    setNameEditorTarget(player);
    setNameEditorValue(playerNames[player]);
  };

  const findReservedCardSlot = (cardId: number): { player: PlayerIndex; slot: ReservedSlot } | null => {
    for (let player = 0; player < 2; player += 1) {
      for (let slot = 0; slot < 3; slot += 1) {
        if (reservedCards[player as PlayerIndex][slot] === cardId) {
          return { player: player as PlayerIndex, slot: slot as ReservedSlot };
        }
      }
    }
    return null;
  };

  const setCardToTarget = (cardId: number) => {
    if (!pickerTarget) return;

    if (pickerTarget.kind === 'visible') {
      setVisibleCards((prev) => {
        const next = prev.map((row) => [...row]);
        next[pickerTarget.level - 1][pickerTarget.slot] = cardId;
        return next;
      });
    } else {
      setReservedCards((prev) => {
        const next = prev.map((row) => [...row]) as [number[], number[]];
        next[pickerTarget.player][pickerTarget.slot] = cardId;
        return next;
      });
    }

    setPickerTarget(null);
  };

  const setNobleToTarget = (nobleId: number) => {
    if (!noblePickerTarget) return;

    if (noblePickerTarget.kind === 'board') {
      setBoardNobles((prev) => {
        const next = [...prev] as NobleSlots;
        next[noblePickerTarget.slot] = nobleId;
        return next;
      });
    } else {
      setPlayerNobles((prev) => {
        const next: [NobleSlots, NobleSlots] = [
          [...prev[0]] as NobleSlots,
          [...prev[1]] as NobleSlots,
        ];
        next[noblePickerTarget.player][noblePickerTarget.slot] = nobleId;
        return next;
      });
    }

    setNoblePickerTarget(null);
  };

  const updatePlayerGem = (player: PlayerIndex, gemIndex: number, value: string) => {
    const parsed = parseCount(value);
    setPlayerGems((prev) => {
      const next: [PaymentVec, PaymentVec] = [
        [...prev[0]] as PaymentVec,
        [...prev[1]] as PaymentVec,
      ];
      next[player][gemIndex] = parsed;
      return next;
    });
  };

  const updatePurchasedCount = (player: PlayerIndex, bonusIndex: number, value: string) => {
    const parsed = parseCount(value);
    setPurchasedCounts((prev) => {
      const next: [BonusVec, BonusVec] = [
        [...prev[0]] as BonusVec,
        [...prev[1]] as BonusVec,
      ];
      next[player][bonusIndex] = parsed;
      return next;
    });
    setPurchasedCardIds((prev) => {
      const next: [number[], number[]] = [[...prev[0]], [...prev[1]]];
      next[player] = [];
      return next;
    });
  };

  const updatePlayerPoints = (player: PlayerIndex, value: string) => {
    const parsed = parseCount(value);
    setPlayerPoints((prev) => {
      const next: [number, number] = [...prev] as [number, number];
      next[player] = parsed;
      return next;
    });
  };

  const applyCountEditor = () => {
    if (!countEditorTarget) return;
    if (countEditorTarget.kind === 'gem') {
      updatePlayerGem(countEditorTarget.player, countEditorTarget.index, countEditorValue);
    } else if (countEditorTarget.kind === 'purchased') {
      updatePurchasedCount(countEditorTarget.player, countEditorTarget.index, countEditorValue);
    } else {
      updatePlayerPoints(countEditorTarget.player, countEditorValue);
    }
    setCountEditorTarget(null);
  };

  const applyNameEditor = () => {
    if (nameEditorTarget === null) return;
    const nextName = nameEditorValue.trim().slice(0, 40) || DEFAULT_PLAYER_NAMES[nameEditorTarget];
    setPlayerNames((prev) => {
      const next = [...prev] as [string, string];
      next[nameEditorTarget] = nextName;
      return next;
    });
    setNameEditorTarget(null);
  };

  const requestSavePosition = useCallback(async (name: string, snapshot: PositionSnapshot): Promise<SavedPosition> => {
    const response = await fetch('/api/positions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name,
        snapshot,
      }),
    });

    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const message = payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string'
        ? payload.error
        : '局面保存に失敗しました。';
      throw new Error(message);
    }

    const entry = parseSavedPosition(payload);
    if (!entry) {
      throw new Error('保存レスポンスが不正です。');
    }

    return entry;
  }, []);

  const saveCurrentPosition = useCallback(async (nameOverride?: string): Promise<SavedPosition> => {
    const trimmed = (nameOverride ?? saveName).trim();
    if (!trimmed) {
      throw new Error('保存名を入力してください。');
    }

    const entry = await requestSavePosition(trimmed, currentSnapshot);
    return finalizeSavedPosition(entry);
  }, [currentSnapshot, finalizeSavedPosition, requestSavePosition, saveName]);

  const buildShareUrlForPositionId = useCallback((id: string): string => {
    if (typeof window === 'undefined') return '';
    return new URL(buildSavedPositionPath(id), window.location.origin).toString();
  }, []);

  const copyText = useCallback(async (text: string): Promise<boolean> => {
    if (!text || typeof window === 'undefined') return false;

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      // Fallback below.
    }

    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', 'true');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand('copy');
      document.body.removeChild(textarea);
      return copied;
    } catch {
      return false;
    }
  }, []);

  const handleSavePosition = useCallback(async () => {
    setRemoteBusy(true);
    try {
      const entry = await saveCurrentPosition();
      setStorageStatus(`局面を保存しました: ${entry.name}`);
      setStorageDialogMode(null);
    } catch (error) {
      setStorageStatus(extractErrorMessage(error, '局面保存に失敗しました。'));
    } finally {
      setRemoteBusy(false);
    }
  }, [saveCurrentPosition]);

  const loadSavedPosition = (entry: SavedPosition) => {
    applySnapshot(entry.snapshot, {
      savedPosition: entry,
      status: `局面を読み込みました: ${entry.name}`,
    });
  };

  const openLoadDialog = useCallback(() => {
    setStorageDialogMode('load');
    void refreshSavedPositions();
  }, [refreshSavedPositions]);

  const handleCopyCurrentShareUrl = useCallback(async () => {
    setRemoteBusy(true);
    try {
      const entry = activeSavedPositionId
        ? savedPositions.find((savedPosition) => savedPosition.id === activeSavedPositionId)
        : null;
      const ensuredEntry = entry ?? (
        activeSavedPositionId
          ? {
            id: activeSavedPositionId,
            name: saveName.trim() || buildAutomaticPositionName(),
            savedAt: new Date().toISOString(),
            snapshot: currentSnapshot,
          }
          : await saveCurrentPosition(saveName.trim() || buildAutomaticPositionName())
      );
      const copied = await copyText(buildShareUrlForPositionId(ensuredEntry.id));
      setStorageStatus(copied ? `共有URLをコピーしました: ${ensuredEntry.name}` : '共有URLのコピーに失敗しました。');
    } catch (error) {
      setStorageStatus(extractErrorMessage(error, '共有URLのコピーに失敗しました。'));
    } finally {
      setRemoteBusy(false);
    }
  }, [activeSavedPositionId, buildShareUrlForPositionId, copyText, currentSnapshot, saveCurrentPosition, saveName, savedPositions]);

  const handleCopySavedPositionShareUrl = useCallback(async (entry: SavedPosition) => {
    const copied = await copyText(buildShareUrlForPositionId(entry.id));
    setStorageStatus(copied ? `共有URLをコピーしました: ${entry.name}` : '共有URLのコピーに失敗しました。');
  }, [buildShareUrlForPositionId, copyText]);

  const renderPickerRow = (row: { color: BonusColor; cards: (CardData | null)[] }, rowKey: string) => (
    <div key={rowKey} className="flex items-start gap-3">
      <div className="flex gap-2">
        {row.cards.map((card, colIdx) => {
          if (!card) {
            return (
              <div
                key={`${rowKey}-empty-${colIdx}`}
                className="w-24 h-32 rounded-xl border border-dashed border-slate-200 bg-slate-50"
              />
            );
          }

          const selectable = card.id === currentPickerCardId || !editorUsedCards.has(card.id);
          return (
            <div key={`${rowKey}-${card.id}`} className={selectable ? '' : 'opacity-35'}>
              <Card
                card={card}
                size="sm"
                isSelectable={selectable}
                isSelected={card.id === currentPickerCardId}
                onClick={selectable ? () => setCardToTarget(card.id) : undefined}
              />
            </div>
          );
        })}
      </div>
    </div>
  );

  const renderNoblePickerGrid = (nobles: NobleData[]) => (
    <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
      {nobles.map((noble) => {
        const selectable = noble.id === currentPickerNobleId || !usedNobles.has(noble.id);
        return (
          <button
            key={`noble-option-${noble.id}`}
            type="button"
            onClick={selectable ? () => setNobleToTarget(noble.id) : undefined}
            className={`rounded-2xl transition-opacity ${selectable ? 'cursor-pointer' : 'cursor-default opacity-35'}`}
            disabled={!selectable}
          >
            <Noble
              noble={noble}
              size="md"
              isSelectable={selectable}
              isHighlighted={noble.id === currentPickerNobleId}
            />
          </button>
        );
      })}
    </div>
  );

  return (
    <main className="min-h-screen bg-slate-50 flex flex-col">
      <Header />

      <div className="max-w-[1400px] w-full mx-auto p-6 space-y-6 pb-24">
        <section className="bg-white border border-slate-200 rounded-3xl p-5 space-y-4 shadow-2xl shadow-black/10">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="font-black text-slate-900 text-2xl tracking-tight">局面エディタ</h1>
            </div>
            <div className="flex max-w-full flex-col items-end gap-2">
              <div className="flex flex-wrap items-center justify-end gap-2">
                <button
                  onClick={() => {
                    if (isAnalysisActive) {
                      exitAnalysisMode('編集モードに戻りました。');
                    } else {
                      enterAnalysisMode();
                    }
                  }}
                  disabled={isMateReplayActive}
                  className={`px-4 py-2 rounded-xl font-bold text-sm transition-colors ${
                    isAnalysisActive
                      ? 'bg-slate-800 text-white hover:bg-slate-900'
                      : 'bg-sky-600 text-white hover:bg-sky-700'
                  } disabled:opacity-40`}
                >
                  <Play size={15} className="inline mr-1" />
                  {isAnalysisActive ? '編集に戻る' : '検討モード'}
                </button>
                <button
                  onClick={() => setMateKifuDialogOpen(true)}
                  className="px-4 py-2 rounded-xl bg-violet-600 text-white font-bold text-sm hover:bg-violet-700 transition-colors"
                >
                  <FileText size={15} className="inline mr-1" />
                  詰み手順読込
                </button>
                <button
                  onClick={resetAll}
                  className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 font-bold text-sm hover:bg-slate-200 transition-colors"
                >
                  <RotateCcw size={15} className="inline mr-1" />
                  リセット
                </button>
                <button
                  onClick={() => void handleCopyCurrentShareUrl()}
                  disabled={remoteBusy}
                  className="px-4 py-2 rounded-xl bg-amber-500 text-white font-bold text-sm hover:bg-amber-600 transition-colors disabled:opacity-60"
                >
                  <Copy size={15} className="inline mr-1" />
                  URL共有
                </button>
                <button
                  onClick={() => setStorageDialogMode('save')}
                  disabled={remoteBusy}
                  className="px-4 py-2 rounded-xl bg-indigo-600 text-white font-bold text-sm hover:bg-indigo-700 transition-colors disabled:opacity-60"
                >
                  <Save size={15} className="inline mr-1" />
                  局面保存
                </button>
                <button
                  onClick={() => void openLoadDialog()}
                  className="px-4 py-2 rounded-xl bg-emerald-600 text-white font-bold text-sm hover:bg-emerald-700 transition-colors"
                >
                  <FolderOpen size={15} className="inline mr-1" />
                  局面読み込み
                </button>
              </div>
              {mateStrategy && mateStrategyCurrentNode && (
                <div className="flex flex-wrap items-center justify-end gap-2" aria-label="応手ツリー操作">
                  <button
                    onClick={() => {
                      setMateStrategyMode('auto');
                      setMateStrategyChoices([]);
                    }}
                    className={`px-3 py-2 rounded-xl text-xs font-bold ${mateStrategyMode === 'auto' ? 'bg-violet-600 text-white' : 'border border-slate-200 text-slate-700'}`}
                  >
                    自動再生
                  </button>
                  <button
                    onClick={() => {
                      setMateStrategyMode('select');
                      setMateStrategyChoices([]);
                    }}
                    className={`px-3 py-2 rounded-xl text-xs font-bold ${mateStrategyMode === 'select' ? 'bg-violet-600 text-white' : 'border border-slate-200 text-slate-700'}`}
                  >
                    応手選択
                  </button>
                  <button
                    onClick={undoMateStrategy}
                    disabled={mateStrategySteps.length <= 1}
                    className="px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold disabled:opacity-40"
                  >
                    <ChevronLeft size={14} className="inline mr-1" />
                    1手戻す
                  </button>
                  <button
                    onClick={advanceMateStrategy}
                    disabled={mateStrategyMode !== 'auto' || mateStrategyCurrentNodeLoading || mateStrategyOutgoing.length === 0}
                    className="px-3 py-2 rounded-xl bg-violet-600 text-white text-xs font-bold disabled:opacity-40"
                  >
                    1手進める
                    <ChevronRight size={14} className="inline ml-1" />
                  </button>
                </div>
              )}
            </div>
          </div>

          {storageStatus && !mateStrategy && (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              {storageStatus}
            </div>
          )}

          {isAnalysisActive && (
            <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900 space-y-1">
              <div>検討モード中 / 手番 P{currentSnapshot.currentPlayer} / {analysisModeLabel}</div>
              {analysisStatus && <div className="text-sky-700">{analysisStatus}</div>}
            </div>
          )}

          {mateReplay && (
            <div className="rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-900">
              詰み手順再生中 / {mateReplayStep} / {mateReplay.moves.length} 手 / 結果: {mateReplay.result || '未記載'}
            </div>
          )}
          {bankErrors.length > 0 && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 space-y-1">
              {bankErrors.map((message) => (
                <div key={message}>{message}</div>
              ))}
            </div>
          )}

          <div className="rounded-2xl border border-slate-200 overflow-hidden bg-slate-100/70">
            <GameBoard
              state={displayState}
              perspective={0}
              aiEnabled={false}
              isHumanTurn={!analysisBoardLocked || pendingNobleChoice !== null}
              boardNobleSlots={activeSnapshot.boardNobles}
              playerNobleSlots={activeSnapshot.playerNobles}
              enableCardAnnotations
              onNobleClick={pendingNobleChoice
                ? (nobleId) => selectAnalysisNoble(nobleId)
                : (isMateStrategyActive && mateStrategyMode === 'select'
                  ? (nobleId) => chooseMateStrategyBoardTarget({ kind: 'noble', nobleId })
                  : undefined)}
              eligibleNobleIds={pendingNobleChoice?.eligibleIds ?? []}
              onBoardNobleSlotClick={!isAnalysisActive && !isMateReplayActive ? openBoardNoblePicker : undefined}
              onVisibleSlotClick={!isAnalysisActive && !isMateReplayActive ? ((level, slot) => openVisiblePicker(level, slot)) : undefined}
              onCardClick={isAnalysisActive && !analysisBoardLocked
                ? (cardId) => selectAnalysisCardForAction(cardId, 'visible')
                : (isMateStrategyActive && mateStrategyMode === 'select'
                  ? (cardId) => chooseMateStrategyBoardTarget({ kind: 'card', cardId })
                  : undefined)}
              onDeckClick={isAnalysisActive && !analysisBoardLocked
                ? (level) => selectAnalysisDeckForAction(level as Tier)
                : (isMateStrategyActive && mateStrategyMode === 'select'
                  ? (level) => chooseMateStrategyBoardTarget({ kind: 'deck', level })
                  : undefined)}
              onGemClick={isAnalysisActive && !analysisBoardLocked ? handleAnalysisBankGemClick : undefined}
              onPlayerGemClick={!isAnalysisActive && !isMateReplayActive ? ((player, gem) => openGemEditor(player, gem)) : undefined}
              onPlayerNobleSlotClick={!isAnalysisActive && !isMateReplayActive ? ((player, slot) => openPlayerNoblePicker(player, slot)) : undefined}
              onPurchasedCountClick={!isAnalysisActive && !isMateReplayActive ? ((player, color) => openPurchasedEditor(player, color)) : undefined}
              onReservedSlotClick={!isAnalysisActive && !isMateReplayActive ? ((player, slot) => openReservedPicker(player, slot as ReservedSlot)) : undefined}
              onReservedCardClick={
                isAnalysisActive
                  ? (analysisBoardLocked ? undefined : (cardId) => selectAnalysisCardForAction(cardId, 'reserved'))
                  : (isMateStrategyActive && mateStrategyMode === 'select'
                    ? (cardId) => chooseMateStrategyBoardTarget({ kind: 'card', cardId })
                    : (isMateReplayActive ? undefined : ((cardId) => {
                    const slot = findReservedCardSlot(cardId);
                    if (!slot) return;
                    openReservedPicker(slot.player, slot.slot);
                  })))
              }
              publicReservedCardIds={[...displayState.players[1].reserved_cards]}
              allowOpponentReservedCardClick
              reservedSlotCount={3}
              purchasedCardOverrides={purchasedCardOverrides}
              selectedGems={isAnalysisActive ? analysisSelectedGems : []}
              selectedCardId={isAnalysisActive ? analysisSelectedCardId : null}
              selectedDeckLevel={isAnalysisActive ? analysisSelectedDeckLevel : null}
              selectedVisibleSlot={isAnalysisActive
                ? analysisSelectedVisibleSlot
                : (pickerTarget?.kind === 'visible'
                  ? { level: pickerTarget.level, slot: pickerTarget.slot }
                  : null)}
              onResourceClick={isAnalysisActive && (analysisMode === 'select_payment' || analysisMode === 'return_gems')
                ? (type) => {
                  if (analysisMode === 'select_payment') toggleAnalysisPayGem(type);
                  if (analysisMode === 'return_gems') toggleAnalysisReturnGem(type);
                }
                : undefined}
              returningGems={isAnalysisActive && analysisMode === 'return_gems' ? analysisReturningGems : undefined}
              isReturnSelectable={isAnalysisActive && analysisMode === 'return_gems' ? isAnalysisReturnSelectable : undefined}
              payingGems={isAnalysisActive && analysisMode === 'select_payment' ? analysisPayingGems : undefined}
              isPaymentSelectable={isAnalysisActive && analysisMode === 'select_payment' ? isAnalysisPaymentSelectable : undefined}
              onPlayerPointClick={!isAnalysisActive && !isMateReplayActive ? ((player) => openPointEditor(player)) : undefined}
              onPlayerNameClick={!isAnalysisActive && !isMateReplayActive ? ((player) => openNameEditor(player)) : undefined}
              onPlayerAreaClick={!isAnalysisActive && !isMateReplayActive ? ((player) => setCurrentPlayer(player)) : undefined}
              annotationArrows={annotationArrows}
              onAnnotationArrowsChange={setAnnotationArrows}
              player0Name={currentSnapshot.playerNames[0]}
              player1Name={currentSnapshot.playerNames[1]}
            />
          </div>
        </section>

        <div className="space-y-6">
          {mateReplay && (
            <section className="bg-white border border-violet-200 rounded-3xl p-5 space-y-4 shadow-2xl shadow-black/10">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-black text-slate-900 text-xl">詰み手順</h2>
                <button
                  onClick={closeMateReplay}
                  className="px-3 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 text-xs font-bold"
                >
                  再生終了
                </button>
              </div>
              <div className="flex items-center justify-between gap-2">
                <button
                  onClick={() => setMateReplayStep(0)}
                  disabled={mateReplayStep === 0}
                  className="px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold disabled:opacity-40"
                >
                  先頭
                </button>
                <button
                  onClick={() => setMateReplayStep((step) => Math.max(0, step - 1))}
                  disabled={mateReplayStep === 0}
                  className="p-2 rounded-xl border border-slate-200 disabled:opacity-40"
                  aria-label="1手戻す"
                >
                  <ChevronLeft size={16} />
                </button>
                <div className="text-sm font-bold text-violet-800">{mateReplayStep} / {mateReplay.moves.length}</div>
                <button
                  onClick={() => setMateReplayStep((step) => Math.min(mateReplay.moves.length, step + 1))}
                  disabled={mateReplayStep === mateReplay.moves.length}
                  className="p-2 rounded-xl border border-slate-200 disabled:opacity-40"
                  aria-label="1手進める"
                >
                  <ChevronRight size={16} />
                </button>
                <button
                  onClick={() => setMateReplayStep(mateReplay.moves.length)}
                  disabled={mateReplayStep === mateReplay.moves.length}
                  className="px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold disabled:opacity-40"
                >
                  末尾
                </button>
              </div>
              <div className="space-y-2 max-h-64 overflow-y-auto border border-slate-100 rounded-xl p-2">
                {mateReplay.moves.map((move, index) => (
                  <button
                    key={`${index}-${move.usi}`}
                    onClick={() => setMateReplayStep(index + 1)}
                    className={`block w-full text-left px-2 py-1.5 rounded-lg border text-xs font-mono ${
                      mateReplayStep === index + 1
                        ? 'bg-violet-100 border-violet-300 text-violet-900'
                        : 'bg-slate-50 border-slate-100 text-slate-700'
                    }`}
                  >
                    {index + 1}. P{move.player} {move.usi}{move.comment ? ` # ${move.comment}` : ''}
                  </button>
                ))}
              </div>
            </section>
          )}
          {mateStrategy && mateStrategyCurrentNode && (
            <section className="bg-white border border-violet-200 rounded-3xl p-5 space-y-4 shadow-2xl shadow-black/10">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-black text-slate-900 text-xl">
                  {mateStrategy.lazy ? '遅延応手ツリー' : '完全応手 DAG'}
                </h2>
                <button
                  onClick={closeMateReplay}
                  className="px-3 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 text-xs font-bold"
                >
                  再生終了
                </button>
              </div>
              <div className="text-xs text-slate-600">
                ノード {mateStrategyCurrentNode.id} / 手番 P{mateStrategyCurrentNode.player} /
                {' '}depth {mateStrategyCurrentNode.depth} / 候補 {mateStrategyOutgoing.length}
                {mateStrategyCurrentNode.searchNodes !== undefined && (
                  <> / {mateStrategyCurrentNode.searchNodes} nodes / {Math.round(mateStrategyCurrentNode.elapsedMs ?? 0)} ms</>
                )}
              </div>
              {mateStrategyCurrentNodeLoading && (
                <div className="rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-800">
                  現在局面の全合法応手と全めくれを検証しています…
                </div>
              )}
              {mateStrategyFailedNodeId === mateStrategyCurrentNode.id && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 space-y-2">
                  <div>{mateStrategyExpansionError || '応手を展開できませんでした。'}</div>
                  <button
                    onClick={() => {
                      setMateStrategyFailedNodeId(null);
                      setMateStrategyExpansionError('');
                    }}
                    className="px-3 py-1.5 rounded-lg bg-rose-600 text-white font-bold"
                  >
                    再試行
                  </button>
                </div>
              )}
              {mateStrategyMode === 'select' && (
                <div className="space-y-2 max-h-72 overflow-y-auto border border-slate-100 rounded-xl p-2">
                  {(mateStrategyChoices.length > 0 ? mateStrategyChoices : mateStrategyOutgoing).map((edge, index) => (
                    <button
                      key={`${edge.child}-${edge.actionCode}-${edge.oracleCard}-${edge.oracleReserveCard}-${index}`}
                      onClick={() => chooseMateStrategyEdge(edge)}
                      className="block w-full text-left px-2 py-1.5 rounded-lg border border-slate-100 bg-slate-50 hover:bg-violet-50 text-xs font-mono text-slate-700"
                    >
                      {strategyEdgeOutcomeLabel(edge, mateStrategyCurrentStep?.snapshot ?? activeSnapshot)} → node {edge.child}
                    </button>
                  ))}
                  {mateStrategyCurrentNode.expanded && mateStrategyOutgoing.length === 0 && (
                    <div className="px-2 py-1 text-xs text-slate-400">終端局面です。</div>
                  )}
                </div>
              )}
              <div className="space-y-1 max-h-48 overflow-y-auto border border-slate-100 rounded-xl p-2">
                {mateStrategySteps.map((step, index) => (
                  <div key={`${step.nodeId}-${index}`} className="px-2 py-1 text-xs font-mono text-slate-700">
                    {index}. {step.label} → node {step.nodeId}
                  </div>
                ))}
              </div>
            </section>
          )}
          {mateStrategy && mateStrategyCurrentNode && (
            <div className="space-y-2">
              <div className="rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-900">
                {mateStrategy.lazy ? '遅延応手ツリー' : '完全応手 DAG'} 再生中 / {mateStrategyMode === 'auto' ? '自動再生' : '応手選択'} /
                {' '}手数 {Math.max(0, mateStrategySteps.length - 1)} / ノード {mateStrategyCurrentNode.id} /
                {' '}{mateStrategyCurrentNodeLoading ? '応手を探索中' : `候補 ${mateStrategyOutgoing.length}`}
              </div>
              {storageStatus && (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                  {storageStatus}
                </div>
              )}
            </div>
          )}

          {isAnalysisActive && (
            <section className="bg-white border border-slate-200 rounded-3xl p-5 space-y-4 shadow-2xl shadow-black/10">
              <h2 className="font-black text-slate-900 text-xl">検討状況</h2>
              <div className="text-sm text-slate-700">
                現在手番: <b>P{currentSnapshot.currentPlayer}</b> / モード: <b>{analysisModeLabel}</b>
              </div>
              {analysisMode === 'select_payment' && (
                <div className="text-xs text-slate-500">支払い: {analysisPayingGems.join(',')}</div>
              )}
              {analysisMode === 'return_gems' && pendingOverflow && (
                <div className="text-xs text-slate-500">返却: {analysisReturnSelectedTotal} / {analysisReturnTarget}</div>
              )}
              <div className="space-y-2 max-h-64 overflow-y-auto border border-slate-100 rounded-xl p-2">
                {analysisMoves.length === 0 ? (
                  <div className="text-xs text-slate-400 px-2 py-1">まだ手順はありません</div>
                ) : analysisMoves.map((move, index) => (
                  <div key={`${index}-${move}`} className="px-2 py-1.5 rounded-lg bg-slate-50 border border-slate-100 text-xs font-mono text-slate-700">
                    {index + 1}. {move}
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="bg-white border border-slate-200 rounded-3xl p-5 space-y-4 shadow-2xl shadow-black/10">
            <h2 className="font-black text-slate-900 text-xl">銀行 / 山札サマリ</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
              {GEM_LABELS.map((label, idx) => (
                <div key={`bank-${label}`} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="text-xs font-bold text-slate-500">{label}</div>
                  <div className={`text-lg font-black ${bank[idx] < 0 ? 'text-rose-600' : 'text-slate-900'}`}>{bank[idx]}</div>
                </div>
              ))}
              {displayState.board.deck_counts.map((count, idx) => (
                <div key={`deck-${idx}`} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="text-xs font-bold text-slate-500">Level {idx + 1} 山札</div>
                  <div className="text-lg font-black text-slate-900">{count}</div>
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-500">
              銀行枚数は標準枚数から各プレイヤーの所持トークンを差し引いて自動計算しています。
              {!isAnalysisActive && ' 現在の手番は、上のプレイヤーエリアをクリックして切り替えられます。'}
            </p>
          </section>

          <section className="bg-white border border-slate-200 rounded-3xl p-5 space-y-4 shadow-2xl shadow-black/10">
            <h2 className="font-black text-slate-900 text-xl">局面テキスト</h2>
            <textarea
              value={positionTextDraft ?? positionSummary}
              onFocus={() => setPositionTextDraft((current) => current ?? positionSummary)}
              onChange={(event) => updatePositionFromText(event.target.value)}
              onBlur={() => {
                if (!positionTextError) setPositionTextDraft(null);
              }}
              disabled={isAnalysisActive || isMateReplayActive}
              className="w-full min-h-64 text-[11px] leading-5 whitespace-pre-wrap bg-slate-900 text-slate-100 rounded-xl p-4 disabled:opacity-60"
              spellCheck={false}
            />
            {positionTextError && (
              <p className="text-xs text-rose-600">{positionTextError}</p>
            )}
            <p className="text-xs text-slate-500">
              有効な局面テキストになると盤面へ即時反映します。購入済みカードは実カードIDではなく、枚数分だけブランクとして `bought` に埋めています。
            </p>
          </section>
        </div>
      </div>

      {isAnalysisActive && !pendingReveal && (
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-white/80 backdrop-blur-md border-t border-slate-200 shadow-[0_-4px_20px_rgba(0,0,0,0.05)] z-50">
          <div className="max-w-6xl mx-auto flex items-center justify-between gap-3 flex-wrap">
            <div className="text-sm text-slate-700 font-bold">{analysisModeLabel}</div>
            <div className="flex items-center gap-2">
              <button
                onClick={clearAnalysisActionState}
                disabled={pendingOverflow !== null || pendingNobleChoice !== null}
                className="px-3 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm font-bold disabled:opacity-40"
              >
                キャンセル
              </button>

              <button
                onClick={undoAnalysisMove}
                disabled={!analysisCanUndo}
                className="px-3 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm font-bold disabled:opacity-40"
              >
                <Undo2 size={14} className="inline mr-1" />
                1手戻す
              </button>

              <button
                onClick={confirmAnalysisTake}
                disabled={analysisMode !== 'take_gems' || analysisSelectedGems.length === 0}
                className="px-4 py-2 rounded-xl font-bold text-sm bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40"
              >
                取得
              </button>

              <button
                onClick={confirmAnalysisReserve}
                disabled={!analysisCanReserve}
                className="px-4 py-2 rounded-xl font-bold text-sm bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-40"
              >
                予約
              </button>

              <button
                onClick={confirmAnalysisPurchase}
                disabled={!analysisCanPurchase}
                className="px-4 py-2 rounded-xl font-bold text-sm bg-green-600 text-white hover:bg-green-700 disabled:opacity-40"
              >
                購入
              </button>

              <button
                onClick={confirmAnalysisReturns}
                disabled={!analysisCanConfirmReturn}
                className="px-4 py-2 rounded-xl font-bold text-sm bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-40"
              >
                返却確定
              </button>
            </div>
          </div>
        </div>
      )}

      {mateKifuDialogOpen && (
        <div
          className="fixed inset-0 bg-black/55 backdrop-blur-sm z-[145] flex items-center justify-center p-4"
          onClick={() => setMateKifuDialogOpen(false)}
        >
          <div
            className="w-full max-w-3xl rounded-3xl bg-white border border-slate-200 shadow-2xl overflow-hidden"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-start justify-between gap-4">
              <div>
                <h3 className="font-black text-slate-900 text-lg">詰み手順データの読み込み</h3>
                <p className="text-xs text-slate-500 mt-1">
                  代表手順の KIFU、または問題集の `strategy.json` を読み込めます。不完全DAGは必要な局面だけ遅延展開します。
                </p>
              </div>
              <button
                onClick={() => setMateKifuDialogOpen(false)}
                className="p-2 rounded-lg text-slate-500 hover:bg-slate-100"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>
            <div className="px-5 py-5 space-y-4">
              <div className="space-y-2">
                <div className="text-sm font-bold text-slate-800">検証済み戦略 (`strategy.json`)</div>
                <input
                  type="file"
                  accept="application/json,.json"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    void file.text().then(setMateStrategyText).catch((error: unknown) => {
                      setStorageStatus(extractErrorMessage(error, 'strategy.json を読み込めませんでした。'));
                    });
                  }}
                  className="block w-full text-xs text-slate-600 file:mr-3 file:px-3 file:py-2 file:rounded-xl file:border-0 file:bg-violet-100 file:text-violet-800 file:font-bold"
                />
                <textarea
                  value={mateStrategyText}
                  onChange={(event) => setMateStrategyText(event.target.value)}
                  className="w-full min-h-36 px-4 py-3 rounded-2xl border border-slate-200 text-xs font-mono"
                  placeholder={'{"format":"csplendor_mate_strategy_v1", ...}'}
                />
                <div className="flex justify-end">
                  <button
                    onClick={loadMateStrategy}
                    disabled={!mateStrategyText.trim()}
                    className="px-4 py-2 rounded-xl bg-violet-600 text-white font-bold text-sm hover:bg-violet-700 disabled:opacity-40"
                  >
                    strategy.json を読み込む
                  </button>
                </div>
              </div>
              <div className="border-t border-slate-200 pt-4 space-y-2">
                <div className="text-sm font-bold text-slate-800">代表手順 KIFU</div>
              <textarea
                value={mateKifuText}
                onChange={(event) => setMateKifuText(event.target.value)}
                className="w-full min-h-72 px-4 py-3 rounded-2xl border border-slate-200 text-xs font-mono"
                placeholder={'Format: Splendor KIFU v1.0\n...\nPosition: bank:...\n\n1. P0 take:WUG'}
                autoFocus
              />
              <div className="flex justify-end">
                <button
                  onClick={loadMateKifu}
                  disabled={!mateKifuText.trim()}
                  className="px-4 py-2 rounded-xl bg-violet-600 text-white font-bold text-sm hover:bg-violet-700 disabled:opacity-40"
                >
                  読み込む
                </button>
              </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {storageDialogMode && (
        <div
          className="fixed inset-0 bg-black/55 backdrop-blur-sm z-[145] flex items-center justify-center p-4"
          onClick={() => setStorageDialogMode(null)}
        >
          <div
            className="w-full max-w-2xl rounded-3xl bg-white border border-slate-200 shadow-2xl overflow-hidden"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-start justify-between gap-4">
              <div>
                <h3 className="font-black text-slate-900 text-lg">
                  {storageDialogMode === 'save' ? '局面保存' : '局面読み込み'}
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  {storageDialogMode === 'save'
                    ? '名前を付けて保存します。'
                    : '保存済みの局面を選んで読み込みます。'}
                </p>
              </div>
              <button
                onClick={() => setStorageDialogMode(null)}
                className="p-2 rounded-lg text-slate-500 hover:bg-slate-100"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>

            {storageDialogMode === 'save' ? (
              <div className="px-5 py-5 space-y-4">
                <input
                  className="w-full px-4 py-3 rounded-2xl border border-slate-200 text-base font-medium"
                  value={saveName}
                  onChange={(event) => setSaveName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      void handleSavePosition();
                    }
                  }}
                  placeholder="保存名"
                  autoFocus
                />
                {storageStatus && <div className="text-sm text-slate-600">{storageStatus}</div>}
              </div>
            ) : (
              <div className="px-5 py-5 space-y-3">
                {storageStatus && <div className="text-sm text-slate-600">{storageStatus}</div>}
                <div className="space-y-2 max-h-[50vh] overflow-y-auto border border-slate-100 rounded-xl p-2">
                  {savedPositionsLoading && savedPositions.length === 0 ? (
                    <div className="text-sm text-slate-400 px-2 py-3">読み込み中...</div>
                  ) : savedPositions.length === 0 ? (
                    <div className="text-sm text-slate-400 px-2 py-3">保存済みの局面はありません</div>
                  ) : savedPositions.map((entry) => (
                    <div
                      key={entry.id}
                      className="flex flex-wrap items-center gap-2 px-3 py-2 rounded-xl bg-slate-50 border border-slate-100"
                    >
                      <div className="flex-1 min-w-[180px]">
                        <div className="text-sm font-bold text-slate-800">{entry.name}</div>
                        <div className="text-[11px] text-slate-500">{entry.savedAt}</div>
                      </div>
                      <button
                        onClick={() => loadSavedPosition(entry)}
                        className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 transition-colors"
                      >
                        読み込む
                      </button>
                      <button
                        onClick={() => void handleCopySavedPositionShareUrl(entry)}
                        className="px-3 py-2 rounded-lg bg-amber-500 text-white text-xs font-bold hover:bg-amber-600 transition-colors"
                      >
                        URL共有
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="px-5 py-4 border-t border-slate-200 flex items-center justify-end gap-2">
              <button
                onClick={() => setStorageDialogMode(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 font-bold text-sm hover:bg-slate-200"
              >
                閉じる
              </button>
              {storageDialogMode === 'save' && (
                <button
                  onClick={() => void handleSavePosition()}
                  disabled={remoteBusy}
                  className="px-4 py-2 rounded-xl bg-indigo-600 text-white font-bold text-sm hover:bg-indigo-700 disabled:opacity-60"
                >
                  保存
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {pickerTarget && (
        <div
          className="fixed inset-0 bg-black/55 backdrop-blur-sm z-[140] flex items-center justify-center p-4"
          onClick={() => setPickerTarget(null)}
        >
          <div
            className="w-full max-w-6xl rounded-3xl bg-white border border-slate-200 shadow-2xl overflow-hidden"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-start justify-between gap-4">
              <div>
                <h3 className="font-black text-slate-900 text-lg">
                  {pickerTarget.kind === 'visible'
                    ? `Level ${pickerTarget.level} 公開カード選択 (Slot ${pickerTarget.slot + 1})`
                    : (pickerTarget.level
                      ? `P${pickerTarget.player} 予約カード選択 (Tier ${pickerTarget.level} / Slot ${pickerTarget.slot + 1})`
                      : `P${pickerTarget.player} 予約カード tier選択 (Slot ${pickerTarget.slot + 1})`)}
                </h3>
                <p className="text-xs text-slate-500 mt-1">既に別の場所で使っているカードは選べません。</p>
              </div>
              <button
                onClick={() => setPickerTarget(null)}
                className="p-2 rounded-lg text-slate-500 hover:bg-slate-100"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>

            <div className="px-5 py-4 overflow-auto max-h-[65vh] space-y-6">
              {pickerTarget.kind === 'visible' ? (
                visiblePickerRows.map((row) => renderPickerRow(row, `visible-${pickerTarget.level}-${row.color}`))
              ) : !pickerTarget.level ? (
                <div className="grid sm:grid-cols-3 gap-3">
                  {([1, 2, 3] as Tier[]).map((level) => (
                    <button
                      key={`reserved-tier-${level}`}
                      onClick={() => selectReservedTier(level)}
                      className="px-4 py-6 rounded-2xl border border-slate-200 bg-slate-50 text-slate-800 font-black hover:bg-slate-100 transition-colors"
                    >
                      Tier {level}
                    </button>
                  ))}
                </div>
              ) : (
                reservedPickerRows.map((row) => renderPickerRow(row, `reserved-${pickerTarget.level}-${row.color}`))
              )}
            </div>

            <div className="px-5 py-3 border-t border-slate-200 flex items-center justify-start gap-3">
              {pickerTarget.kind === 'reserved' && pickerTarget.level && (
                <button
                  onClick={() => setPickerTarget({ kind: 'reserved', player: pickerTarget.player, slot: pickerTarget.slot })}
                  className="px-3 py-2 rounded-lg bg-slate-100 text-slate-700 text-sm font-bold hover:bg-slate-200"
                >
                  tier選択に戻る
                </button>
              )}
              <button
                onClick={() => setCardToTarget(-1)}
                className="px-3 py-2 rounded-lg bg-slate-100 text-slate-700 text-sm font-bold hover:bg-slate-200"
              >
                この枠を空にする
              </button>
            </div>
          </div>
        </div>
      )}

      {noblePickerTarget && (
        <div
          className="fixed inset-0 bg-black/55 backdrop-blur-sm z-[142] flex items-center justify-center p-4"
          onClick={() => setNoblePickerTarget(null)}
        >
          <div
            className="w-full max-w-5xl rounded-3xl bg-white border border-slate-200 shadow-2xl overflow-hidden"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-start justify-between gap-4">
              <div>
                <h3 className="font-black text-slate-900 text-lg">
                  {noblePickerTarget.kind === 'board'
                    ? `公開貴族選択 (Slot ${noblePickerTarget.slot + 1})`
                    : `P${noblePickerTarget.player} 獲得済み貴族選択 (Slot ${noblePickerTarget.slot + 1})`}
                </h3>
                <p className="text-xs text-slate-500 mt-1">既に別の場所で使っている貴族は選べません。</p>
              </div>
              <button
                onClick={() => setNoblePickerTarget(null)}
                className="p-2 rounded-lg text-slate-500 hover:bg-slate-100"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>

            <div className="px-5 py-4 overflow-auto max-h-[65vh]">
              {renderNoblePickerGrid(NOBLES)}
            </div>

            <div className="px-5 py-3 border-t border-slate-200 flex items-center justify-start gap-3">
              <button
                onClick={() => setNobleToTarget(-1)}
                className="px-3 py-2 rounded-lg bg-slate-100 text-slate-700 text-sm font-bold hover:bg-slate-200"
              >
                この枠を空にする
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingReveal && (
        <div className="fixed inset-0 bg-black/55 backdrop-blur-sm z-[150] flex items-center justify-center p-4">
          <div className="w-full max-w-6xl rounded-3xl bg-white border border-slate-200 shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200">
              <h3 className="font-black text-slate-900 text-lg">
                {pendingReveal.kind === 'reserve_deck'
                  ? `山札カード選択 (Level ${pendingReveal.level})`
                  : `公開カード選択 (Level ${pendingReveal.level})`}
              </h3>
            </div>

            <div className="px-5 py-4 overflow-auto max-h-[65vh] space-y-3">
              {analysisRevealRows.map((row) => (
                <div key={`reveal-${row.color}`} className="flex items-start gap-3">
                  <div className="flex gap-2">
                    {row.cards.map((card, colIdx) => {
                      if (!card) {
                        return (
                          <div
                            key={`reveal-${row.color}-empty-${colIdx}`}
                            className="w-24 h-32 rounded-xl border border-dashed border-slate-200 bg-slate-50"
                          />
                        );
                      }

                      const selectable = !analysisUsedCards.has(card.id);
                      return (
                        <div key={`reveal-${card.id}`} className={selectable ? '' : 'opacity-35'}>
                          <Card
                            card={card}
                            size="sm"
                            isSelectable={selectable}
                            onClick={selectable ? () => selectAnalysisRevealCard(card.id) : undefined}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            <div className="px-5 py-3 border-t border-slate-200 flex items-center justify-start gap-3">
              {pendingReveal.kind === 'replace_visible' && (
                <button
                  onClick={() => selectAnalysisRevealCard(-1)}
                  className="px-3 py-2 rounded-lg bg-slate-100 text-slate-700 text-sm font-bold hover:bg-slate-200"
                >
                  めくれなし
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {countEditorTarget && (
        <div
          className="fixed inset-0 bg-black/55 backdrop-blur-sm z-[145] flex items-center justify-center p-4"
          onClick={() => setCountEditorTarget(null)}
        >
          <div
            className="w-full max-w-md rounded-3xl bg-white border border-slate-200 shadow-2xl overflow-hidden"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-start justify-between gap-4">
              <div>
                <h3 className="font-black text-slate-900 text-lg">
                  {countEditorTarget.kind === 'gem'
                    ? `P${countEditorTarget.player} ${GEM_LABELS[countEditorTarget.index]}トークン枚数`
                    : countEditorTarget.kind === 'purchased'
                      ? `P${countEditorTarget.player} ${GEM_LABELS[countEditorTarget.index]}購入枚数`
                      : `P${countEditorTarget.player} 点数`}
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  {countEditorTarget.kind === 'gem'
                    ? '銀行枚数は、両プレイヤーの所持枚数から自動で再計算されます。'
                    : countEditorTarget.kind === 'purchased'
                      ? '購入済みカード表示はブランクカードで埋め、ボーナス数に反映します。'
                      : '表示上の合計点を直接設定します。'}
                </p>
              </div>
              <button
                onClick={() => setCountEditorTarget(null)}
                className="p-2 rounded-lg text-slate-500 hover:bg-slate-100"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>

            <div className="px-5 py-5 space-y-3">
              <input
                type="number"
                min={0}
                value={countEditorValue}
                onChange={(event) => setCountEditorValue(event.target.value)}
                className="w-full px-4 py-3 rounded-2xl border border-slate-200 text-lg font-bold"
                autoFocus
              />
            </div>

            <div className="px-5 py-4 border-t border-slate-200 flex items-center justify-end gap-2">
              <button
                onClick={() => setCountEditorTarget(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 font-bold text-sm hover:bg-slate-200"
              >
                キャンセル
              </button>
              <button
                onClick={applyCountEditor}
                className="px-4 py-2 rounded-xl bg-indigo-600 text-white font-bold text-sm hover:bg-indigo-700"
              >
                反映
              </button>
            </div>
          </div>
        </div>
      )}

      {nameEditorTarget !== null && (
        <div
          className="fixed inset-0 bg-black/55 backdrop-blur-sm z-[145] flex items-center justify-center p-4"
          onClick={() => setNameEditorTarget(null)}
        >
          <div
            className="w-full max-w-md rounded-3xl bg-white border border-slate-200 shadow-2xl overflow-hidden"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-start justify-between gap-4">
              <div>
                <h3 className="font-black text-slate-900 text-lg">P{nameEditorTarget} プレイヤー名</h3>
                <p className="text-xs text-slate-500 mt-1">クリックしたプレイヤー名を直接編集できます。</p>
              </div>
              <button
                onClick={() => setNameEditorTarget(null)}
                className="p-2 rounded-lg text-slate-500 hover:bg-slate-100"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>

            <div className="px-5 py-5 space-y-3">
              <input
                value={nameEditorValue}
                onChange={(event) => setNameEditorValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    applyNameEditor();
                  }
                }}
                className="w-full px-4 py-3 rounded-2xl border border-slate-200 text-lg font-bold"
                maxLength={40}
                autoFocus
              />
            </div>

            <div className="px-5 py-4 border-t border-slate-200 flex items-center justify-end gap-2">
              <button
                onClick={() => setNameEditorTarget(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 font-bold text-sm hover:bg-slate-200"
              >
                キャンセル
              </button>
              <button
                onClick={applyNameEditor}
                className="px-4 py-2 rounded-xl bg-indigo-600 text-white font-bold text-sm hover:bg-indigo-700"
              >
                反映
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
