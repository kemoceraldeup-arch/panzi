// src/services/pantry.ts
//
// The shelves. Every read and write goes through the API now rather than
// straight to Firestore — same function names, same shapes, same call sites.
//
// The defensive readers below survived the move unchanged, and are worth more
// than they were. Data arriving over HTTP has been through JSON in both
// directions and a database that does not enforce our types on old documents,
// so a field being the wrong shape is still a thing that happens rather than a
// thing we hope about.

import { apiFetch } from '../config/api';
import { newId } from '../utils/ids';
import { refreshKey, subscribeToKey } from './live';
import { RipenessStage, isRipenessStage } from '../utils/ripeness';

/**
 * Where an item's expiry date came from.
 *
 * Declared here rather than in services/scan.ts, even though the scanner is
 * what produces it, because a pantry item outlives the scan that created it and
 * services/scan.ts already imports from this file — the other direction would
 * be a cycle.
 */
export type DateSource = 'label' | 'estimated' | 'user';

const DATE_SOURCES: DateSource[] = ['label', 'estimated', 'user'];

/**
 * Phase 2's own provenance axis, alongside DateSource rather than replacing
 * it — DateSource still drives every existing chip (provenanceChip and its
 * callers), and changing its meaning out from under them would be a silent
 * breaking change. `basis` is the finer-grained answer Phase 2 actually
 * needs: 'rough' and 'manual' both used to collapse into DateSource's
 * 'user', but a rough-date-chip pick ("~Mar 14") and a typed real date read
 * very differently once an estimate can also render a precise date — only
 * `basis` tells them apart.
 *
 *   printed   — read off the packaging by the scanner. Fact.
 *   manual    — typed by the user. Fact, by the user's own hand.
 *   rough     — a rough-date chip pick ("3 days ago" -> a resolved date).
 *               Still a real stored date, always shown with a tilde so it
 *               never reads as printed or typed.
 *   estimated — Panzi's own use-by estimate. No stored date at all — see
 *               estimatedUseBy below, computed fresh on every read.
 */
export type DateBasis = 'printed' | 'manual' | 'rough' | 'estimated';

const DATE_BASES: DateBasis[] = ['printed', 'manual', 'rough', 'estimated'];

function readDateBasis(raw: unknown): DateBasis | null {
  return DATE_BASES.includes(raw as DateBasis) ? (raw as DateBasis) : null;
}

// Read back defensively: these fields are absent on every item written before
// the item scanner shipped, and a stray string from a hand-edited document
// would otherwise flow straight into a chip that claims the date was printed.
function readDateSource(raw: unknown): DateSource | null {
  return DATE_SOURCES.includes(raw as DateSource) ? (raw as DateSource) : null;
}

// Same defensiveness for the picture fields, and one extra reason: a capture
// stored without its dimensions (or with zeroes, which is what scans written
// before they were recorded have) can't be cropped without dividing by zero.
// Rejecting it here means the row falls back to a plain tile instead.
function readPhoto(raw: any): ItemPhoto | null {
  if (!raw || typeof raw.uri !== 'string') return null;
  if (typeof raw.width !== 'number' || typeof raw.height !== 'number') return null;
  if (raw.width <= 0 || raw.height <= 0) return null;
  return { uri: raw.uri, width: raw.width, height: raw.height };
}

function readBox(raw: any): ItemBox | null {
  if (!raw) return null;
  const parts = [raw.x, raw.y, raw.width, raw.height];
  if (parts.some((n) => typeof n !== 'number')) return null;
  return { x: raw.x, y: raw.y, width: raw.width, height: raw.height };
}

function readEstimateInputs(raw: any): EstimateInputs | null {
  if (!raw || typeof raw.foodClass !== 'string' || typeof raw.storedIn !== 'string') return null;
  if (typeof raw.from !== 'string' || typeof raw.days !== 'number') return null;
  return {
    foodClass: raw.foodClass,
    storedIn: raw.storedIn,
    packageStatus: raw.packageStatus === 'sealed' || raw.packageStatus === 'opened' ? raw.packageStatus : undefined,
    from: raw.from,
    days: raw.days,
    confidence: raw.confidence === 'low' || raw.confidence === 'high' ? raw.confidence : 'medium',
  };
}

function readNutrition(raw: any): Nutrition | null {
  if (!raw || typeof raw.foodId !== 'string' || typeof raw.matchedName !== 'string') return null;
  const grams = [raw.calories, raw.proteinG, raw.carbsG, raw.fatG];
  if (grams.some((n) => typeof n !== 'number')) return null;
  return {
    foodId: raw.foodId,
    matchedName: raw.matchedName,
    servingDescription: typeof raw.servingDescription === 'string' ? raw.servingDescription : null,
    calories: raw.calories,
    proteinG: raw.proteinG,
    carbsG: raw.carbsG,
    fatG: raw.fatG,
  };
}

// What kind of food it is — drives the grouped sections on the List screen.
export const FOOD_CATEGORIES = [
  'Fruit & veg',
  'Dairy & eggs',
  'Meat & fish',
  'Bakery',
  'Grains & pasta',
  'Tins & jars',
  'Frozen',
  'Herbs & spices',
  'Drinks',
  'Snacks',
];

// Where it physically lives — what the swipe "Move" action changes. This is a
// separate axis from category: yoghurt is Dairy & eggs, kept in the Fridge.
export const STORAGE_LOCATIONS = ['Fridge', 'Freezer', 'Cabinet', 'Kitchen Shelf', 'Bread Shelf', 'Other'];

// Old wording, kept only so an item saved before this rename still resolves
// to its new name instead of showing as an unrecognised location. Every read
// of a stored location string goes through normaliseLocation() below, so a
// document written with the old word never needs a migration pass of its
// own — it just displays correctly the next time it's read.
const RENAMED_LOCATIONS: Record<string, string> = {
  Counter: 'Kitchen Shelf',
  Cupboard: 'Cabinet',
  'Bread bin': 'Bread Shelf',
};

/** Maps a possibly-old location string to its current name. Anything not in
 *  RENAMED_LOCATIONS (including already-current names, 'Other', and null)
 *  passes through unchanged. */
export function normaliseLocation<T extends string | null>(location: T): T {
  if (location === null) return location;
  return (RENAMED_LOCATIONS[location] ?? location) as T;
}

/**
 * Where an item sits inside a capture, as fractions of each axis.
 *
 * Declared here for the same reason DateSource is: the rectangle outlives the
 * scan that produced it, because it is what crops the item's picture on every
 * pantry row from then on. services/scan.ts re-exports it as ScanBox.
 */
export type ItemBox = { x: number; y: number; width: number; height: number };

/**
 * A capture an item can be cropped out of. Pixel dimensions are part of it —
 * the box is in fractions of each axis separately, so cropping without
 * distorting needs to know the real aspect ratio.
 *
 * The URI is a local file path. It does not survive a reinstall and is not
 * shared between devices; a row whose file has gone falls back to a plain tile,
 * exactly as a scan reopened from history does.
 */
export type ItemPhoto = { uri: string; width: number; height: number };

/**
 * Per-serving macros, matched from FatSecret's food database at scan time.
 * `matchedName` and `foodId` are kept alongside the numbers so the review
 * card and edit sheet can show what was actually matched — a user unsure
 * whether "cheddar" matched the right cheddar needs to see the matched
 * product's name, not just trust the numbers. Optional/absent (not present
 * on the item at all) rather than null: an item added before this feature
 * existed, or one FatSecret has nothing for, has no macros to show and no
 * claim being made about them either way.
 */
export type Nutrition = {
  foodId: string;
  matchedName: string;
  servingDescription: string | null;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
};

/**
 * What produced an estimated use-by date — needed for the panel's
 * attribution line and to recompute the date without re-deriving foodClass
 * from a category that may since have changed. Set only alongside
 * `estimatedUseBy`; both are cleared together the moment the user promotes
 * an estimate to a real date (basis becomes 'manual').
 */
export type EstimateInputs = {
  foodClass: string;
  storedIn: 'cabinet' | 'pantry' | 'fridge' | 'freezer';
  packageStatus?: 'sealed' | 'opened';
  /** openedAt ?? addedAt — the date the window was counted from. */
  from: string;
  /** The shelf-life window applied, in days. */
  days: number;
  confidence: 'low' | 'medium' | 'high';
};

export type PantryItem = {
  id: string;
  name: string;
  quantity: string;
  category: string;
  location: string | null; // null on items added before locations existed
  expiryDate: string | null; // 'YYYY-MM-DD', or null if unknown
  addedAt: number | null; // ms epoch; null on anything written without one

  // What the row shows a picture of. Two routes to one, because the scanner has
  // two: an item detected in a shelf photo is a crop of that photo (scanPhoto +
  // box), while a hand-added item has a picture of its own (photoUri). All null
  // on anything added before pictures were carried through, and on rows typed in
  // without one — ItemThumb draws a plain tile for those.
  photoUri: string | null;
  scanPhoto: ItemPhoto | null;
  box: ItemBox | null;

  // Where the date came from, kept for the life of the item rather than the
  // life of the scan. The scanner is allowed to estimate a date for loose fruit
  // that has none printed on it, and the deal that makes that acceptable is
  // that an estimate stays visibly an estimate forever. Drop this field and a
  // guess becomes a fact overnight.
  //
  // All three are null on everything added before the item scanner existed, and
  // on anything typed in by hand without a date.
  dateSource: DateSource | null;
  ripeness: RipenessStage | null;
  ripenessSource: 'estimated' | 'user' | null;

  // null on anything added before this feature existed, on a hand-typed item
  // nobody looked up, or on a name FatSecret had no match for.
  nutrition: Nutrition | null;

  // The item-review card's PACKAGE STATUS control (sealed/opened/unanswered)
  // and EXPIRATION block's own "I don't know" radio — both undefined/false
  // on anything saved before this feature existed, which the estimate reads
  // the same way it reads a genuinely unanswered item: estimate as sealed,
  // say so.
  packageStatus?: 'sealed' | 'opened';
  openedAt?: string | null;
  expiryUnknown?: boolean;

  // Phase 2 — the Panzi use-by estimate, for food with no printed date at
  // all. `basis` and `expiryDate` are never both meaningful for the same
  // fact: a 'printed'/'manual'/'rough' item has a real expiryDate and no
  // estimatedUseBy; an 'estimated' item has estimatedUseBy (or nothing yet,
  // computed live) and expiryDate stays null. Absent entirely on anything
  // saved before this feature existed — effectiveDate/isEstimate below
  // treat that the same as basis:'estimated' with stale/no inputs, which is
  // the same "estimate as sealed, say so" conservative fallback Phase 1
  // already established for an unanswered packageStatus.
  basis?: DateBasis;
  estimatedUseBy?: string | null;
  estimateInputs?: EstimateInputs | null;
};

/**
 * The one accessor every list/sort/notification consumer reads a date
 * through — Phase 2's own rule that no caller picks `expiryDate` over
 * `estimatedUseBy` (or vice versa) by hand. `expiryDate` covers 'printed',
 * 'manual' and 'rough' alike, since all three are real stored dates; only
 * 'estimated' items have no `expiryDate` at all and fall through to
 * `estimatedUseBy`. Both are unlikely to be set on the same item (see
 * PantryItem's own doc comment), but the ?? handles it defensively either
 * way rather than trusting every writer to have upheld that.
 */
export function effectiveDate(item: {
  expiryDate: string | null;
  estimatedUseBy?: string | null;
}): string | null {
  return item.expiryDate ?? item.estimatedUseBy ?? null;
}

/**
 * True for anything that isn't a fact — a Panzi estimate, or a rough-date
 * chip pick standing in for one. Every consumer must call this before
 * choosing a label (Part 2/6's own rule): the two must never share a label,
 * an icon, or a row style, and this is the one place that decides which
 * side of that line an item falls on.
 */
export function isEstimate(item: { basis?: DateBasis }): boolean {
  return item.basis === 'estimated' || item.basis === 'rough';
}

/**
 * A pantry `quantity` string ("250 g", "1 pack", "2") split into the leading
 * number and whatever unit word follows it. `value` is null when the string
 * has no leading number at all ("a bit", "") — nothing safe to sort or
 * compare numerically, so callers fall back to treating it as unknown rather
 * than as zero.
 */
export type ParsedQuantity = { value: number | null; unit: string };

/** Matches parseAmount in src/services/recipes.ts, applied to the pantry's own
 *  free-text quantity field instead of a recipe's ingredient amount. */
export function parseQuantity(quantity: string): ParsedQuantity {
  const match = quantity.trim().match(/^(\d+(?:\.\d+)?)\s*(.*)$/);
  if (!match) return { value: null, unit: '' };
  return { value: Number(match[1]), unit: match[2].trim().toLowerCase() };
}

/**
 * The key every pantry read and write shares.
 *
 * Not scoped by uid, and that is deliberate rather than an oversight: the
 * request is authenticated by the token attached inside apiFetch, so a fetch
 * always returns the signed-in account's shelves whatever this string says.
 * One account is signed in at a time, and signing out unmounts every screen
 * watching this key, which tears the entry down with its cached value.
 */
const KEY = 'pantry';

/**
 * Tells every screen watching the shelves to refetch.
 *
 * Exported because the scan backfill writes pantry rows through a bulk endpoint
 * of its own rather than through the functions below, and a write that skips
 * this one leaves the list showing yesterday's version of itself.
 */
export function refreshPantry(): void {
  refreshKey(KEY);
}

function toItem(raw: any): PantryItem {
  return {
    id: raw.id,
    name: raw.name,
    quantity: raw.quantity,
    category: raw.category,
    location: normaliseLocation(raw.location ?? null),
    expiryDate: raw.expiryDate ?? null,
    addedAt: typeof raw.addedAt === 'number' ? raw.addedAt : null,
    photoUri: typeof raw.photoUri === 'string' ? raw.photoUri : null,
    scanPhoto: readPhoto(raw.scanPhoto),
    box: readBox(raw.box),
    dateSource: readDateSource(raw.dateSource),
    ripeness: isRipenessStage(raw.ripeness) ? raw.ripeness : null,
    ripenessSource:
      raw.ripenessSource === 'estimated' || raw.ripenessSource === 'user'
        ? raw.ripenessSource
        : null,
    nutrition: readNutrition(raw.nutrition),
    // These three were missing here entirely until Phase 2 — present on the
    // type and written by the server since PACKAGE STATUS shipped, but
    // silently dropped on every fetch because this reader stopped short of
    // them. Fixed as part of the same pass that adds basis/estimatedUseBy,
    // since an item's package status has to survive a reload for the
    // estimate to recompute correctly on the pantry list, not just on the
    // review card that first set it.
    packageStatus: raw.packageStatus === 'sealed' || raw.packageStatus === 'opened' ? raw.packageStatus : undefined,
    openedAt: typeof raw.openedAt === 'string' ? raw.openedAt : null,
    expiryUnknown: raw.expiryUnknown === true,
    basis: readDateBasis(raw.basis) ?? undefined,
    estimatedUseBy: typeof raw.estimatedUseBy === 'string' ? raw.estimatedUseBy : null,
    estimateInputs: readEstimateInputs(raw.estimateInputs),
  };
}

async function fetchPantryItems(): Promise<PantryItem[]> {
  const { items } = await apiFetch<{ items: any[] }>('/api/pantry');
  // The server sorts soonest-expiring first with undated rows last. Mapping
  // preserves that order; nothing here re-sorts.
  return items.map(toItem);
}

/**
 * Live view of the shelves. Same signature and same unsubscribe contract as the
 * Firestore listener it replaced, which is why no screen changed.
 */
export function subscribeToPantryItems(
  uid: string,
  callback: (items: PantryItem[]) => void,
  onError: (err: Error) => void
) {
  return subscribeToKey(KEY, fetchPantryItems, callback, onError);
}

export async function addPantryItem(
  uid: string,
  item: {
    name: string;
    quantity: string;
    category: string;
    location: string;
    expiryDate: string | null;
  }
) {
  await apiFetch('/api/pantry/add', { items: [{ id: newId(), ...item }] });
  refreshKey(KEY);
}

export type NewPantryItem = {
  name: string;
  quantity: string;
  category: string;
  location: string;
  expiryDate: string | null;
  // Optional so the hand-typed path and the older callers don't have to invent
  // a provenance they don't have. Absent means "no claim about where the date
  // came from", which reads as an unlabelled date rather than a printed one.
  dateSource?: DateSource | null;
  ripeness?: RipenessStage | null;
  ripenessSource?: 'estimated' | 'user' | null;
  photoUri?: string | null;
  scanPhoto?: ItemPhoto | null;
  box?: ItemBox | null;
  nutrition?: Nutrition | null;
  packageStatus?: 'sealed' | 'opened';
  openedAt?: string | null;
  expiryUnknown?: boolean;
  basis?: DateBasis;
  estimatedUseBy?: string | null;
  estimateInputs?: EstimateInputs | null;
};

/**
 * Writes a whole approved scan in one request, and hands back the new ids.
 *
 * One call rather than a loop so a scan can't half-land — a partial batch would
 * leave the user's pantry in a state they never approved, with no obvious way
 * to tell which rows made it. The returned ids are what the "N items added ·
 * Undo" toast deletes if the user takes it back.
 *
 * The ids are generated here, before the request, which is what lets Undo be
 * wired up immediately rather than after the round trip.
 */
export async function addPantryItems(
  uid: string,
  items: NewPantryItem[]
): Promise<string[]> {
  const payload = items.map((item) => ({
    id: newId(),
    ...item,
    // Normalised so one missing optional field can't be read as an intentional
    // value on the other side. The server does the same, and both matter: this
    // one keeps `undefined` out of the JSON, where it would vanish silently.
    dateSource: item.dateSource ?? null,
    ripeness: item.ripeness ?? null,
    ripenessSource: item.ripenessSource ?? null,
    photoUri: item.photoUri ?? null,
    scanPhoto: item.scanPhoto ?? null,
    box: item.box ?? null,
    packageStatus: item.packageStatus ?? null,
    openedAt: item.openedAt ?? null,
    expiryUnknown: item.expiryUnknown ?? false,
    basis: item.basis ?? null,
    estimatedUseBy: item.estimatedUseBy ?? null,
    estimateInputs: item.estimateInputs ?? null,
  }));

  const { ids } = await apiFetch<{ ids: string[] }>('/api/pantry/add', { items: payload });
  refreshKey(KEY);
  return ids;
}

export async function deletePantryItem(itemId: string) {
  await apiFetch('/api/pantry/delete', { ids: [itemId] });
  refreshKey(KEY);
}

/** Undo for a scan batch — one request, same reasoning as the write. */
export async function deletePantryItems(itemIds: string[]) {
  if (itemIds.length === 0) return;
  await apiFetch('/api/pantry/delete', { ids: itemIds });
  refreshKey(KEY);
}

/** "Your data" > Clear pantry — every item on the shelves, gone in one request
 *  rather than the caller having to list ids it would first have to fetch. */
export async function clearPantry(): Promise<void> {
  await apiFetch('/api/pantry/clear', {});
  refreshKey(KEY);
}

/**
 * Writes corrections back onto an item that is already on the shelves.
 *
 * What "fix it later from history" actually costs. Reopening a scan and filling
 * in a missing date has to change the pantry item, not just the scan record —
 * otherwise the promise the review page makes is kept in a place the user never
 * looks, and the item they came back to fix still nags them with no date.
 */
export async function updatePantryItem(itemId: string, fields: Partial<NewPantryItem>) {
  // Only the keys actually being changed are sent. The three provenance fields
  // used to be forced into every update, which meant a partial edit — renaming
  // an item from the pantry, say — silently erased where its date came from and
  // how ripe it was. `undefined` disappears in JSON, so they are normalised to
  // null when present and left out entirely when absent.
  const patch: Record<string, unknown> = { ...fields };
  for (const key of [
    'dateSource',
    'ripeness',
    'ripenessSource',
    'photoUri',
    'scanPhoto',
    'box',
    'packageStatus',
    'openedAt',
    'expiryUnknown',
    'basis',
    'estimatedUseBy',
    'estimateInputs',
  ] as const) {
    if (key in fields) patch[key] = fields[key] ?? null;
  }
  await apiFetch('/api/pantry/update', { id: itemId, fields: patch });
  refreshKey(KEY);
}

/**
 * Points a whole scan's worth of items at the uploaded capture.
 *
 * One request, because every row of a scan crops out of the same photo and they
 * should all start showing the shared copy on the same frame — a list that
 * swapped over row by row as individual writes landed would flicker.
 */
export async function setItemsScanPhoto(itemIds: string[], scanPhoto: ItemPhoto) {
  if (itemIds.length === 0) return;
  await apiFetch('/api/pantry/scan-photo', { ids: itemIds, scanPhoto });
  refreshKey(KEY);
}

export async function movePantryItem(itemId: string, location: string) {
  await apiFetch('/api/pantry/move', { id: itemId, location });
  refreshKey(KEY);
}
