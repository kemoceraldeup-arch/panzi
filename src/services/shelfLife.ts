// src/services/shelfLife.ts
//
// Phase 2's own engine: turns {foodClass, storedIn, packageStatus, from} into
// an actual use-by date, not a relative duration. Pure and synchronous — no
// network, no model call, same "paint before classification" rule Phase 1's
// estimateWindow (services/foodClass.ts) was built against.
//
// Phase 1's estimateWindow still exists and still backs the rough-date-chip
// math; this file is deliberately separate rather than a rewrite of it,
// because the two answer different questions. estimateWindow says "how much
// longer, roughly" for a panel that only ever shows a relative duration.
// estimateUseBy says "what calendar date", for the one place — the PANZI
// USE-BY ESTIMATE panel — where Phase 2 explicitly lifts Phase 1's "never a
// calendar date" rule and allows a precise date, so long as it is clearly
// labelled as Panzi's own estimate rather than the product's.

import { FoodClass } from './foodClass';
import { dateInDays } from '../utils/freshness';

export type StoredIn = 'cabinet' | 'pantry' | 'fridge' | 'freezer';
export type PackageStatusValue = 'sealed' | 'opened' | undefined;
export type Confidence = 'low' | 'medium' | 'high';

/**
 * Base windows in days, sitting in each storage location — the spec's own
 * §5a table, verbatim. Conservative by design: Panzi has no way to know how
 * long a wet-market chicken sat out before it reached the fridge, so every
 * fresh-food figure here is the low end of the safe range, not the average.
 *
 * Source: FDA FoodKeeper / USDA FSIS cold-storage charts, coarsened to whole
 * classes of food rather than per-product figures, then rounded down for
 * the classes where a wrong-but-generous guess is a real risk (meat-fish,
 * dairy, produce). Tune this table, not the UI, when the numbers need to
 * move — nothing outside this file should hardcode a day count.
 *
 * `null` marks a combination the table simply doesn't reach (e.g. dry
 * staples aren't stored in the fridge/freezer as a distinct regime worth a
 * separate figure from cabinet) — estimateUseBy falls back to the cabinet
 * figure for those rather than throwing, since a lookup miss on a real item
 * is not a state the estimate is allowed to have no answer for.
 */
type WindowRow = {
  cabinet: number;
  fridge: number;
  freezer: number | null;
  /** Opened, once refrigerated — the one column that only applies to a
   *  handful of classes. Absent means "opened doesn't change this class's
   *  window in a way worth a separate figure" (dry-staple/spice/frozen). */
  openedFridge?: number;
  /** True when storing in `cabinet` is genuinely unsafe for this class —
   *  the estimate still computes (as 1 day) but the caller adds a warning
   *  line rather than presenting the number as a normal answer. */
  cabinetUnsafe?: boolean;
  /** Same idea for the fridge column, for classes cabinet-unsafe food is
   *  still marginal in even once chilled (frozen food thawed into the
   *  fridge, say). */
  fridgeUnsafe?: boolean;
  confidence: Confidence;
};

const SHELF_LIFE_DAYS: Record<FoodClass, WindowRow> = {
  // The flat fallback for meat-fish when no name is given to sub-classify,
  // or nothing in it matches a known sub-type below — a genuinely
  // conservative "some kind of fresh meat or fish, no further detail"
  // figure. Most real items get a more specific window from
  // MEAT_SUBTYPE_DAYS instead; see estimateUseBy's own use of it.
  'meat-fish': { cabinet: 1, cabinetUnsafe: true, fridge: 2, freezer: 180, confidence: 'low' },
  produce: { cabinet: 4, fridge: 7, freezer: 240, confidence: 'low' },
  dairy: { cabinet: 1, cabinetUnsafe: true, fridge: 7, freezer: 90, openedFridge: 4, confidence: 'medium' },
  bakery: { cabinet: 3, fridge: 6, freezer: 90, confidence: 'medium' },
  condiment: { cabinet: 365, fridge: 540, freezer: null, openedFridge: 60, confidence: 'medium' },
  canned: { cabinet: 900, fridge: 900, freezer: null, openedFridge: 3, confidence: 'high' },
  'dry-staple': { cabinet: 730, fridge: 730, freezer: 900, openedFridge: 365, confidence: 'high' },
  spice: { cabinet: 540, fridge: 540, freezer: null, openedFridge: 365, confidence: 'medium' },
  frozen: { cabinet: 1, cabinetUnsafe: true, fridge: 2, fridgeUnsafe: true, freezer: 270, confidence: 'high' },
};

/**
 * meat-fish's own real spread — the single flat "2 days fridge" above
 * covers everything from ground beef to a whole cut of pork to smoked
 * bacon, and those genuinely don't keep the same length of time. A whole
 * cut of pork or beef is good for 3-5 days refrigerated (USDA FoodKeeper);
 * ground meat and poultry are the ones that are actually only 1-2 days;
 * cured/smoked product is the outlier the other direction, weeks not days.
 * Matched from the item's own name — cheap, synchronous, no different from
 * classifyFood's own category lookup — and only ever refines meat-fish's
 * number, never overrides another class or blocks on a name that matches
 * nothing (falls through to the flat figure above, same as today).
 */
type MeatSubType = 'ground' | 'whole-cut' | 'poultry' | 'fish-seafood' | 'cured';

const MEAT_SUBTYPE_DAYS: Record<MeatSubType, WindowRow> = {
  ground: { cabinet: 1, cabinetUnsafe: true, fridge: 2, freezer: 120, confidence: 'medium' },
  'whole-cut': { cabinet: 1, cabinetUnsafe: true, fridge: 4, freezer: 180, confidence: 'medium' },
  poultry: { cabinet: 1, cabinetUnsafe: true, fridge: 2, freezer: 270, confidence: 'medium' },
  'fish-seafood': { cabinet: 1, cabinetUnsafe: true, fridge: 2, freezer: 90, confidence: 'medium' },
  cured: { cabinet: 5, fridge: 14, freezer: 60, confidence: 'medium' },
};

// Checked in this order — "ground pork" must hit 'ground' before the plain
// "pork" pattern further down gets a chance to call it a whole cut, so the
// more specific word wins whenever both would otherwise match.
const MEAT_SUBTYPE_PATTERNS: { subtype: MeatSubType; pattern: RegExp }[] = [
  { subtype: 'cured', pattern: /\b(bacon|ham|salami|chorizo|pepperoni|prosciutto|sausage|hotdog|hot dog|longganisa|tocino|smoked)\b/i },
  { subtype: 'ground', pattern: /\b(ground|minced|mince|giniling)\b/i },
  { subtype: 'poultry', pattern: /\b(chicken|turkey|duck|manok)\b/i },
  { subtype: 'fish-seafood', pattern: /\b(fish|salmon|tuna|tilapia|bangus|shrimp|prawn|crab|squid|mussel|clam|oyster|isda|hipon)\b/i },
  { subtype: 'whole-cut', pattern: /\b(pork|beef|baboy|karne|steak|chop|roast|loin|belly|ribs?|liempo)\b/i },
];

function meatSubType(name: string | undefined): MeatSubType | null {
  if (!name) return null;
  for (const { subtype, pattern } of MEAT_SUBTYPE_PATTERNS) {
    if (pattern.test(name)) return subtype;
  }
  return null;
}

export type EstimateResult = {
  /** 'YYYY-MM-DD'. Clamped to today when the raw computation lands in the
   *  past (§5b rule 4) — never a date behind the day it's shown on. */
  date: string;
  /** Whether `date` was clamped — the caller renders "Use today" instead of
   *  the date string when true, per the same rule. */
  isToday: boolean;
  /** The window actually applied, in whole days from `from` — before any
   *  past-date clamping. Kept for estimateInputs.days (Part E's model). */
  days: number;
  confidence: Confidence;
  /** Set when the chosen storage location is unsafe for this food class —
   *  one line, named after the class, for the panel to show. Never blocks
   *  the save (§5a: "Do not block the save"). */
  unsafeStorageWarning: string | null;
};

/**
 * §5's own sanity ceiling, per class — the spec's exact numbers. Whatever
 * daysFor() computes is clamped to this before it ever reaches a date, so a
 * classification mistake upstream (a hand-typed "Mature cheddar" landing in
 * the wrong FoodClass, say — the actual bug this exists to catch) produces
 * an estimate that's merely wrong-looking-enough-to-notice rather than one
 * that looks confidently correct while being off by a year. "A wrong
 * estimate that looks confident is worse than no estimate" — the ceiling
 * doesn't try to guess the right number, it just refuses to let the wrong
 * one through looking precise.
 *
 * Frozen storage is exempt: freezing is the one thing that's *supposed* to
 * push bakery/meat-fish out to months, and the table's own freezer figures
 * for those classes (90/180 days) are already well past these ceilings by
 * design, not by mistake. dairy/produce keep the same ceiling everywhere —
 * nothing in either class is genuinely freezer-stable for as long as the
 * sealed/cabinet windows for dry goods are.
 */
const MAX_DAYS_UNLESS_FROZEN: Partial<Record<FoodClass, number>> = {
  dairy: 60,
  produce: 30,
  bakery: 14,
  'meat-fish': 7,
};

function clampToClassMax(foodClass: FoodClass, storedIn: StoredIn, days: number, subType: MeatSubType | null): number {
  // Cured/smoked meat genuinely outlasts meat-fish's own general ceiling —
  // that's a real property of the sub-type, not a sign the item landed in
  // the wrong FoodClass, so it's exempted the same way frozen storage
  // already is below.
  if (foodClass === 'meat-fish' && subType === 'cured') return days;
  const max = MAX_DAYS_UNLESS_FROZEN[foodClass];
  if (max === undefined || storedIn === 'freezer' || days <= max) return days;
  if (__DEV__) {
    console.warn(
      `[shelfLife] estimateUseBy clamped ${foodClass}/${storedIn}: computed ${days}d, ceiling is ${max}d. Check the classifier — this usually means an item landed in the wrong FoodClass.`
    );
  }
  return max;
}

const CLASS_NOUN: Record<FoodClass, string> = {
  'meat-fish': 'Meat and fish',
  produce: 'Fresh produce',
  dairy: 'Dairy',
  bakery: 'Bread',
  condiment: 'This',
  canned: 'This',
  'dry-staple': 'This',
  spice: 'This',
  frozen: 'Frozen food',
};

function daysFor(row: WindowRow, storedIn: StoredIn, opened: boolean): { days: number; unsafe: boolean } {
  if (opened && storedIn !== 'freezer' && row.openedFridge !== undefined) {
    // Opened windows are only tabulated for the fridge — an opened jar left
    // in the cabinet doesn't get a separate figure because the sealed
    // cabinet number was already generous; falling through to it here
    // would double-count "opened" as if it were free.
    return { days: row.openedFridge, unsafe: false };
  }
  switch (storedIn) {
    case 'freezer':
      // No freezer figure for this class (condiment/canned/spice) — the
      // fridge number is the closest real answer rather than inventing a
      // freezer-specific one nothing backs.
      return { days: row.freezer ?? row.fridge, unsafe: false };
    case 'fridge':
      return { days: row.fridge, unsafe: !!row.fridgeUnsafe };
    case 'cabinet':
    case 'pantry':
    default:
      return { days: row.cabinet, unsafe: !!row.cabinetUnsafe };
  }
}

/**
 * Pure function: {foodClass, storedIn, packageStatus, from} -> a use-by
 * date, no network, no model call. `from` is openedAt ?? addedAt, resolved
 * by the caller (services/pantry or the review card) since this file has no
 * opinion on which reference date applies — it only ever adds `days` to
 * whatever it's handed.
 *
 * `name` is optional and only ever refines meat-fish — see meatSubType and
 * MEAT_SUBTYPE_DAYS above for why that's the one class a single flat number
 * genuinely wasn't accurate for. Every other class keeps its one number;
 * passing no name (or a name nothing matches) falls back to exactly the
 * same figure this function always returned.
 */
export function estimateUseBy(
  foodClass: FoodClass,
  storedIn: StoredIn,
  packageStatus: PackageStatusValue,
  from: string,
  name?: string
): EstimateResult {
  const subType = foodClass === 'meat-fish' ? meatSubType(name) : null;
  const row = subType ? MEAT_SUBTYPE_DAYS[subType] : SHELF_LIFE_DAYS[foodClass];
  const { days: rawDays, unsafe } = daysFor(row, storedIn, packageStatus === 'opened');
  const days = clampToClassMax(foodClass, storedIn, rawDays, subType);

  const fromDate = parseIso(from);
  const raw = new Date(fromDate);
  raw.setDate(raw.getDate() + Math.round(days));

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const isToday = raw.getTime() <= today.getTime();
  const date = isToday ? todayIso() : isoFromDate(raw);

  const unsafeStorageWarning =
    unsafe && (storedIn === 'cabinet' || storedIn === 'pantry')
      ? `${CLASS_NOUN[foodClass]} shouldn't be stored in a cabinet — use it today.`
      : unsafe && storedIn === 'fridge'
        ? `${CLASS_NOUN[foodClass]} shouldn't sit out in the fridge unfrozen for long — use it today.`
        : null;

  return { date, isToday, days: Math.round(days), confidence: row.confidence, unsafeStorageWarning };
}

function parseIso(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function isoFromDate(d: Date): string {
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

function todayIso(): string {
  return dateInDays(0);
}
