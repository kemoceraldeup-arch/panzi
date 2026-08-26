// src/services/scans.ts
//
// Scan history: one document per scan the user actually added.
//
// This collection exists to keep a promise the review page makes out loud —
// "You can fix the two later from history". Without somewhere to put an
// unfinished scan, that line is a lie, and the whole reason the user is allowed
// to add items before every field is settled disappears with it.
//
// A record is written when a batch lands and updated in place when the user
// reopens it to finish the missing dates. It holds the candidates as they stood
// at save time, not the pantry rows they became: the point of reopening a scan
// is to see the photo and the reads together again.

import { apiFetch } from '../config/api';
import { newId } from '../utils/ids';
import { readKey, refreshKey, subscribeToKey } from './live';
import { ScanCandidate, needsALook } from './scan';
import {
  ItemBox,
  ItemPhoto,
  PantryItem,
  refreshPantry,
  setItemsScanPhoto,
  updatePantryItem,
} from './pantry';
import { isRemote, uploadItemPhoto, uploadScanPhoto } from './photos';
import { ScanAccuracy, emptyAccuracy, mergeAccuracy, scanAccuracy } from './accuracy';

// History is a place to finish recent work, not an archive. Past this many the
// oldest scans are simply not fetched — their pantry items are unaffected, and
// nobody scrolls three weeks back to correct a banana.
const HISTORY_LIMIT = 30;

export type ScanRecord = {
  id: string;
  /** Two or three words from the model: "Counter and fridge". */
  sceneLabel: string;
  /** Local file URI of the capture. Does not survive a reinstall — the
   *  thumbnail falls back to a placeholder tile when the file has gone. */
  photoUri: string | null;
  /**
   * Pixel size of that capture.
   *
   * Stored because cropping an item out of the photo needs the aspect ratio,
   * and without it every card in a reopened scan fell back to a blank tile —
   * the header thumbnail worked, since it only needs the URI, which made the
   * gap look like a bug in the crop rather than missing data.
   */
  photoWidth: number | null;
  photoHeight: number | null;
  createdAt: number | null;
  /**
   * The read exactly as it arrived, before the user touched anything.
   *
   * Kept beside the corrected list so the two can be diffed into an accuracy
   * measurement (services/accuracy.ts). Without it the scan record only ever
   * holds the answer after correction, and there is no way to know afterwards
   * whether the scanner got it right or the user quietly fixed it.
   *
   * Empty on scans written before this existed, and on hand-typed entries.
   */
  original: ScanCandidate[];
  candidates: ScanCandidate[];
  /** Pantry ids this scan wrote, in candidate order. Also what Undo deletes. */
  addedItemIds: string[];
  /** How many candidates still have something unresolved. Denormalised so the
   *  history list can render "3 of 6 still need a date" without walking every
   *  candidate of every scan. */
  unresolvedCount: number;
  /** Per-field verdicts for this scan, computed at write time. Denormalised for
   *  the same reason as the count above — rolling up accuracy across scans
   *  shouldn't mean re-diffing every candidate list. */
  accuracy: ScanAccuracy;
};

export function countUnresolved(candidates: ScanCandidate[]): number {
  return candidates.filter(needsALook).length;
}

/** The key every scan read and write shares. Not scoped by uid — the token
 *  attached inside apiFetch decides whose history comes back. */
const KEY = 'scans';

/** The server already sorts newest-first, but a record repaired on read can
 *  carry a different createdAt than the one that was sorted on, so the order is
 *  settled here too. Cheap on a list capped at HISTORY_LIMIT. */
function byNewest(records: ScanRecord[]): ScanRecord[] {
  return [...records].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

function fromRow(id: string, data: any): ScanRecord {
  const stored: ScanCandidate[] = Array.isArray(data.candidates) ? data.candidates : [];
  const addedItemIds: string[] = Array.isArray(data.addedItemIds) ? data.addedItemIds : [];

  // A candidate whose pantryItemId is missing looks, to the reopen path, like a
  // row that was never saved — and would be inserted a second time. Records
  // written by the current code always carry it; this repairs anything that
  // doesn't by falling back to the positional list the write also stored.
  const candidates = stored.map((c, i) => ({
    ...c,
    pantryItemId: c.pantryItemId ?? addedItemIds[i] ?? null,
  }));

  const original: ScanCandidate[] = Array.isArray(data.original) ? data.original : [];

  return {
    id,
    sceneLabel: data.sceneLabel || 'Scan',
    photoUri: data.photoUri ?? null,
    photoWidth: data.photoWidth ?? null,
    photoHeight: data.photoHeight ?? null,
    createdAt: typeof data.createdAt === 'number' ? data.createdAt : null,
    original,
    candidates,
    addedItemIds,
    unresolvedCount:
      typeof data.unresolvedCount === 'number'
        ? data.unresolvedCount
        : countUnresolved(candidates),
    // Recomputed rather than defaulted when absent, so scans written before the
    // stored summary existed still contribute — as long as they have an
    // `original` to diff against. Ones that don't score as an empty record
    // rather than a perfect one.
    accuracy: data.accuracy ?? (original.length ? scanAccuracy(original, candidates) : emptyAccuracy()),
  };
}

async function fetchScanRecords(): Promise<ScanRecord[]> {
  const { scans } = await apiFetch<{ scans: any[] }>('/api/scans');
  return byNewest(scans.map((row) => fromRow(row.id, row)));
}

export function subscribeToScans(
  uid: string,
  callback: (scans: ScanRecord[]) => void,
  onError: (err: Error) => void
) {
  return subscribeToKey(KEY, fetchScanRecords, callback, onError);
}

export async function fetchScans(uid: string): Promise<ScanRecord[]> {
  // Routed through readKey so a one-shot read also seeds the cache any screen
  // subscribing a moment later will render from.
  return readKey(KEY, fetchScanRecords);
}

/**
 * Records a scan that has just landed in the pantry.
 *
 * The id is generated by the caller before the write so the modal can hold onto
 * it and update the same document when the user comes back to finish the
 * unresolved rows — and so a failed write leaves a known id rather than an
 * orphan.
 */
export function newScanId(): string {
  return newId();
}

export async function saveScan(
  uid: string,
  scanId: string,
  scan: {
    sceneLabel: string;
    photoUri: string | null;
    photoWidth: number | null;
    photoHeight: number | null;
    /** The read as it arrived. Empty for hand-typed entries. */
    original: ScanCandidate[];
    candidates: ScanCandidate[];
    addedItemIds: string[];
  }
) {
  await apiFetch('/api/scans/save', {
    id: scanId,
    sceneLabel: scan.sceneLabel,
    photoUri: scan.photoUri,
    photoWidth: scan.photoWidth,
    photoHeight: scan.photoHeight,
    // Sent as plain objects — ScanCandidate is already JSON-shaped, and the
    // scan document stores the arrays as they arrive.
    original: scan.original,
    candidates: scan.candidates,
    addedItemIds: scan.addedItemIds,
    // Both computed here rather than on the server. They are diffs of the
    // model's original read against the user's corrections, and the rules for
    // that live in services/accuracy.ts; a second implementation on the server
    // would be a second answer to how accurate the scanner is.
    unresolvedCount: countUnresolved(scan.candidates),
    accuracy: scanAccuracy(scan.original, scan.candidates),
  });
  refreshKey(KEY);
}

/**
 * Writes back the corrections made after the scan was added.
 *
 * Deliberately does not touch `createdAt`: finishing off Tuesday's freezer scan
 * on Friday shouldn't shuffle it to the top of the list as though it were new
 * work. The user is looking for it where they left it.
 */
export async function updateScanCandidates(
  scanId: string,
  candidates: ScanCandidate[],
  original: ScanCandidate[]
) {
  await apiFetch('/api/scans/update', {
    id: scanId,
    candidates,
    unresolvedCount: countUnresolved(candidates),
    // Recomputed, because finishing a scan from history is where the most
    // valuable corrections happen: those are the rows the scanner got wrong and
    // the user came back specifically to fix.
    accuracy: scanAccuracy(original, candidates),
  });
  refreshKey(KEY);
}

/**
 * How often the scanner has been right, across every scan on record.
 *
 * The figure a product claim would rest on. Read the rules in
 * services/accuracy.ts before quoting it anywhere: it counts only rows a person
 * actually checked, so it is smaller and slower-moving than a naive
 * "corrections / total" would be — and unlike that number, it survives someone
 * asking how it was measured.
 */
export function overallAccuracy(scans: ScanRecord[]): ScanAccuracy {
  return mergeAccuracy(scans.map((s) => s.accuracy));
}

/**
 * Gives already-saved pantry items the pictures their scans have been holding.
 *
 * The crop was always recoverable — every scan record stores the capture, its
 * dimensions, and each candidate's box and pantryItemId — but until the pantry
 * item carried those fields itself, the list had nowhere to read them from.
 * Without this, turning pictures on would show them only on food scanned from
 * now on, and a pantry of blank tiles beside a handful of photographed rows
 * reads as a broken feature rather than a new one.
 *
 * Writes nothing to an item that already has a picture, so it is safe to run
 * more than once and can never overwrite a photo the user attached by hand.
 * Returns how many items it filled in.
 */
export async function backfillItemPhotos(
  uid: string,
  items: PantryItem[]
): Promise<number> {
  const missing = new Set(
    items.filter((i) => !i.photoUri && !i.scanPhoto).map((i) => i.id)
  );
  if (missing.size === 0) return 0;

  const scans = await fetchScans(uid);
  const patches = new Map<string, { scanPhoto: ItemPhoto | null; box: ItemBox | null; photoUri: string | null }>();

  for (const scan of scans) {
    // Zeroes are what scans written before the dimensions were stored have, and
    // a capture without them can't be cropped — those rows stay blank rather
    // than getting a field that renders as a divide by zero.
    const usable =
      scan.photoUri && scan.photoWidth && scan.photoHeight
        ? { uri: scan.photoUri, width: scan.photoWidth, height: scan.photoHeight }
        : null;

    for (const candidate of scan.candidates) {
      const id = candidate.pantryItemId;
      if (!id || !missing.has(id) || patches.has(id)) continue;
      const own = candidate.photoUri ?? null;
      const crop = usable && candidate.box ? usable : null;
      if (!own && !crop) continue;
      patches.set(id, { scanPhoto: crop, box: crop ? candidate.box : null, photoUri: own });
    }
  }

  if (patches.size === 0) return 0;

  await apiFetch('/api/pantry/patch-many', {
    patches: [...patches].map(([id, fields]) => ({ id, fields })),
  });
  refreshPantry();

  // Everything written above may still be a local file path, which is worth
  // nothing to the other device on the account. Uploading is what turns this
  // from "my old pantry has pictures again on this phone" into "my old pantry
  // has pictures". Not awaited, and per-scan failures are contained inside
  // publishScanPhotos — on a device that never held these files, every upload
  // fails and the rows simply keep whatever the first device published.
  for (const scan of scans) {
    const rows = scan.candidates
      .filter((c) => c.pantryItemId && patches.has(c.pantryItemId))
      .map((c) => ({ itemId: c.pantryItemId as string, ownPhotoUri: c.photoUri }));
    if (rows.length === 0) continue;
    const capture =
      scan.photoUri && scan.photoWidth && scan.photoHeight
        ? { uri: scan.photoUri, width: scan.photoWidth, height: scan.photoHeight }
        : null;
    void publishScanPhotos(uid, scan.id, capture, rows);
  }

  return patches.size;
}

/** Repoints a scan record at the uploaded copy of its capture, so reopening it
 *  from another device shows the photo rather than a placeholder. */
export async function setScanPhoto(scanId: string, photo: ItemPhoto) {
  await apiFetch('/api/scans/photo', { id: scanId, photo });
  refreshKey(KEY);
}

/**
 * Moves a finished scan's pictures into Storage and repoints everything at them.
 *
 * Called after the scan is already saved and the modal is already closed, and
 * awaited by nothing: the device that did the scanning is showing the local
 * files and does not need this to finish. What it buys is the second device on
 * the account, which has no local files at all and can only ever see a picture
 * that lives somewhere both phones can reach.
 *
 * Each upload is caught on its own. One item whose file has been evicted should
 * not cost the other eleven their pictures.
 */
export async function publishScanPhotos(
  uid: string,
  scanId: string,
  capture: ItemPhoto | null,
  rows: { itemId: string; ownPhotoUri: string | null }[]
): Promise<void> {
  if (capture && !isRemote(capture.uri)) {
    try {
      const remote = await uploadScanPhoto(uid, scanId, capture);
      // Only the rows that actually crop out of this capture. A hand-added row
      // in the same batch has its own picture and no box to crop with.
      const cropped = rows.filter((r) => !r.ownPhotoUri).map((r) => r.itemId);
      await setItemsScanPhoto(cropped, remote);
      await setScanPhoto(scanId, remote);
    } catch {
      // The local copy stays in place and keeps working on this device.
    }
  }

  for (const row of rows) {
    if (!row.ownPhotoUri || isRemote(row.ownPhotoUri)) continue;
    try {
      const url = await uploadItemPhoto(uid, row.itemId, { uri: row.ownPhotoUri });
      await updatePantryItem(row.itemId, { photoUri: url });
    } catch {
      // Same again — a picture that fails to upload is still on this phone.
    }
  }
}
