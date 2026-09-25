// server/src/device.ts
//
// What kind of device an account last used.
//
// The admin console had a Device column that was always a dash, because nothing
// in this system recorded one. The information was there all along — every
// authenticated request carries a User-Agent — it was just being thrown away.
//
// Two rules keep this from becoming a liability:
//
//   - It never creates a user document. `updateOne` without an upsert means an
//     account that has never written a profile stays absent, and the admin
//     signing in from a browser does not quietly appear in the app's `users`
//     collection.
//
//   - It never fails a request. The write is fire-and-forget and throttled in
//     memory, so a device note costs one Mongo round trip per account per six
//     hours at most, and a Mongo hiccup costs the user nothing.
//
// It is deliberately coarse. A full user-agent string is a fingerprint; "iOS"
// is the answer to the question an admin is actually asking.

import { User } from './models';

/** How long an account's platform is treated as known before writing again. */
const THROTTLE_MS = 6 * 60 * 60 * 1000;

const seen = new Map<string, { platform: string; at: number }>();

/**
 * A user-agent reduced to something worth showing in a table.
 *
 * React Native sends okhttp on Android and CFNetwork/Darwin on iOS; Expo Go
 * adds its own token. A browser is the admin console itself, or someone poking
 * the API by hand — worth distinguishing, not worth breaking down by version.
 */
export function platformOf(userAgent: string | undefined): string | null {
  if (!userAgent) return null;
  const ua = userAgent.toLowerCase();

  if (/okhttp|dalvik|android/.test(ua)) return 'Android';
  if (/cfnetwork|darwin|iphone|ipad|ios/.test(ua)) return 'iOS';
  if (/expo/.test(ua)) return 'Expo Go';
  if (/mozilla|chrome|safari|firefox|edg/.test(ua)) return 'Web';
  return null;
}

/**
 * Note the platform this account is calling from. Safe to call on every
 * authenticated request: it returns immediately and swallows its own errors.
 */
export function noteDevice(uid: string | undefined, userAgent: string | undefined): void {
  if (!uid) return;

  const platform = platformOf(userAgent);
  if (!platform) return;

  const last = seen.get(uid);
  const now = Date.now();
  // Rewrite early when the platform changed — someone moving from Android to
  // iOS is exactly the thing this column exists to show, and waiting six hours
  // to reflect it would make the value wrong rather than merely stale.
  if (last && last.platform === platform && now - last.at < THROTTLE_MS) return;
  seen.set(uid, { platform, at: now });

  User.updateOne({ _id: uid }, { $set: { lastPlatform: platform, lastPlatformAt: new Date() } })
    .exec()
    .catch((err: any) => {
      console.error('device: note failed', { uid, message: err?.message });
    });
}
