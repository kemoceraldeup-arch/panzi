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
import {
  Quicksand_400Regular,
  Quicksand_500Medium,
  Quicksand_600SemiBold,
  Quicksand_700Bold,
} from '@expo-google-fonts/quicksand';
import { signInAnonymously, signOut } from 'firebase/auth';
import { auth } from './src/config/firebaseClient';
import { ThemeProvider, useColors, useTheme } from './src/theme/ThemeProvider';
import OnboardingScreen from './src/screens/OnboardingScreen';
import AuthSwipeStack from './src/components/auth/AuthSwipeStack';
import VerifyEmailScreen from './src/screens/VerifyEmailScreen';
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

type Flow =
  | 'onboarding'
  | 'account'
  | 'createAccount'
  | 'verifyEmail'
  | 'survey'
  | 'allSet'
  | 'dashboard';

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
  // Bumped once per AppTransition fade-in that lands on the auth screens —
  // see AppTransition's onEntered. SignInScreen's own mascot slide-in reads
  // this (via AuthSwipeStack's enteredTick prop) instead of its own mount
  // effect for the paths that go through this fade (cold start after
  // onboarding, "Skip"): starting that animation on mount ran it while the
  // screen was still hidden behind the fade at opacity 0, so it was already
  // partway or fully done by the time the fade-in actually made it visible.
  const [enteredAuthTick, setEnteredAuthTick] = useState(0);
  // Set right before AllSetScreen's "Scan my first shelf" transitions into
  // dashboard, so MainTabs knows to open the camera on its very first mount
  // rather than land on the empty dashboard the plain "Take me to the
  // dashboard" button leads to. Read once by MainTabs; nothing resets it
  // because flow only ever passes through 'allSet' once per session.
  const [autoOpenScan, setAutoOpenScan] = useState(false);

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
  // Read, not depended on: only needed once, at the moment this effect fires
  // for a given authKey, to tell a cold start apart from a live transition —
  // it must not itself retrigger the effect as flow changes afterward.
  const flowRef = useRef(flow);
  flowRef.current = flow;

  useEffect(() => {
    if (authKey === null || seenOnboarding === null) return;
    if (decidedFor.current === authKey) return;
    decidedFor.current = authKey;

    // Cold start is exactly the case flow is still null right as this
    // decision runs — a live sign-in/guest tap always leaves flow on
    // 'account' or 'createAccount' up to this point. Only a cold start can
    // be "reopening app with a session left over from before," which is the
    // one case an incomplete anonymous session should be treated as
    // abandoned rather than resumed.
    const isColdStart = flowRef.current === null;

    if (authKey === 'signed-out') {
      // Returning users who have already sat through the intro go straight to
      // the sign-in screen; only a genuinely fresh install sees the carousel.
      setFlow(seenOnboarding ? 'account' : 'onboarding');
      return;
    }

    // Signed in. A guest has no email to verify at all; a real account does,
    // and this is checked for every email/password account on every sign-in,
    // not only right after a fresh sign-up — an account created before this
    // feature shipped is still unverified and still has to clear it once.
    // auth.currentUser.emailVerified is trusted as-is when true (a verified
    // account stays verified; nothing un-verifies it), but reloaded when
    // false in case it verified moments ago in this same session and the
    // cached user object hasn't caught up yet — see finishVerification below,
    // which is the other caller of this same continuation and cannot rely on
    // this effect re-running (authKey never changes across verifying).
    let cancelled = false;
    const isAnonymous = auth.currentUser?.isAnonymous === true;

    async function continueAfterAuth() {
      if (!isAnonymous && auth.currentUser && !auth.currentUser.emailVerified) {
        try {
          await auth.currentUser.reload();
        } catch {
          // Offline or a transient error — fall through and trust the
          // (possibly stale) cached value rather than stranding the app.
        }
      }
      if (cancelled) return;
      if (!isAnonymous && auth.currentUser?.emailVerified === false) {
        setFlow('verifyEmail');
        return;
      }
      proceedPastVerification();
    }

    // One question — has this account answered the survey? — and `flow` is
    // deliberately left alone while it is asked: on a cold start it is
    // already null (so the app holds on its background), and when this
    // follows a sign-in tap the account screen stays up instead of blinking
    // through an empty frame on its way out.
    function proceedPastVerification() {
      hasCompletedProfile(authKey as string).then((done) => {
        if (cancelled) return;
        if (done) {
          setFlow('dashboard');
          return;
        }
        if (isAnonymous && isColdStart) {
          // A guest who backed out of the survey (or force-closed mid-way)
          // left behind a signed-in anonymous session — Firebase persists
          // that across restarts exactly like a real account. Reopening the
          // app must not silently resume the survey as if nothing happened;
          // it should read as a fresh start, same as someone who never
          // tapped "Continue as guest" at all. Signing out drops authKey
          // back to 'signed-out' next render, which — since seenOnboarding
          // was never marked for this never-finished guest — routes to
          // onboarding.
          void signOut(auth);
          return;
        }
        // Either a real account resuming an incomplete survey, or a guest
        // who just tapped "Continue as guest" moments ago in this same
        // session — both proceed to the survey normally.
        setFlow('survey');
      });
    }

    void continueAfterAuth();
    return () => {
      cancelled = true;
    };
  }, [authKey, seenOnboarding]);

  // The other way past 'verifyEmail', alongside the effect above — called
  // directly by VerifyEmailScreen once confirmVerificationCode succeeds,
  // since authKey itself never changes across verifying (still the same
  // uid), so the effect above would never re-run and re-decide on its own.
  // Re-derives the same isAnonymous/isColdStart-independent continuation by
  // hand rather than sharing a closure with the effect, which is torn down
  // and rebuilt on every authKey change and so cannot be reached from here.
  function finishVerification() {
    if (!authKey || authKey === 'signed-out') return;
    hasCompletedProfile(authKey).then((done) => {
      setFlow(done ? 'dashboard' : 'survey');
    });
  }

  function finishOnboarding() {
    // Deliberately does NOT persist seenOnboarding here — merely reaching
    // the end of the carousel isn't the same as actually using the app.
    // This used to mark onboarding seen for good the instant "Skip" or
    // "Create my pantry" was tapped, so someone who looked at Sign In and
    // then closed the app without ever creating an account or signing in
    // would never see the carousel again on a later cold start — the app
    // silently assumed a decision that was never actually made. Persisting
    // only happens once something real has happened: finishAccount() (a
    // real sign-in/sign-up) or finishSurvey() (a guest who actually
    // finished the survey) both still call setOnboardingSeen() themselves.
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
    // Deliberately does not call finishAccount() / setOnboardingSeen(): a
    // guest who never finishes the survey and reopens the app should land
    // back on onboarding, not resume the survey as if they had genuinely
    // committed to an account. Onboarding is only marked seen for a guest
    // once the survey actually completes, in finishSurvey below — see the
    // matching isAbandonedGuest check in the auth-listener effect above.
    await signInAnonymously(auth);
    // The auth listener decides where to go next (survey vs. dashboard); it
    // fires on the sign-in this call triggers.
  }

  function finishSurvey() {
    if (uid) void setProfileDoneCached(uid);
    setSeenOnboarding(true);
    void setOnboardingSeen();
    setFlow('allSet');
  }

  if (flow === null) return <Hold />;

  // Sign In and Create Account share one transitionKey — the swipe/push
  // feel between the two is AuthSwipeStack's own job now, not
  // AppTransition's fade, so the two flow values must not read as a change
  // to AppTransition or every "Create account" tap would fade the whole
  // screen out and back in on top of the stack's own slide.
  const transitionKey = flow === 'account' || flow === 'createAccount' ? 'auth' : flow;

  // Read straight off the live Firebase user rather than threaded through
  // CreateAccountScreen/AuthSwipeStack as a prop — by the time flow reaches
  // 'verifyEmail' the account already exists and auth.currentUser already
  // has it, on every path that can land here (a fresh sign-up, and a
  // returning email/password sign-in that never verified).
  const verifyEmailAddress = auth.currentUser?.email ?? '';

  return (
    <AppTransition
      transitionKey={transitionKey}
      onEntered={() => setEnteredAuthTick((t) => t + 1)}
    >
      {flow === 'onboarding' && <OnboardingScreen onDone={finishOnboarding} />}
      {(flow === 'account' || flow === 'createAccount') && (
        <AuthSwipeStack
          mode={flow === 'account' ? 'signIn' : 'createAccount'}
          onSignedIn={finishAccount}
          onCreateAccount={() => setFlow('createAccount')}
          onSignIn={() => setFlow('account')}
          onGuest={continueAsGuest}
          enteredTick={enteredAuthTick}
        />
      )}
      {flow === 'verifyEmail' && (
        <VerifyEmailScreen
          email={verifyEmailAddress}
          onVerified={finishVerification}
          onBack={() => {
            // There is no unverified account to "go back" to filling out —
            // it already exists. Signing out is what actually gets the user
            // somewhere useful: back to Sign In, where they can try the
            // right email, or Create Account again with a typo fixed. The
            // auth listener effect routes there on its own once authKey
            // drops to 'signed-out'.
            void signOut(auth);
          }}
        />
      )}
      {flow === 'survey' && <ProfileSurveyScreen onContinue={finishSurvey} />}
      {flow === 'allSet' && (
        <AllSetScreen
          onScanFirstShelf={() => {
            setAutoOpenScan(true);
            setFlow('dashboard');
          }}
          onGoToDashboard={() => setFlow('dashboard')}
        />
      )}
      {/* Sign-out is driven by the auth listener above, which routes back to
          the account screen on its own. MainTabs still takes the callback so
          the tab tree can unmount on the same frame as the tap rather than one
          listener hop later. */}
      {flow === 'dashboard' && (
        <MainTabs onSignOut={() => setFlow('account')} autoOpenScan={autoOpenScan} />
      )}
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
    Quicksand_400Regular,
    Quicksand_500Medium,
    Quicksand_600SemiBold,
    Quicksand_700Bold,
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
