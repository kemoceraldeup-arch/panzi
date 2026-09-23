// server/src/routes/chat.ts
//
// Ask Panzi what to cook — separate conversations, each with its own history,
// the same shape as any chat app's sidebar.
//
// /api/chat/conversations lists and creates conversations. Everything under
// /api/chat/conversations/:id operates on one of them: GET the messages, POST
// a new turn, DELETE the whole thing. A conversation's title is set once, from
// its first message, and never rewritten — see the note on chat_conversations
// in models.ts.
//
// The pantry is refetched from Mongo on every call rather than trusted from the
// client, unlike routes/recipes.ts which takes the client's copy. A recipe
// suggestion is disposable and wrong for a few seconds is a shrug; a chat
// conversation lives for the length of a session and a stale pantry a user
// corrected five minutes ago answering "do I have eggs?" wrong is a worse
// failure than the extra query costs.
//
// A reply is either words or a recipe, never a blend — the client renders one
// or the other. The model picks by calling suggest_recipe when the question
// wants a dish; anything else comes back as the model's own text. The schema is
// the same one routes/recipes.ts already validates candidates against, reused
// rather than duplicated, but the rule about what a card is *allowed to
// suggest* is deliberately looser here: recipes.ts drops the "lean on the
// pantry" instruction only when nothing fits at all, because a browsing screen
// should mostly show what's already on hand. A chat is a direct question — "what
// can I cook with X and Y" names the ingredients to build around, on purpose,
// and a user who asked that expects a real answer even when the pantry doesn't
// otherwise carry the rest of the dish. needsShopping and the ingredient
// have/missing split are how the card stays honest about the gap either way.

import { randomUUID } from 'crypto';
import OpenAI from 'openai';
import { Router } from 'express';
import { ChatConversation, ChatMessage, PantryItem, User } from '../models';
import { badRequest, isValidId, withDb } from './helpers';
import { Recipe as PantryRecipe } from './recipes';
import { classifyIntent, Intent } from './panziIntent';
import { searchTrendingRecipes } from './recipeSearch';

// Not the cheapest tier (routes/recipes.ts's gpt-5.6-luna): this route calls
// suggest_recipe as a tool, and the cheapest tier — like the flagship model —
// only supports function/tool calling by dropping to the Responses API, which
// this route doesn't use. gpt-5.6-terra is the cheapest tier that still does
// tool calling on the Chat Completions API. Reasoning is turned off below —
// answering a question about a known pantry is not deep reasoning, and this is
// a screen the user is actively typing on, waiting for a reply.
const MODEL = 'gpt-5.6-terra';

const MAX_MESSAGE_LENGTH = 2000;
const MAX_ITEMS = 60;
const HISTORY_PAGE = 100;
// How many prior turns ride along as conversation context. Bounded so a long
// -running chat doesn't grow the input tokens of every reply without limit —
// the model only needs enough of the back-and-forth to not repeat itself or
// lose the thread, not the whole history.
const CONTEXT_TURNS = 20;
// A title is a label for a list row, not a summary — long enough to recognise
// the conversation, short enough that a phone-width row shows the whole thing
// on one line without needing the ellipsis at all for a typical short
// question. 24 rather than something closer to the row's true character
// capacity on purpose: the row also carries a timestamp, and a title padded
// out to fill all the remaining space reads as cut off far more often than
// one that stops early on its own.
const TITLE_MAX_LENGTH = 24;

// What kind of dish this is, for the card's fallback gradient/glyph when
// there's no photo. Kept in step with src/theme/dishLooks.ts on the client —
// shape-of-the-dish categories, not cuisine names, so they read naturally
// across any cuisine rather than needing a new entry every time chat answers
// with food from a country routes/recipes.ts never had to cover.
const CHAT_DISH_LOOKS = [
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
  'pasta',
  'curry',
  'salad',
  'sandwich',
  'other',
] as const;
type ChatDishLook = (typeof CHAT_DISH_LOOKS)[number];

// Which named dish this is, for the client's photo lookup — a superset of
// routes/recipes.ts's Filipino-only DISH_KEYS plus a handful of common
// international dishes chat is now allowed to suggest. Deliberately not
// merged into recipes.ts's own list: that route and its DISH_KEYS stay
// Filipino-only by design, so this app's two suggestion engines can each
// serve a different brief without colliding. Any key added here that
// src/theme/dishPhotos.ts's DISH_KEYS doesn't recognise yet safely falls
// back to the gradient tile client-side (dishKeyFor already no-ops unknown
// values to 'other') — art can catch up later without this ever crashing.
const CHAT_DISH_KEYS = [
  'adobo', 'sinigang', 'tinola', 'nilaga', 'bulalo', 'kare_kare', 'menudo', 'afritada',
  'kaldereta', 'pochero', 'sisig', 'lechon_kawali', 'crispy_pata', 'pork_bbq', 'longganisa',
  'tocino', 'tapa', 'bistek', 'fried_chicken', 'chicken_curry', 'ginataang_manok', 'paksiw',
  'inihaw_na_isda', 'daing', 'fried_fish', 'pinakbet', 'chopsuey', 'laing', 'ginisang_munggo',
  'ginisang_gulay', 'tortang_talong', 'pancit_canton', 'pancit_bihon', 'lomi', 'spaghetti',
  'carbonara', 'sinangag', 'silog', 'arroz_caldo', 'lugaw', 'goto', 'champorado',
  'lumpiang_shanghai', 'empanada', 'siomai', 'turon', 'banana_cue', 'bibingka', 'puto',
  'pandesal', 'leche_flan', 'halo_halo',
  // International additions.
  'ramen', 'sushi', 'bibimbap', 'kimchi_jjigae', 'pad_thai', 'fried_rice', 'dumplings',
  'biryani', 'butter_chicken', 'tikka_masala', 'shawarma', 'falafel', 'hummus_plate',
  'tagine', 'jollof_rice', 'tacos', 'burrito', 'enchiladas', 'ceviche', 'empanadas_latin',
  'risotto', 'lasagna', 'pizza', 'paella', 'roast_chicken', 'burger', 'mac_and_cheese',
  'pancakes', 'waffles', 'pho', 'bulgogi',
  'other',
] as const;
type ChatDishKey = (typeof CHAT_DISH_KEYS)[number];

/** The Recipe shape chat replies with — same fields as routes/recipes.ts's
 *  Recipe, but with the wider look/dishKey enums above so an international
 *  suggestion isn't quietly coerced to 'other' by the Filipino-only
 *  validator there. */
type ChatRecipe = Omit<PantryRecipe, 'look' | 'dishKey' | 'ingredients'> & {
  look: ChatDishLook;
  dishKey: ChatDishKey;
  ingredients: (PantryRecipe['ingredients'][number] & {
    /** True when this ingredient is a nice-to-have for the dish, not a
     *  required one — set only in PANTRY ONLY mode, where the reply also
     *  separates AVAILABLE / MISSING / OPTIONAL rather than just have/missing.
     *  False (or absent) for an ordinary reply. */
    optional?: boolean;
  })[];
};

const CHAT_RECIPE_SCHEMA = {
  type: 'object',
  properties: {
    title: {
      type: 'string',
      description: 'What the dish is, as someone would say it to a housemate. Five words at most.',
    },
    look: {
      type: 'string',
      enum: CHAT_DISH_LOOKS,
      description:
        'What kind of dish this is, for the picture on the card. Choose by what it IS at the table — how it is plated and eaten — never by its main ingredient alone. "curry" for any curry regardless of cuisine, "pasta" for any pasta dish, "soup"/"stew" for anything wet and spooned, "grilled"/"fried" by cooking method when that is the dish\'s defining trait, "rice"/"noodles" when that is the actual subject, "salad" for a dish that is unambiguously a salad, "sandwich" for anything eaten between bread by hand. "other" only when genuinely nothing fits.',
    },
    dishKey: {
      type: 'string',
      enum: CHAT_DISH_KEYS,
      description:
        'Which named dish this is, so the app can show a photo of it. Choose a key ONLY when the dish genuinely is that thing. A wrong key shows a photo of food that is not being cooked, which is worse than no photo, so "other" is the safe and expected answer whenever the dish is not one of these exact named dishes.',
    },
    minutes: { type: 'number', description: 'Realistic total time from starting to eating, in minutes.' },
    servings: {
      type: 'number',
      description:
        'How many people this recipe as written feeds. Must agree with the ingredient amounts written — the app divides every amount by this to show one portion.',
    },
    description: {
      type: 'string',
      description:
        'One short sentence describing the dish itself, for someone who has never heard of it, including where it is from if that is useful context. Never repeat the title verbatim.',
    },
    why: {
      type: 'string',
      description: 'One short sentence naming why this is being suggested, addressed to the user.',
    },
    needsShopping: {
      type: 'boolean',
      description: 'True only when a real trip to the shop is needed for more than a staple or two.',
    },
    usesExpiring: {
      type: 'array',
      description: 'Exact pantry item names this recipe uses up that are close to going off.',
      items: { type: 'string' },
    },
    pantryUsed: {
      type: 'array',
      description: 'Every pantry item this recipe uses, named exactly as given.',
      items: { type: 'string' },
    },
    ingredients: {
      type: 'array',
      description: 'Everything needed, including things the user does not have.',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'The ingredient, short.' },
          amount: { type: 'string', description: 'How much, as a cook would write it, with a unit — "2 tbsp", "200 g".' },
          have: {
            type: 'boolean',
            description: 'True only when genuinely in the pantry list given. Guessing true is worse than guessing false.',
          },
          assumedStaple: {
            type: 'boolean',
            description:
              'True when this is a basic kitchen staple (salt, oil, water, sugar, garlic, onion, etc.) this suggestion assumes is in the house, and have is false only because it was never listed — not because a real trip is needed for it.',
          },
          optional: {
            type: 'boolean',
            description:
              'True when this ingredient is a nice-to-have that improves the dish but is not required to make it — a garnish, an optional topping, a flavor variant. Only meaningfully used in PANTRY ONLY mode, where the reply should mark true optional extras this way rather than counting them as missing. False for anything the dish actually needs.',
          },
        },
        required: ['name', 'amount', 'have', 'assumedStaple', 'optional'],
        additionalProperties: false,
      },
    },
    steps: {
      type: 'array',
      description: 'Four to eight steps, one action each, in order. Plain sentences, no numbering.',
      items: { type: 'string' },
    },
  },
  required: [
    'title', 'look', 'dishKey', 'minutes', 'servings', 'description', 'why',
    'needsShopping', 'usesExpiring', 'pantryUsed', 'ingredients', 'steps',
  ],
  additionalProperties: false,
} as const;

const SUGGEST_RECIPE_TOOL: OpenAI.Chat.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'suggest_recipe',
    description:
      'Call this when the user is asking what to cook, for a recipe, for a dish\'s ingredients or how to make it, or "what can I make with X" — anything where the right answer is a single dish rather than a sentence. This includes a named dish plus a bare word like "ingredients", "recipe", or "how to make" ("chocolate palitaw ingredients", "adobo recipe") — treat these the same as a full recipe request, not as a request for a plain ingredient list. Do not call it for questions that are just about the pantry itself, like whether an item is present or how long it has left. Do NOT call it when the user asked for more than one dish (e.g. "give me 5 dishes", "a few recipe ideas") — this tool produces exactly one recipe card, which cannot represent a list. Answer a multi-dish request in plain text instead, one line per dish.',
    parameters: CHAT_RECIPE_SCHEMA as unknown as Record<string, unknown>,
    strict: true,
  },
};

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

/** Cleans a raw suggest_recipe tool call against CHAT_RECIPE_SCHEMA's wider
 *  enums — a chat-local twin of routes/recipes.ts's cleanRecipe, which
 *  cannot be reused directly because it validates look/dishKey against the
 *  Filipino-only lists and would silently coerce a valid international key
 *  to 'other'. */
function cleanChatRecipe(raw: unknown): ChatRecipe | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;

  const title = text(value.title, 60);
  if (!title) return null;

  const ingredients = (Array.isArray(value.ingredients) ? value.ingredients : [])
    .map((entry) => {
      const e = entry as Record<string, unknown>;
      return {
        name: text(e?.name, 60),
        amount: text(e?.amount, 40),
        have: e?.have === true,
        assumedStaple: e?.assumedStaple === true,
        optional: e?.optional === true,
      };
    })
    .filter((entry) => entry.name.length > 0)
    .slice(0, 25);

  const steps = stringList(value.steps, 12);
  if (ingredients.length === 0 || steps.length === 0) return null;

  const minutes = Number.isFinite(value.minutes) ? Math.round(value.minutes as number) : 0;
  const servings = Number.isFinite(value.servings) ? Math.round(value.servings as number) : 0;

  return {
    title,
    look: CHAT_DISH_LOOKS.includes(value.look as ChatDishLook) ? (value.look as ChatDishLook) : 'other',
    dishKey: CHAT_DISH_KEYS.includes(value.dishKey as ChatDishKey) ? (value.dishKey as ChatDishKey) : 'other',
    minutes: minutes >= 2 && minutes <= 480 ? minutes : 0,
    servings: servings >= 1 && servings <= 12 ? servings : 0,
    description: text(value.description, 200),
    why: text(value.why, 160),
    needsShopping: value.needsShopping === true,
    usesExpiring: stringList(value.usesExpiring, 8),
    pantryUsed: stringList(value.pantryUsed, 20),
    ingredients,
    steps,
  };
}

// International on purpose — unlike routes/recipes.ts's suggestion engine,
// which stays Filipino-only by design, chat is Panzi's conversational face
// and is expected to answer about food and ingredients from anywhere: this
// is what "what can I cook with chicken and gochujang" or "what's a good
// substitute for mirin" need to work correctly rather than being awkwardly
// redirected toward Filipino cooking regardless of what was asked.
const SYSTEM = `You are Panzi, the cooking, ingredient and pantry assistant inside a pantry-tracking app. You are having a conversation, not generating a one-off suggestion — answer the actual question asked, the way a knowledgeable friend would over text.

Your scope is food, ingredients, cooking, recipes and pantry management from ANY cuisine or country in the world — Filipino, other Asian, European, American, Latin American, Middle Eastern, African, and everywhere else, equally. You are not limited to Filipino ingredients or dishes: understand and use ingredients like gochujang, gochugaru, miso, mirin, dashi, nori, tahini, harissa, za'atar, garam masala, sambal, doubanjiang, guanciale, pancetta, masa harina, tomatillo, fish sauce, bagoong, calamansi, ube and tamarind exactly as readily as any other ingredient — never restrict suggestions to one country's cuisine unless the user asks for that cuisine specifically. Use the names a cook from that cuisine would actually use, not an over-translated version.

You are given the user's current pantry, with what is known about how long each item has left. Use it: "do I have eggs?" gets a plain yes/no from the list, not a guess. A date marked "estimated" is the app's own guess and should be treated as approximate. Never tell someone to eat something already past its date. Never invent what is in the pantry; if it is not in the list, say they don't have it.

When the user asks what to cook, for a recipe, for a dish's ingredients, or how to make it, or "what can I make with X and Y", and that request names or clearly wants exactly ONE dish, call suggest_recipe instead of answering in words — the app renders that as a proper recipe card. A named dish plus a bare "ingredients", "recipe", or "how to make" ("chocolate palitaw ingredients", "adobo recipe") is a recipe request, not a request for a plain list — always reach for the card in that case, never a plain-text ingredient list. Build it around whatever ingredients or cuisine they actually named, whether or not those ingredients are in the pantry: naming an ingredient or cuisine in the question is the user telling you what to cook, not asking whether they own it. Fill "have" on each ingredient from the real pantry list, and set needsShopping true only when a real trip is needed for more than a staple or two — the card shows exactly what's missing, so it doesn't need to pretend everything is on hand. If nothing was named and the pantry can't carry a decent dish either, it's fine to ask what they're in the mood for instead of guessing.

When the user asks for MORE THAN ONE dish — "give me 5 dishes", "suggest a few recipes", "what are some things I could cook this week" — never call suggest_recipe. There is only one card and it cannot hold a list. Instead answer in plain text: a short numbered or bulleted list naming each dish with a one-line description of what it is, no full ingredient lists or steps for any of them. If the user then asks about one specific dish from that list by name, treat that follow-up as a single-dish request and call suggest_recipe for just that one.

When the user has asked for PANTRY ONLY mode (told to you explicitly below), lean on what they actually have: build the dish primarily from pantry ingredients, mark any ingredient that is a genuine nice-to-have (not required to make the dish work) with optional true rather than counting it as missing, and let "why" or your plain-text reply make the available/missing/optional split clear to a user reading it.

For everything else — ingredient questions, substitutions, storage, expiration, nutrition, technique, pantry questions, follow-ups, small talk about food — just answer in a few sentences of plain text. You are texting, not writing an article.

You only help with food, cooking, ingredients, pantry management and recipes. If the user asks about something with no food connection at all, say plainly that you're a food and pantry assistant and steer them back to something you can help with — do not attempt to answer it.

Dietary requirements and allergies, given below, are absolute — never suggest a dish or ingredient that violates either.`;

const OUT_OF_SCOPE_REPLY =
  "I'm Panzi, your food and pantry assistant 🍳. I can help with ingredients, recipes, cooking, food storage, pantry management, and meal ideas. Ask me something food-related!";

const TRENDING_UNAVAILABLE_PREFIX =
  "Live trend info isn't available right now, so I can't pull up what's actually trending — but here's a solid recipe suggestion instead:\n\n";

let client: OpenAI | null = null;

function openai(): OpenAI {
  if (!client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY is not set — copy .env.example to .env');
    client = new OpenAI({ apiKey });
  }
  return client;
}

function toMessageRow(doc: any) {
  return {
    id: doc._id,
    role: doc.role as 'user' | 'assistant',
    content: doc.content as string,
    recipe: (doc.recipe as ChatRecipe | null) ?? null,
    createdAt: doc.createdAt ? new Date(doc.createdAt).getTime() : Date.now(),
  };
}

function toConversationRow(doc: any) {
  return {
    id: doc._id,
    title: doc.title as string,
    updatedAt: doc.updatedAt ? new Date(doc.updatedAt).getTime() : Date.now(),
  };
}

/** The first line of the first message, trimmed to a label. Bare-bones on
 *  purpose — an extra model call just to name the conversation would double
 *  the latency and the cost of every "New chat" for a cosmetic label most
 *  chat apps' own history lists get from the same trick.
 *
 * Cut on the last whole word that fits rather than mid-word — "give me a
 * recipe for ad…" reads as broken in a way "give me a recipe…" doesn't, even
 * though the second one throws away more characters. Only falls through to a
 * hard cut when the very first word alone is already longer than the limit,
 * which a short chat question essentially never is. */
function titleFrom(message: string): string {
  const line = message.split('\n')[0].trim();
  if (line.length <= TITLE_MAX_LENGTH) return line || 'New chat';

  const truncated = line.slice(0, TITLE_MAX_LENGTH);
  const lastSpace = truncated.lastIndexOf(' ');
  const cut = lastSpace > 0 ? truncated.slice(0, lastSpace) : truncated;
  return `${cut.trimEnd()}…`;
}

/** Same shape routes/recipes.ts sends the model — name plus whatever provenance
 *  is known — trimmed to fields that matter and nothing the client wrote. */
function pantryBrief(items: any[]): string {
  if (items.length === 0) return 'Their pantry is currently empty.';

  const lines = items.slice(0, MAX_ITEMS).map((item) => {
    const bits = [item.name as string];
    if (item.quantity) bits.push(`(${item.quantity})`);
    if (item.expiryDate) {
      const days = Math.floor(
        (new Date(item.expiryDate).getTime() - Date.now()) / (24 * 60 * 60 * 1000)
      );
      bits.push(`— ${days >= 0 ? `${days}d left` : 'past date'}${item.dateSource === 'estimated' ? ', estimated' : ''}`);
    }
    if (item.ripeness) bits.push(`(${item.ripeness})`);
    return `- ${bits.join(' ')}`;
  });

  return `Here is everything in the pantry right now:\n${lines.join('\n')}`;
}

export const chatRouter = Router();

chatRouter.get(
  '/conversations',
  withDb(async (req, res) => {
    const rows = await ChatConversation.find({ userId: req.uid })
      .sort({ updatedAt: -1 })
      .limit(HISTORY_PAGE)
      .lean();
    res.json({ conversations: rows.map(toConversationRow) });
  })
);

chatRouter.post(
  '/conversations',
  withDb(async (req, res) => {
    const doc = await ChatConversation.create({
      _id: randomUUID(),
      userId: req.uid,
      title: 'New chat',
    });
    res.json({ conversation: toConversationRow(doc) });
  })
);

// A POST rather than an HTTP DELETE, matching every other mutation in this
// app (see pantry.ts's /delete) — apiFetch on the client only ever sends GET
// or POST, so every route follows the same shape rather than one path needing
// its own request plumbing.
chatRouter.post(
  '/conversations/:id/delete',
  withDb(async (req, res) => {
    const { id } = req.params;
    if (!isValidId(id)) return badRequest(res, 'No conversation id was sent.');

    // Both scoped to req.uid, same rule as every other route: an id that
    // happens to belong to someone else's conversation matches nothing rather
    // than deleting it.
    await Promise.all([
      ChatConversation.deleteOne({ _id: id, userId: req.uid }),
      ChatMessage.deleteMany({ conversationId: id, userId: req.uid }),
    ]);
    res.json({ ok: true });
  })
);

chatRouter.get(
  '/conversations/:id/messages',
  withDb(async (req, res) => {
    const { id } = req.params;
    if (!isValidId(id)) return badRequest(res, 'No conversation id was sent.');

    const rows = await ChatMessage.find({ conversationId: id, userId: req.uid })
      .sort({ createdAt: -1 })
      .limit(HISTORY_PAGE)
      .lean();
    res.json({ messages: rows.reverse().map(toMessageRow) });
  })
);

chatRouter.post(
  '/conversations/:id/messages',
  withDb(async (req, res) => {
    const { id } = req.params;
    const { message, pantryOnly } = (req.body ?? {}) as { message?: string; pantryOnly?: boolean };
    const uid = req.uid as string;

    if (!isValidId(id)) return badRequest(res, 'No conversation id was sent.');
    const text = typeof message === 'string' ? message.trim().slice(0, MAX_MESSAGE_LENGTH) : '';
    if (!text) return badRequest(res, 'The message was empty.');

    const conversation = await ChatConversation.findOne({ _id: id, userId: uid }).lean();
    if (!conversation) return badRequest(res, 'That conversation no longer exists.');

    // The gate requirement #3 asks for: classify before doing anything
    // expensive. An out-of-scope message never reaches the pantry fetch, the
    // trending search, or the real suggest_recipe call below — it's answered
    // and persisted right here, at a fraction of the cost and latency of the
    // real path.
    let intent: Intent;
    try {
      ({ intent } = await classifyIntent(text));
    } catch (err: any) {
      console.error('Intent classification failed', { uid, message: err?.message });
      intent = 'recipe'; // Same fail-open reasoning as classifyIntent's own fallback.
    }

    if (intent === 'out_of_scope') {
      const userDoc = await ChatMessage.create({
        _id: randomUUID(),
        userId: uid,
        conversationId: id,
        role: 'user',
        content: text,
      });
      const isFirstMessage =
        (await ChatMessage.countDocuments({ conversationId: id, userId: uid })) === 1;
      const [assistantDoc] = await Promise.all([
        ChatMessage.create({
          _id: randomUUID(),
          userId: uid,
          conversationId: id,
          role: 'assistant',
          content: OUT_OF_SCOPE_REPLY,
          recipe: null,
        }),
        ChatConversation.updateOne(
          { _id: id, userId: uid },
          { $set: { updatedAt: new Date(), ...(isFirstMessage ? { title: titleFrom(text) } : {}) } }
        ),
      ]);
      console.info('Chat reply out of scope', { uid, conversationId: id });
      res.json({ user: toMessageRow(userDoc), assistant: toMessageRow(assistantDoc) });
      return;
    }

    const [items, user, priorRaw] = await Promise.all([
      PantryItem.find({ userId: uid }).lean(),
      User.findById(uid).lean(),
      ChatMessage.find({ conversationId: id, userId: uid })
        .sort({ createdAt: -1 })
        .limit(CONTEXT_TURNS)
        .lean(),
    ]);
    const prior = priorRaw.reverse();

    const dietary = Array.isArray((user as any)?.dietaryPreferences)
      ? (user as any).dietaryPreferences
      : [];
    const allergies =
      typeof (user as any)?.allergies === 'string' && (user as any).allergies.trim()
        ? (user as any).allergies.split(',').map((a: string) => a.trim()).filter(Boolean)
        : [];

    // Live search only for the one intent that genuinely needs it — every
    // ordinary recipe question still answers from the model alone. Never
    // fabricated: searchTrendingRecipes itself refuses to invent anything, so
    // `trendingUnavailable` is the one signal this route needs to fall back
    // to an honest "can't check live trends" reply further down.
    let trendingBrief = '';
    let trendingUnavailable = false;
    if (intent === 'trending_recipe') {
      const outcome = await searchTrendingRecipes(text);
      if ('unavailable' in outcome) {
        trendingUnavailable = true;
      } else {
        trendingBrief = [
          '',
          'Here is what is currently trending, from a live web search just now — summarise or build a recipe from this real, current information rather than guessing from what you already knew:',
          ...outcome.results.map((r) => `- ${r.title}: ${r.snippet} (${r.url})`),
        ].join('\n');
      }
    }

    const brief = [
      pantryBrief(items),
      '',
      dietary.length ? `THEIR DIET: ${dietary.join(', ')}` : 'No dietary requirements.',
      allergies.length
        ? `ALLERGIES (must never appear in a suggestion): ${allergies.join(', ')}`
        : 'No known allergies.',
      ...(pantryOnly === true
        ? [
            '',
            'PANTRY ONLY MODE: the user wants this built primarily from what is already in their pantry. Mark genuine nice-to-have extras as optional rather than missing, and make the available / missing / optional split clear.',
          ]
        : []),
      trendingBrief,
    ].join('\n');

    // A prior recipe turn has no `content` to replay — it was a tool call, not
    // words — so it is summarised by title instead. Enough for the model to
    // know it already suggested something and not repeat itself; not the whole
    // card, which would cost input tokens on every future reply forever.
    function priorAsText(m: any): string {
      if (m.role === 'assistant' && m.recipe?.title) {
        return `[Suggested a recipe: ${m.recipe.title}]`;
      }
      return m.content as string;
    }

    // The pantry context rides on the first user turn every call, ordered
    // ahead of the real conversation — it changes every time someone edits
    // their shelf, so it has to be resent in full rather than assumed stale
    // from an earlier turn.
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: brief },
      { role: 'assistant', content: "Got it, I can see what's in the pantry. What's up?" },
      ...prior.map((m: any) => ({
        role: m.role as 'user' | 'assistant',
        content: priorAsText(m),
      })),
      { role: 'user', content: text },
    ];

    const startedAt = Date.now();
    let response;
    try {
      response = await openai().chat.completions.create({
        model: MODEL,
        max_completion_tokens: 2048,
        // Function tools on this model family are only supported on Chat
        // Completions with reasoning turned off (see the MODEL comment above)
        // — with reasoning on, the API rejects the request outright.
        reasoning_effort: 'none',
        tools: [SUGGEST_RECIPE_TOOL],
        messages,
      });
    } catch (err: any) {
      console.error('Chat call failed', { uid, message: err?.message });
      const status = err?.status === 429 ? 429 : 503;
      res.status(status).json({
        error: status === 429 ? 'resource-exhausted' : 'unavailable',
        message: 'Could not think of anything just now — try again in a moment.',
      });
      return;
    }

    const choice = response.choices[0];
    const toolCall = choice?.message?.tool_calls?.find(
      (call): call is OpenAI.Chat.ChatCompletionMessageFunctionToolCall =>
        call.type === 'function' && call.function.name === 'suggest_recipe'
    );

    let replyText = '';
    let recipe: ChatRecipe | null = null;

    if (toolCall) {
      let toolInput: unknown = null;
      try {
        toolInput = JSON.parse(toolCall.function.arguments);
      } catch {
        toolInput = null;
      }
      recipe = cleanChatRecipe(toolInput);
      // `have` is re-derived from the real pantry rather than trusted from the
      // model, the same defensive posture routes/recipes.ts takes with
      // pantryUsed — the whole point of the checklist is telling the truth
      // about what's actually on the shelf, and a model that named an
      // ingredient the user doesn't own could as easily mismark it as owned.
      if (recipe) {
        const owned = new Set(items.map((item: any) => String(item.name).toLowerCase().trim()));
        recipe = {
          ...recipe,
          ingredients: recipe.ingredients.map((ingredient) => ({
            ...ingredient,
            have: owned.has(ingredient.name.toLowerCase().trim()),
          })),
        };
      }
    }
    if (!recipe) {
      replyText =
        choice?.finish_reason === 'content_filter' || !choice?.message?.content
          ? "Sorry, I couldn't come up with an answer for that — try asking a different way."
          : choice.message.content.trim();
    }

    // Prepend the honest "can't check live trends" notice rather than ever
    // presenting the model's own (necessarily stale) idea of what's trending
    // as if it were current — matches the same fallback whether the model
    // replied in words or with a recipe card.
    if (trendingUnavailable) {
      replyText = replyText ? `${TRENDING_UNAVAILABLE_PREFIX}${replyText}` : TRENDING_UNAVAILABLE_PREFIX.trim();
    }

    console.info('Chat reply complete', {
      uid,
      conversationId: id,
      ms: Date.now() - startedAt,
      intent,
      itemCount: items.length,
      recipe: recipe !== null,
      trendingUnavailable,
      inputTokens: response.usage?.prompt_tokens ?? 0,
      cachedTokens: response.usage?.prompt_tokens_details?.cached_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
    });

    const isFirstMessage = prior.length === 0;

    // Sequential, not Promise.all — the two creates raced each other before,
    // and Mongoose's timestamps are stamped at the moment each document
    // actually writes, so the assistant's turn could land with an earlier (or
    // tied) createdAt than the user's. GET /messages sorts by createdAt, so
    // that occasionally rendered the reply above the question that prompted
    // it. Awaiting the user message first guarantees its timestamp is always
    // strictly earlier.
    const userDoc = await ChatMessage.create({
      _id: randomUUID(),
      userId: uid,
      conversationId: id,
      role: 'user',
      content: text,
    });
    const [assistantDoc] = await Promise.all([
      ChatMessage.create({
        _id: randomUUID(),
        userId: uid,
        conversationId: id,
        role: 'assistant',
        content: replyText,
        recipe,
      }),
      // Bumped on every turn so the list sorts by last activity, the same as
      // any chat app's sidebar. Titled only once, from the message that
      // started it — see the note on chat_conversations in models.ts.
      ChatConversation.updateOne(
        { _id: id, userId: uid },
        { $set: { updatedAt: new Date(), ...(isFirstMessage ? { title: titleFrom(text) } : {}) } }
      ),
    ]);

    res.json({ user: toMessageRow(userDoc), assistant: toMessageRow(assistantDoc) });
  })
);
