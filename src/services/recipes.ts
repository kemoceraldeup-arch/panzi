// src/services/recipes.ts
//
// Suggestions for tonight: fetching them, and — more importantly — knowing when
// not to.
//
// Every call to the recipe route costs money and a few seconds of the user
// staring at a loading state. Opening the tab is not new information, so the
// screen should almost never trigger one. What *is* new information is the
// pantry changing, the profile changing, or the day rolling over, and the
// signature below is how those three are detected.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiFetch, ApiError } from '../config/api';
import { PantryItem } from './pantry';
import { UserProfile } from './profile';
import { getDaysLeft } from '../utils/freshness';
import { isUrgentStage } from '../utils/ripeness';
import { DishLook, lookFor } from '../theme/dishLooks';
import { DishKey, dishKeyFor } from '../theme/dishPhotos';

export type RecipeIngredient = {
  name: string;
  amount: string;
  /** In the pantry already. Drives the have/need split on the detail screen. */
  have: boolean;
};

export type Recipe = {
  title: string;
  /** Which gradient and glyph the card draws when there is no photo. */
  look: DishLook;
  /** Which named dish this is, for the photo lookup. 'other' most of the
   *  time, and 'other' is fine — it falls back to the tile. */
  dishKey: DishKey;
  /** 0 when the model gave a figure that wasn't believable; screens hide it. */
  minutes: number;
  why: string;
  /** The pantry couldn't carry a decent dish, so this one needs a real trip to
   *  the shop. The card says so rather than pretending it's an ordinary pick. */
  needsShopping: boolean;
  usesExpiring: string[];
  /** Pantry item names this dish consumes, already checked against the pantry
   *  by the route. Cook mode offers to clear these once the dish is made. */
  pantryUsed: string[];
  ingredients: RecipeIngredient[];
  steps: string[];
};

/** What the user tapped on the chip row. Mirrors MOODS in the route. */
export type RecipeMood = 'anything' | 'quick' | 'ulam' | 'merienda' | 'no_shopping';

export const MOODS: { id: RecipeMood; label: string }[] = [
  { id: 'anything', label: 'Anything' },
  { id: 'quick', label: 'Quick' },
  { id: 'ulam', label: 'Ulam' },
  { id: 'merienda', label: 'Merienda' },
  { id: 'no_shopping', label: 'Nothing to buy' },
];

/** A suggestion the server produced and then dropped. Surfaced so a short list
 *  has an explanation instead of looking like a bad night. */
export type SkippedRecipe = { reason: 'diet' | 'allergy'; term: string };

export type RecipeSet = {
  featured: Recipe | null;
  alternates: Recipe[];
  skipped: SkippedRecipe[];
};

/** Raised for anything the user can act on; the caller shows the message. */
export class RecipeError extends Error {}

// Regenerated at least this often even if nothing changed, so a pantry that
// sits untouched for a week doesn't keep serving Monday's idea on Friday.
const MAX_CACHE_AGE_MS = 24 * 60 * 60 * 1000;

// How many items are sent. The route caps this too; sorting here means the cap
// keeps the *useful* ones rather than whichever Firestore returned first.
const MAX_ITEMS_SENT = 60;

const CACHE_PREFIX = 'panzi.recipes.';

type CachedSet = {
  signature: string;
  generatedAt: number;
  set: RecipeSet;
};

/** One entry per mood under a single key. Flipping between Quick and Ulam and
 *  back is browsing, not a new question, and must not cost two calls. */
type CacheFile = Partial<Record<RecipeMood, CachedSet>>;

/**
 * Pantry ordered the way the recipe route should read it: what needs eating
 * first, because that is what it is being asked to build around.
 */
function orderForSuggestion(items: PantryItem[]): PantryItem[] {
  const rank = (item: PantryItem) => {
    if (item.ripeness && isUrgentStage(item.ripeness)) return -1;
    return getDaysLeft(item.expiryDate) ?? 9999;
  };
  return [...items].sort((a, b) => rank(a) - rank(b)).slice(0, MAX_ITEMS_SENT);
}

/**
 * A fingerprint of everything a suggestion depends on.
 *
 * Today's date is in here deliberately. The same pantry means something
 * different tomorrow — an item with "3 days left" now has 2 — so a signature
 * built from the items alone would happily serve a week-old suggestion that
 * talks about food already thrown away.
 *
 * Quantities are left out: eating half the spinach doesn't change what to cook
 * with it, and including them would burn a call on every small edit.
 */
export function pantrySignature(items: PantryItem[], profile: UserProfile): string {
  const today = new Date();
  const day = `${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`;

  const pantry = items
    .map((item) => `${item.id}:${item.expiryDate ?? ''}:${item.ripeness ?? ''}`)
    .sort()
    .join('|');

  const diet = [...profile.dietary].sort().join(',');
  const allergies = [...profile.allergies].sort().join(',');

  return `${day}#${diet}#${allergies}#${pantry}`;
}

export async function fetchRecipes(
  items: PantryItem[],
  profile: UserProfile,
  mood: RecipeMood
): Promise<RecipeSet> {
  const payload = {
    mood,
    items: orderForSuggestion(items).map((item) => ({
      name: item.name,
      quantity: item.quantity,
      category: item.category,
      location: item.location,
      expiryDate: item.expiryDate,
      dateSource: item.dateSource,
      ripeness: item.ripeness,
      daysLeft: getDaysLeft(item.expiryDate),
    })),
    dietary: profile.dietary,
    allergies: profile.allergies,
  };

  try {
    return normaliseSet(await apiFetch<RecipeSet>('/api/recipes', payload));
  } catch (err) {
    const code = err instanceof ApiError ? err.code : null;
    if (code === 'unauthenticated') {
      throw new RecipeError('Sign in again to get suggestions.');
    }
    if (code === 'resource-exhausted') {
      throw new RecipeError("I've been thinking a lot today — try again in a bit.");
    }
    if (code === 'unreachable' && err instanceof ApiError) {
      // Names the address it tried; the usual cause is a stale IP in .env after
      // changing network, and "check your connection" sends the user looking in
      // the wrong place for that.
      throw new RecipeError(err.message);
    }
    throw new RecipeError("Couldn't reach the kitchen — check your connection and try again.");
  }
}

/**
 * Fills in the two fields that suggestions cached before this version don't
 * carry, so an old entry renders a plate glyph and offers nothing to clear
 * rather than crashing a card on `undefined.length`.
 */
function normaliseRecipe(recipe: Recipe): Recipe {
  return {
    ...recipe,
    look: lookFor(recipe.look),
    dishKey: dishKeyFor(recipe.dishKey),
    needsShopping: recipe.needsShopping === true,
    usesExpiring: recipe.usesExpiring ?? [],
    pantryUsed: recipe.pantryUsed ?? [],
  };
}

function normaliseSet(set: RecipeSet): RecipeSet {
  return {
    featured: set.featured ? normaliseRecipe(set.featured) : null,
    alternates: (set.alternates ?? []).map(normaliseRecipe),
    skipped: set.skipped ?? [],
  };
}

// ─── Cache ────────────────────────────────────────────────────────────────
//
// Device-local rather than Firestore: a suggestion is disposable, worthless on
// another device an hour later, and not worth a collection or a security rule.
// Every call fails to "no cache" rather than throwing — the cost of a failed
// read is one extra API call, and that is much cheaper than a crash on a screen
// the user just opened.

async function readCacheFile(uid: string): Promise<CacheFile> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_PREFIX + uid);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    // Entries written before moods existed were a bare CachedSet, not a map.
    // Discarded rather than migrated — it is one API call to replace, and
    // guessing which mood an old entry belonged to would get it wrong.
    if (!parsed || typeof parsed !== 'object' || 'signature' in parsed) return {};
    return parsed as CacheFile;
  } catch {
    return {};
  }
}

export async function loadCachedRecipes(
  uid: string,
  signature: string,
  mood: RecipeMood
): Promise<RecipeSet | null> {
  const cached = (await readCacheFile(uid))[mood];
  if (!cached) return null;
  if (cached.signature !== signature) return null;
  if (Date.now() - cached.generatedAt > MAX_CACHE_AGE_MS) return null;
  if (!cached.set?.featured) return null;

  return normaliseSet(cached.set);
}

export async function saveCachedRecipes(
  uid: string,
  signature: string,
  mood: RecipeMood,
  set: RecipeSet
): Promise<void> {
  try {
    // Read-modify-write. The other moods' entries are still good — the pantry
    // has not changed, only which question was asked of it.
    const file = await readCacheFile(uid);
    file[mood] = { signature, generatedAt: Date.now(), set };
    await AsyncStorage.setItem(CACHE_PREFIX + uid, JSON.stringify(file));
  } catch {
    // A failed write costs one extra call next time the screen opens.
  }
}

// ─── Display helpers ──────────────────────────────────────────────────────

/** The counts the existing FeaturedRecipeCard renders, derived rather than
 *  asked for — the model should not be counting its own list. */
export function ingredientCounts(recipe: Recipe): { have: number; total: number } {
  return {
    have: recipe.ingredients.filter((i) => i.have).length,
    total: recipe.ingredients.length,
  };
}

/**
 * The pantry rows a recipe says it uses, resolved back to real items.
 *
 * Exact name first, then case-insensitive. Nothing looser than that: this list
 * becomes a set of tick boxes that delete someone's groceries, and a fuzzy
 * match that pairs "Milk" with "Coconut milk" throws away the wrong carton. A
 * name that doesn't resolve is simply not offered — the cost is one item the
 * user clears by hand, which is the cheap direction to be wrong in.
 */
/**
 * A recipe's ingredients, with `have` re-checked against the pantry as it
 * stands right now rather than trusted from wherever the recipe came from.
 *
 * Built for chat: a recipe card there is stored once, in Mongo, the moment
 * Panzi replies — see server/src/routes/chat.ts. Reopening that conversation
 * later would otherwise replay that frozen snapshot, so a "Ground beef" ticked
 * off as owned stays ticked off in the chat transcript even after Cook Mode
 * cleared it from the pantry. Freshly-generated suggestions from
 * routes/recipes.ts don't need this — they're already checked against the
 * pantry that was just sent — but nothing about calling it on one of those is
 * wrong either, since a name either matches the current pantry or it doesn't.
 */
export function withLiveIngredients(recipe: Recipe, items: PantryItem[]): Recipe {
  const owned = new Set<string>();
  for (const item of items) {
    owned.add(item.name);
    owned.add(item.name.toLowerCase());
  }

  return {
    ...recipe,
    ingredients: recipe.ingredients.map((ingredient) => ({
      ...ingredient,
      have: owned.has(ingredient.name) || owned.has(ingredient.name.toLowerCase()),
    })),
  };
}

export function matchPantryUsed(recipe: Recipe, items: PantryItem[]): PantryItem[] {
  if (recipe.pantryUsed.length === 0) return [];

  const byName = new Map<string, PantryItem>();
  for (const item of items) {
    // First writer wins, so two identically named rows resolve to one deletion
    // rather than clearing a duplicate the user still has.
    if (!byName.has(item.name)) byName.set(item.name, item);
    const lower = item.name.toLowerCase();
    if (!byName.has(lower)) byName.set(lower, item);
  }

  const found: PantryItem[] = [];
  const seen = new Set<string>();
  for (const name of recipe.pantryUsed) {
    const item = byName.get(name) ?? byName.get(name.toLowerCase());
    if (item && !seen.has(item.id)) {
      seen.add(item.id);
      found.push(item);
    }
  }
  return found;
}
