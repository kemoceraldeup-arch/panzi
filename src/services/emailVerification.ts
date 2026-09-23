// src/services/emailVerification.ts
//
// Sign-up email verification, by 6-digit code — see server/src/routes/
// verifyEmail.ts for the half of this that actually sends and checks it.
// Both calls need a signed-in Firebase user, which a freshly created account
// already is by the time either is ever called (see App.tsx's routing).
//
// The lockout timestamp is mirrored into AsyncStorage (see
// getCachedLockout/setCachedLockout below) purely so VerifyEmailScreen can
// paint the countdown on the very first frame after a cold start or a
// backgrounded app returning — before any network round trip could have
// answered. The server's own `lockedUntilMs` (returned on every 423) is
// still the one source of truth this is ever corrected against; the cache
// is read once, on mount, never trusted over a fresher server answer, and
// cleared the moment verification actually succeeds.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiFetch, ApiError } from '../config/api';
import { auth } from '../config/firebaseClient';

const LOCKOUT_KEY_PREFIX = 'panzi.emailVerifyLockedUntil.';

function lockoutKey(uid: string): string {
  return LOCKOUT_KEY_PREFIX + uid;
}

/** The persisted unlock time for the signed-in account, or null if there is
 *  none cached (never locked, or already read past and cleared). */
export async function getCachedLockout(): Promise<number | null> {
  const uid = auth.currentUser?.uid;
  if (!uid) return null;
  try {
    const raw = await AsyncStorage.getItem(lockoutKey(uid));
    if (!raw) return null;
    const ms = Number(raw);
    // A stored time that has already passed is stale, not a real lockout —
    // treated the same as never having cached one, rather than the caller
    // having to separately check "is this in the past".
    return Number.isFinite(ms) && ms > Date.now() ? ms : null;
  } catch {
    return null;
  }
}

async function setCachedLockout(lockedUntilMs: number | null): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  try {
    if (lockedUntilMs === null) {
      await AsyncStorage.removeItem(lockoutKey(uid));
    } else {
      await AsyncStorage.setItem(lockoutKey(uid), String(lockedUntilMs));
    }
  } catch {
    // Worst case the countdown starts from a network round trip instead of
    // instantly on next launch — the server's own 423 still catches it.
  }
}

/** Sends a fresh code to the signed-in account's own email. Resolves with
 *  the email it went to, so the screen can show "Sent to you@example.com"
 *  without re-reading auth.currentUser itself. Throws ApiError with
 *  code 'locked' (and details.lockedUntilMs) if a lockout is still active —
 *  also cached locally so a later cold start knows without asking. */
export async function sendVerificationCode(): Promise<{ email: string; alreadyVerified?: boolean }> {
  try {
    const result = await apiFetch<{ email: string; alreadyVerified?: boolean }>(
      '/api/verify-email/send',
      {}
    );
    return result;
  } catch (err) {
    if (err instanceof ApiError && err.code === 'locked') {
      await setCachedLockout(err.details.lockedUntilMs as number);
    }
    throw err;
  }
}

/** Checks a typed code. Throws ApiError on a wrong/expired/too-many-tries
 *  code — the screen reads err.message straight off that for what to show,
 *  and err.details.attemptsLeft / err.details.lockedUntilMs for the
 *  structured numbers the wrong-code and lockout states need. */
export async function confirmVerificationCode(code: string): Promise<void> {
  try {
    await apiFetch('/api/verify-email/confirm', { code });
    // Success clears any cached lockout outright — a fresh code was
    // necessarily requested (and accepted) after any prior lockout ended.
    await setCachedLockout(null);
  } catch (err) {
    if (err instanceof ApiError && err.code === 'locked') {
      await setCachedLockout(err.details.lockedUntilMs as number);
    }
    throw err;
  }
}

/**
 * Whether the signed-in account's email is verified, reading the freshest
 * answer rather than whatever the SDK cached at sign-in. `user.emailVerified`
 * is a snapshot from the moment the token was issued; confirmVerificationCode
 * changes it on the server, not on this client's copy, so a plain read right
 * after confirming would still say false. `reload()` re-fetches the account
 * record itself before this reads the field.
 */
export async function isEmailVerified(): Promise<boolean> {
  const user = auth.currentUser;
  if (!user) return false;
  await user.reload();
  return user.emailVerified;
}

export { ApiError };
