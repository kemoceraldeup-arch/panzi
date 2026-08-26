// src/utils/diet.ts
//
// The diet rules, client side.
//
// ─────────────────────────────────────────────────────────────────────────
// THIS DUPLICATES server/src/routes/diets.ts. The two must stay in step.
// ─────────────────────────────────────────────────────────────────────────
//
// The server owns enforcement — that is where a suggestion is checked before it
// reaches anyone. This copy exists for two jobs the server cannot do:
//
//   1. Styling the diet chips, so a rule that is genuinely checked looks
//      different from one Panzi can only aim for.
//   2. Marking a saved recipe that no longer fits, which happens on a screen
//      the server is never asked about.
//
// Sharing it properly would mean a route, a fetch, a cache and a failure mode,
// for a table that changes about twice a year. Same standing arrangement as
// DISH_LOOKS in theme/dishLooks.ts and DISH_KEYS in theme/dishPhotos.ts.

/** Everything the checks below actually read. Deliberately narrower than
 *  `Recipe` so a canary dish, a saved recipe and a live suggestion can all be
 *  passed without inventing fields nobody looks at. */
type Dish = {
  title: string;
  ingredients: { name: string }[];
  steps: string[];
};

function escape(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Singular and plural of one term. Word boundaries are exact, so a list entry
 *  of "egg" would otherwise miss an ingredient called "Eggs". */
function variants(term: string): string[] {
  const t = term.toLowerCase();
  if (t.endsWith('s')) return [t, t.slice(0, -1)];
  return [t, `${t}s`, `${t}es`];
}

/** Whole-word matching, not substring — see the note in the server copy. A
 *  substring match on "ham" would strike out "hamburger". */
function mentions(haystack: string, terms: string[]): string | null {
  for (const term of terms) {
    const alternatives = variants(term).map(escape).join('|');
    if (new RegExp(`\\b(?:${alternatives})\\b`, 'i').test(haystack)) return term;
  }
  return null;
}

const PORK = [
  'pork', 'baboy', 'bacon', 'ham', 'gammon', 'lechon', 'lechon kawali',
  'crispy pata', 'sisig', 'longganisa', 'tocino', 'chorizo', 'salami',
  'pepperoni', 'prosciutto', 'lard', 'dinuguan',
];

const BEEF = ['beef', 'baka', 'steak', 'veal', 'oxtail', 'bulalo', 'tapa', 'corned beef'];

const OTHER_MEAT = [
  'chicken', 'manok', 'turkey', 'duck', 'itik', 'lamb', 'mutton', 'goat',
  'kambing', 'liver', 'atay', 'chicharon', 'meat', 'karne',
];

const SEAFOOD = [
  'fish', 'isda', 'bangus', 'tilapia', 'galunggong', 'tuna', 'salmon',
  'sardines', 'anchovies', 'dilis', 'tuyo', 'daing', 'shrimp', 'hipon',
  'prawn', 'crab', 'alimasag', 'alimango', 'squid', 'pusit', 'clams',
  'tahong', 'mussels', 'oyster sauce', 'fish sauce', 'patis', 'bagoong',
];

const SHELLFISH = [
  'shrimp', 'hipon', 'prawn', 'crab', 'alimasag', 'alimango', 'squid',
  'pusit', 'clams', 'tahong', 'mussels', 'oyster', 'shellfish',
];

const DAIRY = [
  'milk', 'gatas', 'cheese', 'keso', 'butter', 'mantikilya', 'cream',
  'yoghurt', 'yogurt', 'condensed milk', 'evaporated milk',
];

// Coconut milk contains "milk" as a whole word, so it has to be removed from
// the text before matching rather than relied on to miss.
const DAIRY_EXCEPTIONS = ['coconut milk', 'gata', 'coconut cream', 'kakang gata'];

// Drinking alcohol only. Vinegar is deliberately absent — suka is the backbone
// of adobo, paksiw and kinilaw, and "wine" alone would catch "wine vinegar".
const ALCOHOL = [
  'rice wine', 'cooking wine', 'red wine', 'white wine', 'shaoxing', 'mirin',
  'sake', 'beer', 'lambanog', 'rum', 'brandy', 'whisky', 'whiskey', 'vodka',
  'gin', 'sherry', 'liqueur',
];

const GELATIN = ['gelatin', 'gelatine'];

const NUTS = [
  'peanut', 'peanuts', 'mani', 'almond', 'almonds', 'cashew', 'cashews',
  'kasoy', 'walnut', 'walnuts', 'pistachio', 'hazelnut', 'pecan', 'macadamia',
];

const GLUTEN = [
  'wheat', 'flour', 'harina', 'bread', 'tinapay', 'pandesal', 'pasta',
  'spaghetti', 'noodles', 'pancit canton', 'miki', 'lumpia wrapper',
  'soy sauce', 'toyo', 'barley', 'rye', 'semolina', 'breadcrumbs',
];

type DietRule = {
  forbids: string[];
  /** Fine apart, forbidden together. Kosher's meat-and-dairy, only. */
  neverTogether?: [string[], string[]];
};

const DIET_RULES: Record<string, DietRule> = {
  halal: { forbids: [...PORK, ...ALCOHOL, ...GELATIN, 'blood'] },
  kosher: {
    forbids: [...PORK, ...SHELLFISH, ...GELATIN, 'blood'],
    neverTogether: [[...BEEF, ...OTHER_MEAT], DAIRY],
  },
  'no pork': { forbids: PORK },
  'no beef': { forbids: BEEF },
  vegetarian: { forbids: [...PORK, ...BEEF, ...OTHER_MEAT, ...SEAFOOD, ...GELATIN] },
  vegan: {
    forbids: [
      ...PORK, ...BEEF, ...OTHER_MEAT, ...SEAFOOD, ...DAIRY, ...GELATIN,
      'egg', 'itlog', 'honey', 'pulot',
    ],
  },
  pescatarian: { forbids: [...PORK, ...BEEF, ...OTHER_MEAT] },
  'dairy-free': { forbids: DAIRY },
  'gluten-free': { forbids: GLUTEN },
  'nut-free': { forbids: NUTS },
};

function key(diet: string): string {
  return diet.trim().toLowerCase();
}

/**
 * Whether this diet is checked ingredient by ingredient, or only aimed for.
 *
 * "Low carb" and "Low sugar" are about how much, not what, and no ingredient
 * list settles them. The chips say which is which rather than letting the two
 * look equally reliable — "Low sugar" is not a promise Panzi can keep the way
 * "Halal" is.
 */
export function isEnforceable(diet: string): boolean {
  return key(diet) in DIET_RULES;
}

/**
 * How workable the whole set of restrictions is, measured rather than guessed.
 *
 * Nothing stops a user ticking every chip on the list, and people do — each one
 * felt true when they read it. The union is usually survivable, but there is no
 * warning at the point of choosing, and no way to tell a tight combination from
 * an impossible one by looking at the chips.
 *
 * So it is checked against everyday food: plain, cheap dishes across the range.
 * If most of these are out, almost anything will be.
 */
const CANARIES: { title: string; ingredients: string[] }[] = [
  { title: 'Sinangag', ingredients: ['rice', 'garlic', 'oil', 'salt'] },
  { title: 'Chicken tinola', ingredients: ['chicken', 'ginger', 'sayote', 'malunggay'] },
  { title: 'Ginataang gulay', ingredients: ['kalabasa', 'coconut milk', 'sitaw'] },
  { title: 'Tortang talong', ingredients: ['eggplant', 'eggs', 'oil'] },
  { title: 'Sinigang na bangus', ingredients: ['bangus', 'tamarind', 'kangkong'] },
  { title: 'Fruit salad', ingredients: ['mango', 'banana', 'pineapple'] },
  { title: 'Pancit bihon', ingredients: ['rice noodles', 'carrots', 'cabbage', 'soy sauce'] },
  { title: 'Beef nilaga', ingredients: ['beef', 'potato', 'cabbage', 'pechay'] },
];

export const EVERYDAY_TOTAL = CANARIES.length;

/** How many everyday dishes survive the current restrictions. Two or fewer is
 *  worth saying out loud, before the user wonders why Recipes keeps coming up
 *  empty and blames the app rather than the combination. */
export function everydayDishesLeft(diets: string[]): number {
  return CANARIES.filter(
    (dish) =>
      clashesWithDiet(
        {
          title: dish.title,
          ingredients: dish.ingredients.map((name) => ({ name })),
          steps: [],
        },
        diets
      ) === null
  ).length;
}

/** Diets whose rules go beyond ingredients, where Panzi has to admit a limit. */
export function needsCertificationNote(diets: string[]): boolean {
  return diets.some((diet) => key(diet) === 'halal' || key(diet) === 'kosher');
}

function withoutExceptions(text: string): string {
  let out = text;
  for (const phrase of DAIRY_EXCEPTIONS) {
    out = out.replace(new RegExp(escape(phrase), 'gi'), ' ');
  }
  return out;
}

/**
 * Whether a recipe clashes with the diet as it stands now.
 *
 * Used on saved recipes, where the diet may have been added long after the
 * dish was kept. It marks the row; it never removes it. The user chose to save
 * that recipe, and deleting somebody's list because a setting changed is not a
 * decision this app gets to make.
 */
export function clashesWithDiet(recipe: Dish, diets: string[]): string | null {
  if (diets.length === 0) return null;

  const text = withoutExceptions(
    [recipe.title, ...recipe.ingredients.map((i) => i.name), ...recipe.steps].join(' | ')
  );

  for (const diet of diets) {
    const rule = DIET_RULES[key(diet)];
    if (!rule) continue;

    const hit = mentions(text, rule.forbids);
    if (hit) return hit;

    if (rule.neverTogether) {
      const [left, right] = rule.neverTogether;
      const a = mentions(text, left);
      const b = mentions(text, right);
      if (a && b) return `${a} with ${b}`;
    }
  }

  return null;
}
