// The shapes every screen renders. Written once here rather than per screen so
// that swapping the sample source for the real one is a change of implementation
// and not a change of contract — if /api/admin/* returns these, nothing in
// src/screens has to move.

export type RangeKey = '7d' | '30d' | '90d';

export type UserStatus = 'Active' | 'Dormant' | 'Suspended';

export interface AdminUser {
  /** Firebase uid. `users._id` in Mongo is the same value. */
  id: string;
  name: string;
  email: string;
  /** Count of that account's pantry_items. */
  items: number;
  /** Count of that account's scans. */
  scans: number;
  joined: string;
  status: UserStatus;
  last: string;
  /**
   * Platform of this account's last authenticated call — 'iOS', 'Android',
   * 'Expo Go', 'Web' — or '—' for an account that has not called since the
   * server started noting it.
   */
  device: string;
  /** 'Anonymous' / 'Email & password' / 'Google'. From Firebase providerData. */
  signInMethod?: string;
  /** Holds the admin claim — can read every account in the system. */
  isAdmin?: boolean;
  /** False for anonymous accounts: there is no password to sign in with, so the
   *  claim would be unusable and the server refuses to grant it. */
  canBeAdmin?: boolean;
  /** Avatar background. Sample data ships one; the server derives it from uid. */
  av: string;
  photoURL?: string | null;
  /** Saved recipes. Named before there was any way to know what was cooked. */
  recipesCooked?: number;
  /** Dishes this account rated after cooking — the closest thing to a cooked
   *  count the system records. */
  recipesRated?: number;
}

export interface PantryLine {
  name: string;
  qty: string;
  exp: string;
}

/**
 * An ingredient as the pantry knows it — aggregated from pantry_items, not read
 * from a catalog, because there is no catalog and the scanner has no class list.
 */
export interface FoodItem {
  id: string;
  name: string;
  cat: string;
  /** Median observed days between being added and the date it is due, whether
   *  that date was printed, typed, or estimated by Panzi. */
  shelf: string;
  /** Share of this ingredient's rows carrying a date to act on, whole percent.
   *  Rows whose owner said the date is unknown are not dated. */
  dated: number;
  /** Where those dates came from, whole percent each.
   *
   *  Six buckets rather than the original four because Phase 2 split what used
   *  to be one field: `printed` and `typed` are the old label/user, `estimated`
   *  is Panzi's own use-by calculation, `rough` is a chip pick ("about a
   *  week"), `unknown` is someone answering that they do not know, and `none`
   *  is nobody having said anything yet. */
  sources: {
    printed: number;
    estimated: number;
    typed: number;
    rough: number;
    unknown: number;
    none: number;
  };
  /** How sure Panzi was on the rows it dated itself — null when it has never
   *  dated this food, which is a different statement from "always sure". */
  estimates: { rows: number; low: number; medium: number; high: number } | null;
  /** Distinct accounts holding it. */
  pantries: number;
  /** Rows across all pantries. */
  items: number;
}

export interface FoodsResponse {
  foods: FoodItem[];
  categories: Category[];
  totalItems: number;
  note?: string | null;
}

export interface CostBar {
  label: string;
  value: string;
  pct: number;
}

export interface CostRoute {
  route: string;
  calls: number;
  cost: string;
  tokens: string;
  avgMs: number;
  pct: number;
}

export interface CostUser {
  userId: string;
  calls: number;
  cost: string;
}

export interface CostData {
  stats: WasteStat[];
  chart: CostBar[];
  routes: CostRoute[];
  users: CostUser[];
  note?: string | null;
}

/**
 * A dish, as the people using Panzi treated it.
 *
 * There is no recipe catalog behind this: every dish is written by the model
 * on the night it is suggested. The design's Published/Draft status and its
 * acceptance rate are gone from this shape because nothing in the system ever
 * answered them — saves and ratings are what the app actually records.
 */
export interface Recipe {
  /** The lowercased title, which is the identity saves and ratings share. */
  id: string;
  name: string;
  /** Median ingredient count across the saved copies of this dish. */
  ing: number;
  /** Accounts that kept it. */
  saves: number;
  /** Accounts that rated it. A rating is only given on cook mode's complete
   *  sheet, so this is also the number of people who cooked it and said so. */
  rated: number;
  /** Mean stars to one decimal, or null where nobody has rated it — which is
   *  not the same as nobody liking it. */
  stars: number | null;
  /** Share of ratings that were 4 or 5, whole percent; null when unrated. */
  liked: number | null;
  /** Dish key from the app's assets/dishes convention, e.g. `pancit_canton`.
   *  Absent means no photo exists yet and the card keeps its placeholder. */
  photo?: string;
  /** Last save or rating, ISO, for "nothing since March" reading. */
  lastAt?: string | null;
  /** Set when another dish shares this title — e.g. "Version 2 of 2". The
   *  server tells them apart by their ingredient lists. */
  version?: string;
}

export interface RecipesResponse {
  recipes: Recipe[];
  note?: string | null;
}

export type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';

export interface LogEntry {
  id: string;
  time: string;
  level: LogLevel;
  event: string;
  detail: string;
}

export interface StatCard {
  label: string;
  value: string;
  delta: string;
  note: string;
  up: boolean;
}

export interface ChartBar {
  label: string;
  /** Raw value. Bar heights are a percentage of the tallest bar in the series. */
  v: number;
  /** Share of that bar that was a manual fix, whole percent. */
  m: number;
}

export interface RangeData {
  label: string;
  stats: StatCard[];
  chart: ChartBar[];
}

export interface Outcome {
  label: string;
  pct: string;
  w: number;
  color: string;
}

export interface HealthRow {
  label: string;
  value: string;
  color: string;
}

export interface ActivityRow {
  id: string;
  text: string;
  time: string;
  color: string;
}

export interface ExpiringRow {
  id: string;
  name: string;
  cat: string;
  count: string;
  due: string;
}

export interface Category {
  label: string;
  n: number;
}

export interface WasteStat {
  label: string;
  value: string;
  note: string;
}

export interface WasteBar {
  label: string;
  saved: number;
  wasted: number;
  savedPct?: number;
  wastedPct?: number;
}

export interface WastedItem {
  name: string;
  n: string;
  w: number;
}

export interface SentNotification {
  id: string;
  title: string;
  body: string;
  audience: string;
  delivered: string;
  opened: string;
  time: string;
}

export type FlagKey =
  | 'freshness'
  | 'chatbot'
  | 'restock'
  | 'unused'
  | 'nutrition'
  | 'autoDeduct';

export type Flags = Record<FlagKey, boolean>;

export interface Threshold {
  key: string;
  label: string;
  value: string;
  unit: string;
}

export interface ModelInfo {
  version: string;
  deployed: string;
  classes: string;
  topAccuracy: string;
}

export interface DashboardData {
  range: RangeData;
  outcomes: Outcome[];
  /** The API names this card, because what it can measure decides what it is.
   *  Sample data has no opinion and the design's "System health" stands. */
  healthLabel?: string;
  health: HealthRow[];
  activity: ActivityRow[];
  expiring: ExpiringRow[];
}

/** The users endpoint reports degraded reads rather than hiding them: without a
 *  Firebase service account there are no emails, and the console should say so
 *  instead of rendering a column of dashes with no explanation. */
export interface UsersResponse {
  pagination?: PageMetadata;
  users: AdminUser[];
  warning: string | null;
}

export interface AnalyticsData {
  stats: WasteStat[];
  chart: WasteBar[];
  wasted: WastedItem[];
  /** Set when the figures rest on an inference rather than a stated reason. */
  note?: string | null;
  /** Absent in sample mode, which has no scans to be accurate about. */
  accuracy?: ScannerAccuracy;
  locations?: LocationRow[];
  /** Removals the waste half rests on. Zero means nothing has been recorded —
   *  which is a different statement from "nothing was wasted". */
  removals?: number;
}

export interface LogsResponse {
  pagination?: PageMetadata;
  logs: LogEntry[];
  /** The day the rows were read, for the footer. */
  date: string;
  note?: string | null;
}

export interface SettingsData {
  flags: Flags;
  thresholds: Threshold[];
  model: ModelInfo;
}

/** A scan the scanner could not finish on its own. */
export type ReviewStatus = 'new' | 'in_progress' | 'resolved';
export type ReviewFilter = 'open' | ReviewStatus | 'all';
export interface ReviewState {
  status: ReviewStatus;
  note: string;
  revision: number;
  updatedBy: string | null;
  updatedAt: string | null;
}
export interface ReviewScan {
  review?: ReviewState;
  id: string;
  user: string;
  userId: string;
  at: string;
  scene: string;
  items: number;
  unresolved: number;
  added: number;
  /** Names of the candidates that came back without an expiry date. */
  undated: string[];
  /** Candidates the scanner flagged as an uncertain read, with what it weighed. */
  unsure: { name: string; reason: string | null; alternatives: string[] }[];
}

/** One message from the app's feedback box. */
export interface ReviewFeedback {
  review?: ReviewState;
  id: string;
  user: string;
  userId: string;
  email: string | null;
  message: string;
  platform: string;
  appVersion: string;
  at: string;
}

export interface ReviewData {
  pagination?: { page: number; pageSize: number; scans: number; feedback: number; asOf?: string };
  scans: ReviewScan[];
  feedback: ReviewFeedback[];
  note?: string | null;
}

/** An account holding the admin claim. */
export interface AdminAccount {
  id: string;
  email: string;
  /** False for an anonymous account: it holds the claim but cannot use it. */
  canSignIn: boolean;
  disabled: boolean;
  createdAt: string | null;
  lastSignInAt: string | null;
  isYou: boolean;
}

export interface AdminsResponse {
  admins: AdminAccount[];
  note?: string | null;
}

export interface ConfigRow {
  label: string;
  value: string;
  note: string;
}

export interface ConfigResponse {
  groups: { title: string; rows: ConfigRow[] }[];
}

/** A conversation, with no message text — that needs a second, audited request. */
export interface ChatSummary {
  id: string;
  title: string;
  user: string;
  userId: string;
  messages: number;
  asked: number;
  recipes: number;
  at: string;
}

export interface ChatsResponse {
  pagination?: PageMetadata;
  conversations: ChatSummary[];
  note?: string | null;
}

export interface ChatTurn {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  /** Set when the assistant answered with a recipe instead of prose. */
  recipeTitle: string | null;
  at: string;
}

export interface ChatTranscript {
  id: string;
  title: string;
  user: string;
  userId: string;
  messages: ChatTurn[];
  truncated: boolean;
}

/** How often a user disagreed with what the scanner read. Percentages are null
 *  rather than zero when nothing has been read yet — 0% would be a claim. */
export interface ScannerAccuracy {
  scans: number;
  read: number;
  handAdded: number;
  removed: number;
  readShare: number | null;
  name: { confirmed: number; corrected: number; untouched: number; correctedPct: number | null };
  date: {
    confirmed: number;
    corrected: number;
    untouched: number;
    absent: number;
    correctedPct: number | null;
    absentPct: number | null;
  };
  note?: string | null;
}

export interface LocationRow {
  label: string;
  n: number;
  pct: number;
}

export type BrowseRange = 'all' | '7d' | '30d' | '90d';
export interface BrowseQuery { page?: number; q?: string; range?: BrowseRange; before?: string; status?: string; level?: string }
export interface PageMetadata { page: number; pageSize: number; total: number; asOf: string }
export interface AlertsResponse {
  alerts: { id: string; title: string; detail: string; href: string; action: string; severity: 'warning' | 'error' }[];
  checkedAt: string;
  note: string;
}
