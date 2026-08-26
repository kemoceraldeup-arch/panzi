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
export const STORAGE_LOCATIONS = ['Fridge', 'Freezer', 'Cupboard', 'Counter', 'Bread bin', 'Other'];

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
};

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
    location: raw.location ?? null,
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
  for (const key of ['dateSource', 'ripeness', 'ripenessSource', 'photoUri', 'scanPhoto', 'box'] as const) {
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
