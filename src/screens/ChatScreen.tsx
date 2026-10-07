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
  AppState,
  FlatList,
  GestureResponderEvent,
  Keyboard,
  NativeScrollEvent,
  NativeSyntheticEvent,
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
import TypingIndicator, { MessageEnter } from '../components/chat/TypingIndicator';
import VoiceBar from '../components/chat/VoiceBar';
import VoiceIcon from '../components/chat/VoiceIcon';
import { useVoiceInput } from '../components/chat/useVoiceInput';
import { fonts, type } from '../theme/typography';
import { makeStyles } from '../theme/makeStyles';
import { useColors } from '../theme/ThemeProvider';
import { space } from '../theme/spacing';
import {
  ChatError,
  ChatMessage,
  Conversation,
  createConversation,
  fetchChatHistory,
  sendChatMessage,
} from '../services/chat';
import { PantryItem } from '../services/pantry';
import { askForChatReplyPermission, notifyChatReply } from '../services/notifications';
import { Recipe, withLiveIngredients } from '../services/recipes';

const HIT_SLOP = { top: 12, bottom: 12, left: 12, right: 12 };
const MAX_LENGTH = 2000;
const AVATAR_SIZE = 30;

/** Offered in an empty chat — the questions people most often open it for. */
const SUGGESTIONS: { text: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { text: 'What can I cook tonight with what I have?', icon: 'restaurant-outline' },
  { text: 'What’s going off soon, and what can I make with it?', icon: 'leaf-outline' },
  { text: 'Something quick, under 20 minutes', icon: 'timer-outline' },
  { text: 'A Filipino classic I can make this week', icon: 'flame-outline' },
];

type Props = {
  /** Null until the first message is actually sent — see the note in
   *  ChatFlow on why creation is deferred to that point rather than to when
   *  this screen opens. */
  conversationId: string | null;
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
  /** Fired once, the moment the first message actually creates a
   *  conversation server-side — lets ChatFlow learn the real id so
   *  HistoryDrawer's "which conversation is this" checks and a later reopen
   *  both see it, instead of staying stuck on the local null placeholder. */
  onConversationStarted: (conversation: Conversation) => void;
  /** Text to put in the input for the user to send — a pantry chip tapped in
   *  the drawer. Filled in, never sent: they may want to add to it. */
  draft?: { text: string; nonce: number } | null;
  /** Changes when the chat was opened from Home's microphone — start
   *  listening straight away rather than making them tap a second mic. */
  voiceNonce?: number | null;
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
  onConversationStarted,
  draft: incomingDraft,
  voiceNonce,
}: Props) {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlatList<ChatMessage>>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // Nothing to load for a conversation that doesn't exist on the server yet
  // — an unstarted chat opens straight to its empty state instead of a
  // spinner over nothing.
  const [loading, setLoading] = useState(conversationId !== null);
  // The id `send()` itself just handed to onConversationStarted, so the
  // effect below can tell "conversationId changed because I just created
  // this conversation a moment ago" apart from "conversationId changed
  // because the user opened a different one from History." The first case
  // must not wipe and refetch `messages` — the optimistic user line and the
  // real assistant reply that follows it are already correct and already
  // in state; resetting to [] here would flash the empty state right after
  // the user's first message, then have the fetch below just hand back the
  // same one or two messages a moment later.
  const selfAssignedId = useRef<string | null>(null);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (!incomingDraft) return;
    setDraft(incomingDraft.text);
    // After the drawer has finished sliding shut, so the keyboard doesn't
    // rise under a panel that is still moving.
    const timer = setTimeout(() => inputRef.current?.focus(), 260);
    return () => clearTimeout(timer);
  }, [incomingDraft]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Whether Panzi should build recipe replies primarily from what's already
  // in the pantry — a per-message flag sent alongside the draft, not stored
  // on the conversation, so flipping it mid-chat only changes the next reply.
  const [pantryOnly, setPantryOnly] = useState(false);
  // Whether the input bar needs to clear the home indicator (closed) or sit
  // flush against the keyboard (open). insets.bottom is the height of that
  // indicator's safe area — real when nothing covers it, but the keyboard
  // covers exactly that area once it's up, so adding it on top of the
  // keyboard's own height left a strip of bare background between the two.
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const keyboardVisibleRef = useRef(false);
  keyboardVisibleRef.current = keyboardVisible;
  // Messages sent or received while this screen is open — the only ones that
  // animate in. History loaded on open is simply there.
  const fresh = useRef(new Set<string>()).current;

  // Dragging the thread down only puts the keyboard away once the finger
  // actually reaches it — the Messages-app behaviour — not on the first
  // pixel of any scroll (on-drag), and not never (Android has no
  // "interactive" mode, which is what this used to rely on).
  //
  // Where the finger is has to be worked out two ways. Before the list starts
  // scrolling, touch moves report it directly. Once the native scroll view
  // takes the gesture over, touch moves stop arriving, but content scrolls
  // 1:1 with the finger — so the finger is wherever it started plus however
  // far the content has moved since.
  const inputBarRef = useRef<View>(null);
  const drag = useRef({
    /** Page Y of the finger when it went down. */
    startY: 0,
    /** List offset when the native scroll took over, or null before. */
    startOffset: null as number | null,
    /** Page Y of the keyboard's top edge, measured when the drag began. */
    keyboardTop: Infinity,
    active: false,
  }).current;

  function fingerReachedKeyboard(y: number) {
    if (!drag.active || y <= drag.startY || y < drag.keyboardTop) return;
    drag.active = false;
    Keyboard.dismiss();
  }

  function onListTouchStart(e: GestureResponderEvent) {
    drag.startY = e.nativeEvent.pageY;
    drag.startOffset = null;
    drag.active = keyboardVisibleRef.current;
    if (!drag.active) return;
    // The bottom of the input bar is the top of the keyboard: the bar sits
    // flush on it while it's up. Measured in the same coordinates touches are
    // reported in, which the keyboard's own screenY isn't reliably on Android.
    drag.keyboardTop = Infinity;
    inputBarRef.current?.measureInWindow((_x, y, _w, h) => {
      drag.keyboardTop = y + h;
    });
  }

  function onListTouchMove(e: GestureResponderEvent) {
    fingerReachedKeyboard(e.nativeEvent.pageY);
  }

  function onListScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    if (!drag.active) return;
    const offset = e.nativeEvent.contentOffset.y;
    if (drag.startOffset === null) {
      drag.startOffset = offset;
      return;
    }
    fingerReachedKeyboard(drag.startY + (drag.startOffset - offset));
  }

  function onListDragEnd() {
    drag.active = false;
  }

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
    // This id arrived because send() just created it a moment ago — the
    // messages already in state are already correct and already include
    // this conversation's first exchange. Consume the marker and skip the
    // reset/refetch below; see the note on selfAssignedId above.
    if (conversationId !== null && selfAssignedId.current === conversationId) {
      selfAssignedId.current = null;
      return;
    }

    setMessages([]);
    // No id means nothing has ever been sent in this conversation — there is
    // no history to fetch, and asking the server for one that doesn't exist
    // yet would just be a guaranteed failure caught below.
    if (conversationId === null) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
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

  // Spoken words land in the input, added to anything already typed, for
  // the user to read over and send — a misheard ingredient is easier to fix
  // as text than as a wrong answer.
  const voice = useVoiceInput({
    onText: (text) => {
      setDraft((current) => (current.trim() ? `${current.trimEnd()} ${text}` : text));
      setError(null);
    },
    onError: setError,
  });

  function startVoice() {
    Keyboard.dismiss();
    setError(null);
    voice.start();
  }

  useEffect(() => {
    if (!voiceNonce) return;
    // After the chat has finished sliding up — the permission prompt, if
    // there is one, shouldn't appear over a screen still moving.
    const timer = setTimeout(startVoice, 450);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceNonce]);

  /** `override` sends a suggestion without it passing through the input. */
  async function send(override?: string) {
    const text = (override ?? draft).trim();
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
    fresh.add(optimistic.id);
    setMessages((prev) => [...prev, optimistic]);

    try {
      // The conversation itself doesn't exist on the server until there is
      // something worth saving — this is that moment. Everything before this
      // send happened purely on the phone; a user who opened chat, read the
      // empty state, and closed without typing never touched the server at
      // all, so there is nothing left behind in History for it.
      let id = conversationId;
      if (id === null) {
        const conversation = await createConversation();
        id = conversation.id;
        selfAssignedId.current = id;
        onConversationStarted(conversation);
      }
      // Asked now rather than awaited: the question goes out straight away,
      // and the permission prompt (first time only) sits over it meanwhile.
      askForChatReplyPermission().catch(() => {});
      const { user, assistant } = await sendChatMessage(id, text, pantryOnly);
      // Left the app while Panzi was thinking — say the answer is in.
      if (AppState.currentState !== 'active') {
        notifyChatReply({
          conversationId: id,
          // The server titles a new chat from its first message; this is the
          // same words, so a tap reopens it under the name the list shows.
          conversationTitle: title !== 'New chat' ? title : text.split('\n')[0].slice(0, 24),
          text: assistant.content || null,
          recipeTitle: assistant.recipe?.title ?? null,
        }).catch(() => {});
      }
      // The saved copy of the user's own line takes the optimistic one's place
      // without animating again; only Panzi's reply eases in.
      fresh.add(assistant.id);
      setMessages((prev) => [...prev.filter((m) => m.id !== optimistic.id), user, assistant]);
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      setDraft(text);
      setError(err instanceof ChatError ? err.message : 'Something went wrong — try again.');
    } finally {
      setSending(false);
    }
  }

  const composing = voice.state === 'idle';
  const canSend = composing && !!draft.trim() && !sending;

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
        <TouchableOpacity
          onPress={onOpenHistory}
          hitSlop={HIT_SLOP}
          style={styles.headerButton}
          accessibilityLabel="Chat history"
        >
          <Ionicons name="menu" size={22} color={colors.textDark} />
        </TouchableOpacity>
        <View style={styles.titleWrap}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          {pantryOnly && <Text style={styles.titleNote}>Pantry only</Text>}
        </View>
        <TouchableOpacity
          onPress={onClose}
          hitSlop={HIT_SLOP}
          style={styles.headerButton}
          accessibilityLabel="Close chat"
        >
          <Ionicons name="close" size={22} color={colors.textDark} />
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
          keyboardDismissMode="none"
          keyboardShouldPersistTaps="handled"
          onTouchStart={onListTouchStart}
          onTouchMove={onListTouchMove}
          onScrollBeginDrag={(e) => {
            drag.startOffset = e.nativeEvent.contentOffset.y;
          }}
          onScroll={onListScroll}
          onScrollEndDrag={onListDragEnd}
          onTouchEnd={onListDragEnd}
          scrollEventThrottle={16}
          ListFooterComponent={
            sending ? (
              <View style={[styles.assistantRow, styles.typingRow]}>
                <View style={styles.avatar}>
                  <Mascot size={AVATAR_SIZE * 0.82} pose="face" />
                </View>
                <TypingIndicator />
              </View>
            ) : null
          }
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          ListEmptyComponent={
            // A blank chat is the moment most people don't know what to ask,
            // so it offers questions rather than describing what's possible.
            <View style={styles.empty}>
              <View style={styles.emptyMascot}>
                <Mascot size={64} pose="face" />
              </View>
              <Text style={styles.emptyTitle}>What are we cooking?</Text>
              <Text style={styles.emptyText}>
                Ask about a recipe, an ingredient, or what’s in your pantry.
              </Text>
              <View style={styles.suggestions}>
                {SUGGESTIONS.map((suggestion) => (
                  <TouchableOpacity
                    key={suggestion.text}
                    style={styles.suggestion}
                    activeOpacity={0.75}
                    onPress={() => send(suggestion.text)}
                    disabled={sending}
                    accessibilityRole="button"
                  >
                    <View style={styles.suggestionIcon}>
                      <Ionicons name={suggestion.icon} size={16} color={colors.primaryDark} />
                    </View>
                    <Text style={styles.suggestionText}>{suggestion.text}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          }
          renderItem={({ item }) => {
            const isUser = item.role === 'user';
            return (
              <MessageEnter animate={fresh.has(item.id)}>
                {isUser ? (
                  <View style={styles.userRow}>
                    <View style={styles.userBubble}>
                      <Text style={styles.userText}>{item.content}</Text>
                    </View>
                  </View>
                ) : (
                  // Panzi's side has no bubble — a reply is something to read,
                  // and a box around every paragraph only narrowed it.
                  <View style={styles.assistantRow}>
                    <View style={styles.avatar}>
                      <Mascot size={AVATAR_SIZE * 0.82} pose="face" />
                    </View>
                    {item.recipe ? (
                      <View style={styles.recipeWrap}>
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
                      <Text style={styles.assistantText}>{item.content}</Text>
                    )}
                  </View>
                )}
              </MessageEnter>
            );
          }}
        />
      )}

      {error && <Text style={styles.errorText}>{error}</Text>}

      {/* The composer: one rounded surface holding the text, the pantry-only
          switch and the buttons, rather than three separate strips stacked
          above the keyboard. While the mic is on, the same surface becomes
          the voice bar, so nothing jumps. */}
      <View
        ref={inputBarRef}
        collapsable={false}
        style={[styles.composerDock, { paddingBottom: (keyboardVisible ? 0 : insets.bottom) + space.sm }]}
      >
        <View style={[styles.composer, !composing && styles.composerVoice]}>
          {composing ? (
            <>
              <TextInput
                ref={inputRef}
                style={styles.input}
                value={draft}
                onChangeText={setDraft}
                placeholder="Ask Panzi what to cook…"
                placeholderTextColor={colors.mutedLight}
                multiline
                maxLength={MAX_LENGTH}
                selectionColor={colors.primaryDark}
              />
              <View style={styles.tools}>
                <TouchableOpacity
                  style={[styles.pantryToggle, pantryOnly && styles.pantryToggleOn]}
                  onPress={() => setPantryOnly((prev) => !prev)}
                  activeOpacity={0.8}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: pantryOnly }}
                >
                  <Ionicons
                    name={pantryOnly ? 'basket' : 'basket-outline'}
                    size={14}
                    color={pantryOnly ? colors.onAccent : colors.textSecondary}
                  />
                  <Text style={[styles.pantryToggleText, pantryOnly && styles.pantryToggleTextOn]}>
                    Pantry only
                  </Text>
                </TouchableOpacity>

                <View style={styles.actions}>
                  <TouchableOpacity
                    style={styles.mic}
                    onPress={startVoice}
                    disabled={sending}
                    activeOpacity={0.75}
                    accessibilityRole="button"
                    accessibilityLabel="Speak your question"
                  >
                    <VoiceIcon size={20} color={colors.textDark} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.send, !canSend && styles.sendOff]}
                    onPress={() => send()}
                    disabled={!canSend}
                    activeOpacity={0.85}
                    accessibilityRole="button"
                    accessibilityLabel="Send"
                  >
                    <Ionicons name="arrow-up" size={19} color={colors.onAccent} />
                  </TouchableOpacity>
                </View>
              </View>
            </>
          ) : (
            <VoiceBar
              state={voice.state as 'listening' | 'transcribing'}
              level={voice.level}
              durationMillis={voice.durationMillis}
              onStop={voice.stop}
              onCancel={voice.cancel}
            />
          )}
        </View>
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
    paddingHorizontal: space.md,
    paddingBottom: space.sm,
  },
  headerButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  titleWrap: {
    flex: 1,
    alignItems: 'center',
    marginHorizontal: space.sm,
  },
  title: {
    fontFamily: fonts.display,
    fontWeight: '800',
    fontSize: type.subtitle.fontSize,
    lineHeight: type.subtitle.lineHeight,
    color: colors.primaryDarker,
  },
  titleNote: {
    fontWeight: '700',
    fontSize: type.micro.fontSize,
    lineHeight: type.micro.lineHeight,
    color: colors.primaryDark,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: {
    flexGrow: 1,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    paddingBottom: space.lg,
    gap: space.lg,
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    paddingVertical: space.xxl,
  },
  emptyMascot: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.heroFill,
    marginBottom: space.lg,
  },
  emptyTitle: {
    fontFamily: fonts.display,
    fontWeight: '800',
    fontSize: type.headline.fontSize,
    lineHeight: type.headline.lineHeight,
    color: colors.primaryDarker,
  },
  emptyText: {
    fontWeight: '600',
    fontSize: type.body.fontSize,
    lineHeight: type.body.lineHeight,
    color: colors.textSecondary,
    marginTop: space.xs,
  },
  suggestions: {
    marginTop: space.xl,
    gap: space.sm,
  },
  suggestion: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
    paddingHorizontal: space.md,
    borderRadius: 16,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.borderWarm,
  },
  suggestionIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryLighter,
  },
  suggestionText: {
    flex: 1,
    fontWeight: '700',
    fontSize: type.body.fontSize,
    lineHeight: type.body.lineHeight,
    color: colors.textPrimary,
  },
  userRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingLeft: space.huge,
  },
  userBubble: {
    backgroundColor: colors.primary,
    borderRadius: 22,
    borderBottomRightRadius: 6,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm2,
  },
  userText: {
    fontWeight: '600',
    fontSize: type.body.fontSize,
    lineHeight: 21,
    color: colors.onAccent,
  },
  assistantRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm2,
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.heroFill,
  },
  assistantText: {
    flex: 1,
    // Sits on the avatar's centre line for a one-line reply.
    paddingTop: 4,
    fontWeight: '600',
    fontSize: type.body.fontSize,
    lineHeight: 23,
    color: colors.textPrimary,
  },
  recipeWrap: {
    flex: 1,
  },
  // The list's own `gap` doesn't reach the footer, so the typing bubble
  // takes the same spacing as a message.
  typingRow: {
    marginTop: space.lg,
  },
  errorText: {
    fontWeight: '700',
    fontSize: type.caption.fontSize,
    lineHeight: 17,
    color: colors.rustMuted,
    paddingHorizontal: space.xxl,
    paddingBottom: space.sm,
  },
  composerDock: {
    paddingHorizontal: space.md,
    paddingTop: space.xs,
    backgroundColor: colors.backgroundLight,
  },
  composer: {
    borderRadius: 26,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.borderWarm,
    paddingTop: space.sm,
    paddingBottom: space.sm,
    shadowColor: colors.shadow,
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  composerVoice: {
    paddingTop: space.xs,
    paddingBottom: space.xs,
  },
  input: {
    minHeight: 40,
    maxHeight: 140,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    paddingBottom: space.sm,
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: type.bodyLarge.fontSize,
    color: colors.textPrimary,
  },
  tools: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.sm,
  },
  pantryToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 34,
    paddingHorizontal: space.md,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: colors.borderWarm,
  },
  pantryToggleOn: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  pantryToggleText: {
    fontWeight: '700',
    fontSize: type.caption.fontSize,
    color: colors.textSecondary,
  },
  pantryToggleTextOn: {
    color: colors.onAccent,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  mic: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  send: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  sendOff: {
    backgroundColor: colors.primaryLight,
  },
}));
