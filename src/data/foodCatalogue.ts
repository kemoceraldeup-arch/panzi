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
export const FALLBACK_LOCATION = 'Cupboard';

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
  { name: 'Onions', category: 'Fruit & veg', location: 'Cupboard', unit: '' },
  { name: 'Garlic', category: 'Fruit & veg', location: 'Cupboard', unit: 'bulb' },
  { name: 'Potatoes', category: 'Fruit & veg', location: 'Cupboard', unit: 'kg' },
  { name: 'Bananas', category: 'Fruit & veg', location: 'Counter', unit: '' },
  { name: 'Apples', category: 'Fruit & veg', location: 'Counter', unit: '' },
  { name: 'Lemons', category: 'Fruit & veg', location: 'Counter', unit: '' },
  { name: 'Avocado', category: 'Fruit & veg', location: 'Counter', unit: '' },
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
  { name: 'Bread', category: 'Bakery', location: 'Bread bin', unit: 'loaf' },
  { name: 'Sourdough', category: 'Bakery', location: 'Bread bin', unit: 'loaf' },
  { name: 'Bagels', category: 'Bakery', location: 'Bread bin', unit: '' },
  { name: 'Tortilla wraps', category: 'Bakery', location: 'Cupboard', unit: '' },

  // Grains & pasta
  { name: 'Pasta', category: 'Grains & pasta', location: 'Cupboard', unit: 'g' },
  { name: 'Spaghetti', category: 'Grains & pasta', location: 'Cupboard', unit: 'g' },
  { name: 'Rice', category: 'Grains & pasta', location: 'Cupboard', unit: 'kg' },
  { name: 'Noodles', category: 'Grains & pasta', location: 'Cupboard', unit: 'g' },
  { name: 'Oats', category: 'Grains & pasta', location: 'Cupboard', unit: 'g' },
  { name: 'Couscous', category: 'Grains & pasta', location: 'Cupboard', unit: 'g' },

  // Tins & jars
  { name: 'Chopped tomatoes', category: 'Tins & jars', location: 'Cupboard', unit: 'tin' },
  { name: 'Chickpeas', category: 'Tins & jars', location: 'Cupboard', unit: 'tin' },
  { name: 'Black beans', category: 'Tins & jars', location: 'Cupboard', unit: 'tin' },
  { name: 'Coconut milk', category: 'Tins & jars', location: 'Cupboard', unit: 'tin' },
  { name: 'Tuna', category: 'Tins & jars', location: 'Cupboard', unit: 'tin' },
  { name: 'Peanut butter', category: 'Tins & jars', location: 'Cupboard', unit: 'jar' },
  { name: 'Olive oil', category: 'Tins & jars', location: 'Cupboard', unit: 'ml' },

  // Frozen
  { name: 'Frozen peas', category: 'Frozen', location: 'Freezer', unit: 'g' },
  { name: 'Frozen berries', category: 'Frozen', location: 'Freezer', unit: 'g' },
  { name: 'Ice cream', category: 'Frozen', location: 'Freezer', unit: 'ml' },
  { name: 'Fish fingers', category: 'Frozen', location: 'Freezer', unit: '' },

  // Herbs & spices
  { name: 'Basil', category: 'Herbs & spices', location: 'Fridge', unit: '' },
  { name: 'Coriander', category: 'Herbs & spices', location: 'Fridge', unit: '' },
  { name: 'Paprika', category: 'Herbs & spices', location: 'Cupboard', unit: '' },
  { name: 'Cumin', category: 'Herbs & spices', location: 'Cupboard', unit: '' },

  // Drinks
  { name: 'Orange juice', category: 'Drinks', location: 'Fridge', unit: 'L' },
  { name: 'Coffee', category: 'Drinks', location: 'Cupboard', unit: 'g' },
  { name: 'Tea', category: 'Drinks', location: 'Cupboard', unit: '' },

  // Snacks
  { name: 'Crisps', category: 'Snacks', location: 'Cupboard', unit: '' },
  { name: 'Dark chocolate', category: 'Snacks', location: 'Cupboard', unit: 'g' },
  { name: 'Biscuits', category: 'Snacks', location: 'Cupboard', unit: '' },
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

/** Exact (case-insensitive) catalogue hit, so a typed name still picks up a
 *  category even when the user never tapped a chip. */
export function lookupFood(name: string): FoodEntry | null {
  const q = name.trim().toLowerCase();
  return FOOD_CATALOGUE.find((e) => e.name.toLowerCase() === q) ?? null;
}
