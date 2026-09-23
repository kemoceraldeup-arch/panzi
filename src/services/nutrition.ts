// src/services/nutrition.ts
//
// Looking up per-item macros from the server's FatSecret-backed endpoint.
// The server holds the actual API credentials — see server/src/routes/
// nutrition.ts — this file only shapes the request and the response.

import { apiFetch, ApiError } from '../config/api';
import type { Nutrition } from './pantry';

export type NutritionCandidates = {
  best: Nutrition;
  /** Other FatSecret matches for the same search, offered as a "not this?"
   *  override rather than requiring a pick up front — see the review card. */
  alternates: Nutrition[];
};

/**
 * Looks up macros for a scanned item's recognized name.
 *
 * Resolves to null when FatSecret has no match at all (the server's 404) —
 * that is a normal outcome for a name too generic or too obscure to match,
 * not a failure the caller needs to report. Any other failure (network,
 * rate limit, server unavailable) is rethrown as the ApiError it already is,
 * since those are worth telling the difference between "not found" and
 * "couldn't check".
 */
export async function lookupNutrition(name: string): Promise<NutritionCandidates | null> {
  try {
    return await apiFetch<NutritionCandidates>('/api/nutrition/lookup', { name });
  } catch (err) {
    if (err instanceof ApiError && err.code === 'not-found') return null;
    throw err;
  }
}

export type RecipeNutritionEstimate = {
  perServing: { calories: number; proteinG: number; carbsG: number; fatG: number };
  /** How much of the recipe the estimate actually covers — an ingredient
   *  with an unparseable amount ("a handful") or no FatSecret match is left
   *  out of the total rather than guessed at, so this is always <= totalCount
   *  and worth showing alongside the numbers rather than hiding. */
  matchedCount: number;
  totalCount: number;
  /** Fraction (0-1) of the recipe's parseable mass the total actually
   *  accounts for, weighted by each ingredient's real amount rather than by
   *  a flat per-ingredient count. A recipe can match 8 of 9 ingredients by
   *  count and still have this be low, if the one that didn't match is the
   *  main ingredient by weight — matchedCount/totalCount alone would call
   *  that a good match. Use this, not the counts, to judge how much to
   *  trust the numbers. */
  coverage: number;
};

/**
 * Estimates a recipe's per-serving macros from its own ingredient list —
 * each ingredient looked up and scaled by its actual amount, then summed —
 * rather than searching FatSecret for the dish's title, which matches
 * whatever unrelated packaged product ranks first and reports that
 * product's own serving size, not this recipe's.
 *
 * Resolves to null on the server's 404 (nothing in the ingredient list
 * could be matched at all), the same "not found, not a failure" contract
 * lookupNutrition uses above.
 */
export async function lookupRecipeNutrition(
  ingredients: { name: string; amount: string }[],
  servings: number
): Promise<RecipeNutritionEstimate | null> {
  try {
    return await apiFetch<RecipeNutritionEstimate>('/api/nutrition/recipe', {
      ingredients,
      servings,
    });
  } catch (err) {
    if (err instanceof ApiError && err.code === 'not-found') return null;
    throw err;
  }
}
