// src/services/profile.ts
//
// The user document behind the Profile tab. The onboarding survey
// (ProfileSurveyScreen) is what first writes it; the Profile screen is where
// those answers stay editable for the rest of the account's life.
//
// Allergies are stored as one comma-separated string because that is what the
// survey's free-text field writes. The Profile screen shows them as chips, so
// the split/join lives here rather than in the screen — both writers keep the
// same shape on disk.

import { apiFetch } from '../config/api';
import { refreshKey, subscribeToKey } from './live';
import { getProfileDoneCached, setProfileDoneCached } from './session';

export type UserProfile = {
  name: string | null;
  /** Diet chips, e.g. ['Vegetarian', 'No pork']. */
  dietary: string[];
  /** Allergy chips, e.g. ['Peanuts', 'Shellfish']. */
  allergies: string[];
  /** Public URL for the account's picture, or null for the initial. */
  photoURL: string | null;
};

export const EMPTY_PROFILE: UserProfile = {
  name: null,
  dietary: [],
  allergies: [],
  photoURL: null,
};

// Same reasoning as the pantry's key: the request carries the token, so the
// signed-in account is whoever the server says it is.
const KEY = 'profile';

// 'Peanuts, shellfish' -> ['Peanuts', 'Shellfish']. Blank entries are dropped
// so a trailing comma can't produce an empty chip.
export function parseAllergies(raw: string): string[] {
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1));
}

function toProfile(data: any): UserProfile {
  return {
    name: (data?.name as string) ?? null,
    dietary: Array.isArray(data?.dietaryPreferences) ? data.dietaryPreferences : [],
    allergies: typeof data?.allergies === 'string' ? parseAllergies(data.allergies) : [],
    photoURL: typeof data?.photoURL === 'string' && data.photoURL ? data.photoURL : null,
  };
}

/** The raw document, for the paths that want a single field rather than a
 *  subscription — the Dashboard's greeting, most of all. */
export async function fetchProfile(): Promise<UserProfile> {
  const { profile } = await apiFetch<{ profile: any }>('/api/profile');
  return toProfile(profile);
}

/**
 * Live view of the user document. Mirrors subscribeToPantryItems: the screen
 * renders whatever the listener last pushed rather than a value it fetched once.
 *
 * The listener is what makes the "What you eat" chips live in both directions.
 * A chip added here refreshes the key on write, so it appears without a reload;
 * a change made in the onboarding survey lands here the same way. What no
 * longer happens instantly is a change made on a second device — that arrives
 * on the next poll or the next time the app is reopened.
 *
 * Returns the unsubscribe function.
 */
export function subscribeToProfile(
  uid: string,
  callback: (profile: UserProfile) => void,
  onError: (err: Error) => void
): () => void {
  return subscribeToKey(KEY, fetchProfile, callback, onError);
}

/**
 * Whether this account has already answered the onboarding survey — the check
 * that decides, on launch, between the survey and the pantry.
 *
 * The device cache answers first so a returning user never waits on the network
 * (or gets handed the survey a second time while offline). Only a successful
 * read can turn a "no" into a "yes", and that answer is cached so the network
 * is only consulted once per install.
 *
 * A read failure resolves to false: the survey is re-offered rather than
 * dropping the user into a pantry whose profile may not exist. Re-answering it
 * is an upsert, so nothing is lost if the document was in fact already there.
 */
export async function hasCompletedProfile(uid: string): Promise<boolean> {
  if (await getProfileDoneCached(uid)) return true;
  try {
    const profile = await fetchProfile();
    const done = typeof profile.name === 'string' && profile.name.trim().length > 0;
    if (done) await setProfileDoneCached(uid);
    return done;
  } catch {
    return false;
  }
}

/**
 * The onboarding survey's write. The only thing that sets `name`, and therefore
 * the only thing that can mark an account as having finished onboarding.
 */
export async function saveSurvey(
  uid: string,
  answers: {
    name: string;
    dietary: string[];
    allergies: string;
    mealPlanOptIn: boolean;
  }
): Promise<void> {
  await apiFetch('/api/profile/survey', {
    name: answers.name,
    dietaryPreferences: answers.dietary,
    allergies: answers.allergies,
    mealPlanOptIn: answers.mealPlanOptIn,
  });
  refreshKey(KEY);
}

export async function saveDietary(uid: string, dietary: string[]): Promise<void> {
  await apiFetch('/api/profile/save', { dietaryPreferences: dietary });
  refreshKey(KEY);
}

export async function saveAllergies(uid: string, allergies: string[]): Promise<void> {
  await apiFetch('/api/profile/save', { allergies: allergies.join(', ') });
  refreshKey(KEY);
}

/**
 * Points the account at a new picture, or clears it.
 *
 * Removal writes null rather than dropping the field so the listener sees the
 * change as a value — an absent field and a null one read the same to
 * toProfile, but null is what a partial update can actually express.
 */
export async function saveProfilePhoto(uid: string, photoURL: string | null): Promise<void> {
  await apiFetch('/api/profile/save', { photoURL });
  refreshKey(KEY);
}

// Offered by the "+ Add" pickers. Free text is always allowed on top of these.
export const COMMON_DIETS = [
  'Vegetarian',
  'Vegan',
  'Pescatarian',
  'Gluten-free',
  'Dairy-free',
  'No pork',
  'No beef',
  'Halal',
  'Kosher',
  'Low carb',
  'Low sugar',
  'Nut-free',
];

export const COMMON_ALLERGENS = [
  'Peanuts',
  'Tree nuts',
  'Shellfish',
  'Fish',
  'Milk',
  'Eggs',
  'Soy',
  'Wheat',
  'Gluten',
  'Sesame',
  'Celery',
  'Mustard',
  'Sulphites',
  'Lupin',
];
