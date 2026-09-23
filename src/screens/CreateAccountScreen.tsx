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
  TouchableWithoutFeedback,
  ScrollView,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
} from 'react-native';
import Text from '../components/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../config/firebaseClient';
import { createProfile } from '../services/profile';
import { makeStyles } from '../theme/makeStyles';
import { useColors } from '../theme/ThemeProvider';
import { fonts, type } from '../theme/typography';
import PrivacySheet from '../components/profile/PrivacySheet';
import { Ionicons } from '@expo/vector-icons';

// Not a full RFC 5322 parser — just enough to catch the obviously-wrong
// entries (no @, no domain, stray spaces) before they round-trip to Firebase
// for the same verdict a beat later.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Firebase's own floor is 6 and won't enforce anything past length — this
// app's own policy is stricter than that default, so it has to be checked
// here, not left to the auth/weak-password error Firebase would otherwise
// never actually raise.
const PASSWORD_MIN_LENGTH = 8;
const SPECIAL_CHAR_PATTERN = /[^A-Za-z0-9]/;
const SPACE_PATTERN = /\s/;

function getEmailError(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return 'Enter your email.';
  if (!EMAIL_PATTERN.test(trimmed)) return "That email doesn't look right.";
  return null;
}

/** Every rule a password must satisfy, checked independently so the UI can
 *  show each one ticking live as the user types instead of only surfacing
 *  whichever is wrong first. */
type PasswordChecks = {
  length: boolean;
  noSpaces: boolean;
  capital: boolean;
  number: boolean;
  special: boolean;
};

function getPasswordChecks(value: string): PasswordChecks {
  return {
    length: value.length >= PASSWORD_MIN_LENGTH,
    noSpaces: !SPACE_PATTERN.test(value),
    capital: /[A-Z]/.test(value),
    number: /[0-9]/.test(value),
    special: SPECIAL_CHAR_PATTERN.test(value),
  };
}

/** One rule at a time, most-basic first — a password missing three things
 *  only ever shows the first one it's missing, not a stacked list, so the
 *  message always names the very next thing to fix rather than everything
 *  at once. Spaces are checked right after emptiness since a password full
 *  of spaces would otherwise pass the length check and confuse the reason. */
function getPasswordError(value: string): string | null {
  if (!value) return 'Enter a password.';
  if (SPACE_PATTERN.test(value)) return 'Passwords can\'t contain spaces.';
  if (value.length < PASSWORD_MIN_LENGTH) return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (!/[A-Z]/.test(value)) return 'Add at least one capital letter.';
  if (!/[0-9]/.test(value)) return 'Add at least one number.';
  if (!SPECIAL_CHAR_PATTERN.test(value)) return 'Add at least one special character.';
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

/** One live-checked requirement line — ticks over to a checkmark the moment
 *  its rule is satisfied, so the user sees progress as they type instead of
 *  finding out what's still wrong only after submitting. */
function PasswordRule({ met, label }: { met: boolean; label: string }) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={styles.passwordRuleRow}>
      <Ionicons
        name={met ? 'checkmark-circle' : 'ellipse-outline'}
        size={14}
        color={met ? colors.primaryActive : colors.textMuted}
      />
      <Text style={[styles.passwordRuleItem, met && styles.passwordRuleItemMet]}>{label}</Text>
    </View>
  );
}

export default function CreateAccountScreen({ onCreated, onSignIn, onGuest }: Props) {
  const styles = useStyles();
  const colors = useColors();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [focus, setFocus] = useState<'email' | 'password' | 'confirm' | null>(null);
  const [loading, setLoading] = useState(false);

  // Touched once a field has had any content typed into it — from then on
  // its error updates live on every keystroke, not just after leaving it.
  // Still not from the very first render, so a blank fresh field doesn't
  // open already showing "Enter your email."
  const [emailTouched, setEmailTouched] = useState(false);
  const [passwordTouched, setPasswordTouched] = useState(false);
  const [confirmTouched, setConfirmTouched] = useState(false);

  // Gates both signup paths — Create account and Continue as guest — because
  // a guest still gets a row in this server's database the moment either flow
  // finishes (createProfile below, or its equivalent on the guest path). The
  // sheet itself is the same one Profile shows later; nothing here duplicates
  // its text, so a change to what Panzi actually does only has to be made once.
  const [agreed, setAgreed] = useState(false);
  const [showTerms, setShowTerms] = useState(false);

  const emailError = getEmailError(email);
  const passwordError = getPasswordError(password);
  const passwordChecks = getPasswordChecks(password);
  const confirmError = getConfirmError(password, confirmPassword);

  const showEmailError = emailTouched && !!emailError;
  const showPasswordError = passwordTouched && !!passwordError;
  const showConfirmError = confirmTouched && !!confirmError;

  const canSubmit = !emailError && !passwordError && !confirmError && agreed;

  async function handleCreate() {
    if (!canSubmit) return;

    setLoading(true);
    try {
      await createUserWithEmailAndPassword(auth, email.trim(), password);
      // Guarantees a database row exists the moment signup succeeds, rather
      // than waiting on the onboarding survey to create one later. Best-
      // effort: a account that's created in Firebase but never gets its row
      // here still gets one the moment the survey runs (its own upsert),
      // so a network hiccup on this call is not allowed to block or fail
      // the signup the user is actually waiting on.
      try {
        await createProfile();
      } catch (createErr) {
        console.warn('createProfile failed after signup — the survey upsert will still cover it', createErr);
      }
      onCreated();
      // Deliberately still loading: see the same note in SignInScreen.
      return;
    } catch (err: any) {
      if (err.code === 'auth/email-already-in-use') {
        Alert.alert('Account already exists', 'That email already has an account — try signing in instead.');
      } else if (err.code === 'auth/weak-password') {
        Alert.alert(
          'Password too weak',
          `Use at least ${PASSWORD_MIN_LENGTH} characters, with a capital letter, a number, and a special character.`
        );
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

  function handleGuest() {
    if (!agreed) {
      Alert.alert('Privacy & terms', 'Please agree to the privacy notice and terms first.');
      return;
    }
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

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <ScrollView
            style={styles.flex}
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
                    // Stripped rather than merely flagged — a password full
                    // of spaces would otherwise sail past every other check
                    // and only fail server-side, or worse, not fail at all.
                    const noSpaces = text.replace(/\s/g, '');
                    setPassword(noSpaces);
                    setPasswordTouched(true);
                    // Confirm Password's own error depends on password too
                    // (must match it) — once Confirm has been touched, its
                    // error needs to re-evaluate live as password changes,
                    // not just when confirmPassword itself changes.
                    if (confirmPassword) setConfirmTouched(true);
                  }}
                  onFocus={() => setFocus('password')}
                  onBlur={() => {
                    setFocus(null);
                    setPasswordTouched(true);
                  }}
                  placeholder="Password"
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

              <View style={styles.passwordRules}>
                <PasswordRule met={passwordChecks.length} label="At least 8 characters" />
                <PasswordRule met={passwordChecks.capital} label="1 capital letter" />
                <PasswordRule met={passwordChecks.number} label="1 number" />
                <PasswordRule met={passwordChecks.special} label="1 special character" />
              </View>
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
                  onChangeText={(text) => {
                    setConfirmPassword(text);
                    setConfirmTouched(true);
                  }}
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

          <TouchableOpacity
            style={styles.consentRow}
            onPress={() => setAgreed((v) => !v)}
            activeOpacity={0.7}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: agreed }}
          >
            <View style={[styles.checkbox, agreed && styles.checkboxChecked]}>
              {agreed && <Ionicons name="checkmark" size={14} color={colors.backgroundLight} />}
            </View>
            <Text style={styles.consentText}>
              I agree to Panzi&apos;s{' '}
              <Text style={styles.consentLink} onPress={() => setShowTerms(true)}>
                Privacy & terms
              </Text>
            </Text>
          </TouchableOpacity>

          <View style={styles.ctaWrap}>
            <TouchableOpacity
              style={[styles.cta, !canSubmit && styles.ctaDisabled]}
              onPress={handleCreate}
              disabled={loading || !canSubmit}
              activeOpacity={0.9}
            >
              {loading ? (
                <ActivityIndicator color={colors.onAccent} />
              ) : (
                <Text style={styles.ctaText}>Create account</Text>
              )}
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
            <Text style={styles.footerText}>Already have an account?</Text>
            <TouchableOpacity onPress={onSignIn} hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}>
              <Text style={styles.footerLink}>Sign in</Text>
            </TouchableOpacity>
          </View>
          </ScrollView>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>

      <PrivacySheet visible={showTerms} onClose={() => setShowTerms(false)} />
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
  consentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingTop: 18,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.backgroundAlt,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkboxChecked: {
    backgroundColor: colors.primaryActive,
    borderColor: colors.primaryActive,
  },
  consentText: {
    flex: 1,
    fontSize: 13.5,
    lineHeight: 19,
    color: colors.textSecondary,
  },
  consentLink: {
    fontWeight: '800',
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
  guestRow: {
    paddingTop: 30,
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
  passwordRules: {
    marginTop: 8,
    gap: 5,
  },
  passwordRuleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  passwordRuleItemMet: {
    color: colors.primaryActive,
    fontWeight: '700',
  },
  passwordRuleItem: {
    fontSize: 12.5,
    lineHeight: 17,
    color: colors.textMuted,
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
