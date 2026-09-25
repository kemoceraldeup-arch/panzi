// server/src/routes/panziIntent.ts
//
// What is this message actually asking for, before chat.ts spends a real
// suggest_recipe call (or, worse, a live search call) finding out the hard
// way. One cheap, structured-output OpenAI call, not a keyword list — the
// whole point is catching things a fixed string match would miss both ways:
// "what can I make with gochujang" is food even though "gochujang" is in no
// hardcoded list anywhere in this app, and "write me a React Native login
// screen" is not food even though it contains no word a denylist would catch
// either.
//
// This is the enforcement point requirement #3 asks for: it runs before the
// pantry fetch and before the real model call in chat.ts, and it is the only
// place that decides in/out of scope. The canned refusal text lives in
// chat.ts, not here — this file only classifies.

import OpenAI from 'openai';
import { recordUsage, tokensFrom } from '../usage';

// Cheap and fast on purpose: this call gates every single message, so it has
// to add negligible latency next to the real reply that follows it for an
// in-scope question. The cheapest tier, reasoning turned off, small output,
// no tools — classifying one message into one of a dozen buckets does not
// need deliberation.
const MODEL = 'gpt-5.6-luna';

export type Intent =
  | 'recipe'
  | 'pantry_recipe'
  | 'ingredient_question'
  | 'ingredient_substitution'
  | 'food_storage'
  | 'expiration_question'
  | 'nutrition'
  | 'cooking_technique'
  | 'trending_recipe'
  | 'food_identification'
  | 'out_of_scope';

const INTENTS: Intent[] = [
  'recipe',
  'pantry_recipe',
  'ingredient_question',
  'ingredient_substitution',
  'food_storage',
  'expiration_question',
  'nutrition',
  'cooking_technique',
  'trending_recipe',
  'food_identification',
  'out_of_scope',
];

const CLASSIFY_SCHEMA = {
  type: 'object',
  properties: {
    intent: {
      type: 'string',
      enum: INTENTS,
      description: 'The single best-fitting category for what the user is asking.',
    },
  },
  required: ['intent'],
  additionalProperties: false,
} as const;

const SYSTEM = `You classify one message sent to Panzi, a food/cooking/pantry assistant, into exactly one category. You do not answer the message — only say what kind of request it is.

Panzi's allowed domain is broad and international: recipes and cooking from ANY cuisine in the world (Filipino, other Asian, European, American, Latin American, Middle Eastern, African, and everywhere else), ingredients and ingredient substitutions (including ones from any country — gochujang, miso, harissa, za'atar, tahini, fish sauce, tamarind, ube, doubanjiang, and so on are all clearly in scope), pantry management, food storage and expiration/use-by guidance, nutrition, cooking techniques, food identification, and trending/viral/current food and recipe topics (TikTok food trends, viral recipes, "what's trending right now").

Categories:
- recipe — asking for a dish, what to cook, or a recipe for something named, with no reference to their own pantry.
- pantry_recipe — asking what to cook using ingredients they say they currently have, or referencing "my pantry"/"what I have".
- ingredient_question — asking about an ingredient itself: what it is, whether they have it, how to use it, what it tastes like.
- ingredient_substitution — asking what can replace or stand in for a specific ingredient.
- food_storage — how to store food, keep it fresh, freeze it, what to do with leftovers.
- expiration_question — whether something is still good, how long it lasts, use-by/expiry guidance.
- nutrition — calories, macros, healthiness of a food or dish.
- cooking_technique — how to do a cooking method or technique (searing, braising, proofing dough, knife skills, etc.), not a full recipe.
- trending_recipe — specifically asking about what's currently trending, viral, or popular right now (TikTok, social media, "trending", "viral") — not just any recipe request.
- food_identification — describing a food/dish/ingredient and asking what it is.
- out_of_scope — anything NOT about food, cooking, ingredients, pantry, nutrition, or recipes. This includes requests to write code, general knowledge questions, math, current events unrelated to food, personal advice, or small talk with no food angle. When genuinely unsure whether something has a food angle, prefer the closest food category over out_of_scope — but a request that is plainly about something else (programming, politics, homework unrelated to food, etc.) is always out_of_scope.`;

let client: OpenAI | null = null;

function openai(): OpenAI {
  if (!client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY is not set — copy .env.example to .env');
    client = new OpenAI({ apiKey });
  }
  return client;
}

/**
 * Classifies one user message. Never throws for a classification failure —
 * an ambiguous or unreadable result falls back to treating the message as
 * in-scope (`recipe`) rather than blocking a legitimate food question on a
 * parsing hiccup; the real cost of getting this wrong the other way (letting
 * an out-of-scope request through to a real recipe call) is a wasted model
 * call, not a wrong answer shown to the user, so the fallback errs toward
 * availability. A genuine API failure (network, auth) propagates — chat.ts
 * already has a catch around its own model call and can treat this call's
 * failure the same way.
 */
export async function classifyIntent(
  message: string,
  /** Whose message this was, so the classification's own spend lands under an
   *  account rather than under 'unknown'. Optional because the classifier is a
   *  library function and a caller without a uid is still worth serving. */
  uid?: string
): Promise<{ intent: Intent; inScope: boolean }> {
  const startedAt = Date.now();
  const response = await openai().chat.completions.create({
    model: MODEL,
    max_completion_tokens: 100,
    reasoning_effort: 'none',
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: message },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'intent_classification',
        strict: true,
        schema: CLASSIFY_SCHEMA as unknown as Record<string, unknown>,
      },
    },
  });

  // Small per call and made on every chat turn, which is exactly the shape of
  // spend that goes unnoticed until it is a line on the bill.
  recordUsage({
    userId: uid,
    route: 'intent',
    model: MODEL,
    durationMs: Date.now() - startedAt,
    ...tokensFrom(response.usage),
  });

  const raw = response.choices[0]?.message?.content;
  if (!raw) {
    return { intent: 'recipe', inScope: true };
  }

  let parsed: { intent?: unknown };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { intent: 'recipe', inScope: true };
  }

  const intent = INTENTS.includes(parsed.intent as Intent) ? (parsed.intent as Intent) : 'recipe';
  return { intent, inScope: intent !== 'out_of_scope' };
}
