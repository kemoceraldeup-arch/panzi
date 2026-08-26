// src/services/session.ts
//
// Small device-local flags about where a user has already been. These are
// deliberately NOT in Firestore: they decide what to render on the very first
// frame of a cold start, before any network call could have finished.
//
// Nothing here is security-relevant — the worst a tampered flag can do is skip
// an intro carousel or a survey the user can still reach from Profile.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { TimeSlot } from './notifications';

const ONBOARDING_SEEN_KEY = 'panzi.onboardingSeen';
const PROFILE_DONE_PREFIX = 'panzi.profileDone.';
const REMINDERS_KEY = 'panzi.reminders';
const REMINDERS_ASKED_KEY = 'panzi.remindersAsked';

/** Whether the intro carousel has ever been finished on this device. */
export async function getOnboardingSeen(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(ONBOARDING_SEEN_KEY)) === '1';
  } catch {
    return false;
  }
}

export async function setOnboardingSeen(): Promise<void> {
  try {
    await AsyncStorage.setItem(ONBOARDING_SEEN_KEY, '1');
  } catch {
    // A failed write only costs the user one extra swipe through the intro.
  }
}

/**
 * Whether this uid finished the profile survey, cached locally.
 *
 * The authoritative answer is the user document in Firestore, but reading it
 * needs the network. Caching a `true` here means a returning user goes
 * straight to their pantry offline, instead of being handed the survey again.
 * Only `true` is ever cached, so a missing entry always falls through to the
 * real check rather than wrongly forcing the survey.
 */
export async function getProfileDoneCached(uid: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(PROFILE_DONE_PREFIX + uid)) === '1';
  } catch {
    return false;
  }
}

export async function setProfileDoneCached(uid: string): Promise<void> {
  try {
    await AsyncStorage.setItem(PROFILE_DONE_PREFIX + uid, '1');
  } catch {
    // Falls back to the Firestore check on the next launch.
  }
}

/**
 * Whether expiry reminders are on, and when they arrive.
 *
 * Device-local rather than on the user's Firestore document, because a
 * notification is scheduled on a phone: a second device signed into the same
 * account has its own OS permission and its own schedule, and should not
 * silently inherit a choice made on the first one.
 */
export type ReminderPrefs = { enabled: boolean; slot: TimeSlot };

export const DEFAULT_REMINDERS: ReminderPrefs = { enabled: false, slot: 'evening' };

export async function getReminderPrefs(): Promise<ReminderPrefs> {
  try {
    const raw = await AsyncStorage.getItem(REMINDERS_KEY);
    if (!raw) return DEFAULT_REMINDERS;
    const parsed = JSON.parse(raw) as Partial<ReminderPrefs>;
    return {
      enabled: parsed.enabled === true,
      slot: parsed.slot ?? DEFAULT_REMINDERS.slot,
    };
  } catch {
    // A corrupt entry falls back to off, which is the safe direction: the worst
    // case is a user who has to turn them on again, not one who cannot turn
    // them off.
    return DEFAULT_REMINDERS;
  }
}

export async function setReminderPrefs(prefs: ReminderPrefs): Promise<void> {
  try {
    await AsyncStorage.setItem(REMINDERS_KEY, JSON.stringify(prefs));
  } catch {
    // The schedule already reflects the change in memory; only the choice's
    // survival across a restart is lost.
  }
}

/**
 * Whether the user has already been offered reminders after a scan.
 *
 * Offered once and only once. Someone who said no to the idea should not be
 * asked again every time they fill a shelf — the Profile row is where they go
 * if they change their mind.
 */
export async function getRemindersAsked(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(REMINDERS_ASKED_KEY)) === '1';
  } catch {
    return true; // Err towards not nagging.
  }
}

export async function setRemindersAsked(): Promise<void> {
  try {
    await AsyncStorage.setItem(REMINDERS_ASKED_KEY, '1');
  } catch {
    // Worst case the offer appears once more on the next scan.
  }
}
