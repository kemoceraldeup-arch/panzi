// server/src/routes/scan.ts
//
// The scanner's recognition call. The client captures a photo, resizes it and
// sends the bytes here; this route asks OpenAI what is in the picture and
// returns candidates in the exact shape the review page renders.
//
// It lives server-side for one reason: the OpenAI key must never reach the
// device. Everything in an Expo bundle ships to the phone — app.json `extra`,
// `EXPO_PUBLIC_*` variables, the JS bundle itself — so a client-side call would
// publish the key to anyone who unzips the app.
//
// The route writes nothing. It reads the image and returns candidates; the user
// approves them on the review page and the client saves the approved rows
// through the pantry API. Nothing reaches the pantry without a human tick.
//
// Three reads per item, per the item-scanner design: what it is, when it goes
// off, and — for loose produce — how ripe it looks right now. The two date
// fields are kept rigidly apart, and that separation is the whole design:
//
//   expiryDate     only ever a date printed on the packaging, or ''.
//   shelfLifeDays  only ever worked out from how the food looks, or 0.
//
// The app renders the first as a solid green FROM LABEL chip and the second as
// a dashed cream ESTIMATED chip. An estimate must never be able to reach the
// user looking like a printed date, and the only robust way to guarantee that
// is for the two to travel in different fields all the way down.

import OpenAI from 'openai';
import { Request, Response, Router } from 'express';
import { recordUsage, tokensFrom } from '../usage';

// The cheapest tier, same as the other routes. Reading a faded expiry stamp or
// judging ripeness from skin freckling is genuinely hard perception, so this
// is a deliberate cost/accuracy tradeoff — expect more misreads than the
// flagship model would produce.
const MODEL = 'gpt-5.6-luna';

// Kept in sync by hand with FOOD_CATEGORIES in src/services/pantry.ts. The
// server is its own package and can't import from the app, and the enum below
// is what stops the model returning a category the List screen has no section
// for.
const FOOD_CATEGORIES = [
  'Fruit & veg',
  'Dairy & eggs',
  'Meat & fish',
  'Bakery',
  'Grains & pasta',
  'Tins & jars',
  'Frozen',
  'Herbs & spices',
  'Drinks',
  'Snacks',
];

// The four ripeness stages, in order. 'none' is the answer for anything that
// isn't loose produce — a yoghurt pot does not have a ripeness.
const RIPENESS_STAGES = ['green', 'just_ripe', 'very_ripe', 'past_best', 'none'];

// The response schema. Structured outputs constrain the model to exactly this
// shape, so the client never parses a guess about the format on top of a guess
// about the food.
//
// Optional values are empty strings and zeroes rather than nulls: the
// JSON-schema subset supported by structured outputs has no nullable
// primitive, and both are unambiguous for every field here.
const RESULT_SCHEMA = {
  type: 'object',
  properties: {
    readable: {
      type: 'boolean',
      description:
        'False when the image cannot be read at all — too dark, too blurry, too far, or simply not food.',
    },
    failureCause: {
      type: 'string',
      enum: ['dark', 'blurry', 'far', 'unrecognised', 'none'],
      description: 'Why the image could not be read. "none" when readable is true.',
    },
    sceneLabel: {
      type: 'string',
      description:
        'Where this photo was taken, in two or three words, as the user would label it looking back at it in a list: "Counter and fridge", "Freezer drawer", "Fruit bowl", "Cupboard top shelf". Not a list of the items. Empty string when you cannot tell.',
    },
    items: {
      type: 'array',
      description: 'One entry per distinct food item. Empty when readable is false.',
      items: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description:
              'What the item is, as a shopper would say it out loud — "Milo", "Cheddar", "Fresh milk". Four words at most. Do not describe the packaging or restate the flavour from the label: "Milo", not "Milo chocolate malt milk drink carton".',
          },
          nameUnsure: {
            type: 'boolean',
            description:
              'True when you had to guess what this is — a folded label, a turned-away pack, an unbranded block. The app puts these under "Needs a look" and asks the user to confirm the name. Use it honestly; a guess marked as a guess is a good outcome, a guess presented as fact is not.',
          },
          nameUnsureReason: {
            type: 'string',
            description:
              'When nameUnsure is true, one short sentence saying what got in the way, addressed to the user: "Half the label was folded over." Empty string when nameUnsure is false.',
          },
          nameAlternatives: {
            type: 'array',
            description:
              'When nameUnsure is true, up to three names this could be, best first, offered to the user as one-tap corrections. Empty when nameUnsure is false.',
            items: { type: 'string' },
          },
          count: {
            type: 'number',
            description:
              'HOW MANY of this product are in the photo. Two identical yoghurt pots is 2. One bag of crisps is 1, however much the bag weighs. A box of six eggs is 1 box — count what a person would pick up, not what is inside it. Almost always a small number.',
          },
          sizeValue: {
            type: 'number',
            description:
              'HOW BIG one of them is, as printed on the packaging — the 500 in "500 g", the 70 in "70 g". 0 when no size is printed or the item is loose. This is never the number of items.',
          },
          sizeUnit: {
            type: 'string',
            description:
              'The measured unit that goes with sizeValue, read off the label: g, kg, ml, L, oz, lb. Empty string when sizeValue is 0. Never a container word — not "pack", "bag", "box" or "each".',
          },
          measuredByWeight: {
            type: 'boolean',
            description:
              'True when this item is something a person portions out by weight or volume rather than counting individual units — rice, flour, sugar, pasta, loose spices, cooking oil, milk. False for anything counted as whole items even when it also has a printed weight — a bag of crisps, a tin of chickpeas, a dozen eggs, a loaf of bread, six yoghurt pots. The test: would a person say "add half a kilo more" (true) or "add one more" (false)? A different question from count and size above — a 1 kg bag of rice is still count 1, sizeValue 1000, sizeUnit "g", and measuredByWeight true, all at once.',
          },
          fillLevel: {
            type: 'number',
            description:
              'How much of ONE pack is left, as 1, 0.75, 0.5 or 0.25. 1 for anything sealed or unopened, and 1 whenever you cannot see how much is inside — an opaque closed box, a tin, a carton you cannot see into. Only go below 1 when you can see evidence: the level in a clear jar or bottle, a bag rolled or clipped down, a packet visibly half flat. When count is more than 1, this is for the one open pack; the others are assumed full.',
          },
          fillNote: {
            type: 'string',
            description:
              'When fillLevel is below 1, one short phrase addressed to the user naming what you saw: "Jar about half full", "Bag rolled down to a quarter". Empty string when fillLevel is 1.',
          },
          contentsVisible: {
            type: 'boolean',
            description:
              'True when you can see the food itself inside its container — a clear jar, a see-through bag, a bottle you can see the level in, an open box. False for opaque or sealed packaging you cannot see into. The app measures how full every true item is in a second, closer look.',
          },
          category: {
            type: 'string',
            // '' is allowed so an unsure read stays blank for the user to
            // pick, rather than being forced into the nearest category — which
            // in practice was Snacks for anything packaged and unfamiliar.
            enum: [...FOOD_CATEGORIES, ''],
            description:
              'Which of these the food belongs to. Only pick one you are confident of; empty string when you cannot tell what kind of food it is. Never use Snacks as a fallback for something you are unsure about.',
          },
          location: {
            type: 'string',
            description:
              'Where it is stored, if the picture shows it — "Fridge", "Freezer", "Cupboard", "Counter". Empty string when you cannot tell.',
          },
          expiryDate: {
            type: 'string',
            description:
              'ONLY a use-by or best-before date you can actually read printed on the packaging, as YYYY-MM-DD. Empty string when no date is printed or it is not legible. Never estimate this field — an estimate goes in shelfLifeDays instead.',
          },
          looseProduce: {
            type: 'boolean',
            description:
              'True for unpackaged fruit and vegetables whose condition you can see — bananas, avocados, tomatoes on the counter. False for anything sealed, tinned, boxed or bottled. Loose produce is the only thing you judge ripeness for.',
          },
          ripeness: {
            type: 'string',
            enum: RIPENESS_STAGES,
            description:
              'How ripe this looks right now. "none" for anything that is not loose produce, and for loose produce you genuinely cannot judge.',
          },
          ripenessNotes: {
            type: 'array',
            description:
              'Exactly two short observations that justify the ripeness, each naming something visible: "Even yellow skin, a few brown freckles", "Stems still firm, no split skin". Shown to the user under "How I judged it". Empty when ripeness is "none".',
            items: { type: 'string' },
          },
          ripenessBlocked: {
            type: 'string',
            description:
              'When this is loose produce but you could not judge it, one short reason addressed to the user: "Couldn\'t judge through the film". Empty string otherwise.',
          },
          shelfLifeDays: {
            type: 'number',
            description:
              'Your estimate of how many days this has left, worked out from how it looks and, just as often, from general knowledge of how that kind of food typically keeps — canned, dried, and shelf-stable goods included, not only fresh produce. Fill this in whenever expiryDate is empty, which is most items. 0 only when you cannot identify the food well enough to know its typical shelf life at all.',
          },
          box: {
            type: 'object',
            description:
              'Where the item sits in the image, as fractions of width and height. Use zeroes when you cannot localise it.',
            properties: {
              x: { type: 'number' },
              y: { type: 'number' },
              width: { type: 'number' },
              height: { type: 'number' },
            },
            required: ['x', 'y', 'width', 'height'],
            additionalProperties: false,
          },
        },
        required: [
          'name',
          'nameUnsure',
          'nameUnsureReason',
          'nameAlternatives',
          'count',
          'sizeValue',
          'sizeUnit',
          'measuredByWeight',
          'fillLevel',
          'fillNote',
          'contentsVisible',
          'category',
          'location',
          'expiryDate',
          'looseProduce',
          'ripeness',
          'ripenessNotes',
          'ripenessBlocked',
          'shelfLifeDays',
          'box',
        ],
        additionalProperties: false,
      },
    },
  },
  required: ['readable', 'failureCause', 'sceneLabel', 'items'],
  additionalProperties: false,
} as const;

const SYSTEM = `You read photographs of food for a pantry-tracking app called Panzi.

The user sees everything you return and checks it before anything is saved, so your job is an honest reading, not a confident one. Say what you can actually see. If a label is half-turned and you can only tell it is a yoghurt, return "Yoghurt" with nameUnsure true rather than inventing a brand and a pack size. An item marked unsure goes to the top of the user's review page under "Needs a look", which is exactly the right place for anything you had to guess at — use it.

List each distinct product once. Six eggs in a box is one item with a quantity of 6, not six items. Do not list crockery, packaging, appliances, hands, or anything you cannot eat.

BE EXHAUSTIVE. A shelf or fridge photo is very often crowded — several rows, items partly behind one another, small jars and packets at the edges or in the background. Scan the entire frame methodically, corner to corner and front to back, before you finish your answer. Missing an item the user can plainly see is a worse mistake than being unsure about one you did list — an uncertain guess can be marked nameUnsure and fixed with one tap, but a skipped item never appears at all and the user has to notice it is missing and add it by hand. When a photo shows many items, err toward listing every plausible one, including partially hidden or small items at the back or edges, rather than stopping once you have found the obvious ones at the front.

When the same food sits in two containers — rice in a bag and more rice in a jar — they are two items, and their names must tell them apart: "Rice bag" and "Rice jar", not "Rice" twice or a name that doesn't say which is which.

Name things the way a person would say them while unpacking a bag — short. The name and the quantity sit side by side in a narrow row, so a name that runs past four words gets cut off and the user cannot read what you found.

COUNT AND SIZE ARE DIFFERENT NUMBERS.

count is how many things a person would pick up. size is how big one of them is, printed on the packet. A single 70 g bag of crisps is count 1, sizeValue 70, sizeUnit "g" — never count 70. Two 500 g yoghurt pots are count 2, sizeValue 500, sizeUnit "g". Five loose bananas are count 5, sizeValue 0, sizeUnit "". Getting these the wrong way round tells the user they own seventy bags of crisps, so read the packet twice before you answer.

count is what the user's own quantity control shows, and it is nearly always between 1 and about a dozen. If you find yourself writing a large number there, it is almost certainly a weight and belongs in sizeValue.

Bulk sacks are common — rice especially comes in 5 kg, 10 kg, 25 kg and 50 kg sacks, and the net weight is usually printed large on the front as "25 KG", "25 KGS", "NET WT. 25 KILOS" or similar. Look for it and read it: one 25 kg sack of rice is count 1, sizeValue 25, sizeUnit "kg". Never shrink a sack to a small retail size — a woven or plastic sack that fills the frame is not a 500 g packet.

HOW MUCH IS LEFT IS A FOURTH QUESTION.

People scan their pantry, not just their shopping, so plenty of packs are part used. fillLevel is how much of one pack remains, in quarters: 1, 0.75, 0.5 or 0.25. sizeValue stays the printed size of a full pack — a 1 kg bag of rice that is half gone is sizeValue 1000, sizeUnit "g", fillLevel 0.5, never sizeValue 500. Judge only from what you can see: the level through a clear jar or bottle, a bag rolled or clipped down, a packet sagging half flat, an open box you can see into. Anything sealed, or anything you cannot see into, is 1 — do not guess that a closed carton is half empty. When you do go below 1, say what you saw in fillNote so the user can check it.

MEASURED VS COUNTED IS A FIFTH, SEPARATE QUESTION.

measuredByWeight says whether the user's own quantity control should let them enter a fraction — half a bag of rice, a cup and a half of flour — or only whole numbers. Rice, flour, sugar, pasta, loose herbs and spices, cooking oil, milk are measuredByWeight true. A tin of chickpeas, a dozen eggs, a loaf of bread, a bag of crisps are measuredByWeight false — the user counts these as whole items, however much any one of them weighs. This never changes what goes in count or sizeValue; it only tells the app which kind of "how many" control to draw.

THE TWO DATE FIELDS ARE NOT INTERCHANGEABLE.

expiryDate is for a date printed on the packaging that you can actually read in the image. If no date is printed, or you cannot read it, expiryDate is an empty string. Never put a calculated or remembered date here. The app shows this field to the user as a fact read off their label, and a guess wearing that badge is the single worst thing you can return.

shelfLifeDays is for your own estimate of how long the food has left, from how it looks and what it is. The app always shows this as an estimate, in a visibly different style, with the words "a guess, not a printed date" next to it. Give one whenever expiryDate is empty — which is most of the time, since most packaging has no legible date in a shelf photo. You have a real basis for this far more often than not: general knowledge of how that category of food keeps is itself a basis. An unopened tin of chickpeas, a bag of rice, a jar of peanut butter, a carton of long-life milk, a box of pasta — every one of these has a well-known typical shelf life you already know, sealed or not, even with no visible date and no visible spoilage. Use that knowledge. Reach for 0 only when you genuinely cannot place the item into any food category with a known shelf life at all — not merely because the packaging itself is unlabelled. A rough estimate the user can correct in one tap is far more useful to them than an empty field that quietly asks them to type in a date from memory.

An item can have both: a printed use-by date and your own view of how long it will really last. It can have neither. They never substitute for one another.

RIPENESS.

Loose produce — unpackaged fruit and vegetables whose surface you can see — gets a ripeness stage: green, just_ripe, very_ripe or past_best. Judge what is in front of you, not what the fruit usually looks like. Give exactly two short notes saying what you actually saw: skin colour, freckling, firmness cues, stem condition, any splitting or bruising. The user reads those notes and can overrule you, so name the evidence rather than the conclusion.

Anything sealed, tinned, boxed or bottled has ripeness "none" and no notes. If something is loose produce but you cannot judge it — a punnet under a film lid, deep shadow, a bag in the way — set ripeness to "none" and say why in ripenessBlocked, in one short phrase addressed to the user.

Ripeness and shelf life should agree. Produce you call past_best does not have a week left.

Give the whole photo a sceneLabel — two or three words for where this was taken, so the user recognises the scan in a list a week later.

If the image cannot be read, set readable to false and pick the cause that best explains it: dark, blurry, far, or unrecognised.`;

type Ripeness = 'green' | 'just_ripe' | 'very_ripe' | 'past_best' | 'none';

type Candidate = {
  name: string;
  nameUnsure: boolean;
  nameUnsureReason: string;
  nameAlternatives: string[];
  count: number;
  sizeValue: number;
  sizeUnit: string;
  measuredByWeight: boolean;
  fillLevel: number;
  fillNote: string;
  contentsVisible: boolean;
  category: string;
  location: string;
  expiryDate: string;
  looseProduce: boolean;
  ripeness: Ripeness;
  ripenessNotes: string[];
  ripenessBlocked: string;
  shelfLifeDays: number;
  box: { x: number; y: number; width: number; height: number };
};

type Result = {
  readable: boolean;
  failureCause: 'dark' | 'blurry' | 'far' | 'unrecognised' | 'none';
  sceneLabel: string;
  items: Candidate[];
};

const ALLOWED_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
type MediaType = (typeof ALLOWED_MEDIA_TYPES)[number];

// Base64 inflates by ~4/3, so this caps the decoded image near 5MB — well
// inside the body limit set in index.ts and the model's own image limit.
const MAX_BASE64_LENGTH = 7_000_000;

// No food keeps for a decade, and a four-figure estimate rendered as "2739
// days" in the review page is a bug the user has to notice on our behalf.
export const MAX_SHELF_LIFE_DAYS = 730;

// Built once per process rather than per request: the client is a thin wrapper
// around fetch, and rebuilding it on every scan throws away keep-alive.
let client: OpenAI | null = null;

export function openai(): OpenAI {
  if (!client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY is not set — copy .env.example to .env');
    client = new OpenAI({ apiKey });
  }
  return client;
}

/**
 * The most of one thing a person plausibly photographed at once.
 *
 * A guarantee where the prompt is only a request. The failure this exists for
 * is real and was seen in testing: a 70 g bag of crisps came back as a count of
 * 70, and the review page dutifully offered the user a quantity stepper reading
 * seventy. A weight leaking into the count is the single most likely mistake
 * here, because the number is printed right there on the packet — so anything
 * implausible as a count is treated as one rather than trusted.
 *
 * Deliberately not clamped to this value: a count of 70 is far more likely to
 * be a misread weight than a genuine seventy items, and silently saving 24
 * would be inventing an answer. It falls back to 1 and the user, who can see
 * the shelf, corrects it.
 */
const MAX_PLAUSIBLE_COUNT = 24;

// Container words the model reaches for when it is measuring — they are never a
// unit of size. "1 pack" says nothing the count doesn't already say and, as a
// tester put it, the thing in the photo was not a pack anyway. A real
// measurement — 200 g, 1 L — is not in this list and survives.
const COUNTING_UNITS = new Set([
  'pack',
  'packs',
  'packet',
  'packets',
  'piece',
  'pieces',
  'pc',
  'pcs',
  'each',
  'item',
  'items',
  'unit',
  'units',
  'box',
  'boxes',
  'bag',
  'bags',
  'carton',
  'cartons',
  'bottle',
  'bottles',
  'can',
  'cans',
  'tin',
  'tins',
]);

const UNIT_ALIASES: Record<string, string> = {
  g: 'g',
  gm: 'g',
  gms: 'g',
  gr: 'g',
  gram: 'g',
  grams: 'g',
  gramme: 'g',
  grammes: 'g',
  kg: 'kg',
  kgs: 'kg',
  kilo: 'kg',
  kilos: 'kg',
  kilogram: 'kg',
  kilograms: 'kg',
  ml: 'ml',
  mls: 'ml',
  millilitre: 'ml',
  millilitres: 'ml',
  milliliter: 'ml',
  milliliters: 'ml',
  l: 'L',
  lt: 'L',
  ltr: 'L',
  ltrs: 'L',
  litre: 'L',
  litres: 'L',
  liter: 'L',
  liters: 'L',
  oz: 'oz',
  ounce: 'oz',
  ounces: 'oz',
  lb: 'lb',
  lbs: 'lb',
  pound: 'lb',
  pounds: 'lb',
};

/**
 * Drops a size unit that isn't a measurement.
 *
 * The prompt asks for this, but a prompt is a request and this is a guarantee —
 * and the model reaches for "pack" most often on exactly the cluttered shelf
 * photos where the user is least able to check.
 */
function cleanUnit(name: string, unit: unknown): string {
  if (typeof unit !== 'string') return '';
  const trimmed = unit.trim();
  if (!trimmed) return '';

  const lower = trimmed.toLowerCase().replace(/\.$/, '');
  if (COUNTING_UNITS.has(lower)) return '';

  // Labels spell the same unit a dozen ways — a rice sack reads "25 KGS" or
  // "25 KILOS" far more often than "25 kg". The app only converts the
  // canonical spellings, so an alias left as-is was read as grams: 25 kilos
  // became 25 g.
  const canonical = UNIT_ALIASES[lower];
  if (canonical) return canonical;

  // "Oreo biscuits pack" + "pack" — the name already carries the word, so
  // repeating it adds nothing even if it isn't in the list above.
  const words = name.toLowerCase().split(/[^a-z0-9]+/);
  if (words.includes(lower)) return '';

  return trimmed;
}

/**
 * Snaps a fill reading to 5% steps — fine enough to turn into grams, coarse
 * enough not to claim a precision a photo can't give. The app rounds further
 * to quarters where its pack stepper needs them.
 *
 * Anything missing or out of range reads as a full pack: an unreadable answer
 * is "couldn't see in", and the prompt's rule for that is 1. A reading of 0
 * would be an empty pack, which is a thing to throw away, not to save.
 */
function cleanFillLevel(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 1;
  const snapped = Math.round(raw * 20) / 20;
  return Math.min(1, Math.max(0.05, snapped));
}

// ─── Fill measurement ─────────────────────────────────────────────────────
//
// The first read judges fullness in one glance, alongside a dozen other
// questions, on the cheapest model — and it was wrong in the way that matters:
// a see-through bag with rice in its bottom quarter came back "half left".
// A second, narrower call on a stronger model fixes that by measuring instead
// of judging: it marks where the container's top and bottom are and where the
// food's surface sits, and the fraction is computed here from those three
// heights. Asking for positions rather than a percentage is what makes it
// precise — a model is far better at "where is the rice line" than at "what
// fraction is this".

const MEASURE_MODEL = 'gpt-5.6-terra';

const MEASURE_SCHEMA = {
  type: 'object',
  properties: {
    measurements: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'number', description: 'The number of the item in the list you were given.' },
          found: {
            type: 'boolean',
            description: 'False when you cannot find this container or cannot see the food level in it.',
          },
          containerLeft: { type: 'number' },
          containerRight: { type: 'number' },
          containerTop: {
            type: 'number',
            description:
              'Top of the space the food can fill, as a fraction of image height from the top (0 = top edge, 1 = bottom edge). A jar: just under the lid or shoulder. A bag: where it is folded, clipped, tied or sealed shut — not the loose flap above that.',
          },
          containerBottom: {
            type: 'number',
            description: 'The bottom of the inside of the container, as a fraction of image height from the top.',
          },
          contentsTop: {
            type: 'number',
            description:
              'The surface of the food inside — the average height of the top of the rice, liquid or powder — as a fraction of image height from the top. If the surface is uneven or tilted, its average level.',
          },
          fillPercent: {
            type: 'number',
            description:
              'Your own estimate, 0 to 100, of how full the container is by volume. A cross-check on the heights above.',
          },
          note: {
            type: 'string',
            description: 'One short phrase for the user saying what you saw: "Rice fills the bottom quarter of the bag".',
          },
        },
        required: [
          'index',
          'found',
          'containerLeft',
          'containerRight',
          'containerTop',
          'containerBottom',
          'contentsTop',
          'fillPercent',
          'note',
        ],
        additionalProperties: false,
      },
    },
  },
  required: ['measurements'],
  additionalProperties: false,
} as const;

const MEASURE_SYSTEM = `You measure how full food containers are in a photograph, for a pantry app that turns your answer into how much food the user has left.

You are given a numbered list of items already found in the photo, each with a rough box. The boxes can be off, or even point at a neighbouring container — find the container that actually holds the named item, and describe that one.

For each item, mark three heights, each as a fraction of the WHOLE IMAGE's height measured from the top edge (0 is the top edge, 1 is the bottom edge):
- containerTop: the top of the space the food could fill. For a bag, that is where it is folded, clipped, tied or sealed — a floppy empty flap above the closure does not count. For a jar or bottle, just below the lid or neck.
- containerBottom: the inside bottom of the container.
- contentsTop: the surface of the food — where the rice, grain, liquid or powder stops. Look closely; in a clear bag the top of the food is where the texture of grains ends and empty, crinkled plastic begins.

Also give containerLeft and containerRight as fractions of image width, and your own fillPercent as a cross-check.

Be exact. Measure, don't guess from a first impression: a bag with food only in its bottom quarter is 25% full even if the bag is bulging there. If you cannot see the food level at all, set found to false.`;

type Measurement = {
  index: number;
  found: boolean;
  containerLeft: number;
  containerRight: number;
  containerTop: number;
  containerBottom: number;
  contentsTop: number;
  fillPercent: number;
  note: string;
};

const inUnit = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1;

/**
 * The fill fraction from a measurement's heights, cross-checked against the
 * model's own percentage. The heights win: they are the precise part. When
 * they are unusable (the container has no height, the surface sits outside
 * it) the percentage stands in, and when both are unusable there's no answer.
 */
function fillFromMeasurement(m: Measurement): number | null {
  if (inUnit(m.containerTop) && inUnit(m.containerBottom) && inUnit(m.contentsTop)) {
    const height = m.containerBottom - m.containerTop;
    if (height > 0.02) {
      const surface = Math.min(m.containerBottom, Math.max(m.containerTop, m.contentsTop));
      return (m.containerBottom - surface) / height;
    }
  }
  if (typeof m.fillPercent === 'number' && Number.isFinite(m.fillPercent) && m.fillPercent > 0) {
    return Math.min(100, m.fillPercent) / 100;
  }
  return null;
}

/**
 * Re-measures fullness for every item whose contents can be seen, in place.
 * Never fails the scan: on any error the first read's numbers stand, since a
 * rough answer is still better than none.
 */
export async function measureFillLevels(
  uid: string | undefined,
  imageUrl: string,
  items: Candidate[],
): Promise<void> {
  const targets = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.contentsVisible || item.fillLevel < 1);
  if (targets.length === 0) return;

  const list = targets
    .map(({ item, index }) => {
      const b = item.box;
      const where =
        b && b.width > 0 && b.height > 0
          ? ` — roughly x ${b.x.toFixed(2)}–${(b.x + b.width).toFixed(2)}, y ${b.y.toFixed(2)}–${(b.y + b.height).toFixed(2)}`
          : '';
      return `${index}: ${item.name}${where}`;
    })
    .join('\n');

  const startedAt = Date.now();
  try {
    const response = await openai().chat.completions.create({
      model: MEASURE_MODEL,
      max_completion_tokens: 12000,
      messages: [
        { role: 'system', content: MEASURE_SYSTEM },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: imageUrl, detail: 'high' } },
            { type: 'text', text: `Measure how full each of these is:\n${list}` },
          ],
        },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'fill_measurements',
          strict: true,
          schema: MEASURE_SCHEMA as unknown as Record<string, unknown>,
        },
      },
    });

    // A second, high-detail look at the same photo — billed on its own, so it
    // gets its own row rather than hiding inside the scan's.
    recordUsage({
      userId: uid,
      route: 'scan-measure',
      model: MEASURE_MODEL,
      durationMs: Date.now() - startedAt,
      ...tokensFrom(response.usage),
    });

    const raw = response.choices[0]?.message?.content;
    if (!raw) return;
    const parsed = JSON.parse(raw) as { measurements?: Measurement[] };

    for (const m of parsed.measurements ?? []) {
      const item = items[m.index];
      if (!item || !m.found || !targets.some((t) => t.index === m.index)) continue;
      const fill = fillFromMeasurement(m);
      if (fill === null) continue;

      item.fillLevel = cleanFillLevel(fill);
      item.fillNote = item.fillLevel < 1 ? String(m.note ?? '').trim() : '';

      // The measured container is a tighter, checked outline than the first
      // read's box — which, on a counter with a bag and a jar of the same
      // food, outlined the jar for the bag. Taken only when it's a real box.
      if (
        inUnit(m.containerLeft) &&
        inUnit(m.containerRight) &&
        m.containerRight - m.containerLeft > 0.02 &&
        m.containerBottom - m.containerTop > 0.02
      ) {
        item.box = {
          x: m.containerLeft,
          y: m.containerTop,
          width: m.containerRight - m.containerLeft,
          height: m.containerBottom - m.containerTop,
        };
      }
    }

    console.info('Fill measured', {
      uid,
      readings: (parsed.measurements ?? []).map((m) => {
        const fill = m.found ? fillFromMeasurement(m) : null;
        return `${items[m.index]?.name ?? m.index}: ${fill === null ? 'not found' : `${Math.round(fill * 100)}%`} (model said ${m.fillPercent}%)`;
      }),
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
    });
  } catch (err: any) {
    console.warn('Fill measurement failed; keeping first read', { uid, message: err?.message });
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Guarantees expiryDate is a printed date or nothing.
 *
 * The schema can only say "string"; it can't stop the model writing "soon", a
 * partial "2026-09", or a date it worked out rather than read. Anything that
 * isn't a well-formed calendar date is dropped, because the field's entire
 * contract with the UI is that whatever survives here was printed on the pack.
 */
function cleanPrintedDate(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!ISO_DATE.test(trimmed)) return '';
  const [y, m, d] = trimmed.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return '';
  // Round-tripped through Date to reject the 31st of February, which passes
  // the range check above but is not a day.
  const parsed = new Date(Date.UTC(y, m - 1, d));
  if (parsed.getUTCMonth() !== m - 1 || parsed.getUTCDate() !== d) return '';
  return trimmed;
}

function cleanStrings(raw: unknown, limit: number): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s): s is string => typeof s === 'string')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, limit);
}

function cleanRipeness(raw: unknown, looseProduce: boolean): Ripeness {
  if (!looseProduce) return 'none';
  return RIPENESS_STAGES.includes(raw as string) ? (raw as Ripeness) : 'none';
}

export const scanRouter = Router();

scanRouter.post('/', async (req: Request, res: Response): Promise<void> => {
  const uid = req.uid;
  const { imageBase64, mediaType } = (req.body ?? {}) as {
    imageBase64?: string;
    mediaType?: string;
  };

  if (typeof imageBase64 !== 'string' || !imageBase64) {
    res.status(400).json({ error: 'invalid-argument', message: 'No image was sent.' });
    return;
  }
  if (imageBase64.length > MAX_BASE64_LENGTH) {
    res
      .status(400)
      .json({ error: 'invalid-argument', message: 'That photo is too large — resize it before sending.' });
    return;
  }
  if (!ALLOWED_MEDIA_TYPES.includes(mediaType as MediaType)) {
    res.status(400).json({ error: 'invalid-argument', message: `Unsupported image type: ${mediaType}` });
    return;
  }

  // One brief. The scanner used to carry four modes — shelf, receipt, use-by
  // date, handwritten note — and the item-scanner design collapsed them into
  // this: a photo of food, read for all three things at once.
  const brief =
    'This is a photo of food — on a counter, in a fridge, in a cupboard, or just unpacked. List every distinct food item you can see, including ones that are small, partly hidden behind something else, or sitting at the back or edges of the shot — not just the items at the front. Read pack sizes and printed dates off the labels where they are legible, and judge the ripeness of any loose fruit or vegetables.';

  const startedAt = Date.now();
  let response;
  try {
    response = await openai().chat.completions.create({
      model: MODEL,
      // This model is a reasoning model — the completion budget has to cover
      // its internal reasoning tokens as well as the visible JSON output, not
      // just the JSON alone the way a non-reasoning model would need.
      max_completion_tokens: 16000,
      messages: [
        { role: 'system', content: SYSTEM },
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: `data:${mediaType};base64,${imageBase64}`, detail: 'high' },
            },
            { type: 'text', text: brief },
          ],
        },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'scan_result',
          strict: true,
          schema: RESULT_SCHEMA as unknown as Record<string, unknown>,
        },
      },
    });
  } catch (err: any) {
    console.error('OpenAI call failed', { uid, message: err?.message });
    // Rate limiting is worth telling apart, because "wait a moment" is true
    // advice for it and misleading for anything else.
    const status = err?.status === 429 ? 429 : 503;
    res.status(status).json({
      error: status === 429 ? 'resource-exhausted' : 'unavailable',
      message: 'Could not read that photo — try again in a moment.',
    });
    return;
  }

  const choice = response.choices[0];

  if (choice?.finish_reason === 'content_filter') {
    console.warn('Model declined the image', { uid });
    res.json({ readable: false, failureCause: 'unrecognised', sceneLabel: '', items: [] } satisfies Result);
    return;
  }

  const rawContent = choice?.message?.content;
  if (!rawContent) {
    console.error('No content in response', { uid, finishReason: choice?.finish_reason });
    res.status(502).json({ error: 'internal', message: 'Could not read that photo — try again.' });
    return;
  }

  let parsed: Result;
  try {
    parsed = JSON.parse(rawContent) as Result;
  } catch {
    console.error('Response was not valid JSON', { uid });
    res.status(502).json({ error: 'internal', message: 'Could not read that photo — try again.' });
    return;
  }

  // The schema guarantees the shape; this guards the values inside it. A
  // negative quantity, a 3000-day shelf life or a ripeness on a tin of beans
  // would all render as nonsense in the review page, and an enum can't police
  // numbers or cross-field agreement.
  const items = (Array.isArray(parsed.items) ? parsed.items : [])
    .filter((item) => item && typeof item.name === 'string' && item.name.trim().length > 0)
    .map((item) => {
      const name = item.name.trim();
      const looseProduce = item.looseProduce === true;
      const ripeness = cleanRipeness(item.ripeness, looseProduce);
      const nameUnsure = item.nameUnsure === true;
      const fillLevel = cleanFillLevel(item.fillLevel);

      return {
        ...item,
        name,
        nameUnsure,
        // Both only mean anything alongside an unsure name; carrying them on a
        // confident row would put a "tap to fix" reason on a card that has
        // nothing wrong with it.
        nameUnsureReason: nameUnsure ? String(item.nameUnsureReason ?? '').trim() : '',
        nameAlternatives: nameUnsure ? cleanStrings(item.nameAlternatives, 3) : [],
        // A count outside the plausible range is read as a weight that leaked
        // out of sizeValue, and falls back to 1 rather than being trusted.
        count:
          Number.isFinite(item.count) &&
          item.count >= 1 &&
          item.count <= MAX_PLAUSIBLE_COUNT
            ? Math.round(item.count)
            : 1,
        sizeValue:
          Number.isFinite(item.sizeValue) && item.sizeValue > 0
            ? Math.round(item.sizeValue * 100) / 100
            : 0,
        sizeUnit: cleanUnit(name, item.sizeUnit),
        measuredByWeight: item.measuredByWeight === true,
        fillLevel,
        // A note only means something next to a part-used pack; on a full one
        // it would flag a card that has nothing to check.
        fillNote: fillLevel < 1 ? String(item.fillNote ?? '').trim() : '',
        contentsVisible: item.contentsVisible === true,
        expiryDate: cleanPrintedDate(item.expiryDate),
        looseProduce,
        ripeness,
        ripenessNotes: ripeness === 'none' ? [] : cleanStrings(item.ripenessNotes, 2),
        // Only ever an explanation for produce that went unjudged. On a sealed
        // pot it would read as a failure where there was nothing to attempt.
        ripenessBlocked:
          looseProduce && ripeness === 'none' ? String(item.ripenessBlocked ?? '').trim() : '',
        shelfLifeDays: Number.isFinite(item.shelfLifeDays)
          ? Math.min(MAX_SHELF_LIFE_DAYS, Math.max(0, Math.round(item.shelfLifeDays)))
          : 0,
      };
    });

  // The per-scan cost, kept rather than only printed. "API cost per scan" is
  // an admin feature in HANDOFF.md, and one row per call is the whole of what
  // makes it answerable later.
  recordUsage({
    userId: uid,
    route: 'scan',
    model: MODEL,
    durationMs: Date.now() - startedAt,
    ...tokensFrom(response.usage),
  });

  // A closer look at anything whose level can be seen, before the numbers go
  // out — see measureFillLevels.
  if (parsed.readable && items.length > 0) {
    await measureFillLevels(uid, `data:${mediaType};base64,${imageBase64}`, items);
  }

  // The per-scan cost line, so a spike in either figure shows up in the logs
  // rather than only on the bill at the end of the month.
  console.info('Scan complete', {
    uid,
    readable: parsed.readable,
    itemCount: items.length,
    produceCount: items.filter((i) => i.looseProduce).length,
    unsureCount: items.filter((i) => i.nameUnsure).length,
    // What was read for each item, so a wrong amount on the review page can be
    // traced to the model's reading or to the app's handling of it.
    sizes: items.map(
      (i) => `${i.name}: ${i.count} × ${i.sizeValue || '?'} ${i.sizeUnit}, ${Math.round(i.fillLevel * 100)}% left`,
    ),
    inputTokens: response.usage?.prompt_tokens ?? 0,
    cachedTokens: response.usage?.prompt_tokens_details?.cached_tokens ?? 0,
    outputTokens: response.usage?.completion_tokens ?? 0,
  });

  // A read that finds nothing is a failed read, whatever the model called it —
  // the "Nothing found" screen is the honest destination, not an empty review
  // page.
  if (!parsed.readable || items.length === 0) {
    const cause = parsed.failureCause && parsed.failureCause !== 'none' ? parsed.failureCause : 'unrecognised';
    res.json({ readable: false, failureCause: cause, sceneLabel: '', items: [] } satisfies Result);
    return;
  }

  res.json({
    readable: true,
    failureCause: 'none',
    sceneLabel: typeof parsed.sceneLabel === 'string' ? parsed.sceneLabel.trim() : '',
    items,
  } satisfies Result);
});
