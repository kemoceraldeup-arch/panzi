// src/screens/ProfileScreen.tsx
//
// The Profile tab, built to the "Panzi Profile Screen" handoff.
//
// The organising idea from the handoff: preferences live on the surface,
// everything else lives behind a row. Diet and allergy chips are editable in
// place because they change what the app recommends; the remaining settings
// collapse into two groups of disclosure rows so the page stays about one and
// a half screens.
//
// Chip edits save straight to Firestore — no Save button. A removal is
// recoverable through the undo toast rather than a confirm dialog, so the
// common case (tap the wrong chip) costs one tap to fix and the normal case
// costs nothing.

import React, { useCallback, useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Switch,
  Image,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Text from '../components/Text';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { signOut, User } from 'firebase/auth';
import { auth } from '../config/firebaseClient';
import { useAuth } from '../auth/AuthProvider';
import Toast from '../components/Toast';
import ChipPickerSheet from '../components/profile/ChipPickerSheet';
import HelpSheet from '../components/profile/HelpSheet';
import PrivacySheet from '../components/profile/PrivacySheet';
import { SCAN_BUTTON_LIFT } from '../navigation/TabBar';
import {
  COMMON_ALLERGENS,
  COMMON_DIETS,
  UserProfile,
  saveAllergies,
  saveDietary,
  saveProfilePhoto,
} from '../services/profile';
import { pickProfilePhoto } from './scan/pickItemPhoto';
import { removeProfilePhoto, uploadProfilePhoto } from '../services/photos';
import {
  EVERYDAY_TOTAL,
  everydayDishesLeft,
  isEnforceable,
  needsCertificationNote,
} from '../utils/diet';
import { fonts, type } from '../theme/typography';
import { makeStyles } from '../theme/makeStyles';
import { useColors, useTheme } from '../theme/ThemeProvider';
import { space } from '../theme/spacing';

// The app version shown on the footer line. Kept next to the screen that
// prints it — expo-constants isn't a dependency, and app.json's version is not
// readable from JS without one.
const APP_VERSION = '1.0';

const HIT_SLOP = { top: 12, bottom: 12, left: 12, right: 12 };


type PickerTarget = 'diet' | 'allergy' | null;
// What the undo toast can put back.
type Removal = { group: 'diet' | 'allergy'; value: string; index: number };

// "Cooking with Panzi since March" — from the auth account's creation date,
// which is the only join date the app records. Takes the user rather than
// reading auth.currentUser so it re-computes when the signed-in account
// changes, instead of showing the previous account's join date.
function membershipLabel(user: User | null): string | null {
  const created = user?.metadata.creationTime;
  if (!created) return null;
  const date = new Date(created);
  if (Number.isNaN(date.getTime())) return null;
  const month = date.toLocaleDateString(undefined, { month: 'long' });
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return `Cooking with Panzi since ${month}${sameYear ? '' : ` ${date.getFullYear()}`}`;
}

function initialOf(name: string | null, email: string | null): string {
  const source = name?.trim() || email?.trim() || '';
  return source ? source.charAt(0).toUpperCase() : '?';
}

function comingSoon(label: string) {
  Alert.alert(label, "This screen isn't built yet.");
}

type Props = {
  /**
   * Owned by MainTabs, which keeps the listener running for as long as the tabs
   * are up. Held there rather than here so the first frame this screen paints
   * already has the real chips on it — a listener started on mount cannot
   * deliver before that frame, and the catch-up was visible as the card
   * growing a moment after the tab opened.
   */
  profile: UserProfile;
  /** How many dishes the user has kept. Counted by MainTabs, which holds the
   *  listener, so this row is right before the Recipes tab has been opened. */
  savedCount: number;
  /** Opens the saved-recipes list, which MainTabs owns because the Recipes tab
   *  reaches the same screen. */
  onOpenSaved: () => void;
  /** Opens the reminder settings sheet, which MainTabs owns because the bell on
   *  Home opens the same one. */
  onOpenReminders: () => void;
  onSignOut: () => void;
};

export default function ProfileScreen({
  profile,
  savedCount,
  onOpenSaved,
  onOpenReminders,
  onSignOut,
}: Props) {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, uid } = useAuth();
  const email = user?.email ?? null;

  const [picker, setPicker] = useState<PickerTarget>(null);
  // Owned here rather than by MainTabs: unlike saved recipes, nothing else in
  // the app opens either of these.
  const [help, setHelp] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [removal, setRemoval] = useState<Removal | null>(null);
  // The just-picked file, shown while its upload is still in the air. The
  // document only ever holds the Storage URL, so without this the avatar would
  // sit on the old picture for the length of the upload — on a slow connection,
  // long enough to read as a tap that did nothing.
  const [pendingPhoto, setPendingPhoto] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);

  // Chip edits write to Firestore and come back down as a new `profile` prop.
  // Firestore applies a pending write locally before it reaches the server, so
  // the chip still moves on the same frame as the tap, a change made anywhere
  // else (the onboarding survey, another device) shows up without a reload, and
  // a rejected write rolls the chip back on its own rather than leaving the UI
  // lying.
  // Single write path for both chip groups.
  const commit = useCallback(
    (next: UserProfile, group: 'diet' | 'allergy') => {
      // Signed out, so there is no document to write to and nothing local to
      // write it to either. Nothing on this screen is reachable in that state.
      if (!uid) return;
      const write =
        group === 'diet' ? saveDietary(uid, next.dietary) : saveAllergies(uid, next.allergies);
      write.catch((err: any) => Alert.alert('Could not save that', err.message));
    },
    [uid]
  );

  function addChip(group: 'diet' | 'allergy', value: string) {
    const key = group === 'diet' ? 'dietary' : 'allergies';
    // Allergies are stored as one comma-separated string, so a comma inside a
    // chip would split it into two on the next read.
    const clean = value.replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
    if (!clean) return;
    const current = profile[key];
    if (current.some((c) => c.toLowerCase() === clean.toLowerCase())) return;
    commit({ ...profile, [key]: [...current, clean] }, group);
  }

  function removeChip(group: 'diet' | 'allergy', value: string) {
    const key = group === 'diet' ? 'dietary' : 'allergies';
    const index = profile[key].indexOf(value);
    if (index < 0) return;
    commit({ ...profile, [key]: profile[key].filter((_, i) => i !== index) }, group);
    // Remembering the index means undo puts the chip back where it was rather
    // than reordering the row.
    setRemoval({ group, value, index });
  }

  function undoRemoval() {
    if (!removal) return;
    const { group, value, index } = removal;
    const key = group === 'diet' ? 'dietary' : 'allergies';
    const restored = [...profile[key]];
    restored.splice(Math.min(index, restored.length), 0, value);
    commit({ ...profile, [key]: restored }, group);
    setRemoval(null);
  }

  const applyPhoto = useCallback(async () => {
    const picked = await pickProfilePhoto();
    if (!picked || !uid) return;

    setPendingPhoto(picked.uri);
    setPhotoBusy(true);
    try {
      const url = await uploadProfilePhoto(picked);
      await saveProfilePhoto(uid, url);
      // Warm the cache before handing over, so the swap from the local file to
      // the Storage URL is invisible rather than a blank circle for a frame.
      await Image.prefetch(url).catch(() => {});
      setPendingPhoto(null);
    } catch (err: any) {
      // The old picture (or the initial) is what's true if this failed, so the
      // local one goes away with the error rather than lingering as a photo
      // the account doesn't actually have.
      setPendingPhoto(null);
      Alert.alert('Could not save that photo', err?.message ?? 'Try again in a moment.');
    } finally {
      setPhotoBusy(false);
    }
  }, [uid]);

  async function removePhoto() {
    if (!uid) return;
    setPendingPhoto(null);
    setPhotoBusy(true);
    try {
      // The stored object goes first. Clearing the field on a file still
      // sitting in a public bucket would leave the picture reachable by anyone
      // who kept the URL, which is not what "remove" means.
      await removeProfilePhoto();
      await saveProfilePhoto(uid, null);
    } catch (err: any) {
      Alert.alert('Could not remove that photo', err?.message ?? 'Try again in a moment.');
    } finally {
      setPhotoBusy(false);
    }
  }

  function editPhoto() {
    if (photoBusy) return;
    if (!hasPhoto) {
      void applyPhoto();
      return;
    }
    // Only worth a menu once there is something to replace or clear.
    Alert.alert('Profile photo', undefined, [
      { text: 'Change photo', onPress: () => void applyPhoto() },
      { text: 'Remove photo', style: 'destructive', onPress: () => void removePhoto() },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  function confirmSignOut() {
    Alert.alert('Sign out?', "You'll need to sign in again to reach your pantry.", [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          try {
            await signOut(auth);
            onSignOut();
          } catch (err: any) {
            Alert.alert('Could not sign out', err.message);
          }
        },
      },
    ]);
  }

  const membership = membershipLabel(user);
  const photoUri = pendingPhoto ?? profile.photoURL;
  const hasPhoto = !!photoUri;

  return (
    <View style={styles.container}>
      {/* The screen wash — soft radials in the design, layered linear
          gradients here because RN has no radial gradient and no multi-
          background shorthand. The base stays the app background so the scan
          button's cutout ring still matches what is behind the tab bar. */}
      <LinearGradient
        colors={[colors.washGreen, colors.washGreenFade]}
        start={{ x: 1, y: 0 }}
        end={{ x: 0.2, y: 0.55 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <LinearGradient
        colors={[colors.washPeach, colors.washPeachFade]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0.7, y: 0.5 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      <ScrollView
        style={{ flex: 1 }}
        // The status-bar inset is spent here rather than by the safe area
        // above, so the washes behind this list run all the way to the top of
        // the screen. See FULL_BLEED in navigation/MainTabs.
        contentContainerStyle={[styles.content, { paddingTop: insets.top + space.sm }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ---------------- Hero ----------------

            Flat, not the original 165deg gradient. The gradient's last stop was
            neutral enough to read as grey against the rest of the page, which
            looked like a fault rather than a design; one colour holds the card's
            identity in both schemes and needs no per-theme stop list. */}
        <View style={styles.hero}>
          <View style={styles.avatarWrap}>
            {/* The whole circle is the target, not just the badge — a 78pt
                photo is the obvious thing to tap, and the 26pt badge alone
                would be the only way in. */}
            <TouchableOpacity
              style={styles.avatar}
              activeOpacity={0.85}
              onPress={editPhoto}
              accessibilityRole="button"
              accessibilityLabel={hasPhoto ? 'Change profile photo' : 'Add a profile photo'}
            >
              {/* The letter is always underneath, never swapped out for the
                  photo. A remote photo takes a moment to arrive however early
                  the URL is known, and a circle that goes letter, blank, photo
                  is a worse arrival than one that goes letter, photo. */}
              <Text style={styles.avatarInitial}>{initialOf(profile.name, email)}</Text>
              {photoUri && <Image source={{ uri: photoUri }} style={styles.avatarImage} />}
              {photoBusy && (
                <View style={styles.avatarBusy}>
                  <ActivityIndicator size="small" color={colors.card} />
                </View>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.cameraBadge}
              hitSlop={HIT_SLOP}
              onPress={editPhoto}
              accessibilityRole="button"
              accessibilityLabel={hasPhoto ? 'Change profile photo' : 'Add a profile photo'}
            >
              <Ionicons name="camera-outline" size={14} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <View style={styles.heroText}>
            <Text style={styles.name} numberOfLines={1}>
              {profile.name?.trim() || 'Your profile'}
            </Text>
            {membership && (
              <View style={styles.membershipPill}>
                <View style={styles.membershipDot} />
                <Text style={styles.membershipLabel} numberOfLines={1}>
                  {membership}
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* ---------------- Saved recipes ---------------- */}
        <TouchableOpacity
          style={styles.savedCard}
          activeOpacity={0.8}
          onPress={onOpenSaved}
        >
          <View style={styles.savedIcon}>
            <Ionicons name="bookmark" size={15} color={colors.primaryDark} />
          </View>
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>Saved recipes</Text>
            <Text style={styles.rowSubtitle}>
              {savedCount === 0
                ? 'Nothing saved yet'
                : `${savedCount} kept for later`}
            </Text>
          </View>
          <Chevron />
        </TouchableOpacity>

        {/* ---------------- What you eat ---------------- */}
        <View style={styles.prefsCard}>
          <Text style={styles.cardTitle}>What you eat</Text>
          <Text style={styles.cardSubtitle}>
            Panzi builds every suggestion around these.
          </Text>

          <Text style={styles.eyebrow}>DIET</Text>
          <View style={styles.chipRow}>
            {profile.dietary.map((value) => (
              <Chip
                key={value}
                label={value}
                tone="diet"
                soft={!isEnforceable(value)}
                onRemove={() => removeChip('diet', value)}
              />
            ))}
            <AddChip onPress={() => setPicker('diet')} />
          </View>

          {/* Only when something on the list can't be checked. A footnote that
              appears whatever you pick stops being read. */}
          {profile.dietary.some((value) => !isEnforceable(value)) && (
            <Text style={styles.dietNote}>
              Solid chips are checked ingredient by ingredient. Hollow ones are about how
              much, not what, so Panzi aims for them rather than guaranteeing them.
            </Text>
          )}

          {/* Nothing stops someone ticking every chip, and each one felt true
              when they read it. Rather than let them find out through an empty
              Recipes tab, the combination is measured against everyday food and
              the number is shown. Not a block — their diet is their business —
              just the consequence, at the moment they can still act on it. */}
          {everydayDishesLeft(profile.dietary) <= 2 && profile.dietary.length > 1 && (
            <View style={styles.tightNote}>
              <Ionicons name="alert-circle-outline" size={15} color={colors.rustMuted} />
              <Text style={styles.certNoteText}>
                That&apos;s a very tight combination — only{' '}
                {everydayDishesLeft(profile.dietary)} of {EVERYDAY_TOTAL} everyday dishes get
                through it. Panzi will suggest what it can, but expect short lists.
              </Text>
            </View>
          )}

          {/* The limit, said out loud. Panzi never claims a dish IS halal — it
              says what it left out. Filtering ingredients and certifying
              compliance are different things, and a user keeping halal deserves
              to know which one they are getting. */}
          {needsCertificationNote(profile.dietary) && (
            <View style={styles.certNote}>
              <Ionicons name="information-circle-outline" size={15} color={colors.rustMuted} />
              <Text style={styles.certNoteText}>
                I leave out pork, alcohol and gelatine. I can&apos;t check how meat was
                slaughtered, so look for certification when you shop.
              </Text>
            </View>
          )}

          <Text style={[styles.eyebrow, styles.eyebrowSpaced]}>ALLERGIES</Text>
          <View style={styles.chipRow}>
            {profile.allergies.map((value) => (
              <Chip
                key={value}
                label={value}
                tone="allergy"
                onRemove={() => removeChip('allergy', value)}
              />
            ))}
            <AddChip onPress={() => setPicker('allergy')} />
          </View>
        </View>

        {/* ---------------- Preferences ----------------

            Ordered by how often a row is actually opened, and grouped by what
            the rows are rather than by where they live. "App" and "Account"
            described the developer's mental model: notifications, appearance,
            support and legal were all "app", which told a user nothing about
            which of the four they wanted.

            These two are also the only settings on the screen that currently
            do anything, so they sit above the groups that do not. */}
        <View style={styles.group}>
          <Text style={styles.eyebrow}>PREFERENCES</Text>
          <View style={styles.rowCard}>
            <SettingsRow
              title="Notifications"
              // Was "Nudges, quiet hours, weekly plan", which promised two
              // things that do not exist. Quiet hours are moot when there is
              // one message a day at an hour you chose, and the weekly plan is
              // its own feature that nothing has built yet.
              subtitle="A heads-up before food goes off"
              onPress={onOpenReminders}
            />
            <RowDivider />
            <AppearanceRow />
          </View>
        </View>

        {/* ---------------- Account ----------------
            Every destructive action is behind "Your data", so nothing
            irreversible is one tap from this screen. */}
        <View style={styles.group}>
          <Text style={styles.eyebrow}>ACCOUNT</Text>
          <View style={styles.rowCard}>
            <SettingsRow
              title="Personal details"
              subtitle="Name, email, phone"
              onPress={() => comingSoon('Personal details')}
            />
            <RowDivider />
            <SettingsRow
              title="Sign-in & security"
              subtitle={email ? `Email · ${email}` : 'Guest account'}
              onPress={() => comingSoon('Sign-in & security')}
            />
            <RowDivider />
            <SettingsRow
              title="Your data"
              subtitle="Export, clear pantry, delete account"
              onPress={() => comingSoon('Your data')}
            />
          </View>
        </View>

        {/* ---------------- About ----------------
            Support and legal, last. Nobody opens this screen looking for them,
            and mixing them in above meant scrolling past two rows nobody wanted
            to reach the ones they did. */}
        <View style={styles.group}>
          <Text style={styles.eyebrow}>ABOUT</Text>
          <View style={styles.rowCard}>
            <SettingsRow
              title="Help & feedback"
              subtitle="Common questions, and a way to reach us"
              onPress={() => setHelp(true)}
            />
            <RowDivider />
            <SettingsRow
              title="Privacy & terms"
              subtitle="What Panzi keeps, and what it cannot promise"
              onPress={() => setPrivacy(true)}
            />
          </View>
        </View>

        {/* ---------------- Sign out ---------------- */}
        <View style={styles.footer}>
          <TouchableOpacity style={styles.signOut} onPress={confirmSignOut} activeOpacity={0.8}>
            <Text style={styles.signOutLabel}>Sign out</Text>
          </TouchableOpacity>
          <Text style={styles.version}>
            {email ? `Panzi ${APP_VERSION} · ${email}` : `Panzi ${APP_VERSION}`}
          </Text>
        </View>
      </ScrollView>

      <HelpSheet
        visible={help}
        uid={uid}
        email={email}
        appVersion={APP_VERSION}
        onClose={() => setHelp(false)}
      />

      <PrivacySheet visible={privacy} onClose={() => setPrivacy(false)} />

      <ChipPickerSheet
        visible={picker !== null}
        title={picker === 'allergy' ? 'Add an allergy' : 'Add a diet'}
        options={picker === 'allergy' ? COMMON_ALLERGENS : COMMON_DIETS}
        chosen={picker === 'allergy' ? profile.allergies : profile.dietary}
        tone={picker === 'allergy' ? 'allergy' : 'diet'}
        onAdd={(value) => picker && addChip(picker, value)}
        onClose={() => setPicker(null)}
      />

      {removal && (
        <Toast
          message={`${removal.value} removed`}
          actionLabel="Undo"
          onAction={undoRemoval}
          onDismiss={() => setRemoval(null)}
          bottomOffset={SCAN_BUTTON_LIFT}
        />
      )}
    </View>
  );
}

/* ------------------------------------------------------------------ *
 * Small pieces
 * ------------------------------------------------------------------ */

function Chevron() {
  const styles = useStyles();
  const colors = useColors();
  return <Ionicons name="chevron-forward" size={17} color={colors.chevron} />;
}

function RowDivider() {
  const styles = useStyles();
  const colors = useColors();
  return <View style={styles.divider} />;
}

function SettingsRow({
  title,
  subtitle,
  onPress,
}: {
  title: string;
  subtitle?: string;
  onPress: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{title}</Text>
        {subtitle && (
          <Text style={styles.rowSubtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        )}
      </View>
      <Chevron />
    </TouchableOpacity>
  );
}

function Chip({
  label,
  tone,
  soft,
  onRemove,
}: {
  label: string;
  tone: 'diet' | 'allergy';
  /** Rendered hollow: Panzi aims for this one but cannot check it. */
  soft?: boolean;
  onRemove: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const isDiet = tone === 'diet';

  // Contrast ratios against the fill each one actually sits on, measured rather
  // than eyeballed. The originals were `primaryDark` on the green (4.39:1),
  // `accent` on the peach (2.80:1) and `tabInactive` on the white card
  // (3.26:1) — all three under the 4.5:1 a 13px label needs, and the peach one
  // badly. These are 8.85, 4.59 and 7.66.
  const text = soft ? colors.textDark : isDiet ? colors.primaryDarker : colors.rustMuted;
  // A hollow chip still has to read as a pill. Transparent on a white card left
  // it as a label with a 1.25:1 outline round it — no shape at all. The sunken
  // fill gives it an edge before the border is even considered, and stays
  // clearly hollow next to the green ones.
  const fill = soft ? colors.cardSunken : isDiet ? colors.primaryLighter : colors.accentSoft;

  return (
    <View
      style={[
        styles.chip,
        { backgroundColor: fill },
        // Grey rather than green, because the muting is the meaning: this is a
        // diet Panzi aims for and cannot check. 3.26:1 clears the 3:1 a border
        // needs, where `primaryLine` was invisible at 1.25:1.
        soft && { borderWidth: 1, borderColor: colors.tabInactive },
      ]}
    >
      <Text style={[styles.chipLabel, { color: text }]}>{label}</Text>
      <TouchableOpacity onPress={onRemove} hitSlop={HIT_SLOP}>
        <Ionicons name="close" size={13} color={text} style={styles.chipClose} />
      </TouchableOpacity>
    </View>
  );
}

/**
 * Dark mode, as one switch.
 *
 * A switch is the right shape for this — it is the same gesture as every other
 * setting in the app, and it reads at a glance where three segments had to be
 * scanned. But a plain on/off cannot say "follow my phone", and that is the
 * default and the answer most people want: it means the app is already dark at
 * night for someone who never opens this screen.
 *
 * So the switch shows the scheme in force, and touching it makes that an
 * explicit choice. "Follow my phone" only appears once there is something to
 * undo, which keeps the row a single line until the user has actually overridden
 * anything. All three states, one control, no lost capability.
 */
function AppearanceRow() {
  const styles = useStyles();
  const colors = useColors();
  const { preference, scheme, systemScheme, setPreference } = useTheme();

  const overridden = preference !== 'system';

  // Only claims a value when the OS actually gave one. Saying "light right now"
  // off the back of a fallback is how a user ends up believing the app is
  // misreading a phone it was never told about.
  const following = systemScheme
    ? `Following your phone · ${systemScheme} right now`
    : "Following your phone, but it hasn't told us which yet";

  return (
    <View style={styles.appearanceRow}>
      <View style={styles.appearanceMain}>
        <View style={styles.appearanceText}>
          <Text style={styles.rowTitle}>Dark mode</Text>
          <Text style={styles.rowSubtitle}>{overridden ? `Always ${preference}` : following}</Text>
        </View>
        <Switch
          // Reflects what is on screen, not the stored preference — on 'system'
          // the honest answer to "is dark mode on?" is whatever the phone says.
          value={scheme === 'dark'}
          onValueChange={(on) => setPreference(on ? 'dark' : 'light')}
          // The off track was `backgroundAlt`, which is 1.24:1 against the white
          // card behind it — the control effectively disappeared in light mode
          // and you could only tell its state by the thumb's position.
          // `tabInactive` is 3.26:1 in light and 4.26:1 in dark, the threshold
          // a non-text control has to clear. The green ON state is unchanged.
          trackColor={{ true: colors.primary, false: colors.tabInactive }}
          // iOS paints this behind the track while the switch animates; without
          // it the off state flashes the system default on the way across.
          ios_backgroundColor={colors.tabInactive}
          thumbColor={colors.onAccent}
        />
      </View>

      {overridden && (
        <TouchableOpacity
          style={styles.followPhone}
          onPress={() => setPreference('system')}
          hitSlop={HIT_SLOP}
          accessibilityRole="button"
        >
          <Ionicons name="phone-portrait-outline" size={13} color={colors.primaryDark} />
          <Text style={styles.followPhoneText}>Follow my phone instead</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

function AddChip({ onPress }: { onPress: () => void }) {
  const styles = useStyles();
  return (
    <TouchableOpacity style={styles.addChip} onPress={onPress} activeOpacity={0.7}>
      <Text style={styles.addChipLabel}>+ Add</Text>
    </TouchableOpacity>
  );
}

/* ------------------------------------------------------------------ */

const useStyles = makeStyles((colors) => ({
  container: {
    flex: 1,
    backgroundColor: colors.backgroundLight,
  },
  content: {
    // paddingTop is applied inline — it has to include the status-bar inset.
    // Clears the tab bar and the scan button raised out of it.
    paddingBottom: SCAN_BUTTON_LIFT + 34 + 24,
  },

  // Hero — the one block that sits wider than the 24 content padding.
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.heroFill,
    gap: space.lg,
    marginHorizontal: space.md,
    paddingTop: space.xxl2,
    paddingHorizontal: space.xl,
    paddingBottom: space.xxl,
    borderRadius: 30,
    borderWidth: 1,
    borderColor: colors.primaryLine,
    overflow: 'hidden',
  },
  avatarWrap: {
    width: 78,
    height: 78,
  },
  avatar: {
    width: 78,
    height: 78,
    borderRadius: 999,
    backgroundColor: colors.avatarFill,
    borderWidth: 3,
    borderColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.shadow,
    shadowOpacity: 0.28,
    shadowRadius: 11,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  avatarImage: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 999,
  },
  // Sits over whatever the circle is currently showing, dimmed enough for a
  // white spinner to read against a light photo.
  avatarBusy: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  avatarInitial: {
    fontFamily: fonts.display,
    fontWeight: '800',
    fontSize: type.display.fontSize,
    // The body-ink green rather than the heading green. On the pale avatar fill
    // the lighter one sat at 4.08:1 — under the readable threshold for a single
    // large glyph carrying the whole identity of the card. 8.2:1 here, 7.0:1 in
    // dark. Darkening the letter rather than lightening the fill, because a
    // paler fill would lose its separation from the card behind it.
    color: colors.primaryDarker,
  },
  cameraBadge: {
    position: 'absolute',
    right: -1,
    bottom: -1,
    width: 26,
    height: 26,
    borderRadius: 999,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroText: {
    flex: 1,
  },
  name: {
    fontFamily: fonts.display,
    fontWeight: '800',
    fontSize: type.headline.fontSize,
    lineHeight: 31,
    color: colors.primaryDarker,
    marginBottom: space.sm,
  },
  membershipPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    maxWidth: '100%',
    paddingVertical: space.xs2,
    paddingLeft: space.sm2,
    paddingRight: space.md,
    borderRadius: 999,
    backgroundColor: colors.overlayStrong,
    borderWidth: 1,
    borderColor: colors.primaryLine,
  },
  membershipDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primary,
  },
  membershipLabel: {
    flexShrink: 1,
    fontWeight: '700',
    fontSize: type.caption.fontSize,
    color: colors.primaryDark,
  },

  // Saved recipes
  savedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md2,
    marginTop: space.lg,
    marginHorizontal: space.xxl,
    paddingVertical: space.md2,
    paddingHorizontal: space.lg,
    borderRadius: 20,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
  },
  savedIcon: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: colors.primaryLighter,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // What you eat
  prefsCard: {
    marginTop: space.lg,
    marginHorizontal: space.xxl,
    padding: space.xl,
    borderRadius: 26,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
    shadowColor: colors.shadow,
    shadowOpacity: 0.16,
    shadowRadius: 13,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  cardTitle: {
    fontFamily: fonts.display,
    fontWeight: '700',
    fontSize: type.title.fontSize,
    color: colors.primaryDarker,
    marginBottom: space.xs,
  },
  cardSubtitle: {
    fontWeight: '600',
    fontSize: type.label.fontSize,
    lineHeight: 18,
    color: colors.textSecondary,
    marginBottom: space.lg,
  },
  eyebrow: {
    fontWeight: '800',
    fontSize: type.micro.fontSize,
    letterSpacing: 1.54,
    color: colors.tabInactive,
    marginBottom: space.sm2,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  chipRowSpaced: {
    marginBottom: space.lg2,
  },
  // Separates the allergy block from whatever the diet block ended with —
  // chips, a footnote, or the certification note, all of which are different
  // heights. Put on the heading rather than the block above it so the gap is
  // the same whichever of the three landed last.
  eyebrowSpaced: {
    marginTop: space.lg2,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.sm,
    paddingLeft: space.md2,
    paddingRight: space.md,
    borderRadius: 999,
  },
  chipLabel: {
    fontWeight: '700',
    fontSize: type.label.fontSize,
  },
  dietNote: {
    fontWeight: '600',
    fontSize: type.caption.fontSize,
    lineHeight: 17,
    color: colors.textSecondary,
    marginTop: space.sm2,
  },
  tightNote: {
    flexDirection: 'row',
    gap: space.sm,
    alignItems: 'flex-start',
    backgroundColor: colors.warmCard,
    borderWidth: 1,
    borderColor: colors.warmBorder,
    borderRadius: 14,
    padding: space.md,
    marginTop: space.md,
  },
  certNote: {
    flexDirection: 'row',
    gap: space.sm,
    alignItems: 'flex-start',
    backgroundColor: colors.warmCard,
    borderWidth: 1,
    borderColor: colors.warmBorder,
    borderRadius: 14,
    padding: space.md,
    marginTop: space.md,
  },
  certNoteText: {
    flex: 1,
    fontWeight: '600',
    fontSize: type.caption.fontSize,
    lineHeight: 17,
    color: colors.rustMuted,
  },
  chipClose: {
    // Was 0.6, which on top of an already-muted label put the only way to
    // remove a chip below the label it belongs to.
    opacity: 0.75,
  },
  // The one control on these rows, and it was the faintest thing on the card:
  // a cream fill on a white card behind a 1.53:1 tan outline. Green now, in the
  // same ink the app uses for every other tappable word, so it reads as the
  // action it is rather than as a fourth kind of chip.
  //
  // The dash still says "empty slot" where it renders — Android drops dashes on
  // a rounded border — so nothing about the meaning depends on it.
  addChip: {
    paddingVertical: space.sm,
    paddingHorizontal: space.md2,
    borderRadius: 999,
    backgroundColor: colors.primaryWash,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.primaryDark,
  },
  addChipLabel: {
    fontWeight: '700',
    fontSize: type.label.fontSize,
    color: colors.primaryDark,
  },

  // Settings groups
  group: {
    marginTop: space.xl2,
    marginHorizontal: space.xxl,
  },
  rowCard: {
    borderRadius: 20,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.lg,
    paddingHorizontal: space.lg,
  },
  rowText: {
    flex: 1,
  },
  rowTitle: {
    fontWeight: '700',
    fontSize: type.body.fontSize,
    color: colors.primaryDarker,
  },
  rowSubtitle: {
    fontWeight: '600',
    fontSize: type.label.fontSize,
    color: colors.textSecondary,
    marginTop: space.xs2,
  },
  appearanceRow: {
    paddingVertical: space.lg,
    paddingHorizontal: space.lg,
  },
  appearanceMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  appearanceText: {
    flex: 1,
  },
  followPhone: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs2,
    alignSelf: 'flex-start',
    marginTop: space.md,
    paddingVertical: space.xs2,
    paddingHorizontal: space.sm2,
    borderRadius: 999,
    backgroundColor: colors.primaryLighter,
  },
  followPhoneText: {
    fontWeight: '700',
    fontSize: type.caption.fontSize,
    color: colors.primaryDark,
  },
  divider: {
    height: 1,
    marginLeft: space.lg,
    backgroundColor: colors.divider,
  },

  // Sign out
  footer: {
    marginTop: space.xl2,
    marginHorizontal: space.xxl,
    alignItems: 'center',
    gap: space.md2,
  },
  signOut: {
    width: '100%',
    height: 48,
    borderRadius: 16,
    // Was border-only, so the page read straight through it and the button
    // looked like a gap rather than a control. A solid card fill puts it on the
    // same footing as every other tappable surface on the page; the accent text
    // is what still marks it out as the destructive one.
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  signOutLabel: {
    fontWeight: '700',
    fontSize: type.body.fontSize,
    color: colors.accent,
  },
  version: {
    fontWeight: '600',
    fontSize: type.caption.fontSize,
    color: colors.mutedLight,
  },
}));