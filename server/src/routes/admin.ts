// server/src/routes/admin.ts
//
// What the admin console reads. Every route here is mounted behind requireAuth
// *and* requireAdmin, so unlike every other file in routes/ these queries are
// deliberately not scoped to req.uid — reading across accounts is the whole
// point of the console. That inversion is the reason the admin claim rides on a
// Firebase custom claim rather than a Mongo field: a compromised document must
// not be able to promote anyone into here.
//
// The other rule this file follows: it only returns what the database can
// actually answer. Where the design asked for a number nothing records — uptime,
// per-ingredient recognition accuracy, a waste rate that needs a reason on a
// deleted item — the console keeps its own sample data and says so on the page.
// Inventing a plausible figure here would be worse than the gap.

import { Router } from 'express';
import { browseOptions, PAGE_SIZE, pageMetadata } from './adminBrowse';
import {
  ChatMessage,
  Feedback,
  PantryItem,
  RecipeRating,
  SavedRecipe,
  Scan,
  User,
} from '../models';
import { auth } from '../firebase';
import { badRequest, isValidId, localDay, relativeTime, withDb } from './helpers';
import { adminAccessRouter } from './adminAccess';
import { adminCatalogRouter } from './adminCatalog';
import { adminReportsRouter } from './adminReports';
import { adminAlertsRouter } from './adminAlerts';

export const adminRouter = Router();

// The derived screens live in their own files but mount here, so they inherit
// this router's gates rather than needing their own.
adminRouter.use(adminReportsRouter);
adminRouter.use(adminAlertsRouter);
adminRouter.use(adminCatalogRouter);
adminRouter.use(adminAccessRouter);

// --------------------------------------------------------------------- time

const DAY_MS = 24 * 60 * 60 * 1000;

const RANGES = {
  '7d': { days: 7, label: 'last 7 days', buckets: 7, unit: 'day' as const },
  '30d': { days: 30, label: 'last 30 days', buckets: 5, unit: 'week' as const },
  '90d': { days: 90, label: 'last 90 days', buckets: 3, unit: 'month' as const },
};

type RangeKey = keyof typeof RANGES;

function isRangeKey(value: unknown): value is RangeKey {
  return value === '7d' || value === '30d' || value === '90d';
}

/** 'Mar 2, 2026' — the format the console's Joined column expects. */
function formatDate(value: Date | string | number | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** 'YYYY-MM-DD' in the server's own timezone, to compare with expiryDate. */
/** A calendar day in the app's timezone (see localDay), not the server's. */
function isoDay(date: Date): string {
  return localDay(date);
}

// ------------------------------------------------------------------ display

// Avatar colours, assigned by uid rather than stored. Stable for a given
// account — a user whose colour changed between page loads would look like a
// different person in a list read top to bottom.
const AVATAR_COLORS = ['#4C8C5A', '#2C5C39', '#7BA37F', '#C0503F', '#6C6F7A'];

function avatarColor(uid: string): string {
  let hash = 0;
  for (let i = 0; i < uid.length; i++) hash = (hash * 31 + uid.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

/** A signed percentage change, or an em dash when the previous window was empty. */
function deltaOf(current: number, previous: number): { delta: string; up: boolean } {
  if (previous === 0) {
    if (current === 0) return { delta: 'no change', up: true };
    return { delta: 'new', up: true };
  }
  const pct = ((current - previous) / previous) * 100;
  const rounded = Math.round(pct * 10) / 10;
  return { delta: `${rounded >= 0 ? '+' : ''}${rounded}%`, up: rounded >= 0 };
}

// -------------------------------------------------------------- firebase lift

interface FirebaseRecord {
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  disabled: boolean;
  createdAt: string | null;
  lastSignInAt: string | null;
  /** 'google.com', 'password', … Empty means an anonymous account. */
  providers: string[];
  /** Holds the admin claim. Read here so the console can show it beside the
   *  account rather than making someone cross-reference the roster. */
  isAdmin: boolean;
}

/** 'Guest (older app)' / 'Email & password' / 'Facebook'. The current app
 *  only signs people up with an email or Facebook; an account with no provider
 *  at all is a guest account left over from an older version. */
function signInLabel(providers: string[] | undefined): string {
  if (!providers || providers.length === 0) return 'Guest (older app)';
  return providers
    .map((id) =>
      id === 'password'
        ? 'Email & password'
        : id === 'google.com'
          ? 'Google'
          : id === 'facebook.com'
            ? 'Facebook'
          : id === 'apple.com'
            ? 'Apple'
            : id === 'phone'
              ? 'Phone'
              : id
    )
    .join(', ');
}

/**
 * Email, display name and disabled state live in Firebase Auth, not in Mongo —
 * `users` is keyed by uid and holds only what the app itself writes.
 *
 * Listing them needs a service account (GOOGLE_APPLICATION_CREDENTIALS), which
 * is optional for this server: verifying a token needs only the project id.
 * When it is absent this returns an empty map instead of throwing, and the
 * console renders every account with its uid and no email — degraded, but not
 * broken, and the reason is reported in the payload rather than swallowed.
 */
async function loadFirebaseUsers(): Promise<{
  users: Map<string, FirebaseRecord>;
  warning: string | null;
}> {
  const users = new Map<string, FirebaseRecord>();

  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return {
      users,
      warning:
        'GOOGLE_APPLICATION_CREDENTIALS is not set, so emails and suspended state are unavailable. Point it at a Firebase service account key to fill them in.',
    };
  }

  try {
    // listUsers pages at 1000. Panzi is nowhere near that, but a loop costs one
    // line and removes a silent ceiling that would only show up as accounts
    // quietly missing from the list.
    let pageToken: string | undefined;
    do {
      const page = await auth.listUsers(1000, pageToken);
      for (const record of page.users) {
        users.set(record.uid, {
          email: record.email ?? null,
          displayName: record.displayName ?? null,
          photoURL: record.photoURL ?? null,
          disabled: record.disabled,
          createdAt: record.metadata.creationTime ?? null,
          lastSignInAt: record.metadata.lastSignInTime ?? null,
          providers: record.providerData.map((provider) => provider.providerId),
          isAdmin: record.customClaims?.admin === true,
        });
      }
      pageToken = page.pageToken;
    } while (pageToken);

    // Older app versions signed people in as guests, with no email. If no
    // account has one, a column of dashes with no explanation reads as a broken
    // console — so it is reported the same way a missing key is.
    const withEmail = [...users.values()].filter((record) => record.email).length;
    if (users.size > 0 && withEmail === 0) {
      return {
        users,
        warning:
          'No account has an email in Firebase: these are guest accounts from an older app version. Names shown come from the profile each user set in the app.',
      };
    }

    return { users, warning: null };
  } catch (err: any) {
    console.error('Admin: listUsers failed', { message: err?.message });
    return {
      users,
      warning: 'Could not read Firebase Auth — emails and suspended state are unavailable.',
    };
  }
}

/** uid -> the best name we have, for activity lines and the users table. */
function displayName(
  uid: string,
  mongoName: string | null | undefined,
  fb: FirebaseRecord | undefined
): string {
  return mongoName || fb?.displayName || fb?.email?.split('@')[0] || `Account ${uid.slice(0, 6)}`;
}

// ------------------------------------------------------------------ /users

adminRouter.get(
  '/users',
  withDb(async (req, res) => {
    const options = browseOptions(req.query);
    const statusFilter = req.query.status ?? 'All';
    if (!options || !['All', 'Active', 'Dormant', 'Suspended'].includes(String(statusFilter))) return badRequest(res, 'Choose valid account filters.');
    const [mongoUsers, firebase] = await Promise.all([
      User.find({}).lean(),
      loadFirebaseUsers(),
    ]);

    // One grouped count per collection rather than a query per user: a hundred
    // accounts would otherwise be four hundred round trips.
    const [
      itemCounts,
      scanCounts,
      recipeCounts,
      ratingCounts,
      lastItem,
      lastScan,
      lastChat,
      feedbackPlatforms,
    ] =
      await Promise.all([
        PantryItem.aggregate([{ $group: { _id: '$userId', n: { $sum: 1 } } }]),
        Scan.aggregate([{ $group: { _id: '$userId', n: { $sum: 1 } } }]),
        SavedRecipe.aggregate([{ $group: { _id: '$userId', n: { $sum: 1 } } }]),
        // Ratings are only given on cook mode's complete sheet, so this counts
        // dishes this person actually cooked — which saved recipes never did,
        // whatever the field was once called.
        RecipeRating.aggregate([{ $group: { _id: '$userId', n: { $sum: 1 } } }]),
        PantryItem.aggregate([{ $group: { _id: '$userId', t: { $max: '$updatedAt' } } }]),
        Scan.aggregate([{ $group: { _id: '$userId', t: { $max: '$createdAt' } } }]),
        ChatMessage.aggregate([{ $group: { _id: '$userId', t: { $max: '$createdAt' } } }]),
        // The fallback for accounts that predate device.ts: anyone who ever sent
        // feedback told us their platform at the time.
        Feedback.aggregate([
          { $match: { platform: { $nin: ['', null] } } },
          { $sort: { createdAt: -1 } },
          { $group: { _id: '$userId', platform: { $first: '$platform' } } },
        ]),
      ]);

    const countMap = (rows: { _id: string; n: number }[]) =>
      new Map(rows.map((row) => [row._id, row.n]));
    const timeMap = (rows: { _id: string; t: Date }[]) =>
      new Map(rows.map((row) => [row._id, new Date(row.t).getTime()]));

    const items = countMap(itemCounts);
    const scans = countMap(scanCounts);
    const recipes = countMap(recipeCounts);
    const rated = countMap(ratingCounts);
    const activity = [timeMap(lastItem), timeMap(lastScan), timeMap(lastChat)];
    const feedbackPlatform = new Map<string, string>(
      feedbackPlatforms.map((row: any) => [row._id, String(row.platform)])
    );

    // An account can exist in Firebase and never have written a document — a
    // signup that stopped at the survey. Those are exactly the accounts an admin
    // wants to see, so the list is the union of both sides rather than a walk of
    // the Mongo collection.
    const uids = new Set<string>([
      ...mongoUsers.map((user: any) => String(user._id)),
      ...firebase.users.keys(),
    ]);

    const mongoById = new Map(mongoUsers.map((user: any) => [String(user._id), user]));
    const now = Date.now();

    const payload = [...uids].map((uid) => {
      const mongo: any = mongoById.get(uid);
      const fb = firebase.users.get(uid);

      const lastActiveMs = Math.max(
        0,
        ...activity.map((map) => map.get(uid) ?? 0),
        fb?.lastSignInAt ? new Date(fb.lastSignInAt).getTime() : 0
      );

      // Three states, in priority order. Suspended is a fact Firebase holds;
      // dormant is a judgement this file makes, and 30 days is the same window
      // the app's own "Inactive 30+ days" notification audience uses.
      const status = fb?.disabled
        ? 'Suspended'
        : lastActiveMs === 0 || now - lastActiveMs > 30 * DAY_MS
          ? 'Dormant'
          : 'Active';

      return {
        id: uid,
        name: displayName(uid, mongo?.name, fb),
        email: fb?.email ?? '—',
        items: items.get(uid) ?? 0,
        scans: scans.get(uid) ?? 0,
        joinedAt: new Date(fb?.createdAt ?? mongo?.createdAt ?? 0).toISOString(),
        joined: formatDate(fb?.createdAt ?? mongo?.createdAt ?? null),
        status,
        last: lastActiveMs ? relativeTime(lastActiveMs) : 'never',
        // Two sources, newest first: the platform noted from the User-Agent on
        // this account's last authenticated call, then whatever it reported the
        // last time it sent feedback. Accounts that have done neither since
        // device.ts landed still read '—', which is the truth about them.
        device: mongo?.lastPlatform || feedbackPlatform.get(uid) || '—',
        // Without the service account there is no Firebase record to read, and
        // guessing 'guest' would be a claim about the account nobody checked.
        signInMethod: fb ? signInLabel(fb.providers) : 'Unknown',
        isAdmin: fb?.isAdmin === true,
        // Whether this account could ever use the console. Anonymous accounts
        // cannot: there is no password to sign in with, and the grant route
        // refuses them for the same reason.
        canBeAdmin: (fb?.providers ?? []).some((id) =>
          ['password', 'google.com', 'apple.com'].includes(id)
        ),
        av: avatarColor(uid),
        photoURL: mongo?.photoURL ?? fb?.photoURL ?? null,
        recipesCooked: recipes.get(uid) ?? 0,
        recipesRated: rated.get(uid) ?? 0,
      };
    });

    // Busiest first: an admin opening this screen is looking for someone who is
    // using the app, not for whoever happens to sort first alphabetically.
    payload.sort((a, b) => b.scans - a.scans || b.items - a.items || a.id.localeCompare(b.id));

    // Identity and disabled state come from Firebase; merge before filtering so
    // accounts without a Mongo profile and email searches stay correct.
    const matching = payload.filter(user =>
      (statusFilter === 'All' || user.status === statusFilter) &&
      `${user.name} ${user.email}`.toLowerCase().includes(options.q.toLowerCase()) &&
      new Date(user.joinedAt) <= options.asOf && (!options.from || new Date(user.joinedAt) >= options.from));
    res.json({ users: matching.slice((options.page - 1) * PAGE_SIZE, options.page * PAGE_SIZE), warning: firebase.warning ?? null, pagination: pageMetadata(options, matching.length) });
  })
);

// ------------------------------------------------- /users/:id/pantry

// The slide-over shows a snapshot, not the whole shelf.
const PANTRY_SNAPSHOT_LIMIT = 25;

adminRouter.get(
  '/users/:id/pantry',
  withDb(async (req, res) => {
    // Trimmed before the check: an id of nothing but whitespace survives a
    // length test, then matches no document and returns an empty pantry, which
    // reads as "this user has no food" rather than "that is not a user".
    const raw = req.params.id;
    const userId = typeof raw === 'string' ? raw.trim() : '';
    if (!isValidId(userId)) {
      badRequest(res, 'That is not a user id.');
      return;
    }

    // Soonest-expiring first, which is the order the app itself draws a pantry
    // in and the order that makes a snapshot worth reading.
    const rows = await PantryItem.find({ userId })
      .sort({ expiryDate: 1 })
      .limit(PANTRY_SNAPSHOT_LIMIT)
      .lean();

    const today = isoDay(new Date());

    res.json(
      rows.map((row: any) => ({
        name: row.name,
        qty: row.quantity || '—',
        exp: expiryPhrase(row.expiryDate, today),
      }))
    );
  })
);


// Accounts are not suspended from the console. The team decided the admin
// website only reads; account changes happen in Firebase if ever needed.

/** 'expires in 2 days' / 'expired 3 days ago' / 'no date'. */
function expiryPhrase(
  expiryDate: string | null | undefined,
  today: string,
  /** True when the date is Panzi's own estimate rather than one anybody
   *  stated, which the phrasing has to keep saying out loud. */
  estimated = false
): string {
  if (!expiryDate) return 'no date';
  const days = Math.round(
    (new Date(`${expiryDate}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) /
      DAY_MS
  );
  if (Number.isNaN(days)) return 'no date';
  const phrase =
    days === 0
      ? 'expires today'
      : days === 1
        ? 'expires tomorrow'
        : days > 1
          ? `expires in ${days} days`
          : days === -1
            ? 'expired yesterday'
            : `expired ${Math.abs(days)} days ago`;
  return estimated ? `${phrase} (est.)` : phrase;
}

// -------------------------------------------------------------- /dashboard

adminRouter.get(
  '/dashboard',
  withDb(async (req, res) => {
    const key = req.query.range;
    if (key !== undefined && !isRangeKey(key)) {
      badRequest(res, 'range must be 7d, 30d or 90d.');
      return;
    }
    const range = RANGES[isRangeKey(key) ? key : '30d'];

    const now = Date.now();
    const from = new Date(now - range.days * DAY_MS);
    // The window immediately before this one, same length — what every delta on
    // the stat row is measured against.
    const prevFrom = new Date(now - 2 * range.days * DAY_MS);

    const [current, previous, chartRows, outcomes, expiring, activity] = await Promise.all([
      windowTotals(from, new Date(now)),
      windowTotals(prevFrom, from),
      scanSeries(from),
      dateSourceMix(from),
      expiringSoon(),
      recentActivity(),
    ]);

    const activeDelta = deltaOf(current.activeUsers, previous.activeUsers);
    const scannedDelta = deltaOf(current.itemsScanned, previous.itemsScanned);
    const chatDelta = deltaOf(current.chatMessages, previous.chatMessages);
    const signupDelta = deltaOf(current.signups, previous.signups);

    const perDay = Math.round(current.itemsScanned / range.days);

    res.json({
      range: {
        label: range.label,
        stats: [
          {
            label: 'Active users',
            value: current.activeUsers.toLocaleString(),
            delta: activeDelta.delta,
            note: `of ${current.totalUsers.toLocaleString()} accounts`,
            up: activeDelta.up,
          },
          {
            label: 'Items scanned',
            value: current.itemsScanned.toLocaleString(),
            delta: scannedDelta.delta,
            note: `${perDay.toLocaleString()} per day`,
            up: scannedDelta.up,
          },
          {
            label: 'Chatbot messages',
            value: current.chatMessages.toLocaleString(),
            delta: chatDelta.delta,
            note: `${current.conversations.toLocaleString()} conversations`,
            up: chatDelta.up,
          },
          // The design's fourth card was Uptime, which nothing in this system
          // measures. New signups is the closest real figure and is the one an
          // admin would actually check next.
          {
            label: 'New signups',
            value: current.signups.toLocaleString(),
            delta: signupDelta.delta,
            note: 'accounts created',
            up: signupDelta.up,
          },
        ],
        chart: bucketScans(chartRows, range, now),
      },
      outcomes,
      // Not "System health" — nothing here measures latency or failures, which
      // are not stored anywhere. These are the pipeline's real counts, and the
      // console prints this label rather than the design's.
      healthLabel: 'Pipeline activity',
      health: [
        {
          label: 'Scans (24h)',
          value: current.scans24h.toLocaleString(),
          color: 'var(--green-deep)',
        },
        {
          label: 'Items still missing a date',
          value: current.undated.toLocaleString(),
          color: current.undated > 0 ? 'var(--amber)' : 'var(--green-deep)',
        },
        {
          label: 'Chat messages (24h)',
          value: current.chat24h.toLocaleString(),
          color: 'var(--green-deep)',
        },
        {
          label: 'Feedback (7d)',
          value: current.feedback7d.toLocaleString(),
          color: current.feedback7d > 0 ? 'var(--amber)' : 'var(--green-deep)',
        },
      ],
      activity,
      expiring,
    });
  })
);

interface WindowTotals {
  activeUsers: number;
  totalUsers: number;
  itemsScanned: number;
  chatMessages: number;
  conversations: number;
  signups: number;
  scans24h: number;
  chat24h: number;
  feedback7d: number;
  undated: number;
}

/** Everything the stat row needs for one time window. */
async function windowTotals(from: Date, to: Date): Promise<WindowTotals> {
  const dayAgo = new Date(Date.now() - DAY_MS);
  const weekAgo = new Date(Date.now() - 7 * DAY_MS);
  const window = { $gte: from, $lt: to };

  const [
    scanUsers,
    chatUsers,
    pantryUsers,
    totalUsers,
    scanTotals,
    chatMessages,
    conversations,
    signups,
    scans24h,
    chat24h,
    feedback7d,
    undated,
  ] = await Promise.all([
    Scan.distinct('userId', { createdAt: window }),
    ChatMessage.distinct('userId', { createdAt: window }),
    PantryItem.distinct('userId', { updatedAt: window }),
    User.estimatedDocumentCount(),
    Scan.aggregate([
      { $match: { createdAt: window } },
      {
        $group: {
          _id: null,
          // `candidates` is Mixed — it is the model's output, stored as it
          // arrived — so $size would throw on any document where it is not an
          // array. The guard costs nothing and keeps one malformed scan from
          // taking down the whole dashboard.
          items: {
            $sum: { $cond: [{ $isArray: '$candidates' }, { $size: '$candidates' }, 0] },
          },
        },
      },
    ]),
    ChatMessage.countDocuments({ createdAt: window }),
    ChatMessage.distinct('conversationId', { createdAt: window }),
    User.countDocuments({ createdAt: window }),
    Scan.countDocuments({ createdAt: { $gte: dayAgo } }),
    ChatMessage.countDocuments({ createdAt: { $gte: dayAgo } }),
    Feedback.countDocuments({ createdAt: { $gte: weekAgo } }),
    // Undated means undated on the one timeline: an item with a Panzi estimate
    // has a date to act on, and counting it as missing one would overstate the
    // gap the health card exists to report.
    PantryItem.countDocuments({ expiryDate: null, estimatedUseBy: null }),
  ]);

  // A user counts as active if they did anything at all in the window — scanned,
  // chatted, or touched their pantry. Signing in alone does not count; an app
  // opened and closed is not use.
  const active = new Set<string>([...scanUsers, ...chatUsers, ...pantryUsers]);

  return {
    activeUsers: active.size,
    totalUsers,
    itemsScanned: scanTotals[0]?.items ?? 0,
    chatMessages,
    conversations: conversations.length,
    signups,
    scans24h,
    chat24h,
    feedback7d,
    undated,
  };
}

interface ScanPoint {
  t: number;
  items: number;
  unresolved: number;
}

async function scanSeries(from: Date): Promise<ScanPoint[]> {
  const rows = await Scan.aggregate([
    { $match: { createdAt: { $gte: from } } },
    {
      $project: {
        _id: 0,
        createdAt: 1,
        items: { $cond: [{ $isArray: '$candidates' }, { $size: '$candidates' }, 0] },
        unresolved: { $ifNull: ['$unresolvedCount', 0] },
      },
    },
  ]);

  return rows.map((row: any) => ({
    t: new Date(row.createdAt).getTime(),
    items: row.items ?? 0,
    unresolved: row.unresolved ?? 0,
  }));
}

/**
 * Scans folded into the bars the chart draws.
 *
 * `m` is the share of a bar that needed a human afterwards — unresolved reads
 * over total reads. The design calls that segment "Manual fix", and an
 * unresolved candidate is exactly an item the scanner could not finish on its
 * own, so the label survives the move to real data unchanged.
 */
function bucketScans(
  points: ScanPoint[],
  range: (typeof RANGES)[RangeKey],
  now: number
): { label: string; v: number; m: number }[] {
  const size = (range.days / range.buckets) * DAY_MS;
  const start = now - range.days * DAY_MS;

  const buckets = Array.from({ length: range.buckets }, (_, i) => ({
    from: start + i * size,
    items: 0,
    unresolved: 0,
  }));

  for (const point of points) {
    const index = Math.min(buckets.length - 1, Math.floor((point.t - start) / size));
    if (index < 0) continue;
    buckets[index].items += point.items;
    buckets[index].unresolved += point.unresolved;
  }

  return buckets.map((bucket) => ({
    label: bucketLabel(new Date(bucket.from), range.unit),
    v: bucket.items,
    m: bucket.items === 0 ? 0 : Math.round((bucket.unresolved / bucket.items) * 100),
  }));
}

function bucketLabel(date: Date, unit: 'day' | 'week' | 'month'): string {
  if (unit === 'day') return date.toLocaleDateString('en-US', { weekday: 'short' });
  if (unit === 'month') return date.toLocaleDateString('en-US', { month: 'short' });
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Where the dates on stored items came from.
 *
 * This replaces the design's "Recognition outcomes", which needed a confidence
 * figure nothing stores. Provenance is the one thing the whole system already
 * guarantees — the app may estimate a use-by date, and the deal that makes
 * that acceptable is that the estimate stays visibly an estimate — so it is
 * both real and the thing most worth watching.
 *
 * Phase 2 gave items a `basis` alongside the older `dateSource`, and the two
 * do not line up one to one: a chip pick ("about a week") is neither a printed
 * date nor a typed one, and a Panzi estimate is a computed date the person
 * never stated. `basis` wins where it is set, `dateSource` answers for every
 * row written before it existed, and the two are folded into one set of
 * buckets here rather than shown as two competing charts — the question
 * ("where do our dates come from") did not become two questions.
 */
async function dateSourceMix(from: Date) {
  const rows = await PantryItem.aggregate([
    { $match: { createdAt: { $gte: from } } },
    {
      $group: {
        _id: {
          basis: '$basis',
          dateSource: '$dateSource',
          unknown: { $ifNull: ['$expiryUnknown', false] },
        },
        n: { $sum: 1 },
      },
    },
  ]);

  const counts = new Map<string, number>();
  let total = 0;
  for (const row of rows as any[]) {
    const key = provenanceBucket(row._id?.basis, row._id?.dateSource, row._id?.unknown);
    counts.set(key, (counts.get(key) ?? 0) + row.n);
    total += row.n;
  }

  const share = (key: string) => {
    const n = counts.get(key) ?? 0;
    const pct = total === 0 ? 0 : Math.round((n / total) * 100);
    return { pct: `${pct}%`, w: pct };
  };

  return [
    { label: 'Date read from the label', ...share('printed'), color: 'var(--green-primary)' },
    { label: 'Estimated by Panzi', ...share('estimated'), color: 'var(--green-soft)' },
    { label: 'Typed by the user', ...share('typed'), color: 'var(--green-pale)' },
    { label: 'Rough date chosen', ...share('rough'), color: 'var(--amber)' },
    { label: 'Date unknown', ...share('unknown'), color: 'var(--clay)' },
    { label: 'No date yet', ...share('none'), color: 'var(--track)' },
  ];
}

/**
 * One row's date provenance, as one of six words.
 *
 * Exported rather than local because adminCatalog's /foods asks the same
 * question of the same documents, and a second copy of this mapping is a
 * second place for the two systems of record to drift apart.
 */
export function provenanceBucket(
  basis: unknown,
  dateSource: unknown,
  expiryUnknown?: unknown
): 'printed' | 'estimated' | 'typed' | 'rough' | 'unknown' | 'none' {
  // Phase 2's own field first: an item that carries it was written by a client
  // that knows the difference between a printed date and a rough guess.
  if (basis === 'printed') return 'printed';
  if (basis === 'manual') return 'typed';
  if (basis === 'rough') return 'rough';
  if (basis === 'estimated') return 'estimated';

  // Everything written before `basis` existed. 'label' and 'printed' are the
  // same claim in two vocabularies; 'user' and 'manual' likewise.
  if (dateSource === 'label') return 'printed';
  if (dateSource === 'user') return 'typed';
  if (dateSource === 'estimated') return 'estimated';

  // "I don't know when this expires" is a stated answer, and filing it under
  // "no date yet" would lose the only difference between a person who told us
  // and a person who has not been asked.
  if (expiryUnknown === true) return 'unknown';
  return 'none';
}

/**
 * The design's 72-hour window, on the same one timeline the app itself draws.
 *
 * A Panzi estimate stands in wherever no date was printed or typed (Phase 2
 * §6: "never sort estimated and real dates into separate sections, the user
 * thinks in one timeline"). Leaving estimates out would have quietly emptied
 * this card as more of the pantry moved onto estimated dates — the food is
 * still about to go off either way.
 */
async function expiringSoon() {
  const today = new Date();
  const from = isoDay(today);
  const to = isoDay(new Date(today.getTime() + 3 * DAY_MS));

  const rows = await PantryItem.aggregate([
    { $set: { dueDate: { $ifNull: ['$expiryDate', '$estimatedUseBy'] } } },
    { $match: { dueDate: { $ne: null, $gte: from, $lte: to } } },
    {
      $group: {
        _id: { name: '$name', category: '$category' },
        // Distinct owners, not rows: two jars of the same thing in one pantry is
        // one household at risk, and "184 pantries" is the number the card
        // promises.
        users: { $addToSet: '$userId' },
        soonest: { $min: '$dueDate' },
      },
    },
    { $project: { _id: 1, soonest: 1, count: { $size: '$users' } } },
    { $sort: { count: -1 } },
    { $limit: 6 },
  ]);

  return rows.map((row: any, index: number) => {
    const days = Math.round(
      (new Date(`${row.soonest}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime()) /
        DAY_MS
    );
    return {
      id: `${row._id.name}-${index}`,
      name: row._id.name,
      cat: row._id.category || 'Uncategorised',
      count: String(row.count),
      due: days <= 0 ? 'today' : days === 1 ? '1 day' : `${days} days`,
    };
  });
}

/**
 * The feed, merged from the four collections that record something an admin
 * would want to see happen. Each query is small and capped; the merge and the
 * final trim happen here because Mongo has no cheap way to interleave four
 * collections by time.
 */
async function recentActivity() {
  const [scans, signups, feedback, saved] = await Promise.all([
    Scan.find({}).sort({ createdAt: -1 }).limit(5).lean(),
    User.find({}).sort({ createdAt: -1 }).limit(3).lean(),
    Feedback.find({}).sort({ createdAt: -1 }).limit(3).lean(),
    SavedRecipe.find({}).sort({ createdAt: -1 }).limit(3).lean(),
  ]);

  const uids = new Set<string>([
    ...scans.map((row: any) => row.userId),
    ...signups.map((row: any) => String(row._id)),
    ...feedback.map((row: any) => row.userId),
    ...saved.map((row: any) => row.userId),
  ]);

  const named = await User.find({ _id: { $in: [...uids] } })
    .select({ name: 1 })
    .lean();
  const nameById = new Map(named.map((row: any) => [String(row._id), row.name]));
  const nameOf = (uid: string) => nameById.get(uid) || `Account ${String(uid).slice(0, 6)}`;

  const events = [
    ...scans.map((row: any) => {
      const n = Array.isArray(row.addedItemIds) ? row.addedItemIds.length : 0;
      return {
        at: row.createdAt,
        text: `${nameOf(row.userId)} scanned ${n} item${n === 1 ? '' : 's'}`,
        color: (row.unresolvedCount ?? 0) > 0 ? 'var(--amber)' : 'var(--green-primary)',
      };
    }),
    ...signups.map((row: any) => ({
      at: row.createdAt,
      text: `${row.name || 'A new account'} registered`,
      color: 'var(--green-deep)',
    })),
    ...feedback.map((row: any) => ({
      at: row.createdAt,
      text: `Feedback from ${row.email || nameOf(row.userId)}`,
      color: 'var(--clay)',
    })),
    ...saved.map((row: any) => ({
      at: row.createdAt,
      text: `${nameOf(row.userId)} saved ${row.recipe?.title || 'a recipe'}`,
      color: 'var(--ink-muted)',
    })),
  ];

  return events
    .filter((event) => event.at)
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 6)
    .map((event, index) => ({
      id: `act-${index}`,
      text: event.text,
      time: relativeTime(event.at),
      color: event.color,
    }));
}
