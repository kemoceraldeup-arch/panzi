// src/services/scan.ts
//
// The scan flow's data model and the rules the review page turns on.
//
// Two rules from the item-scanner design carry the whole feature, and both are
// enforced here rather than in a screen:
//
//   1. Dates say where they came from. Every date on a candidate carries a
//      `dateSource`, and there is no way to set one without saying which it is.
//      An estimate must never be able to render as a printed date.
//
//   2. Doubt is per field, in words. There is no confidence score, no band and
//      no percentage — the earlier version of this file had all three. A card
//      needs a look because its *name* is a guess, or because it has *no date*,
//      or because its ripeness couldn't be judged, and the review page says
//      which in plain English.

import { PantryItem, DateSource, ItemBox, ItemPhoto } from './pantry';
import { RipenessStage, DEFAULT_SHELF_LIFE_DAYS, ripenessChipText } from '../utils/ripeness';
import { dateInDays, getDaysLeft, formatCalendarDate } from '../utils/freshness';

export type { DateSource };

/**
 * How big one of them is, as printed on the packet — 500 g, 1 L.
 *
 * Deliberately separate from the count, and that separation is the whole point.
 * The two used to share one field, and a 70 g bag of crisps arrived as a
 * quantity of 70: the review page then offered a stepper reading seventy, which
 * is not a number of bags anyone has. Size is read off packaging and rarely
 * edited; count is what the user actually adjusts. One control each.
 *
 * Null when nothing is printed, which is normal for loose produce.
 */
export type ScanSize = {
  value: number;
  /** A real measurement only — g, kg, ml, L. Never "pack" or "each". */
  unit: string;
};

/**
 * Where an item sits in the capture, as fractions of width and height.
 *
 * Declared here rather than alongside the recognition call because it outlives
 * it: the same rectangle draws the detection box during the read and crops the
 * item's thumbnail on every card afterwards.
 */
export type ScanBox = ItemBox;

// `DateSource` is declared in ./pantry and re-exported above. It says where a
// date came from — 'label' printed on the packaging, 'estimated' from how the
// food looks, 'user' typed by the person who owns it — and is never inferred at
// render time. A chip that had to work out its own provenance from which fields
// happen to be populated is a chip that will eventually get it wrong.

export type ScanCandidate = {
  id: string;
  name: string;
  /** How many of them. What the stepper edits; always a small number. */
  count: number;
  /** How big one of them is, or null when nothing is printed. */
  size: ScanSize | null;
  category: string;
  /** Free text as read from the shelf ("Fridge", "Crisper") — narrowed to a
   *  STORAGE_LOCATIONS value by the edit card before it is saved. */
  location: string | null;
  /** 'YYYY-MM-DD', or null when nothing could be read or estimated. */
  expiryDate: string | null;
  /** Always set when expiryDate is; always null when it isn't. */
  dateSource: DateSource | null;

  /** The name is a guess. Sends the card to "Needs a look". */
  nameUnsure: boolean;
  /** One sentence saying what got in the way — shown in the edit card. */
  nameUnsureReason: string | null;
  /** Up to three one-tap corrections offered beside the name field. */
  nameAlternatives: string[];

  /** Unpackaged fruit or veg — the only thing ripeness applies to. */
  looseProduce: boolean;
  ripeness: RipenessStage | null;
  /** Two observations backing the stage, shown under "How I judged it". */
  ripenessNotes: string[];
  /** Loose produce that couldn't be judged, and why. */
  ripenessBlocked: string | null;
  ripenessSource: 'estimated' | 'user' | null;

  /** Once the user has confirmed or corrected a row it stops being questioned. */
  editedByUser: boolean;

  /**
   * The user explicitly signed this row off — opened it and said it was right,
   * or picked a value themselves.
   *
   * Deliberately distinct from `editedByUser`, and the distinction is the whole
   * point of measuring accuracy honestly: adding a batch without opening a card
   * is not the same as checking it. A row nobody touched is *uncontested*, and
   * counting that as a confirmed correct read would let the app claim an
   * accuracy figure built mostly out of people not looking.
   */
  userConfirmed: boolean;

  /**
   * The pantry document this row became, once it has been saved.
   *
   * Carried on the candidate rather than as a parallel array of ids on the scan
   * record, because reopening a scan from history to finish it off can add and
   * remove rows — and index-aligned arrays would then write the corrections to
   * the wrong items. Null on anything not yet saved.
   */
  pantryItemId: string | null;

  /** Where this item was in the photo, so its card can show a crop of it
   *  rather than a coloured tile. Null when the model couldn't localise it. */
  box: ScanBox | null;

  /**
   * A picture belonging to this item alone, rather than a crop of the scan.
   *
   * Only hand-added items have one — there is no capture to crop them out of,
   * so they get their own from the camera or the photo library. When set it
   * wins over the crop.
   */
  photoUri: string | null;
};

/**
 * Whether this card sits under "Needs a look" rather than "Looks right".
 *
 * Three ways in, matching the three chips the design specifies. Note that an
 * *estimated* date is not one of them: an estimate is a real answer, honestly
 * labelled, and sending every loose banana to the top of the list would bury
 * the cards that genuinely need a decision.
 */
export function needsALook(c: ScanCandidate): boolean {
  if (c.editedByUser) return false;
  return c.nameUnsure || !c.expiryDate || !!c.ripenessBlocked;
}

export function splitByAttention(candidates: ScanCandidate[]): {
  needsLook: ScanCandidate[];
  looksRight: ScanCandidate[];
} {
  const needsLook: ScanCandidate[] = [];
  const looksRight: ScanCandidate[] = [];
  for (const c of candidates) (needsALook(c) ? needsLook : looksRight).push(c);
  return { needsLook, looksRight };
}

// ─── Chips ────────────────────────────────────────────────────────────────
//
// Every card shows one provenance chip, and its tone is what tells a printed
// date from a guess before a single word is read. Built here so the four
// screens that show one can't drift apart on what green means.

export type ChipTone =
  /** Solid mint. A fact read off the packaging. */
  | 'label'
  /** Dashed cream. A guess, and drawn like one. */
  | 'estimated'
  /** Peach. A real answer, but the food needs eating now. */
  | 'urgent'
  /** Dashed cream, muted. Nothing was found at all. */
  | 'missing';

export type ProvenanceChip = { text: string; tone: ChipTone };

/**
 * Structurally typed rather than taking a ScanCandidate, so a saved PantryItem
 * gets the identical chip. The provenance rules are the one thing that must not
 * differ between the review page and the pantry: a date drawn as printed in one
 * place and as a guess in the other is worse than either.
 */
export type DatedThing = {
  expiryDate: string | null;
  dateSource: DateSource | null;
  ripeness: RipenessStage | null;
};

export function provenanceChip(c: DatedThing): ProvenanceChip {
  if (!c.expiryDate) return { text: 'No date found', tone: 'missing' };

  const days = getDaysLeft(c.expiryDate) ?? 0;

  // Ripeness, when we have it, is a better thing to show than a date: it says
  // what the user would see if they picked the fruit up, and the date it
  // implies is right there beside it.
  if (c.ripeness && c.dateSource !== 'label') {
    return {
      text: ripenessChipText(c.ripeness, days),
      tone: days <= 0 || c.ripeness === 'past_best' ? 'urgent' : 'estimated',
    };
  }

  if (c.dateSource === 'label') {
    return { text: `${formatCalendarDate(c.expiryDate)} · from label`.toUpperCase(), tone: 'label' };
  }

  if (c.dateSource === 'user') {
    return { text: `${formatCalendarDate(c.expiryDate)} · you set this`.toUpperCase(), tone: 'label' };
  }

  const relative = days <= 0 ? 'TODAY' : days === 1 ? '1 DAY' : `${days} DAYS`;
  return { text: `${relative} · ESTIMATED`, tone: days <= 0 ? 'urgent' : 'estimated' };
}

/** The plain-words chips on a "needs a look" card, saying what is missing. */
export function attentionChips(c: ScanCandidate): string[] {
  const chips: string[] = [];
  if (c.nameUnsure) chips.push('Name unclear · tap to fix');
  if (c.ripenessBlocked) chips.push(c.ripenessBlocked);
  return chips;
}

// ─── Edits ────────────────────────────────────────────────────────────────

/**
 * Applies a ripeness the user picked themselves.
 *
 * Their pick overrides the estimate outright — stage, date and provenance move
 * together, because leaving yesterday's estimated date beside a stage the user
 * has just corrected would be the app quietly disagreeing with them. The
 * observations are dropped for the same reason: they justified a verdict that
 * no longer stands.
 */
export function withUserRipeness(c: ScanCandidate, stage: RipenessStage): ScanCandidate {
  return {
    ...c,
    ripeness: stage,
    ripenessSource: 'user',
    ripenessNotes: [],
    ripenessBlocked: null,
    expiryDate: dateInDays(DEFAULT_SHELF_LIFE_DAYS[stage]),
    // Still an estimate — a better-informed one, from the person holding the
    // fruit — so it keeps the dashed chip rather than being promoted to a fact.
    dateSource: 'estimated',
    editedByUser: true,
    // Picking a stage off the scale is as deliberate as it gets.
    userConfirmed: true,
  };
}

/** Confirms a card as-is: whatever the scanner was unsure about, the user isn't. */
export function markConfirmed(c: ScanCandidate): ScanCandidate {
  return {
    ...c,
    nameUnsure: false,
    nameUnsureReason: null,
    ripenessBlocked: null,
    editedByUser: true,
    userConfirmed: true,
  };
}

/**
 * An empty row for "Type it in" and "Add an item by hand".
 *
 * A typed item joins the same list as a photographed one rather than getting a
 * form of its own — one review page, one confirmation, one batch. It arrives
 * with nameUnsure set so it sorts into "Needs a look" and opens its edit card:
 * a blank row filed under "Looks right" would be a row the user never filled in
 * and the page told them was fine.
 */
export function blankCandidate(): ScanCandidate {
  return {
    id: `manual-${Date.now()}`,
    name: '',
    count: 1,
    size: null,
    category: 'Snacks',
    location: null,
    expiryDate: null,
    dateSource: null,
    nameUnsure: true,
    nameUnsureReason: null,
    nameAlternatives: [],
    looseProduce: false,
    ripeness: null,
    ripenessNotes: [],
    ripenessBlocked: null,
    ripenessSource: null,
    editedByUser: false,
    userConfirmed: false,
    pantryItemId: null,
    box: null,
    photoUri: null,
  };
}

/**
 * The pantry's single quantity string — "500 g", "2 × 500 g", "5".
 *
 * Count and size are kept apart everywhere they are edited and only combined
 * here, on the way out. One of something says its size and nothing else, since
 * "1 × 500 g" is a sentence nobody says out loud.
 */
export function formatQuantity(c: ScanCandidate): string {
  const size = c.size ? `${c.size.value} ${c.size.unit}`.trim() : null;
  if (!size) return String(c.count);
  return c.count > 1 ? `${c.count} × ${size}` : size;
}

/** The short line under a name on a card — "Cupboard · 70 g". */
export function describeQuantity(c: ScanCandidate): string {
  const size = c.size ? `${c.size.value} ${c.size.unit}`.trim() : null;
  if (!size) return c.count === 1 ? '1' : `${c.count}`;
  return c.count > 1 ? `${c.count} × ${size}` : size;
}

/** The shape handed to `addPantryItems` once the batch is confirmed. */
export function candidateToItem(
  c: ScanCandidate,
  /**
   * The capture this row was detected in, when there is one.
   *
   * Passed in rather than carried on the candidate because one capture backs
   * every row of a scan — storing it per candidate would put the same URI and
   * dimensions on the wire a dozen times. It is what lets the pantry crop the
   * item out of the shelf photo long after the scan is closed.
   */
  scanPhoto?: ItemPhoto | null
): Omit<PantryItem, 'id' | 'addedAt'> & { location: string } {
  return {
    name: c.name,
    quantity: formatQuantity(c),
    category: c.category,
    location: c.location ?? 'Other',
    expiryDate: c.expiryDate,
    // The picture follows the item onto the shelf. A row that showed the packet
    // during review and a blank tile forever after would read as the app having
    // lost track of what it just looked at.
    photoUri: c.photoUri,
    // Only useful as a pair — a box with no capture crops nothing, and a
    // capture with no box has no idea which part of the shelf this row is.
    scanPhoto: c.box && scanPhoto?.width && scanPhoto?.height ? scanPhoto : null,
    box: scanPhoto?.width && scanPhoto?.height ? c.box : null,
    // Provenance outlives the scan. An estimate that lost its dashed chip on
    // the way into the pantry would become indistinguishable from a printed
    // date the next morning, which is the one thing the design forbids.
    dateSource: c.dateSource,
    ripeness: c.ripeness,
    ripenessSource: c.ripenessSource,
  };
}
