// Who is signed in, and whether they are allowed in here.
//
// Two separate questions. Firebase answers the first. The second is the `admin`
// custom claim, which this reads off the ID token result — the same claim
// server/src/middleware/auth.ts reads server-side. The check here only decides
// what to render; a user who edits it out of the bundle still gets 403 from
// every route, because requireAdmin does not trust the browser.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  browserSessionPersistence,
  onIdTokenChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  type User,
} from 'firebase/auth';
import { auth } from './firebase';

/**
 * Administrators sign in with a username, not an email — but Firebase Auth has
 * no concept of a username, so one is resolved to an address in this domain
 * before the call. `admin` becomes `admin@panzi.app`.
 *
 * This is a naming convention, not a security boundary. The password is still
 * hashed and checked by Firebase, the session is still a real ID token, and the
 * server still verifies both the signature and the admin claim. Nothing about
 * the login is decided in this bundle — which is the whole point, since anyone
 * can read a bundle.
 *
 * An input that already contains '@' is passed through untouched, so accounts
 * created with a real email address keep working.
 */
const ADMIN_EMAIL_DOMAIN = 'panzi.app';

export function usernameToEmail(input: string): string {
  const trimmed = input.trim().toLowerCase();
  return trimmed.includes('@') ? trimmed : `${trimmed}@${ADMIN_EMAIL_DOMAIN}`;
}

/**
 * How long a session may live before it is cut, signed in or not.
 *
 * Firebase refreshes an ID token indefinitely on its own, so without this a
 * console left open on a shared machine stays open forever. The login screen
 * promises eight hours; this is what makes that sentence true rather than
 * decoration.
 */
const SESSION_MAX_MS = 8 * 60 * 60 * 1000;
const SESSION_START_KEY = 'panzi.admin.sessionStart';
/** How often the age of the session is re-checked while the tab is open. */
const SESSION_CHECK_MS = 60 * 1000;

interface AuthState {
  user: User | null;
  isAdmin: boolean;
  /** True until Firebase has restored (or failed to restore) a session. */
  loading: boolean;
  /** Set when the session was ended by the 8-hour cap rather than by the user. */
  expired: boolean;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Re-reads the token after a claim was granted, without a sign-out cycle. */
  refreshClaims: () => Promise<void>;
  clearExpired: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

function readSessionStart(): number | null {
  try {
    const raw = localStorage.getItem(SESSION_START_KEY);
    const value = raw ? Number(raw) : NaN;
    return Number.isFinite(value) ? value : null;
  } catch {
    // Private browsing, or storage blocked. A session whose age cannot be read
    // is treated as fresh rather than as expired — locking someone out because
    // their browser refused a write would be the wrong failure.
    return null;
  }
}

function writeSessionStart(value: number | null): void {
  try {
    if (value === null) localStorage.removeItem(SESSION_START_KEY);
    else localStorage.setItem(SESSION_START_KEY, String(value));
  } catch {
    /* see readSessionStart */
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [expired, setExpired] = useState(false);

  // Held in a ref so the interval below always sees the current value without
  // being torn down and rebuilt on every token refresh.
  const signedIn = useRef(false);
  signedIn.current = user !== null;

  useEffect(() => {
    // onIdTokenChanged rather than onAuthStateChanged: the claim lives in the
    // token, so a refreshed token is exactly when the answer can change.
    return onIdTokenChanged(auth, async (next) => {
      setUser(next);
      if (!next) {
        setIsAdmin(false);
        setLoading(false);
        return;
      }
      // A restored session that has no recorded start is stamped now. It only
      // happens for a session that predates this field.
      if (readSessionStart() === null) writeSessionStart(Date.now());
      try {
        const result = await next.getIdTokenResult();
        setIsAdmin(result.claims.admin === true);
      } catch {
        // A token that cannot be read is not an admin token.
        setIsAdmin(false);
      }
      setLoading(false);
    });
  }, []);

  const endExpiredSession = useCallback(async () => {
    writeSessionStart(null);
    setExpired(true);
    await fbSignOut(auth).catch(() => {});
  }, []);

  useEffect(() => {
    const check = () => {
      if (!signedIn.current) return;
      const started = readSessionStart();
      if (started !== null && Date.now() - started > SESSION_MAX_MS) {
        void endExpiredSession();
      }
    };
    check();
    const timer = window.setInterval(check, SESSION_CHECK_MS);
    return () => window.clearInterval(timer);
  }, [endExpiredSession]);

  const refreshClaims = useCallback(async () => {
    const current = auth.currentUser;
    if (!current) return;
    const result = await current.getIdTokenResult(true);
    setIsAdmin(result.claims.admin === true);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      isAdmin,
      loading,
      expired,
      signIn: async (username, password) => {
        // Session persistence, always. The console reads every user's pantry,
        // so a session that outlives the browser is a liability on any shared
        // or borrowed machine — and "keep me signed in" defaulted to the less
        // safe answer, which is what people leave it on.
        //
        // A reload keeps the session (sessionStorage survives it); closing the
        // tab ends it. That, plus the 8-hour cap below, bounds how long a
        // walked-away-from screen stays useful to whoever finds it.
        await setPersistence(auth, browserSessionPersistence);
        setExpired(false);
        writeSessionStart(Date.now());
        await signInWithEmailAndPassword(auth, usernameToEmail(username), password);
      },
      signOut: async () => {
        writeSessionStart(null);
        setExpired(false);
        await fbSignOut(auth);
      },
      refreshClaims,
      clearExpired: () => setExpired(false),
    }),
    [user, isAdmin, loading, expired, refreshClaims]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth called outside AuthProvider');
  return ctx;
}
