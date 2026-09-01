// src/screens/SignInScreen.tsx
//
// Email/password sign-in, ported from the login-2a.html /
// REACT-NATIVE-NOTES.md spec. Values (positions, sizes, colors) are pulled
// from that spec; colors are mapped onto the app's existing theme tokens
// (see the comment by each color) rather than hardcoded, so this screen
// still follows dark mode like the rest of the app.
//
// Google/Facebook stay disabled with the same "needs a custom build" alert
// AccountScreen already used — Expo Go has no way to register the native
// OAuth redirect either provider needs; see the note above those two
// handlers.

import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
  Animated,
  Easing,
} from 'react-native';
import Text from '../components/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../config/firebaseClient';
import { signInWithFacebook } from '../auth/facebookSignIn';
import Mascot from '../components/Mascot';
import { GoogleIcon, FacebookIcon } from '../components/auth/SocialIcons';
import { makeStyles } from '../theme/makeStyles';
import { useColors } from '../theme/ThemeProvider';
import { fonts, type } from '../theme/typography';

// Google sign-in can't work inside Expo Go, full stop — not a missing config
// value, a platform limit. Expo's own docs (docs.expo.dev/guides/authentication)
// say OAuth providers need a development build, because Expo Go has no way to
// register the native redirect scheme Google's SDK needs. Facebook is wired
// up for real below via react-native-fbsdk-next, which needs that same
// custom dev build to run at all — see signInWithFacebook.
function handleGoogleSignIn() {
  Alert.alert(
    'Not available yet',
    "Google sign-in needs a custom build of the app — it can't run inside Expo Go. Use email or guest for now."
  );
}

// hero's own paddingTop (styles.hero below) — kept as a named constant so
// hero's style and its own onLayout-based height calc can't silently drift
// apart if this value ever changes.
const HERO_TOP_PADDING = 54;
// The mascot's own box (styles.mascot) is 184px tall, but only its top
// portion — head and raised hand — is the part meant to sit level with the
// title/subtitle text; the rest of the box is empty space below the
// artwork by design (the art itself is bottom-aligned within mascotArt).
// Resting the box's TOP at hero's full measured height was pushing that
// mostly-empty lower two-thirds down into the email field on some devices,
// and even the art itself could reach the field when hero's text wrapped
// shorter than usual. Lifting the box up by roughly a third of its own
// height keeps the visible artwork level with the subtitle while keeping
// the whole box's bottom edge above where the fields below start, on any
// device — this is a fixed fraction of the mascot's own size, not a screen
// measurement, so it can't drift with device height the way a pixel guess
// tuned on one device did.
const MASCOT_HEIGHT = 184;
const MASCOT_LIFT = Math.round(MASCOT_HEIGHT / 3);
// Used only for the render or two before hero's real onLayout measurement
// lands — see the mascot's render comment. 105 is the original, previously
// tuned resting position from before this became a measured value; close
// enough to correct that swapping to the real measurement a moment later
// causes no visible jump, since the mascot is still off-screen at that point.
const DEFAULT_MASCOT_TOP = 105;

type Props = {
  onSignedIn: () => void;
  onCreateAccount: () => void;
  onGuest: () => void;
  /** Bumps once each time AppTransition's fade-in finishes landing on this
   *  screen — see App.tsx/AppTransition.tsx. Every real arrival at this
   *  screen (cold start, onboarding's "Skip", sign-out, coming back from
   *  Create Account) goes through that fade — App.tsx's `transitionKey`
   *  changes on every one of those, including sign-out, which turned out not
   *  to be the fade-free case an earlier version of this comment assumed.
   *  This screen mounts while still fully transparent, partway through the
   *  fade — starting the mascot's slide-in on mount ran the whole animation
   *  behind that invisible curtain, finishing (or nearly finishing) before
   *  the screen was ever actually visible, which read as an instant pop
   *  regardless of how the animation itself was tuned. This tick is the
   *  first moment the screen is verifiably visible, so it — not this
   *  component's own mount — is what the entrance animation waits on. */
  enteredTick: number;
};

export default function SignInScreen({ onSignedIn, onCreateAccount, onGuest, enteredTick }: Props) {
  const styles = useStyles();
  const colors = useColors();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [focus, setFocus] = useState<'email' | 'password' | null>(null);
  const [loading, setLoading] = useState(false);
  // Measured, not guessed: the hero block's real rendered height varies with
  // font scaling, locale-driven line wraps, and device width (subtitle wraps
  // differently at different widths), so a hardcoded pixel offset for where
  // the mascot should rest was correct on the device it was tuned on and
  // wrong — overlapping the subtitle text — on others. null until the first
  // layout pass; the mascot doesn't render at all until then.
  const [heroHeight, setHeroHeight] = useState<number | null>(null);

  // Touched once a field has had any content typed into it — from then on
  // its error updates live on every keystroke, matching CreateAccountScreen.
  const [emailTouched, setEmailTouched] = useState(false);
  const [passwordTouched, setPasswordTouched] = useState(false);

  const emailError = !email.trim() ? 'Enter your email.' : null;
  const passwordError = !password ? 'Enter your password.' : null;

  const showEmailError = emailTouched && !!emailError;
  const showPasswordError = passwordTouched && !!passwordError;

  // Peek-in entrance. This app has no navigation library — screens are
  // swapped by a plain conditional render in App.tsx's flow state machine.
  // SignInScreen mounts fresh on the two paths that land here: a cold start
  // (or after onboarding's "Skip") and after signing out. Both go through
  // AppTransition's fade (see enteredTick's doc comment above for why that
  // matters for when this animation is allowed to start), so both replay
  // this entrance. Create Account → back does NOT remount this screen —
  // AuthSwipeStack keeps SignInScreen mounted underneath the whole time
  // Create Account is showing, the same way a real navigation stack doesn't
  // replay a screen's entrance just because something was pushed on top of
  // it and popped back off.
  //
  // Fully off-screen — the mascot's resting spot (styles.mascot below)
  // already sits with 132px of its own box past the screen's clipped right
  // edge (overflow: 'hidden', for the peek-over-the-edge look at rest), so
  // 140 clears that with a little to spare. An earlier version of this
  // started the entrance from only 80px (partially visible the whole time,
  // reasoning that starting beyond 132 begins somewhere already invisible)
  // — that trade turned out to backfire: with only a short, already-mostly-
  // visible distance to travel, the motion read as too subtle to perceive as
  // a slide, especially against the keyboard duck-out/in (which does use
  // this same fully-hidden distance and reads clearly). Using one shared
  // distance for both means the entrance gets the same unambiguous
  // hidden-to-visible motion the duck animation already does.
  const MASCOT_SLIDE_START_X = 140;
  const MASCOT_DUCK_X = MASCOT_SLIDE_START_X;
  const mascotTranslateX = useRef(new Animated.Value(MASCOT_SLIDE_START_X)).current;
  const mascotAnim = useRef<Animated.CompositeAnimation | null>(null);
  const hasAnimatedMascot = useRef(false);
  // True only once the entrance slide has actually finished playing, not
  // merely started — hasAnimatedMascot flips the instant the entrance
  // effect below begins (before its RAF-deferred .start() even runs), so it
  // can't be what gates the keyboard-duck effect: a fast tap into a field
  // during that ~2s entrance would otherwise start a second animation on
  // the same value while the first was still mid-flight, the exact
  // "two animations fighting over one value" this whole file exists to
  // avoid.
  const entranceFinished = useRef(false);
  // The enteredTick value seen on this screen's very first render — the
  // baseline a later, genuinely new bump is measured against. See the
  // effect below.
  //
  // A useState lazy initializer, not a ref set inside an effect: the
  // initializer runs synchronously during this component's very first
  // render, before ANY effect anywhere has had a chance to run. Capturing it
  // inside a useEffect instead lost a real race on a cold start that skips
  // onboarding straight to this screen — AppTransition's own "first screen,
  // no fade" mount effect could fire and bump enteredTick before this
  // screen's effect got around to recording its baseline, so the baseline
  // ended up already-bumped and nothing was ever left to compare against —
  // the mascot stayed stuck at its hidden starting position forever.
  const [initialTick] = useState(enteredTick);

  useEffect(() => {
    // Waits for enteredTick to actually CHANGE from whatever it was when
    // this screen first rendered, not just for this component to mount —
    // see the prop's doc comment above for why a bare mount effect started
    // the animation while the screen was still invisible. AppTransition's
    // onEntered firing — either the one-time "first screen was already
    // visible" case, or a real transition's fade-in completing — is what
    // actually moves enteredTick away from the baseline captured above.
    if (heroHeight === null || enteredTick === initialTick || hasAnimatedMascot.current) return;
    hasAnimatedMascot.current = true;

    mascotTranslateX.setValue(MASCOT_SLIDE_START_X);
    // Still a single animated value doing the whole thing — stacking scale
    // and opacity animations IN PARALLEL alongside the slide was what
    // introduced a visible frame skip earlier, not sequencing two motions on
    // this one value one after another. The slide covers most of the
    // distance and eases out short of 0 (OVERSHOOT_PAST_ZERO past it, in the
    // negative direction, i.e. slightly further onto the screen than rest),
    // then a low-tension spring pulls it back to exactly 0 — read as a soft
    // settle rather than a second, separate motion.
    const OVERSHOOT_PAST_ZERO = 6;
    const anim = Animated.sequence([
      Animated.timing(mascotTranslateX, {
        toValue: -OVERSHOOT_PAST_ZERO,
        duration: 900,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.spring(mascotTranslateX, {
        toValue: 0,
        // Loose enough to read as a settle, damped enough that it does not
        // visibly oscillate back and forth — one soft overshoot-and-recover,
        // not a bounce that repeats.
        friction: 6,
        tension: 60,
        useNativeDriver: true,
      }),
    ]);
    mascotAnim.current = anim;
    // Deferred a few frames rather than started immediately: this effect can
    // fire while something heavier is still mid-commit — MainTabs' whole tab
    // tree tearing down on sign-out, or on a true cold start, fonts/Firebase
    // auth/the onboarding-seen check all still settling around the same
    // moment SignInScreen mounts for the first time. Either way the
    // animation's initial handoff to the native driver can land on a
    // contended frame and get dropped or delayed, so the mascot sits still
    // for an extra beat before any motion is visible — reading as "shows
    // late" or "just pops in" even though the animation itself, once
    // actually running, is the same slide-then-settle throughout. A single
    // requestAnimationFrame was enough for the sign-out/Create Account
    // paths; cold start needed one more tick of slack, so this chains
    // three — still on the order of a few milliseconds, nowhere near a
    // fixed timer's guesswork, but enough to reliably land on a clean,
    // uncontended frame before starting.
    let raf = 0;
    let ticksLeft = 3;
    const tick = () => {
      ticksLeft -= 1;
      if (ticksLeft > 0) {
        raf = requestAnimationFrame(tick);
        return;
      }
      if (mascotAnim.current === anim) {
        anim.start(({ finished }) => {
          if (finished) entranceFinished.current = true;
        });
      }
    };
    raf = requestAnimationFrame(tick);
    // Only one animation instance is ever live: a fresh mount always starts
    // clean, and this cancels the pending start (or stops the animation if
    // it had already begun) before this instance unmounts.
    return () => {
      cancelAnimationFrame(raf);
      anim.stop();
    };
  }, [mascotTranslateX, heroHeight, enteredTick]);

  // Ducks out of the way while a field is focused (the keyboard is up and
  // the user is typing), and slides back in once neither field is — reusing
  // the same value the entrance animation drives, not a second one, so the
  // two motions can never fight over the mascot's position. Skipped until
  // the entrance has actually FINISHED playing (entranceFinished, not
  // merely started) — see that ref's own note on why the distinction
  // matters. A field focused before the entrance ever runs (in principle,
  // on a very fast tap) is also skipped for the same reason: ducking out
  // before the mascot has been seen sliding in at all would just look like
  // it never arrived.
  useEffect(() => {
    if (!entranceFinished.current) return;
    const typing = focus !== null;
    Animated.timing(mascotTranslateX, {
      toValue: typing ? MASCOT_DUCK_X : 0,
      duration: 260,
      easing: typing ? Easing.in(Easing.cubic) : Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [focus, mascotTranslateX]);

  async function handleSignIn() {
    if (emailError || passwordError) {
      setEmailTouched(true);
      setPasswordTouched(true);
      Alert.alert(
        'Missing info',
        emailError && passwordError
          ? 'Enter both an email and a password.'
          : emailError ?? passwordError!
      );
      return;
    }
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      onSignedIn();
      // Deliberately still loading: the app swaps this screen out as soon as
      // the auth listener reports the new session, and clearing the spinner
      // first would flash the button back for that frame.
      return;
    } catch (err: any) {
      if (err.code === 'auth/network-request-failed') {
        Alert.alert('No connection', 'Could not reach Firebase. Check your network and try again.');
      } else if (
        err.code === 'auth/user-not-found' ||
        err.code === 'auth/invalid-credential' ||
        err.code === 'auth/wrong-password'
      ) {
        Alert.alert('Check your details', "That email and password don't match an account.");
      } else if (err.code === 'auth/invalid-email') {
        Alert.alert('Check that email', "That address doesn't look right.");
      } else {
        Alert.alert('Sign-in failed', err.message);
      }
    }
    setLoading(false);
  }

  function handleForgotPassword() {
    Alert.alert(
      'Reset your password',
      email.trim()
        ? `A reset link will go to ${email.trim()} once this is wired up.`
        : 'Enter your email above first, then tap this again.'
    );
  }

  function handleGuest() {
    Alert.alert(
      'Continue as guest?',
      'You can create an account anytime.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Continue', onPress: confirmGuest },
      ]
    );
  }

  async function confirmGuest() {
    setLoading(true);
    try {
      await onGuest();
    } finally {
      setLoading(false);
    }
  }

  async function handleFacebookSignIn() {
    setLoading(true);
    const signedIn = await signInWithFacebook();
    if (signedIn) {
      onSignedIn();
      // Deliberately still loading: see the note in handleSignIn above.
      return;
    }
    setLoading(false);
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      {/* Always mounted — never conditionally added to the tree later. It
          used to render nothing at all until heroHeight's first measurement
          landed, which meant the mascot was genuinely absent for the first
          render or two and then appeared abruptly once it finally mounted,
          reading as a pop-in no slide-in timing fix could paper over: an
          element that isn't there yet can't be seen sliding.

          Positioned against the screen (screen has overflow: 'hidden'), not
          the hero block — that clip is what makes the "peeking over the
          edge" look work at all. `top` prefers the hero block's own MEASURED
          height (via hero's onLayout below) once available, so the mascot
          rests at the right point relative to the title/subtitle regardless
          of device width or how the subtitle wraps — but falls back to
          DEFAULT_MASCOT_TOP for the render or two before that measurement
          exists. That fallback only ever matters while the mascot is still
          sitting off-screen at its hidden translateX, so swapping to the
          real measured value the instant it arrives is invisible — nothing
          about it is animated, and there's nothing on screen at that
          position yet to visibly jump. */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.mascot,
          {
            // heroHeight already includes hero's own paddingTop (its
            // measured height runs from hero's top edge, which sits right
            // at the top of scrollContent, to its bottom edge) — adding
            // HERO_TOP_PADDING again here would double-count it.
            top: (heroHeight ?? DEFAULT_MASCOT_TOP) - MASCOT_LIFT,
            transform: [{ translateX: mascotTranslateX }],
          },
        ]}
      >
        <Mascot pose="peek" style={styles.mascotArt} />
      </Animated.View>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <View style={styles.scrollContent}>
          <View
            style={styles.hero}
            onLayout={(e) => setHeroHeight(e.nativeEvent.layout.height)}
          >
            <Text style={styles.title}>Welcome to Panzi</Text>
            <Text style={styles.subtitle}>
              Sign in to keep your shelves, scans and saved recipes on every device.
            </Text>
          </View>

          <View style={styles.fields}>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Email</Text>
              <View
                style={[
                  styles.input,
                  focus === 'email' && styles.inputFocused,
                  showEmailError && styles.inputError,
                ]}
              >
                <TextInput
                  style={styles.inputText}
                  value={email}
                  onChangeText={(text) => {
                    setEmail(text);
                    setEmailTouched(true);
                  }}
                  onFocus={() => setFocus('email')}
                  onBlur={() => {
                    setFocus(null);
                    setEmailTouched(true);
                  }}
                  placeholder="you@example.com"
                  placeholderTextColor={colors.mutedLight}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoComplete="email"
                />
              </View>
              {showEmailError && <Text style={styles.errorText}>{emailError}</Text>}
            </View>

            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Password</Text>
              <View
                style={[
                  styles.input,
                  focus === 'password' && styles.inputFocused,
                  showPasswordError && styles.inputError,
                ]}
              >
                <TextInput
                  style={styles.inputText}
                  value={password}
                  onChangeText={(text) => {
                    setPassword(text);
                    setPasswordTouched(true);
                  }}
                  onFocus={() => setFocus('password')}
                  onBlur={() => {
                    setFocus(null);
                    setPasswordTouched(true);
                  }}
                  placeholder="Your password"
                  placeholderTextColor={colors.mutedLight}
                  secureTextEntry={!showPassword}
                  autoComplete="password"
                />
                <TouchableOpacity
                  onPress={() => setShowPassword((v) => !v)}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                >
                  <Text style={styles.toggleText}>{showPassword ? 'Hide' : 'Show'}</Text>
                </TouchableOpacity>
              </View>
              {showPasswordError && <Text style={styles.errorText}>{passwordError}</Text>}
            </View>

            <View style={styles.forgotRow}>
              <TouchableOpacity
                onPress={handleForgotPassword}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Text style={styles.textLink}>Forgot password?</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.ctaWrap}>
            <TouchableOpacity
              style={styles.cta}
              onPress={handleSignIn}
              disabled={loading}
              activeOpacity={0.9}
            >
              {loading ? (
                <ActivityIndicator color={colors.onAccent} />
              ) : (
                <Text style={styles.ctaText}>Sign in</Text>
              )}
            </TouchableOpacity>
          </View>

          <View style={styles.divider}>
            <View style={styles.dividerRule} />
            <Text style={styles.dividerLabel}>or continue with</Text>
            <View style={styles.dividerRule} />
          </View>

          <View style={styles.social}>
            <TouchableOpacity
              style={styles.socialButton}
              onPress={handleGoogleSignIn}
              activeOpacity={0.8}
              accessibilityLabel="Continue with Google"
            >
              <GoogleIcon size={26} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.socialButton}
              onPress={handleFacebookSignIn}
              disabled={loading}
              activeOpacity={0.8}
              accessibilityLabel="Continue with Facebook"
            >
              <FacebookIcon size={26} />
            </TouchableOpacity>
          </View>

          <View style={styles.guestRow}>
            <TouchableOpacity
              style={styles.guestButton}
              onPress={handleGuest}
              disabled={loading}
              activeOpacity={0.7}
            >
              <Text style={styles.guestText}>Continue as guest</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.footer}>
            <Text style={styles.footerText}>New to Panzi?</Text>
            <TouchableOpacity onPress={onCreateAccount} hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}>
              <Text style={styles.footerLink}>Create account</Text>
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
    // spec screenBg #FBF6EC
    backgroundColor: colors.backgroundLight,
    overflow: 'hidden',
  },
  flex: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 26,
    paddingBottom: 26,
    flexGrow: 1,
  },
  hero: {
    // Replaces the nav row's own paddingTop (14) + height (40) that used to
    // sit above this, now that the wordmark row is gone — keeps the title
    // roughly the same distance from the safe-area top as before. Must match
    // HERO_TOP_PADDING above — the mascot's screen-relative top is computed
    // from that constant plus this block's own measured height.
    paddingTop: HERO_TOP_PADDING,
    paddingRight: 118,
  },
  title: {
    fontFamily: fonts.display,
    fontWeight: '800',
    fontSize: 34,
    // Baloo 2's cap-height and descenders don't fit inside 36 at this size —
    // "back"'s ascenders were getting clipped at the top. RN doesn't reserve
    // any leading beyond lineHeight itself, unlike the web version's line-box.
    lineHeight: 44,
    letterSpacing: -0.68,
    color: colors.textPrimary,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: type.body.fontSize,
    lineHeight: 22.5,
    // spec muted #7C8375
    color: colors.textSecondary,
    maxWidth: 250,
  },
  // Positioned against the SCREEN (screen has overflow: 'hidden'), not the
  // hero block. Right edge runs 40px past the screen edge on purpose,
  // clipped by the screen's own overflow:hidden, so only the hand and part
  // of the face show "gripping" the side — the actual screen width stands
  // in for the spec's fixed 390. `top` is NOT set here — it's computed from
  // hero's real measured height (see the inline style where this renders)
  // rather than a fixed pixel guess, since a hardcoded offset was only
  // correct on the device it was tuned on.
  mascot: {
    position: 'absolute',
    left: '100%',
    marginLeft: -132,
    width: 168,
    height: MASCOT_HEIGHT,
    zIndex: 2,
  },
  // Fills the animated wrapper above — the transform lives on the parent so
  // the mascot's own width/height (and therefore its aspect ratio) never
  // change, only its position and scale.
  mascotArt: {
    width: '100%',
    height: '100%',
  },
  fields: {
    paddingTop: 28,
    gap: 10,
  },
  field: {
    gap: 6,
  },
  fieldLabel: {
    fontWeight: '700',
    fontSize: 12.5,
    color: colors.textSecondary,
  },
  input: {
    height: 56,
    borderRadius: 16,
    // spec surface (input fill) #FFFFFF
    backgroundColor: colors.card,
    borderWidth: 1.5,
    // spec border #E6DECC
    borderColor: colors.backgroundAlt,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  inputFocused: {
    borderColor: colors.primaryActive,
  },
  inputError: {
    borderColor: colors.error,
  },
  errorText: {
    fontWeight: '600',
    fontSize: 12.5,
    color: colors.error,
    marginTop: 2,
  },
  inputText: {
    flex: 1,
    fontSize: 15.5,
    color: colors.textPrimary,
    paddingVertical: 0,
  },
  toggleText: {
    paddingLeft: 12,
    fontWeight: '700',
    fontSize: 13,
    color: colors.primaryActive,
  },
  forgotRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingTop: 2,
  },
  textLink: {
    fontWeight: '700',
    fontSize: 13.5,
    color: colors.textSecondary,
  },
  ctaWrap: {
    paddingTop: 18,
  },
  cta: {
    width: '100%',
    height: 58,
    borderRadius: 19,
    // spec primary #2F6B41
    backgroundColor: colors.primaryActive,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.primaryActive,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.38,
    shadowRadius: 12,
    elevation: 6,
  },
  ctaText: {
    fontFamily: fonts.display,
    fontWeight: '700',
    fontSize: 19,
    // spec screenBg — the cream text on the dark button
    color: colors.backgroundLight,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingTop: 30,
    paddingBottom: 20,
  },
  dividerRule: {
    flex: 1,
    height: 1,
    backgroundColor: colors.backgroundAlt,
  },
  dividerLabel: {
    fontWeight: '700',
    fontSize: 12,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    // spec faint #9AA093
    color: colors.textMuted,
  },
  social: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 18,
  },
  socialButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.backgroundAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  guestRow: {
    paddingTop: 22,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  guestButton: {
    height: 48,
    paddingHorizontal: 24,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: colors.backgroundAlt,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  guestText: {
    fontSize: type.body.fontSize,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  footer: {
    marginTop: 'auto',
    paddingTop: 20,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  footerText: {
    fontSize: 14.5,
    color: colors.textSecondary,
  },
  footerLink: {
    fontWeight: '800',
    fontSize: 14.5,
    color: colors.primaryActive,
  },
}));
