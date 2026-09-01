// src/components/auth/AuthSwipeStack.tsx
//
// SignInScreen and CreateAccountScreen as one interactive stack:
//   - Going forward (tapping "Create account") crossfades Create Account in,
//     slowly and smoothly, with just a faint upward drift alongside the
//     fade — the fade is the main event, the rise is a light accent.
//   - Coming back (the Back button, or "Already have an account? Sign in")
//     plays that same slow crossfade+drift in reverse.
//   - A left-right swipe closes it too, independently of that crossfade:
//     dragging horizontally slides Create Account away with the finger in
//     real time, exactly like iOS's own edge-swipe-to-go-back gesture.
//
// Both screens stay mounted here for as long as either is showing. That is
// what makes the "reveal Sign In underneath while dragging Create Account
// away" effect possible at all: a screen that only exists once you have
// fully arrived can't be peeked at mid-gesture.
//
// Sign In's own mascot entrance is meant to replay every time Sign In
// becomes the active screen again — including coming back from Create
// Account, by tap or by swipe — not just on this whole stack's first mount.
// Since SignInScreen never unmounts for that transition, its own mount
// effect can't be what drives that replay; signInEnteredTick below is the
// signal instead, bumped from both places control can return to Sign In
// (the tap-driven effect and the gesture's onEnd), and combined with the
// enteredTick prop this stack itself receives from AppTransition (which
// covers the arrivals that DO remount this whole stack — cold start,
// sign-out) into the one value SignInScreen actually watches.
//
// The screen not on top is set pointerEvents="none" so its buttons and text
// fields can never be reached mid-drag or while fully hidden underneath.

import React, { useEffect, useRef, useState } from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';
import SignInScreen from '../../screens/SignInScreen';
import CreateAccountScreen from '../../screens/CreateAccountScreen';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// Matches the springs iOS's own push/pop transition uses closely enough to
// read as the same gesture — brisk, a little settle, no visible bounce. Used
// only once a swipe-to-close drag releases and has to settle the rest of the
// way on its own — the swipe itself otherwise just tracks the finger,
// unrelated to the programmatic open/close below.
const SPRING = { damping: 32, stiffness: 260, mass: 0.9 };
// Slow, even crossfade for the tap-triggered open/close (not the swipe).
// Ease-out (not inOut) so it starts moving immediately on tap instead of
// easing in from a standstill first — that initial ramp was what read as
// sluggish rather than smooth.
const RISE_MS = 380;
const RISE_EASING = Easing.out(Easing.cubic);
// Barely-there lift alongside the fade — reads as a gentle rise, not a
// slide. Kept small on purpose: this is a crossfade first.
const RISE_DISTANCE = SCREEN_HEIGHT * 0.05;

type Props = {
  /** Which screen is the one the app's own flow state currently says is
   *  "arrived at" — drives where this settles after any gesture ends, and
   *  after a non-gesture navigation (tapping "Create account", tapping
   *  "Sign in", either link at the bottom). */
  mode: 'signIn' | 'createAccount';
  onSignedIn: () => void;
  onCreateAccount: () => void;
  onSignIn: () => void;
  onGuest: () => void;
  /** Bumps once each time the parent AppTransition's fade-in finishes on
   *  this stack — see the note on this prop's origin in App.tsx. Forwarded
   *  straight to SignInScreen, which uses it (not its own mount) to time its
   *  mascot's slide-in on the paths that go through that fade. */
  enteredTick: number;
};

export default function AuthSwipeStack({
  mode,
  onSignedIn,
  onCreateAccount,
  onSignIn,
  onGuest,
  enteredTick,
}: Props) {
  // Bumped every time control returns to Sign In from within this stack —
  // see the note above. Combined with the enteredTick prop into the single
  // value SignInScreen watches, below.
  const [signInEnteredTick, setSignInEnteredTick] = useState(0);
  function bumpSignInEnteredTick() {
    setSignInEnteredTick((t) => t + 1);
  }

  // Bumped every time control moves FORWARD into Create Account — used as
  // that screen's React `key` below. CreateAccountScreen stays mounted for
  // as long as this whole stack does (see the file header comment on why),
  // which means its own useState fields (email/password/the live-validation
  // touched flags) survive a Back tap untouched — reopening it showed
  // whatever was typed before, red-error borders included, rather than a
  // blank form. Changing `key` forces React to throw the old instance away
  // and mount a brand new one with fresh state, exactly like a real
  // navigation stack popping a screen and pushing a new one rather than
  // reusing the same instance.
  const [createAccountKey, setCreateAccountKey] = useState(0);

  // Vertical entrance progress: 0 = arrived (no offset, fully opaque), 1 =
  // fully departed (resting below the screen, invisible). Only the
  // programmatic open/close (tap "Create account", Back, "Sign in") ever
  // moves this — it does not track the horizontal swipe.
  const rise = useSharedValue(mode === 'signIn' ? 1 : 0);
  const opacity = useSharedValue(mode === 'createAccount' ? 1 : 0);
  // Live horizontal drag offset in pixels, separate from `rise` — the swipe
  // gesture pulls Create Account sideways off the top of the vertical
  // motion rather than substituting for it.
  const dragX = useSharedValue(0);

  const wasMode = useRef(mode);
  useEffect(() => {
    if (wasMode.current === mode) return;
    const goingForward = wasMode.current === 'signIn' && mode === 'createAccount';
    wasMode.current = mode;

    if (goingForward) {
      // Remounts CreateAccountScreen with a blank slate — see the note on
      // createAccountKey above. Bumped here, before the fade-in starts, so
      // the reset happens while the screen is still at opacity 0 and is
      // never visible as a flash of empty fields replacing typed ones.
      setCreateAccountKey((k) => k + 1);
      // Forward: rise up from below while fading in. `dragX` snaps back to
      // 0 here too — a prior swipe-to-close can leave it parked at
      // +/-SCREEN_WIDTH, which must not carry into the next entrance.
      rise.value = 1;
      opacity.value = 0;
      dragX.value = 0;
      rise.value = withTiming(0, { duration: RISE_MS, easing: RISE_EASING });
      opacity.value = withTiming(1, { duration: RISE_MS, easing: RISE_EASING });
      return;
    }

    // Backward via a tap rather than a swipe (Back button, "Sign in" link):
    // same fade+rise motion in reverse. The mascot's replay waits for this
    // to actually finish — bumping signInEnteredTick the instant the tap
    // happens would start the slide-in while Sign In is still fading up
    // from underneath Create Account, the exact "animated before visible"
    // mistake AppTransition's onEntered exists to avoid on the other paths.
    rise.value = withTiming(1, { duration: RISE_MS, easing: RISE_EASING });
    opacity.value = withTiming(0, { duration: RISE_MS, easing: RISE_EASING }, (finished) => {
      if (finished) runOnJS(bumpSignInEnteredTick)();
    });
  }, [mode, rise, opacity, dragX]);

  const swipeGesture = Gesture.Pan()
    .activeOffsetX([-16, 16])
    .failOffsetY([-12, 12])
    .onChange((e) => {
      // Either direction drags Create Account away by the same rule — the
      // request was "swipe left or right", not one specific direction — so
      // the raw offset just follows the finger and gets normalized to
      // progress only at the end.
      dragX.value = e.translationX;
    })
    .onEnd((e) => {
      const progress = Math.abs(dragX.value) / SCREEN_WIDTH + e.velocityX / SCREEN_WIDTH / 4;
      const goToSignIn = Math.abs(progress) > 0.4;
      const target = goToSignIn ? Math.sign(dragX.value || 1) * SCREEN_WIDTH : 0;
      dragX.value = withSpring(target, SPRING, (finished) => {
        if (finished && goToSignIn) {
          runOnJS(onSignIn)();
          runOnJS(bumpSignInEnteredTick)();
        }
      });
      opacity.value = withSpring(goToSignIn ? 0 : 1, SPRING);
    });

  const createAccountStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [
      { translateY: rise.value * RISE_DISTANCE },
      { translateX: dragX.value },
    ],
  }));

  // Sign In sits still underneath — only its z-order (painted first) and a
  // faint darkening while Create Account is dragged over it sell the
  // "revealed from behind" read, the same cue iOS's own transition uses.
  const signInBackdropStyle = useAnimatedStyle(() => ({
    opacity: 0.4 + 0.6 * Math.min(1, Math.abs(dragX.value) / SCREEN_WIDTH + rise.value),
  }));

  return (
    <View style={styles.fill}>
      <Animated.View style={[styles.fill, signInBackdropStyle]} pointerEvents={mode === 'signIn' ? 'auto' : 'none'}>
        <SignInScreen
          onSignedIn={onSignedIn}
          onCreateAccount={onCreateAccount}
          onGuest={onGuest}
          // Either source bumping produces a new sum, which is all
          // SignInScreen's own effect actually checks for (a change from
          // whatever value it first saw) — see its doc comment on this prop.
          enteredTick={enteredTick + signInEnteredTick}
        />
      </Animated.View>
      <GestureDetector gesture={swipeGesture}>
        <Animated.View
          style={[styles.fill, styles.stacked, createAccountStyle]}
          pointerEvents={mode === 'createAccount' ? 'auto' : 'none'}
        >
          <CreateAccountScreen
            key={createAccountKey}
            onCreated={onSignedIn}
            onSignIn={onSignIn}
            onGuest={onGuest}
          />
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  stacked: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
});
