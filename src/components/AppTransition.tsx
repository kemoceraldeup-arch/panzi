// src/components/AppTransition.tsx
//
// Wraps whichever top-level screen is currently showing (per the `flow`
// state in App.tsx) and transitions between screens whenever `transitionKey`
// changes.
//
// This is deliberately a SEQUENTIAL fade+slide — fade/slide the current
// screen out fully, THEN swap in the new screen and fade/slide it in —
// rather than a simultaneous cross-fade. Only one screen is ever mounted at
// a time, so:
//   - there is no "outgoing" layer that can stay interactive/visible behind
//     the new screen (that's what caused Skip to flash the old screen), and
//   - the new screen's content can never paint before its opacity/position
//     is reset (that's what caused the flicker), because it isn't mounted
//     until the fade-out's `start()` callback runs.
// Two Animated.Values (opacity + translateY) drive both halves.

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { makeStyles } from '../theme/makeStyles';
import { useColors } from '../theme/ThemeProvider';

type Props = {
  transitionKey: string;
  /**
   * How long each half takes. The default suits a flow change — onboarding to
   * sign-in — where a beat between screens reads as progress.
   *
   * Tab switching wants roughly half that. A tab is a place the user believes
   * they are already going to, so the animation's job is only to stop the swap
   * being an abrupt cut; anything longer and it becomes a delay they are waiting
   * out. See TAB_DURATION in navigation/MainTabs.
   */
  halfDuration?: number;
  /** How far the screen drifts. Smaller reads as a settle rather than a slide. */
  slideDistance?: number;
  /**
   * Which way the swap is going, on the horizontal axis: 1 for forwards, -1 for
   * back, 0 for neither.
   *
   * Zero keeps the original vertical drift, which is what a change with no
   * direction to it wants — a flow moving on, or the same screen re-keyed with
   * a new filter. A tab switch has a direction, because the tabs are laid out
   * in a row the user can see: moving right along the bar should move the
   * screen right, or the animation is saying something the bar contradicts.
   */
  direction?: number;
  children: React.ReactNode;
};

const HALF_DURATION = 260; // fade/slide out and fade/slide in each take this long
const SLIDE_DISTANCE = 12; // small vertical drift — subtle, not a full slide transition
const EASING = Easing.inOut(Easing.ease);

export default function AppTransition({
  transitionKey,
  halfDuration = HALF_DURATION,
  slideDistance = SLIDE_DISTANCE,
  direction = 0,
  children,
}: Props) {
  const styles = useStyles();
  const colors = useColors();
  const opacity = useRef(new Animated.Value(1)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  const translateX = useRef(new Animated.Value(0)).current;

  // Whichever axis this particular swap travels on. The other one is parked at
  // zero, so a directional swap never carries a leftover vertical offset from
  // the swap before it.
  const latestDirection = useRef(direction);
  latestDirection.current = direction;

  // What's actually rendered right now — swapped inside the fade-out's
  // completion callback, once the screen is fully invisible.
  const [shown, setShown] = useState<{ key: string; node: React.ReactNode }>({
    key: transitionKey,
    node: children,
  });
  const shownKeyRef = useRef(transitionKey);

  // The newest children, whatever render we are on.
  //
  // Needed because the swap happens inside an animation callback that closed
  // over `children` several hundred milliseconds ago. Under App.tsx that was
  // harmless — a flow's children only changed when its key did — but the tab
  // tree re-renders with new props all the time (an Undo toast appearing,
  // a pantry filter clearing) while its key sits still, and a callback holding
  // the stale set would mount a screen with props that had already moved on.
  const latest = useRef(children);
  latest.current = children;

  // True from the start of the fade-out to the end of the fade-in. While it is
  // set, prop updates are deliberately NOT pushed through: doing so mid-fade
  // would swap the outgoing screen for the incoming one early, which is visible
  // as a pop. The catch-up at the end of the fade-in is what stops that
  // deferral turning into a permanently stale screen.
  const animating = useRef(false);

  // Set by the fade-out, read by the layout effect below. It is what makes the
  // fade-in wait for the new screen to actually be on screen: `setShown` is a
  // state update, so the tree it describes has not been committed by the time
  // the next statement runs. Starting the fade-in there raised the opacity of
  // whatever was still committed — the OUTGOING screen — for the frame or two
  // before React caught up, which is visible as the old tab appearing inside
  // the new tab's entrance.
  const pendingEnter = useRef<{ drift: Animated.Value; enter: number } | null>(null);

  useEffect(() => {
    if (transitionKey === shownKeyRef.current) {
      if (!animating.current) setShown({ key: transitionKey, node: children });
      return;
    }

    shownKeyRef.current = transitionKey;
    animating.current = true;

    // Captured once, at the start: the props can move on mid-animation, and
    // the half that mounts the new screen has to leave on the same axis the
    // half that hid the old one arrived on.
    const way = latestDirection.current;
    const drift = way === 0 ? translateY : translateX;
    const other = way === 0 ? translateX : translateY;
    // Forwards means the outgoing screen leaves to the left and the incoming
    // one comes from the right, the way a row of pages moves under a finger.
    const exit = way === 0 ? -slideDistance : -way * slideDistance;
    const enter = way === 0 ? slideDistance : way * slideDistance;
    other.setValue(0);

    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 0,
        duration: halfDuration,
        easing: EASING,
        useNativeDriver: true,
      }),
      Animated.timing(drift, {
        toValue: exit,
        duration: halfDuration,
        easing: EASING,
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (!finished) {
        // Interrupted, so a newer transition owns the animation now and will
        // clear this itself. Releasing it here would let a stale prop update
        // land in the middle of that one.
        return;
      }
      // Hand the second half over to the layout effect. Everything below is
      // deliberately NOT started here — see `pendingEnter`.
      pendingEnter.current = { drift, enter };
      setShown({ key: transitionKey, node: latest.current });
    });
    // `children` is in here so a prop change with an unchanged key still
    // reaches the screen; the guard above is what keeps it from restarting the
    // animation.
    // `direction` is deliberately absent: it is read through a ref at the
    // moment a swap starts, so a late change to it cannot restart or re-aim an
    // animation already running.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transitionKey, children, halfDuration, slideDistance, opacity, translateY, translateX]);

  // The fade-in, run once the swap has been committed. useLayoutEffect rather
  // than useEffect because it fires before the frame is drawn: the new screen
  // is in the tree, still at opacity 0 and still offset, and has not been shown
  // at any other opacity or position first.
  useLayoutEffect(() => {
    const pending = pendingEnter.current;
    if (!pending) return;
    pendingEnter.current = null;

    pending.drift.setValue(pending.enter);
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: halfDuration,
        easing: EASING,
        useNativeDriver: true,
      }),
      Animated.timing(pending.drift, {
        toValue: 0,
        duration: halfDuration,
        easing: EASING,
        useNativeDriver: true,
      }),
    ]).start((end) => {
      if (!end.finished) return;
      animating.current = false;
      // Anything that arrived while the transition was running.
      setShown({ key: shownKeyRef.current, node: latest.current });
    });
  }, [shown, halfDuration, opacity]);

  return (
    // The backdrop is a separate, non-animating view on purpose. Opacity
    // applies to a view's own background as well as its children, so painting
    // it on the animated layer would fade out with everything else — mid-
    // transition the screen hit opacity 0 with nothing opaque behind it and
    // you saw straight through to the native root view, which reads as a
    // black flash. Every screen sits on this same colour, so the dip now
    // passes through the app's own background instead.
    <View style={styles.backdrop}>
      <Animated.View
        style={[styles.screen, { opacity, transform: [{ translateX }, { translateY }] }]}
      >
        {shown.node}
      </Animated.View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  backdrop: {
    flex: 1,
    backgroundColor: colors.backgroundLight,
  },
  screen: {
    flex: 1,
  },
}));