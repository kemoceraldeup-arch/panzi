// src/services/chat.ts
//
// Ask Panzi what to cook — separate conversations, each with its own history,
// the same shape as Claude's own sidebar.
//
// Unlike recipes.ts, the pantry is never sent from here: the server reads it
// straight from Mongo on every reply, so "do I have eggs?" answers against
// whatever is actually on the shelf right now rather than a copy that could be
// a screen refresh stale. This service only carries the conversations and
// their messages.

import { apiFetch, ApiError } from '../config/api';
import { Recipe } from './recipes';
import { lookFor } from '../theme/dishLooks';
import { dishKeyFor } from '../theme/dishPhotos';

export type Conversation = {
  id: string;
  title: string;
  updatedAt: number;
};

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  /** Empty on a recipe reply — see the note on models.ts's chat_messages. */
  content: string;
  /** Set only on an assistant turn that answered with a dish instead of words. */
  recipe: Recipe | null;
  createdAt: number;
};

/** Fills in the two fields a bare server payload doesn't carry — the same gap
 *  normaliseRecipe in recipes.ts closes for the suggestion screens. */
function normaliseMessage(raw: any): ChatMessage {
  return {
    id: raw.id,
    role: raw.role,
    content: typeof raw.content === 'string' ? raw.content : '',
    recipe: raw.recipe
      ? {
          ...raw.recipe,
          look: lookFor(raw.recipe.look),
          dishKey: dishKeyFor(raw.recipe.dishKey),
          description: raw.recipe.description ?? '',
          needsShopping: raw.recipe.needsShopping === true,
          usesExpiring: raw.recipe.usesExpiring ?? [],
          pantryUsed: raw.recipe.pantryUsed ?? [],
          ingredients: Array.isArray(raw.recipe.ingredients)
            ? raw.recipe.ingredients.map((ingredient: any) => ({
                ...ingredient,
                optional: ingredient.optional === true,
              }))
            : [],
        }
      : null,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
  };
}

/** Raised for anything the user can act on; the screen shows the message. */
export class ChatError extends Error {}

async function guarded<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    const code = err instanceof ApiError ? err.code : null;
    if (code === 'unauthenticated') {
      throw new ChatError('Sign in again to keep chatting.');
    }
    if (code === 'resource-exhausted') {
      throw new ChatError("I've been thinking a lot today — try again in a bit.");
    }
    if (code === 'unreachable' && err instanceof ApiError) {
      throw new ChatError(err.message);
    }
    throw new ChatError("Couldn't reach the kitchen — check your connection and try again.");
  }
}

export async function fetchConversations(): Promise<Conversation[]> {
  return guarded(async () => {
    const { conversations } = await apiFetch<{ conversations: Conversation[] }>(
      '/api/chat/conversations'
    );
    return conversations;
  });
}

export async function createConversation(): Promise<Conversation> {
  return guarded(async () => {
    const { conversation } = await apiFetch<{ conversation: Conversation }>(
      '/api/chat/conversations',
      {}
    );
    return conversation;
  });
}

export async function deleteConversation(id: string): Promise<void> {
  return guarded(async () => {
    await apiFetch(`/api/chat/conversations/${id}/delete`, {});
  });
}

export async function fetchChatHistory(conversationId: string): Promise<ChatMessage[]> {
  return guarded(async () => {
    const { messages } = await apiFetch<{ messages: any[] }>(
      `/api/chat/conversations/${conversationId}/messages`
    );
    return messages.map(normaliseMessage);
  });
}

export async function sendChatMessage(
  conversationId: string,
  message: string,
  pantryOnly?: boolean
): Promise<{ user: ChatMessage; assistant: ChatMessage }> {
  return guarded(async () => {
    const { user, assistant } = await apiFetch<{ user: any; assistant: any }>(
      `/api/chat/conversations/${conversationId}/messages`,
      { message, ...(pantryOnly ? { pantryOnly: true } : {}) }
    );
    return { user: normaliseMessage(user), assistant: normaliseMessage(assistant) };
  });
}
