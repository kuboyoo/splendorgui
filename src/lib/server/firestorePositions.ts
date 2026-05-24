import 'server-only';

import { randomInt } from 'node:crypto';
import { Firestore } from '@google-cloud/firestore';
import { type PositionSnapshot, type SavedPosition, sanitizeSnapshot } from '@/lib/positionSnapshot';

const COLLECTION_NAME = 'positions';
const ID_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const MAX_ID_ATTEMPTS = 6;

let firestoreInstance: Firestore | null = null;

function getFirestore(): Firestore {
  if (!firestoreInstance) {
    firestoreInstance = new Firestore();
  }
  return firestoreInstance;
}

function generateShortId(length = 8): string {
  return Array.from({ length }, () => ID_ALPHABET[randomInt(0, ID_ALPHABET.length)]).join('');
}

function normalizeSavedPosition(id: string, raw: Record<string, unknown> | undefined): SavedPosition {
  let snapshotSource: unknown = raw?.snapshot;
  if (typeof raw?.snapshotJson === 'string') {
    try {
      snapshotSource = JSON.parse(raw.snapshotJson);
    } catch {
      snapshotSource = raw.snapshot;
    }
  }

  return {
    id,
    name: typeof raw?.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 80) : '無題の局面',
    savedAt: typeof raw?.savedAt === 'string' ? raw.savedAt : new Date(0).toISOString(),
    snapshot: sanitizeSnapshot(snapshotSource),
  };
}

async function createUniqueDocumentId(): Promise<string> {
  const collection = getFirestore().collection(COLLECTION_NAME);

  for (let attempt = 0; attempt < MAX_ID_ATTEMPTS; attempt += 1) {
    const candidate = generateShortId();
    const snapshot = await collection.doc(candidate).get();
    if (!snapshot.exists) {
      return candidate;
    }
  }

  throw new Error('Failed to allocate a unique short position id');
}

export async function createSavedPosition(name: string, snapshot: PositionSnapshot): Promise<SavedPosition> {
  const trimmed = name.trim().slice(0, 80) || '無題の局面';
  const id = await createUniqueDocumentId();
  const savedAt = new Date().toISOString();
  const entry: SavedPosition = {
    id,
    name: trimmed,
    savedAt,
    snapshot: sanitizeSnapshot(snapshot),
  };

  await getFirestore().collection(COLLECTION_NAME).doc(id).set({
    name: entry.name,
    savedAt: entry.savedAt,
    snapshotJson: JSON.stringify(entry.snapshot),
  });

  return entry;
}

export async function listSavedPositions(): Promise<SavedPosition[]> {
  const snapshot = await getFirestore()
    .collection(COLLECTION_NAME)
    .orderBy('savedAt', 'desc')
    .get();

  return snapshot.docs.map((doc) => normalizeSavedPosition(doc.id, doc.data() as Record<string, unknown> | undefined));
}

export async function getSavedPosition(id: string): Promise<SavedPosition | null> {
  if (!/^[A-Za-z0-9_-]{6,32}$/u.test(id)) {
    return null;
  }

  const snapshot = await getFirestore().collection(COLLECTION_NAME).doc(id).get();
  if (!snapshot.exists) {
    return null;
  }

  return normalizeSavedPosition(snapshot.id, snapshot.data() as Record<string, unknown> | undefined);
}
