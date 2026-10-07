// src/components/chat/TypingIndicator.tsx
//
// Panzi's reply-in-progress: three dots bobbing in a bubble of Panzi's own
// shape, sat where the reply is about to land, so the answer replaces it in
// place rather than appearing somewhere a spinner wasn't.

import React, { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';
import { makeStyles } from '../../theme/makeStyles';
import { space } from '../../theme/spacing';

const DOT = 7;
const STAGGER = 150;
const BOB = 320;

export default function TypingIndicator() {
  const styles = useStyles();
  const dots = useRef([0, 1, 2].map(() => new Animated.Value(0))).current;
  const enter = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(enter, {
      toValue: 1,
      duration: 200,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

    // Each dot rises and falls, then waits out the other two, so the three
    // read as one wave travelling left to right rather than three blinkers.
    const loops = dots.map((dot, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * STAGGER),
          Animated.timing(dot, {
            toValue: 1,
            duration: BOB,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(dot, {
            toValue: 0,
            duration: BOB,
            easing: Easing.in(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.delay((dots.length - 1 - i) * STAGGER + 120),
        ])
      )
    );
    loops.forEach((loop) => loop.start());
    return () => loops.forEach((loop) => loop.stop());
  }, [dots, enter]);

  return (
    <Animated.View
      style={[
        styles.bubble,
        {
          opacity: enter,
          transform: [
            { translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) },
            { scale: enter.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) },
          ],
        },
      ]}
      accessibilityLabel="Panzi is typing"
    >
      {dots.map((dot, i) => (
        <Animated.View
          key={i}
          style={[
            styles.dot,
            {
              opacity: dot.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }),
              transform: [{ translateY: dot.interpolate({ inputRange: [0, 1], outputRange: [0, -5] }) }],
            },
          ]}
        />
      ))}
    </Animated.View>
  );
}

const useStyles = makeStyles((colors) => ({
  bubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 40,
    paddingHorizontal: space.md2,
    borderRadius: 18,
    borderBottomLeftRadius: 4,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
  },
  dot: {
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    backgroundColor: colors.primaryDark,
  },
}));

/** Fades and lifts a message into place the first time it mounts — used for
 *  the turns sent and received while the screen is open, never for history,
 *  which should simply be there when a conversation opens. */
export function MessageEnter({ animate, children }: { animate: boolean; children: React.ReactNode }) {
  const progress = useRef(new Animated.Value(animate ? 0 : 1)).current;

  useEffect(() => {
    if (!animate) return;
    Animated.timing(progress, {
      toValue: 1,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [animate, progress]);

  return (
    <Animated.View
      style={{
        opacity: progress,
        transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
      }}
    >
      {children}
    </Animated.View>
  );
}
