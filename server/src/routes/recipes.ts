// server/src/routes/recipes.ts
//
// What to cook tonight, built from what is actually on the user's shelves.
//
// The client sends the pantry; this route asks Claude for three suggestions and
// returns them in the shape the recipe cards already render. The server holds
// no pantry of its own — Firestore is the client's, and keeping a second copy
// here would mean two versions of the truth about someone's fridge.
//
// The ordering rule is the whole point of the feature: prefer recipes that use
// up what is about to go off. A recipe engine that ignores expiry dates is a
// cookbook, and the user already has one of those.
//
// Same shape as routes/scan.ts throughout — cached system prompt, structured
// outputs, a token line on every call — because the two routes have the same
// cost profile and the same need to be measurable.

import Anthropic from '@anthropic-ai/sdk';
import { Request, Response, Router } from 'express';
import { dietGuidance, forbidsItem, violatesDiet, withoutExceptions } from './diets';

// Sonnet rather than Opus, deliberately. Picking a dish from a list of twelve
// pantry items is not hard reasoning — the hard part was writing the rules
// below, and those are the same whoever reads them. What Opus was actually
// spending its time on was writing out three full recipes token by token, and
// the user sits watching a spinner for all of it. Sonnet writes the same
// recipe several times faster for a fraction of the cost.
//
// The scan route stays on Opus: reading a smudged date off a crumpled label is
// genuinely a hard perception problem, and getting it wrong puts a made-up date
// in someone's pantry. Wrong here just means a dinner they don't fancy.
const MODEL = 'claude-sonnet-5';

// Three suggestions: one featured, two alternates. More than that and the
// screen becomes a list nobody reads; fewer and "shuffle" has nowhere to go.
const ALTERNATE_COUNT = 2;

// A pantry larger than this is trimmed before sending. Past a point the extra
// items don't improve the suggestion, they just cost input tokens on every
// call — and the items that matter most are sorted to the front by the client.
const MAX_ITEMS = 60;

// Guards against a model that answers "45 minutes" as 45000. Anything outside
// this is treated as unusable rather than displayed.
const MIN_MINUTES = 2;
const MAX_MINUTES = 480;

export type Ingredient = {
  name: string;
  amount: string;
  have: boolean;
};

// Kept in step with src/theme/dishLooks.ts on the client, which owns the glyph
// and gradient for each. The two lists have to match: anything else arrives at
// a card that draws the fallback plate.
const DISH_LOOKS = [
  'rice',
  'noodles',
  'soup',
  'stew',
  'grilled',
  'fried',
  'seafood',
  'chicken',
  'vegetables',
  'bread',
  'merienda',
  'dessert',
  'drink',
  'other',
] as const;

type DishLook = (typeof DISH_LOOKS)[number];

// Kept in step with src/theme/dishPhotos.ts, which owns the photo for each.
// This is a naming scheme, not a menu: the model is not limited to cooking
// these, it just has to say "other" when the dish it chose is not one of them.
// An "other" gets the gradient tile, which is the same thing every dish got
// before photos existed.
const DISH_KEYS = [
  'adobo',
  'sinigang',
  'tinola',
  'nilaga',
  'bulalo',
  'kare_kare',
  'menudo',
  'afritada',
  'kaldereta',
  'pochero',
  'sisig',
  'lechon_kawali',
  'crispy_pata',
  'pork_bbq',
  'longganisa',
  'tocino',
  'tapa',
  'bistek',
  'fried_chicken',
  'chicken_curry',
  'ginataang_manok',
  'paksiw',
  'inihaw_na_isda',
  'daing',
  'fried_fish',
  'pinakbet',
  'chopsuey',
  'laing',
  'ginisang_munggo',
  'ginisang_gulay',
  'tortang_talong',
  'pancit_canton',
  'pancit_bihon',
  'lomi',
  'spaghetti',
  'carbonara',
  'sinangag',
  'silog',
  'arroz_caldo',
  'lugaw',
  'goto',
  'champorado',
  'lumpiang_shanghai',
  'empanada',
  'siomai',
  'turon',
  'banana_cue',
  'bibingka',
  'puto',
  'pandesal',
  'leche_flan',
  'halo_halo',
  'other',
] as const;

type DishKey = (typeof DISH_KEYS)[number];

export type Recipe = {
  title: string;
  look: DishLook;
  dishKey: DishKey;
  minutes: number;
  why: string;
  needsShopping: boolean;
  usesExpiring: string[];
  pantryUsed: string[];
  ingredients: Ingredient[];
  steps: string[];
};

/** Why a suggestion was dropped after the model produced it. Shown to the user
 *  so a short list has an explanation rather than looking like a bad day. */
type Skipped = { reason: 'diet' | 'allergy'; term: string };

// What the user tapped on the chip row. Each one turns into a line in the user
// turn, never the system prompt — see the note where `brief` is built.
const MOODS = ['anything', 'quick', 'ulam', 'merienda', 'no_shopping'] as const;
type Mood = (typeof MOODS)[number];

const MOOD_LINES: Record<Mood, string | null> = {
  anything: null,
  quick: 'Tonight they want something quick: every suggestion must be under 20 minutes from starting to eating.',
  ulam: 'Tonight they want ulam — a main dish to eat with rice. Not a snack, not a dessert, not a one-pot noodle bowl.',
  merienda:
    'Tonight they want merienda — an afternoon snack. Small, quick, sweet or savoury. Turon, banana cue, kakanin, sandwiches, pancit canton. Not a full meal.',
  no_shopping:
    'They do not want to go out. Every ingredient must either be in the pantry list above or be a basic staple already in a Filipino kitchen — rice, salt, oil, toyo, suka, sugar, garlic, onion, water. If you cannot manage that for a dish, choose a different dish.',
};

function readMood(value: unknown): Mood {
  return MOODS.includes(value as Mood) ? (value as Mood) : 'anything';
}

type Result = {
  featured: Recipe | null;
  alternates: Recipe[];
  skipped: Skipped[];
};

type PantryLine = {
  name?: unknown;
  quantity?: unknown;
  category?: unknown;
  location?: unknown;
  expiryDate?: unknown;
  dateSource?: unknown;
  ripeness?: unknown;
  daysLeft?: unknown;
};

export const RECIPE_SCHEMA = {
  type: 'object',
  properties: {
    title: {
      type: 'string',
      description:
        'What the dish is, as someone would say it to a housemate — "Banana pancakes", "Tomato and egg fried rice". Five words at most.',
    },
    look: {
      type: 'string',
      enum: DISH_LOOKS,
      description:
        'What kind of dish this is, for the picture on the card. Choose by what it IS at the table, not by its main ingredient — sinigang na hipon is "soup", not "seafood"; chicken adobo is "stew", not "chicken". Use "chicken", "seafood" or "vegetables" only when the dish is that thing plainly cooked. "merienda" for afternoon snacks, "other" when nothing fits.',
    },
    dishKey: {
      type: 'string',
      enum: DISH_KEYS,
      description:
        'Which named dish this is, so the app can show a photo of it. Choose a key ONLY when the dish genuinely is that thing — "adobo" for chicken or pork adobo, "sinigang" for any sinigang, "silog" for any -silog plate. Do not stretch: a pork stew that is not kaldereta is "other", not "kaldereta". A wrong key shows the user a photo of food they are not cooking, which is worse than showing no photo at all, so "other" is always the safe answer and is expected often.',
    },
    minutes: {
      type: 'number',
      description: 'Realistic total time from starting to eating, in minutes.',
    },
    why: {
      type: 'string',
      description:
        'One short sentence naming why this is being suggested tonight, addressed to the user — "Uses the avocados before they go", "Your spinach is on its last day". Not a description of the dish.',
    },
    needsShopping: {
      type: 'boolean',
      description:
        'True only when the pantry could not carry a decent dish on its own and you have suggested something that needs a real trip to the shop. False for an ordinary suggestion that is missing a staple or two.',
    },
    usesExpiring: {
      type: 'array',
      description:
        'The exact names, copied from the pantry list, of the items this recipe uses up that are close to going off. Empty when the recipe uses nothing urgent.',
      items: { type: 'string' },
    },
    pantryUsed: {
      type: 'array',
      description:
        'Every item from the pantry list this recipe uses up, named EXACTLY as it appears in that list — copy the string, do not tidy it. Wider than usesExpiring, which is only the urgent ones. After cooking, the app offers to clear these from the pantry, so a name that was not really used costs the user their groceries: leave out anything the dish only uses a pinch of, or does not use at all.',
      items: { type: 'string' },
    },
    ingredients: {
      type: 'array',
      description: 'Everything needed, including things the user does not have.',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'The ingredient, short.' },
          amount: {
            type: 'string',
            description: 'How much, as a cook would write it — "2 tbsp", "200 g", "a handful".',
          },
          have: {
            type: 'boolean',
            description:
              'True only when this ingredient is in the pantry list you were given. Staples the user did not list — salt, pepper, water, oil — are false. Guessing true is worse than guessing false: it sends someone to the kitchen expecting something that is not there.',
          },
        },
        required: ['name', 'amount', 'have'],
        additionalProperties: false,
      },
    },
    steps: {
      type: 'array',
      description:
        'Four to eight steps, one action each, in order. Plain sentences — no numbering, the app adds that.',
      items: { type: 'string' },
    },
  },
  required: [
    'title',
    'look',
    'dishKey',
    'minutes',
    'why',
    'needsShopping',
    'usesExpiring',
    'pantryUsed',
    'ingredients',
    'steps',
  ],
  additionalProperties: false,
} as const;

const RESULT_SCHEMA = {
  type: 'object',
  properties: {
    featured: RECIPE_SCHEMA,
    alternates: {
      type: 'array',
      description: 'Two other options, different in style and effort from the featured one.',
      items: RECIPE_SCHEMA,
    },
  },
  required: ['featured', 'alternates'],
  additionalProperties: false,
} as const;

const SYSTEM = `You suggest what to cook tonight for a pantry-tracking app called Panzi.

You are given everything the user currently has, with what is known about how long each item has left. Suggest one featured dish and two alternates.

WHAT MAKES A GOOD SUGGESTION HERE.

Cook what is about to go off. That is the reason this app exists — the user is trying not to waste food, not to browse recipes. A dish that uses two items expiring in two days beats a nicer dish that uses none of them. Say so in the "why" line, naming the actual items.

Lean on what they have. A recipe needing eight things they do not own is a shopping list, not a suggestion. Aim for most ingredients already in the list; a couple of common missing items is fine. Staples like salt, oil and water can be assumed present but must still be marked have:false, because they were not listed.

Make the three genuinely different — not one dish and two variations of it. Vary the effort: if the featured one takes 40 minutes, make at least one alternate quick.

WHOSE KITCHEN THIS IS.

Cook Filipino. This is a Filipino household, so suggest the food they actually eat and can actually shop for — adobo, sinigang, tinola, ginisang gulay, tortang talong, pancit, arroz caldo, sinangag, silog plates, ulam over rice. Rice is assumed to be in the house whether or not it is listed.

Use the names they use. "Ginisang munggo", not "sauteed mung bean stew". "Ulam", "sawsawan", "toyo", "suka", "patis", "bagoong", "calamansi", "gata", "sitaw", "talong", "kangkong", "malunggay" — write them plainly, no translation in brackets.

Missing ingredients must be things a Philippine palengke or sari-sari store actually stocks. Do not send someone out for creme fraiche or fresh basil. If calamansi fits, ask for calamansi, not lemon.

Foreign food is allowed only when the pantry pushes you there — imported pasta sauce makes spaghetti the obvious dish, and pretending otherwise to stay on theme is worse than just saying it. But cook it the way it is cooked here: Filipino spaghetti is sweet, with hotdogs. When you do step outside, make at least one of the other two suggestions Filipino.

READING THE PANTRY.

Each item may carry a date and where that date came from. A date marked "label" was printed on the packaging and can be trusted. A date marked "estimated" is the app's own guess from how the food looked — treat it as approximate, and never write advice that depends on it being exact.

Loose produce may carry a ripeness. "very_ripe" and "past_best" mean use it now: overripe bananas and soft tomatoes are better in cooking than in a fruit bowl, and suggesting exactly that is the most useful thing you can do with them.

Never suggest cooking something already past its date. If an item looks unusable, leave it out rather than working around it.

WHEN NOTHING FITS.

Sometimes the pantry and the user's diet together leave nothing worth cooking. When that happens, keep the diet and drop the "lean on what they have" rule instead — suggest a dish that needs a real trip to the shop, set needsShopping to true, and say so in the "why" line. Never bend a dietary rule to avoid sending someone shopping. An empty screen is a worse answer than an honest errand, and a broken rule is worse than both.

DIET AND ALLERGIES.

Dietary requirements are absolute, and they are not a reason to suggest worse food. A rule takes things off the table; it does not take the cuisine away. Filipino cooking without pork is still chicken adobo, tinola, sinigang na hipon, ginataang manok, beef kaldereta, pancit, ginisang gulay, tortang talong. Cook the good version of what they can eat, not an apologetic salad. Where a dish would normally use something they avoid, substitute and name it plainly in the title — "Chicken adobo", not "Adobo (no pork)".

You will often be given specific rules with the pantry. Follow those exactly; they override anything general here.

Allergies are absolute. Do not include an allergen in any form, in any quantity, including as a garnish, a substitution note, or an optional extra. Do not suggest a dish that merely leaves it out — choose a different dish. Someone will cook what you write and eat it.

VOICE.

Panzi speaks plainly and in the first person. Titles are short and ordinary. The "why" line is one sentence about their food, not a sales pitch — "Uses the spinach before it turns", not "A vibrant and healthy weeknight delight".`;

let client: Anthropic | null = null;

function anthropic(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set — copy .env.example to .env');
    client = new Anthropic({ apiKey });
  }
  return client;
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function stringList(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, limit);
}

/**
 * Whether a recipe contains something the user is allergic to.
 *
 * Matched loosely, and in both directions on purpose: an allergy of "Peanuts"
 * has to catch an ingredient of "peanut butter", and an allergy of "Nuts" has
 * to catch "walnuts". Loose matching drops the occasional safe recipe, which
 * costs the user a suggestion; tight matching lets one through, which costs
 * considerably more. That asymmetry is the whole design.
 *
 * The prompt already forbids this. This exists because a prompt is a request,
 * and an allergy is not the field to discover the difference on.
 */
// Allergies where coconut is arguably the allergen. The FDA classifies coconut
// as a tree nut; most allergists treat it as a separate and rare allergy. The
// disagreement is real, so this errs the way the rest of the allergy code does
// — a coconut dish withheld from someone who could have eaten it costs them one
// suggestion, and the other mistake costs considerably more.
const NUT_ALLERGIES = ['tree nut', 'tree nuts', 'nut', 'nuts'];

function containsAllergen(recipe: Recipe, allergens: string[]): boolean {
  if (allergens.length === 0) return false;

  const raw = [recipe.title, ...recipe.ingredients.map((i) => i.name), ...recipe.steps]
    .join(' | ')
    .toLowerCase();

  // Coconut milk and gata are stripped before matching. They are not dairy, and
  // "coconut milk" contains "milk", so a milk allergy was quietly blocking
  // ginataan, laing and Bicol express — a large part of the cuisine lost to a
  // substring. Nut allergies still see the untouched text below.
  const haystack = withoutExceptions(raw);

  return allergens.some((entry) => {
    const allergen = entry.trim().toLowerCase();
    // Under three characters matches half the dictionary; a user who typed
    // that has not given us anything usable to filter on.
    if (allergen.length < 3) return false;

    if (NUT_ALLERGIES.includes(allergen) && raw.includes('coconut')) return true;

    if (haystack.includes(allergen)) return true;
    // "Peanuts" the allergy against "peanut butter" the ingredient.
    const singular = allergen.replace(/s$/, '');
    return singular.length >= 3 && haystack.includes(singular);
  });
}

export function cleanRecipe(raw: unknown): Recipe | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Partial<Recipe>;

  const title = text(value.title, 60);
  if (!title) return null;

  const ingredients = (Array.isArray(value.ingredients) ? value.ingredients : [])
    .map((entry) => ({
      name: text((entry as Ingredient)?.name, 60),
      amount: text((entry as Ingredient)?.amount, 40),
      have: (entry as Ingredient)?.have === true,
    }))
    .filter((entry) => entry.name.length > 0)
    .slice(0, 25);

  const steps = stringList(value.steps, 12);

  // No ingredients or no method is not a recipe, whatever the schema allowed.
  if (ingredients.length === 0 || steps.length === 0) return null;

  const minutes = Number.isFinite(value.minutes) ? Math.round(value.minutes as number) : 0;

  return {
    title,
    look: DISH_LOOKS.includes(value.look as DishLook) ? (value.look as DishLook) : 'other',
    dishKey: DISH_KEYS.includes(value.dishKey as DishKey) ? (value.dishKey as DishKey) : 'other',
    minutes: minutes >= MIN_MINUTES && minutes <= MAX_MINUTES ? minutes : 0,
    why: text(value.why, 160),
    needsShopping: value.needsShopping === true,
    usesExpiring: stringList(value.usesExpiring, 8),
    pantryUsed: stringList(value.pantryUsed, 20),
    ingredients,
    steps,
  };
}

/** Trims a pantry line to the fields the model needs, dropping whatever else
 *  the client happened to send. */
function cleanPantryLine(line: PantryLine): Record<string, unknown> | null {
  const name = text(line.name, 60);
  if (!name) return null;

  const out: Record<string, unknown> = { name };
  const quantity = text(line.quantity, 30);
  const category = text(line.category, 40);
  const location = text(line.location, 30);
  const expiryDate = text(line.expiryDate, 10);
  const dateSource = text(line.dateSource, 12);
  const ripeness = text(line.ripeness, 12);

  if (quantity) out.quantity = quantity;
  if (category) out.category = category;
  if (location) out.location = location;
  if (expiryDate) out.expiryDate = expiryDate;
  if (dateSource) out.dateSource = dateSource;
  if (ripeness) out.ripeness = ripeness;
  if (Number.isFinite(line.daysLeft)) out.daysLeft = Math.round(line.daysLeft as number);

  return out;
}

export const recipesRouter = Router();

recipesRouter.post('/', async (req: Request, res: Response): Promise<void> => {
  const uid = req.uid;
  const body = (req.body ?? {}) as {
    items?: PantryLine[];
    dietary?: unknown;
    allergies?: unknown;
    mood?: unknown;
  };

  const sent = (Array.isArray(body.items) ? body.items : [])
    .map(cleanPantryLine)
    .filter((line): line is Record<string, unknown> => line !== null)
    .slice(0, MAX_ITEMS);

  if (sent.length === 0) {
    res.status(400).json({
      error: 'invalid-argument',
      message: 'There is nothing in the pantry to cook with yet.',
    });
    return;
  }

  const dietary = stringList(body.dietary, 20);
  const allergies = stringList(body.allergies, 20);
  const mood = readMood(body.mood);
  const moodLine = MOOD_LINES[mood];

  // Food the user doesn't eat never reaches the model.
  //
  // A housemate's bacon stays in their pantry and on Home's "eat these first" —
  // Panzi has no business commenting on someone's shopping — it just never
  // becomes a suggestion. Dropping it here rather than asking the model to
  // ignore it is the stronger guarantee: it cannot offer what it never saw, and
  // usesExpiring cannot name it either.
  const items = sent.filter((line) => !forbidsItem(String(line.name ?? ''), dietary));
  const hiddenByDiet = sent.length - items.length;

  // The pantry, the profile, the diet rules and the mood all go in the user
  // turn, never the system prompt. The system prompt is cached, and anything
  // that changes per request has to sit after the cache breakpoint or the cache
  // stops hitting entirely. Moving any of this up into SYSTEM would look tidier
  // and would quietly bill every call at full rate.
  const guidance = dietGuidance(dietary);

  const brief = [
    items.length > 0
      ? 'Here is everything in the pantry right now:'
      : 'Their pantry has nothing in it they can eat, so build the suggestion from scratch, set needsShopping, and say plainly that this one needs a trip to the shop.',
    ...(items.length > 0 ? [JSON.stringify(items, null, 1)] : []),
    '',
    ...(guidance.length > 0
      ? ['THEIR DIET — follow these exactly:', ...guidance]
      : ['No dietary requirements.']),
    '',
    allergies.length
      ? `ALLERGIES (must never appear in any form): ${allergies.join(', ')}`
      : 'No known allergies.',
    ...(moodLine ? ['', moodLine] : []),
    '',
    `Suggest one featured dish and exactly ${ALTERNATE_COUNT} alternates.`,
  ].join('\n');

  // Wall clock, not token count. The user experiences seconds, and output
  // tokens are what buys them — so the two are logged side by side and the
  // ratio tells you whether a slow call was a big answer or a slow network.
  const startedAt = Date.now();

  let response;
  try {
    response = await anthropic().messages.create({
      model: MODEL,
      max_tokens: 8000,
      // Byte-identical on every request, so it is cached and billed at a tenth
      // of input rate after the first call. See routes/scan.ts for the same
      // arrangement and the ordering rule it depends on.
      system: [
        {
          type: 'text',
          text: SYSTEM,
          cache_control: { type: 'ephemeral' },
        },
      ],
      output_config: {
        // Choosing a dish from a list is not deep deliberation, and this is a
        // screen the user is waiting on. Raise it if the suggestions come back
        // shallow; the token line below is how you would know what that cost.
        effort: 'low',
        format: { type: 'json_schema', schema: RESULT_SCHEMA as unknown as Record<string, unknown> },
      },
      messages: [{ role: 'user', content: brief }],
    });
  } catch (err: any) {
    console.error('Recipe call failed', { uid, message: err?.message });
    const status = err?.status === 429 ? 429 : 503;
    res.status(status).json({
      error: status === 429 ? 'resource-exhausted' : 'unavailable',
      message: 'Could not think of anything just now — try again in a moment.',
    });
    return;
  }

  if (response.stop_reason === 'refusal') {
    console.warn('Model declined the recipe request', { uid });
    res.json({ featured: null, alternates: [], skipped: [] } satisfies Result);
    return;
  }

  const block = response.content.find((entry) => entry.type === 'text');
  if (!block || block.type !== 'text') {
    console.error('No text block in recipe response', { uid, stopReason: response.stop_reason });
    res.status(502).json({ error: 'internal', message: 'Could not read that answer — try again.' });
    return;
  }

  let parsed: { featured?: unknown; alternates?: unknown };
  try {
    parsed = JSON.parse(block.text);
  } catch {
    console.error('Recipe response was not valid JSON', { uid });
    res.status(502).json({ error: 'internal', message: 'Could not read that answer — try again.' });
    return;
  }

  // Held against the pantry that was actually sent. `pantryUsed` is the list the
  // app later offers to delete from someone's kitchen, so a name the model
  // invented or paraphrased must not survive to the client — the client would
  // fail to match it and silently drop it anyway, but it is cheaper to be sure
  // here, where the real list is in hand.
  const known = new Map(
    items.map((item) => [String(item.name).toLowerCase(), String(item.name)])
  );

  const candidates = [
    cleanRecipe(parsed.featured),
    ...(Array.isArray(parsed.alternates) ? parsed.alternates : []).map(cleanRecipe),
  ]
    .filter((recipe): recipe is Recipe => recipe !== null)
    .map((recipe) => ({
      ...recipe,
      pantryUsed: [
        ...new Set(
          recipe.pantryUsed
            .map((name) => known.get(name.toLowerCase()))
            .filter((name): name is string => name !== undefined)
        ),
      ],
    }));

  // The two gates. After cleaning, so they see the final ingredient names, and
  // before anything is returned, so nothing the user cannot eat reaches a
  // screen. Both should be quiet in normal use — the prompt already carries
  // every rule in plain words — and a count that climbs means the guidance
  // stopped landing, not that the gate is earning its keep.
  const skipped: Skipped[] = [];
  const safe = candidates.filter((recipe) => {
    if (containsAllergen(recipe, allergies)) {
      // The allergen itself is not named back to the user. They know what they
      // are allergic to, and echoing it adds nothing.
      skipped.push({ reason: 'allergy', term: '' });
      return false;
    }
    const clash = violatesDiet(recipe, dietary);
    if (clash) {
      skipped.push({ reason: 'diet', term: clash.term });
      return false;
    }
    return true;
  });

  console.info('Recipes complete', {
    uid,
    ms: Date.now() - startedAt,
    mood,
    itemCount: items.length,
    hiddenByDiet,
    suggested: candidates.length,
    blockedByAllergy: skipped.filter((s) => s.reason === 'allergy').length,
    blockedByDiet: skipped.filter((s) => s.reason === 'diet').length,
    inputTokens: response.usage.input_tokens,
    cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
    outputTokens: response.usage.output_tokens,
  });

  res.json({
    featured: safe[0] ?? null,
    alternates: safe.slice(1, 1 + ALTERNATE_COUNT),
    skipped,
  } satisfies Result);
});
