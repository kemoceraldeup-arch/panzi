// src/auth/facebookSignIn.ts
//
// Shared by SignInScreen and CreateAccountScreen — both "Continue with
// Facebook" buttons do the same thing: open Facebook's native login sheet
// (via react-native-fbsdk-next), then hand the access token it returns to
// Firebase to mint a real session. One place for this so the two screens
// can't drift into different permission sets or error handling.
//
// Requires a custom dev build — react-native-fbsdk-next is native code and
// cannot run inside Expo Go. Its own top-level import reaches for that
// native module immediately, before any function here even runs, so a
// plain `import ... from 'react-native-fbsdk-next'` at the top of this file
// would crash the instant this module loads inside Expo Go — not just when
// signInWithFacebook is called. The require() below is deferred inside the
// function specifically so that only happens if this ever actually runs
// outside Expo Go.

import Constants, { ExecutionEnvironment } from 'expo-constants';
import { FacebookAuthProvider, signInWithCredential } from 'firebase/auth';
import { Alert } from 'react-native';
import { auth } from '../config/firebaseClient';

const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

/** Resolves once signed in to Firebase; resolves to false if the user
 *  cancelled, isn't able to (Expo Go), or the flow failed (an alert has
 *  already been shown in every case). */
export async function signInWithFacebook(): Promise<boolean> {
  if (isExpoGo) {
    Alert.alert(
      'Not available yet',
      "Facebook sign-in needs a custom build of the app — it can't run inside Expo Go. Use email or guest for now."
    );
    return false;
  }

  const { LoginManager, AccessToken } = require('react-native-fbsdk-next');

  try {
    const result = await LoginManager.logInWithPermissions(['public_profile', 'email']);
    if (result.isCancelled) return false;

    const tokenData = await AccessToken.getCurrentAccessToken();
    if (!tokenData) {
      Alert.alert('Facebook sign-in failed', 'Could not get an access token from Facebook.');
      return false;
    }

    const credential = FacebookAuthProvider.credential(tokenData.accessToken);
    await signInWithCredential(auth, credential);
    return true;
  } catch (err: any) {
    if (err.code === 'auth/account-exists-with-different-credential') {
      Alert.alert(
        'Account already exists',
        'That email is already used with a different sign-in method — try signing in with email or Google instead.'
      );
    } else if (err.code === 'auth/network-request-failed') {
      Alert.alert('No connection', 'Could not reach Firebase. Check your network and try again.');
    } else {
      Alert.alert('Facebook sign-in failed', err.message ?? String(err));
    }
    return false;
  }
}
