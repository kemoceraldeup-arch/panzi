// server/src/removalMigration.ts
//
// Converts rows written with the two retired removal reasons. Leftovers were
// cooked and eaten, so they become 'consumed'. Over-purchased food was bought
// and not used for a reason Panzi cannot tell apart, so it becomes 'other' and
// keeps what it used to say as its note.
//
// Takes the collection as an argument so it can be tested with a fake one.
// scripts/migrate-removal-reasons.ts passes the real collection, which skips
// Mongoose's enum check (the retired values are no longer in it).

export const REASON_CONVERSIONS = [
  { from: 'leftover', set: { reason: 'consumed' } },
  { from: 'over-purchased', set: { reason: 'other', note: 'Over-purchased' } },
] as const;

export type ReasonRows = {
  countDocuments(filter: { reason: string }): Promise<number>;
  updateMany(filter: { reason: string }, update: { $set: Record<string, string> }): Promise<{ modifiedCount: number }>;
};

/** Counts (dry run) or converts (apply) each retired reason, in order. */
export async function convertOldReasons(
  rows: ReasonRows,
  apply: boolean
): Promise<{ reason: string; count: number }[]> {
  const result: { reason: string; count: number }[] = [];
  for (const conversion of REASON_CONVERSIONS) {
    const filter = { reason: conversion.from };
    const count = apply
      ? (await rows.updateMany(filter, { $set: { ...conversion.set } })).modifiedCount
      : await rows.countDocuments(filter);
    result.push({ reason: conversion.from, count });
  }
  return result;
}
