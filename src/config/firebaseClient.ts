// src/config/firebaseClient.ts

import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  initializeAuth,
  getReactNativePersistence,
  getAuth,
  browserLocalPersistence,
  indexedDBLocalPersistence,
  Auth,
} from 'firebase/auth';
import { getStorage } from 'firebase/storage';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const firebaseConfig = {
  apiKey: 'AIzaSyB8gITvvAaTufQHvyj6v6pF8BxlVCP8088',
  authDomain: 'panzi-c2830.firebaseapp.com',
  projectId: 'panzi-c2830',
  storageBucket: 'panzi-c2830.firebasestorage.app',
  messagingSenderId: '860455272099',
  appId: '1:860455272099:web:e1d77f527c887b135c0916',
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// This is what keeps a user signed in across app restarts: without an explicit
// persistence, Firebase falls back to in-memory only and every cold start
// looks like a brand-new signed-out install.
//
// initializeAuth must only run once — Expo's fast refresh can re-run this
// module — so 'auth/already-initialized' falls through to getAuth, which
// returns the instance that already has AsyncStorage persistence on it. Any
// other failure is re-thrown rather than swallowed: silently degrading to
// in-memory auth is the failure mode this whole block exists to prevent, and
// it is invisible until the user restarts the app and finds themselves logged
// out again.
//
// The persistence differs per platform because the SDK ships a different auth
// build per platform: the react-native build has getReactNativePersistence and
// no browser storage, the web build has browser storage and no
// getReactNativePersistence. Each branch below only ever names the exports
// that exist in the build it runs in.
function persistence() {
  if (Platform.OS === 'web') {
    // Ordered by preference — Firebase takes the first one the browser
    // actually supports and falls back down the list.
    return [indexedDBLocalPersistence, browserLocalPersistence];
  }
  if (typeof getReactNativePersistence !== 'function') {
    // The web build of firebase/auth got bundled for a native platform, which
    // means the bundler resolved the package without the 'react-native' export
    // condition — see metro.config.js. Failing here is deliberate: the only
    // alternative is in-memory auth, which works perfectly until the app is
    // restarted and then looks like a random logout.
    throw new Error(
      'firebase/auth resolved to its web build on a native platform, so sessions ' +
        "cannot persist. Check that metro.config.js keeps 'react-native' in " +
        'resolver.unstable_conditionsByPlatform.'
    );
  }
  return getReactNativePersistence(AsyncStorage);
}

let auth: Auth;
try {
  auth = initializeAuth(app, { persistence: persistence() });
} catch (err: any) {
  if (err?.code !== 'auth/already-initialized') throw err;
  auth = getAuth(app);
}

export { auth };
export const storage = getStorage(app);
// Firebase is down to one job here: it owns identity. No Firestore client and
// no Cloud Functions client — the pantry, profile, saved recipes, scan history
// and feedback all go through our own Express server (src/config/api.ts) to
// MongoDB, and the scanner calls the same server. That is why this project
// needs neither the Blaze plan nor a Firestore security rule.
export default app;