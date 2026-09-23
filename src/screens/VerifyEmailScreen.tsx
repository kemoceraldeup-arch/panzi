// src/screens/VerifyEmailScreen.tsx
//
// The step between "Create account" and actually landing in the app: prove
// the email address is real by typing back the 6-digit code just sent to it.
// Same visual language as CreateAccountScreen/SignInScreen (login-2a.html /
// REACT-NATIVE-NOTES.md) — hero title, rounded white cards, one big shadowed
// CTA — so this reads as the next page of the same flow, not a different app
// bolted on for one screen.
//
// The 6 boxes are one hidden TextInput underneath them, not six real inputs.
// Six separate TextInputs means six lots of focus-management (advance on
// type, retreat on backspace-when-empty, paste splitting across boxes) for a
// value that is really just one string; one input keeps that logic to a
// single onChangeText and lets the boxes be pure display, each one just
// reading its own character out of the same string.

import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  View,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Keyboard,
  Alert,
  ActivityIndicator,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import Text from '../components/Text';
import Mascot from '../components/Mascot';
import VerificationResultScreen from '../components/auth/VerificationResultScreen';
import {
  confirmVerificationCode,
  getCachedLockout,
  isEmailVerified,
  sendVerificationCode,
} from '../services/emailVerification';
import { ApiError } from '../config/api';
import { makeStyles } from '../theme/makeStyles';
import { useColors } from '../theme/ThemeProvider';
import { fonts, type } from '../theme/typography';

const CODE_LENGTH = 6;
const RESEND_COOLDOWN_S = 30;

/** "Today at 1:50 AM" — the exact phrasing the result screen's spec example
 *  uses. Always "Today" rather than a real date: this screen only ever
 *  shows a result for something that just happened, seconds ago. */
function formatResultTimestamp(date: Date): string {
  const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(
    date
  );
  return `Today at ${time}`;
}

/** Best-effort city name from the device's own IANA time zone
 *  ("Asia/Manila" -> "Manila") — there is no location permission or service
 *  in this app to ask a real one from, and a time zone-derived city is an
 *  honest approximation rather than a guess dressed up as GPS. Returns
 *  undefined (never shown) rather than a raw zone id like "Etc/UTC" that
 *  would read as a bug, not a place. */
function guessLocation(): string | undefined {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const city = zone.split('/').pop();
    if (!city || city.startsWith('Etc') || city === 'UTC') return undefined;
    return city.replace(/_/g, ' ');
  } catch {
    return undefined;
  }
}

type Props = {
  /** The address the code was sent to, so this screen can open already
   *  knowing it — CreateAccountScreen already has it from the field the user
   *  just typed, and re-deriving it from auth.currentUser here would just be
   *  the same string read a second, slower way. */
  email: string;
  onVerified: () => void;
  onBack: () => void;
};

export default function VerifyEmailScreen({ email, onVerified, onBack }: Props) {
  const styles = useStyles();
  const colors = useColors();
  const inputRef = useRef<TextInput>(null);

  const [code, setCode] = useState('');
  const [checking, setChecking] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_S);
  // Set once the server confirms the code — from here on the screen shows
  // VerificationResultScreen's success skin instead of the form. There is no
  // matching error state that navigates away: a wrong code stays right here
  // (see wrongCode below) rather than jumping to a separate failure screen.
  const [verified, setVerified] = useState(false);
  // True for a couple of seconds right after a submitted code comes back
  // wrong — flips the code boxes red and fires the error haptic without
  // leaving this screen, then clears itself (and the typed code) so the next
  // attempt starts clean. Not the same thing as `checking`: this is a
  // result, not a loading state.
  const [wrongCode, setWrongCode] = useState(false);
  // Drives the code row's horizontal shake on a wrong code — plain
  // Animated (not Reanimated) since this is the only animation on this
  // screen and one short sequence doesn't need a worklet-based library.
  const shake = useRef(new Animated.Value(0)).current;
  // Set once the 5th wrong attempt locks the account out (or a cold start
  // finds a still-live lockout cached from before — see the mount effect
  // below) — from here on the screen shows VerificationResultScreen's
  // locked skin instead of the form, same as `verified` does for success.
  const [lockedUntilMs, setLockedUntilMs] = useState<number | null>(null);

  // Ticks the resend cooldown down to 0 once a second. Reset to the full
  // cooldown every time a send actually goes out (mount, and every
  // successful resend) — see the two places that set it below.
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [cooldown > 0]);

  // Fires the first code the moment this screen opens, so the user never has
  // to tap "Send" for the one they're actually expecting — only for a
  // resend. Skipped entirely if a lockout from before is still live (a cold
  // start reopening this screen mid-cooldown, say) — sending would just
  // bounce off the server's own 423 anyway, and checking the cache first
  // means the lockout screen can paint on the very first frame instead of
  // flashing the form for one network round trip.
  useEffect(() => {
    let cancelled = false;
    getCachedLockout().then((cached) => {
      if (cancelled) return;
      if (cached) {
        setLockedUntilMs(cached);
        return;
      }
      void sendVerificationCode().catch((err) => {
        if (err instanceof ApiError && err.code === 'locked') {
          setLockedUntilMs(err.details.lockedUntilMs as number);
          return;
        }
        // Silent otherwise: a failed auto-send still leaves the resend
        // button live, and surfacing an alert the instant this screen opens
        // (before the user has done anything) reads as the app being
        // broken rather than helpful.
        console.warn('Initial verification send failed', err);
      });
    });
    // Focus the hidden input immediately — the keyboard should already be up
    // when this screen finishes entering, since typing the code is the only
    // thing to do here.
    const id = setTimeout(() => inputRef.current?.focus(), 400);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Submits itself the instant the 6th digit lands — a code this short is
  // its own "done" signal, and making the user also find and tap a button
  // is one more step than the format needs.
  useEffect(() => {
    if (code.length !== CODE_LENGTH) return;
    void handleSubmit(code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  async function handleSubmit(value: string) {
    setChecking(true);
    try {
      await confirmVerificationCode(value);
      // Firebase's own emailVerified is what the rest of the app trusts —
      // this reload is what makes THIS client's copy of that field catch up
      // with the write confirmVerificationCode just made server-side. Done
      // before the result screen shows, not after, so onContinue (fired from
      // that screen's own button) never has to await anything itself.
      await isEmailVerified();
      setVerified(true);
      return;
    } catch (err) {
      // The 5th wrong attempt specifically hands back 'locked' — that one
      // navigates to the full-screen lockout state rather than the plain
      // shake-and-retry every other failure (wrong digits, an expired code)
      // gets, per the "keep the current failed [state], just apply the too
      // many tries [state]" instruction this was built to.
      if (err instanceof ApiError && err.code === 'locked') {
        setLockedUntilMs(err.details.lockedUntilMs as number);
        setCode('');
        setChecking(false);
        return;
      }
      triggerWrongCodeHaptic();
      setWrongCode(true);
      setCode('');
      shakeCodeRow();
      setTimeout(() => {
        setWrongCode(false);
        inputRef.current?.focus();
      }, 2000);
    }
    setChecking(false);
  }

  /** A Heavy impact leading the OS's own Error notification by ~80ms, same
   *  trick VerificationResultScreen's own haptic uses — the notification
   *  pattern's strength is fixed by the OS, so the impact in front of it is
   *  what makes the whole thing read as noticeably stronger. */
  function triggerWrongCodeHaptic() {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
    setTimeout(() => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    }, 80);
  }

  /** Three quick left-right swings settling back to center — reset to 0
   *  first in case a second wrong code lands while an earlier shake's tail
   *  end (the settle back to 0) is still finishing. */
  function shakeCodeRow() {
    shake.setValue(0);
    Animated.sequence([
      Animated.timing(shake, { toValue: 1, duration: 55, easing: Easing.linear, useNativeDriver: true }),
      Animated.timing(shake, { toValue: -1, duration: 55, easing: Easing.linear, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 1, duration: 55, easing: Easing.linear, useNativeDriver: true }),
      Animated.timing(shake, { toValue: -1, duration: 55, easing: Easing.linear, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 0, duration: 55, easing: Easing.linear, useNativeDriver: true }),
    ]).start();
  }

  async function handleResend() {
    if (resending) return;
    if (cooldown > 0) return;
    setResending(true);
    try {
      await sendVerificationCode();
      setCooldown(RESEND_COOLDOWN_S);
      setCode('');
      inputRef.current?.focus();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'locked') {
        setLockedUntilMs(err.details.lockedUntilMs as number);
        setResending(false);
        return;
      }
      const message = err instanceof ApiError ? err.message : 'Could not send a new code.';
      Alert.alert('Could not resend', message);
    }
    setResending(false);
  }

  /** The lockout screen's own "Resend code" — only reachable once its
   *  countdown has actually finished (VerificationResultScreen disables the
   *  button until then), so this always goes straight to the server rather
   *  than through handleResend's own 30s cooldown guard, which has nothing
   *  to do with a lockout that just ran five minutes and would otherwise
   *  need to happen to already be clear too. */
  async function handleResendFromLockout() {
    setResending(true);
    try {
      await sendVerificationCode();
      setLockedUntilMs(null);
      setCooldown(RESEND_COOLDOWN_S);
      setCode('');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'locked') {
        // Clock skew or a fresh attempt elsewhere re-locked it right at the
        // boundary — stay on the lockout screen with whatever the server
        // now says instead of bouncing to the form for an instantly-wrong
        // resend.
        setLockedUntilMs(err.details.lockedUntilMs as number);
        setResending(false);
        return;
      }
      const message = err instanceof ApiError ? err.message : 'Could not send a new code.';
      Alert.alert('Could not resend', message);
    }
    setResending(false);
  }

  /** No support flow exists yet — surfaces the same "email us" address the
   *  code itself already comes from, so there is at least a real way to
   *  reach a person rather than a dead button. */
  function handleGetHelp() {
    Alert.alert('Need help?', 'Email us at panziappcustomerservice@gmail.com and we\'ll sort it out.');
  }

  const digits = Array.from({ length: CODE_LENGTH }, (_, i) => code[i] ?? '');

  // Placed after every hook above (same pattern App.tsx's own early return
  // uses) so swapping the form out for the result screen never changes how
  // many hooks this component calls — only what it renders. A fresh Date()
  // read right here (not memoized) is deliberate: it should say when
  // verification actually landed, not when the screen first mounted.
  if (verified) {
    return (
      <VerificationResultScreen
        status="success"
        timestamp={formatResultTimestamp(new Date())}
        location={guessLocation()}
        onContinue={onVerified}
      />
    );
  }

  if (lockedUntilMs) {
    return (
      <VerificationResultScreen
        status="locked"
        lockedUntilMs={lockedUntilMs}
        attemptsTotal={5}
        onLockoutElapsed={() => {
          // Only flips the button live — VerificationResultScreen itself
          // stays mounted showing the (now zero) countdown and an enabled
          // Resend button, exactly like its own spec's "re-enables the
          // moment the timer reaches zero" rather than bouncing back to the
          // plain form on its own.
        }}
        onResendCode={handleResendFromLockout}
        onGetHelp={handleGetHelp}
      />
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <View style={styles.content}>
            <View style={styles.navRow}>
              <TouchableOpacity
                style={styles.back}
                onPress={onBack}
                hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                accessibilityLabel="Back"
              >
                <Text style={styles.backGlyph}>‹</Text>
              </TouchableOpacity>
              <View style={styles.spacer} />
            </View>

            <View style={styles.hero}>
              <Mascot pose="face" size={92} style={styles.mascot} />
              <Text style={styles.title}>Check your email</Text>
              <Text style={styles.subtitle}>
                We sent a 6-digit code to{'\n'}
                <Text style={styles.emailText}>{email}</Text>
              </Text>
            </View>

            {/* Tapping anywhere on the row focuses the hidden input — the
                boxes are read-only display, so without this the only tappable
                spot would be wherever the invisible input happens to sit.
                The shake lives on an inner Animated.View rather than this
                TouchableOpacity itself — RN's Touchables don't forward an
                Animated-driven style, only a plain one. */}
            <TouchableOpacity
              style={styles.codeRow}
              activeOpacity={1}
              onPress={() => inputRef.current?.focus()}
            >
              <Animated.View
                style={[
                  styles.codeRowInner,
                  {
                    transform: [
                      {
                        translateX: shake.interpolate({
                          inputRange: [-1, 1],
                          outputRange: [-8, 8],
                        }),
                      },
                    ],
                  },
                ]}
              >
                {digits.map((digit, i) => {
                  const filled = i < code.length;
                  // The box just past the last typed digit reads as "next" —
                  // the same cue a native OTP field gives with its caret,
                  // rebuilt here since the real caret lives in the hidden
                  // input, off-screen.
                  const isNext = i === code.length;
                  return (
                    <View
                      key={i}
                      style={[
                        styles.codeBox,
                        filled && styles.codeBoxFilled,
                        isNext && styles.codeBoxNext,
                        wrongCode && styles.codeBoxWrong,
                      ]}
                    >
                      <Text style={[styles.codeDigit, wrongCode && styles.codeDigitWrong]}>
                        {digit}
                      </Text>
                    </View>
                  );
                })}
              </Animated.View>
            </TouchableOpacity>

            {/* The real input: transparent, sized to nothing visible, sitting
                behind the boxes above. maxLength stops a paste of anything
                longer than the code itself from ever reaching state. */}
            <TextInput
              ref={inputRef}
              value={code}
              onChangeText={(text) => {
                const digitsOnly = text.replace(/[^0-9]/g, '').slice(0, CODE_LENGTH);
                setCode(digitsOnly);
              }}
              keyboardType="number-pad"
              maxLength={CODE_LENGTH}
              style={styles.hiddenInput}
              autoFocus={false}
              caretHidden
              accessibilityLabel="6-digit verification code"
            />

            <View style={styles.errorSpacer}>
              {wrongCode && (
                <Text style={styles.wrongCodeText}>That code isn't right — try again.</Text>
              )}
            </View>

            {checking && (
              <View style={styles.checkingRow}>
                <ActivityIndicator color={colors.primaryActive} />
                <Text style={styles.checkingText}>Verifying…</Text>
              </View>
            )}

            <View style={styles.resendRow}>
              <Text style={styles.resendPrompt}>Didn't get it?</Text>
              <TouchableOpacity
                onPress={handleResend}
                disabled={cooldown > 0 || resending}
                hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
              >
                <Text style={[styles.resendLink, (cooldown > 0 || resending) && styles.resendLinkDisabled]}>
                  {resending ? 'Sending…' : cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: {
    flex: 1,
    backgroundColor: colors.backgroundLight,
    overflow: 'hidden',
  },
  flex: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: 26,
  },
  navRow: {
    paddingTop: 14,
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  back: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: colors.backgroundAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backGlyph: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  spacer: {
    width: 40,
  },
  hero: {
    paddingTop: 18,
    alignItems: 'center',
  },
  mascot: {
    marginBottom: 8,
  },
  title: {
    fontFamily: fonts.display,
    fontWeight: '800',
    fontSize: 30,
    lineHeight: 38,
    letterSpacing: -0.6,
    color: colors.textPrimary,
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: type.body.fontSize,
    lineHeight: 22.5,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  emailText: {
    fontWeight: '800',
    color: colors.textPrimary,
  },
  codeRow: {
    marginTop: 36,
  },
  // The row's real layout (and what shake's translateX actually moves) —
  // split out from codeRow because the shake lives on this inner Animated
  // View while codeRow itself stays a plain-styled TouchableOpacity.
  codeRowInner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  codeBox: {
    width: 48,
    height: 58,
    borderRadius: 16,
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.backgroundAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  codeBoxFilled: {
    borderColor: colors.primaryLight,
    backgroundColor: colors.primaryWash,
  },
  codeBoxNext: {
    borderColor: colors.primaryActive,
  },
  // The 2-second flash on a wrong code — see wrongCode's own note above.
  // Overrides codeBoxFilled/codeBoxNext by sitting after them in the array
  // both are already combined with at the call site.
  codeBoxWrong: {
    borderColor: colors.error,
    backgroundColor: colors.card,
  },
  codeDigit: {
    fontFamily: fonts.display,
    fontSize: 24,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  codeDigitWrong: {
    color: colors.error,
  },
  // Invisible and unreachable by touch — the tap target is codeRow above,
  // via its own ref-focus onPress, not this input's own hit box.
  hiddenInput: {
    position: 'absolute',
    opacity: 0,
    height: 0,
    width: 0,
  },
  errorSpacer: {
    marginTop: 14,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wrongCodeText: {
    fontWeight: '700',
    fontSize: 13,
    color: colors.error,
    textAlign: 'center',
  },
  checkingRow: {
    marginTop: 6,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  checkingText: {
    fontSize: 13.5,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  resendRow: {
    marginTop: 'auto',
    paddingBottom: 8,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  resendPrompt: {
    fontSize: 14.5,
    color: colors.textSecondary,
  },
  resendLink: {
    fontWeight: '800',
    fontSize: 14.5,
    color: colors.primaryActive,
  },
  resendLinkDisabled: {
    color: colors.textMuted,
  },
}));
