// src/screens/CreateAccountScreen.tsx
//
// Sign-up counterpart to SignInScreen — same visual spec (login-2a.html /
// REACT-NATIVE-NOTES.md), same layout skeleton, different copy and one extra
// field. Kept as its own screen rather than a mode flag on SignInScreen so
// the two read as separate places the way the mock's "Create account" link
// implies, rather than one form silently changing meaning under the user.

import React, { useState } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import Text from '../components/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../config/firebaseClient';
import { signInWithFacebook } from '../auth/facebookSignIn';
import { GoogleIcon, FacebookIcon } from '../components/auth/SocialIcons';
import { makeStyles } from '../theme/makeStyles';
import { useColors } from '../theme/ThemeProvider';
import { fonts, type } from '../theme/typography';

// Google sign-in can't work inside Expo Go, full stop — not a missing config
// value, a platform limit. See the same note in SignInScreen. Facebook is
// wired up for real below via react-native-fbsdk-next, which needs that same
// custom dev build to run at all.
function handleGoogleSignIn() {
  Alert.alert(
    'Not available yet',
    "Google sign-in needs a custom build of the app — it can't run inside Expo Go. Use email or guest for now."
  );
}

// Not a full RFC 5322 parser — just enough to catch the obviously-wrong
// entries (no @, no domain, stray spaces) before they round-trip to Firebase
// for the same verdict a beat later.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN_LENGTH = 6;

function getEmailError(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return 'Enter your email.';
  if (!EMAIL_PATTERN.test(trimmed)) return "That email doesn't look right.";
  return null;
}

function getPasswordError(value: string): string | null {
  if (!value) return 'Enter a password.';
  if (value.length < PASSWORD_MIN_LENGTH) return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  return null;
}

function getConfirmError(password: string, confirm: string): string | null {
  if (!confirm) return 'Re-enter your password.';
  if (confirm !== password) return "Passwords don't match.";
  return null;
}

type Props = {
  onCreated: () => void;
  onSignIn: () => void;
  onGuest: () => void;
};

export default function CreateAccountScreen({ onCreated, onSignIn, onGuest }: Props) {
  const styles = useStyles();
  const colors = useColors();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [focus, setFocus] = useState<'email' | 'password' | 'confirm' | null>(null);
  const [loading, setLoading] = useState(false);

  // Touched independently of focus: a field shouldn't turn red just for
  // having been visited, only once the user has left it behind.
  const [emailTouched, setEmailTouched] = useState(false);
  const [passwordTouched, setPasswordTouched] = useState(false);
  const [confirmTouched, setConfirmTouched] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const emailError = getEmailError(email);
  const passwordError = getPasswordError(password);
  const confirmError = getConfirmError(password, confirmPassword);

  const showEmailError = (emailTouched || submitted) && !!emailError;
  const showPasswordError = (passwordTouched || submitted) && !!passwordError;
  const showConfirmError = (confirmTouched || submitted) && !!confirmError;

  const canSubmit = !emailError && !passwordError && !confirmError;

  async function handleCreate() {
    setSubmitted(true);
    if (!canSubmit) return;

    setLoading(true);
    try {
      await createUserWithEmailAndPassword(auth, email.trim(), password);
      onCreated();
      // Deliberately still loading: see the same note in SignInScreen.
      return;
    } catch (err: any) {
      if (err.code === 'auth/email-already-in-use') {
        Alert.alert('Account already exists', 'That email already has an account — try signing in instead.');
      } else if (err.code === 'auth/weak-password') {
        Alert.alert('Password too short', `Use at least ${PASSWORD_MIN_LENGTH} characters.`);
      } else if (err.code === 'auth/invalid-email') {
        Alert.alert('Check that email', "That address doesn't look right.");
      } else if (err.code === 'auth/network-request-failed') {
        Alert.alert('No connection', 'Could not reach Firebase. Check your network and try again.');
      } else {
        Alert.alert('Sign-up failed', err.message);
      }
    }
    setLoading(false);
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
      onCreated();
      // Deliberately still loading: see the same note in handleCreate above.
      return;
    }
    setLoading(false);
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.navRow}>
            <TouchableOpacity
              style={styles.back}
              onPress={onSignIn}
              hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
              accessibilityLabel="Back to sign in"
            >
              <Text style={styles.backGlyph}>‹</Text>
            </TouchableOpacity>
            <View style={styles.spacer} />
          </View>

          <View style={styles.hero}>
            <Text style={styles.title}>Create account</Text>
            <Text style={styles.subtitle}>
              One account keeps your shelves, scans and saved recipes with you on every device.
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
                  onChangeText={setEmail}
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
                  onChangeText={setPassword}
                  onFocus={() => setFocus('password')}
                  onBlur={() => {
                    setFocus(null);
                    setPasswordTouched(true);
                  }}
                  placeholder="At least 6 characters"
                  placeholderTextColor={colors.mutedLight}
                  secureTextEntry={!showPassword}
                  autoComplete="password-new"
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

            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Confirm password</Text>
              <View
                style={[
                  styles.input,
                  focus === 'confirm' && styles.inputFocused,
                  showConfirmError && styles.inputError,
                ]}
              >
                <TextInput
                  style={styles.inputText}
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  onFocus={() => setFocus('confirm')}
                  onBlur={() => {
                    setFocus(null);
                    setConfirmTouched(true);
                  }}
                  placeholder="Re-enter your password"
                  placeholderTextColor={colors.mutedLight}
                  secureTextEntry={!showPassword}
                  autoComplete="password-new"
                />
              </View>
              {showConfirmError && <Text style={styles.errorText}>{confirmError}</Text>}
            </View>
          </View>

          <View style={styles.ctaWrap}>
            <TouchableOpacity
              style={[styles.cta, !canSubmit && styles.ctaDisabled]}
              onPress={handleCreate}
              disabled={loading || (submitted && !canSubmit)}
              activeOpacity={0.9}
            >
              {loading ? (
                <ActivityIndicator color={colors.onAccent} />
              ) : (
                <Text style={styles.ctaText}>Create account</Text>
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
            <Text style={styles.footerText}>Already have an account?</Text>
            <TouchableOpacity onPress={onSignIn} hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}>
              <Text style={styles.footerLink}>Sign in</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
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
  scrollContent: {
    paddingHorizontal: 26,
    paddingBottom: 26,
    flexGrow: 1,
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
    paddingTop: 34,
  },
  title: {
    fontFamily: fonts.display,
    fontWeight: '800',
    fontSize: 34,
    // Baloo 2's cap-height and descenders don't fit inside 36 at this size —
    // ascenders were getting clipped at the top. RN doesn't reserve any
    // leading beyond lineHeight itself, unlike the web version's line-box.
    lineHeight: 44,
    letterSpacing: -0.68,
    color: colors.textPrimary,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: type.body.fontSize,
    lineHeight: 22.5,
    color: colors.textSecondary,
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
    backgroundColor: colors.card,
    borderWidth: 1.5,
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
  ctaWrap: {
    paddingTop: 18,
  },
  cta: {
    width: '100%',
    height: 58,
    borderRadius: 19,
    backgroundColor: colors.primaryActive,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.primaryActive,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.38,
    shadowRadius: 12,
    elevation: 6,
  },
  ctaDisabled: {
    opacity: 0.5,
    shadowOpacity: 0,
    elevation: 0,
  },
  ctaText: {
    fontFamily: fonts.display,
    fontWeight: '700',
    fontSize: 19,
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
