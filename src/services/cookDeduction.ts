// src/services/cookDeduction.ts
//
// Finishing a recipe in cook mode takes its ingredients out of the pantry: 5
// eggs on the shelf and a recipe calling for 2 leaves 3, and an item the
// recipe uses up entirely is removed. Every change is recorded in History as
// Consumed, with how much the recipe took.
//
// Everything here is a plan first and a write second. planDeduction works out
// every change without touching anything, so cook mode can show exactly what
// it took and offer to put it back; applyDeduction and undoDeduction are the
// only two functions that write.
//
// It only ever takes what it can work out honestly. A recipe amount the pantry
// row can't be compared with — "1 cup" of rice against "2 packs", "to taste" —
// is left alone and listed, never guessed at: silently knocking a whole pack
// off for a cupful would leave the shelves wrong in a way nobody would notice
// until they went to use it.

import { Recipe } from './recipes';
import { PantryItem, restorePantryItems, updatePantryItem } from './pantry';
import { removeFromPantry, undoRemovals } from './removals';
import { settleAmount } from './removalAmount';
import { ItemQuantity, formatQuantityString, parseQuantityString, singularWord as singular, unitWordOf } from './quantity';

// ─── Units ────────────────────────────────────────────────────────────────

const GRAMS: Record<string, number> = {
  g: 1, gram: 1, grams: 1, gm: 1, gms: 1,
  kg: 1000, kgs: 1000, kilo: 1000, kilos: 1000, kilogram: 1000, kilograms: 1000,
  oz: 28.35, ounce: 28.35, ounces: 28.35,
  lb: 453.6, lbs: 453.6, pound: 453.6, pounds: 453.6,
};

const MILLILITRES: Record<string, number> = {
  ml: 1, milliliter: 1, milliliters: 1, millilitre: 1, millilitres: 1,
  l: 1000, liter: 1000, liters: 1000, litre: 1000, litres: 1000,
  cup: 240, cups: 240,
  tbsp: 15, tablespoon: 15, tablespoons: 15,
  tsp: 5, teaspoon: 5, teaspoons: 5,
};

const PACK_WORDS = new Set([
  'pack', 'packs', 'packet', 'packets', 'can', 'cans', 'tin', 'tins', 'bottle', 'bottles',
  'jar', 'jars', 'bag', 'bags', 'sachet', 'sachets', 'pouch', 'pouches', 'box', 'boxes',
]);

// Words that count whole things without naming them.
const PIECE_WORDS = new Set([
  '', 'pc', 'pcs', 'piece', 'pieces', 'whole', 'small', 'medium', 'large', 'big',
]);

// Recipe-writing adjectives that say how an ingredient is prepared, not what
// it is — "3 large eggs, beaten" is still eggs.
const DESCRIPTORS = new Set([
  'fresh', 'large', 'small', 'medium', 'big', 'whole', 'chopped', 'minced', 'sliced',
  'diced', 'crushed', 'peeled', 'beaten', 'grated', 'cubed', 'boiled', 'raw', 'ripe',
  'finely', 'thinly', 'roughly', 'optional', 'of', 'and', 'or', 'a', 'the', 'to', 'taste',
]);

const FRACTIONS: Record<string, string> = { '½': ' 1/2', '¼': ' 1/4', '¾': ' 3/4', '⅓': ' 1/3', '⅔': ' 2/3' };

/** "1 1/2 cups", "½ kg", "2-3 eggs", "250g" → a number and the word after it.
 *  null when there's no number at all ("to taste", "a pinch"). A range takes
 *  its low end: taking more than the recipe surely used is the worse error. */
export function parseRecipeAmount(text: string): { value: number; unit: string } | null {
  let s = text.toLowerCase().trim();
  for (const [glyph, ascii] of Object.entries(FRACTIONS)) s = s.split(glyph).join(ascii);
  s = s.trim();
  // A fraction, with or without a whole number before it ("1 1/2", "1/2"),
  // or a plain number ("2", "0.5") — fractions first, or the "1" of "1/2"
  // would be read as a whole number on its own.
  const m =
    s.match(/^(?:(\d+)\s+)?(\d+)\/(\d+)\s*(?:(?:-|–|to)\s*[\d./]+)?\s*([a-z]*)/) ??
    s.match(/^()(\d+(?:\.\d+)?)()\s*(?:(?:-|–|to)\s*[\d./]+)?\s*([a-z]*)/);
  if (!m) return null;
  const [, whole, num, den, unit] = m;
  const value = (whole ? Number(whole) : 0) + (den ? Number(num) / Number(den) : Number(num));
  if (!(value > 0) || !Number.isFinite(value)) return null;
  return { value, unit: unit ?? '' };
}

// ─── Names ────────────────────────────────────────────────────────────────

function tokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .split(/[^a-z]+/)
    .filter((w) => w && !DESCRIPTORS.has(w))
    .map(singular);
}

/**
 * How well a pantry item's name matches an ingredient's: 3 identical, 2 a
 * close match, 0 none.
 *
 * The pantry name inside the ingredient's ("rice" for "jasmine rice") is
 * always a match. The other way round ("chicken" for a pantry "chicken
 * broth") is only trusted when the recipe itself listed that pantry item as
 * one it uses — otherwise cooking chicken would quietly empty the broth.
 */
function matchScore(ingredient: string, itemName: string, usedByRecipe: boolean): number {
  const a = tokens(ingredient);
  const b = tokens(itemName);
  if (a.length === 0 || b.length === 0) return 0;
  if (a.join(' ') === b.join(' ')) return 3;
  if (b.every((w) => a.includes(w))) return 2;
  if (usedByRecipe && a.every((w) => b.includes(w))) return 2;
  return 0;
}

// ─── Plan ─────────────────────────────────────────────────────────────────

export type DeductionChange = {
  item: PantryItem;
  before: string;
  /** null when the recipe uses it all and the item is removed. */
  after: string | null;
  /** What the recipe took, in the item's own measure — the History row's amount. */
  removed: string;
};

export type DeductionPlan = {
  changes: DeductionChange[];
  /** Ingredients that match something on the shelf but couldn't be
   *  subtracted, with why — shown so the user can adjust them by hand. */
  skipped: { ingredient: string; reason: string }[];
};

type Working = { item: PantryItem; quantity: ItemQuantity; unitWord: string };

/** How much of `w`'s own measure an ingredient amount comes to, or a reason
 *  it can't be expressed in that measure. */
function amountInPantryMeasure(
  w: Working,
  amount: { value: number; unit: string },
  ingredientName: string,
): number | string {
  const unit = amount.unit;
  switch (w.quantity.measure) {
    case 'weight':
      if (unit in GRAMS) return amount.value * GRAMS[unit];
      // Kitchen measures by volume against a weighed item, at water's
      // density — close for most cooking, and far better than skipping rice.
      if (unit in MILLILITRES) return amount.value * MILLILITRES[unit];
      return `recipe says "${`${amount.value} ${unit}`.trim()}", pantry is by weight`;
    case 'volume':
      if (unit in MILLILITRES) return amount.value * MILLILITRES[unit];
      if (unit in GRAMS) return amount.value * GRAMS[unit];
      return `recipe amount isn't a volume`;
    case 'pack':
      if (PACK_WORDS.has(unit) || unit === '') return amount.value;
      return `recipe says ${unit}, pantry counts packs`;
    case 'pieces': {
      const u = singular(unit);
      const counts =
        PIECE_WORDS.has(unit) ||
        u === w.unitWord ||
        // "2 eggs" of "eggs": the unit word is the ingredient itself.
        tokens(ingredientName).includes(u);
      if (counts) return amount.value;
      return `recipe says ${unit}, pantry counts pieces`;
    }
  }
}

/** Rounds what's left the way the pantry row stores it, and says whether
 *  anything real is left at all. */
function settle(q: ItemQuantity): ItemQuantity | null {
  if (q.measure === 'weight' || q.measure === 'volume') {
    const amount = Math.round(q.amount);
    return amount >= 1 ? { ...q, amount } : null;
  }
  // Packs and pieces are stored in quarters.
  const amount = Math.round(q.amount * 4) / 4;
  return amount > 0 ? { ...q, amount, splittable: q.splittable || amount % 1 !== 0 } : null;
}

export function planDeduction(recipe: Recipe, pantry: PantryItem[]): DeductionPlan {
  const working = new Map<string, Working>();
  const skipped: DeductionPlan['skipped'] = [];

  const used = new Set((recipe.pantryUsed ?? []).map((n) => n.trim().toLowerCase()));

  for (const ingredient of recipe.ingredients) {
    // A nice-to-have may well not have gone in; only required ones are taken.
    if (ingredient.optional) continue;
    // Best-matching rows first, soonest-expiring first among equals, so the
    // eggs that go off first are the ones that get cooked.
    const matches = pantry
      .map((item) => ({
        item,
        score: matchScore(ingredient.name, item.name, used.has(item.name.trim().toLowerCase())),
      }))
      .filter((m) => m.score > 0)
      .sort(
        (x, y) =>
          y.score - x.score ||
          (x.item.expiryDate ?? '9999').localeCompare(y.item.expiryDate ?? '9999'),
      )
      .filter((m, _, all) => m.score === all[0].score)
      .map((m) => m.item);
    if (matches.length === 0) continue; // Not in the pantry — nothing to take.

    const amount = parseRecipeAmount(ingredient.amount);
    if (!amount) {
      skipped.push({ ingredient: ingredient.name, reason: `no amount given ("${ingredient.amount || 'to taste'}")` });
      continue;
    }

    let remaining: number | null = null;
    let reason: string | null = null;
    for (const item of matches) {
      // A row with no number in it ("a bit", "") can't be subtracted from.
      if (!/^[\d.¼½¾]/.test(item.quantity.trim())) {
        reason = `pantry amount for ${item.name} isn't a number`;
        continue;
      }
      const w =
        working.get(item.id) ??
        { item, quantity: parseQuantityString(item.quantity), unitWord: unitWordOf(item.quantity) };
      const needed: number | string = remaining ?? amountInPantryMeasure(w, amount, ingredient.name);
      if (typeof needed === 'string') {
        reason = needed;
        continue;
      }
      const take = Math.min(needed, w.quantity.amount);
      working.set(item.id, { ...w, quantity: { ...w.quantity, amount: w.quantity.amount - take } });
      remaining = needed - take;
      reason = null;
      // Spill onto the next matching row only when this one ran out.
      if (remaining <= 0) break;
    }
    if (reason && remaining === null) skipped.push({ ingredient: ingredient.name, reason });
  }

  const changes: DeductionChange[] = [];
  for (const w of working.values()) {
    const left = settle(w.quantity);
    const after = left ? formatQuantityString(left, w.unitWord) : null;
    if (after === w.item.quantity) continue;
    const start = parseQuantityString(w.item.quantity);
    const removed =
      after === null
        ? w.item.quantity
        : formatQuantityString(
            { ...start, amount: settleAmount(start.measure, start.amount - left!.amount) },
            w.unitWord,
          );
    changes.push({ item: w.item, before: w.item.quantity, after, removed });
  }
  return { changes, skipped };
}

// ─── Writes ───────────────────────────────────────────────────────────────

/** Takes every change out in one removal, recorded as Consumed — cooked with.
 *  Returns the removal ids, which undoDeduction needs. */
export async function applyDeduction(plan: DeductionPlan): Promise<string[]> {
  return removeFromPantry(
    plan.changes.map((c) => ({ id: c.item.id, removed: c.removed, remaining: c.after })),
    'consumed',
  );
}

/** Puts every change back: amounts restored, removed rows re-added whole, and
 *  only this cook's History rows dropped. */
export async function undoDeduction(plan: DeductionPlan, removalIds: string[]): Promise<void> {
  const restored = plan.changes.filter((c) => c.after === null).map((c) => c.item);
  await Promise.all([
    restorePantryItems(restored),
    undoRemovals(removalIds),
    ...plan.changes
      .filter((c) => c.after !== null)
      .map((c) => updatePantryItem(c.item.id, { quantity: c.before })),
  ]);
}

/** One line per change, for the summary shown when cooking is finished. */
export function describeDeduction(plan: DeductionPlan): string {
  const lines = plan.changes.map((c) =>
    c.after === null ? `• ${c.item.name}: used up, removed` : `• ${c.item.name}: ${c.before} → ${c.after}`,
  );
  if (plan.skipped.length > 0) {
    lines.push('', 'Left as is — adjust by hand if you used some:');
    for (const s of plan.skipped) lines.push(`• ${s.ingredient} (${s.reason})`);
  }
  return lines.join('\n');
}
