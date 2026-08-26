// src/services/savedRecipes.ts
//
// Recipes the user kept.
//
// Suggestions are disposable — regenerated whenever the pantry moves, cached
// on the device, gone on reinstall. A saved recipe is the opposite: the user
// said they want this one again, so it goes to the database, survives the
// phone, and is stored whole rather than as a reference. A saved dish that
// quietly changed because tonight's pantry is different would be a strange
// thing to hand someone who asked to keep it.
//
// The document id is still built here, on the phone, from the uid and a slug of
// the title — so saving twice overwrites rather than duplicating, and unsaving
// needs no lookup. The server filters by the token's uid regardless: an id that
// happens to start with somebody else's uid is a convention, not a permission.

import { apiFetch } from '../config/api';
import { refreshKey, subscribeToKey } from './live';
import { Recipe } from './recipes';
import { lookFor } from '../theme/dishLooks';
import { dishKeyFor } from '../theme/dishPhotos';

const KEY = 'saved-recipes';

export type SavedRecipe = {
  id: string;
  savedAt: number;
  recipe: Recipe;
};

/**
 * The identity of a dish, for the heart.
 *
 * Title-based rather than a generated id, because the same dish suggested again
 * tomorrow is a new object with a new id but should show as already saved. Two
 * genuinely different dishes with identical titles collapse into one — rare,
 * and the failure is "the heart is already filled", which is survivable.
 */
export function savedKey(recipe: Recipe): string {
  return recipe.title.trim().toLowerCase();
}

// The document id, derived from the key so saving twice overwrites rather than
// duplicating, and unsaving needs no lookup.
function docId(uid: string, recipe: Recipe): string {
  const slug = savedKey(recipe).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  // Trimmed well inside the server's id ceiling. A uid is 28 characters, so
  // this only ever bites on a pathologically long title.
  return `${uid}__${slug || 'dish'}`.slice(0, 120);
}

function fromRow(row: any): SavedRecipe | null {
  const recipe = row?.recipe;
  if (!recipe || typeof recipe.title !== 'string') return null;

  return {
    id: row.id,
    savedAt: typeof row.savedAt === 'number' ? row.savedAt : 0,
    recipe: {
      title: recipe.title,
      look: lookFor(recipe.look),
      dishKey: dishKeyFor(recipe.dishKey),
      minutes: typeof recipe.minutes === 'number' ? recipe.minutes : 0,
      why: typeof recipe.why === 'string' ? recipe.why : '',
      // Always false on a saved dish. It described the pantry on the night the
      // recipe was suggested; whether a trip to the shop is needed now is a
      // different question, and answering it from stale data would be a guess.
      needsShopping: false,
      usesExpiring: Array.isArray(recipe.usesExpiring) ? recipe.usesExpiring : [],
      // Deliberately dropped on read. It named rows in the pantry as it stood
      // when the dish was saved; those rows are long eaten, and offering to
      // delete whatever holds those ids now would clear the wrong food.
      pantryUsed: [],
      ingredients: Array.isArray(recipe.ingredients) ? recipe.ingredients : [],
      steps: Array.isArray(recipe.steps) ? recipe.steps : [],
    },
  };
}

async function fetchSavedRecipes(): Promise<SavedRecipe[]> {
  const { saved } = await apiFetch<{ saved: any[] }>('/api/saved-recipes');
  // Already newest-first and capped by the server; the filter here is only
  // dropping rows whose recipe object did not survive whatever wrote it.
  return saved.map(fromRow).filter((row): row is SavedRecipe => row !== null);
}

export function subscribeToSavedRecipes(
  uid: string,
  callback: (saved: SavedRecipe[]) => void,
  onError: (err: Error) => void
) {
  return subscribeToKey(KEY, fetchSavedRecipes, callback, onError);
}

export async function saveRecipe(uid: string, recipe: Recipe): Promise<void> {
  await apiFetch('/api/saved-recipes/save', {
    id: docId(uid, recipe),
    key: savedKey(recipe),
    recipe,
  });
  refreshKey(KEY);
}

export async function unsaveRecipe(uid: string, recipe: Recipe): Promise<void> {
  await apiFetch('/api/saved-recipes/unsave', { id: docId(uid, recipe) });
  refreshKey(KEY);
}
