// src/services/removalAmount.ts
//
// How much of a pantry item is leaving, as the two strings the server stores:
// what History records as removed, and what stays on the shelf. Both are
// written in the item's own measure and words ("2 eggs" out of "5 eggs"
// leaves "3 eggs"), through the same quantity model the edit sheet uses, so a
// row the user shrinks reads the same as one they typed.

import {
  ItemQuantity,
  Measure,
  formatQuantityString,
  minFor,
  parseQuantityString,
  unitWordOf,
} from './quantity';

/** One item's part of a removal, as /api/pantry/remove takes it. */
export type RemovalLine = { id: string; removed: string; remaining: string | null };

export type Removable = { full: ItemQuantity; unit: string };

/**
 * The item's amount as something a stepper can count down from, or null when
 * the only sensible choice is All: no number to count ("a bit"), or no more
 * than one step of it (1 egg, 30 g), where any part is the whole.
 */
export function removableAmount(quantity: string): Removable | null {
  const text = quantity.trim();
  if (!/^[\d.¼½¾]/.test(text)) return null;
  const full = parseQuantityString(text);
  if (!(full.amount > minFor(full.measure, full.splittable))) return null;
  return { full, unit: unitWordOf(text) };
}

/** Rounds an amount the way a pantry row stores it: whole grams and
 *  millilitres, quarters of packs and pieces. */
export function settleAmount(measure: Measure, amount: number): number {
  if (measure === 'weight' || measure === 'volume') return Math.round(amount);
  return Math.round(amount * 4) / 4;
}

/**
 * What taking `take` (in the item's base unit) out of `quantity` records and
 * leaves. 'all', or anything that leaves nothing, removes the item and
 * records its quantity as it was.
 */
export function splitRemoval(id: string, quantity: string, take: number | 'all'): RemovalLine {
  const whole: RemovalLine = { id, removed: quantity.trim() || 'All', remaining: null };
  if (take === 'all') return whole;
  if (!(take > 0)) throw new Error('A removal has to take something.');

  const removable = removableAmount(quantity);
  if (!removable) return whole;
  const { full, unit } = removable;
  const taken = settleAmount(full.measure, take);
  if (taken <= 0) throw new Error('A removal has to take something.');
  const left = settleAmount(full.measure, full.amount - taken);
  if (taken >= full.amount || left <= 0) return whole;

  return {
    id,
    removed: formatQuantityString({ ...full, amount: taken }, unit),
    remaining: formatQuantityString({ ...full, amount: left }, unit),
  };
}
