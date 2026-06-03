export interface AnnotationArrow {
  fromId: string;
  toId: string;
}

export type CardAnnotationArrow = AnnotationArrow;

export type PaymentVec = [number, number, number, number, number, number];
export type BonusVec = [number, number, number, number, number];
export type NobleSlots = [number, number, number];

export interface PositionSnapshot {
  visibleCards: number[][];
  boardNobles: NobleSlots;
  reservedCards: [number[], number[]];
  playerNobles: [NobleSlots, NobleSlots];
  purchasedCounts: [BonusVec, BonusVec];
  purchasedCardIds: [number[], number[]];
  playerGems: [PaymentVec, PaymentVec];
  playerPoints: [number, number];
  playerNames: [string, string];
  currentPlayer: 0 | 1;
  annotationArrows: AnnotationArrow[];
}

export interface SavedPosition {
  id: string;
  name: string;
  savedAt: string;
  snapshot: PositionSnapshot;
}

export const SHARE_PARAM_KEY = 's';
export const SNAPSHOT_VERSION = 2;
export const CANONICAL_EDITOR_PATH = '/';
export const DEFAULT_PLAYER_NAMES: [string, string] = ['Player0', 'Player1'];

function zeroGems(): PaymentVec {
  return [0, 0, 0, 0, 0, 0];
}

function zeroBonuses(): BonusVec {
  return [0, 0, 0, 0, 0];
}

export function buildEmptySnapshot(): PositionSnapshot {
  return {
    visibleCards: [
      [-1, -1, -1, -1],
      [-1, -1, -1, -1],
      [-1, -1, -1, -1],
    ],
    boardNobles: [-1, -1, -1],
    reservedCards: [
      [-1, -1, -1],
      [-1, -1, -1],
    ],
    playerNobles: [
      [-1, -1, -1],
      [-1, -1, -1],
    ],
    purchasedCounts: [zeroBonuses(), zeroBonuses()],
    purchasedCardIds: [[], []],
    playerGems: [zeroGems(), zeroGems()],
    playerPoints: [0, 0],
    playerNames: [...DEFAULT_PLAYER_NAMES],
    currentPlayer: 0,
    annotationArrows: [],
  };
}

function toInteger(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function toNonNegativeInteger(value: unknown, fallback = 0): number {
  const parsed = toInteger(value, fallback);
  return parsed >= 0 ? parsed : fallback;
}

function normalizeFixedArray(
  raw: unknown,
  length: number,
  fallback: number,
  parser: (value: unknown, fallbackValue: number) => number,
): number[] {
  const source = Array.isArray(raw) ? raw : [];
  return Array.from({ length }, (_, index) => parser(source[index], fallback));
}

function normalizePaymentVec(raw: unknown): PaymentVec {
  return normalizeFixedArray(raw, 6, 0, toNonNegativeInteger) as PaymentVec;
}

function normalizeBonusVec(raw: unknown): BonusVec {
  return normalizeFixedArray(raw, 5, 0, toNonNegativeInteger) as BonusVec;
}

function normalizeCardRow(raw: unknown, length: number): number[] {
  return normalizeFixedArray(raw, length, -1, (value, fallback) => {
    const parsed = toInteger(value, fallback);
    return parsed >= 0 ? parsed : -1;
  });
}

function normalizeNobleSlots(raw: unknown): NobleSlots {
  return normalizeCardRow(raw, 3) as NobleSlots;
}

function normalizePointPair(raw: unknown): [number, number] {
  return normalizeFixedArray(raw, 2, 0, toNonNegativeInteger) as [number, number];
}

function normalizePlayerNames(raw: unknown): [string, string] {
  const source = Array.isArray(raw) ? raw : [];
  return [0, 1].map((index) => {
    const value = source[index];
    if (typeof value !== 'string') return DEFAULT_PLAYER_NAMES[index];
    const trimmed = value.trim();
    return trimmed ? trimmed.slice(0, 40) : DEFAULT_PLAYER_NAMES[index];
  }) as [string, string];
}

function normalizeAnnotationId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^(card|noble):\d+$/u.test(trimmed) ? trimmed : null;
}

function normalizeAnnotationArrows(raw: unknown): AnnotationArrow[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((arrow) => {
    if (!arrow || typeof arrow !== 'object') return [];
    const candidate = arrow as {
      fromId?: unknown;
      toId?: unknown;
      fromCardId?: unknown;
      toCardId?: unknown;
    };

    const fromId = normalizeAnnotationId(candidate.fromId);
    const toId = normalizeAnnotationId(candidate.toId);
    if (fromId && toId) {
      return [{ fromId, toId }];
    }

    const fromCardId = toInteger(candidate.fromCardId, -1);
    const toCardId = toInteger(candidate.toCardId, -1);
    if (fromCardId < 0 || toCardId < 0) return [];
    return [{ fromId: `card:${fromCardId}`, toId: `card:${toCardId}` }];
  });
}

export function sanitizeSnapshot(raw: unknown): PositionSnapshot {
  const source = raw && typeof raw === 'object'
    ? raw as {
      visibleCards?: unknown;
      boardNobles?: unknown;
      nobles?: unknown;
      reservedCards?: unknown;
      playerNobles?: unknown;
      acquiredNobles?: unknown;
      purchasedCounts?: unknown;
      purchasedCardIds?: unknown;
      boughtCardIds?: unknown;
      playerBonuses?: unknown;
      playerGems?: unknown;
      playerPoints?: unknown;
      playerNames?: unknown;
      currentPlayer?: unknown;
      annotationArrows?: unknown;
    }
    : {};
  const visibleSource = Array.isArray(source.visibleCards) ? source.visibleCards : [];
  const boardNoblesSource = source.boardNobles ?? source.nobles;
  const reservedSource = Array.isArray(source.reservedCards) ? source.reservedCards : [];
  const playerNoblesSource = source.playerNobles ?? source.acquiredNobles;
  const purchasedSource = source.purchasedCounts ?? source.playerBonuses;
  const purchasedCardIdsSource = source.purchasedCardIds ?? source.boughtCardIds;
  const playerGemsSource = Array.isArray(source.playerGems) ? source.playerGems : [];

  return {
    visibleCards: [
      normalizeCardRow(visibleSource[0], 4),
      normalizeCardRow(visibleSource[1], 4),
      normalizeCardRow(visibleSource[2], 4),
    ],
    boardNobles: normalizeNobleSlots(boardNoblesSource),
    reservedCards: [
      normalizeCardRow(reservedSource[0], 3),
      normalizeCardRow(reservedSource[1], 3),
    ],
    playerNobles: [
      normalizeNobleSlots(Array.isArray(playerNoblesSource) ? playerNoblesSource[0] : undefined),
      normalizeNobleSlots(Array.isArray(playerNoblesSource) ? playerNoblesSource[1] : undefined),
    ],
    purchasedCounts: [
      normalizeBonusVec(Array.isArray(purchasedSource) ? purchasedSource[0] : undefined),
      normalizeBonusVec(Array.isArray(purchasedSource) ? purchasedSource[1] : undefined),
    ],
    purchasedCardIds: [
      normalizeCardRow(Array.isArray(purchasedCardIdsSource) ? purchasedCardIdsSource[0] : undefined, 90).filter((cardId) => cardId >= 0),
      normalizeCardRow(Array.isArray(purchasedCardIdsSource) ? purchasedCardIdsSource[1] : undefined, 90).filter((cardId) => cardId >= 0),
    ],
    playerGems: [
      normalizePaymentVec(playerGemsSource[0]),
      normalizePaymentVec(playerGemsSource[1]),
    ],
    playerPoints: normalizePointPair(source.playerPoints),
    playerNames: normalizePlayerNames(source.playerNames),
    currentPlayer: toInteger(source.currentPlayer, 0) === 1 ? 1 : 0,
    annotationArrows: normalizeAnnotationArrows(source.annotationArrows),
  };
}

export function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

export function decodeBase64Url(value: string): string {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4 || 4)) % 4), '=');
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeSnapshotToShareToken(snapshot: PositionSnapshot): string {
  return encodeBase64Url(JSON.stringify({
    v: SNAPSHOT_VERSION,
    snapshot,
  }));
}

export function decodeSnapshotFromShareToken(token: string): PositionSnapshot {
  const parsed: unknown = JSON.parse(decodeBase64Url(token));
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid shared snapshot payload');
  }

  const payload = parsed as { v?: unknown; snapshot?: unknown };
  if (toInteger(payload.v, 0) !== SNAPSHOT_VERSION) {
    throw new Error('Unsupported shared snapshot version');
  }

  return sanitizeSnapshot(payload.snapshot);
}

export function buildSavedPositionPath(id: string): string {
  return `/p/${encodeURIComponent(id)}`;
}

export const DEFAULT_SNAPSHOT = buildEmptySnapshot();
export const DEFAULT_SHARE_TOKEN = encodeSnapshotToShareToken(DEFAULT_SNAPSHOT);
