// src/services/recognition.ts
//
// The client half of the scanner's recognition step: take the captured photo,
// shrink it to something worth sending, and post it to the API. The model call
// itself lives in server/src/routes/scan.ts because the Anthropic key can't
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

  return {
    id,
    name: item.name,
    count: item.count,
    // A size needs both halves to mean anything: "500" with no unit is not a
    // measurement, and a stray "g" with no number is noise.
    size:
      item.sizeValue > 0 && item.sizeUnit
        ? { value: item.sizeValue, unit: item.sizeUnit }
        : null,
    category: item.category,
    // Empty strings are the route's stand-in for "couldn't tell" — the schema
    // it constrains the model to has no nullable primitive.
    location: item.location || null,

    expiryDate: printed ?? estimated,
    dateSource: printed ? 'label' : estimated ? 'estimated' : null,

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
