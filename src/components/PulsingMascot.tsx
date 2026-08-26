// src/components/PulsingMascot.tsx
//
// The small chat-entry mascot that pulses to invite a tap — an expanding,
// fading ring behind the avatar, looping continuously.
//
// The ring is drawn *outside* the avatar's bounds, so `maxScale` is not a free
// choice: at scale S the ring overflows the avatar by size × (S − 1) / 2 on
// every side. Any container has to have at least that much padding or the ring
// escapes it — which is exactly what happened on the Home card, where a 1.9
// ring on a 44pt avatar reached past the card's 10pt padding and crossed its
// rounded corner. Keep the default conservative and let roomier callers ask
// for more.
//
// Without an onPress, this renders a plain View rather than a TouchableOpacity
// — FloatingChatBubble wraps it in its own react-native-gesture-handler
// GestureDetector, and a TouchableOpacity underneath (even one with no press
// handler of its own) still participates in RN's legacy responder system,
// which can fight a Pan gesture for the same touch.

import React, { useEffect, useRef } from 'react';
import { Animated, Easing, TouchableOpacity, StyleSheet, View } from 'react-native';
import Mascot from './Mascot';
import { makeStyles } from '../theme/makeStyles';
import { useColors } from '../theme/ThemeProvider';

type Props = {
  size?: number;
  /** Ring's peak scale. Needs size × (maxScale − 1) / 2 of clearance around it. */
  maxScale?: number;
  onPress?: () => void;
};

// How much of the avatar circle the character fills, leaving a little breathing
// room inside its own ring rather than butting against the edge.
const ART_INSET = 0.82;

export default function PulsingMascot({ size = 44, maxScale = 1.4, onPress }: Props) {
  const styles = useStyles();
  const colors = useColors();
  const ringScale = useRef(new Animated.Value(1)).current;
  const ringOpacity = useRef(new Animated.Value(0.55)).current;

  useEffect(() => {
    ringScale.setValue(1);
    ringOpacity.setValue(0.55);
    const loop = Animated.loop(
      Animated.parallel([
        Animated.timing(ringScale, {
          toValue: maxScale,
          duration: 1400,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(ringOpacity, {
          toValue: 0,
          duration: 1400,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [ringScale, ringOpacity, maxScale]);

  const content = (
    <>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.ring,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            transform: [{ scale: ringScale }],
            opacity: ringOpacity,
          },
        ]}
      />
      {/* A tinted disc behind the art. The character is drawn on white, so on a
          white card it had no edge of its own and read as a sticker rather than
          an avatar — the same soft green the app uses for chips seats it. */}
      <View
        style={[
          styles.avatar,
          { width: size, height: size, borderRadius: size / 2 },
        ]}
      >
        <Mascot size={size * ART_INSET} pose="face" />
      </View>
    </>
  );

  if (!onPress) {
    return <View style={[styles.wrap, { width: size, height: size }]}>{content}</View>;
  }

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      style={[styles.wrap, { width: size, height: size }]}
    >
      {content}
    </TouchableOpacity>
  );
}

const useStyles = makeStyles((colors) => ({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: colors.primary,
  },
  avatar: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryLighter,
    overflow: 'hidden',
  },
}));