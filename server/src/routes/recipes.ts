// server/src/routes/recipes.ts
//
// What to cook tonight, built from what is actually on the user's shelves.
//
// The client sends the pantry; this route asks OpenAI for three suggestions and
// returns them in the shape the recipe cards already render. The server holds
// no pantry of its own — Firestore is the client's, and keeping a second copy
// here would mean two versions of the truth about someone's fridge.
//
// The ordering rule is the whole point of the feature: prefer recipes that use
// up what is about to go off. A recipe engine that ignores expiry dates is a
// cookbook, and the user already has one of those.
//
// Same shape as routes/scan.ts throughout — structured outputs, a token line
// on every call — because the two routes have the same cost profile and the
// same need to be measurable.

import OpenAI from 'openai';
import { Request, Response, Router } from 'express';
import { recordUsage, tokensFrom } from '../usage';
import { dietGuidance, forbidsItem, violatesDiet, withoutExceptions } from './diets';

// The cheapest tier, deliberately. Picking a dish from a list of twelve pantry
// items is not hard reasoning — the hard part was writing the rules below, and
// those are the same whoever reads them. The flagship model would mostly spend
// its extra care writing out three full recipes token by token, and the user
// sits watching a spinner for all of it. This tier writes the same recipe
// several times faster for a fraction of the cost.
//
// The scan route stays on the flagship model: reading a smudged date off a
// crumpled label is genuinely a hard perception problem, and getting it wrong
// puts a made-up date in someone's pantry. Wrong here just means a dinner they
// don't fancy.
const MODEL = 'gpt-5.6-luna';

// Three suggestions: one featured, two alternates. More than that and the
// screen becomes a list nobody reads; fewer and "shuffle" has nowhere to go.
const ALTERNATE_COUNT = 2;

// "All Recipes" — a browse list, not a suggestion set, so it isn't capped at
// three the way the pantry-anchored path is. Requested as a target, not
// enforced as a floor: fewer good ones beats padding, same philosophy as
// ALTERNATE_COUNT above. Kept deliberately smaller than a "real" cookbook
// page (5, not 8+) because every recipe here comes with a full ingredients
// list and method in the same call — at 8 the response regularly took
// 35-40 seconds, long enough to still be running when the user tapped
// something else, whose own quick reachability check then timed out
// against the same tunnel and reported the server as unreachable even
// though it was still working. Fewer recipes per call is the fix, not a
// longer timeout — the user is also waiting on this call themselves.
const BROWSE_COUNT = 5;
// A ceiling on what's returned after the safety gates run, so a model that
// over-delivers doesn't turn one call into an unbounded response.
const BROWSE_MAX = 6;

// A pantry larger than this is trimmed before sending. Past a point the extra
// items don't improve the suggestion, they just cost input tokens on every
// call — and the items that matter most are sorted to the front by the client.
const MAX_ITEMS = 60;

// Guards against a model that answers "45 minutes" as 45000. Anything outside
// this is treated as unusable rather than displayed.
const MIN_MINUTES = 2;
const MAX_MINUTES = 480;

// A household serving count, not a headcount for a wedding. 1 covers a solo
// cook; 12 covers a fiesta-sized batch of something like kaldereta. Outside
// this range the model has confused servings with something else — pieces,
// minutes — and the figure is unusable rather than displayed.
const MIN_SERVINGS = 1;
const MAX_SERVINGS = 12;

export type Ingredient = {
  name: string;
  amount: string;
  have: boolean;
  /** have is false because this is an assumed-present staple (rice, salt,
   *  oil, ...), not because the dish genuinely needs a trip to the shop. */
  assumedStaple: boolean;
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
  /** How many people this recipe as written feeds. 0 when the model gave a
   *  figure that wasn't believable, or on anything cached before this field
   *  existed — screens hide the servings control rather than showing "0". */
  servings: number;
  /** What the dish IS, for someone who's never heard of it — distinct from
   *  `why`, which is the reason it's being suggested tonight specifically. */
  description: string;
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
const MOODS = ['anything', 'quick', 'ulam', 'merienda'] as const;
type Mood = (typeof MOODS)[number];

const MOOD_LINES: Record<Mood, string | null> = {
  anything:
    "They haven't narrowed it down, so show them the spread rather than three versions of the same idea: across the featured dish and the two alternates, cover different kinds of eating — at least one proper ulam for rice, and at least one that is quick or light (a snack, a merienda, a fast one-pan dish). Do not make all three the same category of meal.",
  quick: 'Tonight they want something quick: every suggestion must be under 20 minutes from starting to eating.',
  ulam: 'Tonight they want ulam — a main dish to eat with rice. Not a snack, not a dessert, not a one-pot noodle bowl.',
  merienda:
    'Tonight they want merienda — an afternoon snack. Small, quick, sweet or savoury. Turon, banana cue, kakanin, sandwiches, pancit canton. Not a full meal.',
};

function readMood(value: unknown): Mood {
  return MOODS.includes(value as Mood) ? (value as Mood) : 'anything';
}

type BrowseResult = {
  recipes: Recipe[];
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
        'What kind of dish this is, for the picture on the card. Choose by what it IS at the table — how it is plated and eaten — never by its main ingredient. This is the single most common mistake: naming the protein instead of the dish. Work through these in order and stop at the first one that fits:\n\n' +
        '1. Is it wet/saucy, meant to be eaten with rice or bread, spooned rather than picked up? That is "soup" (thin, broth-forward — sinigang, tinola, nilaga, bulalo) or "stew" (thick, sauce clings to the meat — adobo, kaldereta, mechado, menudo, afritada). Almost every classic Filipino ulam with a sauce falls here, regardless of whether the protein is chicken, pork, beef, or seafood: chicken adobo is "stew", not "chicken"; sinigang na hipon is "soup", not "seafood"; beef caldereta is "stew", not... there is no "beef" option, which is the point — protein never wins over dish shape.\n' +
        '2. Is it cooked directly over or in open flame/coals, or skewered? "grilled" — inasal, liempo, isaw, BBQ, grilled bangus.\n' +
        '3. Is it pan-fried, deep-fried, or breaded/crispy as its defining trait, with no real sauce? "fried" — fried chicken, lumpia, tokwa, torta, fried fish.\n' +
        '4. Is rice the actual subject of the dish, not just a side? "rice" — fried rice, rice bowls, sinangag, arroz caldo (the rice-forward version, not the soup version).\n' +
        '5. Is it a noodle dish? "noodles" — pancit, sotanghon, spaghetti, mami.\n' +
        '6. Is it a plate of vegetables with no meat, or where vegetables are unambiguously the point (a salad, a veggie stir-fry, ginisang gulay)? "vegetables". Do NOT use this just because a dish contains vegetables alongside meat — pinakbet with pork belly is "stew"/"vegetables" only if pork is a minor garnish, not the point; when in doubt and there is meat, prefer stew/soup/grilled/fried over vegetables.\n' +
        '7. Bread, pastry, or a baked item eaten by hand? "bread" — pandesal, ensaymada, siopao (yes, even though it is steamed, it reads as bread at the table).\n' +
        '8. An afternoon snack, not a full meal? "merienda" — turon, banana cue, kakanin, maruya.\n' +
        '9. Sweet, eaten after or between meals? "dessert" — leche flan, halo-halo, buko pandan.\n' +
        '10. Something drunk, not eaten? "drink".\n' +
        '11. "chicken", "seafood" are reserved almost exclusively for a plainly cooked, unsauced piece of that protein with nothing else going on — a whole roasted chicken, steamed fish, boiled shrimp with no marinade or gravy. If there is a sauce, a marinade that cooked down, or it is part of a composed dish, use the dish-shape category from steps 1-10 instead. These two are meant to be picked rarely.\n' +
        '12. "other" only when truly nothing above fits — not a default for uncertainty. If a dish is close to two categories, prefer the one describing how it is served (steps 1-3) over the one describing an ingredient (step 11).',
    },
    dishKey: {
      type: 'string',
      enum: DISH_KEYS,
      description:
        'Which named dish this is, so the app can show a photo of it. Choose a key ONLY when the dish genuinely is that thing — "adobo" for chicken or pork adobo, "sinigang" for any sinigang, "silog" for any -silog plate. Do not stretch: a pork stew that is not kaldereta is "other", not "kaldereta". A wrong key shows the user a photo of food they are not cooking, which is worse than showing no photo at all, so "other" is always the safe answer and is expected often. That said, if the dish\'s own title names one of these dishes plainly (e.g. a recipe titled "Beef bistek" or "Chicken tinola"), use that matching key — the title is the strongest signal of what the dish genuinely is, and leaving it "other" while the title says otherwise looks like a mistake to the user.',
    },
    minutes: {
      type: 'number',
      description: 'Realistic total time from starting to eating, in minutes.',
    },
    servings: {
      type: 'number',
      description:
        'How many people this recipe as written feeds — a realistic household serving count, e.g. 2, 4, 6. Not the number of pieces or ingredients; the number of people who could eat this amount of food as a meal. Must agree with the ingredient amounts you wrote: if the ingredient list is sized for one person eating alone (e.g. a quarter-kilo of meat as the only protein, a single egg), servings must be 1, not 4 — the app divides every ingredient amount and every nutrition figure by this number to show a single portion, so an inflated servings count on a small ingredient list quietly shrinks a real portion into a fraction of one and understates its calories.',
    },
    description: {
      type: 'string',
      description:
        'One short sentence describing the DISH ITSELF, for someone who has never heard of it — what it is and where it is from, not why it is being suggested tonight. "A Filipino classic of chicken braised in soy sauce, vinegar and garlic." "A simple Ilocano vegetable stew." Never repeat the title verbatim inside it.',
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
            description:
              'How much, as a cook would write it — "2 tbsp", "200 g", "a handful". Always include a unit, even for whole countable items the ingredient name already implies: "3 leaves" or "3 pcs", not a bare "3" — a number with nothing after it cannot be converted to a nutrition estimate and gets silently dropped from the macro total, understating calories for every recipe that has one.',
          },
          have: {
            type: 'boolean',
            description:
              'True only when this ingredient is in the pantry list you were given. Staples the user did not list — salt, pepper, water, oil — are false. Guessing true is worse than guessing false: it sends someone to the kitchen expecting something that is not there.',
          },
          assumedStaple: {
            type: 'boolean',
            description:
              'True when this is one of the basic Filipino-kitchen staples this whole suggestion set already assumes are in the house — rice, salt, oil, toyo, suka, sugar, garlic, onion, water — and have is false only because it was never in the pantry list, not because the dish actually needs a trip to the shop for it. False for everything else, including a genuinely missing ingredient that have is also false for. This is what lets the app tell "nothing left to buy" apart from "needs one real thing."',
          },
        },
        required: ['name', 'amount', 'have', 'assumedStaple'],
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
    'servings',
    'description',
    'why',
    'needsShopping',
    'usesExpiring',
    'pantryUsed',
    'ingredients',
    'steps',
  ],
  additionalProperties: false,
} as const;

// Asks for exactly the featured dish, nothing else — the split that makes the
// recipes screen feel fast. Writing three full recipes (title, description,
// every ingredient, every step) in one call is what made the old single
// request take several seconds before anything could reach the screen; this
// is the same model call for one recipe instead of three, so the featured
// card can render while the two alternates are still being written (see
// ALTERNATES_SCHEMA and POST /featured below).
const FEATURED_RESULT_SCHEMA = {
  type: 'object',
  properties: {
    featured: RECIPE_SCHEMA,
  },
  required: ['featured'],
  additionalProperties: false,
} as const;

// The two alternates, fetched in a second call that starts only once the
// featured dish is already on screen — see POST /alternates below. Takes the
// featured recipe's own title as an avoid-title so the model doesn't spend
// this second call rediscovering the same dish.
const ALTERNATES_RESULT_SCHEMA = {
  type: 'object',
  properties: {
    alternates: {
      type: 'array',
      description: 'Two options, different in style and effort from each other and from the featured dish already chosen.',
      items: RECIPE_SCHEMA,
    },
  },
  required: ['alternates'],
  additionalProperties: false,
} as const;

const BROWSE_RESULT_SCHEMA = {
  type: 'object',
  properties: {
    recipes: {
      type: 'array',
      description: `Around ${BROWSE_COUNT} varied Filipino dishes for someone browsing, not cooking from a specific pantry tonight.`,
      items: RECIPE_SCHEMA,
    },
  },
  required: ['recipes'],
  additionalProperties: false,
} as const;

const SYSTEM = `You suggest what to cook tonight for a pantry-tracking app called Panzi.

You are given everything the user currently has, with what is known about how long each item has left. Suggest one featured dish and two alternates.

WHAT MAKES A GOOD SUGGESTION HERE.

Cook what is about to go off. That is the reason this app exists — the user is trying not to waste food, not to browse recipes. A dish that uses two items expiring in two days beats a nicer dish that uses none of them. Say so in the "why" line, naming the actual items.

Cook only what is actually there. Every suggestion — the featured dish and every alternate — must be made from the pantry list plus basic staples already in a Filipino kitchen: rice, salt, oil, toyo, suka, sugar, garlic, onion, water. Nothing else may appear in a recipe's ingredients, not even one thing, however common or however small the gap looks. A dish that needs one thing they do not have is exactly as unusable tonight as a dish that needs eight — do not suggest either.

This is the hard constraint the rest of this prompt sits inside. It is not "lean on" or "mostly" — an ingredient is either in the pantry list, or it is one of the staples named above, or it does not go in the recipe.

Offer as many alternates as the pantry genuinely supports real, different dishes for this way — up to two — and no more than that. A pantry that only supports one real dish gets one suggestion, not one real dish plus two padded out to look like a full page. Fewer honest suggestions beats three where two are not really cookable tonight.

Make whatever alternates you do offer genuinely different from the featured dish and from each other — not the same dish with a side swapped, and vary the effort where the pantry allows it.

WHOSE KITCHEN THIS IS.

Cook Filipino. This is a Filipino household, so suggest the food they actually eat and can actually shop for — adobo, sinigang, tinola, ginisang gulay, tortang talong, pancit, arroz caldo, sinangag, silog plates, ulam over rice. Rice is assumed to be in the house whether or not it is listed.

Use the names they use. "Ginisang munggo", not "sauteed mung bean stew". "Ulam", "sawsawan", "toyo", "suka", "patis", "bagoong", "calamansi", "gata", "sitaw", "talong", "kangkong", "malunggay" — write them plainly, no translation in brackets.

Missing ingredients must be things a Philippine palengke or sari-sari store actually stocks. Do not send someone out for creme fraiche or fresh basil. If calamansi fits, ask for calamansi, not lemon.

Every suggestion is Filipino, no exceptions — this is not a preference to lean toward, it is the whole brief. An imported ingredient does not excuse a foreign dish: a jar of pasta sauce becomes Filipino-style spaghetti (sweet, with hotdogs), not Italian spaghetti. If a pantry only really supports something that has no Filipino version at all, that is what "cook only what is actually there" and the shorter-list rule above are for — offer fewer suggestions, never a non-Filipino one.

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

// A second, separate cached prompt for "All Recipes" — a browse list with no
// pantry behind it at all, not a variant of SYSTEM. Sharing SYSTEM would mean
// fighting its opening framing ("suggest one featured dish and two
// alternates") and its "cook only what is actually there" section, both of
// which are wrong instructions when there is no pantry to be "actually
// there." Kitchen/diet/voice rules are copied verbatim from SYSTEM above —
// those hold regardless of whether a pantry was sent.
const SYSTEM_BROWSE = `You suggest Filipino dishes to browse for a pantry-tracking app called Panzi.

This is not built around anyone's shelves — there is no pantry list. The user is looking for ideas, the way they'd flip through a cookbook, not asking what to cook from what they already have.

Suggest a spread of about ${BROWSE_COUNT} different Filipino dishes a household might want to cook this week. Vary category — some ulam for rice, a merienda, a soup or stew, a noodle or rice dish, something grilled, something sweet — and vary effort, so the list reads as a real menu, not eight versions of the same idea. Never repeat a dish or a near-duplicate (two different adobo variants, two fried-rice dishes back to back) in the same list.

Every ingredient still needs an amount, and every dish still needs full steps — someone may cook straight from this without ever adding anything to a pantry first.

If, and only if, a pantry list is included with the user's message below, check every ingredient's "have" against it truthfully — true when it is genuinely in that list, false otherwise — exactly the same rule the pantry-anchored suggestion route uses, and set "assumedStaple" true for a basic Filipino-kitchen staple (rice, salt, oil, toyo, suka, sugar, garlic, onion, water) whose only reason for "have" being false is that it was never listed. This does not change what you suggest — browse freely, unconstrained by the pantry — it only changes whether each ingredient is marked correctly for someone checking what they'd need to buy. Leave "pantryUsed" and "usesExpiring" empty and "needsShopping" false regardless — those describe a suggestion built around a pantry, which this never is.

If no pantry list is included, there is nothing to check ingredients against: set every ingredient's "have" to false unless it is one of the staples above, in which case "have" stays false and "assumedStaple" is true. Never set "have" to true for anything else in that case.

WHOSE KITCHEN THIS IS.

Cook Filipino. This is a Filipino household, so suggest the food they actually eat and can actually shop for — adobo, sinigang, tinola, ginisang gulay, tortang talong, pancit, arroz caldo, sinangag, silog plates, ulam over rice. Rice is assumed to be in the house whether or not it is listed.

Use the names they use. "Ginisang munggo", not "sauteed mung bean stew". "Ulam", "sawsawan", "toyo", "suka", "patis", "bagoong", "calamansi", "gata", "sitaw", "talong", "kangkong", "malunggay" — write them plainly, no translation in brackets.

Missing ingredients must be things a Philippine palengke or sari-sari store actually stocks. Do not send someone out for creme fraiche or fresh basil. If calamansi fits, ask for calamansi, not lemon.

Every suggestion is Filipino, no exceptions — this is not a preference to lean toward, it is the whole brief. An imported ingredient does not excuse a foreign dish: a jar of pasta sauce becomes Filipino-style spaghetti (sweet, with hotdogs), not Italian spaghetti.

DIET AND ALLERGIES.

Dietary requirements are absolute, and they are not a reason to suggest worse food. A rule takes things off the table; it does not take the cuisine away. Filipino cooking without pork is still chicken adobo, tinola, sinigang na hipon, ginataang manok, beef kaldereta, pancit, ginisang gulay, tortang talong. Cook the good version of what they can eat, not an apologetic salad. Where a dish would normally use something they avoid, substitute and name it plainly in the title — "Chicken adobo", not "Adobo (no pork)".

You will often be given specific rules. Follow those exactly; they override anything general here.

Allergies are absolute. Do not include an allergen in any form, in any quantity, including as a garnish, a substitution note, or an optional extra. Do not suggest a dish that merely leaves it out — choose a different dish. Someone will cook what you write and eat it.

VOICE.

Panzi speaks plainly and in the first person. Titles are short and ordinary. The "description" line says what the dish is, plainly, for someone who has never heard of it.`;

let client: OpenAI | null = null;

function openai(): OpenAI {
  if (!client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY is not set — copy .env.example to .env');
    client = new OpenAI({ apiKey });
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
      assumedStaple: (entry as Ingredient)?.assumedStaple === true,
    }))
    .filter((entry) => entry.name.length > 0)
    .slice(0, 25);

  const steps = stringList(value.steps, 12);

  // No ingredients or no method is not a recipe, whatever the schema allowed.
  if (ingredients.length === 0 || steps.length === 0) return null;

  const minutes = Number.isFinite(value.minutes) ? Math.round(value.minutes as number) : 0;
  const servings = Number.isFinite(value.servings) ? Math.round(value.servings as number) : 0;

  return {
    title,
    look: DISH_LOOKS.includes(value.look as DishLook) ? (value.look as DishLook) : 'other',
    dishKey: DISH_KEYS.includes(value.dishKey as DishKey) ? (value.dishKey as DishKey) : 'other',
    minutes: minutes >= MIN_MINUTES && minutes <= MAX_MINUTES ? minutes : 0,
    servings: servings >= MIN_SERVINGS && servings <= MAX_SERVINGS ? servings : 0,
    description: text(value.description, 200),
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

type SuggestionBody = {
  items?: PantryLine[];
  dietary?: unknown;
  allergies?: unknown;
  mood?: unknown;
  avoidTitles?: unknown;
};

/** Everything both /featured and /alternates need out of the request body,
 *  cleaned and gated the same way the original combined route did — the
 *  same pantry line cleaning, the same "food the user doesn't eat never
 *  reaches the model" filter. Returns null (after writing the 400 itself)
 *  when there's nothing to cook with. */
function readSuggestionRequest(
  req: Request,
  res: Response
): {
  items: Record<string, unknown>[];
  dietary: string[];
  allergies: string[];
  mood: Mood;
  avoidTitles: string[];
  hiddenByDiet: number;
} | null {
  const body = (req.body ?? {}) as SuggestionBody;

  const sent = (Array.isArray(body.items) ? body.items : [])
    .map(cleanPantryLine)
    .filter((line): line is Record<string, unknown> => line !== null)
    .slice(0, MAX_ITEMS);

  if (sent.length === 0) {
    res.status(400).json({
      error: 'invalid-argument',
      message: 'There is nothing in the pantry to cook with yet.',
    });
    return null;
  }

  const dietary = stringList(body.dietary, 20);
  const allergies = stringList(body.allergies, 20);
  const mood = readMood(body.mood);
  const avoidTitles = stringList(body.avoidTitles, 20);

  const items = sent.filter((line) => !forbidsItem(String(line.name ?? ''), dietary));
  const hiddenByDiet = sent.length - items.length;

  return { items, dietary, allergies, mood, avoidTitles, hiddenByDiet };
}

/** The pantry/diet/allergy/mood/avoid-titles portion of the brief, shared by
 *  every suggestion call — /featured and /alternates each append their own
 *  final instruction line asking for a different count of dishes. */
function buildBriefLines(input: {
  items: Record<string, unknown>[];
  dietary: string[];
  allergies: string[];
  mood: Mood;
  avoidTitles: string[];
}): string[] {
  const { items, dietary, allergies, mood, avoidTitles } = input;
  const moodLine = MOOD_LINES[mood];
  // The pantry, the profile, the diet rules and the mood all go in the user
  // turn, never the system prompt. The system prompt is cached, and anything
  // that changes per request has to sit after the cache breakpoint or the cache
  // stops hitting entirely. Moving any of this up into SYSTEM would look tidier
  // and would quietly bill every call at full rate.
  const guidance = dietGuidance(dietary);

  return [
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
    ...(avoidTitles.length > 0
      ? [
          '',
          `They have already been shown these dishes recently: ${avoidTitles.join(', ')}. Suggest different ones this time. Only repeat one of these if the pantry genuinely does not support any other real option.`,
        ]
      : []),
  ];
}

/** Cleans, matches pantryUsed against the real pantry, and runs the
 *  allergy/diet gates on a list of raw model-output recipes — the same
 *  pipeline the old combined route ran once over featured+alternates
 *  together, factored out so /featured and /alternates each run it over
 *  just their own recipes. */
function cleanAndGate(
  rawRecipes: unknown[],
  items: Record<string, unknown>[],
  allergies: string[],
  dietary: string[]
): { safe: Recipe[]; skipped: Skipped[]; candidateCount: number } {
  // Held against the pantry that was actually sent. `pantryUsed` is the list the
  // app later offers to delete from someone's kitchen, so a name the model
  // invented or paraphrased must not survive to the client — the client would
  // fail to match it and silently drop it anyway, but it is cheaper to be sure
  // here, where the real list is in hand.
  const known = new Map(items.map((item) => [String(item.name).toLowerCase(), String(item.name)]));

  const candidates = rawRecipes
    .map(cleanRecipe)
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

  return { safe, skipped, candidateCount: candidates.length };
}

/**
 * The one featured dish — split off from the old combined /-with-alternates
 * call so the screen has something to show after writing one recipe instead
 * of three. See ALTERNATES_RESULT_SCHEMA and POST /alternates for the other
 * half; the client fires that second call once this one has already landed.
 */
recipesRouter.post('/featured', async (req: Request, res: Response): Promise<void> => {
  const uid = req.uid;
  const parsed0 = readSuggestionRequest(req, res);
  if (!parsed0) return;
  const { items, dietary, allergies, mood, avoidTitles, hiddenByDiet } = parsed0;

  const brief = [
    ...buildBriefLines({ items, dietary, allergies, mood, avoidTitles }),
    '',
    'Suggest one featured dish only — just the single best pick, not alternates.',
  ].join('\n');

  const startedAt = Date.now();

  let response;
  try {
    response = await openai().chat.completions.create({
      model: MODEL,
      max_completion_tokens: 4000,
      reasoning_effort: 'none',
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: brief },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'featured_recipe',
          strict: true,
          schema: FEATURED_RESULT_SCHEMA as unknown as Record<string, unknown>,
        },
      },
    });
  } catch (err: any) {
    console.error('Featured recipe call failed', { uid, message: err?.message });
    const status = err?.status === 429 ? 429 : 503;
    res.status(status).json({
      error: status === 429 ? 'resource-exhausted' : 'unavailable',
      message: 'Could not think of anything just now — try again in a moment.',
    });
    return;
  }

  const choice = response.choices[0];

  if (choice?.finish_reason === 'content_filter') {
    console.warn('Model declined the featured recipe request', { uid });
    res.json({ featured: null, skipped: [] });
    return;
  }

  const raw = choice?.message?.content;
  if (!raw) {
    console.error('No content in featured recipe response', { uid, finishReason: choice?.finish_reason });
    res.status(502).json({ error: 'internal', message: 'Could not read that answer — try again.' });
    return;
  }

  let body: { featured?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    console.error('Featured recipe response was not valid JSON', { uid });
    res.status(502).json({ error: 'internal', message: 'Could not read that answer — try again.' });
    return;
  }

  const { safe, skipped, candidateCount } = cleanAndGate([body.featured], items, allergies, dietary);

  recordUsage({
    userId: uid,
    route: 'recipes.featured',
    model: MODEL,
    durationMs: Date.now() - startedAt,
    ...tokensFrom(response.usage),
  });

  console.info('Featured recipe complete', {
    uid,
    ms: Date.now() - startedAt,
    mood,
    itemCount: items.length,
    hiddenByDiet,
    suggested: candidateCount,
    blockedByAllergy: skipped.filter((s) => s.reason === 'allergy').length,
    blockedByDiet: skipped.filter((s) => s.reason === 'diet').length,
    inputTokens: response.usage?.prompt_tokens ?? 0,
    cachedTokens: response.usage?.prompt_tokens_details?.cached_tokens ?? 0,
    outputTokens: response.usage?.completion_tokens ?? 0,
  });

  res.json({ featured: safe[0] ?? null, skipped });
});

/**
 * The two alternates, fetched separately from — and, on the client, after —
 * the featured dish above. Takes the featured recipe's own title so the
 * model doesn't waste this call rediscovering the same dish; the client
 * passes it back through `avoidTitles` alongside whatever session history
 * fetchRecipes already sends.
 */
recipesRouter.post('/alternates', async (req: Request, res: Response): Promise<void> => {
  const uid = req.uid;
  const parsed0 = readSuggestionRequest(req, res);
  if (!parsed0) return;
  const { items, dietary, allergies, mood, avoidTitles, hiddenByDiet } = parsed0;

  const brief = [
    ...buildBriefLines({ items, dietary, allergies, mood, avoidTitles }),
    '',
    `Suggest exactly ${ALTERNATE_COUNT} alternates — different in style and effort from each other and from whatever dish they've already been shown as the featured pick (named in the avoid list above, if any).`,
  ].join('\n');

  const startedAt = Date.now();

  let response;
  try {
    response = await openai().chat.completions.create({
      model: MODEL,
      max_completion_tokens: 6000,
      reasoning_effort: 'none',
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: brief },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'alternate_recipes',
          strict: true,
          schema: ALTERNATES_RESULT_SCHEMA as unknown as Record<string, unknown>,
        },
      },
    });
  } catch (err: any) {
    console.error('Alternates call failed', { uid, message: err?.message });
    const status = err?.status === 429 ? 429 : 503;
    res.status(status).json({
      error: status === 429 ? 'resource-exhausted' : 'unavailable',
      message: 'Could not think of anything just now — try again in a moment.',
    });
    return;
  }

  const choice = response.choices[0];

  if (choice?.finish_reason === 'content_filter') {
    console.warn('Model declined the alternates request', { uid });
    res.json({ alternates: [], skipped: [] });
    return;
  }

  const raw = choice?.message?.content;
  if (!raw) {
    console.error('No content in alternates response', { uid, finishReason: choice?.finish_reason });
    res.status(502).json({ error: 'internal', message: 'Could not read that answer — try again.' });
    return;
  }

  let body: { alternates?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    console.error('Alternates response was not valid JSON', { uid });
    res.status(502).json({ error: 'internal', message: 'Could not read that answer — try again.' });
    return;
  }

  const { safe, skipped, candidateCount } = cleanAndGate(
    Array.isArray(body.alternates) ? body.alternates : [],
    items,
    allergies,
    dietary
  );

  recordUsage({
    userId: uid,
    route: 'recipes.alternates',
    model: MODEL,
    durationMs: Date.now() - startedAt,
    ...tokensFrom(response.usage),
  });

  console.info('Alternates complete', {
    uid,
    ms: Date.now() - startedAt,
    mood,
    itemCount: items.length,
    hiddenByDiet,
    suggested: candidateCount,
    blockedByAllergy: skipped.filter((s) => s.reason === 'allergy').length,
    blockedByDiet: skipped.filter((s) => s.reason === 'diet').length,
    inputTokens: response.usage?.prompt_tokens ?? 0,
    cachedTokens: response.usage?.prompt_tokens_details?.cached_tokens ?? 0,
    outputTokens: response.usage?.completion_tokens ?? 0,
  });

  res.json({ alternates: safe.slice(0, ALTERNATE_COUNT), skipped });
});

/**
 * "All Recipes" — a browse list, not a suggestion set.
 *
 * Deliberately its own route rather than a mood on the route above: no
 * featured/alternates split, and none of the pantry-anchored "cook only what
 * is actually there" rules apply — a browse suggestion is never constrained
 * by the pantry. Diet and allergies still do — the two gates below are the
 * same functions the pantry route uses, applied the same way.
 *
 * The pantry itself is optional here, unlike the route above (which 400s
 * without one). Sent only so each ingredient's "have" can be marked
 * truthfully — see SYSTEM_BROWSE — which is what lets the client compute a
 * Pantry Only filter on this list the same way it does on the pantry-anchored
 * one. Its absence changes nothing about what gets suggested.
 */
recipesRouter.post('/browse', async (req: Request, res: Response): Promise<void> => {
  const uid = req.uid;
  const body = (req.body ?? {}) as {
    dietary?: unknown;
    allergies?: unknown;
    items?: PantryLine[];
    avoidTitles?: unknown;
  };

  const sent = (Array.isArray(body.items) ? body.items : [])
    .map(cleanPantryLine)
    .filter((line): line is Record<string, unknown> => line !== null)
    .slice(0, MAX_ITEMS);

  const dietary = stringList(body.dietary, 20);
  const allergies = stringList(body.allergies, 20);
  const guidance = dietGuidance(dietary);
  const avoidTitles = stringList(body.avoidTitles, 20);

  // Same reasoning as the pantry route: food the user doesn't eat never
  // reaches the model.
  const items = sent.filter((line) => !forbidsItem(String(line.name ?? ''), dietary));

  const brief = [
    ...(items.length > 0
      ? ['Here is everything in the pantry right now, so ingredients can be checked against it:', JSON.stringify(items, null, 1)]
      : []),
    '',
    ...(guidance.length > 0
      ? ['THEIR DIET — follow these exactly:', ...guidance]
      : ['No dietary requirements.']),
    '',
    allergies.length
      ? `ALLERGIES (must never appear in any form): ${allergies.join(', ')}`
      : 'No known allergies.',
    ...(avoidTitles.length > 0
      ? [
          '',
          `They have already been shown these dishes recently: ${avoidTitles.join(', ')}. Suggest different ones this time, unless there is genuinely nothing else varied left to suggest.`,
        ]
      : []),
    '',
    `Suggest about ${BROWSE_COUNT} Filipino dishes.`,
  ].join('\n');

  const startedAt = Date.now();

  let response;
  try {
    response = await openai().chat.completions.create({
      model: MODEL,
      max_completion_tokens: 8000,
      reasoning_effort: 'none',
      messages: [
        { role: 'system', content: SYSTEM_BROWSE },
        { role: 'user', content: brief },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'browse_recipes',
          strict: true,
          schema: BROWSE_RESULT_SCHEMA as unknown as Record<string, unknown>,
        },
      },
    });
  } catch (err: any) {
    console.error('Recipe browse call failed', { uid, message: err?.message });
    const status = err?.status === 429 ? 429 : 503;
    res.status(status).json({
      error: status === 429 ? 'resource-exhausted' : 'unavailable',
      message: 'Could not think of anything just now — try again in a moment.',
    });
    return;
  }

  const choice = response.choices[0];

  if (choice?.finish_reason === 'content_filter') {
    console.warn('Model declined the recipe browse request', { uid });
    res.json({ recipes: [], skipped: [] } satisfies BrowseResult);
    return;
  }

  const raw = choice?.message?.content;
  if (!raw) {
    console.error('No content in recipe browse response', {
      uid,
      finishReason: choice?.finish_reason,
    });
    res.status(502).json({ error: 'internal', message: 'Could not read that answer — try again.' });
    return;
  }

  let parsed: { recipes?: unknown };
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error('Recipe browse response was not valid JSON', { uid });
    res.status(502).json({ error: 'internal', message: 'Could not read that answer — try again.' });
    return;
  }

  const candidates = (Array.isArray(parsed.recipes) ? parsed.recipes : [])
    .map(cleanRecipe)
    .filter((recipe): recipe is Recipe => recipe !== null);

  const skipped: Skipped[] = [];
  const safe = candidates.filter((recipe) => {
    if (containsAllergen(recipe, allergies)) {
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

  recordUsage({
    userId: uid,
    route: 'recipes.browse',
    model: MODEL,
    durationMs: Date.now() - startedAt,
    ...tokensFrom(response.usage),
  });

  console.info('Recipe browse complete', {
    uid,
    ms: Date.now() - startedAt,
    suggested: candidates.length,
    blockedByAllergy: skipped.filter((s) => s.reason === 'allergy').length,
    blockedByDiet: skipped.filter((s) => s.reason === 'diet').length,
    inputTokens: response.usage?.prompt_tokens ?? 0,
    cachedTokens: response.usage?.prompt_tokens_details?.cached_tokens ?? 0,
    outputTokens: response.usage?.completion_tokens ?? 0,
  });

  // TEMP DIAGNOSTIC — remove once Pantry Only on All Recipes is confirmed
  // working. Logs exactly what pantry names went in and what have/
  // assumedStaple came back, to see whether the model is matching them.
  console.info('DEBUG browse pantry sent', { uid, names: items.map((i) => i.name) });
  for (const recipe of safe) {
    console.info('DEBUG browse recipe ingredients', {
      uid,
      title: recipe.title,
      ingredients: recipe.ingredients.map((i) => ({
        name: i.name,
        have: i.have,
        assumedStaple: i.assumedStaple,
      })),
    });
  }

  res.json({
    recipes: safe.slice(0, BROWSE_MAX),
    skipped,
  } satisfies BrowseResult);
});
