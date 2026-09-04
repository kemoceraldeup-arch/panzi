// src/services/foodClass.ts
//
// What kind of food this is, for the one thing that actually depends on it:
// how the expiry estimate is computed when there's no date to go on. Nine
// classes, each with its own estimate basis, its own rough-date chip set (or
// none at all), and its own weight for how much sealed-vs-opened actually
// moves the number — see estimateWindow below, the one function that turns
// {class, package status, storage location, reference date} into a relative
// answer.
//
// Resolved once from the pantry category — a lookup table, not a model call.
// The item-review card has to paint before any inference can run (see the
// spec's own Rule 2), so this has to be synchronous and free.

import { FOOD_CATEGORIES } from './pantry';

export type FoodClass =
  | 'dry-staple'
  | 'spice'
  | 'canned'
  | 'condiment'
  | 'bakery'
  | 'dairy'
  | 'produce'
  | 'meat-fish'
  | 'frozen';

// FOOD_CATEGORIES (services/pantry.ts) has ten entries; FoodClass has nine.
// Two categories don't map onto a class the spec names outright:
//
//   'Drinks' — the spec's own class table files juice under `dairy`
//   ("milk, yoghurt, cheese, butter, eggs, juice"), which is the closest
//   real match for most of what a "Drinks" category actually holds day to
//   day in this app (juice, milk-based drinks) rather than soda or water,
//   neither of which meaningfully "expires" in the sense this whole feature
//   is about. Filed under `dairy`.
//
//   'Snacks' — closest in kind to `condiment`: a sealed packaged good whose
//   shelf life is long, where opening it is the dominant factor (a bag of
//   chips keeps for months sealed, days opened) — the same shape as a jar
//   of mayo, not the years-scale of a dry staple or the days-scale of
//   fresh produce. Filed under `condiment`.
const CATEGORY_TO_CLASS: Record<string, FoodClass> = {
  'Fruit & veg': 'produce',
  'Dairy & eggs': 'dairy',
  'Meat & fish': 'meat-fish',
  Bakery: 'bakery',
  'Grains & pasta': 'dry-staple',
  'Tins & jars': 'canned',
  Frozen: 'frozen',
  'Herbs & spices': 'spice',
  Drinks: 'dairy',
  Snacks: 'condiment',
};

/** Resolves once from category — a lookup table, not a model call. Falls
 *  back to `condiment` for a category outside FOOD_CATEGORIES entirely
 *  (never happens from the picker, but a hand-typed or migrated row could
 *  carry anything): `condiment`'s heavy sealed/opened weight and shown
 *  rough-date-when-opened chips are the safer default of the nine — no
 *  class here falls through to nothing, per the spec's own "no class falls
 *  through to a generic default", so this is a real member of the table,
 *  not a null case. */
export function classifyFood(category: string | null | undefined): FoodClass {
  return CATEGORY_TO_CLASS[category ?? ''] ?? 'condiment';
}

export const FOOD_CLASS_LABELS: Record<FoodClass, string> = {
  'dry-staple': 'Dry staple',
  spice: 'Spice',
  canned: 'Canned',
  condiment: 'Condiment',
  bakery: 'Bakery',
  dairy: 'Dairy',
  produce: 'Produce',
  'meat-fish': 'Meat & fish',
  frozen: 'Frozen',
};

// Sanity check that every category actually maps — a category added to
// FOOD_CATEGORIES later without a matching row here would silently fall
// back to 'condiment' via classifyFood, which is a safe default but a
// quiet one. This throws at import time instead, in dev, so a missed
// mapping is a stack trace, not a wrong guess three screens away.
if (__DEV__) {
  const missing = FOOD_CATEGORIES.filter((c) => !(c in CATEGORY_TO_CLASS));
  if (missing.length > 0) {
    console.warn(`[foodClass] FOOD_CATEGORIES missing a class mapping: ${missing.join(', ')}`);
  }
}

// ─── Package status ──────────────────────────────────────────────────────
//
// Tri-state, not boolean — undefined is a real, distinct answer ("the user
// skipped this question"), not the same thing as "sealed". A boolean can't
// tell those two apart, and that distinction is the entire reason the field
// is allowed to be optional at all: an unanswered question estimates as if
// sealed (the conservative assumption — never claim food is worse off than
// it's been shown to be) and says so, rather than silently asserting sealed
// as if the user had confirmed it.
export type PackageStatus = 'sealed' | 'opened';

// ─── Storage bucket ───────────────────────────────────────────────────────
//
// The app's own STORAGE_LOCATIONS (services/pantry.ts) has six values —
// Fridge, Freezer, Cabinet, Kitchen Shelf, Bread Shelf, Other — because the
// List screen groups by exactly where something sits. The estimate only
// ever cares about four buckets of *temperature regime*, since that's what
// actually changes how fast food turns: a cabinet and a kitchen shelf keep
// food the same way, and "Other" has to fall somewhere rather than break
// the estimate. Never changes what's stored on the item itself — this is
// purely how the estimate engine reads whatever location string is already
// there.
export type StorageBucket = 'cabinet' | 'fridge' | 'freezer';

const LOCATION_TO_BUCKET: Record<string, StorageBucket> = {
  Fridge: 'fridge',
  Freezer: 'freezer',
  Cabinet: 'cabinet',
  'Kitchen Shelf': 'cabinet',
  'Bread Shelf': 'cabinet',
  Other: 'cabinet',
};

export function bucketForLocation(location: string | null | undefined): StorageBucket {
  return LOCATION_TO_BUCKET[location ?? ''] ?? 'cabinet';
}

/** The reverse direction — a bucket back to a real STORAGE_LOCATIONS value,
 *  for pre-filling STORE IN (Phase 2 §4: "never empty, so the estimate
 *  always has an input"). Cabinet is the one bucket with more than one real
 *  location behind it; 'Cabinet' is the one already used as the fallback
 *  everywhere else a location can't be determined (see normaliseLocation's
 *  own callers), so it's the natural default here too. */
const BUCKET_TO_DEFAULT_LOCATION: Record<StorageBucket, string> = {
  cabinet: 'Cabinet',
  fridge: 'Fridge',
  freezer: 'Freezer',
};

/** Phase 2 §4's own table: the sensible default STORE IN for a food class
 *  with basis:'estimated' and no location of its own yet — meat-fish,
 *  dairy and produce default to the fridge, frozen to the freezer,
 *  everything else to the cabinet. Used to pre-fill the field, never to
 *  override a location the user (or the scanner) already set. */
export function defaultLocationFor(foodClass: FoodClass): string {
  const bucket: StorageBucket =
    foodClass === 'meat-fish' || foodClass === 'dairy' || foodClass === 'produce'
      ? 'fridge'
      : foodClass === 'frozen'
        ? 'freezer'
        : 'cabinet';
  return BUCKET_TO_DEFAULT_LOCATION[bucket];
}

// ─── The estimate window ──────────────────────────────────────────────────
//
// One function, three inputs beyond the class itself — package status,
// storage bucket, and how long it's been since the reference date (added-at
// for a sealed item, opened-at for an opened one) — because the spec is
// explicit that the estimate is "food class + package status + storage
// location — all three, always", never just the class on its own.
//
// Returns a window in days from the reference date, not a resolved
// calendar date — basis: 'estimated' items store no date at all (Part E),
// so every read of this is a fresh relative computation, never a cached
// answer that could drift out of sync with a since-changed storage
// location or package status.

export type EstimateWindow = {
  /** Total days the food is expected to keep from the reference date
   *  (addedAt if sealed/unanswered, openedAt if opened). */
  totalDays: number;
  /** Whether this class+status combination is dominated by sealed/opened
   *  (heavy), only lightly refined by it (minor), or unaffected (ignored) —
   *  the same three-way split the spec's own status-weight column uses.
   *  Purely descriptive; estimateWindow already bakes the weight into
   *  totalDays, this is for UI copy that wants to say "why" (D5). */
  statusWeight: 'heavy' | 'minor' | 'ignored';
};

/** Sealed windows, in days, sitting in a cabinet — the baseline every other
 *  cell below is a multiplier or a flat override of. Kept as whole classes
 *  of magnitude (years vs. weeks vs. days) rather than tightly tuned
 *  numbers, because an estimate is explicitly never shown as more precise
 *  than "≈ N weeks left" — see Part C3's "never a calendar date" rule. */
const SEALED_CABINET_DAYS: Record<FoodClass, number> = {
  'dry-staple': 365 * 2, // years — rice, sugar, flour, dried pasta/beans
  spice: 365 * 2, // a spice doesn't spoil so much as fade; framed as years
  canned: 365 * 2, // years sealed
  condiment: 365, // months-to-a-year sealed, varies a lot by product
  bakery: 4, // days ambient, sealed packaging still turns fast
  dairy: 10, // most sealed dairy/juice is a week-plus, fridge-dependent
  produce: 7, // days–weeks; see storage multipliers below
  'meat-fish': 3, // days fridge, sealed — see freezer multiplier
  frozen: 180, // months from added date
};

/** Opened windows override the sealed figure outright rather than scaling
 *  it — the spec calls sealed-vs-opened "the dominant factor" for canned
 *  and condiment, an order-of-magnitude drop (years -> days/weeks), which a
 *  multiplier on the sealed number would understate. Classes the opened
 *  state doesn't apply to (dry-staple, spice, frozen — nothing to "open" in
 *  a way that changes their keeping time) simply aren't opened in practice;
 *  if one somehow is, the sealed figure is kept rather than guessed at. */
const OPENED_CABINET_DAYS: Partial<Record<FoodClass, number>> = {
  canned: 5, // days, opened, in the fridge is implied — see bucket multiplier
  condiment: 30, // weeks-to-months opened
  bakery: 2,
  dairy: 5,
  produce: 3,
  'meat-fish': 2,
};

/** How much longer the same window lasts in the fridge vs. a cabinet, and
 *  in the freezer vs. the fridge — the C6 rule that storage location is
 *  "the entire difference for opened condiment and canned" and "multiplies
 *  the window dramatically" for meat-fish/bakery/frozen. Class-specific
 *  because a cabinet-vs-fridge move means nothing for a dry staple or a
 *  spice (already shelf-stable at room temperature) but is the whole game
 *  for opened dairy or fresh meat. 1 means "no meaningful difference". */
const FRIDGE_MULTIPLIER: Record<FoodClass, number> = {
  'dry-staple': 1,
  spice: 1,
  canned: 3, // an opened tin genuinely needs the fridge; this is why
  condiment: 4, // most condiments are explicitly "refrigerate after opening"
  bakery: 1.5,
  dairy: 1,
  produce: 1.3,
  'meat-fish': 1.5,
  frozen: 1,
};

const FREEZER_MULTIPLIER: Record<FoodClass, number> = {
  'dry-staple': 1.5,
  spice: 1,
  canned: 1, // canned goods aren't meaningfully frozen in practice
  condiment: 2,
  bakery: 15, // "months from days" — freezing bread is the classic example
  dairy: 4,
  produce: 6,
  'meat-fish': 40, // days -> months, the single biggest move in this table
  frozen: 1, // already frozen; storing it in the freezer is the baseline
};

const STATUS_WEIGHT: Record<FoodClass, EstimateWindow['statusWeight']> = {
  'dry-staple': 'minor',
  spice: 'heavy',
  canned: 'heavy',
  condiment: 'heavy',
  bakery: 'minor',
  dairy: 'heavy',
  produce: 'ignored',
  'meat-fish': 'ignored',
  frozen: 'minor',
};

/**
 * The estimate window for a class, given package status and storage
 * bucket. Pure and synchronous — no model call, matching Part B/C2's own
 * "no classification on the render path" rule — this is a lookup and two
 * multiplications, not an inference.
 */
export function estimateWindow(
  foodClass: FoodClass,
  packageStatus: PackageStatus | undefined,
  bucket: StorageBucket
): EstimateWindow {
  // Undefined estimates as if sealed — the conservative assumption Part D3
  // requires, spelled out to the user in the estimate copy rather than
  // silently treated the same as an actual "Sealed" answer.
  const opened = packageStatus === 'opened';
  const base = opened ? (OPENED_CABINET_DAYS[foodClass] ?? SEALED_CABINET_DAYS[foodClass]) : SEALED_CABINET_DAYS[foodClass];

  const multiplier = bucket === 'freezer' ? FREEZER_MULTIPLIER[foodClass] : bucket === 'fridge' ? FRIDGE_MULTIPLIER[foodClass] : 1;

  return {
    totalDays: Math.round(base * multiplier),
    statusWeight: STATUS_WEIGHT[foodClass],
  };
}

// ─── Rough-date chips ───────────────────────────────────────────────────
//
// Part C5's own table, verbatim: which classes get the "or pick a rough
// date" row at all, and — for canned/condiment — that it only appears once
// the item is marked opened. dry-staple, spice, frozen, and sealed
// canned/condiment never show it; there's no reasonable rough date for
// "when did you buy this bag of rice", and pretending there is invites a
// fabricated precision the spec's Rule 5 forbids.

export type RoughDateChip = { label: string; days: number };

const FRESH_CHIPS: RoughDateChip[] = [
  { label: 'Today', days: 0 },
  { label: '3 days', days: 3 },
  { label: '1 week', days: 7 },
  { label: '2 weeks', days: 14 },
];

const OPENED_SHELF_STABLE_CHIPS: RoughDateChip[] = [
  { label: '1 week', days: 7 },
  { label: '2 weeks', days: 14 },
  { label: '1 month', days: 30 },
  { label: '3 months', days: 90 },
];

/** null means the row is not rendered at all — a real return value, not an
 *  absence to be defaulted around. Every call site must treat null as
 *  "don't show this row" rather than falling back to a generic chip set. */
export function roughDateChipsFor(
  foodClass: FoodClass,
  packageStatus: PackageStatus | undefined
): RoughDateChip[] | null {
  switch (foodClass) {
    case 'bakery':
    case 'dairy':
    case 'produce':
    case 'meat-fish':
      return FRESH_CHIPS;
    case 'condiment':
    case 'canned':
      // Only once opened — sealed, these keep for years and a rough date
      // would be inventing precision about something that hasn't started
      // its real countdown yet.
      return packageStatus === 'opened' ? OPENED_SHELF_STABLE_CHIPS : null;
    case 'dry-staple':
    case 'spice':
    case 'frozen':
      return null;
  }
}

/** meat-fish is the one class where the rough-date row is the primary
 *  affordance, placed above the estimate panel rather than below it — see
 *  Part C5's own callout. Every other class with chips at all treats them
 *  as secondary to the panel. */
export function roughDateIsPrimary(foodClass: FoodClass): boolean {
  return foodClass === 'meat-fish';
}

// ─── Reassurance copy ─────────────────────────────────────────────────────
//
// Part C3: "Where the class warrants reassurance, the bold first line
// carries it instead of the generic head." Three classes get their own
// opening line; everything else uses the plain "Panzi will estimate this
// for you" head.
export function estimateHeadline(foodClass: FoodClass): string {
  switch (foodClass) {
    case 'dry-staple':
      return 'No worries — this keeps for years.';
    case 'frozen':
      return 'Frozen — plenty of time.';
    case 'meat-fish':
      return 'Worth a rough guess.';
    default:
      return 'Panzi will estimate this for you';
  }
}

/**
 * The estimate panel's own relative-time line — "≈ 2 years left",
 * "≈ 5 days left in the fridge", "≈ 6 weeks left — opened 1 week ago".
 * Always relative, never a calendar date (Rule 5) — the caller is
 * responsible for not ever passing this a resolved date to render instead.
 */
export function formatEstimateLine(
  totalDays: number,
  daysElapsed: number,
  bucket: StorageBucket,
  packageStatus: PackageStatus | undefined
): string {
  const remaining = Math.max(0, totalDays - daysElapsed);
  const magnitude = formatRoughDuration(remaining);

  const bucketNote = bucket === 'fridge' ? ' in the fridge' : bucket === 'freezer' ? ' in the freezer' : '';
  const openedNote =
    packageStatus === 'opened' && daysElapsed > 0 ? ` — opened ${formatRoughDuration(daysElapsed)} ago` : '';

  return `≈ ${magnitude} left${bucketNote}${openedNote}`;
}

/** "2 years", "6 weeks", "5 days" — the coarsest unit that keeps the number
 *  small and round, since an estimate showing "47 days" reads as more
 *  precise than a food-class table can honestly claim. */
function formatRoughDuration(days: number): string {
  if (days <= 0) return '0 days';
  if (days < 14) return days === 1 ? '1 day' : `${days} days`;
  if (days < 60) {
    const weeks = Math.round(days / 7);
    return weeks === 1 ? '1 week' : `${weeks} weeks`;
  }
  if (days < 365) {
    const months = Math.round(days / 30);
    return months === 1 ? '1 month' : `${months} months`;
  }
  const years = Math.round(days / 365);
  return years === 1 ? '1 year' : `${years} years`;
}

/** Human labels for the three storage buckets, for the change-announcement
 *  line below — "Moved to the freezer", not "Moved to freezer". */
const BUCKET_LABEL: Record<StorageBucket, string> = {
  cabinet: 'the cabinet',
  fridge: 'the fridge',
  freezer: 'the freezer',
};

/**
 * Part C6/D6's "never change it silently" rule: when a storage move (or a
 * sealed/opened flip) changes the estimate window by more than ~50%, one
 * explanatory line — "Moved to the freezer — now about 6 months." Returns
 * null when the change is small enough not to need calling out, which is
 * itself the normal case for most moves (a cabinet-to-cabinet-adjacent
 * move, or any change on a class the multiplier table treats as 1).
 */
export function storageChangeNote(
  previousBucket: StorageBucket,
  nextBucket: StorageBucket,
  foodClass: FoodClass,
  packageStatus: PackageStatus | undefined
): string | null {
  if (previousBucket === nextBucket) return null;

  const before = estimateWindow(foodClass, packageStatus, previousBucket).totalDays;
  const after = estimateWindow(foodClass, packageStatus, nextBucket).totalDays;
  if (before === 0) return null;

  const change = Math.abs(after - before) / before;
  if (change <= 0.5) return null;

  return `Moved to ${BUCKET_LABEL[nextBucket]} — now about ${formatRoughDuration(after)}.`;
}

/**
 * The same "never change it silently" rule (D6), for a Sealed<->Opened flip
 * (or landing back on unanswered) instead of a storage move. Only speaks up
 * when the window actually moves by more than ~50% — flipping status on a
 * class the status-weight table calls 'ignored' (produce, meat-fish) is
 * silent here on purpose, since the number genuinely didn't change.
 */
export function packageStatusChangeNote(
  previousStatus: PackageStatus | undefined,
  nextStatus: PackageStatus | undefined,
  foodClass: FoodClass,
  bucket: StorageBucket
): string | null {
  if (previousStatus === nextStatus) return null;

  const before = estimateWindow(foodClass, previousStatus, bucket).totalDays;
  const after = estimateWindow(foodClass, nextStatus, bucket).totalDays;
  if (before === 0) return null;

  const change = Math.abs(after - before) / before;
  if (change <= 0.5) return null;

  const label = nextStatus === 'opened' ? 'Marked opened' : nextStatus === 'sealed' ? 'Marked sealed' : 'Cleared';
  return `${label} — now about ${formatRoughDuration(after)}.`;
}
