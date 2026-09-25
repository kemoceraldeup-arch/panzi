// The same Firebase project the app signs into. Firebase owns identity here and
// nothing else: no Firestore, no Storage, no Cloud Functions. What the console
// reads comes from the Express API, which verifies the token this file produces.

import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';

// Vite inlines VITE_* at build time. These values are public by design — a web
// API key identifies a project, it does not authorise anything. Access is
// decided by the `admin` custom claim, checked here for the interface and again
// by requireAdmin on the server, which is the check that actually matters.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Persistence is deliberately not set here. It is set in lib/auth.tsx, to
// browserSessionPersistence, immediately before every sign-in: this console
// reads every user's pantry, so a session that outlives the browser is a
// liability on a shared machine.
//
// This file used to set browserLocalPersistence at module load, which was both
// dead and dangerous — dead because the sign-in path overrides it a moment
// later, dangerous because the two calls raced, and the losing order would have
// quietly written a session to disk that the login screen promises it does not.
