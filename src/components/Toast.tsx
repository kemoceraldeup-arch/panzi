// src/components/Toast.tsx
//
// The "4 items added · Undo" confirmation the scan flow shows on the screen
// behind it once a batch lands.
//
// The scan handoff refers to "the same toast component as the List screen" —
// which didn't exist, so this is it. Built to the app's token set rather than
// invented styling, so the List screen can adopt it for its own delete/move
// confirmations without a redesign.
//
// Undo is the whole point: a scan writes several items at once off the back of
// a guess, so the batch has to be reversible in one tap for as long as the
// toast is up.

import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, TouchableOpacity, Easing } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Text from './Text';
import { makeStyles } from '../theme/makeStyles';
import { useColors } from '../theme/ThemeProvider';
import { space } from '../theme/spacing';
import { type } from '../theme/typography';

// Long enough to read and act on, short enough not to sit over the content.
export const TOAST_DURATION = 5000;

type Props = {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss: () => void;
  /** Lifts the toast clear of the tab bar. */
  bottomOffset?: number;
};

export default function Toast({
  message,
  actionLabel,
  onAction,
  onDismiss,
  bottomOffset = 0,
}: Props) {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const anim = useRef(new Animated.Value(0)).current;

  // Held in a ref so the timer isn't restarted every time the parent
  // re-renders with a new callback identity — a toast that keeps resetting its
  // own countdown never goes away.
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: 1,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

    const timer = setTimeout(() => dismissRef.current(), TOAST_DURATION);
    return () => clearTimeout(timer);
  }, [anim]);

  return (
    <Animated.View
      style={[
        styles.wrap,
        { bottom: bottomOffset + insets.bottom + 12 },
        {
          opacity: anim,
          transform: [
            { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) },
          ],
        },
      ]}
      // box-none so the toast doesn't swallow taps on the content it floats
      // over — only the pill itself is interactive.
      pointerEvents="box-none"
    >
      <Animated.View style={styles.toast}>
        <Text style={styles.message} numberOfLines={1}>
          {message}
        </Text>
        {actionLabel && onAction && (
          <TouchableOpacity onPress={onAction} hitSlop={HIT_SLOP} activeOpacity={0.7}>
            <Text style={styles.action}>{actionLabel}</Text>
          </TouchableOpacity>
        )}
      </Animated.View>
    </Animated.View>
  );
}

const HIT_SLOP = { top: 12, bottom: 12, left: 12, right: 12 };

const useStyles = makeStyles((colors) => ({
  wrap: {
    position: 'absolute',
    left: 14,
    right: 14,
    alignItems: 'center',
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.lg,
    maxWidth: '100%',
    paddingVertical: space.md2,
    paddingHorizontal: space.lg2,
    borderRadius: 18,
    backgroundColor: colors.inkFill,
    shadowColor: colors.shadow,
    shadowOpacity: 0.28,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  message: {
    flexShrink: 1,
    fontWeight: '700',
    fontSize: type.bodySmall.fontSize,
    color: colors.onAccent,
  },
  action: {
    fontWeight: '800',
    fontSize: type.bodySmall.fontSize,
    color: colors.primaryBright,
  },
}));