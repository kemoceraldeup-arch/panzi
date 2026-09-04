// src/data/foodCatalogue.ts
//
// The suggestion list behind the "What is it" field on the manual/fix sheet.
//
// The scan handoff assumes this exists: typing "Butter" offers "Butter,
// salted" / "Butter, unsalted" / "Buttermilk", and picking one carries its
// category and default storage along — which is how the form gets a category
// without ever showing a category field.
//
// Deliberately small and hand-written rather than exhaustive. It only has to
// cover what people actually type first; anything unmatched still saves, using
// FALLBACK_CATEGORY.

import { FOOD_CATEGORIES, STORAGE_LOCATIONS } from '../services/pantry';

export type FoodEntry = {
  name: string;
  category: (typeof FOOD_CATEGORIES)[number];
  location: (typeof STORAGE_LOCATIONS)[number];
  /** Prefilled into the quantity stepper. '' for countable things. */
  unit: string;
};

// Where an unmatched, free-typed name lands. "Other" would be more honest but
// puts the item in a category the List screen has no chip for; Tins & jars is
// the closest thing to a general cupboard bucket.
export const FALLBACK_CATEGORY = 'Tins & jars';
export const FALLBACK_LOCATION = 'Cabinet';

// The subset of `unit` values that mean "portioned out by weight or volume,"
// not just "has some unit word." A tin, a jar, a loaf, a block, a bulb are
// each still one whole thing to the person buying them — only these five
// are genuinely divisible into a fraction of themselves. A whitelist rather
// than excluding the container words: the catalogue is small and
// hand-written, so a new entry with a measured unit not yet in this set
// simply falls back to the whole-number stepper until this list is updated
// — the safe direction to fail in.
const FRACTIONAL_UNITS = new Set(['kg', 'g', 'L', 'ml', 'oz', 'lb']);

export function isFractionalUnit(unit: string): boolean {
  return FRACTIONAL_UNITS.has(unit);
}

export const FOOD_CATALOGUE: FoodEntry[] = [
  // Dairy & eggs
  { name: 'Milk', category: 'Dairy & eggs', location: 'Fridge', unit: 'L' },
  { name: 'Semi-skimmed milk', category: 'Dairy & eggs', location: 'Fridge', unit: 'L' },
  { name: 'Butter, salted', category: 'Dairy & eggs', location: 'Fridge', unit: 'block' },
  { name: 'Butter, unsalted', category: 'Dairy & eggs', location: 'Fridge', unit: 'block' },
  { name: 'Buttermilk', category: 'Dairy & eggs', location: 'Fridge', unit: 'ml' },
  { name: 'Cheddar', category: 'Dairy & eggs', location: 'Fridge', unit: 'g' },
  { name: 'Mozzarella', category: 'Dairy & eggs', location: 'Fridge', unit: 'g' },
  { name: 'Parmesan', category: 'Dairy & eggs', location: 'Fridge', unit: 'g' },
  { name: 'Greek yoghurt', category: 'Dairy & eggs', location: 'Fridge', unit: 'g' },
  { name: 'Yoghurt', category: 'Dairy & eggs', location: 'Fridge', unit: 'g' },
  { name: 'Cream', category: 'Dairy & eggs', location: 'Fridge', unit: 'ml' },
  { name: 'Eggs', category: 'Dairy & eggs', location: 'Fridge', unit: '' },

  // Fruit & veg
  { name: 'Spinach', category: 'Fruit & veg', location: 'Fridge', unit: 'g' },
  { name: 'Salad leaves', category: 'Fruit & veg', location: 'Fridge', unit: 'g' },
  { name: 'Tomatoes', category: 'Fruit & veg', location: 'Fridge', unit: '' },
  { name: 'Cucumber', category: 'Fruit & veg', location: 'Fridge', unit: '' },
  { name: 'Carrots', category: 'Fruit & veg', location: 'Fridge', unit: 'g' },
  { name: 'Broccoli', category: 'Fruit & veg', location: 'Fridge', unit: '' },
  { name: 'Peppers', category: 'Fruit & veg', location: 'Fridge', unit: '' },
  { name: 'Mushrooms', category: 'Fruit & veg', location: 'Fridge', unit: 'g' },
  { name: 'Onions', category: 'Fruit & veg', location: 'Cabinet', unit: '' },
  { name: 'Garlic', category: 'Fruit & veg', location: 'Cabinet', unit: 'bulb' },
  { name: 'Potatoes', category: 'Fruit & veg', location: 'Cabinet', unit: 'kg' },
  { name: 'Bananas', category: 'Fruit & veg', location: 'Kitchen Shelf', unit: '' },
  { name: 'Apples', category: 'Fruit & veg', location: 'Kitchen Shelf', unit: '' },
  { name: 'Lemons', category: 'Fruit & veg', location: 'Kitchen Shelf', unit: '' },
  { name: 'Avocado', category: 'Fruit & veg', location: 'Kitchen Shelf', unit: '' },
  { name: 'Berries', category: 'Fruit & veg', location: 'Fridge', unit: 'g' },

  // Meat & fish
  { name: 'Chicken breast', category: 'Meat & fish', location: 'Fridge', unit: 'g' },
  { name: 'Chicken thighs', category: 'Meat & fish', location: 'Fridge', unit: 'g' },
  { name: 'Mince', category: 'Meat & fish', location: 'Fridge', unit: 'g' },
  { name: 'Bacon', category: 'Meat & fish', location: 'Fridge', unit: 'g' },
  { name: 'Sausages', category: 'Meat & fish', location: 'Fridge', unit: '' },
  { name: 'Salmon', category: 'Meat & fish', location: 'Fridge', unit: 'g' },
  { name: 'Prawns', category: 'Meat & fish', location: 'Freezer', unit: 'g' },

  // Bakery
  { name: 'Bread', category: 'Bakery', location: 'Bread Shelf', unit: 'loaf' },
  { name: 'Sourdough', category: 'Bakery', location: 'Bread Shelf', unit: 'loaf' },
  { name: 'Bagels', category: 'Bakery', location: 'Bread Shelf', unit: '' },
  { name: 'Tortilla wraps', category: 'Bakery', location: 'Cabinet', unit: '' },

  // Grains & pasta
  { name: 'Pasta', category: 'Grains & pasta', location: 'Cabinet', unit: 'g' },
  { name: 'Spaghetti', category: 'Grains & pasta', location: 'Cabinet', unit: 'g' },
  { name: 'Rice', category: 'Grains & pasta', location: 'Cabinet', unit: 'kg' },
  { name: 'Noodles', category: 'Grains & pasta', location: 'Cabinet', unit: 'g' },
  { name: 'Oats', category: 'Grains & pasta', location: 'Cabinet', unit: 'g' },
  { name: 'Couscous', category: 'Grains & pasta', location: 'Cabinet', unit: 'g' },

  // Tins & jars
  { name: 'Chopped tomatoes', category: 'Tins & jars', location: 'Cabinet', unit: 'tin' },
  { name: 'Chickpeas', category: 'Tins & jars', location: 'Cabinet', unit: 'tin' },
  { name: 'Black beans', category: 'Tins & jars', location: 'Cabinet', unit: 'tin' },
  { name: 'Coconut milk', category: 'Tins & jars', location: 'Cabinet', unit: 'tin' },
  { name: 'Tuna', category: 'Tins & jars', location: 'Cabinet', unit: 'tin' },
  { name: 'Peanut butter', category: 'Tins & jars', location: 'Cabinet', unit: 'jar' },
  { name: 'Olive oil', category: 'Tins & jars', location: 'Cabinet', unit: 'ml' },

  // Frozen
  { name: 'Frozen peas', category: 'Frozen', location: 'Freezer', unit: 'g' },
  { name: 'Frozen berries', category: 'Frozen', location: 'Freezer', unit: 'g' },
  { name: 'Ice cream', category: 'Frozen', location: 'Freezer', unit: 'ml' },
  { name: 'Fish fingers', category: 'Frozen', location: 'Freezer', unit: '' },

  // Herbs & spices
  { name: 'Basil', category: 'Herbs & spices', location: 'Fridge', unit: '' },
  { name: 'Coriander', category: 'Herbs & spices', location: 'Fridge', unit: '' },
  { name: 'Paprika', category: 'Herbs & spices', location: 'Cabinet', unit: '' },
  { name: 'Cumin', category: 'Herbs & spices', location: 'Cabinet', unit: '' },

  // Drinks
  { name: 'Orange juice', category: 'Drinks', location: 'Fridge', unit: 'L' },
  { name: 'Coffee', category: 'Drinks', location: 'Cabinet', unit: 'g' },
  { name: 'Tea', category: 'Drinks', location: 'Cabinet', unit: '' },

  // Snacks
  { name: 'Crisps', category: 'Snacks', location: 'Cabinet', unit: '' },
  { name: 'Dark chocolate', category: 'Snacks', location: 'Cabinet', unit: 'g' },
  { name: 'Biscuits', category: 'Snacks', location: 'Cabinet', unit: '' },
];

/**
 * Suggestions for what's been typed so far. Prefix matches rank above
 * mid-word ones, so typing "but" offers the butters before "Peanut butter" —
 * the chips are a shortcut for what you're already writing, not a search.
 */
export function suggestFoods(query: string, limit = 3): FoodEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const starts: FoodEntry[] = [];
  const contains: FoodEntry[] = [];
  for (const entry of FOOD_CATALOGUE) {
    const name = entry.name.toLowerCase();
    if (name.startsWith(q)) starts.push(entry);
    else if (name.includes(q)) contains.push(entry);
  }
  return [...starts, ...contains].slice(0, limit);
}

/**
 * Catalogue hit for a typed name, so it still picks up a category even when
 * the user never tapped a suggestion chip.
 *
 * Exact match first, then a whole-word match in either direction — "Mature
 * cheddar" finds "Cheddar" (the catalogue name is a whole word inside the
 * typed one), and "Milk" alone still finds "Milk" (the typed name is a
 * whole word inside a longer catalogue entry, for the reverse case). Word
 * boundaries only, never a bare substring: "Cheddar" must not match inside
 * "Cheddary snack mix" and "Egg" must not match inside "Eggplant" — both
 * would misclassify a name that only superficially resembles a catalogue
 * entry. When more than one entry matches, the longest catalogue name wins,
 * since it's the more specific read ("Greek yoghurt" over "Yoghurt" for a
 * name containing both).
 *
 * This is the fix for a real bug: a hand-typed "Mature cheddar" used to
 * fall through to no match at all (exact-only), which left the row on
 * whatever default category a blank candidate starts with — Snacks,
 * classifying to FoodClass 'condiment' with a year-plus shelf life, for a
 * block of cheese. The estimate engine's own sanity clamp (shelfLife.ts)
 * catches the same class of bug from the other side; this fix is the
 * classification actually landing right in the first place.
 */
export function lookupFood(name: string): FoodEntry | null {
  const q = name.trim().toLowerCase();
  if (!q) return null;

  const exact = FOOD_CATALOGUE.find((e) => e.name.toLowerCase() === q);
  if (exact) return exact;

  let best: FoodEntry | null = null;
  for (const entry of FOOD_CATALOGUE) {
    const entryName = entry.name.toLowerCase();
    const matches = containsWholeWord(q, entryName) || containsWholeWord(entryName, q);
    if (matches && (!best || entryName.length > best.name.toLowerCase().length)) {
      best = entry;
    }
  }
  return best;
}

/** True when `word` (a catalogue name, possibly multi-word — "Greek
 *  yoghurt") appears inside `text` on whole-word boundaries: not preceded
 *  or followed by another letter. Comparing whole catalogue names rather
 *  than splitting into single words is what stops "Milk" matching inside
 *  a hypothetical "Buttermilk" entry's own text — it only matches a
 *  complete name-length token, not a fragment of one. */
function containsWholeWord(text: string, word: string): boolean {
  const index = text.indexOf(word);
  if (index === -1) return false;
  const before = text[index - 1];
  const after = text[index + word.length];
  const isLetter = (c: string | undefined) => !!c && /[a-z]/i.test(c);
  return !isLetter(before) && !isLetter(after);
}
