// src/components/chat/ConversationPreview.tsx
//
// The peek at a chat that holding its row opens — the tail end of the
// conversation, read-only, the way the ChatGPT app shows one above its menu.
// Bottom-aligned and clipped at the top, so what shows is always the most
// recent exchange, with older messages cut off by the card's edge rather
// than scrolled to.
//
// Previews are cached for the session: holding the same row twice shouldn't
// flash a spinner the second time, and a stale peek is harmless — opening
// the chat always loads it fresh.

import React, { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Text from '../Text';
import { makeStyles } from '../../theme/makeStyles';
import { useColors } from '../../theme/ThemeProvider';
import { space } from '../../theme/spacing';
import { type } from '../../theme/typography';
import { ChatMessage, fetchChatHistory } from '../../services/chat';

/** Enough to fill the card; anything further up is clipped anyway. */
const TAIL = 10;

const cache = new Map<string, ChatMessage[]>();

/** Drop a chat's cached preview — after it has been deleted, say. */
export function forgetPreview(conversationId: string) {
  cache.delete(conversationId);
}

export default function ConversationPreview({ conversationId }: { conversationId: string }) {
  const styles = useStyles();
  const colors = useColors();
  const [messages, setMessages] = useState<ChatMessage[] | null>(
    () => cache.get(conversationId) ?? null
  );
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchChatHistory(conversationId)
      .then((history) => {
        const tail = history.slice(-TAIL);
        cache.set(conversationId, tail);
        if (!cancelled) setMessages(tail);
      })
      .catch(() => {
        if (!cancelled && !cache.has(conversationId)) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  if (messages === null) {
    return (
      <View style={styles.centered}>
        {failed ? (
          <Text style={styles.note}>Couldn’t load a preview.</Text>
        ) : (
          <ActivityIndicator color={colors.primary} />
        )}
      </View>
    );
  }

  if (messages.length === 0) {
    return (
      <View style={styles.centered}>
        <Text style={styles.note}>No messages yet.</Text>
      </View>
    );
  }

  return (
    <View style={styles.thread} pointerEvents="none">
      {messages.map((message) => {
        const isUser = message.role === 'user';
        if (message.recipe) {
          return (
            <View key={message.id} style={styles.recipe}>
              <View style={styles.recipeIcon}>
                <Ionicons name="restaurant" size={14} color={colors.primaryDark} />
              </View>
              <Text style={styles.recipeTitle} numberOfLines={1}>
                {message.recipe.title}
              </Text>
            </View>
          );
        }
        return isUser ? (
          <View key={message.id} style={styles.userBubble}>
            <Text style={styles.userText} numberOfLines={6}>
              {message.content}
            </Text>
          </View>
        ) : (
          // Panzi's side reads as plain text, no bubble — the same as the
          // ChatGPT preview, and it fits more of the answer in the card.
          <Text key={message.id} style={styles.assistantText}>
            {message.content}
          </Text>
        );
      })}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  // flex-end + the card's overflow:hidden is what keeps the newest message on
  // screen and lets the oldest fall off the top.
  thread: {
    flex: 1,
    justifyContent: 'flex-end',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.lg,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  note: {
    fontWeight: '600',
    fontSize: type.caption.fontSize,
    color: colors.textSecondary,
  },
  userBubble: {
    alignSelf: 'flex-end',
    maxWidth: '82%',
    backgroundColor: colors.backgroundAlt,
    borderRadius: 20,
    paddingHorizontal: space.md2,
    paddingVertical: space.sm2,
  },
  userText: {
    fontWeight: '600',
    fontSize: type.body.fontSize,
    lineHeight: 21,
    color: colors.textPrimary,
  },
  assistantText: {
    fontWeight: '500',
    fontSize: type.body.fontSize,
    lineHeight: 22,
    color: colors.textPrimary,
  },
  recipe: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    alignSelf: 'flex-start',
    maxWidth: '90%',
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
    paddingHorizontal: space.md,
    paddingVertical: space.sm2,
  },
  recipeIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryLighter,
  },
  recipeTitle: {
    flexShrink: 1,
    fontWeight: '800',
    fontSize: type.body.fontSize,
    color: colors.primaryDarker,
  },
}));
