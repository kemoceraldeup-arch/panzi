// src/screens/SignInScreen.tsx
//
// "Welcome back" — email/password sign-in, ported from the login-2a.html /
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

type Props = {
  onSignedIn: () => void;
  onCreateAccount: () => void;
  onGuest: () => void;
};

export default function SignInScreen({ onSignedIn, onCreateAccount, onGuest }: Props) {
  const styles = useStyles();
  const colors = useColors();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [focus, setFocus] = useState<'email' | 'password' | null>(null);
  const [loading, setLoading] = useState(false);

  // Peek-in entrance. This app has no navigation library — screens are
  // swapped by a plain conditional render in App.tsx's flow state machine,
  // which mounts a fresh SignInScreen instance on every one of the three
  // paths this needs to replay on: opening straight to it, coming back from
  // Create Account, and landing on it after sign-out. Each is a genuine
  // unmount-then-mount of this component, so a mount effect fires this
  // animation exactly once per arrival, on all three paths, with no
  // additional wiring needed.
  //
  // Start distance is 80px, not further: the mascot's resting spot (styles.
  // mascot below) already sits with 132px of its own box past the screen's
  // clipped right edge (overflow: 'hidden', for the peek-over-the-edge look
  // at rest). Starting the slide beyond 132px begins the animation somewhere
  // already fully clipped/invisible, which is what made earlier attempts
  // read as "it just pops in" regardless of duration or easing — confirmed
  // by logging the Animated.Value on every tick during testing.
  const MASCOT_SLIDE_START_X = 80;
  const mascotTranslateX = useRef(new Animated.Value(MASCOT_SLIDE_START_X)).current;
  const mascotAnim = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    const t0 = Date.now();
    console.log('[mascot] mount effect fires @0ms');
    mascotTranslateX.setValue(MASCOT_SLIDE_START_X);
    // A single animated value, nothing else running alongside it: stacking
    // scale and opacity animations in parallel on top of the slide was
    // introducing a visible frame skip mid-motion, so this goes back to
    // just the slide itself — the simplest version, and the one least
    // likely to drop a frame.
    const anim = Animated.timing(mascotTranslateX, {
      toValue: 0,
      duration: 1000,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
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
    // actually running, is the same 1000ms slide throughout. A single
    // requestAnimationFrame was enough for the sign-out/Create Account
    // paths; cold start needed one more tick of slack, so this chains
    // three — still on the order of a few milliseconds, nowhere near a
    // fixed timer's guesswork, but enough to reliably land on a clean,
    // uncontended frame before starting.
    let raf = 0;
    let ticksLeft = 3;
    const tick = () => {
      console.log('[mascot] raf tick @', Date.now() - t0, 'ms, ticksLeft was', ticksLeft);
      ticksLeft -= 1;
      if (ticksLeft > 0) {
        raf = requestAnimationFrame(tick);
        return;
      }
      if (mascotAnim.current === anim) {
        console.log('[mascot] calling .start() @', Date.now() - t0, 'ms');
        anim.start(({ finished }) =>
          console.log('[mascot] .start() callback @', Date.now() - t0, 'ms, finished =', finished)
        );
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
  }, [mascotTranslateX]);

  async function handleSignIn() {
    if (!email || !password) {
      Alert.alert('Missing info', 'Enter both an email and a password.');
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

  async function handleGuest() {
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
      {/* A sibling of the scrolling content, not a child of it — its own
          position never changes, regardless of scroll or keyboard state.
          The page does not scroll at all — nothing for the mascot to be
          dragged along with, regardless of keyboard state. Only translateX
          animates; position, size and the mascot art itself are untouched. */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.mascot,
          { transform: [{ translateX: mascotTranslateX }] },
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
          <View style={styles.hero}>
            <Text style={styles.title}>Welcome back</Text>
            <Text style={styles.subtitle}>
              Sign in to keep your shelves, scans and saved recipes on every device.
            </Text>
          </View>

          <View style={styles.fields}>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Email</Text>
              <View style={[styles.input, focus === 'email' && styles.inputFocused]}>
                <TextInput
                  style={styles.inputText}
                  value={email}
                  onChangeText={setEmail}
                  onFocus={() => setFocus('email')}
                  onBlur={() => setFocus(null)}
                  placeholder="you@example.com"
                  placeholderTextColor={colors.mutedLight}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoComplete="email"
                />
              </View>
            </View>

            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Password</Text>
              <View style={[styles.input, focus === 'password' && styles.inputFocused]}>
                <TextInput
                  style={styles.inputText}
                  value={password}
                  onChangeText={setPassword}
                  onFocus={() => setFocus('password')}
                  onBlur={() => setFocus(null)}
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
            <TouchableOpacity onPress={handleGuest} disabled={loading} activeOpacity={0.7}>
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
    // roughly the same distance from the safe-area top as before.
    paddingTop: 54,
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
  // in for the spec's fixed 390.
  mascot: {
    position: 'absolute',
    left: '100%',
    marginLeft: -132,
    top: 105,
    width: 168,
    height: 184,
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
  guestText: {
    height: 48,
    paddingHorizontal: 20,
    fontSize: type.body.fontSize,
    fontWeight: '700',
    color: colors.textSecondary,
    textAlignVertical: 'center',
    lineHeight: 48,
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
