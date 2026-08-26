// functions/src/index.ts
//
// The scanner's recognition call. The client captures a photo, resizes it and
// sends the bytes here; this function asks Claude what is in the picture and
// returns candidates in the exact shape the review sheet renders.
//
// It lives server-side for one reason: the Anthropic key must never reach the
// device. Everything in an Expo bundle ships to the phone — app.json `extra`,
// `EXPO_PUBLIC_*` variables, the JS bundle itself — so a client-side call
// would publish the key to anyone who unzips the app.
//
// The function writes nothing. It reads the image and returns candidates; the
// user approves them in the review sheet and the client writes the approved
// rows through the existing pantry service. Nothing reaches the pantry without
// a human tick.

import Anthropic from '@anthropic-ai/sdk';
import { defineSecret } from 'firebase-functions/params';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';

// Set with: firebase functions:secrets:set ANTHROPIC_API_KEY
const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');

// Chosen for vision: 2576px on the long edge, against 1568px on older models.
// That headroom is what makes creased receipts and faded expiry stamps legible.
const MODEL = 'claude-opus-5';

// Kept in sync by hand with FOOD_CATEGORIES in src/services/pantry.ts. The
// functions workspace has its own package and can't import from the app, and
// the enum below is what stops the model returning a category the List screen
// has no section for.
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

type ScanMode = 'photo' | 'receipt' | 'date' | 'note';

const MODE_BRIEFS: Record<ScanMode, string> = {
  photo:
    'This is a photo of a shelf, fridge or cupboard. List the distinct food items you can see. Read pack sizes off the labels where they are legible.',
  receipt:
    'This is a shopping receipt. List the food items on it, using the printed quantity and pack size. Ignore non-food lines, discounts, totals and loyalty rows.',
  date: 'This is a close-up of a single product, usually to read its expiry date. Return that one item, with the date you can read.',
  note: 'This is a handwritten or printed note listing food. Transcribe the items on it.',
};

// The response schema. Structured outputs constrain the model to exactly this
// shape, so the client never parses a guess about the format on top of a guess
// about the food.
//
// Optional values are empty strings rather than nulls: the JSON-schema subset
// supported by structured outputs has no nullable primitive, and an empty
// string is unambiguous for every field here.
const RESULT_SCHEMA = {
  type: 'object',
  properties: {
    readable: {
      type: 'boolean',
      description: 'False when the image cannot be read at all — too dark, too blurry, too far, or simply not food.',
    },
    failureCause: {
      type: 'string',
      enum: ['dark', 'blurry', 'far', 'unrecognised', 'none'],
      description: 'Why the image could not be read. "none" when readable is true.',
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
              'What the item is, as a shopper would say it — "Cheddar", "Fresh milk". Brand names only when they are the common name for the thing.',
          },
          quantityValue: {
            type: 'number',
            description: 'The amount. Use 1 when there is no printed size and only one of the item.',
          },
          quantityUnit: {
            type: 'string',
            description:
              'The unit: g, kg, ml, L, pack, tin, block, bunch. Empty string for countable things ("Eggs" 6, not "6 each").',
          },
          category: { type: 'string', enum: FOOD_CATEGORIES },
          location: {
            type: 'string',
            description:
              'Where it is stored, if the picture shows it — "Fridge", "Crisper", "Fridge door". Empty string when you cannot tell.',
          },
          expiryDate: {
            type: 'string',
            description: 'The printed expiry or best-before date as YYYY-MM-DD. Empty string when no date is legible.',
          },
          confidence: {
            type: 'number',
            description:
              'How sure you are about this reading, 0 to 1. Be honest — a low score sends the row to the user unticked, which is the right outcome for a guess.',
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
          'quantityValue',
          'quantityUnit',
          'category',
          'location',
          'expiryDate',
          'confidence',
          'box',
        ],
        additionalProperties: false,
      },
    },
  },
  required: ['readable', 'failureCause', 'items'],
  additionalProperties: false,
} as const;

const SYSTEM = `You read photographs of food for a pantry-tracking app called Panzi.

The user sees everything you return and ticks the rows they want kept, so your job is an honest reading, not a confident one. Say what you can actually see. If a label is half-turned and you can only tell it is a yoghurt, return "Yoghurt" at a low confidence rather than inventing a brand and a pack size. Confidence below 0.7 arrives unticked in the app, which is the correct place for anything you are unsure of — use it.

List each distinct product once. Six eggs in a box is one item with a quantity of 6, not six items. Do not list crockery, packaging, appliances, hands, or anything you cannot eat.

Only report an expiry date you can actually read in the image. Never estimate one from the type of food — a wrong date is worse than no date, because the app will nag the user about it.

If the image cannot be read, set readable to false and pick the cause that best explains it: dark, blurry, far, or unrecognised.`;

type Candidate = {
  name: string;
  quantityValue: number;
  quantityUnit: string;
  category: string;
  location: string;
  expiryDate: string;
  confidence: number;
  box: { x: number; y: number; width: number; height: number };
};

type Result = {
  readable: boolean;
  failureCause: 'dark' | 'blurry' | 'far' | 'unrecognised' | 'none';
  items: Candidate[];
};

const ALLOWED_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
type MediaType = (typeof ALLOWED_MEDIA_TYPES)[number];

// Base64 inflates by ~4/3, so this caps the decoded image near 5MB — well
// inside both the callable-request limit and the model's own image limit.
const MAX_BASE64_LENGTH = 7_000_000;

export const scanShelf = onCall(
  {
    secrets: [ANTHROPIC_API_KEY],
    // A dense shelf photo at high effort can take the better part of a minute.
    timeoutSeconds: 120,
    memory: '512MiB',
    // One image in flight per instance; the base64 payload is the memory cost.
    concurrency: 1,
  },
  async (request): Promise<Result> => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Sign in before scanning.');
    }

    const { imageBase64, mediaType, mode } = (request.data ?? {}) as {
      imageBase64?: string;
      mediaType?: string;
      mode?: string;
    };

    if (typeof imageBase64 !== 'string' || !imageBase64) {
      throw new HttpsError('invalid-argument', 'No image was sent.');
    }
    if (imageBase64.length > MAX_BASE64_LENGTH) {
      throw new HttpsError('invalid-argument', 'That photo is too large — resize it before sending.');
    }
    if (!ALLOWED_MEDIA_TYPES.includes(mediaType as MediaType)) {
      throw new HttpsError('invalid-argument', `Unsupported image type: ${mediaType}`);
    }
    const brief = MODE_BRIEFS[mode as ScanMode] ?? MODE_BRIEFS.photo;

    const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() });

    let response;
    try {
      response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 8000,
        system: SYSTEM,
        // Medium rather than high: reading a label is perception, not
        // deliberation, and the extra thinking mostly buys latency the user is
        // staring at a progress bar for.
        output_config: {
          effort: 'medium',
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
      logger.error('Anthropic call failed', { uid: request.auth.uid, message: err?.message });
      // The user gets a retryable message; the detail stays in the logs rather
      // than being surfaced as a stack trace on a camera screen.
      throw new HttpsError('unavailable', 'Could not read that photo — try again in a moment.');
    }

    if (response.stop_reason === 'refusal') {
      logger.warn('Model declined the image', {
        uid: request.auth.uid,
        category: response.stop_details?.category ?? null,
      });
      return { readable: false, failureCause: 'unrecognised', items: [] };
    }

    const text = response.content.find((block) => block.type === 'text');
    if (!text || text.type !== 'text') {
      logger.error('No text block in response', { uid: request.auth.uid, stopReason: response.stop_reason });
      throw new HttpsError('internal', 'Could not read that photo — try again.');
    }

    let parsed: Result;
    try {
      parsed = JSON.parse(text.text) as Result;
    } catch {
      logger.error('Response was not valid JSON', { uid: request.auth.uid });
      throw new HttpsError('internal', 'Could not read that photo — try again.');
    }

    // The schema guarantees the shape; this guards the values inside it. A
    // negative quantity or a confidence of 4 would render as nonsense in the
    // review sheet, and the enum can't police numbers.
    const items = (Array.isArray(parsed.items) ? parsed.items : [])
      .filter((item) => item && typeof item.name === 'string' && item.name.trim().length > 0)
      .map((item) => ({
        ...item,
        name: item.name.trim(),
        quantityValue: Number.isFinite(item.quantityValue) ? Math.max(1, Math.round(item.quantityValue)) : 1,
        confidence: Number.isFinite(item.confidence) ? Math.min(1, Math.max(0, item.confidence)) : 0.5,
      }));

    logger.info('Scan complete', {
      uid: request.auth.uid,
      mode,
      readable: parsed.readable,
      itemCount: items.length,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    });

    // A read that finds nothing is a failed read, whatever the model called it —
    // the error screen is the honest destination, not an empty review sheet.
    if (!parsed.readable || items.length === 0) {
      const cause = parsed.failureCause && parsed.failureCause !== 'none' ? parsed.failureCause : 'unrecognised';
      return { readable: false, failureCause: cause, items: [] };
    }

    return { readable: true, failureCause: 'none', items };
  }
);
