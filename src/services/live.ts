// src/services/live.ts
//
// What replaced Firestore's onSnapshot.
//
// The screens were written against a live listener: they render whatever was
// last pushed to them, and a write made anywhere — this screen, the onboarding
// survey, a second device — arrives without a reload. MongoDB pushes nothing,
// so that behaviour has to be rebuilt out of ordinary fetches.
//
// Three things bring it close enough that the screens did not have to change.
//
// A write refreshes its own key immediately. This is the important one: it is
// what makes the list update the instant you delete a row, and it is the part
// users would actually notice missing. Firestore called this latency
// compensation and did it locally; here the round trip is real but short.
//
// Subscribers on the same key share one request. Two screens watching the
// pantry do not double the reads, and a refresh triggered by a write fans out
// to all of them from a single fetch.
//
// Coming back to the app refetches. A phone that was in a pocket for an hour
// has stale data and no way to know it, and the moment the user is looking at
// the screen again is exactly when it matters.
//
// What is genuinely gone: a change made on another device no longer appears
// here within the second. It appears on the next poll, the next write, or the
// next time the app is opened. For a pantry that one person edits, that is a
// difference nobody sees.

import { AppState, AppStateStatus } from 'react-native';

type Listener<T> = {
  callback: (value: T) => void;
  onError: (err: Error) => void;
};

type Entry = {
  fetcher: () => Promise<unknown>;
  listeners: Set<Listener<any>>;
  timer: ReturnType<typeof setInterval> | null;
  /** The last value fetched, handed to a late subscriber so a second screen
   *  opening on the same data renders immediately instead of flashing empty. */
  last: unknown;
  hasValue: boolean;
  /** The fetch currently in flight, so simultaneous refreshes coalesce. */
  inFlight: Promise<void> | null;
};

const entries = new Map<string, Entry>();

// Long, because a write already refreshes its own key and returning to the app
// refreshes everything. This interval is only there for the case nobody else
// covers: the app is open, in the foreground, untouched, and something changed
// on another device. Short polling would spend requests to shorten a window
// almost nobody is looking at.
const POLL_MS = 120_000;

async function run(key: string): Promise<void> {
  const entry = entries.get(key);
  if (!entry) return;
  if (entry.inFlight) return entry.inFlight;

  entry.inFlight = (async () => {
    try {
      const value = await entry.fetcher();
      entry.last = value;
      entry.hasValue = true;
      // Read the set fresh: a listener may have unsubscribed while the request
      // was in the air, and calling back into an unmounted screen is how a
      // "state update on an unmounted component" warning starts.
      for (const listener of entries.get(key)?.listeners ?? []) {
        listener.callback(value);
      }
    } catch (err: any) {
      for (const listener of entries.get(key)?.listeners ?? []) {
        listener.onError(err instanceof Error ? err : new Error(String(err)));
      }
    } finally {
      const current = entries.get(key);
      if (current) current.inFlight = null;
    }
  })();

  return entry.inFlight;
}

/**
 * Watches one key. Returns the unsubscribe function, exactly as onSnapshot did,
 * so the screens' cleanup code is unchanged.
 */
export function subscribeToKey<T>(
  key: string,
  fetcher: () => Promise<T>,
  callback: (value: T) => void,
  onError: (err: Error) => void
): () => void {
  let entry = entries.get(key);

  if (!entry) {
    entry = {
      fetcher: fetcher as () => Promise<unknown>,
      listeners: new Set(),
      timer: null,
      last: undefined,
      hasValue: false,
      inFlight: null,
    };
    entries.set(key, entry);
    entry.timer = setInterval(() => void run(key), POLL_MS);
  }

  const listener: Listener<T> = { callback, onError };
  entry.listeners.add(listener);

  // A late subscriber gets the last known value before the network is touched.
  if (entry.hasValue) callback(entry.last as T);
  void run(key);

  return () => {
    const current = entries.get(key);
    if (!current) return;
    current.listeners.delete(listener);
    // Torn down rather than left running: an interval on a key nothing is
    // watching is a request every two minutes for data nobody will read.
    if (current.listeners.size === 0) {
      if (current.timer) clearInterval(current.timer);
      entries.delete(key);
    }
  };
}

/**
 * Refetches a key now. Called after every write, which is what makes a change
 * appear without waiting for the poll.
 *
 * Not awaited by callers: the write has already succeeded by the time this
 * runs, and making the caller wait for a second round trip would double the
 * time a tap takes to feel finished.
 */
export function refreshKey(key: string): void {
  if (entries.has(key)) void run(key);
}

/** One-shot read that goes through the same fetcher, for the paths that want a
 *  value once rather than a subscription. */
export async function readKey<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const value = await fetcher();
  const entry = entries.get(key);
  if (entry) {
    entry.last = value;
    entry.hasValue = true;
  }
  return value;
}

// Coming back from the background refetches everything currently watched. The
// listener is registered once, at module load, and never removed — the app has
// no state in which stale data is preferable.
let lastState: AppStateStatus = AppState.currentState;
AppState.addEventListener('change', (next) => {
  const returning = lastState.match(/inactive|background/) && next === 'active';
  lastState = next;
  if (!returning) return;
  for (const key of entries.keys()) void run(key);
});
