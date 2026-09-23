// src/components/profile/SecuritySheet.tsx
//
// Profile's "Sign-in & security".
//
// Firebase requires a *recent* sign-in before it will let an account change
// its own password or email — an old, still-valid session is not proof
// someone standing at the phone right now is the account's owner. Both forms
// below therefore always ask for the current password first and
// reauthenticate with it, rather than only reauthenticating after Firebase
// has already rejected the change with auth/requires-recent-login. Trying the
// change first and reauthenticating on failure would mean the input closest
// to the user's mental model ("prove it's you") only ever showing up as a
// recovery from an error, on an account that may not even have a password to
// re-enter (Facebook sign-in) — asking up front works the same way for
// every account this screen can be open on.

import React, { useState } from 'react';
import { ActivityIndicator, Modal, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
  verifyBeforeUpdateEmail,
} from 'firebase/auth';
import { auth } from '../../config/firebaseClient';
import Text from '../Text';
import { fonts, type } from '../../theme/typography';
import { makeStyles } from '../../theme/makeStyles';
import { useColors } from '../../theme/ThemeProvider';
import { space } from '../../theme/spacing';

const HIT_SLOP = { top: 12, bottom: 12, left: 12, right: 12 };
const PASSWORD_MIN_LENGTH = 8;

type Mode = 'menu' | 'password' | 'email';

type Props = {
  visible: boolean;
  email: string | null;
  onClose: () => void;
};

/** Reauthenticates against the password the user just typed. Thrown errors
 *  are Firebase's own — auth/wrong-password (and, on newer SDKs,
 *  auth/invalid-credential for the same thing) and auth/too-many-requests are
 *  the two callers need to say something specific about. */
async function reauthenticate(currentPassword: string): Promise<void> {
  const user = auth.currentUser;
  if (!user?.email) throw { code: 'auth/no-current-user' };
  const credential = EmailAuthProvider.credential(user.email, currentPassword);
  await reauthenticateWithCredential(user, credential);
}

function reauthError(err: any): string {
  switch (err?.code) {
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return "That password doesn't match your account.";
    case 'auth/too-many-requests':
      return 'Too many tries — wait a bit before trying again.';
    case 'auth/network-request-failed':
      return 'No connection. Check your network and try again.';
    default:
      return err?.message ?? 'Could not verify that — try again.';
  }
}

export default function SecuritySheet({ visible, email, onClose }: Props) {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const [mode, setMode] = useState<Mode>('menu');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  function reset() {
    setMode('menu');
    setCurrentPassword('');
    setNewPassword('');
    setNewEmail('');
    setError(null);
    setSentTo(null);
  }

  function close() {
    onClose();
    // Same reasoning as HelpSheet's close(): wait for the slide-out before
    // wiping the form, so a success state isn't snatched away mid-animation.
    setTimeout(reset, 300);
  }

  async function submitPassword() {
    if (busy) return;
    if (!currentPassword) return setError('Enter your current password.');
    if (newPassword.length < PASSWORD_MIN_LENGTH) {
      return setError(`Use at least ${PASSWORD_MIN_LENGTH} characters for the new password.`);
    }
    setBusy(true);
    setError(null);
    try {
      await reauthenticate(currentPassword);
      await updatePassword(auth.currentUser!, newPassword);
      close();
    } catch (err: any) {
      setError(reauthError(err));
    } finally {
      setBusy(false);
    }
  }

  async function submitEmail() {
    if (busy) return;
    if (!currentPassword) return setError('Enter your current password.');
    const trimmed = newEmail.trim();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      return setError("That email doesn't look right.");
    }
    setBusy(true);
    setError(null);
    try {
      await reauthenticate(currentPassword);
      // Firebase sends a confirmation link to the new address rather than
      // switching immediately — the change only takes effect once that link
      // is opened, which is what stops someone locking the real owner out by
      // typing an email they do not control.
      await verifyBeforeUpdateEmail(auth.currentUser!, trimmed);
      setSentTo(trimmed);
    } catch (err: any) {
      if (err?.code === 'auth/email-already-in-use') {
        setError('Another account already uses that email.');
      } else {
        setError(reauthError(err));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={close}>
      <View style={styles.backdrop}>
        <TouchableOpacity style={styles.backdropTap} activeOpacity={1} onPress={close} />

        <View style={[styles.sheet, { paddingBottom: insets.bottom + space.lg }]}>
          <View style={styles.grabber} />

          <View style={styles.header}>
            {mode !== 'menu' && !sentTo ? (
              <TouchableOpacity
                onPress={() => {
                  setMode('menu');
                  setError(null);
                }}
                hitSlop={HIT_SLOP}
                style={styles.backButton}
              >
                <Ionicons name="chevron-back" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            ) : (
              <View style={styles.backButton} />
            )}
            <Text style={styles.title}>Sign-in & security</Text>
            <TouchableOpacity onPress={close} hitSlop={HIT_SLOP}>
              <Ionicons name="close" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {mode === 'menu' && (
            <View style={styles.menu}>
              <Text style={styles.currentEmail}>{email ?? 'Guest account'}</Text>
              {email ? (
                <>
                  <TouchableOpacity
                    style={styles.menuRow}
                    onPress={() => setMode('password')}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.menuRowText}>Change password</Text>
                    <Ionicons name="chevron-forward" size={17} color={colors.chevron} />
                  </TouchableOpacity>
                  <View style={styles.divider} />
                  <TouchableOpacity
                    style={styles.menuRow}
                    onPress={() => setMode('email')}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.menuRowText}>Change email</Text>
                    <Ionicons name="chevron-forward" size={17} color={colors.chevron} />
                  </TouchableOpacity>
                </>
              ) : (
                // Neither a password nor an email exists on a guest account
                // to reauthenticate against or change — Firebase's anonymous
                // auth has no credential for these forms to act on. Create
                // an account first (Profile's own upgrade path) rather than
                // offering forms that could only ever fail here.
                <Text style={styles.guestNotice}>
                  Create an account to set a password and email.
                </Text>
              )}
            </View>
          )}

          {mode === 'password' && (
            <View style={styles.form}>
              <Text style={styles.eyebrow}>CURRENT PASSWORD</Text>
              <View style={styles.inputWrap}>
                <TextInput
                  style={styles.input}
                  value={currentPassword}
                  onChangeText={setCurrentPassword}
                  placeholder="Current password"
                  placeholderTextColor={colors.mutedLight}
                  secureTextEntry
                  editable={!busy}
                  autoComplete="current-password"
                />
              </View>

              <Text style={[styles.eyebrow, styles.eyebrowSpaced]}>NEW PASSWORD</Text>
              <View style={styles.inputWrap}>
                <TextInput
                  style={styles.input}
                  value={newPassword}
                  onChangeText={setNewPassword}
                  placeholder={`At least ${PASSWORD_MIN_LENGTH} characters`}
                  placeholderTextColor={colors.mutedLight}
                  secureTextEntry
                  editable={!busy}
                  autoComplete="password-new"
                />
              </View>

              {error && <Text style={styles.errorText}>{error}</Text>}

              <TouchableOpacity
                style={[styles.submit, (!currentPassword || !newPassword) && styles.submitOff]}
                onPress={submitPassword}
                disabled={busy || !currentPassword || !newPassword}
                activeOpacity={0.85}
              >
                {busy ? (
                  <ActivityIndicator color={colors.onAccent} />
                ) : (
                  <Text style={styles.submitLabel}>Update password</Text>
                )}
              </TouchableOpacity>
            </View>
          )}

          {mode === 'email' && !sentTo && (
            <View style={styles.form}>
              <Text style={styles.eyebrow}>CURRENT PASSWORD</Text>
              <View style={styles.inputWrap}>
                <TextInput
                  style={styles.input}
                  value={currentPassword}
                  onChangeText={setCurrentPassword}
                  placeholder="Current password"
                  placeholderTextColor={colors.mutedLight}
                  secureTextEntry
                  editable={!busy}
                  autoComplete="current-password"
                />
              </View>

              <Text style={[styles.eyebrow, styles.eyebrowSpaced]}>NEW EMAIL</Text>
              <View style={styles.inputWrap}>
                <TextInput
                  style={styles.input}
                  value={newEmail}
                  onChangeText={setNewEmail}
                  placeholder="you@example.com"
                  placeholderTextColor={colors.mutedLight}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  editable={!busy}
                />
              </View>

              {error && <Text style={styles.errorText}>{error}</Text>}

              <TouchableOpacity
                style={[styles.submit, (!currentPassword || !newEmail) && styles.submitOff]}
                onPress={submitEmail}
                disabled={busy || !currentPassword || !newEmail}
                activeOpacity={0.85}
              >
                {busy ? (
                  <ActivityIndicator color={colors.onAccent} />
                ) : (
                  <Text style={styles.submitLabel}>Send confirmation link</Text>
                )}
              </TouchableOpacity>
            </View>
          )}

          {sentTo && (
            <View style={styles.sentCard}>
              <Ionicons name="mail-outline" size={18} color={colors.primaryDark} />
              <Text style={styles.sentText}>
                Check {sentTo} for a link to confirm the change. Your sign-in email stays the
                same until you open it.
              </Text>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(23,23,15,0.35)',
  },
  backdropTap: {
    flex: 1,
  },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: space.xxl,
    paddingTop: space.md,
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 999,
    backgroundColor: colors.backgroundAlt,
    marginBottom: space.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.lg,
  },
  backButton: {
    width: 28,
  },
  title: {
    flex: 1,
    textAlign: 'center',
    fontFamily: fonts.display,
    fontWeight: '800',
    fontSize: type.title.fontSize,
    color: colors.primaryDarker,
  },
  menu: {
    paddingBottom: space.sm,
  },
  currentEmail: {
    fontWeight: '600',
    fontSize: type.label.fontSize,
    color: colors.textSecondary,
    marginBottom: space.lg,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: space.lg,
  },
  menuRowText: {
    fontWeight: '700',
    fontSize: type.body.fontSize,
    color: colors.primaryDarker,
  },
  guestNotice: {
    fontWeight: '600',
    fontSize: type.label.fontSize,
    lineHeight: 19,
    color: colors.textSecondary,
    paddingVertical: space.lg,
  },
  divider: {
    height: 1,
    backgroundColor: colors.divider,
  },
  form: {
    paddingBottom: space.sm,
  },
  eyebrow: {
    fontWeight: '800',
    fontSize: type.micro.fontSize,
    letterSpacing: 1.54,
    textTransform: 'uppercase',
    color: colors.tabInactive,
    marginBottom: space.sm2,
  },
  eyebrowSpaced: {
    marginTop: space.lg2,
  },
  inputWrap: {
    height: 52,
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
    paddingHorizontal: space.md2,
    justifyContent: 'center',
  },
  input: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: type.body.fontSize,
    color: colors.textPrimary,
    padding: 0,
  },
  errorText: {
    fontWeight: '700',
    fontSize: type.caption.fontSize,
    lineHeight: 17,
    color: colors.rustMuted,
    marginTop: space.md,
  },
  submit: {
    height: 50,
    borderRadius: 16,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: space.xl,
  },
  submitOff: {
    backgroundColor: colors.primaryLight,
  },
  submitLabel: {
    fontWeight: '800',
    fontSize: type.subtitle.fontSize,
    color: colors.onAccent,
  },
  sentCard: {
    flexDirection: 'row',
    gap: space.sm,
    alignItems: 'flex-start',
    backgroundColor: colors.primaryWash,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.primaryLine,
    padding: space.lg,
  },
  sentText: {
    flex: 1,
    fontWeight: '700',
    fontSize: type.label.fontSize,
    lineHeight: 19,
    color: colors.primaryDark,
  },
}));
