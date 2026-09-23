// src/screens/cook/CookCompleteSheet.tsx
//
// The sheet CookStepScreen shows over itself once Finish is pressed on the
// last step. The screen underneath stays mounted — this is a scrim + sheet on
// top of it, not a screen transition — which is why closing either button
// just resets CookStepScreen's own state rather than this component owning
// any navigation.
//
// "Rate this cook" swaps this same sheet's inner content for a star picker
// rather than opening a second Modal on top of it — two native Modals both
// animating in/out at once (this one fading out while a second fades in) is
// what made the button feel like it froze the app: RN can only really own one
// top-level native modal transition at a time, and stacking a second while
// the first is still mid fade-out is exactly that contention. One Modal,
// swapped content, sidesteps it entirely.
//
// Two entrance animations run together: the scrim fades in over 250ms, and
// the sheet itself translates up from 40px below with a fade over 360ms on an
// overshoot curve, the check badge starting 100ms into that and overshooting
// further on its own curve. `prefers-reduced-motion` (surfaced natively via
// AccessibilityInfo.isReduceMotionEnabled, the same signal
// VerificationResultScreen already reads) keeps both fades but drops every
// transform — the sheet and badge simply appear at their resting position and
// scale instead of animating into it.

import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Modal,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Text from '../../components/Text';
import { fonts } from '../../theme/typography';
import { useTheme } from '../../theme/ThemeProvider';
import { cookTokens, CookTokens } from './cookTokens';

export type CookCompleteStat = {
  value: string;
  unit?: string;
  label: string;
};

type Props = {
  visible: boolean;
  title: string;
  body: string;
  stats: [CookCompleteStat, CookCompleteStat, CookCompleteStat];
  onRate: (stars: number) => void;
  onBackToRecipe: () => void;
};

const STAR_VALUES = [1, 2, 3, 4, 5];
const STAR_HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 };

const SCRIM_DURATION = 250;
const SHEET_DURATION = 360;
const SHEET_DELAY = 0;
const BADGE_DURATION = 450;
const BADGE_DELAY = 100;
// cubic-bezier(.2,.9,.3,1.06) — Animated has no cubic-bezier easing of its
// own, so this is approximated with an equivalent overshoot curve rather than
// left as a plain ease; the badge's own (.2,.9,.3,1.3) is a stronger version
// of the same shape, given a taller overshoot to match.
const SHEET_EASING = Easing.bezier(0.2, 0.9, 0.3, 1.06);
const BADGE_EASING = Easing.bezier(0.2, 0.9, 0.3, 1.3);

export default function CookCompleteSheet({ visible, title, body, stats, onRate, onBackToRecipe }: Props) {
  const insets = useSafeAreaInsets();
  const { scheme } = useTheme();
  const tokens = cookTokens[scheme];
  const styles = React.useMemo(() => makeStyles(tokens), [tokens]);
  const [mounted, setMounted] = useState(visible);
  const [reducedMotion, setReducedMotion] = useState(false);
  // Which face of the one sheet is showing — the stats/buttons view or the
  // star picker "Rate this cook" swaps in. Reset whenever the sheet is asked
  // to hide, so it never reopens on the rating step for the next cook.
  const [rating, setRating] = useState(false);
  const [stars, setStars] = useState(0);

  const scrimOpacity = useRef(new Animated.Value(0)).current;
  const sheetProgress = useRef(new Animated.Value(0)).current;
  const badgeProgress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((enabled) => {
        if (alive) setReducedMotion(enabled);
      })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', (enabled) => {
      setReducedMotion(enabled);
    });
    return () => {
      alive = false;
      sub?.remove?.();
    };
  }, []);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      scrimOpacity.setValue(0);
      sheetProgress.setValue(0);
      badgeProgress.setValue(0);

      Animated.timing(scrimOpacity, {
        toValue: 1,
        duration: SCRIM_DURATION,
        easing: Easing.ease,
        useNativeDriver: true,
      }).start();

      Animated.timing(sheetProgress, {
        toValue: 1,
        duration: reducedMotion ? SCRIM_DURATION : SHEET_DURATION,
        delay: SHEET_DELAY,
        easing: reducedMotion ? Easing.ease : SHEET_EASING,
        useNativeDriver: true,
      }).start();

      Animated.timing(badgeProgress, {
        toValue: 1,
        duration: reducedMotion ? SCRIM_DURATION : BADGE_DURATION,
        delay: reducedMotion ? 0 : BADGE_DELAY,
        easing: reducedMotion ? Easing.ease : BADGE_EASING,
        useNativeDriver: true,
      }).start();
    } else if (mounted) {
      Animated.timing(scrimOpacity, {
        toValue: 0,
        duration: SCRIM_DURATION,
        easing: Easing.ease,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) {
          setMounted(false);
          setRating(false);
          setStars(0);
        }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, reducedMotion]);

  if (!mounted) return null;

  const sheetTranslate = reducedMotion
    ? 0
    : sheetProgress.interpolate({ inputRange: [0, 1], outputRange: [40, 0] });

  // scale(.4) -> 1.12 -> 1, expressed as two Animated segments over one
  // driving value: 0..0.7 covers .4->1.12 (the overshoot), 0.7..1 covers
  // 1.12->1 (the settle). Reduced motion skips straight to the resting scale.
  const badgeScale = reducedMotion
    ? 1
    : badgeProgress.interpolate({
        inputRange: [0, 0.7, 1],
        outputRange: [0.4, 1.12, 1],
      });

  // Android hardware back / Esc while the star picker is showing backs out
  // to the stats view rather than leaving cook mode outright, the same way a
  // second screen would pop one level rather than closing the whole flow.
  function handleRequestClose() {
    if (rating) {
      setRating(false);
      setStars(0);
      return;
    }
    onBackToRecipe();
  }

  function handleSubmitRating() {
    if (stars < 1) return;
    onRate(stars);
  }

  return (
    <Modal
      visible={mounted}
      transparent
      animationType="none"
      // Android hardware back and RN Web's Escape key both fire this — the
      // one real, non-fabricated way to wire that gesture without
      // hand-rolling a keyboard listener that doesn't exist on native. See
      // handleRequestClose for which face of the sheet it backs out of.
      onRequestClose={handleRequestClose}
      // The iOS VoiceOver equivalent of a focus trap: while this modal is up,
      // VoiceOver treats content behind it (CookStepScreen) as hidden from
      // the accessibility tree, so swiping can't leave the sheet.
      accessibilityViewIsModal
      statusBarTranslucent
    >
      <View style={StyleSheet.absoluteFill}>
        <Animated.View
          style={[styles.scrim, { opacity: scrimOpacity }]}
          // No tap-to-dismiss: this view intentionally carries no onPress.
        />

        <Animated.View
          style={[
            styles.sheetOuter,
            {
              opacity: sheetProgress,
              transform: [{ translateY: sheetTranslate }],
            },
          ]}
        >
          <View style={[styles.sheetInner, { paddingBottom: Math.max(insets.bottom, 14) }]}>
          {rating ? (
            <View style={styles.sheet} accessibilityRole="none" accessibilityLabel={`Rate ${title}`}>
              <Text style={styles.title}>How was it?</Text>
              <Text style={styles.body}>{title}</Text>

              <View style={styles.starRow} accessibilityRole="adjustable" accessibilityLabel="Star rating">
                {STAR_VALUES.map((value) => (
                  <TouchableOpacity
                    key={value}
                    onPress={() => setStars(value)}
                    hitSlop={STAR_HIT_SLOP}
                    accessibilityRole="button"
                    accessibilityLabel={`${value} star${value === 1 ? '' : 's'}`}
                    accessibilityState={{ selected: stars >= value }}
                  >
                    <Ionicons
                      name={stars >= value ? 'star' : 'star-outline'}
                      size={38}
                      color={stars >= value ? tokens.accent : tokens.label}
                      style={styles.star}
                    />
                  </TouchableOpacity>
                ))}
              </View>

              <TouchableOpacity
                style={[styles.primaryButton, stars < 1 && styles.primaryButtonDisabled]}
                onPress={handleSubmitRating}
                disabled={stars < 1}
                activeOpacity={0.9}
                accessibilityRole="button"
              >
                <Text style={styles.primaryButtonText}>Submit rating</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.textButton}
                onPress={() => {
                  setRating(false);
                  setStars(0);
                }}
                activeOpacity={0.7}
                accessibilityRole="button"
              >
                <Text style={styles.textButtonText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.sheet} accessibilityRole="none" accessibilityLabel={title}>
              <Animated.View
                style={[
                  styles.badge,
                  {
                    transform: [{ scale: badgeScale }],
                    opacity: reducedMotion
                      ? 1
                      : badgeProgress.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 1, 1] }),
                  },
                ]}
              >
                <Text style={styles.badgeCheck}>{'✓'}</Text>
              </Animated.View>

              <Text style={styles.title}>{title}</Text>
              <Text style={styles.body}>{body}</Text>

              <View style={styles.statsRow}>
                {stats.map((stat, i) => (
                  <View key={i} style={styles.statTile}>
                    <Text style={styles.statValue}>
                      {stat.value}
                      {stat.unit ? <Text style={styles.statUnit}> {stat.unit}</Text> : null}
                    </Text>
                    <Text style={styles.statLabel}>{stat.label}</Text>
                  </View>
                ))}
              </View>

              <TouchableOpacity
                style={styles.primaryButton}
                onPress={() => setRating(true)}
                activeOpacity={0.9}
                accessibilityRole="button"
              >
                <Text style={styles.primaryButtonText}>Rate this cook</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.textButton}
                onPress={onBackToRecipe}
                activeOpacity={0.7}
                accessibilityRole="button"
              >
                <Text style={styles.textButtonText}>Back to recipe</Text>
              </TouchableOpacity>
            </View>
          )}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

// Built per-scheme, like CookStepScreen's own makeStyles — every colour here
// comes from `tokens` (cookTokens.ts) rather than being fixed to the light
// spec.
function makeStyles(tokens: CookTokens) {
  const SHADOW_SHEET = {
    shadowColor: tokens.shadowColor,
    shadowOpacity: 0.3,
    shadowRadius: 34,
    shadowOffset: { width: 0, height: -8 },
    elevation: 12,
  };

  const SHADOW_CHIP = {
    shadowColor: tokens.shadowColor,
    shadowOpacity: 0.1,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  };

  const SHADOW_BADGE = {
    shadowColor: tokens.accent,
    shadowOpacity: 0.45,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  };

  return StyleSheet.create({
    scrim: {
      ...StyleSheet.absoluteFill,
      backgroundColor: tokens.scrim,
    },
    sheetOuter: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      alignItems: 'center',
    },
    sheetInner: {
      width: '100%',
      // Same 560 cap as CookStepScreen's own column — on a wide viewport the
      // sheet stops growing and centers rather than stretching bottom-to-edge.
      // Needs its own view: an absolutely-positioned parent pinned with
      // left:0/right:0 can't also alignSelf:'center' at a capped width, since
      // the left/right pins already fix its full-viewport size.
      maxWidth: 560,
      padding: 14,
    },
    sheet: {
      borderRadius: 30,
      backgroundColor: tokens.page,
      paddingTop: 28,
      paddingHorizontal: 22,
      paddingBottom: 20,
      alignItems: 'center',
      ...SHADOW_SHEET,
    },
    badge: {
      width: 74,
      height: 74,
      borderRadius: 999,
      backgroundColor: tokens.accent,
      alignItems: 'center',
      justifyContent: 'center',
      ...SHADOW_BADGE,
    },
    badgeCheck: {
      fontFamily: fonts.cook,
      fontSize: 34,
      fontWeight: '700',
      color: '#FFFFFF',
    },
    title: {
      fontFamily: fonts.cook,
      fontSize: 27,
      fontWeight: '700',
      color: tokens.ink,
      marginTop: 18,
      textAlign: 'center',
    },
    body: {
      fontFamily: fonts.cook,
      fontSize: 15,
      lineHeight: 15 * 1.45,
      fontWeight: '500',
      color: tokens.bodyMuted,
      marginTop: 6,
      textAlign: 'center',
    },
    statsRow: {
      flexDirection: 'row',
      gap: 10,
      marginTop: 20,
      alignSelf: 'stretch',
    },
    statTile: {
      flex: 1,
      paddingVertical: 13,
      borderRadius: 18,
      backgroundColor: tokens.surface,
      alignItems: 'center',
      ...SHADOW_CHIP,
    },
    statValue: {
      fontFamily: fonts.cook,
      fontSize: 19,
      fontWeight: '700',
      color: tokens.ink,
    },
    statUnit: {
      fontFamily: fonts.cook,
      fontSize: 12,
      fontWeight: '700',
      color: tokens.ink,
    },
    statLabel: {
      fontFamily: fonts.cook,
      fontSize: 10,
      fontWeight: '700',
      letterSpacing: 0.08 * 10,
      color: tokens.label,
      marginTop: 4,
    },
    primaryButton: {
      alignSelf: 'stretch',
      height: 56,
      borderRadius: 999,
      backgroundColor: tokens.accent,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 18,
    },
    primaryButtonDisabled: {
      opacity: 0.45,
    },
    primaryButtonText: {
      fontFamily: fonts.cook,
      fontSize: 17,
      fontWeight: '700',
      color: '#FFFFFF',
    },
    starRow: {
      flexDirection: 'row',
      gap: 6,
      marginTop: 20,
    },
    star: {
      marginHorizontal: 2,
    },
    textButton: {
      alignSelf: 'stretch',
      paddingVertical: 13,
      marginTop: 6,
      alignItems: 'center',
      backgroundColor: 'transparent',
    },
    textButtonText: {
      fontFamily: fonts.cook,
      fontSize: 15,
      fontWeight: '700',
      color: tokens.ink2,
    },
  });
}
