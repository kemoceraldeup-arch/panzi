// App.tsx

import React, { useEffect, useRef, useState } from 'react';
import { StatusBar, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import {
  Baloo2_600SemiBold,
  Baloo2_700Bold,
  Baloo2_800ExtraBold,
} from '@expo-google-fonts/baloo-2';
import {
  Nunito_400Regular,
  Nunito_600SemiBold,
  Nunito_700Bold,
  Nunito_800ExtraBold,
} from '@expo-google-fonts/nunito';
import { signInAnonymously } from 'firebase/auth';
import { auth } from './src/config/firebaseClient';
import { ThemeProvider, useColors, useTheme } from './src/theme/ThemeProvider';
import OnboardingScreen from './src/screens/OnboardingScreen';
import AuthSwipeStack from './src/components/auth/AuthSwipeStack';
import ProfileSurveyScreen from './src/screens/ProfileSurveyScreen';
import AllSetScreen from './src/screens/AllSetScreen';
import MainTabs from './src/navigation/MainTabs';
import AppTransition from './src/components/AppTransition';
import { AuthProvider, useAuth } from './src/auth/AuthProvider';
import { hasCompletedProfile } from './src/services/profile';
import {
  getOnboardingSeen,
  setOnboardingSeen,
  setProfileDoneCached,
} from './src/services/session';

type Flow = 'onboarding' | 'account' | 'createAccount' | 'survey' | 'allSet' | 'dashboard';

/** Held on the app's own background — see the note in App below. */
function Hold() {
  const colors = useColors();
  return <View style={{ flex: 1, backgroundColor: colors.backgroundLight }} />;
}

/**
 * The status bar, following the theme.
 *
 * Separate from App so it sits inside ThemeProvider — dark glyphs on a charcoal
 * bar are invisible, and it is the one piece of chrome the app draws that the
 * palette cannot reach through a stylesheet.
 */
function ThemedStatusBar() {
  const { colors } = useTheme();
  return <StatusBar barStyle={colors.statusBar} />;
}

function Root() {
  const { uid, initializing } = useAuth();

  // Whether the intro carousel has ever been finished on this device. null
  // while the flag is still being read off disk.
  const [seenOnboarding, setSeenOnboarding] = useState<boolean | null>(null);
  // null means "not decided yet" — hold rather than render a guess. Picking a
  // starting screen before the persisted session has been restored is exactly
  // what made the app ask for credentials on every launch.
  const [flow, setFlow] = useState<Flow | null>(null);

  useEffect(() => {
    let cancelled = false;
    getOnboardingSeen().then((seen) => {
      if (!cancelled) setSeenOnboarding(seen);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Identity of the current auth answer. Deliberately a string rather than the
  // uid alone, so "signed out" is a value that can be compared like any other.
  const authKey = initializing ? null : uid ?? 'signed-out';

  // Which authKey the landing screen below was chosen for. Without this, every
  // re-render would re-run the decision and stomp on the screen the user has
  // since moved to (survey -> allSet -> dashboard all share one signed-in uid).
  const decidedFor = useRef<string | null>(null);

  useEffect(() => {
    if (authKey === null || seenOnboarding === null) return;
    if (decidedFor.current === authKey) return;
    decidedFor.current = authKey;

    if (authKey === 'signed-out') {
      // Returning users who have already sat through the intro go straight to
      // the sign-in screen; only a genuinely fresh install sees the carousel.
      setFlow(seenOnboarding ? 'account' : 'onboarding');
      return;
    }

    // Signed in. One more question — has this account answered the survey? —
    // and `flow` is deliberately left alone while it is asked: on a cold start
    // it is already null (so the app holds on its background), and when this
    // follows a sign-in tap the account screen stays up instead of blinking
    // through an empty frame on its way out.
    let cancelled = false;
    hasCompletedProfile(authKey).then((done) => {
      if (!cancelled) setFlow(done ? 'dashboard' : 'survey');
    });
    return () => {
      cancelled = true;
    };
  }, [authKey, seenOnboarding]);

  function finishOnboarding() {
    setSeenOnboarding(true);
    void setOnboardingSeen();
    setFlow('account');
  }

  function finishAccount() {
    // Signing in got here, so the intro is behind them for good — otherwise a
    // guest who signs out would be shown the carousel again.
    setSeenOnboarding(true);
    void setOnboardingSeen();
    // The auth listener decides where to go next (survey vs. dashboard); it
    // fires on the sign-in that this callback follows.
  }

  async function continueAsGuest() {
    await signInAnonymously(auth);
    finishAccount();
  }

  function finishSurvey() {
    if (uid) void setProfileDoneCached(uid);
    setFlow('allSet');
  }

  if (flow === null) return <Hold />;

  // Sign In and Create Account share one transitionKey — the swipe/push
  // feel between the two is AuthSwipeStack's own job now, not
  // AppTransition's fade, so the two flow values must not read as a change
  // to AppTransition or every "Create account" tap would fade the whole
  // screen out and back in on top of the stack's own slide.
  const transitionKey = flow === 'account' || flow === 'createAccount' ? 'auth' : flow;

  return (
    <AppTransition transitionKey={transitionKey}>
      {flow === 'onboarding' && <OnboardingScreen onDone={finishOnboarding} />}
      {(flow === 'account' || flow === 'createAccount') && (
        <AuthSwipeStack
          mode={flow === 'account' ? 'signIn' : 'createAccount'}
          onSignedIn={finishAccount}
          onCreateAccount={() => setFlow('createAccount')}
          onSignIn={() => setFlow('account')}
          onGuest={continueAsGuest}
        />
      )}
      {flow === 'survey' && <ProfileSurveyScreen onContinue={finishSurvey} />}
      {flow === 'allSet' && (
        <AllSetScreen
          onScanFirstShelf={() => setFlow('dashboard')}
          onGoToDashboard={() => setFlow('dashboard')}
        />
      )}
      {/* Sign-out is driven by the auth listener above, which routes back to
          the account screen on its own. MainTabs still takes the callback so
          the tab tree can unmount on the same frame as the tap rather than one
          listener hop later. */}
      {flow === 'dashboard' && <MainTabs onSignOut={() => setFlow('account')} />}
    </AppTransition>
  );
}

export default function App() {
  const [fontsLoaded, fontError] = useFonts({
    Baloo2_600SemiBold,
    Baloo2_700Bold,
    Baloo2_800ExtraBold,
    Nunito_400Regular,
    Nunito_600SemiBold,
    Nunito_700Bold,
    Nunito_800ExtraBold,
  });

  // Hold on the app's own background rather than rendering the tree — text
  // laid out in the system font and then reflowed into Nunito is a visible
  // jump on first paint. A plain cream view reads as the splash still being
  // up. If the fonts fail outright we render anyway (fontError): a system-font
  // app beats a screen that never appears.
  if (!fontsLoaded && !fontError) {
    return (
      <GestureHandlerRootView style={{ flex: 1 }}>
        <ThemeProvider>
          <Hold />
        </ThemeProvider>
      </GestureHandlerRootView>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider>
        <SafeAreaProvider>
          <ThemedStatusBar />
          <AuthProvider>
            <Root />
          </AuthProvider>
        </SafeAreaProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
