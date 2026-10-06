// server/src/pantryRemove.ts
//
// The checks and the write plan behind POST /api/pantry/remove and
// /history/undo, kept free of the database so they can be tested on their own.
//
// The phone works out both amounts ("2 eggs" removed, "3 eggs" left) with its
// own quantity model. This side only checks they are there and writes them —
// a second copy of the unit arithmetic here would be a second place for "1½
// packs" to be read differently.

import { randomUUID } from 'crypto';
import { REMOVAL_REASONS, type RemovalReason } from './models';
import { isValidId } from './routes/helpers';

/** The longest note kept with an 'other' removal. */
export const NOTE_MAX = 80;
const AMOUNT_MAX = 1000;

export type RemoveLine = { id: string; removed: string; remaining: string | null };
export type RemoveRequest = { lines: RemoveLine[]; reason: RemovalReason; note: string | null };

/** The /remove body, checked. A string is the sentence for the 400. */
export function parseRemoveBody(body: unknown): RemoveRequest | string {
  const { items, reason, note } = (body ?? {}) as { items?: unknown; reason?: unknown; note?: unknown };
  if (!Array.isArray(items)) {
    // An older app build sent { ids, reason }; say so rather than "no items".
    if (Array.isArray((body as { ids?: unknown } | null)?.ids)) {
      return 'This version of Panzi is out of date — reload the app.';
    }
    return 'No items were sent.';
  }
  if (items.length === 0) return 'No items were sent.';

  const lines: RemoveLine[] = [];
  const seen = new Set<string>();
  for (const raw of items as any[]) {
    if (!isValidId(raw?.id)) return 'An id was not usable.';
    if (seen.has(raw.id)) return 'An item was sent twice.';
    seen.add(raw.id);

    const removed = typeof raw.removed === 'string' ? raw.removed.trim() : '';
    if (!removed || removed.length > AMOUNT_MAX) return 'Each item needs the amount removed.';

    // Required, not defaulted: a body that leaves it out must not be read as
    // "nothing left" and delete the item.
    if (!('remaining' in raw)) return 'Each item needs the amount left.';
    let remaining: string | null = null;
    if (raw.remaining !== null) {
      const text = typeof raw.remaining === 'string' ? raw.remaining.trim() : '';
      if (!text || text.length > AMOUNT_MAX) return 'An amount left was not usable.';
      remaining = text;
    }
    lines.push({ id: raw.id, removed, remaining });
  }

  if (!REMOVAL_REASONS.includes(reason as RemovalReason)) return 'That is not a removal reason.';
  if (reason !== 'other') return { lines, reason: reason as RemovalReason, note: null };
  // "Other" on its own says nothing about where the food went, so it only
  // counts with the user's own words for it.
  const kept = typeof note === 'string' ? note.trim().slice(0, NOTE_MAX).trim() : '';
  if (!kept) return 'Say why it is going.';
  return { lines, reason: 'other', note: kept };
}

export type RemovalWrites = {
  rows: Record<string, unknown>[];
  updates: { id: string; quantity: string }[];
  deletes: string[];
};

/**
 * The rows to insert and the items to shrink or delete. `owned` is what the
 * owner-scoped find returned; a line for anything not in it (someone else's
 * id, an item already gone) is skipped rather than failing the others.
 */
export function planRemovalWrites(
  request: RemoveRequest,
  owned: any[],
  uid: string,
  removedAt: Date,
  newId: () => string = randomUUID
): RemovalWrites {
  const byId = new Map(owned.map((item) => [String(item._id), item]));
  const writes: RemovalWrites = { rows: [], updates: [], deletes: [] };
  for (const line of request.lines) {
    const item = byId.get(line.id);
    if (!item) continue;
    writes.rows.push({
      _id: newId(),
      userId: uid,
      itemId: item._id,
      name: item.name,
      quantity: line.removed,
      category: item.category ?? '',
      location: item.location ?? null,
      expiryDate: item.expiryDate ?? item.estimatedUseBy ?? null,
      addedAt: item.createdAt ?? null,
      reason: request.reason,
      note: request.note,
      removedAt,
    });
    if (line.remaining === null) writes.deletes.push(line.id);
    else writes.updates.push({ id: line.id, quantity: line.remaining });
  }
  return writes;
}

/** The /history/undo body, checked. A string is the sentence for the 400. */
export function parseUndoBody(body: unknown): string[] | string {
  const { removalIds } = (body ?? {}) as { removalIds?: unknown };
  if (!Array.isArray(removalIds)) return 'No removal ids were sent.';
  if (!removalIds.every(isValidId)) return 'An id was not usable.';
  return removalIds;
}

/** By row id, so undoing a cook leaves an earlier removal of the same item alone. */
export function undoFilter(uid: string, removalIds: string[]) {
  return { _id: { $in: removalIds }, userId: uid };
}
