// src/navigation/MainTabs.tsx

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, Alert, Modal, Platform } from 'react-native';
import Text from '../components/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import HomeScreen from '../screens/HomeScreen';
import ListScreen from '../screens/ListScreen'; // the pantry inventory — lives under the "Pantry" tab
import RecipesScreen from '../screens/RecipesScreen';
import ProfileScreen from '../screens/ProfileScreen';
import ScanModal from '../screens/scan/ScanModal';
import Toast from '../components/Toast';
import TabBar, { TabKey, SCAN_BUTTON_LIFT } from './TabBar';
import TabLayer from './TabLayer';
import { resetTabScroll } from './scrollCollapse';
import { useAuth } from '../auth/AuthProvider';
import { PantryItem, deletePantryItems, subscribeToPantryItems } from '../services/pantry';
import {
  onNotificationReceived,
  onNotificationTap,
  retireDuePlan,
  scheduleTestSoon,
  sendTestNow,
  syncReminders,
} from '../services/notifications';
import {
  DEFAULT_REMINDERS,
  ReminderPrefs,
  getReminderPrefs,
  getRemindersAsked,
  setReminderPrefs,
  setRemindersAsked,
} from '../services/session';
import ReminderSheet from '../components/profile/ReminderSheet';
import NotificationInbox, { Anchor } from '../components/home/NotificationInbox';
import SavedRecipesScreen from '../screens/SavedRecipesScreen';
import RecipeDetailScreen from '../screens/RecipeDetailScreen';
import CookModeScreen from '../screens/CookModeScreen';
import ChatFlow from '../screens/ChatFlow';
import { Recipe } from '../services/recipes';
import {
  SavedRecipe,
  savedKey,
  saveRecipe,
  subscribeToSavedRecipes,
  unsaveRecipe,
} from '../services/savedRecipes';
import { ScanRecord } from '../services/scans';
import { EMPTY_PROFILE, UserProfile, subscribeToProfile } from '../services/profile';
import { makeStyles } from '../theme/makeStyles';
import { useColors } from '../theme/ThemeProvider';

// Clears both the tab bar and the scan button raised out of it, so the toast
// can never sit over the primary control.
const TOAST_OFFSET = 72 + SCAN_BUTTON_LIFT;

// Tabs that paint their own backdrop rather than sitting on the flat app
// background, and so have to reach behind the status bar themselves.
//
// Every tab takes the top safe-area inset into its own content now, rather
// than spending it on a SafeAreaView padding strip above the screen. A
// SafeAreaView-painted strip is a real, separate view — same background
// colour as the screen under it or not, it is still a seam the status bar
// and Dynamic Island sit in front of rather than the screen's own content
// running underneath them the way a native iOS app's does. Profile was the
// first tab built this way (its two gradient washes made the seam obvious —
// an untinted strip above them read as a flat band across the top of the
// page), and every other tab now follows the same pattern for the same
// visual reason, just less visibly without a gradient to expose it. Each
// screen reads useSafeAreaInsets() itself and spends insets.top as
// paddingTop on its own scrollable content, so text and controls still
// clear the notch/Dynamic Island — only the screen's own background paints
// behind it, not a second, separate view.
const FULL_BLEED: TabKey[] = ['home', 'recipes', 'pantry', 'profile'];

// The tabs as the user sees them, left to right. `scan` is not in here because
// it is not a destination — it opens a modal over whichever tab is showing, so
// there is no direction to travel in.
const TAB_ORDER: TabKey[] = ['home', 'recipes', 'pantry', 'profile'];

/** -1, 0 or 1: which way along the bar this switch moves. */
function directionBetween(from: TabKey, to: TabKey): number {
  return Math.sign(TAB_ORDER.indexOf(to) - TAB_ORDER.indexOf(from));
}

type Batch = { count: number; ids: string[]; note: string | null };

type Props = {
  /** Fired after the Profile tab signs the user out, so the app can drop back
      to the auth flow. */
  onSignOut: () => void;
  /** "Scan my first shelf" on AllSetScreen lands here instead of the plain
   *  dashboard — opens the camera immediately rather than making a
   *  brand-new user find the scan tab themselves. Consumed once, on mount:
   *  the flow transition into MainTabs only ever happens this one time per
   *  session, so there's no later re-trigger to guard against. */
  autoOpenScan?: boolean;
};

export default function MainTabs({ onSignOut, autoOpenScan }: Props) {
  const styles = useStyles();
  const colors = useColors();
  const [active, setActive] = useState<TabKey>('home');
  // Which way the last switch travelled, so the layers slide the same way the
  // tab bar's pill did.
  const [direction, setDirection] = useState(0);
  // Both entries into the same flow. "Add by hand" is the scan modal opened
  // onto a review page holding one blank row, rather than a second item form
  // that would drift from the one inside the scanner.
  const [scanOpen, setScanOpen] = useState(false);
  const [scanMode, setScanMode] = useState<'camera' | 'manual'>('camera');
  // A past scan Home asked to reopen. Cleared on close so the next plain scan
  // doesn't land back on it.
  const [pendingScan, setPendingScan] = useState<ScanRecord | null>(null);
  // Category to open the pantry filtered to, set by Home's "What you've got"
  // strip. Cleared whenever the Pantry tab is reached any other way, so the
  // filter never outlives the tap that asked for it.
  const [pantryCategory, setPantryCategory] = useState<string | null>(null);
  // The Pantry tab's multi-select action bar *replaces* the tab bar rather
  // than covering it, so the tab bar has to come out while a selection runs.
  const [selecting, setSelecting] = useState(false);
  // The last batch written, while its Undo toast is still up.
  const [batch, setBatch] = useState<Batch | null>(null);
  const { uid } = useAuth();

  // Watched here rather than inside ProfileScreen, because a listener that
  // starts when the screen mounts cannot have delivered anything by the time
  // that screen paints its first frame. Profile used to open on an empty
  // profile — no chips, no notes, no photo — and then grow by all of it at once
  // when the snapshot landed, which lands mid-transition and reads as the
  // screen glitching on arrival.
  //
  // The Pantry tab never did this because its data is behind a listener that is
  // already running by the time you leave it. This gives Profile the same
  // property: the document is on hand before the tab is ever opened.
  const [profile, setProfile] = useState<UserProfile>(EMPTY_PROFILE);
  // The pantry is watched here as well as in the Pantry tab, because the
  // reminder schedule has to follow the food whichever screen the user is on —
  // and because ListScreen unmounts the moment they leave it.
  const [items, setItems] = useState<PantryItem[]>([]);
  const [reminders, setReminders] = useState<ReminderPrefs>(DEFAULT_REMINDERS);
  const [reminderSheet, setReminderSheet] = useState(false);
  // The bell and the Profile row are different doors: the bell says what has
  // happened, the row is where it gets configured.
  const [inbox, setInbox] = useState(false);
  // Where the bell was when it was tapped, so the panel can hang off it.
  const [bellAnchor, setBellAnchor] = useState<Anchor | null>(null);

  // The dishes the user kept. Watched here rather than only inside the Recipes
  // tab because Profile shows the count on a row that has to be right before
  // that tab has ever been opened.
  const [saved, setSaved] = useState<SavedRecipe[]>([]);
  const [savedOpen, setSavedOpen] = useState(false);
  const [openRecipe, setOpenRecipe] = useState<Recipe | null>(null);
  const [cooking, setCooking] = useState<Recipe | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  // Set by "Start cooking", read by RecipeDetailScreen's onDismiss — see the
  // race that prop exists to dodge, documented on RecipeDetailScreen's own
  // Props type (and used the same way in RecipesScreen's own "Start cooking").
  // Closing openRecipe still happens immediately (so the pageSheet starts
  // sliding away right on tap), but CookModeScreen's own Modal doesn't
  // present until that dismiss has actually finished.
  const pendingCookRef = useRef<Recipe | null>(null);

  useEffect(() => {
    if (!uid) {
      setProfile(EMPTY_PROFILE);
      return;
    }
    return subscribeToProfile(uid, setProfile, () => {
      // A dropped listener leaves the last known profile in place rather than
      // an error state — the tab is still usable and the next attach catches up.
    });
  }, [uid]);

  useEffect(() => {
    if (!uid) {
      setItems([]);
      return;
    }
    return subscribeToPantryItems(uid, setItems, () => {
      // Same again: the last known pantry is a better basis for the schedule
      // than none, and the next attach corrects it.
    });
  }, [uid]);

  useEffect(() => {
    if (!uid) {
      setSaved([]);
      return;
    }
    return subscribeToSavedRecipes(uid, setSaved, () => {
      // The last known list stays on screen; the next attach catches up.
    });
  }, [uid]);

  useEffect(() => {
    getReminderPrefs().then(setReminders);
  }, []);

  // Rebuilt whenever the food or the settings move. Cheap and idempotent by
  // design — it cancels our own scheduled notifications and lays them down
  // again from whatever the pantry now says.
  //
  // Caught rather than left to float: this is a fire-and-forget background
  // sync, and sign-out both flips `uid` to null (retriggering this same
  // effect) and unmounts this whole screen a beat later — a rebuild still
  // finishing its work from the old, now-stale uid at exactly that moment
  // threw as an unhandled rejection, which is what surfaced as an error
  // screen on every sign-out. Nothing here is worth interrupting the user
  // over; the next sync (next pantry change, next app open) corrects it.
  useEffect(() => {
    syncReminders(uid, items, profile, reminders).catch(() => {});
  }, [uid, items, profile, reminders]);

  const savedKeys = useMemo(
    () => new Set(saved.map((entry) => savedKey(entry.recipe))),
    [saved]
  );

  const toggleSave = useCallback(
    (recipe: Recipe) => {
      if (!uid) return;
      const call = savedKeys.has(savedKey(recipe)) ? unsaveRecipe : saveRecipe;
      // Not awaited: the listener echoes the change back and fills the heart,
      // and a failed write leaves it as it was, which is the truth.
      void call(uid, recipe).catch(() => {});
    },
    [uid, savedKeys]
  );

  const changeReminders = useCallback((next: ReminderPrefs) => {
    setReminders(next);
    void setReminderPrefs(next);
  }, []);

  // Read through a ref rather than closed over, so this can stay a stable
  // callback without ever comparing against a tab the user has already left.
  const activeRef = useRef(active);
  activeRef.current = active;

  const goTo = useCallback((tab: TabKey) => {
    if (tab === activeRef.current) return;
    setDirection(directionBetween(activeRef.current, tab));
    setActive(tab);
    // Every tab screen stays mounted (see TabLayer) and all four share one
    // collapseProgress value by design — scrolling on Pantry and glancing at
    // Home mid-scroll was never meant to reset the bar. But an actual tab
    // switch is a real page change, and the bar should greet the destination
    // fully expanded rather than however collapsed the tab left behind
    // happened to be — including Home, which used to get no reset at all.
    resetTabScroll();
  }, []);

  // A reminder that lands the user on Home has wasted the tap: they were told
  // about a specific piece of food and the pantry is where they act on it.
  useEffect(() => onNotificationTap((route) => goTo(route)), [goTo]);

  // One arriving while the app is open has no sync behind it to file it away,
  // so the history would not show it until something else changed the pantry.
  useEffect(
    () => onNotificationReceived(() => void retireDuePlan(uid).catch(() => {})),
    [uid]
  );

  // Stable identity — ListScreen reports through this from an effect.
  const handleSelectionModeChange = useCallback((value: boolean) => setSelecting(value), []);

  function requireSignIn(): boolean {
    if (uid) return true;
    Alert.alert('Sign in first', 'You need to be signed in to add to your pantry.');
    return false;
  }

  function openAdd() {
    if (!requireSignIn()) return;
    setPendingScan(null);
    setScanMode('manual');
    setScanOpen(true);
  }

  function openScan() {
    if (!requireSignIn()) return;
    setPendingScan(null);
    setScanMode('camera');
    setScanOpen(true);
  }

  // "Scan my first shelf" — opens the camera the moment this screen mounts,
  // rather than landing a brand-new user on an empty dashboard and making
  // them find the scan tab themselves. Runs once: MainTabs is only ever
  // reached this way the one time per session the flow transitions in from
  // AllSetScreen, so there's no later remount to guard against re-firing.
  useEffect(() => {
    if (autoOpenScan) openScan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Home's "finish this scan" card — straight into the rows missing a date. */
  function finishScan(scan: ScanRecord) {
    if (!requireSignIn()) return;
    setScanMode('camera');
    setPendingScan(scan);
    setScanOpen(true);
  }


  function handleChange(tab: TabKey) {
    // Scan opens modally over the current tab rather than switching to one —
    // the flow has no tab bar and returns you where you were.
    if (tab === 'scan') {
      if (!requireSignIn()) return;
      setPendingScan(null);
      setScanMode('camera');
      setScanOpen(true);
      return;
    }
    if (tab === 'pantry') setPantryCategory(null);
    goTo(tab);
  }

  /** Home's category strip — open the pantry already narrowed to one group. */
  function viewCategory(category: string | null) {
    setPantryCategory(category);
    goTo('pantry');
  }

  /**
   * Where a finished scan lands.
   *
   * Not a success screen — the pantry, with the new rows marked and Undo still
   * live. Switching the tab here is the point: the user's mental model is that
   * they just put food on a shelf, and the app should be showing them the
   * shelf.
   */
  function handleAdded(count: number, ids: string[], note: string | null) {
    setBatch({ count, ids, note });
    goTo('pantry');
    void offerReminders();
  }

  /**
   * The one moment worth asking for notifications.
   *
   * The Profile row is two taps into a settings screen most people open once,
   * and a feature nobody switches on is worth nothing. Straight after a scan
   * the user has just watched the app read a date off a label, so "want me to
   * remind you?" answers a question they are already holding — and it is the
   * moment they are most likely to say yes, which matters because iOS gives
   * exactly one chance at the system prompt.
   *
   * Asked once ever. Someone who said no should not be asked again every time
   * they fill a shelf; the Profile row is there if they change their mind.
   */
  async function offerReminders() {
    if (await getRemindersAsked()) return;
    const prefs = await getReminderPrefs();
    if (prefs.enabled) return;
    await setRemindersAsked();
    Alert.alert(
      'Want a heads-up?',
      'I can tell you the evening before something goes off, so it gets eaten instead of binned.',
      [
        { text: 'Not now', style: 'cancel' },
        { text: 'Yes, remind me', onPress: () => setReminderSheet(true) },
      ]
    );
  }

  async function undoBatch() {
    if (!batch) return;
    const { ids } = batch;
    setBatch(null);
    try {
      await deletePantryItems(ids);
    } catch (err: any) {
      Alert.alert('Could not undo that', err.message);
    }
  }

  return (
    <SafeAreaView
      style={styles.container}
      edges={FULL_BLEED.includes(active) ? [] : ['top']}
    >
      {/* Home, Recipes and Profile stay mounted permanently — TabLayer only
          fades/slides their opacity and position, it never unmounts them.
          Switching away and back used to unmount and remount HomeScreen,
          which threw away its images mid-decode and showed a blank flash of
          the empty-pantry layout for a frame before its state caught back up
          from cache. Pantry is the one exception, and stays remount-on-change:
          its `initialCategory` prop is read once into local state on mount
          (see ListScreen), so it needs a fresh mount to pick up a new
          category from Home's category strip — `key` forces that remount,
          TabLayer still animates the same way around it. */}
      <View style={styles.content}>
        <TabLayer active={active === 'home'} direction={direction}>
          <HomeScreen
            active={active === 'home'}
            onOpenChat={() => setChatOpen(true)}
            onFinishScan={finishScan}
            onViewCategory={viewCategory}
            onOpenNotifications={(anchor) => {
              setBellAnchor(anchor);
              setInbox(true);
            }}
            onScan={() => handleChange('scan')}
            onAddByHand={openAdd}
            onViewPantry={() => viewCategory(null)}
          />
        </TabLayer>
        <TabLayer active={active === 'recipes'} direction={direction}>
          <RecipesScreen onOpenProfile={() => handleChange('profile')} />
        </TabLayer>
        <TabLayer active={active === 'pantry'} direction={direction}>
          <ListScreen
            key={pantryCategory ?? ''}
            onAddByHand={openAdd}
            onScan={openScan}
            onSelectionModeChange={handleSelectionModeChange}
            // Only while the Undo toast is up. The green edging is a receipt for
            // a thing just done, not a permanent state of those rows.
            justAddedIds={batch?.ids}
            initialCategory={pantryCategory}
            profile={profile}
          />
        </TabLayer>
        <TabLayer active={active === 'profile'} direction={direction}>
          <ProfileScreen
            profile={profile}
            savedCount={saved.length}
            onOpenSaved={() => setSavedOpen(true)}
            onOpenReminders={() => setReminderSheet(true)}
            onSignOut={onSignOut}
          />
        </TabLayer>
      </View>
      {!selecting && <TabBar active={active} onChange={handleChange} />}

      {uid && (
        <ScanModal
          // Remounted per entry so a manual add never opens onto the leftovers
          // of the last camera scan, and so reopening the same scan twice
          // starts clean rather than resuming stale edits.
          key={`${scanMode}:${pendingScan?.id ?? ''}`}
          visible={scanOpen}
          uid={uid}
          startMode={scanMode}
          startScan={pendingScan}
          onClose={() => {
            setScanOpen(false);
            setPendingScan(null);
          }}
          onAdded={handleAdded}
          profile={profile}
        />
      )}

      <ChatFlow
        visible={chatOpen}
        items={items}
        onOpenRecipe={(recipe) => {
          setChatOpen(false);
          setOpenRecipe(recipe);
        }}
        onStartCooking={(recipe) => {
          setChatOpen(false);
          setCooking(recipe);
        }}
        onClose={() => setChatOpen(false)}
      />

      {/* Saved recipes, and the two screens it can lead to. Mounted here rather
          than inside ProfileScreen because the Recipes tab reaches the same
          three, and a dish opened from Profile should behave exactly as it does
          when opened from there — including Start cooking. */}
      <SavedRecipesScreen
        visible={savedOpen}
        saved={saved}
        diets={profile.dietary}
        onOpen={(recipe) => {
          setSavedOpen(false);
          setOpenRecipe(recipe);
        }}
        onClose={() => setSavedOpen(false)}
      />

      <RecipeDetailScreen
        recipe={openRecipe}
        saved={openRecipe ? savedKeys.has(savedKey(openRecipe)) : false}
        onToggleSave={() => openRecipe && toggleSave(openRecipe)}
        onStartCooking={() => {
          // Closed as cook mode opens: two stacked modals is a way to end up
          // behind the wrong one when the top is dismissed. On iOS, cook
          // mode doesn't present until onDismiss below fires, once this
          // pageSheet has actually finished closing — presenting it in this
          // same tick is exactly the same-commit race onDismiss exists to
          // dodge. onDismiss is a documented no-op on Android (RN never
          // fires it there), so Android keeps the old same-tick behaviour,
          // which never had this particular race to begin with.
          const recipe = openRecipe;
          setOpenRecipe(null);
          if (Platform.OS === 'ios') {
            pendingCookRef.current = recipe;
          } else {
            setCooking(recipe);
          }
        }}
        onClose={() => setOpenRecipe(null)}
        onDismiss={() => {
          if (pendingCookRef.current) {
            setCooking(pendingCookRef.current);
            pendingCookRef.current = null;
          }
        }}
      />

      <CookModeScreen recipe={cooking} items={items} onClose={() => setCooking(null)} />

      <NotificationInbox
        visible={inbox}
        anchor={bellAnchor}
        uid={uid}
        items={items}
        onClose={() => setInbox(false)}
      />

      <ReminderSheet
        visible={reminderSheet}
        prefs={reminders}
        onChange={changeReminders}
        onTest={() => uid && void sendTestNow(uid, items)}
        onTestSoon={() => uid && void scheduleTestSoon(uid, items)}
        onClose={() => setReminderSheet(false)}
      />

      {batch && (
        <Toast
          // Names what to eat first when the batch had something urgent in it.
          // The count alone is a receipt; the note is the reason the user
          // scanned in the first place.
          message={
            `${batch.count} item${batch.count === 1 ? '' : 's'} added` +
            (batch.note ? ` · ${batch.note}` : '')
          }
          actionLabel="Undo"
          onAction={undoBatch}
          onDismiss={() => setBatch(null)}
          bottomOffset={TOAST_OFFSET}
        />
      )}
    </SafeAreaView>
  );
}

const useStyles = makeStyles((colors) => ({
  container: {
    flex: 1,
    backgroundColor: colors.backgroundLight,
  },
  content: {
    flex: 1,
  },
}));