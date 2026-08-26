// src/screens/HistoryDrawer.tsx
//
// The panel behind the hamburger icon on a chat screen — "New chat" and every
// past conversation, the same shape as Claude's own sidebar, condensed onto a
// phone as a drawer that slides in from the left rather than a permanent side
// panel. Sits over the active conversation rather than replacing it: closing
// the drawer (tap outside, a row, or dragging it shut) returns to exactly
// where the chat was.
//
// Driven entirely by react-native-gesture-handler + Reanimated, on the UI
// thread — an earlier version used a hand-rolled PanResponder for the
// edge-swipe-to-open gesture on ChatScreen and Animated.timing for the
// drawer's own open/close, and both read as laggy: PanResponder callbacks run
// on the JS thread, so under any load the drawer visibly fell behind the
// finger and took several attempts to register. This owns the whole gesture
// — the edge-swipe that opens it AND the drag that closes it — as one
// GestureDetector, so ChatScreen no longer needs a gesture of its own at all.

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
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
// conversation stays visible as a reminder of what's behind it.
const WIDTH_FRACTION = 0.82;
const ANIM_MS = 220;
// How close to the screen's left edge a swipe has to start to count as
// opening the drawer, rather than an ordinary gesture on the chat behind it.
const EDGE_WIDTH = 24;
// Past this fraction of the drawer's own width, releasing snaps it open
// rather than back closed.
const SNAP_FRACTION = 0.5;

type Props = {
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
  /** Fired when the edge-swipe gesture opens the drawer on its own, so the
   *  parent's `visible` (normally flipped by the hamburger button) stays in
   *  sync with what the gesture already did on the UI thread. Without this,
   *  a swipe-opened drawer looks open but `visible` is still false as far as
   *  React knows — which is what left the history list stuck loading
   *  forever, since the effect that fetches it only fires on `visible`
   *  becoming true. */
  onOpen: () => void;
  onClose: () => void;
};

export default function HistoryDrawer({
  visible,
  activeConversationId,
  currentIsEmpty,
  onOpenConversation,
  onNewChat,
  onOpen,
  onClose,
}: Props) {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const drawerWidth = Math.round(width * WIDTH_FRACTION);

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Always mounted, never unmounted while a conversation is open — the
  // open-from-the-edge gesture below has to be attached to *something* the
  // whole time, including while the drawer is fully closed and invisible.
  // Being closed is openAmount reaching 0 and translating the panel fully
  // off-screen, not the component disappearing.
  //
  // 0 closed, 1 open. Reanimated's own value, not React state — every frame
  // of the drag reads and writes this directly on the UI thread, which is
  // the difference between tracking a finger exactly and visibly lagging
  // behind it.
  const openAmount = useSharedValue(visible ? 1 : 0);

  useEffect(() => {
    openAmount.value = withTiming(visible ? 1 : 0, { duration: ANIM_MS });
  }, [visible, openAmount]);

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

  // Snaps openAmount to fully open or fully closed and tells React which —
  // called from worklet code via runOnJS, since setState (and the onOpen /
  // onClose callbacks that eventually reach it) can't be touched directly
  // from the UI thread. Skipped when the gesture merely confirms the state
  // React already has (releasing a swipe-to-open drag while `visible` is
  // already true) — calling onOpen again there would be harmless but is
  // needless churn on the parent.
  function settle(open: boolean) {
    openAmount.value = withTiming(open ? 1 : 0, { duration: ANIM_MS });
    if (open && !visible) onOpen();
    else if (!open && visible) onClose();
  }

  // Shared drag math for both gestures below — how far a change in screen
  // pixels moves the drawer as a fraction of its own width, clamped so it can
  // never overshoot past fully open or fully closed.
  function applyDrag(changeX: number) {
    'worklet';
    openAmount.value = Math.min(1, Math.max(0, openAmount.value + changeX / drawerWidth));
  }
  function releaseDrag(velocityX: number) {
    'worklet';
    const projected = openAmount.value + velocityX / drawerWidth / 4;
    runOnJS(settle)(projected > SNAP_FRACTION);
  }

  // Opens the drawer — attached only to the thin edge strip below, which
  // stays mounted and touchable even while the drawer itself is translated
  // fully off-screen. This is the gesture an edge-swipe from the chat
  // actually hits.
  const openGesture = Gesture.Pan()
    .activeOffsetX([-10, 10])
    .failOffsetY([-14, 14])
    .onChange((e) => applyDrag(e.changeX))
    .onEnd((e) => releaseDrag(e.velocityX));

  // Closes the drawer — attached to the drawer panel itself, so it is only
  // ever reachable while at least part of the drawer is on screen to drag.
  const closeGesture = Gesture.Pan()
    .activeOffsetX([-10, 10])
    .failOffsetY([-14, 14])
    .onChange((e) => applyDrag(e.changeX))
    .onEnd((e) => releaseDrag(e.velocityX));

  const drawerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: (openAmount.value - 1) * drawerWidth }],
  }));

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: openAmount.value,
  }));

  return (
    <View style={styles.overlay} pointerEvents="box-none">
      {/* The edge strip: present at all times, whether the drawer is open or
          closed, so a swipe starting near the screen edge always has
          something to land on. Sized to EDGE_WIDTH rather than the whole
          screen so it never intercepts ordinary taps and scrolls elsewhere
          in the chat. */}
      <GestureDetector gesture={openGesture}>
        <View style={styles.edgeStrip} pointerEvents={visible ? 'none' : 'auto'} />
      </GestureDetector>

      <TouchableOpacity
        style={[StyleSheet.absoluteFillObject, { pointerEvents: visible ? 'auto' : 'none' }]}
        activeOpacity={1}
        onPress={onClose}
      />
      <Animated.View style={[styles.backdrop, backdropStyle]} pointerEvents="none" />

      <GestureDetector gesture={closeGesture}>
        <Animated.View
          style={[
            styles.drawer,
            { width: drawerWidth, paddingTop: insets.top + space.sm },
            drawerStyle,
          ]}
        >
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

          <Text style={styles.eyebrow}>HISTORY</Text>

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
            <FlatList
              data={conversations}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.list}
              ListEmptyComponent={
                <View style={styles.empty}>
                  <Text style={styles.emptyText}>No past chats yet.</Text>
                </View>
              }
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
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  overlay: {
    ...StyleSheet.absoluteFillObject,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(23,23,15,0.4)',
  },
  edgeStrip: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: EDGE_WIDTH,
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
  eyebrow: {
    fontWeight: '800',
    fontSize: type.micro.fontSize,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: colors.tabInactive,
    marginHorizontal: space.lg,
    marginBottom: space.sm,
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
