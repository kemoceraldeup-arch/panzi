// src/services/notifications.ts
//
// The one thing this app does while it is closed.
//
// Everything else Panzi knows is only useful to someone who has already
// decided to open it — which is the wrong audience, because the person whose
// spinach is about to go off is precisely the person not thinking about
// spinach. So: one local notification a day, at an hour they picked, naming
// the food that needs eating.
//
// Local, not push. Every expiry date is already on the device, so there is no
// server to run, nothing to pay for, and it works with the phone offline. It
// also means the schedule is only as fresh as the last time the app was open,
// which is why SCHEDULE_DAYS reaches a fortnight ahead rather than a day or
// two: an expiry date does not move once it is written, so scheduling far out
// costs almost no accuracy and covers the user who does not open the app all
// week.
//
// The rule the whole file is built around: **the scheduler never calls the
// model.** It may read a suggestion the Recipes tab already cached and paid
// for, and it must fall back silently when there is none. A background job
// that can spend money is a background job that will.

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { PantryItem } from './pantry';
import { UserProfile } from './profile';
import { loadCachedRecipes, pantrySignature } from './recipes';

/**
 * How a notification behaves when one arrives while the app is open.
 *
 * Shown rather than swallowed. The default is to suppress it, which would mean
 * a user reading the pantry at six o'clock never learns that the reminder
 * fired — and then wonders, the following week, whether the feature works.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

/** How far ahead notifications are scheduled, in days. */
const SCHEDULE_DAYS = 14;

/**
 * How long an item that has already expired keeps being mentioned.
 *
 * Nothing removes an expired item from the pantry except the user, so without
 * this a forgotten jar is named every single evening for the rest of its life
 * — and the fastest way to get notifications switched off is to send the same
 * one forever. After the grace period it stops being news and drops out.
 */
const EXPIRED_GRACE_DAYS = 3;

/** Past this many, the digest counts rather than lists. */
const MAX_NAMED = 3;

export type TimeSlot = 'morning' | 'midday' | 'evening' | 'night';

export const TIME_SLOTS: { id: TimeSlot; label: string; hour: number }[] = [
  { id: 'morning', label: 'Morning', hour: 8 },
  { id: 'midday', label: 'Midday', hour: 12 },
  // The default. Early enough to cook the thing tonight, late enough that the
  // day's shopping is already home.
  { id: 'evening', label: 'Evening', hour: 18 },
  { id: 'night', label: 'Night', hour: 21 },
];

export function hourFor(slot: TimeSlot): number {
  return TIME_SLOTS.find((s) => s.id === slot)?.hour ?? 18;
}

export function labelFor(slot: TimeSlot): string {
  const found = TIME_SLOTS.find((s) => s.id === slot);
  if (!found) return '';
  const suffix = found.hour < 12 ? 'am' : 'pm';
  const twelve = found.hour % 12 === 0 ? 12 : found.hour % 12;
  return `${found.label} · ${twelve}:00${suffix}`;
}

// ── Composing the message ───────────────────────────────────────────────
//
// Kept as pure functions over a date and a list, with no dependency on the
// clock or on Notifications, because this is the part with all the rules in it
// and the part most worth being able to reason about on its own.

export type Digest = { title: string; body: string };

/** Names, in the order they should be read out. */
function listNames(names: string[]): string {
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** Days between two 'YYYY-MM-DD' dates, positive when `to` is later. */
function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00`);
  const b = Date.parse(`${to}T00:00:00`);
  return Math.round((b - a) / 86_400_000);
}

/** 'YYYY-MM-DD' for a date this many days after today, in local time. */
export function isoDaysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const month = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

/**
 * What the digest sent on `onDate` should say, or null for a day with nothing
 * worth interrupting anyone about.
 *
 * Silence is the default and it is deliberate. A daily "everything is fine"
 * teaches people to dismiss the notification without reading it, and then they
 * dismiss the one that mattered. The same reasoning is why the "Eat these
 * first" card on Home disappears rather than reassuring.
 */
export function composeDigest(
  items: { name: string; expiryDate: string | null }[],
  onDate: string,
  recipeTitle?: string | null
): Digest | null {
  const today: string[] = [];
  const tomorrow: string[] = [];
  const gone: { name: string; days: number }[] = [];

  for (const item of items) {
    if (!item.expiryDate) continue;
    // Positive means the date is still ahead of the day this is read on.
    const offset = daysBetween(onDate, item.expiryDate);
    if (offset === 0) today.push(item.name);
    else if (offset === 1) tomorrow.push(item.name);
    else if (offset < 0 && -offset <= EXPIRED_GRACE_DAYS) {
      gone.push({ name: item.name, days: -offset });
    }
  }

  const total = today.length + tomorrow.length + gone.length;
  if (total === 0) return null;

  // One thing, said plainly. This is the common case and the one that earns the
  // feature its keep, so it gets a specific sentence rather than a count.
  if (total === 1) {
    if (today.length === 1) {
      return {
        title: `Your ${today[0]} goes off today`,
        body: recipeTitle ? `Try ${recipeTitle}` : 'Tap to see what to cook',
      };
    }
    if (tomorrow.length === 1) {
      return {
        title: `Your ${tomorrow[0]} goes off tomorrow`,
        body: recipeTitle ? `Try ${recipeTitle}` : 'Tap to see what to cook',
      };
    }
    const only = gone[0];
    return {
      title: `${only.name} went off ${only.days === 1 ? 'yesterday' : `${only.days} days ago`}`,
      body: 'Still in your pantry — worth a look',
    };
  }

  // Read in the order they need acting on: gone first because it is the one
  // that needs clearing, then today, then tomorrow.
  const parts: string[] = [];
  const clause = (names: string[], suffix: string) =>
    names.length > MAX_NAMED
      ? `${names.length} ${suffix}`
      : `${listNames(names)} ${suffix}`;

  if (gone.length) parts.push(clause(gone.map((g) => g.name), 'already went off'));
  if (today.length) parts.push(clause(today, 'go off today'));
  if (tomorrow.length) parts.push(clause(tomorrow, 'go off tomorrow'));

  const body = parts.join('. ');
  return {
    title: `${total} things need eating`,
    body: recipeTitle ? `${body}. Try ${recipeTitle}` : body,
  };
}

/**
 * What the pantry needs doing about right now, in the order it needs doing.
 *
 * The same three buckets the digest is built from, but computed against today
 * rather than a scheduled date — this is what the bell shows, and it is
 * recomputed on every open so it can never be stale the way a stored message
 * would be.
 */
export type Attention = {
  gone: { name: string; days: number }[];
  today: string[];
  tomorrow: string[];
};

export function currentAttention(
  items: { name: string; expiryDate: string | null }[]
): Attention {
  const onDate = isoDaysFromNow(0);
  const result: Attention = { gone: [], today: [], tomorrow: [] };

  for (const item of items) {
    if (!item.expiryDate) continue;
    const offset = daysBetween(onDate, item.expiryDate);
    if (offset === 0) result.today.push(item.name);
    else if (offset === 1) result.tomorrow.push(item.name);
    else if (offset < 0 && -offset <= EXPIRED_GRACE_DAYS) {
      result.gone.push({ name: item.name, days: -offset });
    }
  }

  result.gone.sort((a, b) => b.days - a.days);
  return result;
}

export function attentionCount(a: Attention): number {
  return a.gone.length + a.today.length + a.tomorrow.length;
}

// ── The log ─────────────────────────────────────────────────────────────
//
// What the bell shows under "recent".
//
// Recording on delivery is not possible for the notifications that matter:
// `addNotificationReceivedListener` only fires while the app is running, and
// almost every reminder arrives when it is closed. So the log is written at
// SCHEDULE time instead — each sync files away the entries from the previous
// plan whose hour has since passed, and those are the ones that went out.
//
// The honest limit: this records what the phone was asked to deliver, not what
// it definitely showed. A revoked permission or a phone that was off will still
// leave a line here.

// Keyed per account. A shared key meant that signing out and in as someone
// else showed them the previous user's reminders — their food, named, in
// somebody else's history.
const planKey = (uid: string) => `panzi.reminderPlan.${uid}`;
const logKey = (uid: string) => `panzi.reminderLog.${uid}`;
const LOG_MAX = 10;

export type LogEntry = { at: number; title: string; body: string };

async function readList(key: string): Promise<LogEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as LogEntry[]) : [];
  } catch {
    return [];
  }
}

async function writeList(key: string, value: LogEntry[]): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {
    // A lost log costs a list on one screen; it is not worth failing a sync for.
  }
}

/** Newest first. */
export async function getNotificationLog(uid: string | null): Promise<LogEntry[]> {
  if (!uid) return [];
  return (await readList(logKey(uid))).sort((a, b) => b.at - a.at);
}

/** One row per moment. Two entries sharing an `at` would collide as React keys
 *  and would both vanish when either one's X was pressed. */
function dedupe(entries: LogEntry[]): LogEntry[] {
  const seen = new Set<number>();
  return entries.filter((entry) => {
    if (seen.has(entry.at)) return false;
    seen.add(entry.at);
    return true;
  });
}

/** The reminders still ahead, soonest first. Lets the panel say when the next
 *  one is due, which is the only in-app proof the schedule is armed. */
export async function getPlan(uid: string | null): Promise<LogEntry[]> {
  if (!uid) return [];
  const now = Date.now();
  return (await readList(planKey(uid)))
    .filter((entry) => entry.at > now)
    .sort((a, b) => a.at - b.at);
}

/**
 * Moves anything already due out of the plan and into the log.
 *
 * Exposed as well as used internally, because a notification arriving while the
 * app is open should show up in the history straight away rather than waiting
 * for the next thing to change the pantry.
 */
export async function retireDuePlan(uid: string | null): Promise<void> {
  if (uid) await retirePlan(uid);
}

/** Removes one entry, for the X on its row. Keyed by time, which is unique
 *  here because at most one reminder is ever scheduled per day. */
export async function dismissLogEntry(uid: string | null, at: number): Promise<void> {
  if (!uid) return;
  const log = await readList(logKey(uid));
  await writeList(logKey(uid), log.filter((entry) => entry.at !== at));
}

/** Clears the whole list. */
export async function clearNotificationLog(uid: string | null): Promise<void> {
  if (!uid) return;
  await writeList(logKey(uid), []);
}

/** Moves everything from the last plan whose time has come into the log. */
async function retirePlan(uid: string): Promise<void> {
  const plan = await readList(planKey(uid));
  if (!plan.length) return;
  const now = Date.now();
  const fired = plan.filter((entry) => entry.at <= now);
  if (!fired.length) return;

  const log = dedupe([...fired, ...(await readList(logKey(uid)))].sort((a, b) => b.at - a.at)).slice(
    0,
    LOG_MAX
  );
  await writeList(logKey(uid), log);
  // Pruned, not left behind. The plan is normally overwritten at the end of the
  // sync that called this — but if scheduling throws part way, the fired
  // entries would still be sitting there and the next sync would log them a
  // second time.
  await writeList(planKey(uid), plan.filter((entry) => entry.at > now));
}

// ── Permission ──────────────────────────────────────────────────────────

/**
 * Asked at the moment the user turns notifications on, never at launch.
 *
 * iOS shows the system prompt once per install: a refusal is permanent as far
 * as the app is concerned, and the user has to go to Settings to undo it. So
 * the prompt is spent on someone who has just said yes to the idea, rather
 * than on someone who has had the app open for four seconds.
 */
export async function requestPermission(): Promise<boolean> {
  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) return true;
  // `canAskAgain` false means the OS will not show the prompt, so calling
  // request would resolve denied without anything appearing on screen.
  if (!existing.canAskAgain) return false;
  const asked = await Notifications.requestPermissionsAsync();
  return asked.granted;
}

export async function hasPermission(): Promise<boolean> {
  return (await Notifications.getPermissionsAsync()).granted;
}

// ── Scheduling ──────────────────────────────────────────────────────────

/** Marks our own notifications so cancelling never touches anyone else's. */
const TAG = 'panzi-expiry';

/** Read by MainTabs when a notification is tapped, to pick a destination. */
export type NotificationRoute = 'pantry' | 'recipes';

async function cancelOurs(): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((n) => (n.content.data as { tag?: string } | null)?.tag === TAG)
      .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier))
  );
}

/**
 * The suggestion the Recipes tab already generated, if it happens to fit.
 *
 * Only ever a read. `loadCachedRecipes` returns null for a stale signature or
 * an entry older than a day, and null is a perfectly good answer here — the
 * digest simply goes out without a recipe in it.
 */
async function cachedRecipeFor(
  uid: string,
  items: PantryItem[],
  profile: UserProfile
): Promise<string | null> {
  try {
    const set = await loadCachedRecipes(uid, pantrySignature(items, profile), 'anything');
    const featured = set?.featured;
    if (!featured) return null;
    // Only worth naming if it actually uses something that is about to go —
    // otherwise it is an advert rather than an answer.
    return featured.usesExpiring.length > 0 ? featured.title : null;
  } catch {
    return null;
  }
}

// Only one rebuild at a time.
//
// The caller is a React effect watching a Firestore listener, so it fires
// several times in quick succession on any change — and a rebuild is a long
// chain of awaits that starts by cancelling everything. Two of them
// interleaving would have one run's cancel land in the middle of the other
// run's scheduling: duplicate notifications, and a stored plan that describes
// neither. A second call while one is in flight is remembered rather than run,
// and happens once at the end with the latest arguments.
let running = false;
let queued: (() => Promise<void>) | null = null;

/**
 * Rebuilds the whole schedule from the pantry as it stands.
 *
 * Called on every pantry change and whenever the reminder settings move, so it
 * has to be cheap and idempotent: cancel everything of ours, then lay down one
 * notification per day that has something to say. Days with nothing due are
 * skipped entirely rather than scheduled and suppressed.
 */
export async function syncReminders(
  uid: string | null,
  items: PantryItem[],
  profile: UserProfile,
  prefs: { enabled: boolean; slot: TimeSlot }
): Promise<void> {
  if (running) {
    // Replaced, not appended: an older pending rebuild describes a pantry that
    // has already been superseded by this one.
    queued = () => rebuild(uid, items, profile, prefs);
    return;
  }
  running = true;
  try {
    await rebuild(uid, items, profile, prefs);
    while (queued) {
      const next = queued;
      queued = null;
      await next();
    }
  } finally {
    running = false;
  }
}

async function rebuild(
  uid: string | null,
  items: PantryItem[],
  profile: UserProfile,
  prefs: { enabled: boolean; slot: TimeSlot }
): Promise<void> {
  if (!uid) {
    await cancelOurs();
    return;
  }
  // Before anything is torn down: whatever the previous plan promised for a
  // time that has now passed is what the user was actually sent.
  await retirePlan(uid);
  await cancelOurs();
  if (!prefs.enabled || !(await hasPermission())) {
    await writeList(planKey(uid), []);
    return;
  }

  const hour = hourFor(prefs.slot);
  // Only the nearest notification gets a recipe: the cache is keyed to today's
  // pantry and expires within a day, so naming a dish on a reminder a week out
  // would be quoting an answer to a question nobody has asked yet.
  const recipe = await cachedRecipeFor(uid, items, profile);
  let attachedRecipe = false;
  const plan: LogEntry[] = [];

  for (let offset = 0; offset < SCHEDULE_DAYS; offset += 1) {
    const when = new Date();
    when.setDate(when.getDate() + offset);
    when.setHours(hour, 0, 0, 0);
    // Today's slot may already be behind us.
    if (when.getTime() <= Date.now()) continue;

    const digest = composeDigest(items, isoDaysFromNow(offset), attachedRecipe ? null : recipe);
    if (!digest) continue;
    attachedRecipe = true;

    await Notifications.scheduleNotificationAsync({
      content: {
        title: digest.title,
        body: digest.body,
        data: { tag: TAG, route: 'pantry' satisfies NotificationRoute },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: when,
      },
    });
    plan.push({ at: when.getTime(), title: digest.title, body: digest.body });
  }

  await writeList(planKey(uid), plan);
}

/**
 * Fires while the app is in the foreground, which is the one case the schedule
 * cannot account for on its own: the plan is retired by the next sync, and
 * nothing has to change in the pantry for six o'clock to arrive.
 */
export function onNotificationReceived(handler: () => void): () => void {
  const sub = Notifications.addNotificationReceivedListener(() => handler());
  return () => sub.remove();
}

/**
 * Where a tapped notification should land.
 *
 * The app has no navigator, so this hands the destination back to MainTabs
 * rather than routing itself. Returns an unsubscribe.
 */
export function onNotificationTap(handler: (route: NotificationRoute) => void): () => void {
  const sub = Notifications.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data as { tag?: string; route?: string };
    if (data?.tag !== TAG) return;
    handler(data.route === 'recipes' ? 'recipes' : 'pantry');
  });
  return () => sub.remove();
}

/** Everything off, without touching the stored preference. */
export async function cancelAll(): Promise<void> {
  await cancelOurs();
}

/**
 * Fires one immediately, for checking the wording without waiting on a clock.
 *
 * Writes to the log as well as sending, which a real reminder only does once
 * its hour has passed and the next sync retires it. Without that, the one way
 * to get anything into the history was to wait for six o'clock.
 *
 * Only reachable from the settings sheet in development.
 */
export async function sendTestNow(uid: string, items: PantryItem[]): Promise<Digest> {
  const digest =
    composeDigest(items, isoDaysFromNow(0)) ??
    // Nothing due is the normal case on a healthy pantry, and a test that does
    // nothing looks like a broken one.
    { title: 'Nothing needs eating', body: 'This is what a test looks like.' };

  await Notifications.scheduleNotificationAsync({
    content: { title: digest.title, body: digest.body, data: { tag: TAG, route: 'pantry' } },
    trigger: null,
  });

  const log = dedupe([{ at: Date.now(), ...digest }, ...(await readList(logKey(uid)))]).slice(
    0,
    LOG_MAX
  );
  await writeList(logKey(uid), log);
  return digest;
}

/**
 * Schedules a real reminder a minute from now, through the same path a six
 * o'clock one takes: a dated trigger, an entry in the plan, and a line in the
 * history once it has fired.
 *
 * The four preset hours make the finished feature impossible to test without
 * waiting for one of them to come round, and "Send one now" proves only that a
 * notification can be displayed — not that scheduling, firing while the app is
 * closed, retiring the plan and writing the log all work. This exercises all
 * of it in sixty seconds.
 *
 * Development only.
 */
export async function scheduleTestSoon(uid: string, items: PantryItem[]): Promise<Date> {
  const when = new Date(Date.now() + 60_000);
  const digest = composeDigest(items, isoDaysFromNow(0)) ?? {
    title: 'Nothing needs eating',
    body: 'A test reminder, one minute after you asked for it.',
  };

  await Notifications.scheduleNotificationAsync({
    content: { title: digest.title, body: digest.body, data: { tag: TAG, route: 'pantry' } },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: when },
  });

  // Appended rather than replacing: the real schedule is still standing, and
  // the next sync would drop this one otherwise.
  const plan = await readList(planKey(uid));
  await writeList(planKey(uid), [
    ...plan,
    { at: when.getTime(), title: digest.title, body: digest.body },
  ]);
  return when;
}
