// src/components/auth/VerificationResultScreen.tsx
//
// The full-screen confirmation (or failure) shown right after a 6-digit
// verification code is submitted — the iOS Face ID / Apple Pay "receipt"
// moment: a seal that pops and draws itself in, a haptic that lands in the
// same frame the seal starts popping, and one button forward. Built to a
// pixel/timing spec handed down whole (colors, sizes, easing curves, haptic
// timing) rather than derived from the app's own token scale, which is why
// this file reaches for literal values instead of `space`/`type`/`colors` —
// it is a deliberately fixed receipt design, not a themed screen that should
// drift with the rest of the app's palette or dark mode.
//
// One component, two skins (success/error) via `status`, rather than two
// files — the layout, motion choreography and haptic-guard logic are
// identical between them; only the seal's color, glyph, headline and button
// set actually differ.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Pressable,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Text from '../Text';
import { fonts } from '../../theme/typography';

const AnimatedPath = Animated.createAnimatedComponent(Path);

// ---------------------------------------------------------------------------
// Spec constants — literal, not theme tokens; see file header.
// ---------------------------------------------------------------------------

const BG = '#FCF3DF';
// A half-step warmer/duller than BG on purpose — see the locked skin's own
// note in the file header spec: it should feel paused, not alarming.
const LOCKED_BG = '#F7EFDD';
const INK = '#191813';
const SUCCESS = '#2E6B32';
const SUCCESS_PRESSED = '#255A29';
const ERROR = '#C6362A';
const ERROR_PRESSED = '#A32B21';
const HELP_LINK = '#1E7BEF';

const SEAL_SIZE = 184;
const DISC_SIZE = 112;
const CHECK_VIEWBOX = 48;
const CHECK_PATH = 'M13 25.5 L21 33.5 L36 15';
// A cross for the failure seal, drawn in the same two-segment style and
// viewBox as the success check so the same stroke-draw-on animation and
// path length math both apply unchanged to either glyph.
const CROSS_PATH = 'M16 16 L32 32 M32 16 L16 32';

// Motion timing, straight off the spec.
const DISC_POP_MS = 550;
const CHECK_DRAW_DELAY_MS = 350;
const CHECK_DRAW_MS = 500;
const TEXT_DELAY_MS = 500;
const TEXT_MS = 550;
const RING_SPIN_MS = 26000;
// cubic-bezier(0.2, 1.3, 0.4, 1) — the overshoot the disc's pop uses. Not a
// named Easing preset, so it is built once here via Easing.bezier.
const POP_EASING = Easing.bezier(0.2, 1.3, 0.4, 1);

/** "4:58" — the locked disc's own live digits, always m:ss (no leading zero
 *  on minutes, since this never runs past single digits at a 5-minute
 *  lockout, but always two digits of seconds). */
function formatCountdownClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** "4 minutes 58 seconds" — the body copy's bold remaining-time phrase, per
 *  spec written out in words rather than the clock digits so the sentence
 *  around it still reads naturally. Drops a zero unit ("58 seconds", not "0
 *  minutes 58 seconds") but always keeps at least one, even at "0 seconds"
 *  on the very last tick. */
function formatCountdownWords(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];
  if (minutes > 0) parts.push(`${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`);
  if (seconds > 0 || minutes === 0) parts.push(`${seconds} ${seconds === 1 ? 'second' : 'seconds'}`);
  return parts.join(' ');
}

type Status = 'success' | 'error' | 'locked';

type Props = {
  status: Status;
  /** Pre-formatted — "Today at 1:50 AM" — so this component makes no
   *  assumption about locale/date formatting itself. Success only; error and
   *  locked show no timestamp (see their own spec notes on why). */
  timestamp?: string;
  /** e.g. "Manila". Omit to show only the timestamp. Success only. */
  location?: string;
  /** Error only — "That code doesn't match. Codes expire 10 minutes after
   *  we send them." style copy, and the live attempts-left count for the
   *  pill ("4 of 5 attempts left"). Both required together: the pill always
   *  needs a real number, and there is no sensible default reason string. */
  reason?: string;
  attemptsLeft?: number;
  attemptsTotal?: number;
  /** Locked only — when the cooldown ends, as an epoch ms timestamp. The
   *  countdown is derived from this plus Date.now() on a 1s tick rather than
   *  counting down an initial duration in local state, so backgrounding the
   *  app and returning (or a cold start reading the same persisted value)
   *  always shows the true remaining time instead of one frozen at
   *  whatever it last was in memory. */
  lockedUntilMs?: number;
  /** Fires once the locked countdown naturally reaches zero, so the caller
   *  can clear its own persisted lockout and let a real resend through the
   *  next time this component (or the plain form behind it) is shown. */
  onLockoutElapsed?: () => void;
  /** Success: the sole "Continue" button. Error: "Try again" + "Resend
   *  code". Locked: "Resend code" (disabled until the countdown ends) +
   *  "Get help signing in". All optional rather than one `onPrimary` — a
   *  caller must supply the right handler for whichever status it renders,
   *  not guess which one status implies. */
  onContinue?: () => void;
  onTryAgain?: () => void;
  onResendCode?: () => void;
  onGetHelp?: () => void;
};

export default function VerificationResultScreen({
  status,
  timestamp,
  location,
  reason,
  attemptsLeft,
  attemptsTotal = 5,
  lockedUntilMs,
  onLockoutElapsed,
  onContinue,
  onTryAgain,
  onResendCode,
  onGetHelp,
}: Props) {
  const [reducedMotion, setReducedMotion] = useState(false);

  // Ticks once a second for the locked skin's countdown — re-derived from
  // Date.now() and the caller's own lockedUntilMs each time, per the note on
  // that prop above, rather than counting down a duration stored in state.
  const [now, setNow] = useState(() => Date.now());
  const elapsedFired = useRef(false);
  useEffect(() => {
    if (status !== 'locked' || !lockedUntilMs) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [status, lockedUntilMs]);

  const remainingMs = status === 'locked' && lockedUntilMs ? Math.max(0, lockedUntilMs - now) : 0;
  useEffect(() => {
    if (status !== 'locked' || !lockedUntilMs) return;
    if (remainingMs > 0 || elapsedFired.current) return;
    elapsedFired.current = true;
    onLockoutElapsed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remainingMs, status, lockedUntilMs]);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((enabled) => {
        if (mounted) setReducedMotion(enabled);
      })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', (enabled) => {
      setReducedMotion(enabled);
    });
    return () => {
      mounted = false;
      sub?.remove?.();
    };
  }, []);

  // Guards the haptic to exactly one fire per mounted appearance — a status
  // flip while mounted (there isn't one today; VerifyEmailScreen always
  // remounts this via a fresh key) would still only be one real "appearance"
  // worth a buzz, not one per re-render.
  const firedHaptic = useRef(false);

  const discOpacity = useSharedValue(reducedMotion ? 1 : 0);
  const discScale = useSharedValue(reducedMotion ? 1 : 0.4);
  const checkProgress = useSharedValue(reducedMotion ? 1 : 0);
  const textOpacity = useSharedValue(reducedMotion ? 1 : 0);
  const textTranslateY = useSharedValue(reducedMotion ? 0 : 14);
  const ringRotation = useSharedValue(0);

  useEffect(() => {
    // Fired the instant this screen mounts — the same frame the disc starts
    // its pop, per spec, which means before any of the animations below
    // rather than chained off one of their completion callbacks. A Heavy
    // impact leads by ~80ms before the OS's own Success/Error notification —
    // that pattern's strength is fixed by the OS and not otherwise
    // adjustable, so the extra thud in front of it is what makes the whole
    // thing read as noticeably heavier without losing the recognizable
    // double-buzz "done" character the notification type itself gives.
    //
    // Skipped entirely for 'locked' — per spec, the error haptic already
    // fired on the 5th wrong attempt that led here, and buzzing again for
    // the lockout screen itself reads as a scolding rather than a signal.
    if (!firedHaptic.current && status !== 'locked') {
      firedHaptic.current = true;
      const type =
        status === 'success'
          ? Haptics.NotificationFeedbackType.Success
          : Haptics.NotificationFeedbackType.Error;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {
        // Unsupported/disabled hardware — never block the notification below.
      });
      setTimeout(() => {
        void Haptics.notificationAsync(type).catch(() => {
          // Unsupported/disabled hardware — the screen itself must never
          // wait on or fail from this.
        });
      }, 80);
    }

    // The dashed ring only spins for success/error — locked's own seal is
    // static per spec ("The dashed ring stops rotating here").
    if (status !== 'locked') {
      ringRotation.value = withRepeat(
        withTiming(360, { duration: RING_SPIN_MS, easing: Easing.linear }),
        -1,
        false
      );
    }

    if (reducedMotion || status === 'locked') {
      // Locked skips the pop/draw-on outright (there is no glyph to draw —
      // its disc holds a live countdown instead), same as reduced-motion
      // does for the other two: just present, no entrance to animate.
      discOpacity.value = 1;
      discScale.value = 1;
      checkProgress.value = 1;
      textOpacity.value = 1;
      textTranslateY.value = 0;
      return () => cancelAnimation(ringRotation);
    }

    discOpacity.value = withTiming(1, { duration: DISC_POP_MS, easing: POP_EASING });
    discScale.value = withTiming(1, { duration: DISC_POP_MS, easing: POP_EASING });
    checkProgress.value = withDelay(
      CHECK_DRAW_DELAY_MS,
      withTiming(1, { duration: CHECK_DRAW_MS, easing: Easing.out(Easing.cubic) })
    );
    textOpacity.value = withDelay(TEXT_DELAY_MS, withTiming(1, { duration: TEXT_MS }));
    textTranslateY.value = withDelay(
      TEXT_DELAY_MS,
      withTiming(0, { duration: TEXT_MS, easing: Easing.out(Easing.cubic) })
    );

    return () => cancelAnimation(ringRotation);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reducedMotion]);

  const discStyle = useAnimatedStyle(() => ({
    opacity: discOpacity.value,
    transform: [{ scale: discScale.value }],
  }));

  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${ringRotation.value}deg` }],
  }));

  const textBlockStyle = useAnimatedStyle(() => ({
    opacity: textOpacity.value,
    transform: [{ translateY: textTranslateY.value }],
  }));

  // The path's own rendered length at CHECK_VIEWBOX scale — measured by hand
  // once (both paths are two straight segments) rather than at runtime via
  // an onLayout measurement, which react-native-svg's Path does not expose.
  const pathLength = useMemo(() => (status === 'success' ? 33.4 : 45.3), [status]);

  const glyphProps = useAnimatedProps(() => ({
    strokeDashoffset: pathLength * (1 - checkProgress.value),
  }));

  const accent = status === 'success' ? SUCCESS : ERROR;
  const accentPressed = status === 'success' ? SUCCESS_PRESSED : ERROR_PRESSED;
  const headline =
    status === 'success' ? 'Verified' : status === 'locked' ? 'Too many tries' : "Couldn't verify";
  // Success only — see the props' own notes on why error/locked show
  // neither a timestamp nor this line at all.
  const subline = status === 'success' ? [timestamp, location].filter(Boolean).join(' · ') : '';

  const countdownLabel = useMemo(() => formatCountdownClock(remainingMs), [remainingMs]);
  const countdownWords = useMemo(() => formatCountdownWords(remainingMs), [remainingMs]);
  const lockoutOver = status === 'locked' && remainingMs <= 0;

  return (
    <SafeAreaView
      style={[styles.screen, status === 'locked' && styles.screenLocked]}
      edges={['top', 'bottom']}
    >
      {/* Radial glow: RN has no radial-gradient primitive, so this is
          concentric absolutely-positioned circles, each a slightly larger,
          more transparent ring of the same tint, centered on the seal.
          Success's own glow is intentionally larger/softer (per its own
          original spec); error's is explicitly bounded per its spec note —
          "don't let it exceed the seal by much" — so it uses fewer, smaller
          rings. Locked has none at all. */}
      {status === 'success' && (
        <View style={styles.glowWrap} pointerEvents="none">
          <View style={[styles.glowRing, { width: 520, height: 520, borderRadius: 260, opacity: 0.25, backgroundColor: 'rgba(46,107,50,0.09)' }]} />
          <View style={[styles.glowRing, { width: 380, height: 380, borderRadius: 190, opacity: 0.45, backgroundColor: 'rgba(46,107,50,0.09)' }]} />
          <View style={[styles.glowRing, { width: 260, height: 260, borderRadius: 130, opacity: 0.7, backgroundColor: 'rgba(46,107,50,0.09)' }]} />
          <View style={[styles.glowRing, { width: 160, height: 160, borderRadius: 80, opacity: 1, backgroundColor: 'rgba(46,107,50,0.09)' }]} />
        </View>
      )}
      {status === 'error' && (
        <View style={[styles.glowWrap, styles.glowWrapBounded]} pointerEvents="none">
          <View style={[styles.glowRing, { width: 220, height: 220, borderRadius: 110, opacity: 1, backgroundColor: 'rgba(178,55,44,0.10)' }]} />
        </View>
      )}

      <View style={styles.body}>
        <View style={styles.seal}>
          <Animated.View
            style={[
              styles.outerRing,
              status === 'error' && styles.outerRingError,
              status === 'locked' && styles.outerRingLocked,
              status !== 'locked' && ringStyle,
            ]}
          />
          <View
            style={[
              styles.middleRing,
              status === 'error' && styles.middleRingError,
              status === 'locked' && styles.middleRingLocked,
            ]}
          />
          {status === 'locked' ? (
            <View style={[styles.disc, styles.discLocked]}>
              <Text style={styles.countdownText}>{countdownLabel}</Text>
            </View>
          ) : (
            <Animated.View style={[styles.disc, discStyle, { backgroundColor: accent }]}>
              <Svg width={54} height={54} viewBox={`0 0 ${CHECK_VIEWBOX} ${CHECK_VIEWBOX}`}>
                <AnimatedPath
                  d={status === 'success' ? CHECK_PATH : CROSS_PATH}
                  stroke={BG}
                  strokeWidth={4.6}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                  strokeDasharray={pathLength}
                  animatedProps={glyphProps}
                />
              </Svg>
            </Animated.View>
          )}
        </View>

        <Animated.View style={[styles.textBlock, textBlockStyle]}>
          <Text style={[styles.headline, status === 'locked' && styles.headlineLocked]}>
            {headline}
          </Text>
          {!!subline && <Text style={styles.subline}>{subline}</Text>}
          {status === 'error' && !!reason && <Text style={styles.reasonText}>{reason}</Text>}
          {status === 'error' && typeof attemptsLeft === 'number' && (
            <View style={styles.attemptsPill}>
              <View style={styles.attemptsDot} />
              <Text style={styles.attemptsPillText}>
                {attemptsLeft} of {attemptsTotal} {attemptsLeft === 1 ? 'attempt' : 'attempts'} left
              </Text>
            </View>
          )}
          {status === 'locked' && (
            <Text style={styles.lockedBody}>
              You've used all {attemptsTotal} attempts, so we've paused verification. You can
              request a new code in <Text style={styles.lockedBodyBold}>{countdownWords}</Text>.
            </Text>
          )}
        </Animated.View>
      </View>

      <Animated.View style={[styles.buttonWrap, textBlockStyle]}>
        {status === 'success' && (
          <ResultButton label="Continue" color={accent} pressedColor={accentPressed} onPress={onContinue} />
        )}
        {status === 'error' && (
          <>
            <ResultButton label="Try again" color={accent} pressedColor={accentPressed} onPress={onTryAgain} />
            <Pressable onPress={onResendCode} style={({ pressed }) => [
              styles.helpButton,
              pressed && styles.resendPressed,
            ]}>
              <Text style={styles.secondaryButtonText}>Resend code</Text>
            </Pressable>
          </>
        )}
        {status === 'locked' && (
          <>
            {lockoutOver ? (
              <ResultButton label="Resend code" color={SUCCESS} pressedColor={SUCCESS_PRESSED} onPress={onResendCode} />
            ) : (
              <View style={[styles.button, styles.buttonDisabled]}>
                <Text style={styles.buttonTextDisabled}>Resend code</Text>
              </View>
            )}
            <Pressable onPress={onGetHelp} hitSlop={12} style={({ pressed }) => [
              styles.helpButton,
              pressed && styles.helpButtonPressed,
            ]}>
              <Text style={styles.helpButtonText}>Get help signing in</Text>
            </Pressable>
          </>
        )}
      </Animated.View>
    </SafeAreaView>
  );
}

function ResultButton({
  label,
  color,
  pressedColor,
  onPress,
}: {
  label: string;
  color: string;
  pressedColor: string;
  onPress?: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }): ViewStyle[] => [
      styles.button,
      { backgroundColor: pressed ? pressedColor : color },
    ]}>
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: BG,
    paddingTop: 62,
    paddingHorizontal: 28,
    paddingBottom: 44,
  },
  // A half-step warmer/duller background than the other two states — see
  // LOCKED_BG's own note above.
  screenLocked: {
    backgroundColor: LOCKED_BG,
  },
  glowWrap: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    // 42% down the screen, per spec's "50% / 42%" center — approximated with
    // a fixed offset rather than measuring the screen, since the glow only
    // has to look centered on the seal below it, not land on an exact pixel.
    justifyContent: 'flex-start',
    paddingTop: '20%',
  },
  // Error's own glow sits noticeably higher (34% vs. 42%) and is explicitly
  // small/bounded per its spec note — it must never balloon into the large
  // offset blobs an unbounded gradient would read as.
  glowWrapBounded: {
    paddingTop: '14%',
  },
  // No default backgroundColor — success and error each pass their own
  // tint inline (see the render function), since the two use different
  // colors entirely rather than one shared wash.
  glowRing: {
    position: 'absolute',
  },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  seal: {
    width: SEAL_SIZE,
    height: SEAL_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  outerRing: {
    position: 'absolute',
    width: SEAL_SIZE,
    height: SEAL_SIZE,
    borderRadius: SEAL_SIZE / 2,
    borderWidth: 2,
    borderColor: 'rgba(46,107,50,0.45)',
    borderStyle: 'dashed',
  },
  outerRingError: {
    borderColor: 'rgba(178,55,44,0.38)',
  },
  // Neutral, not red — per spec the locked seal drops color entirely rather
  // than reading as a continuation of the error state it followed.
  outerRingLocked: {
    borderColor: 'rgba(25,24,19,0.18)',
  },
  middleRing: {
    position: 'absolute',
    width: SEAL_SIZE - 36,
    height: SEAL_SIZE - 36,
    borderRadius: (SEAL_SIZE - 36) / 2,
    borderWidth: 1.5,
    borderColor: 'rgba(46,107,50,0.25)',
  },
  middleRingError: {
    borderColor: 'rgba(178,55,44,0.20)',
  },
  middleRingLocked: {
    borderColor: 'rgba(25,24,19,0.12)',
  },
  disc: {
    position: 'absolute',
    width: DISC_SIZE,
    height: DISC_SIZE,
    borderRadius: DISC_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  discLocked: {
    backgroundColor: 'rgba(25,24,19,0.08)',
    borderWidth: 1.5,
    borderColor: 'rgba(25,24,19,0.14)',
  },
  countdownText: {
    fontVariant: ['tabular-nums'],
    fontSize: 30,
    fontWeight: '700',
    color: INK,
  },
  textBlock: {
    marginTop: 30,
    alignItems: 'center',
  },
  headline: {
    fontFamily: fonts.display,
    fontWeight: '800',
    fontSize: 42,
    color: INK,
    letterSpacing: -0.5,
  },
  // Smaller and tighter-leaded than success/error's headline, per spec
  // (38px/800, line-height 1.05) — the extra word ("Too many tries") reads
  // better at this size than squeezed into the other two states' 42px.
  headlineLocked: {
    fontSize: 38,
    lineHeight: 40,
    textAlign: 'center',
  },
  subline: {
    marginTop: 10,
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: 15.5,
    color: 'rgba(25,24,19,0.6)',
  },
  reasonText: {
    marginTop: 10,
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: 15.5,
    color: 'rgba(25,24,19,0.6)',
    textAlign: 'center',
  },
  attemptsPill: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(178,55,44,0.10)',
  },
  attemptsDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#8E2A21',
  },
  attemptsPillText: {
    fontFamily: fonts.body,
    fontWeight: '700',
    fontSize: 13.5,
    color: '#8E2A21',
  },
  // 16px/400, max-width 282, per spec — a narrower measure than sublime/
  // reasonText reads better for a full sentence this long.
  lockedBody: {
    marginTop: 14,
    maxWidth: 282,
    fontFamily: fonts.body,
    fontWeight: '400',
    fontSize: 16,
    lineHeight: 22,
    color: 'rgba(25,24,19,0.62)',
    textAlign: 'center',
  },
  lockedBodyBold: {
    fontWeight: '800',
    color: INK,
  },
  buttonWrap: {
    gap: 14,
  },
  button: {
    width: '100%',
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: SUCCESS,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.24,
    shadowRadius: 18,
    elevation: 6,
  },
  buttonText: {
    fontFamily: fonts.body,
    fontWeight: '800',
    fontSize: 17,
    color: BG,
  },
  // The disabled "Resend code" during a live lockout — no shadow, no press
  // state (it's a plain View, not a Pressable, so there is nothing to
  // press), per spec.
  buttonDisabled: {
    backgroundColor: 'rgba(25,24,19,0.1)',
    shadowOpacity: 0,
    elevation: 0,
  },
  buttonTextDisabled: {
    fontFamily: fonts.body,
    fontWeight: '800',
    fontSize: 17,
    color: 'rgba(25,24,19,0.45)',
  },
  secondaryButtonText: {
    fontFamily: fonts.body,
    fontWeight: '800',
    fontSize: 15,
    color: INK,
  },
  resendPressed: {
    backgroundColor: 'rgba(178,55,44,0.08)',
  },
  // 50px tall, full width — per spec a real hit area, not bare text, so
  // Resend/Get-help both get an actual tinted press background rather than
  // a plain small text link.
  helpButton: {
    height: 50,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
  },
  helpButtonPressed: {
    backgroundColor: 'rgba(30,123,239,0.08)',
  },
  helpButtonText: {
    fontFamily: fonts.body,
    fontWeight: '800',
    fontSize: 15,
    color: HELP_LINK,
  },
});
