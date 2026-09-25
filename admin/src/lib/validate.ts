// Sign-in field validation.
//
// Kept apart from the form so the rules are readable on their own and can be
// checked without a browser. None of this is a security control — a client can
// skip every one of these by calling Firebase directly. It exists to turn a
// typo into a sentence instead of a round trip and a generic failure.

/** A username: letters, digits, dot, underscore, hyphen. No spaces, no '@'. */
const USERNAME_RE = /^[a-zA-Z0-9._-]+$/;

/**
 * Deliberately loose. Strict email regexes reject addresses that are perfectly
 * valid, and the only thing this needs to catch is a shape that could not be an
 * address at all — the real check is whether Firebase knows it.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const USERNAME_MIN = 3;
const USERNAME_MAX = 64;

/** Firebase rejects anything shorter than six characters at account creation. */
const PASSWORD_MIN = 6;
const PASSWORD_MAX = 128;

export function validateUsername(raw: string): string | null {
  const value = raw.trim();
  if (!value) return 'Enter your username.';

  if (value.includes('@')) {
    // An address was typed instead of a username. Allowed — accounts created
    // with a real email still sign in — so it is validated as one.
    if (!EMAIL_RE.test(value)) return 'That email address is not complete.';
    return value.length > USERNAME_MAX ? 'That email address is too long.' : null;
  }

  if (value.length < USERNAME_MIN) {
    return `Usernames are at least ${USERNAME_MIN} characters.`;
  }
  if (value.length > USERNAME_MAX) {
    return `Usernames are at most ${USERNAME_MAX} characters.`;
  }
  if (!USERNAME_RE.test(value)) {
    return 'Use letters, numbers, dots, underscores or hyphens only.';
  }
  return null;
}

export function validatePassword(raw: string): string | null {
  if (!raw) return 'Enter your password.';
  // Not trimmed: a leading or trailing space is a legitimate part of a
  // password, and silently stripping it turns a correct one into a failed
  // sign-in with no explanation.
  if (raw.length < PASSWORD_MIN) {
    return `Passwords are at least ${PASSWORD_MIN} characters.`;
  }
  if (raw.length > PASSWORD_MAX) {
    return `Passwords are at most ${PASSWORD_MAX} characters.`;
  }
  return null;
}
