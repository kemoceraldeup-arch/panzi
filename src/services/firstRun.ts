// src/services/firstRun.ts
//
// Whether Home's "Nothing on your shelves yet" welcome is for this user.
//
// It is a first-run screen, like onboarding: one thing to do for someone who
// has never had food in Panzi. A user who empties their pantry later is not
// new, and should keep the normal Home — their counts, Ask Panzi, and the
// "Where your food went" chart — rather than be welcomed in again.
//
// "Has had food here" is remembered on this phone, per account, the first time
// Home sees the pantry stocked. An account whose History already has removals
// is remembered too, so someone who emptied their shelves before this existed
// is not shown the welcome once more.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { REMOVAL_REASONS, RemovalHistory } from './removals';

const key = (uid: string) => `panzi.hasHadPantry.${uid}`;

/** Whether this phone has seen this account with food on its shelves. */
export async function hasHadPantry(uid: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(key(uid))) === '1';
  } catch {
    // Storage unreadable: treat as not new, so a returning user is never
    // dropped back onto the welcome screen by a storage hiccup.
    return true;
  }
}

export async function rememberHadPantry(uid: string): Promise<void> {
  try {
    await AsyncStorage.setItem(key(uid), '1');
  } catch {
    // Best effort; the next stocked pantry tries again.
  }
}

/** Whether what Home can see says this account is not new. */
export function shouldRemember(pantryTotal: number | null, history: RemovalHistory | null): boolean {
  if (pantryTotal !== null && pantryTotal > 0) return true;
  return !!history && REMOVAL_REASONS.some((reason) => history.counts[reason] > 0);
}

/** The welcome shows only for an empty pantry this phone has never seen
 *  stocked. Nulls are "still loading" and show nothing special yet. */
export function showWelcome(pantryTotal: number | null, hadPantry: boolean | null): boolean {
  return pantryTotal === 0 && hadPantry === false;
}
