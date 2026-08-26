// src/auth/AuthProvider.tsx
//
// The single source of truth for "who is signed in".
//
// Firebase restores a persisted session from AsyncStorage asynchronously, so
// `auth.currentUser` is null for the first few frames of every cold start.
// Anything that reads it directly during render therefore sees a signed-out
// app even when a session exists, and never re-renders once the session lands
// — which is why the app used to ask for credentials on every launch.
//
// onAuthStateChanged is the only correct way to read this: it fires once with
// the restored user (or null) after the restore completes, and again on every
// sign-in and sign-out. `initializing` stays true until that first callback,
// so callers can hold the UI instead of guessing.

import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth } from '../config/firebaseClient';

type AuthState = {
  user: User | null;
  /** Convenience: `user?.uid ?? null`, which is what most screens want. */
  uid: string | null;
  /** True until Firebase has reported the restored session (or its absence). */
  initializing: boolean;
};

const AuthContext = createContext<AuthState>({
  user: null,
  uid: null,
  initializing: true,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    uid: null,
    initializing: true,
  });

  useEffect(() => {
    return onAuthStateChanged(
      auth,
      (user) => setState({ user, uid: user?.uid ?? null, initializing: false }),
      () => {
        // A listener error means we cannot know the session — treat that as
        // signed out rather than hanging on the splash forever.
        setState({ user: null, uid: null, initializing: false });
      }
    );
  }, []);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
