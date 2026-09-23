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
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Text from '../components/Text';
import PulsingMascot from '../components/PulsingMascot';
import ConversationRow from '../components/chat/ConversationRow';
import { fonts, type } from '../theme/typography';
import { makeStyles } from '../theme/makeStyles';
import { useColors } from '../theme/ThemeProvider';
import { space } from '../theme/spacing';
import {
  ChatError,
  Conversation,
  createConversation,
  deleteConversation,
  fetchConversations,
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
  /** True while the open conversation has no messages yet. Disables "New
   *  chat" — starting another empty conversation on top of one that's
   *  already empty would just leave a second, indistinguishable "New chat"
   *  row sitting in history for no reason. */
  currentIsEmpty: boolean;
  onOpenConversation: (conversation: Conversation) => void;
  onNewChat: (conversation: Conversation) => void;
  onClose: () => void;
};

/** Buckets conversations the same way ChatGPT's own history does — most
 *  recent activity first within each bucket, since `conversations` already
 *  arrives sorted by `updatedAt` descending from the server. */
function groupByRecency(conversations: Conversation[]): { title: string; data: Conversation[] }[] {
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

  return [
    { title: 'Today', data: today },
    { title: 'Yesterday', data: yesterday },
    { title: 'Previous 7 Days', data: previous7Days },
    { title: 'Older', data: older },
  ].filter((section) => section.data.length > 0);
}

export default function HistoryDrawer({
  visible,
  activeConversationId,
  currentIsEmpty,
  onOpenConversation,
  onNewChat,
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
  const sections = useMemo(() => groupByRecency(conversations), [conversations]);

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
  }, [visible, load]);

  async function startNew() {
    if (creating || currentIsEmpty) return;
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

  return (
    <View style={styles.overlay} pointerEvents="box-none">
      {/* Static — no transform of its own. This panel always sits exactly
          here; it is ChatFlow's chat-panel wrapper sliding right that
          reveals it, not this view moving to meet the chat. */}
      <View style={[styles.drawer, { width: drawerWidth, paddingTop: insets.top + space.sm }]}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <PulsingMascot size={30} maxScale={1.3} />
            <Text style={styles.headerTitle}>Ask Panzi</Text>
          </View>
        </View>

        <TouchableOpacity
          style={[styles.newChatRow, currentIsEmpty && styles.newChatRowDisabled]}
          onPress={startNew}
          disabled={creating || currentIsEmpty}
        >
          <View style={[styles.newChatIcon, currentIsEmpty && styles.newChatIconDisabled]}>
            {creating ? (
              <ActivityIndicator size="small" color={colors.onAccent} />
            ) : (
              <Ionicons name="add" size={18} color={colors.onAccent} />
            )}
          </View>
          <Text style={[styles.newChatText, currentIsEmpty && styles.newChatTextDisabled]}>
            New chat
          </Text>
        </TouchableOpacity>

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
            ListEmptyComponent={
              <View style={styles.empty}>
                <Text style={styles.emptyText}>No past chats yet.</Text>
              </View>
            }
            renderSectionHeader={({ section }) => (
              <Text style={styles.sectionHeader}>{section.title.toUpperCase()}</Text>
            )}
            renderItem={({ item }) => (
              <ConversationRow
                conversation={item}
                active={item.id === activeConversationId}
                onPress={() => onOpenConversation(item)}
                onDelete={() => confirmDelete(item)}
              />
            )}
          />
        )}
      </View>
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
    borderRightWidth: 1,
    borderRightColor: colors.backgroundAlt,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingBottom: space.md,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm2,
  },
  headerTitle: {
    fontFamily: fonts.display,
    fontWeight: '800',
    fontSize: type.subtitle.fontSize,
    color: colors.primaryDarker,
  },
  newChatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginHorizontal: space.lg,
    marginBottom: space.md,
    padding: space.sm2,
    borderRadius: 14,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
  },
  newChatRowDisabled: {
    opacity: 0.5,
  },
  newChatIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  newChatIconDisabled: {
    backgroundColor: colors.mutedLight,
  },
  newChatText: {
    fontWeight: '800',
    fontSize: type.body.fontSize,
    color: colors.primaryDarker,
  },
  newChatTextDisabled: {
    color: colors.textMuted,
  },
  sectionHeader: {
    fontWeight: '800',
    fontSize: type.micro.fontSize,
    letterSpacing: 1.2,
    color: colors.tabInactive,
    marginHorizontal: space.lg,
    marginTop: space.md,
    marginBottom: space.sm,
    backgroundColor: colors.backgroundLight,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: {
    flexGrow: 1,
    paddingHorizontal: space.lg,
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
}));
