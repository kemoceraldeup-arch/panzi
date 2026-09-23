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
import { PantryItem, parseQuantity } from './pantry';
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
  /** have is false only because this is a basic staple (rice, salt, oil…)
   *  every suggestion already assumes is in the house — not a real gap. */
  assumedStaple: boolean;
  /** True when this is a nice-to-have that improves the dish but isn't
   *  required to make it — only ever set by chat's PANTRY ONLY mode
   *  (server/src/routes/chat.ts); absent/false everywhere else, including
   *  every suggestion from this file's own fetchFeaturedRecipe/browse calls. */
  optional?: boolean;
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
  /** How many people this recipe as written feeds. 0 when the model gave a
   *  figure that wasn't believable, or on anything cached before this field
   *  existed — screens hide the servings control rather than showing "0". */
  servings: number;
  /** What the dish IS, for someone who's never heard of it — "A Filipino
   *  classic of chicken braised in soy sauce, vinegar and garlic." Distinct
   *  from `why`, which is the reason it's suggested tonight specifically.
   *  '' on anything cached before this field existed — see normaliseRecipe. */
  description: string;
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
export type RecipeMood = 'anything' | 'quick' | 'ulam' | 'merienda';

// Labels only — the `id` values are what the server's own MOODS list
// (server/src/routes/recipes.ts) and readMood() key off, so those stay
// exactly as they are even though the on-screen wording changed.
export const MOODS: { id: RecipeMood; label: string }[] = [
  { id: 'anything', label: 'All' },
  // Was "Quick and Easy" — the one label long enough to truncate or force
  // a shared shrink across all four tabs on a narrow phone. "Quick" alone
  // keeps the same length ballpark as "Snacks"/"All" so every tab renders
  // at one fixed size with no per-label measuring needed.
  { id: 'quick', label: 'Quick' },
  { id: 'ulam', label: 'Main Dish' },
  { id: 'merienda', label: 'Snacks' },
];

/** A suggestion the server produced and then dropped. Surfaced so a short list
 *  has an explanation instead of looking like a bad night. */
export type SkippedRecipe = { reason: 'diet' | 'allergy'; term: string };

export type RecipeSet = {
  featured: Recipe | null;
  alternates: Recipe[];
  skipped: SkippedRecipe[];
};

/** "All Recipes" — a browse list, not a pantry-anchored suggestion set. No
 *  featured/alternates split, because there's no "the one pick" here. */
export type BrowseRecipeSet = {
  recipes: Recipe[];
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

// Bumped whenever a cached entry's shape gains a field later code depends on
// to mean something — assumedStaple was the first (2); the browse list's own
// shape existing at all is the second (3). A cached entry written before a
// bump would otherwise sit there looking current (same signature, same day)
// while missing what the new code actually needs from it.
const CACHE_SCHEMA_VERSION = 3;

type CachedSet = {
  signature: string;
  generatedAt: number;
  schemaVersion: number;
  set: RecipeSet;
};

type CachedBrowseSet = {
  signature: string;
  generatedAt: number;
  schemaVersion: number;
  set: BrowseRecipeSet;
};

/** One entry per mood under a single key, plus a sibling slot for the browse
 *  list — same per-uid file, same read-modify-write, since it's one more
 *  question about the same account rather than a different kind of cache. */
type CacheFile = Partial<Record<RecipeMood, CachedSet>> & { browse?: CachedBrowseSet };

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
 * Quantity is in here too, even though eating half the spinach doesn't change
 * which dish gets suggested: isCookableFromPantry now checks quantity, not
 * just presence, so a quantity edit can flip Pantry Only's answer for a
 * recipe already on screen (crossing the threshold the recipe needs) without
 * changing what the model would suggest. This does mean a small edit can
 * trigger a real re-fetch — a stale "cookable" answer would be worse, since
 * Pantry Only's whole job is telling the user what needs zero shopping.
 */
export function pantrySignature(items: PantryItem[], profile: UserProfile): string {
  const today = new Date();
  const day = `${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`;

  const pantry = items
    .map((item) => `${item.id}:${item.expiryDate ?? ''}:${item.ripeness ?? ''}:${item.quantity}`)
    .sort()
    .join('|');

  const diet = [...profile.dietary].sort().join(',');
  const allergies = [...profile.allergies].sort().join(',');

  return `${day}#${diet}#${allergies}#${pantry}`;
}

/**
 * A fingerprint for the browse list — deliberately missing the pantry
 * entirely. "All Recipes" doesn't change *which dishes* are shown because an
 * item was scanned in or used up; only the day rolling over or the diet/
 * allergy rules changing are real new information for a list that was never
 * built around the pantry. The pantry is still sent with every fetch (see
 * fetchBrowseRecipes) so each ingredient's "have" — what Pantry Only reads —
 * comes back accurate for whichever pantry was current at that fetch; it
 * just isn't part of what decides whether to fetch again.
 */
export function browseSignature(profile: UserProfile): string {
  const today = new Date();
  const day = `${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`;

  const diet = [...profile.dietary].sort().join(',');
  const allergies = [...profile.allergies].sort().join(',');

  return `${day}#${diet}#${allergies}`;
}

function suggestionPayload(
  items: PantryItem[],
  profile: UserProfile,
  mood: RecipeMood,
  avoidTitles: string[]
) {
  return {
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
    avoidTitles,
  };
}

/** Turns a raw fetch failure into the message a screen actually shows —
 *  shared by fetchFeaturedRecipe and fetchAlternateRecipes so the two halves
 *  of a split suggestion call fail the same way. */
function toRecipeError(err: unknown): RecipeError {
  const code = err instanceof ApiError ? err.code : null;
  if (code === 'unauthenticated') {
    return new RecipeError('Sign in again to get suggestions.');
  }
  if (code === 'resource-exhausted') {
    return new RecipeError("I've been thinking a lot today — try again in a bit.");
  }
  if (code === 'unreachable' && err instanceof ApiError) {
    // Names the address it tried; the usual cause is a stale IP in .env after
    // changing network, and "check your connection" sends the user looking in
    // the wrong place for that.
    return new RecipeError(err.message);
  }
  // Every other server-returned code (internal, unavailable, invalid-
  // argument, ...) carries its own real message from the route — a
  // malformed model response, a bad request, whatever it actually was.
  // This used to collapse all of those into "Couldn't reach the kitchen",
  // which is only true for the 'unreachable' branch above; a genuine
  // server-side failure showing that exact wording sent people checking
  // their wifi for a problem that was never a connectivity one.
  if (err instanceof ApiError && err.message) {
    return new RecipeError(err.message);
  }
  return new RecipeError("Couldn't reach the kitchen — check your connection and try again.");
}

/**
 * The one featured dish — deliberately its own call, not the first half of
 * fetchRecipes. Writing three full recipes (title, description, every
 * ingredient, every step) in one request is what used to make the recipes
 * screen sit on a loading skeleton for several seconds before anything
 * appeared; asking for one recipe instead of three is most of that time
 * back. The caller renders this the moment it resolves, then calls
 * fetchAlternateRecipes separately — see RecipesScreen's build().
 */
export async function fetchFeaturedRecipe(
  items: PantryItem[],
  profile: UserProfile,
  mood: RecipeMood,
  avoidTitles: string[] = []
): Promise<{ featured: Recipe | null; skipped: SkippedRecipe[] }> {
  try {
    const raw = await apiFetch<{ featured: Recipe | null; skipped: SkippedRecipe[] }>(
      '/api/recipes/featured',
      suggestionPayload(items, profile, mood, avoidTitles)
    );
    return {
      featured: raw.featured ? normaliseRecipe(raw.featured) : null,
      skipped: raw.skipped ?? [],
    };
  } catch (err) {
    throw toRecipeError(err);
  }
}

/**
 * The two alternates, fetched separately from — and normally after —
 * fetchFeaturedRecipe above. `avoidTitles` should include the featured
 * dish's own title (on top of whatever session history the caller already
 * tracks) so this call doesn't waste itself rediscovering the same dish.
 */
export async function fetchAlternateRecipes(
  items: PantryItem[],
  profile: UserProfile,
  mood: RecipeMood,
  avoidTitles: string[] = []
): Promise<{ alternates: Recipe[]; skipped: SkippedRecipe[] }> {
  try {
    const raw = await apiFetch<{ alternates: Recipe[]; skipped: SkippedRecipe[] }>(
      '/api/recipes/alternates',
      suggestionPayload(items, profile, mood, avoidTitles)
    );
    return {
      alternates: (raw.alternates ?? []).map(normaliseRecipe),
      skipped: raw.skipped ?? [],
    };
  } catch (err) {
    throw toRecipeError(err);
  }
}

/** "All Recipes" — the pantry is sent only so each ingredient's "have" comes
 *  back accurate (what Pantry Only filters on), not to shape which dishes are
 *  suggested — browseSignature deliberately leaves the pantry out, so this
 *  list still only regenerates once a day or on a diet/allergy change, never
 *  because an item was scanned in or used up. A pull-to-refresh or Shuffle
 *  re-sends whatever the pantry looks like at that moment; between those, the
 *  "have" data on screen is only as fresh as the last regeneration, same as
 *  the dishes themselves. Same error handling as fetchFeaturedRecipe/
 *  fetchAlternateRecipes (see toRecipeError), kept as its own copy below
 *  since this route's payload has no mood field to share a builder with. */
export async function fetchBrowseRecipes(
  profile: UserProfile,
  items: PantryItem[],
  avoidTitles: string[] = []
): Promise<BrowseRecipeSet> {
  const payload = {
    dietary: profile.dietary,
    allergies: profile.allergies,
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
    avoidTitles,
  };

  try {
    return normaliseBrowseSet(await apiFetch<BrowseRecipeSet>('/api/recipes/browse', payload));
  } catch (err) {
    const code = err instanceof ApiError ? err.code : null;
    if (code === 'unauthenticated') {
      throw new RecipeError('Sign in again to get suggestions.');
    }
    if (code === 'resource-exhausted') {
      throw new RecipeError("I've been thinking a lot today — try again in a bit.");
    }
    if (code === 'unreachable' && err instanceof ApiError) {
      throw new RecipeError(err.message);
    }
    throw new RecipeError("Couldn't reach the kitchen — check your connection and try again.");
  }
}

/**
 * A generated photo for a dish outside the hand-curated dishKey list — the
 * server checks its own storage first and only pays to generate one the first
 * time a given title is ever asked for (see server/src/routes/dishPhoto.ts).
 *
 * Returns null on any failure rather than throwing. A missing photo is not an
 * error to this caller — DishTile already has a finished fallback (the
 * gradient tile), so a network hiccup here should look exactly like "no photo
 * yet," not surface an error state over a recipe that otherwise loaded fine.
 */
export async function fetchDishPhoto(title: string): Promise<string | null> {
  try {
    const { url } = await apiFetch<{ url: string }>('/api/dish-photo', { title });
    return url || null;
  } catch {
    return null;
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
    // A recipe cached before this field existed comes back with it missing
    // entirely, not null — same reasoning as look/dishKey above.
    description: recipe.description ?? '',
    // 0 is the same "not believable" sentinel cleanRecipe uses server-side —
    // the detail screen hides the servings stepper rather than seeding it
    // with a guessed number.
    servings: typeof recipe.servings === 'number' ? recipe.servings : 0,
    needsShopping: recipe.needsShopping === true,
    usesExpiring: recipe.usesExpiring ?? [],
    pantryUsed: recipe.pantryUsed ?? [],
    // Cached before assumedStaple existed: false is the safe default — it
    // means "treat as a real gap", which only makes Pantry Only stricter on
    // stale cache entries rather than wrongly calling something cookable.
    ingredients: (recipe.ingredients ?? []).map((i) => ({
      ...i,
      assumedStaple: i.assumedStaple === true,
    })),
  };
}

function normaliseSet(set: RecipeSet): RecipeSet {
  return {
    featured: set.featured ? normaliseRecipe(set.featured) : null,
    alternates: (set.alternates ?? []).map(normaliseRecipe),
    skipped: set.skipped ?? [],
  };
}

function normaliseBrowseSet(set: BrowseRecipeSet): BrowseRecipeSet {
  return {
    recipes: (set.recipes ?? []).map(normaliseRecipe),
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
  // Missing entirely on anything written before schemaVersion existed —
  // treated the same as an old version, not as "current, unversioned".
  if ((cached.schemaVersion ?? 0) !== CACHE_SCHEMA_VERSION) return null;
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
    file[mood] = { signature, generatedAt: Date.now(), schemaVersion: CACHE_SCHEMA_VERSION, set };
    await AsyncStorage.setItem(CACHE_PREFIX + uid, JSON.stringify(file));
  } catch {
    // A failed write costs one extra call next time the screen opens.
  }
}

export async function loadCachedBrowse(
  uid: string,
  signature: string
): Promise<BrowseRecipeSet | null> {
  const cached = (await readCacheFile(uid)).browse;
  if (!cached) return null;
  if (cached.signature !== signature) return null;
  if ((cached.schemaVersion ?? 0) !== CACHE_SCHEMA_VERSION) return null;
  if (Date.now() - cached.generatedAt > MAX_CACHE_AGE_MS) return null;
  if (cached.set?.recipes?.length === 0) return null;

  return normaliseBrowseSet(cached.set);
}

export async function saveCachedBrowse(
  uid: string,
  signature: string,
  set: BrowseRecipeSet
): Promise<void> {
  try {
    const file = await readCacheFile(uid);
    file.browse = { signature, generatedAt: Date.now(), schemaVersion: CACHE_SCHEMA_VERSION, set };
    await AsyncStorage.setItem(CACHE_PREFIX + uid, JSON.stringify(file));
  } catch {
    // A failed write costs one extra call next time the screen opens.
  }
}

// ─── Display helpers ──────────────────────────────────────────────────────

/** The counts the recipe card renders, derived rather than asked for — the
 *  model should not be counting its own list. Raw `have`, not softened by
 *  assumedStaple: this is "how much of this did I actually already own",
 *  the same honest split RecipeDetailScreen's You have/You'll need uses. */
export function ingredientCounts(recipe: Recipe): { have: number; total: number } {
  return {
    have: recipe.ingredients.filter((i) => i.have).length,
    total: recipe.ingredients.length,
  };
}

/**
 * Whether this recipe needs an actual trip to the shop.
 *
 * Different question from ingredientCounts: an ingredient marked have:false
 * because it's an assumed pantry staple (rice, salt, oil…) isn't something
 * the user needs to go and buy — it's just something the pantry list itself
 * never carries. "Cookable with zero shopping" means every ingredient is
 * either in the pantry or one of those staples, not that the pantry
 * literally contains 100% of the list.
 *
 * `pantry` is optional so every existing call site that only has the recipe
 * (and no live pantry to check quantities against) keeps working exactly as
 * before — presence-only. Passed in, it adds one more way an ingredient can
 * fail: present by name, but not in the quantity the recipe actually needs.
 * That check only fires when both amounts parse to the same unit; anything
 * it can't compare confidently is left as a pass, same as today.
 */
export function isCookableFromPantry(recipe: Recipe, pantry?: PantryItem[]): boolean {
  if (recipe.ingredients.length === 0) return false;
  return recipe.ingredients.every((i) => {
    if (!i.have && !i.assumedStaple) return false;
    if (!pantry || !i.have) return true;
    return hasEnoughQuantity(i.name, i.amount, pantry) !== false;
  });
}

/**
 * The loosest useful Pantry Only rule: does this recipe use anything
 * actually on the shelf at all — not "zero shopping needed" (that's
 * isCookableFromPantry above, still the right question for a big, varied
 * pantry), but "worth a look" for a pantry that's still small. A one-item
 * pantry will almost never clear the zero-shopping bar — every real dish
 * needs more than one ingredient — which is exactly the state that made
 * Pantry Only look broken rather than just strict: three matching recipes
 * existed, the toggle just never had a reason to say so.
 *
 * `assumedStaple` ingredients don't count toward "uses what you have" —
 * every suggestion already assumes those regardless of the pantry, so a
 * recipe whose only overlap is "has rice, needs everything else" would
 * otherwise pass on a fact that isn't really about this pantry at all.
 */
export function usesPantryItems(recipe: Recipe, pantry?: PantryItem[]): boolean {
  if (!pantry || pantry.length === 0) return false;
  return recipe.ingredients.some((i) => {
    if (!i.have || i.assumedStaple) return false;
    return hasEnoughQuantity(i.name, i.amount, pantry) !== false;
  });
}

// The handful of unit words this app's own recipes actually use (per
// RECIPE_SCHEMA's own "as a cook would write it" examples) that inflect for
// plural — not a general English pluralizer, which would still misfire on
// irregulars. Abbreviations (tbsp, tsp, g, ml, oz) are left out on purpose:
// they don't change between singular and plural.
const UNIT_PLURALS: Record<string, string> = {
  cup: 'cups',
  clove: 'cloves',
  piece: 'pieces',
  pc: 'pcs',
  slice: 'slices',
  can: 'cans',
  block: 'blocks',
  pack: 'packs',
  egg: 'eggs',
  sprig: 'sprigs',
  leaf: 'leaves',
  stalk: 'stalks',
};
const UNIT_SINGULARS: Record<string, string> = Object.fromEntries(
  Object.entries(UNIT_PLURALS).map(([singular, plural]) => [plural, singular])
);

/** A unit word reduced to its singular form when it's one of the ones this
 *  app's recipes inflect (see UNIT_SINGULARS above), so "2 cloves" and
 *  "1 clove" compare as the same unit instead of failing to match on
 *  plural/singular alone. Everything else — abbreviations, and any unit
 *  outside that small list — passes through unchanged. */
function singularUnit(unit: string): string {
  return UNIT_SINGULARS[unit] ?? unit;
}

/**
 * Same leading-number-plus-unit split as parseQuantity in services/pantry.ts,
 * applied to a recipe ingredient's free-text amount ("2 tbsp", "500 g")
 * instead of a pantry item's quantity. Two separate functions rather than one
 * shared with different field names, because the two free-text formats are
 * written by different authors (a cook's recipe vs. whatever the user typed
 * or the scanner read) and drifting them apart later shouldn't mean touching
 * the pantry parser.
 */
function parseAmount(amount: string): { value: number | null; unit: string } {
  const match = amount.trim().match(/^(\d+(?:\.\d+)?)\s*(.*)$/);
  if (!match) return { value: null, unit: '' };
  return { value: Number(match[1]), unit: singularUnit(match[2].trim().toLowerCase()) };
}

/**
 * Whether the pantry has enough of an ingredient for the recipe as written —
 * not just some.
 *
 * Only answered when both sides parse to a number and share a unit (or both
 * have no unit at all, e.g. "3" eggs vs "2" eggs) — cross-unit comparison
 * ("1 pack" pantry vs "2 cups" recipe) has no reliable conversion, so those
 * fall back to "unknown" (null) rather than a guess in either direction. A
 * pantry item can also legitimately match several ingredient names (e.g. two
 * pantry rows both named "Garlic"); this sums them before comparing.
 */
function hasEnoughQuantity(ingredientName: string, amount: string, pantry: PantryItem[]): boolean | null {
  const needed = parseAmount(amount);
  if (needed.value === null) return null;

  const lower = ingredientName.toLowerCase();
  const matches = pantry.filter(
    (item) => item.name === ingredientName || item.name.toLowerCase() === lower
  );
  if (matches.length === 0) return null;

  let total = 0;
  for (const item of matches) {
    const have = parseQuantity(item.quantity);
    if (have.value === null || singularUnit(have.unit) !== needed.unit) return null;
    total += have.value;
  }
  return total >= needed.value;
}

/** Rounds to the nearest quarter and formats as a whole number or a simple
 *  fraction — "3.83" never reaches the screen, only "4" or "3 3/4". */
function formatScaled(value: number): string {
  const rounded = Math.round(value * 4) / 4;
  const whole = Math.floor(rounded);
  const remainder = Math.round((rounded - whole) * 4);
  if (remainder === 0) return String(whole);
  const fraction = remainder === 1 ? '1/4' : remainder === 2 ? '1/2' : '3/4';
  return whole > 0 ? `${whole} ${fraction}` : fraction;
}

/** A single number token — "2", "1.5", "1/2", or a mixed "1 1/2" — turned
 *  into its numeric value. */
function parseToken(token: string): number {
  const mixed = token.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const fraction = token.match(/^(\d+)\/(\d+)$/);
  if (fraction) return Number(fraction[1]) / Number(fraction[2]);
  return Number(token);
}

const NUMBER_SOURCE = '\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d+(?:\\.\\d+)?';

/**
 * Scales the leading number in a free-text ingredient amount by a ratio,
 * leaving everything else — unit, ingredient note, and anything with no
 * leading number at all — untouched.
 *
 * Only the FIRST number is touched: "2 x 400g cans" scales the 2 (how many
 * cans) and leaves the 400 (a can's fixed size) alone, which is the number
 * that actually depends on how many people are eating. A range like
 * "2-3 cloves" scales both ends independently and rejoins them.
 *
 * "a handful", "to taste", "a pinch of salt" — anything with no leading
 * number — comes back exactly as it went in. There is nothing safe to scale.
 */
export function scaleAmount(amount: string, ratio: number): string {
  if (!Number.isFinite(ratio) || ratio <= 0 || ratio === 1) return amount;

  const pluralize = (rest: string, scaledValue: number): string => {
    const match = rest.match(/^(\s*)([a-zA-Z]+)(.*)$/);
    if (!match) return rest;
    const [, lead, word, tail] = match;
    const wantsPlural = scaledValue !== 1;
    const lower = word.toLowerCase();
    let swapped: string | null = null;
    if (wantsPlural && UNIT_PLURALS[lower]) swapped = UNIT_PLURALS[lower];
    else if (!wantsPlural && UNIT_SINGULARS[lower]) swapped = UNIT_SINGULARS[lower];
    if (!swapped) return rest;
    // Preserve the original's capitalisation style — only matters for a
    // word starting a sentence, which an ingredient amount never does, but
    // matching case is free and avoids a jarring "Cups" -> "cups" swap.
    if (word[0] === word[0].toUpperCase()) {
      swapped = swapped[0].toUpperCase() + swapped.slice(1);
    }
    return `${lead}${swapped}${tail}`;
  };

  const rangeMatch = amount.match(
    new RegExp(`^(${NUMBER_SOURCE})\\s*-\\s*(${NUMBER_SOURCE})(.*)$`)
  );
  if (rangeMatch) {
    const [, lo, hi, rest] = rangeMatch;
    const scaledHi = parseToken(hi) * ratio;
    return `${formatScaled(parseToken(lo) * ratio)}-${formatScaled(scaledHi)}${pluralize(rest, scaledHi)}`;
  }

  const singleMatch = amount.match(new RegExp(`^(${NUMBER_SOURCE})(.*)$`));
  if (!singleMatch) return amount;

  const [, token, rest] = singleMatch;
  const scaledValue = parseToken(token) * ratio;
  return `${formatScaled(scaledValue)}${pluralize(rest, scaledValue)}`;
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
