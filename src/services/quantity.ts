// src/services/quantity.ts
//
// The "How many" data model: four ways a food item gets measured, and the
// rules for stepping, formatting and classifying each one.
//
// Weight and volume are always stored in their base unit — grams and
// millilitres — never a formatted string. This is the one file that knows
// that conversion; everything else (the stepper, the summary line, the saved
// pantry string) reads through formatQuantity/parseQuantityString below
// rather than reimplementing the g/kg or ml/L split.
//
// `displayUnit` is a separate concern from that base-unit storage: it is
// which of the two units (g/kg, ml/L) the person is currently looking at and
// typing into. Older code let the stored amount's own magnitude decide that
// (>=1000 shows kg/L) — which is exactly the bug this field exists to fix:
// a person who typed "4.5" into a field labelled "L" and then taps that same
// field back open must see "4.5" again, not the 4500 it's stored as
// underneath. displayUnit is what the editable field and the unit picker
// both read and write; the stored `amount` never changes meaning.

import AsyncStorage from '@react-native-async-storage/async-storage';

export type Measure = 'pieces' | 'pack' | 'weight' | 'volume';

/** Weight and volume each display in one of two units at a time — never a
 *  bare number with the unit implied by its size. g/mL for anything under
 *  the 1000 cutover, kg/L at and above it, exactly matching where
 *  formatAmount used to switch automatically — so a row read in from
 *  existing data (see displayUnitFor below) opens on the unit it already
 *  looked like it was in, and only changes when the person actually picks a
 *  different one. */
export type WeightUnit = 'g' | 'kg';
export type VolumeUnit = 'mL' | 'L';
export type DisplayUnit = WeightUnit | VolumeUnit;

export const WEIGHT_UNITS_LIST: WeightUnit[] = ['g', 'kg'];
export const VOLUME_UNITS_LIST: VolumeUnit[] = ['mL', 'L'];

export type ItemQuantity = {
  measure: Measure;
  /** Whether the user could plausibly hold part of one — a loaf, a bag of
   *  rice. Weight and volume are always splittable (a gram already is a
   *  fraction of the whole); pieces defaults to false (an egg, a tin). */
  splittable: boolean;
  /** pieces: a count · pack: number of packs (quarter steps) · weight:
   *  grams · volume: millilitres. Always the base unit — g or mL — never
   *  whatever unit is currently on screen; see displayUnit. */
  amount: number;
  /** Which unit weight/volume is currently being read and edited in — 'g' or
   *  'kg', 'mL' or 'L'. Meaningless for pieces/pack, which have no base-unit
   *  split to begin with. Optional so existing saved rows (and every
   *  MeasureControl call site written before this field existed) keep
   *  working — displayUnitFor derives a sensible default from the amount's
   *  own size when this is absent, the same cutover formatAmount always used. */
  displayUnit?: DisplayUnit;
};

/** The unit a row should show when displayUnit hasn't been explicitly set —
 *  the same >=1000 cutover formatAmount always used, so a freshly-classified
 *  or freshly-loaded quantity opens on the unit it already reads as. */
export function displayUnitFor(q: ItemQuantity): DisplayUnit {
  if (q.displayUnit) return q.displayUnit;
  if (q.measure === 'weight') return q.amount >= 1000 ? 'kg' : 'g';
  return q.amount >= 1000 ? 'L' : 'mL';
}

const UNIT_TO_BASE_FACTOR: Record<DisplayUnit, number> = { g: 1, kg: 1000, mL: 1, L: 1000 };

/** The value to show in the editable field — the stored base-unit amount
 *  converted into whichever unit is currently on screen. This is the one
 *  function anything that edits weight/volume must read the number through;
 *  reading `quantity.amount` directly is what caused "4.5 L" to open as
 *  "4500" — the base amount, not the displayed one. Rounds to 3 decimals to
 *  clear ordinary float drift (4500/1000 etc.) without inventing precision
 *  a kitchen scale never gave. */
export function displayAmount(q: ItemQuantity): number {
  if (q.measure !== 'weight' && q.measure !== 'volume') return q.amount;
  const unit = displayUnitFor(q);
  const value = q.amount / UNIT_TO_BASE_FACTOR[unit];
  return Math.round(value * 1000) / 1000;
}

/** The inverse of displayAmount: a number the person typed or tapped, in
 *  whatever unit is currently on screen, converted to the base unit this
 *  quantity is actually stored in. Every write path — typing a value,
 *  tapping a preset, switching kg<->g — must go through this rather than
 *  writing the displayed number straight into `amount`, or the stored
 *  figure silently becomes 1000x too small. */
export function toBaseAmount(value: number, unit: DisplayUnit): number {
  return value * UNIT_TO_BASE_FACTOR[unit];
}

export const MEASURE_LABELS: Record<Measure, string> = {
  pieces: 'Pieces',
  pack: 'Packs & jars',
  weight: 'Weight',
  volume: 'Volume',
};

export const MEASURE_EXAMPLES: Record<Measure, string> = {
  pieces: 'eggs, tins',
  pack: 'sugar, rice',
  weight: 'chicken, mince',
  volume: 'milk, oil',
};

export const MEASURES: Measure[] = ['pieces', 'pack', 'weight', 'volume'];

/** What a freshly-picked measure starts at — the reset the spec calls for
 *  when the user switches measures from the pill. */
export function defaultAmount(measure: Measure): number {
  switch (measure) {
    case 'pieces':
      return 1;
    case 'pack':
      return 1;
    case 'weight':
      return 500;
    case 'volume':
      return 500;
  }
}

export function defaultQuantity(measure: Measure = 'pieces'): ItemQuantity {
  return { measure, splittable: measure === 'pack', amount: defaultAmount(measure) };
}

// ─── Stepping ─────────────────────────────────────────────────────────────

/** The −/+ step size for the current amount — weight and volume tighten up
 *  below the kg/L cutover, where a 100 g jump is a much bigger relative move
 *  than it is on a 2 kg sack. */
export function stepFor(measure: Measure, amount: number): number {
  switch (measure) {
    case 'pieces':
      return 1;
    case 'pack':
      return 0.25;
    case 'weight':
      return amount < 1000 ? 50 : 100;
    case 'volume':
      return amount < 1000 ? 50 : 100;
  }
}

/** The floor the −/+ stepper and direct type-in both clamp to. A splittable
 *  piece (a loaf) can go down to half of one; a non-splittable piece (an
 *  egg) floors at a whole one — zero of something is a delete, not a
 *  quantity, and Remove is the control for that. */
export function minFor(measure: Measure, splittable = false): number {
  switch (measure) {
    case 'pieces':
      return splittable ? 0.5 : 1;
    case 'pack':
      return 0.25;
    case 'weight':
      return 50;
    case 'volume':
      return 50;
  }
}

/** The ceiling the −/+ stepper and direct type-in both clamp to — every path
 *  that can set `amount`, with nothing above this. Without one, holding + or
 *  pasting a long string of digits ran the stored amount up without limit;
 *  one real case did it into scientific notation (9.67e+36 kg), a number no
 *  kitchen produces and no UI has room to display sanely. The ceilings
 *  themselves are generous household-pantry maximums, not tight bounds meant
 *  to be brushed up against — 500 kg/L, 1000 pieces, 100 packs — comfortably
 *  above anything a real grocery haul would ever need. */
export function maxFor(measure: Measure): number {
  switch (measure) {
    case 'pieces':
      return 1000;
    case 'pack':
      return 100;
    case 'weight':
      return 500_000; // 500 kg, in grams — the base unit this is stored in.
    case 'volume':
      return 500_000; // 500 L, in millilitres.
  }
}

/** Pieces steps by whole numbers unless splittable, in which case halves are
 *  allowed — the increment step() itself uses, distinct from stepFor's
 *  display-only −/+ size for weight/volume. */
function pieceIncrement(splittable: boolean): number {
  return splittable ? 0.5 : 1;
}

export function step(q: ItemQuantity, direction: 1 | -1): ItemQuantity {
  const delta =
    q.measure === 'pieces' ? pieceIncrement(q.splittable) * direction : stepFor(q.measure, q.amount) * direction;
  const min = minFor(q.measure, q.splittable);
  const max = maxFor(q.measure);
  const next = Math.min(max, Math.max(min, roundToStep(q.amount + delta, q.measure)));
  return { ...q, amount: next };
}

/** Guards against float drift (0.1 + 0.2 territory) on the ¼-step measures. */
function roundToStep(value: number, measure: Measure): number {
  if (measure === 'pack') return Math.round(value * 4) / 4;
  if (measure === 'pieces') return Math.round(value * 2) / 2;
  return Math.round(value);
}

// ─── Unit nouns — always follow the item ───────────────────────────────────

/** Pluralises a unit noun for pieces/pack display — "1 pot" / "2 pots",
 *  "1 loaf" / "2 loaves". A small hand-written table beats a general
 *  pluraliser, which would still misfire on the irregulars that actually
 *  show up here (loaf/loaves, box/boxes). */
const IRREGULAR_PLURALS: Record<string, string> = {
  loaf: 'loaves',
  box: 'boxes',
  batch: 'batches',
  dish: 'dishes',
};

export function pluralizeUnit(unit: string, amount: number): string {
  if (!unit) return unit;
  if (amount === 1) return unit;
  const lower = unit.toLowerCase();
  if (IRREGULAR_PLURALS[lower]) return IRREGULAR_PLURALS[lower];
  if (lower.endsWith('s') || lower.endsWith('x') || lower.endsWith('ch')) return `${unit}es`;
  if (lower.endsWith('y') && !/[aeiou]y$/.test(lower)) return `${unit.slice(0, -1)}ies`;
  return `${unit}s`;
}

// ─── Fractions — real glyphs, never decimals ───────────────────────────────

const FRACTION_GLYPHS: Record<number, string> = { 0.25: '¼', 0.5: '½', 0.75: '¾' };

/** "1¼", "2", "¾" — quarter-step amounts (pack, splittable pieces) as a
 *  mixed-number glyph string, never "1.25". */
export function formatQuarterAmount(amount: number): string {
  const whole = Math.floor(amount);
  const frac = Math.round((amount - whole) * 100) / 100;
  const glyph = FRACTION_GLYPHS[frac] ?? '';
  if (whole === 0) return glyph || '0';
  return glyph ? `${whole}${glyph}` : String(whole);
}

/** At most two decimals, no trailing zeros — "1.5 kg", never "1.50 kg". */
function trimDecimals(value: number): string {
  return String(Math.round(value * 100) / 100);
}

// ─── Display ────────────────────────────────────────────────────────────

/** The value shown inside the stepper — "6 eggs", "¾ bag", "1.5 kg", or "1
 *  piece" when the item has no unit noun of its own. `unit` is the item's
 *  own unit noun for pieces/pack ("egg", "bag", "loaf"); grams and
 *  millilitres never take one, they format through whichever unit
 *  displayUnitFor says this row is currently showing.
 *  Pieces always names something — "piece" is the fallback noun, never a
 *  bare number on its own, so nothing on this card ever reads as a
 *  quantity with no unit at all.
 *
 *  Deliberately reads displayUnitFor rather than re-deriving the unit from
 *  q.amount's own size the way this used to: stepping a weight from 950 g to
 *  1050 g must not silently relabel the field "1.05 kg" out from under
 *  someone who is actively looking at grams — the unit only changes when
 *  they pick a different one. */
export function formatAmount(q: ItemQuantity, unit: string): string {
  switch (q.measure) {
    case 'pieces': {
      const n = q.amount % 1 === 0 ? String(q.amount) : formatQuarterAmount(q.amount);
      return `${n} ${pluralizeUnit(unit || 'piece', q.amount)}`;
    }
    case 'pack': {
      const n = formatQuarterAmount(q.amount);
      const word = unit || 'pack';
      return `${n} ${pluralizeUnit(word, q.amount)}`;
    }
    case 'weight':
    case 'volume': {
      const displayUnitValue = displayUnitFor(q);
      return `${trimDecimals(displayAmount(q))} ${displayUnitValue}`;
    }
  }
}

/** The muted confirmation line under the control — "Stored as 1.5 kg —
 *  steps of 100 g." / "Stored as ¾ × bag — ¼ steps." / "Stored as 6 eggs."
 *  / "Stored as 1½ loaves — halves allowed." */
export function summaryLine(q: ItemQuantity, unit: string): string {
  const amount = formatAmount(q, unit);
  switch (q.measure) {
    case 'pieces':
      return q.splittable ? `Stored as ${amount} — halves allowed.` : `Stored as ${amount}.`;
    case 'pack':
      return `Stored as ${formatQuarterAmount(q.amount)} × ${unit || 'pack'} — ¼ steps.`;
    case 'weight':
      return `Stored as ${amount} — steps of ${stepFor('weight', q.amount)} g.`;
    case 'volume':
      return `Stored as ${amount} — steps of ${stepFor('volume', q.amount)} ml.`;
  }
}

// ─── Quick-amount presets ───────────────────────────────────────────────

export type QuickAmount = { amount: number; label: string };

/** The 3-column quick-pick row's values, per measure — six entries each, the
 *  exact sets the spec lists, so the grid is always a clean 3×2 with no
 *  orphan row. Pieces/pack labels are formatted through the item's own unit
 *  where one is known; weight/volume are fixed g/kg/mL/L strings regardless
 *  of the row's current displayUnit — a preset names its own unit, e.g.
 *  "1.5 kg", the same way it does when tapped (see MeasureControl, which
 *  also switches displayUnit to match whichever preset was picked). */
export function quickAmounts(measure: Measure, unit: string): QuickAmount[] {
  switch (measure) {
    case 'pieces':
      return [1, 2, 4, 6, 10, 12].map((n) => ({
        amount: n,
        label: unit ? `${n} ${pluralizeUnit(unit, n)}` : String(n),
      }));
    case 'pack':
      return [0.25, 0.5, 0.75, 1, 1.5, 2].map((n) => ({
        amount: n,
        label: `${formatQuarterAmount(n)} ${pluralizeUnit(unit || 'pack', n)}`,
      }));
    case 'weight':
      return [100, 250, 500, 1000, 1500, 2000].map((n) => ({
        amount: n,
        label: n >= 1000 ? `${trimDecimals(n / 1000)} kg` : `${n} g`,
      }));
    case 'volume':
      return [250, 500, 1000, 1500, 2000, 3000].map((n) => ({
        amount: n,
        label: n >= 1000 ? `${trimDecimals(n / 1000)} L` : `${n} mL`,
      }));
  }
}

/** The unit a weight/volume preset's own label is in — "100 g" is g, "1.5
 *  kg" is kg — so picking a preset can switch displayUnit to match it
 *  (tapping "1.5 kg" must leave the field reading "1.5"/"kg", never "1500"
 *  under a stale "g" label). Pieces/pack presets have no base-unit split, so
 *  this only ever matters for the two measures that do. */
export function presetUnit(measure: Measure, amount: number): DisplayUnit | null {
  if (measure === 'weight') return amount >= 1000 ? 'kg' : 'g';
  if (measure === 'volume') return amount >= 1000 ? 'L' : 'mL';
  return null;
}

// ─── Classification ─────────────────────────────────────────────────────

// Categories treated as pantry staples for the pack/jar default — matches
// FOOD_CATEGORIES in services/pantry.ts loosely by name rather than
// importing it, so this module has no dependency on that one.
const STAPLE_CATEGORIES = new Set(['Grains & pasta', 'Tins & jars', 'Herbs & spices']);

// Container words only — a bare weight unit (g/kg) is ambiguous between pack
// and weight on its own, so it is deliberately left out here and decided by
// STAPLE_CATEGORIES instead (see classifyMeasure's ordering comment).
const PACK_UNITS = new Set(['jar', 'pack', 'bag', 'tin', 'box']);
const WEIGHT_UNITS = new Set(['g', 'kg', 'oz', 'lb']);
const VOLUME_UNITS = new Set(['ml', 'l', 'L']);

// Items that read as "one whole thing" even though they're sold loose or by
// weight elsewhere in the catalogue — never offered the half-a-loaf pill.
// Checked against both the item's own name and its catalogue unit word
// ("tin", "pot"), since the unit is what actually says "one whole
// container" — a name alone ("Tuna") says nothing about its packaging.
const NOT_SPLITTABLE_PIECES = new Set(['egg', 'eggs', 'tin', 'tins', 'pot', 'pots', 'yoghurt pot']);
// Pieces that do halve meaningfully — same dual check as above (name or unit).
const SPLITTABLE_PIECES = new Set([
  'loaf', 'loaves', 'melon', 'watermelon', 'cabbage', 'cake', 'pumpkin', 'squash', 'pizza',
]);

/**
 * Best-guess measure for an item the review card has never seen corrected
 * before. Never blocks the user — anything it can't place falls back to
 * `pieces`, amount 1, not splittable, exactly per spec.
 *
 * Order matters: a pantry staple (rice, flour, spice jars) is checked before
 * a bare weight/volume unit, because a staple's net weight is still sold and
 * thought of as "a bag" or "a jar" — pack, not weight — even though it
 * carries a kg/g unit the same way loose meat does. Only an item the source
 * explicitly says is priced/measured by weight (no fixed pack — the
 * `measuredByWeight` flag from a camera scan) skips that and goes straight
 * to weight, matching the spec's own split: "priced per kg, or barcode net
 * weight with no fixed pack" (weight) vs. "a net weight printed on a sealed
 * bag/jar" (pack).
 */
export function classifyMeasure(input: {
  name: string;
  category?: string | null;
  /** A unit read off packaging or the catalogue, if any — "g", "jar", "kg". */
  unit?: string | null;
  /** True when the source already said this is priced/measured by weight,
   *  with no fixed pack — loose meat, deli counter items. */
  measuredByWeight?: boolean;
}): ItemQuantity {
  const name = input.name.trim().toLowerCase();
  const unit = (input.unit ?? '').trim().toLowerCase();
  const category = input.category ?? '';

  if (input.measuredByWeight) {
    return { measure: 'weight', splittable: true, amount: defaultAmount('weight') };
  }
  if (STAPLE_CATEGORIES.has(category) || PACK_UNITS.has(unit)) {
    return { measure: 'pack', splittable: true, amount: defaultAmount('pack') };
  }
  if (WEIGHT_UNITS.has(unit)) {
    return { measure: 'weight', splittable: true, amount: defaultAmount('weight') };
  }
  if (VOLUME_UNITS.has(unit)) {
    return { measure: 'volume', splittable: true, amount: defaultAmount('volume') };
  }

  const splittable =
    (SPLITTABLE_PIECES.has(name) || SPLITTABLE_PIECES.has(unit)) &&
    !NOT_SPLITTABLE_PIECES.has(name) &&
    !NOT_SPLITTABLE_PIECES.has(unit);
  return { measure: 'pieces', splittable, amount: defaultAmount('pieces') };
}

// ─── Persisted string ↔ ItemQuantity ────────────────────────────────────
//
// PantryItem.quantity stays a plain string (see services/pantry.ts) — this is
// the shared save/reopen format, written so parseQuantityString can recover
// {measure, amount} without a schema change. It deliberately keeps the same
// shapes downstream parsers (services/pantry.ts's parseQuantity) already
// handle: a leading number, optionally followed by a unit word.

export function formatQuantityString(q: ItemQuantity, unit: string): string {
  switch (q.measure) {
    case 'pieces':
      // Always names a unit, same as formatAmount — a pantry row saved as a
      // bare "2" with nothing else on it is exactly the ambiguity this
      // model exists to remove.
      return `${formatQuarterAmount(q.amount)} ${pluralizeUnit(unit || 'piece', q.amount)}`;
    case 'pack':
      return `${formatQuarterAmount(q.amount)} ${pluralizeUnit(unit || 'pack', q.amount)}`;
    case 'weight':
      return q.amount >= 1000 ? `${trimDecimals(q.amount / 1000)} kg` : `${trimDecimals(q.amount)} g`;
    case 'volume':
      return q.amount >= 1000 ? `${trimDecimals(q.amount / 1000)} L` : `${trimDecimals(q.amount)} ml`;
  }
}

/** The inverse, loosely — recovers {measure, amount} from a saved quantity
 *  string. Used to re-open an existing pantry item's amount in the new
 *  control without a migration: "1.5 kg" -> weight/1500, "6 eggs" ->
 *  pieces/6, "¾ bag" -> pack/0.75. Falls back to {pieces, splittable:false}
 *  per the migration rule in the spec's acceptance criteria when nothing
 *  parses. */
export function parseQuantityString(text: string): ItemQuantity {
  const trimmed = text.trim();
  const match = trimmed.match(/^([\d.]+|[¼½¾]|\d+[¼½¾])\s*(.*)$/);
  if (!match) return { measure: 'pieces', splittable: false, amount: 1 };

  const amount = parseLeadingNumber(match[1]);
  const rest = match[2].trim().toLowerCase();
  if (amount === null) return { measure: 'pieces', splittable: false, amount: 1 };

  if (rest === 'kg') return { measure: 'weight', splittable: true, amount: amount * 1000 };
  if (rest === 'g') return { measure: 'weight', splittable: true, amount };
  if (rest === 'l') return { measure: 'volume', splittable: true, amount: amount * 1000 };
  if (rest === 'ml') return { measure: 'volume', splittable: true, amount };
  if (/^(pack|packs|bag|bags|jar|jars)$/.test(rest)) {
    return { measure: 'pack', splittable: true, amount };
  }
  return { measure: 'pieces', splittable: amount % 1 !== 0, amount };
}

function parseLeadingNumber(token: string): number | null {
  const glyphs: Record<string, number> = { '¼': 0.25, '½': 0.5, '¾': 0.75 };
  const mixed = token.match(/^(\d+)([¼½¾])$/);
  if (mixed) return Number(mixed[1]) + glyphs[mixed[2]];
  if (glyphs[token] !== undefined) return glyphs[token];
  const n = Number(token);
  return Number.isFinite(n) ? n : null;
}

// ─── Per-product memory ──────────────────────────────────────────────────
//
// There is no barcode anywhere in this app — recognition is photo-based only
// — so "per product" means per normalised name, on this device. Deliberately
// small: only the measure and splittable flag are remembered, never the
// amount itself, since how much of something you have this time is not a
// property of the product the way how it's measured is.

const PREFS_PREFIX = 'panzi.measurePrefs.';

type MeasurePref = { measure: Measure; splittable: boolean };
type PrefsFile = Record<string, MeasurePref>;

export function normaliseProductName(name: string): string {
  return name.trim().toLowerCase();
}

async function readPrefsFile(uid: string): Promise<PrefsFile> {
  try {
    const raw = await AsyncStorage.getItem(PREFS_PREFIX + uid);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as PrefsFile) : {};
  } catch {
    return {};
  }
}

/** A user's past correction for this product name, if any — checked before
 *  classifyMeasure so a returning product remembers what the user picked
 *  last time rather than re-guessing from scratch. */
export async function loadMeasurePref(uid: string, name: string): Promise<MeasurePref | null> {
  const file = await readPrefsFile(uid);
  return file[normaliseProductName(name)] ?? null;
}

/** Called whenever the user picks a measure from the pill — the correction
 *  that is meant to "stick next time that product is added". A failed write
 *  costs one re-guess next time, not a crash on the review card. */
export async function saveMeasurePref(uid: string, name: string, pref: MeasurePref): Promise<void> {
  const key = normaliseProductName(name);
  if (!key) return;
  try {
    const file = await readPrefsFile(uid);
    file[key] = pref;
    await AsyncStorage.setItem(PREFS_PREFIX + uid, JSON.stringify(file));
  } catch {
    // Best-effort — see saveCachedRecipes in services/recipes.ts for the same
    // reasoning applied to a different cache.
  }
}
