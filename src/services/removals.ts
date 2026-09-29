// src/services/removals.ts
//
// What left the shelves, and why. Every time food is taken out of the pantry
// for real — eaten, binned, given away — the server copies the item into a
// history row alongside the reason before deleting it. The Profile tab lists
// those rows; Home charts them by reason.
//
// Not every delete is a removal. Taking back a scan with Undo, or deleting
// something added by mistake, goes through deletePantryItems in pantry.ts and
// leaves no row: that food was never really in the kitchen, and counting it
// would put noise into the one number the chart exists to show.

import { apiFetch } from '../config/api';
import { refreshKey, subscribeToKey } from './live';
import { refreshPantry } from './pantry';

export const REMOVAL_REASONS = [
  'consumed',
  'spoiled',
  'expired',
  'leftover',
  'over-purchased',
  'other',
] as const;

export type RemovalReason = (typeof REMOVAL_REASONS)[number];

export const REMOVAL_LABELS: Record<RemovalReason, string> = {
  consumed: 'Consumed',
  spoiled: 'Spoiled',
  expired: 'Expired',
  leftover: 'Leftover',
  'over-purchased': 'Over-purchased',
  other: 'Other',
};

/** One line under each reason in the picker, so "Spoiled" and "Expired" don't
 *  read as the same thing — the difference is what the research needs. */
export const REMOVAL_HINTS: Record<RemovalReason, string> = {
  consumed: 'Eaten or cooked with',
  spoiled: 'Went bad before its date',
  expired: 'Past its date, thrown out',
  leftover: 'Cooked but not finished',
  'over-purchased': 'Bought more than we could use',
  other: 'Given away, or something else',
};

/** Only 'consumed' is food that got eaten. Everything else counts as waste. */
export function isWaste(reason: RemovalReason): boolean {
  return reason !== 'consumed';
}

export type RemovalRecord = {
  id: string;
  itemId: string;
  name: string;
  quantity: string;
  category: string;
  location: string | null;
  expiryDate: string | null;
  addedAt: number | null;
  reason: RemovalReason;
  /** ms epoch */
  removedAt: number;
};

export type RemovalHistory = {
  /** Newest first, capped by the server. */
  records: RemovalRecord[];
  /** Per reason over the whole history, not just the capped list. */
  counts: Record<RemovalReason, number>;
};

export const EMPTY_HISTORY: RemovalHistory = {
  records: [],
  counts: { consumed: 0, spoiled: 0, expired: 0, leftover: 0, 'over-purchased': 0, other: 0 },
};

const KEY = 'pantry-history';

function isReason(raw: unknown): raw is RemovalReason {
  return REMOVAL_REASONS.includes(raw as RemovalReason);
}

// Same defensiveness as pantry.ts's readers: a row with a reason this build
// doesn't know (a newer server, a hand-edited document) is dropped rather than
// drawn under a label that isn't true.
function toRecord(raw: any): RemovalRecord | null {
  if (!raw || typeof raw.id !== 'string' || typeof raw.name !== 'string') return null;
  if (!isReason(raw.reason) || typeof raw.removedAt !== 'number') return null;
  return {
    id: raw.id,
    itemId: typeof raw.itemId === 'string' ? raw.itemId : '',
    name: raw.name,
    quantity: typeof raw.quantity === 'string' ? raw.quantity : '',
    category: typeof raw.category === 'string' ? raw.category : '',
    location: typeof raw.location === 'string' ? raw.location : null,
    expiryDate: typeof raw.expiryDate === 'string' ? raw.expiryDate : null,
    addedAt: typeof raw.addedAt === 'number' ? raw.addedAt : null,
    reason: raw.reason,
    removedAt: raw.removedAt,
  };
}

async function fetchHistory(): Promise<RemovalHistory> {
  const body = await apiFetch<{ records?: any[]; counts?: Record<string, unknown> }>(
    '/api/pantry/history'
  );
  const counts = { ...EMPTY_HISTORY.counts };
  for (const reason of REMOVAL_REASONS) {
    const n = body.counts?.[reason];
    if (typeof n === 'number' && n >= 0) counts[reason] = n;
  }
  const records = (body.records ?? [])
    .map(toRecord)
    .filter((r): r is RemovalRecord => r !== null);
  return { records, counts };
}

/** Live view of the removal history. Home and Profile share one request. */
export function subscribeToRemovalHistory(
  callback: (history: RemovalHistory) => void,
  onError: (err: Error) => void
) {
  return subscribeToKey(KEY, fetchHistory, callback, onError);
}

/**
 * Takes items off the shelves and records why. Refreshes both the pantry and
 * the history, which is what moves Home's chart the moment a row is removed.
 */
export async function removePantryItems(itemIds: string[], reason: RemovalReason) {
  if (itemIds.length === 0) return;
  await apiFetch('/api/pantry/remove', { ids: itemIds, reason });
  refreshPantry();
  refreshKey(KEY);
}

/**
 * Drops the history rows for items that are being put back. Call alongside
 * restorePantryItems — an item back on the shelf was never really removed.
 */
export async function undoRemovals(itemIds: string[]) {
  if (itemIds.length === 0) return;
  await apiFetch('/api/pantry/history/undo', { itemIds });
  refreshKey(KEY);
}
