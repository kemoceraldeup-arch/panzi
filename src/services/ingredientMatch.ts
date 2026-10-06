// src/services/ingredientMatch.ts
//
// Whether something on the pantry shelf counts as a recipe ingredient.
//
// Exact names alone left the checklist empty for anyone who shops in general
// terms: a pantry "Chicken" never ticked "chicken thighs and legs", and "Beef"
// never ticked "beef tenderloin", though either is what the cook would reach
// for. The rule here is the one a person applies reading the list:
//
//   - the general covers the specific — "chicken" covers "chicken thighs",
//     "beef" covers "beef sirloin, thinly sliced", "pork" covers "ground pork";
//   - the specific covers the general — "chicken thighs" covers "chicken";
//   - but never a product made *from* the food — "chicken" is not "chicken
//     broth", "beef" is not "beef tapa", "milk" is not "coconut milk".
//
// Meat and fish go further: any cut covers any other cut of the same animal.
// Chicken thighs on the shelf tick "chicken pieces" and "chicken breast" —
// for deciding whether a dish is cookable, chicken is chicken. Products made
// from the animal (liver, broth, tapa) still don't count, anywhere in the
// name. Fish is the exception: each named fish is its own animal, so milkfish
// never ticks tilapia, though a plain "fish" on either side matches any. Everything else keeps the lead-in rule above, since a shared first
// word means nothing for "green beans" and "green papaya".
//
// This decides display only — the have/need split and the counts on the
// cards. What Cook Mode deducts is still the server-checked pantryUsed list
// (see matchPantryUsed in recipes.ts), where a loose match would delete the
// wrong groceries.

/** Words that, right after a food's name, turn it into a different product.
 *  "chicken" + "broth" is something else entirely. */
const PRODUCT_WORDS = new Set([
  'stock', 'broth', 'bouillon', 'cube', 'granule', 'powder', 'sauce', 'paste',
  'ketchup', 'extract', 'essence', 'flavor', 'flavour', 'flavoring', 'seasoning',
  'mix', 'juice', 'vinegar', 'wine', 'noodle', 'flour', 'starch', 'oil', 'milk',
  'cream', 'butter', 'water', 'chip', 'cracker', 'bread', 'cake', 'syrup', 'jam',
  'jelly', 'spread', 'soup', 'base', 'sausage', 'ham', 'bacon', 'jerky', 'floss',
  'tapa', 'tocino', 'longganisa', 'nugget', 'hotdog', 'rind', 'skin', 'liver',
  'tripe', 'blood', 'gizzard', 'heart', 'leaf', 'rice', 'wrapper', 'dough',
  'halaya', 'chicharon', 'chicharron',
]);

/** Leading words that describe how a food is cut, kept or sized rather than
 *  what it is — dropped so "ground pork" reads as pork and "boneless chicken
 *  breast" as chicken breast. Colours are deliberately absent: a green onion
 *  is not an onion. */
const DESCRIPTORS = new Set([
  'fresh', 'frozen', 'raw', 'boneless', 'skinless', 'lean', 'ground', 'minced',
  'sliced', 'diced', 'chopped', 'cubed', 'whole', 'large', 'small', 'medium',
  'organic', 'uncooked', 'plain', 'regular', 'native', 'local', 'extra',
]);

/** Cuts and kinds a recipe often names without the animal they come from —
 *  "oxtail" is beef, "liempo" is pork, "bangus" is fish. Read as though the
 *  animal were written in front, so a pantry "Beef" covers "oxtail" exactly
 *  as it covers "beef oxtail". Only for a cut standing on its own: "pork
 *  tenderloin" already says what it is. */
const IMPLIED_ANIMAL: Record<string, string> = {
  oxtail: 'beef',
  sirloin: 'beef',
  tenderloin: 'beef',
  brisket: 'beef',
  chuck: 'beef',
  flank: 'beef',
  ribeye: 'beef',
  bulalo: 'beef',
  liempo: 'pork',
  kasim: 'pork',
  pigue: 'pork',
  pata: 'pork',
  belly: 'pork',
  thigh: 'chicken',
  breast: 'chicken',
  drumstick: 'chicken',
  wing: 'chicken',
  bangus: 'fish',
  milkfish: 'fish',
  tilapia: 'fish',
  galunggong: 'fish',
  salmon: 'fish',
  tuna: 'fish',
  lapulapu: 'fish',
  maya: 'fish',
};

/** One fish under two names — read as the second, so they match each other
 *  and nothing else. */
const SAME_FOOD: Record<string, string> = {
  bangus: 'milkfish',
};

const FISH_SPECIES = new Set(
  Object.keys(IMPLIED_ANIMAL).filter((word) => IMPLIED_ANIMAL[word] === 'fish')
);

/** Plural to singular, enough for food words — both sides go through it, so
 *  it only has to be consistent, not correct English. */
function singular(word: string): string {
  // "-us" is a singular ending, not a plural: bangus, asparagus, octopus.
  if (word.length <= 3 || word.endsWith('ss') || word.endsWith('us')) return word;
  if (word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.endsWith('oes')) return word.slice(0, -2);
  if (/(ch|sh|x)es$/.test(word)) return word.slice(0, -2);
  if (word.endsWith('s')) return word.slice(0, -1);
  return word;
}

function tokens(phrase: string): string[] {
  const words = phrase
    // One fish, however it's spelled — split in two, "milk" would read as
    // a product word and the fish would never match.
    .replace(/\bmilk\s+fish\b/g, 'milkfish')
    .split(/[^a-z]+/)
    .filter(Boolean)
    .map(singular);
  let start = 0;
  while (start < words.length - 1 && DESCRIPTORS.has(words[start])) start++;
  const food = words.slice(start);
  if (SAME_FOOD[food[0]]) food[0] = SAME_FOOD[food[0]];
  const animal = IMPLIED_ANIMAL[food[0]];
  return animal ? [animal, ...food] : food;
}

/**
 * An ingredient line as the separate foods it names. Drops the prep notes
 * after a comma and anything in brackets, then splits on "or"/"and" — so
 * "chicken or pork, sliced" offers both, and "chicken thighs and legs" offers
 * "chicken thighs" (which is what a pantry "Chicken" has to cover).
 */
function ingredientOptions(name: string): string[][] {
  const core = name
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .split(',')[0];
  return core
    .split(/\b(?:or|and)\b|&|\//)
    .map(tokens)
    .filter((option) => option.length > 0);
}

/** True when `shorter` leads `longer` and what follows doesn't turn it into
 *  another product. */
function leadsInto(shorter: string[], longer: string[]): boolean {
  if (shorter.length > longer.length) return false;
  for (let i = 0; i < shorter.length; i++) if (shorter[i] !== longer[i]) return false;
  const next = longer[shorter.length];
  return next === undefined || !PRODUCT_WORDS.has(next);
}

/** The animals whose cuts all count as one another — see the header. */
const PROTEINS = new Set([
  'chicken', 'beef', 'pork', 'fish', 'shrimp', 'prawn', 'lamb', 'goat', 'duck',
  'turkey', 'squid', 'crab',
]);

/** Both name the same animal, and neither is a product made from it. The
 *  animal can sit anywhere in the name — "bone-in chicken thighs". */
function sameProtein(a: string[], b: string[]): boolean {
  const animal = a.find((word) => PROTEINS.has(word));
  if (!animal || !b.includes(animal)) return false;
  // "Fish" is a family, not one animal: a named fish is only itself. Milkfish
  // on the shelf is not the tilapia a recipe asks for — but a plain "fish"
  // on either side still stands for any of them.
  if (animal === 'fish') {
    const speciesA = a.find((word) => FISH_SPECIES.has(word));
    const speciesB = b.find((word) => FISH_SPECIES.has(word));
    if (speciesA && speciesB && speciesA !== speciesB) return false;
  }
  return ![...a, ...b].some((word) => PRODUCT_WORDS.has(word));
}

/** Whether a pantry item by this name counts as having this ingredient. */
export function pantryCovers(pantryName: string, ingredientName: string): boolean {
  const pantry = tokens(pantryName.toLowerCase().replace(/\([^)]*\)/g, ' '));
  if (pantry.length === 0) return false;
  return ingredientOptions(ingredientName).some(
    (option) =>
      leadsInto(pantry, option) || leadsInto(option, pantry) || sameProtein(pantry, option)
  );
}

/** Whether anything on the shelf counts as this ingredient. */
export function pantryHasIngredient(ingredientName: string, pantryNames: string[]): boolean {
  return pantryNames.some((name) => pantryCovers(name, ingredientName));
}
