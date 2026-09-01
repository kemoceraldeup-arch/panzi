// server/src/routes/nutrition.ts
//
// Per-item macros, looked up from the FatSecret Platform API by the item's
// recognized name. Lives server-side for the same reason the Anthropic key
// does: FATSECRET_CLIENT_SECRET must never reach the device, since an Expo
// bundle ships to every phone that installs the app.
//
// FatSecret's own API is a search, not a lookup by exact name — "cheddar"
// can match dozens of branded products. The client sends the item's
// recognized name; this route returns FatSecret's own best-ranked match
// (first result) plus a short list of alternates, so the app can show a
// macro estimate immediately while still letting the user pick a different
// match if the guess is wrong (see NutritionCandidate.alternates).
//
// Two calls, not one: foods/search/v2 (which returns structured macros in
// one shot) is Premier-only, and this account is on the free tier. v1
// search only returns names/ids, so each candidate needs its own food.get
// (v4) call afterward for calories/protein/carbs/fat. Slower than the
// single-call version, but nothing here is on a blocking path — the client
// shows the card first and fills in nutrition when it lands.
//
// The route writes nothing — same as scan.ts. The client decides whether to
// keep the match and sends it back through the normal pantry write path
// (POST /api/pantry/add or /update), same as every other scanned field.

import { Request, Response, Router } from 'express';
import { badRequest } from './helpers';

export const nutritionRouter = Router();

const TOKEN_URL = 'https://oauth.fatsecret.com/connect/token';
// v1, not v2 — v2's foods/search bundles full nutrition into the search
// response but requires the Premier scope. v1 only returns name/id per
// result on the free tier; FOOD_URL below fills in the macros afterward.
const SEARCH_URL = 'https://platform.fatsecret.com/rest/foods/search/v1';
const FOOD_URL = 'https://platform.fatsecret.com/rest/food/v4';

// A search expression this short is almost never a real food name — "a",
// "of" — and searching it anyway just burns a call for a result nobody
// could plausibly want to keep.
const MIN_QUERY_LENGTH = 2;
// Up to 5 alternates is enough for a "not this?" picker without turning it
// into its own scrollable list.
const MAX_RESULTS = 6;

type FatSecretToken = { accessToken: string; expiresAt: number };

// One token shared by every request this process handles, refreshed lazily —
// mirrors the anthropic()/openai()-style lazy singleton used in scan.ts and
// recipes.ts, adapted for a credential that expires rather than one that
// doesn't.
let cachedToken: FatSecretToken | null = null;

async function getAccessToken(): Promise<string> {
  const now = Date.now();
  // 60s of slack before the real expiry, so a token that is about to expire
  // mid-request gets replaced instead of failing partway through the call
  // that uses it.
  if (cachedToken && cachedToken.expiresAt - 60_000 > now) {
    return cachedToken.accessToken;
  }

  const clientId = process.env.FATSECRET_CLIENT_ID;
  const clientSecret = process.env.FATSECRET_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('FATSECRET_CLIENT_ID/SECRET is not set — copy .env.example to .env');
  }

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'client_credentials', scope: 'basic' }),
  });

  if (!response.ok) {
    throw new Error(`FatSecret token request failed: ${response.status}`);
  }

  const data = (await response.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    accessToken: data.access_token,
    expiresAt: now + data.expires_in * 1000,
  };
  return cachedToken.accessToken;
}

/** The one serving FatSecret's search embeds per food — usually "1 serving"
 *  or a package's own stated size, not normalized to any fixed unit. */
type FatSecretServing = {
  serving_description?: string;
  metric_serving_amount?: string;
  metric_serving_unit?: string;
  calories?: string;
  protein?: string;
  carbohydrate?: string;
  fat?: string;
};

type FatSecretFood = {
  food_id: string;
  food_name: string;
  brand_name?: string;
  servings?: { serving?: FatSecretServing | FatSecretServing[] };
};

/** v1 search's own shape — name and id only, no servings/macros. */
type FatSecretSearchHit = {
  food_id: string;
  food_name: string;
  brand_name?: string;
};

export type NutritionMatch = {
  foodId: string;
  matchedName: string;
  servingDescription: string | null;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
};

/** FatSecret returns numbers as strings and sometimes omits a macro
 *  entirely (a food logged with only calories, no macro breakdown) — parsed
 *  loosely and defaulted to 0 rather than dropped, since a missing macro on
 *  an otherwise-real match is still useful information, not a reason to
 *  discard the whole match. */
function parseGrams(value: string | undefined): number {
  const n = value === undefined ? 0 : Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 10) / 10 : 0;
}

function toMatch(food: FatSecretFood): NutritionMatch | null {
  const serving = Array.isArray(food.servings?.serving)
    ? food.servings?.serving[0]
    : food.servings?.serving;
  // A food with no serving at all has no macros to show — not a match worth
  // offering, even if the name matched.
  if (!serving) return null;

  return {
    foodId: food.food_id,
    matchedName: food.brand_name ? `${food.brand_name} ${food.food_name}` : food.food_name,
    servingDescription: serving.serving_description ?? null,
    calories: parseGrams(serving.calories),
    proteinG: parseGrams(serving.protein),
    carbsG: parseGrams(serving.carbohydrate),
    fatG: parseGrams(serving.fat),
  };
}

/** Thrown for an error worth telling the difference on — a rate limit vs.
 *  everything else — without giving every call site its own try/catch. */
class FatSecretError extends Error {
  constructor(public status: number) {
    super(`FatSecret request failed: ${status}`);
  }
}

/** Macros per gram (or per ml, treated the same — see convertToGrams below),
 *  for scaling a food's nutrition to whatever amount a recipe actually calls
 *  for, rather than reporting whatever arbitrary "1 serving" FatSecret
 *  happened to define for that food. */
type PerGram = { caloriesPerG: number; proteinPerG: number; carbsPerG: number; fatPerG: number };

/** Recipe amounts are grams or millilitres by the time they reach here (see
 *  convertToGrams). FatSecret's servings are a grab-bag of "1 cup", "1 piece",
 *  "100 g" and branded package sizes for the same food, so the one worth
 *  reading is whichever carries `metric_serving_amount`/`metric_serving_unit`
 *  — that is the only one with a fixed, unit-agnostic size to divide by.
 *  Foods with no metric serving at all (rare, but real) return null: no
 *  amount can be trusted, so this ingredient is left out of the total rather
 *  than scaled off a guess. */
function perGramFromFood(food: FatSecretFood): PerGram | null {
  const raw = food.servings?.serving;
  const servings = Array.isArray(raw) ? raw : raw ? [raw] : [];

  const metric = servings.find((s) => {
    const unit = s.metric_serving_unit?.toLowerCase();
    const amount = Number(s.metric_serving_amount);
    return (unit === 'g' || unit === 'ml') && Number.isFinite(amount) && amount > 0;
  });
  if (!metric) return null;

  const grams = Number(metric.metric_serving_amount);
  return {
    caloriesPerG: parseGrams(metric.calories) / grams,
    proteinPerG: parseGrams(metric.protein) / grams,
    carbsPerG: parseGrams(metric.carbohydrate) / grams,
    fatPerG: parseGrams(metric.fat) / grams,
  };
}

/** Whole units that carry a standard-enough weight to convert without a
 *  recipe-specific gram figure — the common case for "2 cloves garlic" or
 *  "1 bay leaf" style amounts, where no one writes a mass. Approximate by
 *  nature: these are kitchen-reference averages, not the actual weight of
 *  whatever the user's own garlic clove happens to be. Good enough for an
 *  estimate; not offered as anything more precise than one. */
const UNIT_WEIGHTS_G: Record<string, number> = {
  clove: 3,
  cloves: 3,
  piece: 50,
  pieces: 50,
  pc: 50,
  pcs: 50,
  leaf: 0.5,
  leaves: 0.5,
  slice: 25,
  slices: 25,
  egg: 50,
  eggs: 50,
  stalk: 15,
  stalks: 15,
  sprig: 2,
  sprigs: 2,
};

/** Volume-to-weight is only ever approximate — it depends on what's being
 *  measured (a cup of flour and a cup of water differ by 2x) — but a rough
 *  figure beats refusing to estimate at all for the tbsp/tsp/cup amounts
 *  that dominate a Filipino recipe's ingredient list. Water-density numbers,
 *  the same assumption cooking conversion charts default to absent a
 *  specific ingredient. */
const VOLUME_TO_ML: Record<string, number> = {
  cup: 240,
  cups: 240,
  tbsp: 15,
  tablespoon: 15,
  tablespoons: 15,
  tsp: 5,
  teaspoon: 5,
  teaspoons: 5,
  ml: 1,
  l: 1000,
  liter: 1000,
  liters: 1000,
};

const MASS_TO_G: Record<string, number> = {
  g: 1,
  gram: 1,
  grams: 1,
  kg: 1000,
  kilo: 1000,
  kilos: 1000,
  oz: 28.35,
  ounce: 28.35,
  ounces: 28.35,
  lb: 453.6,
  lbs: 453.6,
  pound: 453.6,
  pounds: 453.6,
};

/** Turns a recipe's free-text amount ("1/4 kg", "2 tbsp", "2 cloves,
 *  crushed", "a handful") into grams, so it can be scaled against a food's
 *  per-gram macros. Returns null on anything this can't confidently read —
 *  "a handful", "to taste", a stray unit not in the tables above — rather
 *  than guessing a number with nothing behind it. A skipped ingredient
 *  understates the total; a fabricated weight lies about it, which is worse.
 */
export function parseAmountToGrams(amount: string): number | null {
  const cleaned = amount.trim().toLowerCase();

  // "1/4", "1 1/2", "2", "0.5" at the start of the string — a mixed number,
  // a fraction, or a plain decimal, in that order of how recipes write them.
  const match = cleaned.match(
    /^(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?)\s*([a-z]+)?/
  );
  if (!match) return null;

  const [, quantityRaw, unitRaw] = match;
  let quantity: number;
  if (quantityRaw.includes('/')) {
    const parts = quantityRaw.split(' ');
    const whole = parts.length > 1 ? Number(parts[0]) : 0;
    const [num, den] = (parts.length > 1 ? parts[1] : parts[0]).split('/').map(Number);
    if (!Number.isFinite(den) || den === 0) return null;
    quantity = whole + num / den;
  } else {
    quantity = Number(quantityRaw);
  }
  if (!Number.isFinite(quantity) || quantity <= 0) return null;

  const unit = unitRaw ?? '';
  if (!unit) return null; // a bare number with no unit — "2" of what? not guessable.

  if (unit in MASS_TO_G) return quantity * MASS_TO_G[unit];
  if (unit in VOLUME_TO_ML) return quantity * VOLUME_TO_ML[unit]; // ml treated as g, water-density
  if (unit in UNIT_WEIGHTS_G) return quantity * UNIT_WEIGHTS_G[unit];

  return null;
}

/** One food's structured macros, fetched by id. Null on anything that isn't
 *  a clean, parseable match — a food.get failure for one candidate should
 *  drop that candidate, not fail the whole lookup. */
async function fetchFoodDetail(foodId: string, token: string): Promise<NutritionMatch | null> {
  const url = new URL(FOOD_URL);
  url.searchParams.set('food_id', foodId);
  url.searchParams.set('format', 'json');

  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) {
    if (response.status === 429) throw new FatSecretError(429);
    return null;
  }

  const data = (await response.json()) as {
    error?: { code?: number; message?: string };
    food?: FatSecretFood;
  };
  if (data.error || !data.food) return null;

  return toMatch(data.food);
}

/**
 * Looks up macros for a scanned item's recognized name.
 *
 * Two calls: v1 search finds candidate foods by name (free tier — v2's
 * single-call search with embedded macros needs a Premier scope this
 * account doesn't have), then each candidate's macros are fetched by id.
 * Returns the best-ranked match plus up to 5 alternates, or a 404 if
 * FatSecret has nothing for the name at all — the client treats that as "no
 * nutrition info available" rather than an error, same as an item with no
 * printed expiry date.
 */
nutritionRouter.post('/lookup', async (req: Request, res: Response): Promise<void> => {
  const { name } = (req.body ?? {}) as { name?: string };
  const query = typeof name === 'string' ? name.trim() : '';
  if (query.length < MIN_QUERY_LENGTH) {
    badRequest(res, 'A food name is required.');
    return;
  }

  let token: string;
  let searchResponse: globalThis.Response;
  try {
    token = await getAccessToken();
    const url = new URL(SEARCH_URL);
    url.searchParams.set('search_expression', query);
    url.searchParams.set('max_results', String(MAX_RESULTS));
    url.searchParams.set('format', 'json');
    searchResponse = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (err: any) {
    console.error('FatSecret call failed', { uid: req.uid, message: err?.message });
    res.status(503).json({
      error: 'unavailable',
      message: 'Could not look up nutrition info right now.',
    });
    return;
  }

  if (!searchResponse.ok) {
    console.error('FatSecret search failed', { uid: req.uid, status: searchResponse.status });
    const status = searchResponse.status === 429 ? 429 : 503;
    res.status(status).json({
      error: status === 429 ? 'resource-exhausted' : 'unavailable',
      message: 'Could not look up nutrition info right now.',
    });
    return;
  }

  const searchData = (await searchResponse.json()) as {
    error?: { code?: number; message?: string };
    foods?: { food?: FatSecretSearchHit | FatSecretSearchHit[] };
  };

  // FatSecret answers its own errors — a bad IP, a bad token, a missing
  // scope — with HTTP 200 and an `error` field inside the body, not a 4xx.
  // Left unchecked, that reads as "search succeeded, zero results" and gets
  // shown to the user as an ordinary missing match, silently hiding what is
  // actually a broken integration behind a food that looks unrecognised.
  if (searchData.error) {
    console.error('FatSecret search returned an error payload', {
      uid: req.uid,
      code: searchData.error.code,
      message: searchData.error.message,
    });
    res.status(503).json({
      error: 'unavailable',
      message: 'Could not look up nutrition info right now.',
    });
    return;
  }

  const raw = searchData.foods?.food;
  const hits = Array.isArray(raw) ? raw : raw ? [raw] : [];

  let matches: NutritionMatch[];
  try {
    const details = await Promise.all(hits.map((hit) => fetchFoodDetail(hit.food_id, token)));
    matches = details.filter((m): m is NutritionMatch => m !== null);
  } catch (err) {
    if (err instanceof FatSecretError && err.status === 429) {
      res.status(429).json({
        error: 'resource-exhausted',
        message: 'Could not look up nutrition info right now.',
      });
      return;
    }
    console.error('FatSecret food detail call failed', { uid: req.uid, message: (err as Error).message });
    res.status(503).json({
      error: 'unavailable',
      message: 'Could not look up nutrition info right now.',
    });
    return;
  }

  if (matches.length === 0) {
    res.status(404).json({ error: 'not-found', message: 'No nutrition info found for that item.' });
    return;
  }

  console.info('FatSecret lookup', { uid: req.uid, query, resultCount: matches.length });

  res.json({ best: matches[0], alternates: matches.slice(1) });
});

/** One ingredient from a recipe, as the client sends it — the same shape
 *  Ingredient already has in services/recipes.ts, trimmed to the two fields
 *  this route needs. */
type RecipeIngredientLine = { name?: unknown; amount?: unknown };

/** A single ingredient's contribution to the recipe total: the FatSecret food
 *  it matched to, and its macros already scaled to the amount the recipe
 *  calls for. Returned per-ingredient (not just summed) so the client can
 *  show its own "estimated, N of M ingredients matched" disclosure rather
 *  than this route deciding how to phrase that. */
type IngredientEstimate = {
  name: string;
  matchedName: string;
  grams: number;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
};

/** Searches FatSecret for one ingredient by name and returns its top match's
 *  per-gram macros plus the matched name — null on no match, no parseable
 *  metric serving, or a lookup failure for just this one ingredient. Mirrors
 *  the search-then-detail shape of the /lookup route above but only ever
 *  needs the first result, since a recipe ingredient isn't offering the user
 *  a "not this?" picker the way a scanned pantry item does. */
async function lookupIngredientPerGram(
  name: string,
  token: string
): Promise<{ matchedName: string; perGram: PerGram } | null> {
  const url = new URL(SEARCH_URL);
  url.searchParams.set('search_expression', name);
  url.searchParams.set('max_results', '1');
  url.searchParams.set('format', 'json');

  const searchResponse = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!searchResponse.ok) {
    if (searchResponse.status === 429) throw new FatSecretError(429);
    return null;
  }

  const searchData = (await searchResponse.json()) as {
    error?: { code?: number };
    foods?: { food?: FatSecretSearchHit | FatSecretSearchHit[] };
  };
  if (searchData.error) return null;

  const raw = searchData.foods?.food;
  const hit = Array.isArray(raw) ? raw[0] : raw;
  if (!hit) return null;

  const detailUrl = new URL(FOOD_URL);
  detailUrl.searchParams.set('food_id', hit.food_id);
  detailUrl.searchParams.set('format', 'json');
  const detailResponse = await fetch(detailUrl, { headers: { Authorization: `Bearer ${token}` } });
  if (!detailResponse.ok) {
    if (detailResponse.status === 429) throw new FatSecretError(429);
    return null;
  }

  const detailData = (await detailResponse.json()) as { error?: unknown; food?: FatSecretFood };
  if (detailData.error || !detailData.food) return null;

  const perGram = perGramFromFood(detailData.food);
  if (!perGram) return null;

  return {
    matchedName: detailData.food.brand_name
      ? `${detailData.food.brand_name} ${detailData.food.food_name}`
      : detailData.food.food_name,
    perGram,
  };
}

/**
 * Estimates a recipe's per-serving macros from its own ingredient list,
 * rather than searching FatSecret for the dish's title — a dish name like
 * "Chicken adobo" matches whatever random prepared-meal or packaged product
 * FatSecret ranks first, with a serving size that has nothing to do with how
 * much this recipe actually makes. Summing real ingredients at their real
 * amounts is slower (one FatSecret round trip per ingredient) but the number
 * it produces is actually about this dish.
 *
 * Ingredients whose amount can't be converted to grams (see
 * parseAmountToGrams — "a handful", "to taste") or that FatSecret has no
 * metric-serving match for are left out of the total rather than guessed at;
 * `matchedCount`/`totalCount` tell the client how much of the recipe the
 * estimate actually covers.
 */
nutritionRouter.post('/recipe', async (req: Request, res: Response): Promise<void> => {
  const body = (req.body ?? {}) as { ingredients?: RecipeIngredientLine[]; servings?: unknown };
  const ingredients = (Array.isArray(body.ingredients) ? body.ingredients : [])
    .map((entry) => ({
      name: typeof entry?.name === 'string' ? entry.name.trim() : '',
      amount: typeof entry?.amount === 'string' ? entry.amount.trim() : '',
    }))
    .filter((entry) => entry.name.length >= MIN_QUERY_LENGTH)
    .slice(0, 25);

  const servings = Number.isFinite(body.servings) && (body.servings as number) > 0
    ? (body.servings as number)
    : 1;

  if (ingredients.length === 0) {
    badRequest(res, 'A recipe needs at least one ingredient to estimate nutrition for.');
    return;
  }

  let token: string;
  try {
    token = await getAccessToken();
  } catch (err: any) {
    console.error('FatSecret token request failed', { uid: req.uid, message: err?.message });
    res.status(503).json({ error: 'unavailable', message: 'Could not look up nutrition info right now.' });
    return;
  }

  const withGrams = ingredients
    .map((ing) => ({ ...ing, grams: parseAmountToGrams(ing.amount) }))
    .filter((ing): ing is { name: string; amount: string; grams: number } => ing.grams !== null);

  let estimates: IngredientEstimate[];
  try {
    const results = await Promise.all(
      withGrams.map(async (ing) => {
        const found = await lookupIngredientPerGram(ing.name, token);
        if (!found) return null;
        const estimate: IngredientEstimate = {
          name: ing.name,
          matchedName: found.matchedName,
          grams: ing.grams,
          calories: Math.round(found.perGram.caloriesPerG * ing.grams * 10) / 10,
          proteinG: Math.round(found.perGram.proteinPerG * ing.grams * 10) / 10,
          carbsG: Math.round(found.perGram.carbsPerG * ing.grams * 10) / 10,
          fatG: Math.round(found.perGram.fatPerG * ing.grams * 10) / 10,
        };
        return estimate;
      })
    );
    estimates = results.filter((e): e is IngredientEstimate => e !== null);
  } catch (err) {
    if (err instanceof FatSecretError && err.status === 429) {
      res.status(429).json({ error: 'resource-exhausted', message: 'Could not look up nutrition info right now.' });
      return;
    }
    console.error('FatSecret ingredient lookup failed', { uid: req.uid, message: (err as Error).message });
    res.status(503).json({ error: 'unavailable', message: 'Could not look up nutrition info right now.' });
    return;
  }

  if (estimates.length === 0) {
    res.status(404).json({ error: 'not-found', message: 'No nutrition info found for this recipe.' });
    return;
  }

  const totals = estimates.reduce(
    (acc, e) => ({
      calories: acc.calories + e.calories,
      proteinG: acc.proteinG + e.proteinG,
      carbsG: acc.carbsG + e.carbsG,
      fatG: acc.fatG + e.fatG,
    }),
    { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 }
  );

  console.info('FatSecret recipe estimate', {
    uid: req.uid,
    ingredientCount: ingredients.length,
    matchedCount: estimates.length,
    servings,
  });

  res.json({
    perServing: {
      calories: Math.round(totals.calories / servings),
      proteinG: Math.round((totals.proteinG / servings) * 10) / 10,
      carbsG: Math.round((totals.carbsG / servings) * 10) / 10,
      fatG: Math.round((totals.fatG / servings) * 10) / 10,
    },
    matchedCount: estimates.length,
    totalCount: ingredients.length,
  });
});
