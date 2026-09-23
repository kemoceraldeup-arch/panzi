// src/screens/ChatFlow.tsx
//
// Tapping "Ask Panzi" goes straight into a new conversation — no list to click
// through first. History and "New chat" live in HistoryDrawer, reachable from
// inside the conversation via the hamburger icon, reveal-style the same way
// the ChatGPT/Claude mobile apps do it: HistoryDrawer is a static panel that
// always sits where it sits: what moves is the chat panel itself, sliding
// right, scaling down and growing a shadow to reveal the drawer sitting
// behind it — not a drawer sliding in on top of a motionless chat.
//
// `openAmount` is the one Reanimated value driving the whole reveal — the
// chat panel's translateX/scale/borderRadius and its own dim overlay both
// read it directly, so the two can never drift out of step with each other.
// It lives entirely in this file: HistoryDrawer itself is purely static and
// presentational (see its own header comment) and never touches Reanimated
// at all, since the panel that moves is the chat, not the drawer.
//
// This is the seam MainTabs.tsx talks to: one `visible` flag and onClose, the
// same shape every other flow-level modal in that file already has.

import React, { useEffect, useRef, useState } from 'react';
import {
  BackHandler,
  Keyboard,
  Modal,
  StyleSheet,
  TouchableOpacity,
  useWindowDimensions,
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import { useColors } from '../theme/ThemeProvider';
import ChatScreen from './ChatScreen';
import HistoryDrawer, { MAX_WIDTH, WIDTH_FRACTION } from './HistoryDrawer';
import { PantryItem } from '../services/pantry';
import { Recipe } from '../services/recipes';

// A fixed-duration ease, not a spring — a spring can visibly overshoot its
// target and wobble back before settling even with damping tuned well past
// critical (Reanimated's own simulation stepping still shows a hair of it in
// practice), which is exactly the bounce a drag-to-reveal gesture should
// never have: a finger that's already lifted has nothing left to "spring"
// toward. An ease-out curve settles once and stops, by construction — the
// same snap ChatGPT/Claude's own drawers use.
const SETTLE_DURATION = 220;
const SETTLE_EASING = Easing.out(Easing.cubic);
// How far the chat panel scales down at full reveal — small enough to read
// as "pushed back", not so small the header text and buttons feel cramped.
const OPEN_SCALE = 0.92;
const OPEN_RADIUS = 32;
// How close to the screen's left edge a touch has to start to count as
// opening the drawer, rather than an ordinary gesture on the chat itself
// (scrolling the message list, dragging a slider, anything else that starts
// with a horizontal-ish touch). Only matters while closed — once open, the
// whole panel is fair game for the close gesture, same as the ChatGPT/Claude
// apps.
const EDGE_WIDTH = 20;

type Props = {
  visible: boolean;
  /** The live pantry, so a recipe card's ingredient checklist reflects what's
   *  actually on the shelf right now — see the note on withLiveIngredients in
   *  services/recipes.ts for why the stored message can't be trusted for this. */
  items: PantryItem[];
  onOpenRecipe: (recipe: Recipe) => void;
  onStartCooking: (recipe: Recipe) => void;
  onClose: () => void;
};

export default function ChatFlow({ visible, items, onOpenRecipe, onStartCooking, onClose }: Props) {
  const colors = useColors();
  const { width } = useWindowDimensions();
  const drawerWidth = Math.round(Math.min(width * WIDTH_FRACTION, MAX_WIDTH));

  // id is null until the user actually sends a first message — opening the
  // flow itself no longer asks the server for anything. Tapping "Ask Panzi",
  // looking, and closing without typing used to still create a "New chat"
  // row in History every time; not calling the server at all until there is
  // a real message to send is what actually rules that out; unlike the
  // in-session-reuse approach this replaces, it also covers the app being
  // backgrounded or killed with nothing sent — there is no server row to
  // ever have been abandoned.
  const [open, setOpen] = useState<{ id: string | null; title: string } | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Whether the currently open conversation has no messages yet — reported
  // by ChatScreen. Gates HistoryDrawer's "New chat" button so it can't spawn
  // a second empty conversation while the current one is already unused.
  const [currentIsEmpty, setCurrentIsEmpty] = useState(true);

  // 0 closed (chat panel flat, full width, drawer fully hidden behind it), 1
  // open (chat panel pushed right by drawerWidth, scaled down, drawer fully
  // revealed). Reanimated's own value, not React state — every frame of the
  // drag below reads and writes this directly on the UI thread, which is the
  // difference between tracking a finger exactly and visibly lagging behind
  // it. Kept in sync with `drawerOpen` by the effect below, for the
  // hamburger button and any other React-driven open/close; the gesture
  // itself moves it directly on the UI thread first and only tells React
  // what happened (via `settle`) once the finger lifts.
  const openAmount = useSharedValue(0);

  useEffect(() => {
    openAmount.value = withTiming(drawerOpen ? 1 : 0, { duration: SETTLE_DURATION, easing: SETTLE_EASING });
  }, [drawerOpen, openAmount]);

  // Snaps openAmount to fully open or fully closed and syncs React's
  // `drawerOpen` to match — called from worklet code via runOnJS, since
  // setState can't be touched directly from the UI thread.
  function settle(nextOpen: boolean) {
    openAmount.value = withTiming(nextOpen ? 1 : 0, { duration: SETTLE_DURATION, easing: SETTLE_EASING });
    setDrawerOpen(nextOpen);
  }

  function openDrawer() {
    Keyboard.dismiss();
    setDrawerOpen(true);
  }

  // One gesture, attached to the chat panel — always the topmost thing on
  // screen, whether the drawer is open or closed, so it's the only place a
  // touch can actually land regardless of which direction it's meant to
  // drag. `touchAllowed` is decided once per touch, in onBegin (fires on
  // touch-down, before any movement, with e.x the position at that exact
  // moment) — not re-checked in onChange, where e.x is the touch's CURRENT
  // position and would stop being "near the edge" after the very first frame
  // of a rightward drag, killing the open gesture the instant it started
  // moving. While closed, only a touch starting within EDGE_WIDTH of the
  // left edge is allowed — anywhere else on the chat panel is left alone for
  // ordinary scrolling and taps. While open, the whole panel is fair game,
  // same as the ChatGPT/Claude apps' own drag-anywhere-to-close.
  const touchAllowed = useSharedValue(false);
  const panGesture = Gesture.Pan()
    .activeOffsetX([-10, 10])
    .failOffsetY([-14, 14])
    .onBegin((e) => {
      'worklet';
      touchAllowed.value = openAmount.value > 0 || e.x <= EDGE_WIDTH;
    })
    .onChange((e) => {
      'worklet';
      if (!touchAllowed.value) return;
      openAmount.value = Math.min(1, Math.max(0, openAmount.value + e.changeX / drawerWidth));
    })
    .onEnd((e) => {
      'worklet';
      if (!touchAllowed.value) return;
      const projected = openAmount.value + e.velocityX / drawerWidth / 4;
      runOnJS(settle)(projected > 0.5);
    });

  // Split in two rather than one shared style: the transform belongs on the
  // outer shadow view only — applying it a second time to the inner clip
  // view too would compound it (double the translate, double the scale).
  // The radius has no such problem and genuinely needs to live on both:
  // the outer view's radius is what the shadow itself is drawn from, and
  // the inner view's matching radius is what actually clips ChatScreen's
  // own square, opaque background into a rounded shape — see the JSX
  // comment where both are applied for the full reasoning.
  const panelTransformStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: openAmount.value * drawerWidth },
      { scale: 1 - openAmount.value * (1 - OPEN_SCALE) },
    ],
  }));

  const panelRadiusStyle = useAnimatedStyle(() => ({
    borderRadius: openAmount.value * OPEN_RADIUS,
  }));

  const dimStyle = useAnimatedStyle(() => ({
    opacity: openAmount.value * 0.4,
  }));

  // Android hardware back closes the drawer first, same as any other
  // overlay in the app — only a second press (drawer already closed) leaves
  // the whole chat flow. Only armed while this flow is actually on screen;
  // registering it unconditionally would fight whatever the tab underneath
  // wants back to do once this flow closes.
  const drawerOpenRef = useRef(drawerOpen);
  drawerOpenRef.current = drawerOpen;
  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (drawerOpenRef.current) {
        settle(false);
        return true;
      }
      return false;
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Opens straight into an (as yet unsaved) conversation the moment the flow
  // opens, rather than a list to pick "New chat" from first. This is a
  // purely local placeholder — see the note on `open` above — so there is no
  // server round trip, no loading state, and nothing to fail here.
  useEffect(() => {
    if (!visible || open) return;
    setOpen({ id: null, title: 'New chat' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  function close() {
    onClose();
    // Reset after the modal is gone rather than while it's still visible, so
    // the next open starts fresh instead of flashing the old one first.
    // Nothing to remember across the close: an unsent draft conversation had
    // no server id to begin with, and one with real messages already has its
    // own row in History if the user wants it back via the drawer.
    setTimeout(() => {
      setOpen(null);
      setDrawerOpen(false);
      openAmount.value = 0;
    }, 300);
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={close}>
      {/* RN's Modal renders its content in its own native view hierarchy,
          outside the app's normal tree — the GestureHandlerRootView wrapping
          App.tsx doesn't reach in here, so the gestures below need their own
          root view, nested right inside this Modal. */}
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.backgroundLight }}>
        <SafeAreaProvider initialMetrics={initialWindowMetrics}>
          {open && (
            <>
              {/* Static, underneath — see this file's own header comment.
                  Rendered first so the chat panel below paints on top of it. */}
              <HistoryDrawer
                visible={drawerOpen}
                activeConversationId={open.id}
                currentIsEmpty={currentIsEmpty}
                onOpenConversation={(conversation) => {
                  setOpen({ id: conversation.id, title: conversation.title });
                  settle(false);
                }}
                onNewChat={(conversation) => {
                  setOpen({ id: conversation.id, title: conversation.title });
                  settle(false);
                }}
                onClose={() => settle(false)}
              />

              {/* The chat panel — the thing that actually moves. Shadow lives
                  on this outer Animated.View (a rounded corner needs
                  something outside the clip to cast it from — a shadow is
                  drawn from a view's own frame, not from what's visible
                  after its child clips). The actual visible rounding has to
                  be repeated on the inner clipping View too: ChatScreen's own
                  background is opaque and square, so without overflow:hidden
                  AND a matching borderRadius on the same view doing the
                  clipping, the outer view's radius has nothing to round —
                  it's invisible because the square content underneath still
                  paints corner-to-corner. */}
              <Animated.View style={[styles.panelShadow, panelTransformStyle, panelRadiusStyle]}>
                <GestureDetector gesture={panGesture}>
                  {/* backgroundColor here, not just overflow:hidden — an
                      animated borderRadius (recalculated every frame on the
                      UI thread, not a fixed style value) can leave a
                      hairline of this view's own square edge uncovered
                      right at the curve on some renders. Matching it to
                      ChatScreen's own background means even that hairline
                      reads as the same colour as the content beside it,
                      instead of showing whatever sits behind the whole
                      panel through a stray sliver. */}
                  <Animated.View
                    style={[styles.panelClip, { backgroundColor: colors.backgroundLight }, panelRadiusStyle]}
                  >
                    <ChatScreen
                      conversationId={open.id}
                      title={open.title}
                      items={items}
                      onOpenRecipe={onOpenRecipe}
                      onStartCooking={onStartCooking}
                      onOpenHistory={openDrawer}
                      onClose={close}
                      onEmptyChange={setCurrentIsEmpty}
                      onConversationStarted={(conversation) =>
                        setOpen({ id: conversation.id, title: conversation.title })
                      }
                    />
                    {/* The dim overlay — sits on top of the chat panel, not
                        the drawer, per the reveal design: it's the visible
                        chat that dims to show it's no longer the active
                        surface, while the drawer underneath stays at full
                        brightness. pointerEvents follows drawerOpen (React
                        state) rather than openAmount directly, since a
                        mid-drag partial reveal shouldn't start swallowing
                        taps meant for the chat until the drawer has actually
                        settled open. */}
                    <Animated.View
                      style={[styles.dim, { backgroundColor: colors.textPrimary }, dimStyle]}
                      pointerEvents={drawerOpen ? 'auto' : 'none'}
                    >
                      <TouchableOpacity
                        style={StyleSheet.absoluteFill}
                        activeOpacity={1}
                        onPress={() => settle(false)}
                      />
                    </Animated.View>
                  </Animated.View>
                </GestureDetector>
              </Animated.View>
            </>
          )}
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  panelShadow: {
    flex: 1,
    // Explicitly transparent — Android's `elevation` (its own stand-in for
    // iOS's shadow* props) paints this view with an opaque white background
    // by default the instant elevation is set, which showed as a stray
    // white sliver right where the corner rounds and the square edge of
    // this outer view would otherwise have peeked past the rounded content
    // clipped inside it. iOS never had this problem — its shadow props
    // never implied a background — but the fix has to be explicit here
    // since this style serves both platforms.
    backgroundColor: 'transparent',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    // Tighter than before (was 16) — at the corner's own radius, a blur
    // this wide extended past the rounded curve enough to read as a bright
    // ring right at the edge against the darker dim overlay behind it,
    // which is what looked like a stray white sliver tracing the curve.
    shadowRadius: 8,
    shadowOffset: { width: -4, height: 0 },
    elevation: 16,
  },
  panelClip: {
    flex: 1,
    overflow: 'hidden',
    // backgroundColor is applied inline at the call site (needs `colors`
    // from useColors(), not available to a static StyleSheet) — see the
    // JSX comment there for why it's needed alongside overflow:hidden.
  },
  dim: {
    ...StyleSheet.absoluteFill,
  },
});
