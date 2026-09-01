// server/src/routes/estimateShelfLife.ts
//
// A shelf-life estimate for an item the user typed in by hand — no photo, no
// printed date, nothing to look at. routes/scan.ts already estimates shelf
// life from *appearance*; this route asks the same kind of question from
// nothing but a name, a category, and whether the item has been opened,
// which is the one input a hand-typed item can actually offer that a photo
// couldn't already answer better.
//
// Deliberately its own route rather than a mode on /api/scan: that route's
// schema and prompt are built entirely around reading a photograph — box
// coordinates, ripeness-by-sight, nameUnsure/nameAlternatives, a scene label
// — none of which means anything here. Forking that prompt would carry all
// of it along for no reason; this one is about a fifth the length and reuses
// only the one paragraph of reasoning that actually transfers ("a sealed jar
// of peanut butter has a well-known shelf life whether or not you can see
// it").

import { Request, Response, Router } from 'express';
import { anthropic, MAX_SHELF_LIFE_DAYS } from './scan';

export const estimateShelfLifeRouter = Router();

const MODEL = 'claude-opus-5';

const ESTIMATE_SCHEMA = {
  type: 'object',
  properties: {
    knownFood: {
      type: 'boolean',
      description:
        'False only when you genuinely cannot place this name into any food category with a known typical shelf life at all.',
    },
    shelfLifeDays: {
      type: 'number',
      description:
        'Typical days this food keeps from today, given its opened/unopened state — general knowledge of how that kind of food keeps, the same reasoning you would use looking at the food itself: an unopened jar of peanut butter, a bag of rice, a tin of chickpeas, an opened bottle of milk, an opened jar of jam — every one of these has a well-known typical shelf life. 0 only when knownFood is false.',
    },
  },
  required: ['knownFood', 'shelfLifeDays'],
  additionalProperties: false,
} as const;

const SYSTEM = `You estimate how long a food item keeps, for a pantry-tracking app called Panzi.

The user typed in an item by hand — there is no photo, no printed date, nothing to look at. You are given only the food's name, its category, and whether the user has opened it. Your answer is always clearly shown to the user as an estimate, never as a fact, so an honest general-knowledge guess is exactly what is wanted here — the same reasoning you would use for a sealed tin of chickpeas, a bag of rice, or a jar of peanut butter even with no visible date and no visible spoilage: every common food has a well-known typical shelf life, opened or not, and you already know it.

Unopened almost always keeps far longer than opened — a sealed jar of jam keeps for a year or more, opened it wants using within a month; unopened milk keeps to its own date, opened it is days. Use the opened/unopened state as the dominant factor in your estimate, not a minor adjustment.

Reach for knownFood false only when the name genuinely cannot be placed into any food category with a known typical shelf life at all — not merely because it is a specific or unfamiliar brand name. A rough estimate the user can correct in one tap is far more useful than an empty field.`;

type EstimateResult = {
  knownFood?: unknown;
  shelfLifeDays?: unknown;
};

estimateShelfLifeRouter.post('/', async (req: Request, res: Response): Promise<void> => {
  const uid = req.uid;
  const body = (req.body ?? {}) as {
    name?: unknown;
    category?: unknown;
    openedState?: unknown;
  };

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) {
    res.status(400).json({ error: 'invalid-argument', message: 'A food name is required.' });
    return;
  }

  const openedState = body.openedState;
  if (openedState !== 'opened' && openedState !== 'unopened') {
    res.status(400).json({
      error: 'invalid-argument',
      message: 'openedState must be "opened" or "unopened".',
    });
    return;
  }

  const category = typeof body.category === 'string' ? body.category.trim() : '';

  let response;
  try {
    response = await anthropic().messages.create({
      model: MODEL,
      max_tokens: 200,
      system: [{ type: 'text', text: SYSTEM }],
      output_config: {
        effort: 'low',
        format: { type: 'json_schema', schema: ESTIMATE_SCHEMA as unknown as Record<string, unknown> },
      },
      messages: [
        {
          role: 'user',
          content: `Food: ${name}\nCategory: ${category || 'unknown'}\nState: ${openedState}`,
        },
      ],
    });
  } catch (err: any) {
    console.error('Shelf-life estimate call failed', { uid, message: err?.message });
    const status = err?.status === 429 ? 429 : 503;
    res.status(status).json({
      error: status === 429 ? 'resource-exhausted' : 'unavailable',
      message: 'Could not estimate that right now — try again in a moment.',
    });
    return;
  }

  if (response.stop_reason === 'refusal') {
    res.json({ ok: false, message: "Couldn't estimate that one — try typing a date instead." });
    return;
  }

  const block = response.content.find((entry) => entry.type === 'text');
  if (!block || block.type !== 'text') {
    console.error('No text block in shelf-life estimate response', { uid });
    res.status(502).json({ error: 'internal', message: 'Could not read that answer — try again.' });
    return;
  }

  let parsed: EstimateResult;
  try {
    parsed = JSON.parse(block.text);
  } catch {
    console.error('Shelf-life estimate response was not valid JSON', { uid });
    res.status(502).json({ error: 'internal', message: 'Could not read that answer — try again.' });
    return;
  }

  const knownFood = parsed.knownFood === true;
  const shelfLifeDays =
    knownFood && Number.isFinite(parsed.shelfLifeDays)
      ? Math.min(MAX_SHELF_LIFE_DAYS, Math.max(0, Math.round(parsed.shelfLifeDays as number)))
      : 0;

  if (!knownFood || shelfLifeDays === 0) {
    res.json({ ok: false, message: "Couldn't estimate that one — try typing a date instead." });
    return;
  }

  console.info('Shelf-life estimate complete', { uid, name, category, openedState, shelfLifeDays });

  res.json({ ok: true, shelfLifeDays });
});
