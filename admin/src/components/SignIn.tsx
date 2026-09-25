import { useState, type FormEvent } from 'react';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { validatePassword, validateUsername } from '../lib/validate';
import { Swirling } from './Swirling';
import { AnimatedPantryWord } from './ui/AnimatedPantryWord';
import { FoodShowcase } from './ui/FoodShowcase';
import { SignInHelp } from './ui/SignInHelp';

/**
 * Firebase's error codes say more than they should to a stranger at the door.
 *
 * Wrong username and wrong password deliberately produce the same sentence: if
 * they differed, the form would answer "does this administrator exist?" for
 * anyone who cared to ask, which is the first thing worth knowing before
 * guessing passwords.
 */
function readable(err: unknown): string {
  const code = (err as { code?: string })?.code ?? '';
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
    case 'auth/invalid-email':
      return 'That username and password do not match an administrator account.';
    case 'auth/user-disabled':
      return 'That account has been suspended. Ask another administrator.';
    case 'auth/too-many-requests':
      // Firebase throttles after repeated failures. Saying so is fair: it is a
      // lockout the person can wait out, not a hint about the credentials.
      return 'Too many failed attempts. Wait a few minutes and try again.';
    case 'auth/network-request-failed':
      return 'Could not reach the sign-in service. Check your connection.';
    case 'auth/operation-not-allowed':
      return 'Email/Password sign-in is switched off in the Firebase console.';
    case 'auth/unauthorized-domain':
      return 'This domain is not listed under Firebase Authentication → Settings → Authorized domains.';
    default:
      return err instanceof Error ? err.message : String(err);
  }
}

/** Existing reveal / hide glyph, shared by both password visibility states. */
function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M1.8 12S5.6 5 12 5s10.2 7 10.2 7-3.8 7-10.2 7S1.8 12 1.8 12Z" />
      <circle cx="12" cy="12" r="3" />
      {off && <line x1="3.5" y1="20.5" x2="20.5" y2="3.5" />}
    </svg>
  );
}

export function SignIn() {
  const { signIn, expired, clearExpired } = useAuth();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Per-field errors appear only after a submit attempt. Marking a field
  // invalid while someone is still typing their first character is noise.
  const [touched, setTouched] = useState(false);
  const usernameError = touched ? validateUsername(username) : null;
  const passwordError = touched ? validatePassword(password) : null;

  function edit(setter: (value: string) => void) {
    return (value: string) => {
      setter(value);
      setFormError(null);
      if (expired) clearExpired();
    };
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setTouched(true);

    const uErr = validateUsername(username);
    const pErr = validatePassword(password);
    if (uErr || pErr) {
      setFormError('Fix the highlighted fields to continue.');
      return;
    }

    setBusy(true);
    setFormError(null);
    try {
      await signIn(username, password);
    } catch (err) {
      setFormError(readable(err));
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <section className="login-brand" aria-label="Panzi">
        <div className="login-lockup">
          <img src="/panzi-logo.png" alt="" width={46} height={46} />
          <span className="login-wordmark">panzi<span>.</span></span>
          <span className="login-workspace">Admin workspace</span>
        </div>

        <div className="login-message">
          <span className="login-eyebrow">GOOD FOOD. LESS WASTE.</span>
          <h2>A little care.<br />{' '}A fuller <AnimatedPantryWord /></h2>
          <p>
            Behind every better meal is a little organisation.
            Welcome to the workspace that keeps Panzi growing.
          </p>
          <FoodShowcase />
        </div>

        <div className="login-fineprint"><span>Thoughtful food. Everyday.</span><span>THE PANZI TEAM</span></div>
      </section>

      <div className="login-panel">
        <div className="login-panel-label"><ShieldCheck size={15} aria-hidden="true" /> Administrator access</div>
        <form className="login-form" onSubmit={onSubmit} noValidate aria-labelledby="login-title" aria-busy={busy}>
          <div className="login-heading">
            <span className="login-eyebrow">YOUR PANZI WORKSPACE</span>
            <h1 id="login-title">Welcome back.</h1>
            <p>Sign in to take care of things.</p>
          </div>

          <div className="login-card">
            {expired && (
              <div className="login-banner login-banner-warn" role="status">
                Your session reached its 8-hour limit. Sign in again to continue.
              </div>
            )}

            {formError && (
              <div className="login-banner login-banner-error" role="alert">
                {formError}
              </div>
            )}

            <div className="field">
              <label className="field-label" htmlFor="username">
                Username
              </label>
              <input
                id="username"
                className={usernameError ? 'input input-invalid' : 'input'}
                value={username}
                onChange={(event) => edit(setUsername)(event.target.value)}
                placeholder="Enter your username or email"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                disabled={busy}
                aria-invalid={usernameError ? true : undefined}
                aria-describedby={usernameError ? 'username-error' : undefined}
              />
              {usernameError && (
                <span id="username-error" className="field-error">
                  {usernameError}
                </span>
              )}
            </div>

            <div className="field">
              <label className="field-label" htmlFor="password">
                Password
              </label>
              <div className="input-with-icon">
                <input
                  id="password"
                  type={showPass ? 'text' : 'password'}
                  className={passwordError ? 'input input-invalid' : 'input'}
                  value={password}
                  onChange={(event) => edit(setPassword)(event.target.value)}
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  disabled={busy}
                  aria-invalid={passwordError ? true : undefined}
                  aria-describedby={passwordError ? 'password-error' : undefined}
                />
                <button
                  type="button"
                  className="input-icon-button"
                  onClick={() => setShowPass((value) => !value)}
                  // The icon alone says nothing to a screen reader, and its
                  // meaning flips with state, so both are stated outright.
                  aria-label={showPass ? 'Hide password' : 'Show password'}
                  aria-pressed={showPass}
                  title={showPass ? 'Hide password' : 'Show password'}
                  disabled={busy}
                >
                  <EyeIcon off={showPass} />
                </button>
              </div>
              {passwordError && (
                <span id="password-error" className="field-error">
                  {passwordError}
                </span>
              )}
            </div>

            <button type="submit" className="btn btn-primary login-submit" disabled={busy}>
              {busy ? (
                <span
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 9 }}
                >
                  {/* currentColor, so it is white on the green button without
                      naming a colour that would then have to be kept in step. */}
                  <Swirling size={15} color="currentColor" duration="1.1s" />
                  Signing in…
                </span>
              ) : (
                <>Sign in to workspace <ArrowRight size={18} aria-hidden="true" /></>
              )}
            </button>
          </div>

          <SignInHelp />
          <p className="login-session"><ShieldCheck size={16} aria-hidden="true" />
            Your workspace stays protected.<br />Sessions end after 8 hours or when you close this tab.
          </p>
        </form>
        <p className="login-panel-footer">A little organisation. A lot of possibility.</p>
      </div>
    </main>
  );
}

/** Signed in, but not an admin. A different problem, so a different screen. */
export function NotAdmin() {
  const { user, signOut, refreshClaims } = useAuth();

  return (
    <div className="gate">
      <div className="gate-card">
        <div className="overlay-title">Not an admin</div>
        <div className="gate-note">
          {user?.email} is signed in but does not carry the <code>admin</code> custom claim, so the
          API would refuse every request this console makes.
        </div>
        <div className="gate-note">
          Grant it from <code>server/</code>, then press Recheck — a claim only reaches the browser
          on the next token refresh:
        </div>
        <pre className="gate-pre">{`npx tsx scripts/grant-admin.ts ${user?.email ?? 'admin@panzi.app'}`}</pre>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            type="button"
            className="btn btn-primary"
            style={{ flex: 1 }}
            onClick={() => void refreshClaims()}
          >
            Recheck
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ flex: 1 }}
            onClick={() => void signOut()}
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
