// src/services/cookbook.ts
//
// The cookbook behind the Recipes screen's category tabs with Pantry Only
// off. Admins edit it from the console (server/src/routes/adminCookbook.ts);
// this reads it from GET /api/cookbook.
//
// Three sources, best first, so the screen is never empty:
//
//   the server            →  what admins last saved
//   the last list fetched →  kept on the phone, for when the server is away
//   data/localRecipes.ts  →  the list built into the app, for a first launch
//                            with no connection
//
// Same everyone, so the copy on the phone is one entry, not one per account.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiFetch } from '../config/api';
import { LOCAL_RECIPES, LocalRecipe, LocalRecipeCategory } from '../data/localRecipes';
import { lookFor } from '../theme/dishLooks';
import { dishKeyFor } from '../theme/dishPhotos';

export type CookbookRecipe = LocalRecipe & {
  /** A photo uploaded from the admin console. Null for the dishes whose photo
   *  ships with the app (dishKey), and for new ones nobody added a photo to. */
  photoUrl: string | null;
};

const CACHE_KEY = 'cookbook:v1';
const CATEGORIES: LocalRecipeCategory[] = ['quick', 'ulam', 'merienda'];

export const BUILT_IN_COOKBOOK: CookbookRecipe[] = LOCAL_RECIPES.map((r) => ({ ...r, photoUrl: null }));

/** Whatever the server or an old cache sent, made safe to render. A row that
 *  cannot be shown is dropped rather than crashing the screen. */
function normalise(rows: unknown): CookbookRecipe[] {
  if (!Array.isArray(rows)) return [];
  const out: CookbookRecipe[] = [];
  for (const raw of rows as any[]) {
    if (!raw || typeof raw.title !== 'string' || !CATEGORIES.includes(raw.category)) continue;
    out.push({
      title: raw.title,
      dishKey: dishKeyFor(raw.dishKey),
      look: lookFor(raw.look),
      category: raw.category,
      minutes: Number(raw.minutes) || 0,
      servings: Number(raw.servings) || 0,
      description: typeof raw.description === 'string' ? raw.description : '',
      ingredients: Array.isArray(raw.ingredients)
        ? raw.ingredients
            .filter((i: any) => i && typeof i.name === 'string')
            .map((i: any) => ({ name: i.name, amount: typeof i.amount === 'string' ? i.amount : '' }))
        : [],
      steps: Array.isArray(raw.steps) ? raw.steps.filter((s: any) => typeof s === 'string') : [],
      photoUrl: typeof raw.photoUrl === 'string' && raw.photoUrl ? raw.photoUrl : null,
    });
  }
  return out;
}

/** The list last fetched from the server, or null if there has never been one. */
export async function loadCachedCookbook(): Promise<CookbookRecipe[] | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const rows = normalise(JSON.parse(raw));
    return rows.length ? rows : null;
  } catch {
    return null;
  }
}

/**
 * The cookbook as admins last saved it. Throws when the server cannot be
 * reached; the caller keeps showing what it already has.
 *
 * An empty answer is not trusted on its own: it is what a server whose
 * collection was never seeded sends, and replacing a full cookbook with nothing
 * would read as the app being broken. The built-in list stays in that case.
 */
export async function fetchCookbook(): Promise<CookbookRecipe[]> {
  const { recipes } = await apiFetch<{ recipes: unknown }>('/api/cookbook');
  const rows = normalise(recipes);
  if (!rows.length) return BUILT_IN_COOKBOOK;
  try {
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(rows));
  } catch {
    // A full disk costs the offline copy, not the list on screen.
  }
  return rows;
}
