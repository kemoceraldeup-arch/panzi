// src/services/recipeRatings.ts
//
// What "Rate this cook" sends, once a star is picked on cook mode's complete
// sheet. Same title-based identity as savedRecipes.ts — there is no stable
// recipe id, so the dish's own title (trimmed, lowercased) is what a second
// rating of the same dish overwrites rather than duplicates.

import { apiFetch } from '../config/api';

/** The document id, built here so a second rating of the same dish (by the
 *  same user) overwrites rather than accumulating rows. */
function docId(uid: string, title: string): string {
  const slug = title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${uid}__${slug || 'dish'}`.slice(0, 120);
}

export async function rateRecipe(uid: string, title: string, stars: number): Promise<void> {
  await apiFetch('/api/recipe-ratings', {
    id: docId(uid, title),
    title,
    stars,
  });
}
