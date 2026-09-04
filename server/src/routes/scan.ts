// server/src/routes/scan.ts
//
// The scanner's recognition call. The client captures a photo, resizes it and
// sends the bytes here; this route asks Claude what is in the picture and
// returns candidates in the exact shape the review page renders.
//
// It lives server-side for one reason: the Anthropic key must never reach the
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

import Anthropic from '@anthropic-ai/sdk';
import { Request, Response, Router } from 'express';

// Chosen for vision: 2576px on the long edge, against 1568px on older models.
// That headroom is what makes faded expiry stamps and skin freckling legible.
const MODEL = 'claude-opus-5';

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
          category: { type: 'string', enum: FOOD_CATEGORIES },
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

Name things the way a person would say them while unpacking a bag — short. The name and the quantity sit side by side in a narrow row, so a name that runs past four words gets cut off and the user cannot read what you found.

COUNT AND SIZE ARE DIFFERENT NUMBERS.

count is how many things a person would pick up. size is how big one of them is, printed on the packet. A single 70 g bag of crisps is count 1, sizeValue 70, sizeUnit "g" — never count 70. Two 500 g yoghurt pots are count 2, sizeValue 500, sizeUnit "g". Five loose bananas are count 5, sizeValue 0, sizeUnit "". Getting these the wrong way round tells the user they own seventy bags of crisps, so read the packet twice before you answer.

count is what the user's own quantity control shows, and it is nearly always between 1 and about a dozen. If you find yourself writing a large number there, it is almost certainly a weight and belongs in sizeValue.

MEASURED VS COUNTED IS A THIRD, SEPARATE QUESTION.

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
let client: Anthropic | null = null;

export function anthropic(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set — copy .env.example to .env');
    client = new Anthropic({ apiKey });
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

  const lower = trimmed.toLowerCase();
  if (COUNTING_UNITS.has(lower)) return '';

  // "Oreo biscuits pack" + "pack" — the name already carries the word, so
  // repeating it adds nothing even if it isn't in the list above.
  const words = name.toLowerCase().split(/[^a-z0-9]+/);
  if (words.includes(lower)) return '';

  return trimmed;
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

  let response;
  try {
    response = await anthropic().messages.create({
      model: MODEL,
      max_tokens: 8000,
      // Cached, because it is byte-identical on every scan a user ever takes —
      // the prompt is long and re-reading it at full price on each photo is the
      // easiest money this route wastes. Cache reads bill at a tenth of input
      // rate, and the minimum cacheable prefix on this model is 512 tokens,
      // which this comfortably clears.
      //
      // Caching is a prefix match, so the order matters: the system prompt
      // renders before `messages`, and the image — the one part that differs
      // every time — sits in `messages`. Nothing volatile may ever move above
      // this block, or the cache stops hitting and nobody notices except the
      // bill.
      system: [
        {
          type: 'text',
          text: SYSTEM,
          cache_control: { type: 'ephemeral' },
        },
      ],
      output_config: {
        // Low, not medium. Reading a label and looking at a banana are both
        // perception rather than deliberation, and thinking is on by default on
        // this model — so the effort setting is buying latency the user watches
        // a progress bar for, and output tokens at $25/M. Raise it if the
        // ripeness reads turn out to need the deliberation; the token counts
        // logged below are how you'd know.
        effort: 'low',
        format: { type: 'json_schema', schema: RESULT_SCHEMA as unknown as Record<string, unknown> },
      },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType as MediaType, data: imageBase64 },
            },
            { type: 'text', text: brief },
          ],
        },
      ],
    });
  } catch (err: any) {
    console.error('Anthropic call failed', { uid, message: err?.message });
    // Rate limiting is worth telling apart, because "wait a moment" is true
    // advice for it and misleading for anything else.
    const status = err?.status === 429 ? 429 : 503;
    res.status(status).json({
      error: status === 429 ? 'resource-exhausted' : 'unavailable',
      message: 'Could not read that photo — try again in a moment.',
    });
    return;
  }

  if (response.stop_reason === 'refusal') {
    console.warn('Model declined the image', { uid, category: response.stop_details?.category ?? null });
    res.json({ readable: false, failureCause: 'unrecognised', sceneLabel: '', items: [] } satisfies Result);
    return;
  }

  const text = response.content.find((block) => block.type === 'text');
  if (!text || text.type !== 'text') {
    console.error('No text block in response', { uid, stopReason: response.stop_reason });
    res.status(502).json({ error: 'internal', message: 'Could not read that photo — try again.' });
    return;
  }

  let parsed: Result;
  try {
    parsed = JSON.parse(text.text) as Result;
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

  // The per-scan cost line. `inputTokens` is the *uncached remainder* only —
  // the true prompt size is the three input figures added together, so reading
  // it alone will make caching look like it shrank the prompt rather than
  // repriced it. A `cacheReadTokens` of 0 on every scan means the cache is
  // silently missing and the system prompt is being billed at full rate.
  console.info('Scan complete', {
    uid,
    readable: parsed.readable,
    itemCount: items.length,
    produceCount: items.filter((i) => i.looseProduce).length,
    unsureCount: items.filter((i) => i.nameUnsure).length,
    inputTokens: response.usage.input_tokens,
    cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
    outputTokens: response.usage.output_tokens,
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
