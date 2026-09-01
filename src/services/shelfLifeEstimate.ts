// src/services/shelfLifeEstimate.ts
//
// A shelf-life estimate for a hand-typed pantry item — see
// server/src/routes/estimateShelfLife.ts for why this is its own small call
// rather than a mode of the camera scan. Nothing here belongs in
// services/scan.ts, which is built around a captured photo; this has none.

import { apiFetch, ApiError } from '../config/api';
import { dateInDays } from '../utils/freshness';

export type ShelfLifeEstimate = { expiryDate: string } | { error: string };

/**
 * Estimates how long a hand-typed item keeps, from its name/category and
 * whether it has been opened. Resolves to `{error}` rather than throwing —
 * same posture as lookupNutrition: a failed or unmatched estimate is a
 * normal outcome the caller shows inline, not an exception to unwind.
 */
export async function estimateShelfLife(
  name: string,
  category: string,
  openedState: 'opened' | 'unopened'
): Promise<ShelfLifeEstimate> {
  try {
    const result = await apiFetch<
      { ok: true; shelfLifeDays: number } | { ok: false; message: string }
    >('/api/estimate-shelf-life', { name, category, openedState });

    if (!result.ok) return { error: result.message };
    return { expiryDate: dateInDays(result.shelfLifeDays) };
  } catch (err) {
    return {
      error: err instanceof ApiError ? err.message : 'Could not estimate that — try again.',
    };
  }
}
