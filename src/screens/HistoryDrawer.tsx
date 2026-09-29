// src/screens/HistoryDrawer.tsx
//
// The panel behind the hamburger icon on a chat screen — "New chat" and every
// past conversation, the same shape as Claude's own sidebar. Reveal style,
// like the ChatGPT/Claude mobile apps: this panel is static, sitting where it
// always sits underneath the chat. Opening the drawer does not move it or
// slide it in — it is ChatFlow's own wrapper around ChatScreen that slides
// right, scales down and grows a shadow to reveal this panel sitting behind
// it. See ChatFlow.tsx for that half of the animation and for `openAmount`,
// the single Reanimated value shared by both.
//
// Driven entirely by react-native-gesture-handler + Reanimated, on the UI
// thread — an earlier version used a hand-rolled PanResponder for the
// edge-swipe-to-open gesture on ChatScreen and Animated.timing for the
// drawer's own open/close, and both read as laggy: PanResponder callbacks run
// on the JS thread, so under any load the drawer visibly fell behind the
// finger and took several attempts to register.
//
// Purely static and presentational — no gesture of its own. Both the
// edge-swipe-to-open and the drag-to-close gestures live on ChatFlow's
// chat-panel wrapper instead, as one Gesture.Pan(): that panel is always the
// topmost thing on screen (it fully covers this drawer while closed), so a
// gesture attached here would never actually receive a touch that starts
// anywhere on screen — the panel above it would catch it first.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  SectionList,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Text from '../components/Text';
import PulsingMascot from '../components/PulsingMascot';
import ConversationRow from '../components/chat/ConversationRow';
import ConversationMenu, {
  ConversationAction,
  RowAnchor,
} from '../components/chat/ConversationMenu';
import RenameDialog from '../components/chat/RenameDialog';
import MenuIcon from '../components/chat/MenuIcons';
import { forgetPreview } from '../components/chat/ConversationPreview';
import ArchivedChatsScreen from './ArchivedChatsScreen';
import { fonts, type } from '../theme/typography';
import { PantryItem } from '../services/pantry';
import { currentAttention } from '../services/notifications';
import { makeStyles } from '../theme/makeStyles';
import { useColors } from '../theme/ThemeProvider';
import { space } from '../theme/spacing';
import {
  ChatError,
  Conversation,
  createConversation,
  deleteConversation,
  fetchConversations,
  updateConversation,
} from '../services/chat';

// Claude's own sidebar reads as roughly four-fifths of a phone width, wide
// enough for a title to breathe, narrow enough that a sliver of the
// conversation stays visible as a reminder of what's behind it. Capped so a
// tablet-width screen doesn't stretch it into something absurdly wide.
export const WIDTH_FRACTION = 0.8;
export const MAX_WIDTH = 320;

type Props = {
  /** Only ever read here to know when to (re)load the conversation list —
   *  the open/close animation itself is entirely ChatFlow's (openAmount,
   *  the chat panel's transform, the dim overlay); this component has no
   *  Reanimated code of its own. */
  visible: boolean;
  /** The conversation currently open behind the drawer, highlighted in the
   *  list — null right after "New chat" is tapped from Home, before a
   *  conversation exists to highlight. */
  activeConversationId: string | null;
  /** True while the open conversation has no messages yet. "New chat" then
   *  just closes the drawer onto it — starting another empty conversation on top of one that's
   *  already empty would just leave a second, indistinguishable "New chat"
   *  row sitting in history for no reason. */
  currentIsEmpty: boolean;
  onOpenConversation: (conversation: Conversation) => void;
  onNewChat: (conversation: Conversation) => void;
  /** A chat was renamed, pinned or archived — lets ChatFlow keep the open
   *  chat's header title in step with a rename made from here. */
  onConversationChanged: (conversation: Conversation) => void;
  /** A chat was deleted or archived out of the list. If it was the one open,
   *  ChatFlow moves to a fresh chat rather than leave it on screen. */
  onConversationRemoved: (id: string) => void;
  /** The live pantry — the header lists what in it is going off soon. */
  items: PantryItem[];
  /** An ingredient chip was tapped: start a new chat with this question
   *  already typed, for the user to send or edit. */
  onAskAbout: (prompt: string) => void;
  onClose: () => void;
};

const HIT_SLOP = { top: 12, bottom: 12, left: 12, right: 12 };
/** Two rows of chips at most; the rest of the pantry lives on its own tab. */
const MAX_CHIPS = 4;


/** Buckets conversations the same way ChatGPT's own history does — most
 *  recent activity first within each bucket, since `conversations` already
 *  arrives sorted by `updatedAt` descending from the server. */
function groupByRecency(all: Conversation[]): { title: string; data: Conversation[] }[] {
  // Pinned sit above every date bucket, whenever they were last touched.
  // Archived chats never arrive here — they have their own screen.
  const pinned = all.filter((c) => c.pinned);
  const conversations = all.filter((c) => !c.pinned);

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;
  const startOfWeek = startOfToday - 7 * 24 * 60 * 60 * 1000;

  const today: Conversation[] = [];
  const yesterday: Conversation[] = [];
  const previous7Days: Conversation[] = [];
  const older: Conversation[] = [];

  for (const conversation of conversations) {
    if (conversation.updatedAt >= startOfToday) today.push(conversation);
    else if (conversation.updatedAt >= startOfYesterday) yesterday.push(conversation);
    else if (conversation.updatedAt >= startOfWeek) previous7Days.push(conversation);
    else older.push(conversation);
  }

  const sections: { title: string; data: Conversation[] }[] = [
    { title: 'Pinned', data: pinned },
    { title: 'Today', data: today },
    { title: 'Yesterday', data: yesterday },
    { title: 'Previous 7 Days', data: previous7Days },
    { title: 'Older', data: older },
  ];
  return sections.filter((section) => section.data.length > 0);
}

export default function HistoryDrawer({
  visible,
  activeConversationId,
  currentIsEmpty,
  onOpenConversation,
  onNewChat,
  onConversationChanged,
  onConversationRemoved,
  items,
  onAskAbout,
  onClose,
}: Props) {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const drawerWidth = Math.round(Math.min(width * WIDTH_FRACTION, MAX_WIDTH));

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [query, setQuery] = useState('');
  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    return groupByRecency(
      q ? conversations.filter((c) => c.title.toLowerCase().includes(q)) : conversations
    );
  }, [conversations, query]);

  // Today's first, then tomorrow's. Already-expired items are left out: this
  // is a prompt to cook something, and those are for the bin, not a recipe.
  const soon = useMemo(() => {
    const attention = currentAttention(items);
    const seen = new Set<string>();
    return [
      ...attention.today.map((item) => ({ name: item.name, today: true })),
      ...attention.tomorrow.map((item) => ({ name: item.name, today: false })),
    ].filter((item) => {
      const key = item.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [items]);
  // The chat whose menu is open, and where its row is on screen.
  const [menu, setMenu] = useState<{ conversation: Conversation; anchor: RowAnchor } | null>(null);
  const [renaming, setRenaming] = useState<Conversation | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchConversations()
      .then(setConversations)
      .catch((err) => setError(err instanceof ChatError ? err.message : 'Could not load your chats.'))
      .finally(() => setLoading(false));
  }, []);

  // Reloaded every time the drawer opens, not just on first mount — a chat
  // just finished should show up at the top with whatever title it settled
  // on, and a chat deleted from elsewhere shouldn't still be listed.
  useEffect(() => {
    if (visible) load();
    // A search left typed in last time would hide chats the next time the
    // drawer opens, with nothing on screen saying why.
    else setQuery('');
  }, [visible, load]);

  async function startNew() {
    if (creating) return;
    // Already in a chat with nothing in it — that is the new chat. Close the
    // drawer onto it rather than leave a second, identical empty row behind.
    if (currentIsEmpty) {
      onClose();
      return;
    }
    setCreating(true);
    try {
      const conversation = await createConversation();
      onNewChat(conversation);
    } catch (err) {
      Alert.alert('Could not start a new chat', err instanceof ChatError ? err.message : 'Try again.');
    } finally {
      setCreating(false);
    }
  }

  function confirmDelete(conversation: Conversation) {
    Alert.alert('Delete this chat?', `"${conversation.title}" will be gone for good.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const previous = conversations;
          setConversations((prev) => prev.filter((c) => c.id !== conversation.id));
          onConversationRemoved(conversation.id);
          forgetPreview(conversation.id);
          try {
            await deleteConversation(conversation.id);
          } catch {
            setConversations(previous);
            Alert.alert('That didn’t delete', 'Check your connection and try again.');
          }
        },
      },
    ]);
  }

  /** Applied locally first, the same as delete — a pin that waits on the
   *  network feels like a tap that missed — and rolled back if it fails. */
  async function applyChange(
    conversation: Conversation,
    changes: { title?: string; pinned?: boolean; archived?: boolean }
  ) {
    const previous = conversations;
    const next: Conversation = { ...conversation, ...changes };
    // Archiving moves it out of this list and over to Archived chats.
    setConversations((prev) =>
      changes.archived
        ? prev.filter((c) => c.id !== conversation.id)
        : prev.map((c) => (c.id === conversation.id ? next : c))
    );
    if (changes.archived) onConversationRemoved(conversation.id);
    else onConversationChanged(next);
    try {
      const saved = await updateConversation(conversation.id, changes);
      if (!saved.archived) {
        setConversations((prev) => prev.map((c) => (c.id === saved.id ? saved : c)));
      }
    } catch (err) {
      setConversations(previous);
      if (!changes.archived) onConversationChanged(conversation);
      Alert.alert('That didn’t save', err instanceof ChatError ? err.message : 'Try again.');
    }
  }

  function handleAction(action: ConversationAction, conversation: Conversation) {
    if (action === 'pin') applyChange(conversation, { pinned: !conversation.pinned });
    else if (action === 'rename') setRenaming(conversation);
    else if (action === 'archive') applyChange(conversation, { archived: true });
    else confirmDelete(conversation);
  }

  return (
    <View style={styles.overlay} pointerEvents="box-none">
      {/* Static — no transform of its own. This panel always sits exactly
          here; it is ChatFlow's chat-panel wrapper sliding right that
          reveals it, not this view moving to meet the chat. */}
      <View style={[styles.drawer, { width: drawerWidth, paddingTop: insets.top + space.sm }]}>
        {/* The kitchen end of the drawer: Panzi, and what in the pantry needs
            eating. Tapping an ingredient starts a chat already asking about
            it — the question most people open this to ask. */}
        <View style={styles.hero}>
          <View style={styles.heroTop}>
            <View style={styles.heroMascot}>
              <PulsingMascot size={40} maxScale={1.2} />
            </View>
            <View style={styles.heroText}>
              <Text style={styles.heroTitle}>Ask Panzi</Text>
              <Text style={styles.heroLine} numberOfLines={2}>
                {soon.length > 0
                  ? soon.length === 1
                    ? '1 thing is going off soon'
                    : `${soon.length} things are going off soon`
                  : 'Nothing is close to going off.'}
              </Text>
            </View>
          </View>
          {soon.length > 0 && (
            <View style={styles.chips}>
              {soon.slice(0, MAX_CHIPS).map((item) => (
                <TouchableOpacity
                  key={item.name}
                  style={styles.chip}
                  activeOpacity={0.75}
                  onPress={() => onAskAbout(`What can I make with ${item.name.toLowerCase()}?`)}
                  accessibilityRole="button"
                  accessibilityLabel={`Ask what to make with ${item.name}`}
                >
                  <View
                    style={[
                      styles.chipDot,
                      { backgroundColor: item.today ? colors.accent : colors.warning },
                    ]}
                  />
                  <Text style={styles.chipText} numberOfLines={1}>
                    {item.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        <TouchableOpacity
          style={styles.newChat}
          onPress={startNew}
          disabled={creating}
          activeOpacity={0.85}
          accessibilityRole="button"
        >
          {creating ? (
            <ActivityIndicator size="small" color={colors.onAccent} />
          ) : (
            <Ionicons name="add" size={20} color={colors.onAccent} />
          )}
          <Text style={styles.newChatText}>New chat</Text>
        </TouchableOpacity>

        <View style={styles.search}>
          <Ionicons name="search" size={16} color={colors.mutedLight} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Search chats"
            placeholderTextColor={colors.mutedLight}
            selectionColor={colors.primaryDark}
            returnKeyType="search"
            autoCorrect={false}
          />
          {query.length > 0 && (
            <TouchableOpacity
              onPress={() => setQuery('')}
              hitSlop={HIT_SLOP}
              accessibilityLabel="Clear search"
            >
              <Ionicons name="close-circle" size={16} color={colors.mutedLight} />
            </TouchableOpacity>
          )}
        </View>

        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : error ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>{error}</Text>
            <TouchableOpacity onPress={load} style={styles.retryButton}>
              <Text style={styles.retryText}>Try again</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <SectionList
            sections={sections}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            stickySectionHeadersEnabled={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            ListEmptyComponent={
              <View style={styles.empty}>
                <Text style={styles.emptyText}>
                  {query.trim()
                    ? `No chats called “${query.trim()}”.`
                    : 'Your chats with Panzi will be listed here.'}
                </Text>
              </View>
            }
            renderSectionHeader={({ section }) => (
              <Text style={styles.sectionHeader}>{section.title}</Text>
            )}
            renderItem={({ item }) => (
              <ConversationRow
                conversation={item}
                active={item.id === activeConversationId}
                held={menu?.conversation.id === item.id}
                onPress={() => onOpenConversation(item)}
                onLongPress={(anchor) => setMenu({ conversation: item, anchor })}
              />
            )}
          />
        )}

        {/* Where archived chats are kept — at the foot of the drawer, the same
            place the ChatGPT app keeps its own. */}
        <TouchableOpacity
          style={[styles.archivedRow, { marginBottom: insets.bottom + space.sm }]}
          onPress={() => setArchiveOpen(true)}
          accessibilityRole="button"
        >
          <MenuIcon name="archive" size={19} color={colors.textSecondary} />
          <Text style={styles.archivedRowText}>Archived chats</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.chevron} />
        </TouchableOpacity>
      </View>

      <ArchivedChatsScreen
        visible={archiveOpen}
        onOpenConversation={(conversation) => {
          setArchiveOpen(false);
          onOpenConversation(conversation);
        }}
        onChanged={load}
        onConversationRemoved={onConversationRemoved}
        onClose={() => setArchiveOpen(false)}
      />

      <ConversationMenu
        conversation={menu?.conversation ?? null}
        anchor={menu?.anchor ?? null}
        onSelect={handleAction}
        onOpen={onOpenConversation}
        onClose={() => setMenu(null)}
      />
      <RenameDialog
        initialTitle={renaming?.title ?? null}
        onSubmit={(title) => renaming && applyChange(renaming, { title })}
        onClose={() => setRenaming(null)}
      />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  overlay: {
    ...StyleSheet.absoluteFill,
  },
  drawer: {
    height: '100%',
    backgroundColor: colors.backgroundLight,
  },
  // The one piece of colour in the drawer. The same mint as Profile's hero,
  // so it reads as Panzi's own corner of the app rather than a new card style.
  hero: {
    marginHorizontal: space.md,
    marginBottom: space.md,
    padding: space.lg,
    borderRadius: 24,
    backgroundColor: colors.heroFill,
    gap: space.md,
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  heroMascot: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.avatarFill,
  },
  heroText: {
    flex: 1,
  },
  heroTitle: {
    fontFamily: fonts.display,
    fontWeight: '800',
    fontSize: type.title.fontSize,
    lineHeight: type.title.lineHeight,
    color: colors.primaryDarker,
  },
  heroLine: {
    fontWeight: '700',
    fontSize: type.label.fontSize,
    lineHeight: type.label.lineHeight,
    color: colors.textDark,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.xs2,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs2,
    maxWidth: '100%',
    height: 32,
    paddingHorizontal: space.md,
    borderRadius: 16,
    backgroundColor: colors.card,
  },
  chipDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  chipText: {
    flexShrink: 1,
    fontWeight: '800',
    fontSize: type.label.fontSize,
    color: colors.primaryDarker,
  },
  newChat: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    height: 48,
    marginHorizontal: space.md,
    borderRadius: 16,
    backgroundColor: colors.primary,
  },
  newChatText: {
    fontWeight: '800',
    fontSize: type.bodyLarge.fontSize,
    color: colors.onAccent,
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    height: 40,
    marginHorizontal: space.md,
    marginTop: space.sm2,
    paddingHorizontal: space.md,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderWarm,
  },
  searchInput: {
    flex: 1,
    height: '100%',
    paddingVertical: 0,
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: type.bodySmall.fontSize,
    color: colors.textPrimary,
  },
  sectionHeader: {
    fontFamily: fonts.display,
    fontWeight: '700',
    fontSize: type.bodySmall.fontSize,
    color: colors.tabInactive,
    paddingHorizontal: space.md,
    marginTop: space.lg,
    marginBottom: space.xs,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: {
    flexGrow: 1,
    paddingHorizontal: space.sm,
    paddingBottom: space.md,
  },
  empty: {
    paddingTop: space.xxl,
    paddingHorizontal: space.lg,
    alignItems: 'center',
    gap: space.md,
  },
  emptyText: {
    textAlign: 'center',
    fontWeight: '600',
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight,
    color: colors.textSecondary,
  },
  retryButton: {
    height: 36,
    paddingHorizontal: space.lg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryText: {
    fontWeight: '700',
    fontSize: type.caption.fontSize,
    color: colors.textSecondary,
  },
  archivedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    // Pinned to the bottom even when the list above is short or showing an error.
    marginTop: 'auto',
    marginHorizontal: space.sm,
    paddingVertical: space.md,
    paddingHorizontal: space.md,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  archivedRowText: {
    flex: 1,
    fontWeight: '700',
    fontSize: type.body.fontSize,
    color: colors.textSecondary,
  },
}));
