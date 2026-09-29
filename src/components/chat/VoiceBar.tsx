// src/components/chat/VoiceBar.tsx
//
// What the chat's input turns into while the microphone is on. Listening: a
// waveform drawn from the live level, so it's plain the phone is hearing
// you, with ✕ to throw the recording away and ✓ to finish early. Then
// "Transcribing…" while the words come back, before they land in the input.

import React, { useEffect, useRef } from 'react';
import { Animated, Easing, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Text from '../Text';
import { makeStyles } from '../../theme/makeStyles';
import { useColors } from '../../theme/ThemeProvider';
import { space } from '../../theme/spacing';
import { type } from '../../theme/typography';
import { VoiceState } from './useVoiceInput';

const BARS = 28;
const HIT_SLOP = { top: 10, bottom: 10, left: 10, right: 10 };

type Props = {
  state: Exclude<VoiceState, 'idle'>;
  /** 0–1, the live input level. */
  level: number;
  durationMillis: number;
  onStop: () => void;
  onCancel: () => void;
};

function clock(ms: number) {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export default function VoiceBar({ state, level, durationMillis, onStop, onCancel }: Props) {
  const styles = useStyles();
  const colors = useColors();

  // The last few seconds of level, newest on the right, scrolling left as
  // the recording goes — reads as "this is your voice" in a way a single
  // pulsing dot doesn't.
  const history = useRef<number[]>(Array(BARS).fill(0));
  if (state === 'listening') {
    history.current = [...history.current.slice(1), level];
  }

  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(enter, {
      toValue: 1,
      duration: 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [enter]);

  if (state === 'transcribing') {
    return (
      <View style={[styles.bar, styles.transcribing]} accessibilityLiveRegion="polite">
        <TranscribingDots />
        <Text style={styles.transcribingText}>Transcribing…</Text>
      </View>
    );
  }

  return (
    <Animated.View
      style={[
        styles.bar,
        { opacity: enter, transform: [{ scale: enter.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] }) }] },
      ]}
    >
      <TouchableOpacity
        style={styles.cancel}
        onPress={onCancel}
        hitSlop={HIT_SLOP}
        accessibilityRole="button"
        accessibilityLabel="Cancel recording"
      >
        <Ionicons name="close" size={20} color={colors.textSecondary} />
      </TouchableOpacity>

      <View style={styles.middle} accessibilityLabel="Listening">
        <View style={styles.wave}>
          {history.current.map((value, i) => (
            <View
              key={i}
              style={[
                styles.waveBar,
                {
                  height: 4 + value * 22,
                  // Older samples fade toward the left edge.
                  opacity: 0.35 + (0.65 * i) / (BARS - 1),
                },
              ]}
            />
          ))}
        </View>
        <Text style={styles.time}>{clock(durationMillis)}</Text>
      </View>

      <TouchableOpacity
        style={styles.done}
        onPress={onStop}
        hitSlop={HIT_SLOP}
        accessibilityRole="button"
        accessibilityLabel="Stop and transcribe"
      >
        <Ionicons name="checkmark" size={22} color={colors.onAccent} />
      </TouchableOpacity>
    </Animated.View>
  );
}

/** Three dots in a slow wave — the same motion as Panzi's typing bubble, so
 *  "working on it" looks the same wherever it appears. */
function TranscribingDots() {
  const styles = useStyles();
  const dots = useRef([0, 1, 2].map(() => new Animated.Value(0))).current;

  useEffect(() => {
    const loops = dots.map((dot, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 140),
          Animated.timing(dot, { toValue: 1, duration: 300, useNativeDriver: true }),
          Animated.timing(dot, { toValue: 0, duration: 300, useNativeDriver: true }),
          Animated.delay((2 - i) * 140 + 100),
        ])
      )
    );
    loops.forEach((loop) => loop.start());
    return () => loops.forEach((loop) => loop.stop());
  }, [dots]);

  return (
    <View style={styles.dots}>
      {dots.map((dot, i) => (
        <Animated.View
          key={i}
          style={[
            styles.dot,
            {
              opacity: dot.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }),
              transform: [{ translateY: dot.interpolate({ inputRange: [0, 1], outputRange: [0, -4] }) }],
            },
          ]}
        />
      ))}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 56,
    paddingHorizontal: space.sm,
  },
  cancel: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  middle: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  wave: {
    flex: 1,
    height: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  waveBar: {
    width: 3,
    borderRadius: 2,
    backgroundColor: colors.primaryDark,
  },
  time: {
    fontWeight: '700',
    fontSize: type.label.fontSize,
    color: colors.textSecondary,
    fontVariant: ['tabular-nums'],
  },
  done: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  transcribing: {
    justifyContent: 'center',
    gap: space.sm2,
  },
  transcribingText: {
    fontWeight: '700',
    fontSize: type.body.fontSize,
    color: colors.textSecondary,
  },
  dots: {
    flexDirection: 'row',
    gap: 4,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primaryDark,
  },
}));
