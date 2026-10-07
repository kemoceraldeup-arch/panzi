// src/services/recognition.ts
//
// The client half of the scanner's recognition step: take the captured photo,
// shrink it to something worth sending, and post it to the API. The model call
// itself lives in server/src/routes/scan.ts because the OpenAI key can't
// ship inside the app bundle.
//
// This file is also where the model's two date answers become one date on a
// candidate. The server keeps them rigidly apart — `expiryDate` is only ever
// printed on the pack, `shelfLifeDays` is only ever a guess from appearance —
// and `toCandidate` below is the single place they are merged, so there is
// exactly one line of code that can get provenance wrong.

import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { apiFetch, ApiError } from '../config/api';
import { ScanBox, ScanCandidate } from './scan';
import { RipenessStage, isRipenessStage } from '../utils/ripeness';
import { dateInDays } from '../utils/freshness';
import { normaliseLocation } from './pantry';
import { classifyMeasure } from './quantity';

export type { ScanBox };

// The model's own ceiling: 2576px on the long edge. Anything larger is
// downscaled server-side anyway, so sending more only buys upload time.
const MAX_EDGE = 2576;

// JPEG quality for the upload. Below about 0.7 the compression artefacts start
// eating small print, which is exactly the text a scan depends on — and they
// flatten the skin tones a ripeness judgement reads.
const COMPRESSION = 0.7;

export type ScanFailureCause = 'dark' | 'blurry' | 'far' | 'unrecognised';

export type RecognitionResult =
  | {
      readable: true;
      /** Two or three words for where the photo was taken, for scan history. */
      sceneLabel: string;
      candidates: ScanCandidate[];
      boxes: Record<string, ScanBox>;
    }
  | { readable: false; cause: ScanFailureCause };

type RemoteItem = {
  name: string;
  nameUnsure: boolean;
  nameUnsureReason: string;
  nameAlternatives: string[];
  count: number;
  sizeValue: number;
  sizeUnit: string;
  measuredByWeight: boolean;
  /** Optional so a server from before this field still parses — missing
   *  reads as a full pack. */
  fillLevel?: number;
  fillNote?: string;
  category: string;
  location: string;
  expiryDate: string;
  looseProduce: boolean;
  ripeness: RipenessStage | 'none';
  ripenessNotes: string[];
  ripenessBlocked: string;
  shelfLifeDays: number;
  box: ScanBox;
};

type RemoteResult = {
  readable: boolean;
  failureCause: ScanFailureCause | 'none';
  sceneLabel: string;
  items: RemoteItem[];
};

/** Raised for anything the user can act on; the caller shows the message. */
export class RecognitionError extends Error {}

async function prepareImage(photo: { uri: string; width: number; height: number }) {
  // Resize by whichever edge is longer, so a portrait shot isn't left three
  // times taller than the cap while its width sits exactly on it.
  const longEdge = Math.max(photo.width, photo.height);
  const context = ImageManipulator.manipulate(photo.uri);

  if (longEdge > MAX_EDGE) {
    const scale = MAX_EDGE / longEdge;
    context.resize({
      width: Math.round(photo.width * scale),
      height: Math.round(photo.height * scale),
    });
  }

  const image = await context.renderAsync();
  const saved = await image.saveAsync({
    format: SaveFormat.JPEG,
    compress: COMPRESSION,
    base64: true,
  });

  if (!saved.base64) throw new RecognitionError('Could not read that photo — try again.');
  return saved.base64;
}

// oz/lb are read off a label often enough to be worth converting rather than
// dropping — approximate is fine here, this only seeds the stepper's
// starting amount, and the user is looking straight at the packet.
// The server canonicalises units, but a sack printed "25 KGS" that slipped
// through unconverted would otherwise fall to the last line below and be
// stored as 25 g — so the common label spellings are accepted here too.
const TO_GRAMS: Record<string, number> = {
  g: 1,
  gm: 1,
  gms: 1,
  gram: 1,
  grams: 1,
  kg: 1000,
  kgs: 1000,
  kilo: 1000,
  kilos: 1000,
  kilogram: 1000,
  kilograms: 1000,
  oz: 28.35,
  lb: 453.6,
  lbs: 453.6,
};
const TO_ML: Record<string, number> = { ml: 1, l: 1000, ltr: 1000, litre: 1000, liter: 1000 };

/** A part-used pack's remaining share, as measured — 5% steps, which is
 *  what the server sends. Missing or nonsense reads as full, the server's own
 *  default. */
function partFill(raw: number | undefined): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 1;
  return Math.min(1, Math.max(0.05, Math.round(raw * 20) / 20));
}

/** The same share on the pack stepper, which only holds quarters (¼ at
 *  least). Weight and volume keep the measured share exactly instead. */
function toQuarter(fill: number): number {
  return Math.min(1, Math.max(0.25, Math.round(fill * 4) / 4));
}

export function toBaseUnitAmount(value: number, unit: string): number {
  const lower = unit.trim().toLowerCase().replace(/\.$/, '');
  const grams = TO_GRAMS[lower];
  if (grams !== undefined) return Math.round(value * grams);
  const ml = TO_ML[lower];
  if (ml !== undefined) return Math.round(value * ml);
  return value;
}

/**
 * One remote item to one candidate — and the one place a date acquires a
 * provenance.
 *
 * The order of the two branches is the rule: a date printed on the pack always
 * beats an estimate, however confident the estimate was. The reverse would mean
 * a model that felt strongly about a banana could overwrite a use-by date it
 * had just read off the label next to it.
 */
function toCandidate(item: RemoteItem, id: string): ScanCandidate {
  const printed = item.expiryDate || null;
  const estimated =
    !printed && item.shelfLifeDays > 0 ? dateInDays(item.shelfLifeDays) : null;

  const ripeness = isRipenessStage(item.ripeness) ? item.ripeness : null;

  // Best guess from what the server read off the packet — the review card
  // overrides this from a remembered per-product correction, if there is
  // one, once it has the user's uid (see ScanReviewScreen's EditCard).
  // A weighed item only gets a weight reading when the label's size was
  // actually read. Without one, the weight measure's placeholder (500 g) was
  // shown as if it had been scanned — a 25 kg rice sack came back as 500 g.
  // Falling back to counting it (1 sack) is honest, and the user sets the
  // weight from there.
  const hasSize = item.sizeValue > 0 && !!item.sizeUnit;
  const quantity = classifyMeasure({
    name: item.name,
    category: item.category,
    unit: item.measuredByWeight && hasSize ? item.sizeUnit : null,
    measuredByWeight: item.measuredByWeight === true && hasSize,
  });
  // How many packs' worth is actually on hand: every pack but one is full,
  // and the open one holds fillLevel of a pack — so two jars with one half
  // gone are 1½, and a single bag rolled down to a quarter is ¼.
  const count = item.count > 0 ? item.count : 1;
  const fill = partFill(item.fillLevel);
  // Only a measure that can hold a fraction of a pack takes the fill; a
  // plain count (eggs, tins) stays whole, and so the note would be claiming
  // a correction the amount never shows.
  let usedFill = false;

  if (quantity.measure === 'pieces' && item.count > 0) {
    // count from the server is only meaningful for a plain pieces reading.
    quantity.amount = item.count;
  } else if (
    (quantity.measure === 'weight' || quantity.measure === 'volume') &&
    item.sizeValue > 0 &&
    item.sizeUnit
  ) {
    // The printed size is the actual amount for a measured-by-weight/volume
    // item — grams/ml stay as-is, kg/L/oz/lb convert up to the base unit
    // the amount is always stored in (see services/quantity.ts). Scaled by
    // what's on hand: two 25 kg sacks are 50 kg, half a 1 kg bag is 500 g.
    // Exact to the measured share — 25% of a 1 kg bag is 250 g, not a quarter
    // step's worth of rounding.
    quantity.amount = Math.round(toBaseUnitAmount(item.sizeValue, item.sizeUnit) * (count - 1 + fill));
    usedFill = fill < 1;
  } else if (quantity.measure === 'pack') {
    quantity.amount = count - 1 + toQuarter(fill);
    usedFill = fill < 1;
  }
  // The measured percentage always rides along, so the user sees the precise
  // reading even where the pack stepper had to round it to a quarter.
  const percent = `about ${Math.round(fill * 100)}% left`;
  const seen = item.fillNote?.trim();
  const fillNote = usedFill ? (seen ? `${seen} · ${percent}` : percent.charAt(0).toUpperCase() + percent.slice(1)) : null;

  return {
    id,
    name: item.name,
    quantity,
    // Left blank so a pack reads as "¾ pack". This used to reuse the printed
    // size unit as the noun, which put the pack count next to the weight's
    // unit — a part-used 500 g pack read "¾ g". The printed size still
    // travels in `size` below.
    unit: '',
    // A size needs both halves to mean anything: "500" with no unit is not a
    // measurement, and a stray "g" with no number is noise.
    size:
      item.sizeValue > 0 && item.sizeUnit
        ? { value: item.sizeValue, unit: item.sizeUnit }
        : null,
    category: item.category,
    // Empty strings are the route's stand-in for "couldn't tell" — the schema
    // it constrains the model to has no nullable primitive. Falls back to
    // the food class's own sensible default (Phase 2 §4) rather than staying
    // empty, so STORE IN is never blank on an item that lands with basis
    // 'estimated' and needs a location to compute anything from.
    // Only what the photo actually showed — blank otherwise, for the user to
    // pick, rather than a default that reads as if it had been seen.
    location: normaliseLocation(item.location || null),

    expiryDate: printed ?? estimated,
    dateSource: printed ? 'label' : estimated ? 'estimated' : null,
    // Left untouched (undefined) even when the scanner found nothing at
    // all — a printed date or the vision model's own estimate is a real
    // value already filling the field either way, and on a genuine blank
    // read the user must be the one to type a date or tap "I don't know"
    // themselves; this app no longer picks that radio on their behalf.
    expiryUnknown: undefined,
    packageStatus: undefined,
    openedAt: null,
    // printed -> 'printed'. The vision model's own visual guess is a real
    // stored date from a rule, not Panzi's shelf-life engine and not
    // typed/printed — same shape as a rough-date chip pick, so 'rough'
    // rather than 'estimated'. Nothing found leaves this undefined rather
    // than claiming 'estimated' pre-emptively — 'estimated' is earned only
    // once the user actually opts into "I don't know" (see DateField's
    // selectUnknown), same reasoning as expiryUnknown just above.
    basis: printed ? 'printed' : estimated ? 'rough' : undefined,
    estimatedUseBy: null,
    estimateInputs: null,

    nameUnsure: item.nameUnsure === true,
    nameUnsureReason: item.nameUnsureReason || null,
    nameAlternatives: Array.isArray(item.nameAlternatives) ? item.nameAlternatives : [],

    looseProduce: item.looseProduce === true,
    ripeness,
    ripenessNotes: Array.isArray(item.ripenessNotes) ? item.ripenessNotes : [],
    ripenessBlocked: item.ripenessBlocked || null,
    // Only claims a source when there is a stage to source. The user can
    // overrule it later, at which point services/scan.ts flips this to 'user'.
    ripenessSource: ripeness ? 'estimated' : null,
    fillNote,

    editedByUser: false,
    userConfirmed: false,
    pantryItemId: null,
    // Zeroes are the route's "couldn't localise it"; a zero-area box would crop
    // to a single pixel, so it is dropped here rather than guarded at every
    // card that draws one.
    box: item.box && item.box.width > 0 && item.box.height > 0 ? item.box : null,
    // Scanned items are cropped out of the capture; only hand-added ones carry
    // a picture of their own.
    photoUri: null,
  };
}

export async function recognize(photo: {
  uri: string;
  width: number;
  height: number;
}): Promise<RecognitionResult> {
  const imageBase64 = await prepareImage(photo);

  let result: RemoteResult;
  try {
    result = await apiFetch<RemoteResult>('/api/scan', {
      imageBase64,
      mediaType: 'image/jpeg',
    });
  } catch (err) {
    const code = err instanceof ApiError ? err.code : null;
    if (code === 'unauthenticated') {
      throw new RecognitionError('Sign in again before scanning.');
    }
    if (code === 'resource-exhausted') {
      throw new RecognitionError("You've scanned a lot today — try again a bit later.");
    }
    if (code === 'unreachable' && err instanceof ApiError) {
      // Names the address it tried, because the usual cause is a stale IP in
      // .env after changing network — and "check your connection" sends the
      // user looking in the wrong place for that.
      throw new RecognitionError(err.message);
    }
    // Everything else — network drop, a sleeping free-tier instance, a bad
    // deploy — reads the same to the user: it didn't work, try again.
    throw new RecognitionError('Could not reach the scanner — check your connection and try again.');
  }

  if (!result.readable) {
    const cause = result.failureCause === 'none' ? 'unrecognised' : result.failureCause;
    return { readable: false, cause };
  }

  const boxes: Record<string, ScanBox> = {};
  const candidates = result.items.map((item, index) => {
    const id = `scan-${Date.now()}-${index}`;
    boxes[id] = item.box;
    return toCandidate(item, id);
  });

  return {
    readable: true,
    sceneLabel: result.sceneLabel || 'Scan',
    candidates,
    boxes,
  };
}
