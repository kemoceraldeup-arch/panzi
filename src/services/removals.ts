// src/services/removals.ts
//
// What left the shelves, and why. Every time food is taken out of the pantry
// for real — eaten, binned, given away — the server writes a history row with
// how much went and why, then shrinks the item or deletes it. The Profile tab
// lists those rows; Home charts them by reason.
//
// Not every delete is a removal. Taking back a scan with Undo, or deleting
// something added by mistake, goes through deletePantryItems in pantry.ts and
// leaves no row: that food was never really in the kitchen, and counting it
// would put noise into the one number the chart exists to show.

import { apiFetch } from '../config/api';
import { refreshKey, subscribeToKey } from './live';
import { refreshPantry } from './pantry';
import type { RemovalLine } from './removalAmount';

export const REMOVAL_REASONS = ['consumed', 'spoiled', 'expired', 'other'] as const;

export type RemovalReason = (typeof REMOVAL_REASONS)[number];

/** The longest note kept with an Other removal (the server trims to this too). */
export const NOTE_MAX = 80;

export const REMOVAL_LABELS: Record<RemovalReason, string> = {
  consumed: 'Consumed',
  spoiled: 'Spoiled',
  expired: 'Expired',
  other: 'Other',
};

/** One line under each reason in the picker, so "Spoiled" and "Expired" don't
 *  read as the same thing — the difference is what the research needs. */
export const REMOVAL_HINTS: Record<RemovalReason, string> = {
  consumed: 'Eaten or cooked with',
  spoiled: 'Went bad before its date',
  expired: 'Past its date, thrown out',
  other: 'Given away, or something else — say what',
};

/** Only 'consumed' is food that got eaten. Everything else counts as waste. */
export function isWaste(reason: RemovalReason): boolean {
  return reason !== 'consumed';
}

/** "Other · Gave to neighbour" when the user said why; the plain label otherwise. */
export function reasonLabel(record: { reason: RemovalReason; note: string | null }): string {
  return record.reason === 'other' && record.note
    ? `${REMOVAL_LABELS.other} · ${record.note}`
    : REMOVAL_LABELS[record.reason];
}

/** What Other saves from the text field: trimmed and capped, or null when
 *  nothing was typed — Other can't be saved without a reason. */
export function otherNote(text: string): string | null {
  return text.trim().slice(0, NOTE_MAX).trim() || null;
}

export type RemovalRecord = {
  id: string;
  itemId: string;
  name: string;
  /** How much left in this removal — not what the item held before. */
  quantity: string;
  category: string;
  location: string | null;
  expiryDate: string | null;
  addedAt: number | null;
  reason: RemovalReason;
  /** What the user typed for Other; null otherwise. */
  note: string | null;
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
  counts: { consumed: 0, spoiled: 0, expired: 0, other: 0 },
};

/**
 * Whether Home shows "Where your food went". The chart reads History, not the
 * shelves, so emptying the pantry must not take it away. Only a pantry that is
 * empty AND has never had anything removed — a brand-new account — skips it,
 * so the first screen stays about scanning rather than an empty chart.
 * `pantryTotal` is null while the pantry is still loading.
 */
export function showRemovalChart(pantryTotal: number | null, history: RemovalHistory | null): boolean {
  if (!history) return false;
  if (pantryTotal !== 0) return true;
  return REMOVAL_REASONS.some((reason) => history.counts[reason] > 0);
}

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
    note: typeof raw.note === 'string' && raw.note ? raw.note : null,
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
 * Takes food off the shelves — all of an item or part of it — and records why.
 * Each line says how much went and what is left (removalAmount.ts works both
 * out). Refreshes the pantry and the history, which is what moves Home's
 * chart the moment something is removed. Returns one removal id per row
 * written, for undo.
 */
export async function removeFromPantry(
  lines: RemovalLine[],
  reason: RemovalReason,
  note: string | null = null
): Promise<string[]> {
  if (lines.length === 0) return [];
  const body = await apiFetch<{ removalIds?: unknown }>('/api/pantry/remove', { items: lines, reason, note });
  refreshPantry();
  refreshKey(KEY);
  return Array.isArray(body.removalIds) ? body.removalIds.filter((id): id is string => typeof id === 'string') : [];
}

/**
 * Drops the history rows a removal wrote, by the ids removeFromPantry
 * returned. Call alongside putting the food back — food back on the shelf
 * was never really removed.
 */
export async function undoRemovals(removalIds: string[]) {
  if (removalIds.length === 0) return;
  await apiFetch('/api/pantry/history/undo', { removalIds });
  refreshKey(KEY);
}
