// src/screens/ChatScreen.tsx
//
// One conversation with Panzi — the whole of the chat flow now that history is
// a drawer (HistoryDrawer.tsx) rather than a screen of its own. See ChatFlow,
// which mounts this and owns which conversation is currently open. History
// loads whenever the conversation id changes; each send appends both the
// user's turn and Panzi's reply locally rather than refetching, since the
// server already returns both in the one response.

import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Text from '../components/Text';
import Mascot from '../components/Mascot';
import ChatRecipeCard from '../components/chat/ChatRecipeCard';
import { fonts, type } from '../theme/typography';
import { makeStyles } from '../theme/makeStyles';
import { useColors } from '../theme/ThemeProvider';
import { space } from '../theme/spacing';
import { ChatError, ChatMessage, fetchChatHistory, sendChatMessage } from '../services/chat';
import { PantryItem } from '../services/pantry';
import { Recipe, withLiveIngredients } from '../services/recipes';

const HIT_SLOP = { top: 12, bottom: 12, left: 12, right: 12 };
const MAX_LENGTH = 2000;
const AVATAR_SIZE = 28;

type Props = {
  conversationId: string;
  title: string;
  /** The live pantry — see the note on withLiveIngredients in
   *  services/recipes.ts for why a recipe card recomputes `have` from this on
   *  every render rather than trusting what's stored on the message. */
  items: PantryItem[];
  onOpenRecipe: (recipe: Recipe) => void;
  onStartCooking: (recipe: Recipe) => void;
  /** Hamburger icon — opens HistoryDrawer over this screen. */
  onOpenHistory: () => void;
  /** The X — leaves the whole chat flow, back to wherever "Ask Panzi" was
   *  tapped from. Distinct from onOpenHistory: one stays inside chat, the
   *  other leaves it entirely. */
  onClose: () => void;
  /** Fired whenever this conversation has no messages yet, or gains its
   *  first one — so HistoryDrawer's "New chat" button can grey itself out
   *  rather than spawn a second empty conversation while the current one is
   *  already unused. */
  onEmptyChange: (empty: boolean) => void;
};

export default function ChatScreen({
  conversationId,
  title,
  items,
  onOpenRecipe,
  onStartCooking,
  onOpenHistory,
  onClose,
  onEmptyChange,
}: Props) {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlatList<ChatMessage>>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Whether the input bar needs to clear the home indicator (closed) or sit
  // flush against the keyboard (open). insets.bottom is the height of that
  // indicator's safe area — real when nothing covers it, but the keyboard
  // covers exactly that area once it's up, so adding it on top of the
  // keyboard's own height left a strip of bare background between the two.
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, () => setKeyboardVisible(true));
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardVisible(false));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // Reported on every change, not just once on load — sending the first
  // message in a fresh conversation has to flip "New chat" from enabled back
  // to disabled immediately, in the same beat the optimistic message appears.
  const onEmptyChangeRef = useRef(onEmptyChange);
  onEmptyChangeRef.current = onEmptyChange;
  useEffect(() => {
    onEmptyChangeRef.current(messages.length === 0);
  }, [messages.length]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setMessages([]);
    fetchChatHistory(conversationId)
      .then((history) => {
        if (!cancelled) setMessages(history);
      })
      .catch(() => {
        // A failed history load isn't fatal — an empty conversation just opens
        // fresh, same as it would for a brand-new one.
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;

    setSending(true);
    setError(null);
    setDraft('');

    // Optimistic: the user's own line appears immediately rather than waiting
    // on the round trip, the same instinct as the scan modal's "N items added"
    // toast. A failure below removes it again rather than leaving a message
    // that was never actually sent sitting in the thread.
    const optimistic: ChatMessage = {
      id: `optimistic-${Date.now()}`,
      role: 'user',
      content: text,
      recipe: null,
      createdAt: Date.now(),
    };
    setMessages((prev) => [...prev, optimistic]);

    try {
      const { user, assistant } = await sendChatMessage(conversationId, text);
      setMessages((prev) => [...prev.filter((m) => m.id !== optimistic.id), user, assistant]);
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      setDraft(text);
      setError(err instanceof ChatError ? err.message : 'Something went wrong — try again.');
    } finally {
      setSending(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      // No offset: the header lives inside this view, not above it, so
      // KeyboardAvoidingView already measures it as part of its own layout.
      // Adding insets.top on top of that reserved extra space equal to the
      // status bar height between the input bar and the keyboard — visible as
      // a strip of bare background the moment the keyboard opens.
    >
      <View style={[styles.header, { paddingTop: insets.top + space.sm }]}>
        <TouchableOpacity onPress={onOpenHistory} hitSlop={HIT_SLOP} style={styles.headerButton}>
          <Ionicons name="menu" size={22} color={colors.textSecondary} />
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <TouchableOpacity onPress={onClose} hitSlop={HIT_SLOP} style={styles.headerButton}>
          <Ionicons name="close" size={22} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="chatbubble-ellipses-outline" size={28} color={colors.mutedLight} />
              <Text style={styles.emptyText}>
                Ask what to cook, whether you have an ingredient, or anything about your pantry.
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            const isUser = item.role === 'user';
            return (
              <View style={[styles.bubbleRow, isUser ? styles.bubbleRowUser : styles.bubbleRowAssistant]}>
                {!isUser && (
                  <View style={styles.avatar}>
                    <Mascot size={AVATAR_SIZE * 0.82} pose="face" />
                  </View>
                )}
                {item.recipe ? (
                  <View style={styles.recipeBubbleWrap}>
                    {(() => {
                      // Recomputed on every render, not cached on the message:
                      // the whole point is that this stays right as `items`
                      // changes underneath it — cooking something and coming
                      // back to this same chat should show it as used, not
                      // the snapshot from when Panzi first replied.
                      const live = withLiveIngredients(item.recipe as Recipe, items);
                      return (
                        <ChatRecipeCard
                          recipe={live}
                          onOpen={() => onOpenRecipe(live)}
                          onStartCooking={() => onStartCooking(live)}
                        />
                      );
                    })()}
                  </View>
                ) : (
                  <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAssistant]}>
                    <Text style={isUser ? styles.bubbleTextUser : styles.bubbleTextAssistant}>
                      {item.content}
                    </Text>
                  </View>
                )}
              </View>
            );
          }}
        />
      )}

      {sending && (
        <View style={styles.typingRow}>
          <ActivityIndicator size="small" color={colors.mutedLight} />
          <Text style={styles.typingText}>Panzi is thinking…</Text>
        </View>
      )}

      {error && <Text style={styles.errorText}>{error}</Text>}

      <View
        style={[
          styles.inputBar,
          { paddingBottom: (keyboardVisible ? 0 : insets.bottom) + space.md },
        ]}
      >
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder="Ask what to cook..."
          placeholderTextColor={colors.mutedLight}
          multiline
          maxLength={MAX_LENGTH}
          selectionColor={colors.primaryDark}
        />
        <TouchableOpacity
          style={[styles.send, (!draft.trim() || sending) && styles.sendOff]}
          onPress={send}
          disabled={!draft.trim() || sending}
          activeOpacity={0.85}
        >
          <Ionicons name="arrow-up" size={18} color={colors.onAccent} />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const useStyles = makeStyles((colors) => ({
  container: {
    flex: 1,
    backgroundColor: colors.backgroundLight,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingBottom: space.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  headerButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    textAlign: 'center',
    fontFamily: fonts.display,
    fontWeight: '800',
    fontSize: type.subtitle.fontSize,
    color: colors.primaryDarker,
    marginHorizontal: space.sm,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: {
    flexGrow: 1,
    paddingHorizontal: space.xxl,
    paddingVertical: space.lg,
    gap: space.sm2,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: space.xxl * 2,
    paddingHorizontal: space.xxl,
    gap: space.md,
  },
  emptyText: {
    textAlign: 'center',
    fontWeight: '600',
    fontSize: type.body.fontSize,
    lineHeight: 21,
    color: colors.textSecondary,
  },
  bubbleRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.sm,
  },
  bubbleRowUser: {
    justifyContent: 'flex-end',
  },
  bubbleRowAssistant: {
    justifyContent: 'flex-start',
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryLighter,
  },
  bubble: {
    maxWidth: '78%',
    borderRadius: 18,
    paddingHorizontal: space.md2,
    paddingVertical: space.sm2,
  },
  recipeBubbleWrap: {
    flex: 1,
    maxWidth: '90%',
  },
  bubbleUser: {
    backgroundColor: colors.primary,
    borderBottomRightRadius: 4,
  },
  bubbleAssistant: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
    borderBottomLeftRadius: 4,
  },
  bubbleTextUser: {
    fontWeight: '600',
    fontSize: type.body.fontSize,
    lineHeight: 21,
    color: colors.onAccent,
  },
  bubbleTextAssistant: {
    fontWeight: '600',
    fontSize: type.body.fontSize,
    lineHeight: 21,
    color: colors.textPrimary,
  },
  typingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.xxl,
    paddingBottom: space.sm,
  },
  typingText: {
    fontWeight: '600',
    fontSize: type.caption.fontSize,
    color: colors.textSecondary,
  },
  errorText: {
    fontWeight: '700',
    fontSize: type.caption.fontSize,
    lineHeight: 17,
    color: colors.rustMuted,
    paddingHorizontal: space.xxl,
    paddingBottom: space.sm,
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.sm,
    paddingHorizontal: space.xxl,
    paddingTop: space.md,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    backgroundColor: colors.backgroundLight,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
    paddingHorizontal: space.md2,
    paddingVertical: space.sm2,
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: type.body.fontSize,
    color: colors.textPrimary,
  },
  send: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  sendOff: {
    backgroundColor: colors.primaryLight,
  },
}));
