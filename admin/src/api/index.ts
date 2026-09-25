// Every read the console makes, in one place.
//
// Each loader has two bodies: the sample one, which is the prototype's data,
// and the real one, which calls /api/admin/*. `SAMPLE_MODE` picks between them,
// so building the server routes means flipping VITE_SAMPLE_DATA to false and
// changing nothing in src/screens.
//
// `SAMPLE_ONLY` is the honest part. Some screens were designed against data the
// backend does not store at all — there is no ingredient catalog, no recipe CMS,
// no disposition on a deleted pantry item, no persisted log stream. Those stay
// sample regardless of the flag, and the screens say so on the page rather than
// letting a demo figure be read as a measurement.

import { ApiError, apiFetch, SAMPLE_MODE } from './client';
import * as sample from './sample';
import type {
  AdminUser,
  BrowseQuery,
  BrowseRange,
  AlertsResponse,
  AnalyticsData,
  CostData,
  DashboardData,
  FoodsResponse,
  LogsResponse,
  PantryLine,
  RangeKey,
  AdminsResponse,
  ChatsResponse,
  ChatTranscript,
  ConfigResponse,
  RecipesResponse,
  ReviewData,
  ReviewState,
  ReviewFilter,
  UsersResponse,
} from './types';

/** Screens with no backing collection yet. See admin/README.md. */
export const SAMPLE_ONLY = {
  food: 'Preview ingredients are shown here. Connected data reflects what users store in their pantries.',
  recipes:
    'Example dishes for preview. Connected data counts saved dishes and the stars people gave after cooking.',
  analytics:
    'Example trends for preview. Connected reports use recorded pantry removals.',
  logs: 'Example events for preview. Connected logs include AI requests, administrator activity and account deletions.',
} as const;

/** A shareable design preview: sample data plus sample review and chat rows. */
const PUBLIC_PREVIEW = import.meta.env.VITE_PUBLIC_PREVIEW === 'true';

const delay = <T,>(value: T): Promise<T> =>
  // A tick of latency so loading states are exercised in sample mode rather
  // than only appearing for the first time against a real server.
  new Promise((resolve) => setTimeout(() => resolve(value), 120));

function queryString(options: BrowseQuery) {
  return new URLSearchParams(Object.entries(options).filter(([, value]) => value !== undefined && value !== '').map(([key, value]) => [key, String(value)])).toString();
}
function samplePage<T>(rows: T[], options: BrowseQuery) {
  const page = options.page ?? 1;
  return { rows: rows.slice((page - 1) * 25, page * 25), pagination: { page, pageSize: 25, total: rows.length, asOf: options.before ?? new Date().toISOString() } };
}
export async function getAlerts(): Promise<AlertsResponse> {
  if (SAMPLE_MODE) return delay({ alerts: [], checkedAt: new Date().toISOString(), note: 'Connect to your server to check recorded activity.' });
  return apiFetch('/api/admin/alerts');
}

export async function getDashboard(range: RangeKey): Promise<DashboardData> {
  if (SAMPLE_MODE) {
    return delay({
      range: sample.RANGES[range],
      outcomes: sample.OUTCOMES,
      health: sample.HEALTH,
      activity: sample.ACTIVITY,
      expiring: sample.EXPIRING,
    });
  }
  return apiFetch<DashboardData>(`/api/admin/dashboard?range=${range}`);
}

export async function getUsers(options: BrowseQuery = {}): Promise<UsersResponse> {
  if (SAMPLE_MODE) {
    const before = new Date(options.before ?? Date.now());
    const from = options.range && options.range !== 'all' ? new Date(before.getTime() - Number(options.range.slice(0, -1)) * 86400000) : null;
    const filtered = sample.USERS.filter(user => `${user.name} ${user.email}`.toLowerCase().includes((options.q ?? '').toLowerCase()) && (!options.status || options.status === 'All' || user.status === options.status) && (!from || new Date(user.joined) >= from));
    const result = samplePage(filtered, options);
    return delay({ users: result.rows, warning: null, pagination: result.pagination });
  }
  // The endpoint returns a bare array when it has everything and an envelope
  // when something was unavailable, so both shapes have to be accepted here
  // rather than making every caller check.
  const payload = await apiFetch<AdminUser[] | UsersResponse>(`/api/admin/users?${queryString(options)}`);
  return Array.isArray(payload) ? { users: payload, warning: null } : payload;
}

export async function getUserPantry(userId: string): Promise<PantryLine[]> {
  if (SAMPLE_MODE) return delay(sample.PANTRY);
  return apiFetch<PantryLine[]>(`/api/admin/users/${encodeURIComponent(userId)}/pantry`);
}


/**
 * The two queues that want a person: unfinished scans and written feedback.
 *
 * No sample fallback beyond an empty pair. Both collections are real and the
 * app writes to both, so a demo row here would be a fabricated complaint from a
 * user who never sent one.
 */
export async function getReview(status: ReviewFilter = 'open', page = 1, range: BrowseRange = 'all', before?: string): Promise<ReviewData> {
  if (SAMPLE_MODE) {
    if (PUBLIC_PREVIEW) return delay(sample.PREVIEW_REVIEW);
    return delay({
      scans: [],
      feedback: [],
      note: 'Connect to your server to view scan issues and user feedback.',
    });
  }
  return apiFetch<ReviewData>(`/api/admin/review?${queryString({ status, page, range, before })}`);
}

export async function updateReview(kind: 'scans' | 'feedback', id: string, review: Pick<ReviewState, 'status' | 'note' | 'revision'>): Promise<{ review: ReviewState }> {
  if (SAMPLE_MODE) throw new ApiError('sample-mode', 'Connect to your server to save review decisions.');
  return apiFetch(`/api/admin/review/${kind}/${encodeURIComponent(id)}`, { method: 'PATCH', body: review });
}

/** Every account holding the admin claim. */
export async function getAdmins(): Promise<AdminsResponse> {
  if (SAMPLE_MODE) {
    return delay({
      admins: [],
      note: 'Administrator accounts are available when connected to your server.',
    });
  }
  return apiFetch<AdminsResponse>('/api/admin/admins');
}


/** What this server is configured to do, read from the running process. */
export async function getConfig(): Promise<ConfigResponse> {
  if (SAMPLE_MODE) return delay({ groups: [] });
  return apiFetch<ConfigResponse>('/api/admin/config');
}

export async function getChats(options: BrowseQuery = {}): Promise<ChatsResponse> {
  if (SAMPLE_MODE) {
    if (PUBLIC_PREVIEW) return delay(sample.PREVIEW_CHATS);
    return delay({
      conversations: [],
      note: 'Connect to your server to view conversations.',
    });
  }
  return apiFetch<ChatsResponse>(`/api/admin/chats?${queryString(options)}`);
}

/** One transcript. A separate request on purpose: opening someone's words is a
 *  separate line in the audit log from listing that they exist. */
export async function getChatTranscript(id: string): Promise<ChatTranscript> {
  if (SAMPLE_MODE && PUBLIC_PREVIEW && sample.PREVIEW_TRANSCRIPTS[id]) return delay(sample.PREVIEW_TRANSCRIPTS[id]);
  return apiFetch<ChatTranscript>(`/api/admin/chats/${encodeURIComponent(id)}`);
}

export async function getFoods(): Promise<FoodsResponse> {
  if (SAMPLE_MODE) {
    return delay({
      foods: sample.FOODS,
      categories: sample.CATEGORIES,
      totalItems: sample.FOODS.reduce((sum, food) => sum + food.items, 0),
      note: null,
    });
  }
  return apiFetch<FoodsResponse>('/api/admin/foods');
}

/**
 * Spend against the Anthropic key. Sample mode has nothing honest to show here
 * — a made-up dollar figure is worse than an empty screen — so it reports that
 * rather than inventing one.
 */
export async function getCosts(range: RangeKey): Promise<CostData> {
  if (SAMPLE_MODE) {
    return delay({
      stats: [
        { label: 'Total spend', value: '—', note: 'sample mode' },
        { label: 'Per scan', value: '—', note: 'sample mode' },
        { label: 'Per recipe', value: '—', note: 'sample mode' },
        { label: 'Served from cache', value: '—', note: 'sample mode' },
      ],
      chart: [],
      routes: [],
      users: [],
      note: 'Spending appears when connected to your server. No cost data is shown in this preview.',
    });
  }
  return apiFetch<CostData>(`/api/admin/costs?range=${range}`);
}

/**
 * Was sample-only, and is not any more.
 *
 * The screen was designed against a recipe CMS that does not exist. What does
 * exist now is saved_recipes and recipe_ratings, which answer the two
 * questions the cards were really asking — did people keep this, and was it
 * any good — so this reads the server like every other screen.
 */
export async function getRecipes(): Promise<RecipesResponse> {
  if (SAMPLE_MODE) return delay({ recipes: sample.RECIPES, note: null });
  return apiFetch<RecipesResponse>('/api/admin/recipes');
}

export async function getAnalytics(range: RangeKey): Promise<AnalyticsData> {
  if (SAMPLE_MODE) return delay(sample.ANALYTICS);
  return apiFetch<AnalyticsData>(`/api/admin/analytics?range=${range}`);
}


export async function getLogs(options: BrowseQuery = {}): Promise<LogsResponse> {
  if (SAMPLE_MODE) {
    const before = new Date(options.before ?? Date.now());
    const from = options.range && options.range !== 'all' ? new Date(before.getTime() - Number(options.range.slice(0, -1)) * 86400000) : null;
    const rows = sample.LOGS.map(row => ({ ...row, time: new Date(`${sample.LOGS_DATE} ${row.time}`).toISOString() }))
      .filter(row => `${row.event} ${row.detail}`.toLowerCase().includes((options.q ?? '').toLowerCase()) &&
        (!options.level || options.level === 'All' || row.level === options.level) && new Date(row.time) <= before && (!from || new Date(row.time) >= from));
    const result = samplePage(rows, options);
    return delay({ logs: result.rows, pagination: result.pagination, date: sample.LOGS_DATE, note: null });
  }
  return apiFetch<LogsResponse>(`/api/admin/logs?${queryString(options)}`);
}


export { SAMPLE_MODE };
export * from './types';
