// server/src/routes/chat.ts
//
// Ask Panzi what to cook — separate conversations, each with its own history,
// the same shape as Claude's own sidebar.
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
// or the other. Claude picks by calling suggest_recipe when the question wants
// a dish; anything else comes back as the model's own text. The schema is the
// same one routes/recipes.ts already validates candidates against, reused
// rather than duplicated, but the rule about what a card is *allowed to
// suggest* is deliberately looser here: recipes.ts drops the "lean on the
// pantry" instruction only when nothing fits at all, because a browsing screen
// should mostly show what's already on hand. A chat is a direct question — "what
// can I cook with X and Y" names the ingredients to build around, on purpose,
// and a user who asked that expects a real answer even when the pantry doesn't
// otherwise carry the rest of the dish. needsShopping and the ingredient
// have/missing split are how the card stays honest about the gap either way.

import { randomUUID } from 'crypto';
import Anthropic from '@anthropic-ai/sdk';
import { Router } from 'express';
import { ChatConversation, ChatMessage, PantryItem, User } from '../models';
import { badRequest, isValidId, withDb } from './helpers';
import { RECIPE_SCHEMA, Recipe, cleanRecipe } from './recipes';

// Sonnet, same reasoning as routes/recipes.ts: answering a question about a
// known pantry is not deep reasoning, and this is a screen the user is
// actively typing on, waiting for a reply. Opus's extra care buys nothing here
// that Sonnet doesn't already have.
const MODEL = 'claude-sonnet-5';

const MAX_MESSAGE_LENGTH = 2000;
const MAX_ITEMS = 60;
const HISTORY_PAGE = 100;
// How many prior turns ride along as conversation context. Bounded so a long
// -running chat doesn't grow the input tokens of every reply without limit —
// Claude only needs enough of the back-and-forth to not repeat itself or lose
// the thread, not the whole history.
const CONTEXT_TURNS = 20;
// A title is a label for a list row, not a summary — long enough to recognise
// the conversation, short enough that a phone-width row shows the whole thing
// on one line without needing the ellipsis at all for a typical short
// question. 24 rather than something closer to the row's true character
// capacity on purpose: the row also carries a timestamp, and a title padded
// out to fill all the remaining space reads as cut off far more often than
// one that stops early on its own.
const TITLE_MAX_LENGTH = 24;

const SUGGEST_RECIPE_TOOL: Anthropic.Tool = {
  name: 'suggest_recipe',
  description:
    'Call this when the user is asking what to cook, for a recipe, or "what can I make with X" — anything where the right answer is a dish rather than a sentence. Do not call it for questions that are just about the pantry itself, like whether an item is present or how long it has left.',
  input_schema: RECIPE_SCHEMA as unknown as Anthropic.Tool.InputSchema,
};

const SYSTEM = `You are Panzi, the cooking assistant inside a pantry-tracking app for a Filipino household. You are having a conversation, not generating a one-off suggestion — answer the actual question asked, the way a helpful housemate would over text.

You are given the user's current pantry, with what is known about how long each item has left. Use it: "do I have eggs?" gets a plain yes/no from the list, not a guess. A date marked "estimated" is the app's own guess and should be treated as approximate. Never tell someone to eat something already past its date. Never invent what is in the pantry; if it is not in the list, say they don't have it.

When the user asks what to cook, for a recipe, or "what can I make with X and Y", call suggest_recipe instead of answering in words — the app renders that as a proper recipe card. Build it around whatever ingredients they actually named, whether or not those are in the pantry: naming an ingredient in the question is the user telling you to cook with it, not asking whether they own it. Fill "have" on each ingredient from the real pantry list, and set needsShopping true only when a real trip is needed for more than a staple or two — the card shows exactly what's missing, so it doesn't need to pretend everything is on hand. If nothing was named and the pantry can't carry a decent dish either, it's fine to ask what they're in the mood for instead of guessing.

For everything else — pantry questions, follow-ups, small talk — just answer in a few sentences of plain text. You are texting, not writing an article.

Cook Filipino unless the user's own ingredients push elsewhere. Use the names they use: toyo, suka, patis, sitaw, talong, gata, kangkong, not their English translations. Dietary requirements and allergies, given below, are absolute — never suggest a dish or ingredient that violates either.`;

let client: Anthropic | null = null;

function anthropic(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set — copy .env.example to .env');
    client = new Anthropic({ apiKey });
  }
  return client;
}

function toMessageRow(doc: any) {
  return {
    id: doc._id,
    role: doc.role as 'user' | 'assistant',
    content: doc.content as string,
    recipe: (doc.recipe as Recipe | null) ?? null,
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
 *  the latency and the cost of every "New chat" for a cosmetic label Claude's
 *  own history list gets from the same trick.
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
    const { message } = (req.body ?? {}) as { message?: string };
    const uid = req.uid as string;

    if (!isValidId(id)) return badRequest(res, 'No conversation id was sent.');
    const text = typeof message === 'string' ? message.trim().slice(0, MAX_MESSAGE_LENGTH) : '';
    if (!text) return badRequest(res, 'The message was empty.');

    const conversation = await ChatConversation.findOne({ _id: id, userId: uid }).lean();
    if (!conversation) return badRequest(res, 'That conversation no longer exists.');

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

    const brief = [
      pantryBrief(items),
      '',
      dietary.length ? `THEIR DIET: ${dietary.join(', ')}` : 'No dietary requirements.',
      allergies.length
        ? `ALLERGIES (must never appear in a suggestion): ${allergies.join(', ')}`
        : 'No known allergies.',
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
    // ahead of the real conversation, rather than in the cached system block —
    // it changes every time someone edits their shelf, and putting it after the
    // cache breakpoint would mean it stops being current the moment it's cached.
    const messages: Anthropic.MessageParam[] = [
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
      response = await anthropic().messages.create({
        model: MODEL,
        max_tokens: 2048,
        system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
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

    const toolUse = response.content.find(
      (entry): entry is Anthropic.ToolUseBlock => entry.type === 'tool_use' && entry.name === 'suggest_recipe'
    );
    const textBlock = response.content.find((entry) => entry.type === 'text');

    let replyText = '';
    let recipe: Recipe | null = null;

    if (toolUse) {
      recipe = cleanRecipe(toolUse.input);
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
        response.stop_reason === 'refusal' || !textBlock || textBlock.type !== 'text'
          ? "Sorry, I couldn't come up with an answer for that — try asking a different way."
          : textBlock.text.trim();
    }

    console.info('Chat reply complete', {
      uid,
      conversationId: id,
      ms: Date.now() - startedAt,
      itemCount: items.length,
      recipe: recipe !== null,
      inputTokens: response.usage.input_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
      outputTokens: response.usage.output_tokens,
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
