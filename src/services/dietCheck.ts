// src/services/dietCheck.ts
//
// Whether a single item name conflicts with the user's diet or allergies —
// checked here, on the client, at the moment an item is about to be added or
// renamed, so the warning is instant rather than a round trip to the server.
//
// The diet half of this file (escape/variants/mentions/withoutExceptions/
// DIET_RULES/key/forbidsItem) is a deliberate line-for-line port of
// server/src/routes/diets.ts, kept identical on purpose: the server already
// uses these exact rules to decide what a suggestion is allowed to contain,
// and a pantry-side check that disagreed with the recipe-side one would mean
// an item silently blocked from suggestions with no explanation, or one
// waved through here and rejected there. If the server's rules change, this
// file needs the same edit — there is no build step shared between an Expo
// app and its server to avoid that by hand.
//
// The allergy half is new: routes/recipes.ts's own allergy gate is loose
// substring matching, chosen there because under-filtering an allergy is far
// worse than over-filtering one and a false positive only costs a recipe
// suggestion. The same asymmetry argues for the same looseness here, but
// word-boundary matching (mentions(), same as the diet side) already covers
// the case that matters — "peanut" inside "peanut butter" — without also
// catching unrelated words that happen to contain an allergen as a substring,
// so this file uses the tighter form throughout for fewer false alarms on a
// screen the user sees before every single item they add.

// ─── Matching (ported from server/src/routes/diets.ts) ──────────────────────

function escape(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function variants(term: string): string[] {
  const t = term.toLowerCase();
  if (t.endsWith('s')) return [t, t.slice(0, -1)];
  return [t, `${t}s`, `${t}es`];
}

/** Whether any of `terms` appears in `haystack` as a whole word or phrase.
 *  Returns the term as it is written in the rules, not the matched form. */
function mentions(haystack: string, terms: string[]): string | null {
  for (const term of terms) {
    const alternatives = variants(term).map(escape).join('|');
    if (new RegExp(`\\b(?:${alternatives})\\b`, 'i').test(haystack)) return term;
  }
  return null;
}

// ─── Diet rules (ported from server/src/routes/diets.ts) ────────────────────

type DietRule = {
  forbids: string[];
};

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
const DAIRY_EXCEPTIONS = ['coconut milk', 'gata', 'coconut cream', 'kakang gata'];
const ALCOHOL = [
  'rice wine', 'cooking wine', 'red wine', 'white wine', 'shaoxing', 'mirin',
  'sake', 'beer', 'lambanog', 'rum', 'brandy', 'whisky', 'whiskey', 'vodka',
  'gin', 'sherry', 'liqueur',
];
const GELATIN = ['gelatin', 'gelatine'];
const GLUTEN = [
  'wheat', 'flour', 'harina', 'bread', 'tinapay', 'pandesal', 'pasta',
  'spaghetti', 'noodles', 'pancit canton', 'miki', 'lumpia wrapper',
  'soy sauce', 'toyo', 'barley', 'rye', 'semolina', 'breadcrumbs',
];

const DIET_RULES: Record<string, DietRule> = {
  halal: { forbids: [...PORK, ...ALCOHOL, ...GELATIN, 'blood'] },
  kosher: { forbids: [...PORK, ...SHELLFISH, ...GELATIN, 'blood'] },
  'no pork': { forbids: PORK },
  'no beef': { forbids: BEEF },
  vegetarian: { forbids: [...PORK, ...BEEF, ...OTHER_MEAT, ...SEAFOOD, ...GELATIN] },
  vegan: {
    forbids: [...PORK, ...BEEF, ...OTHER_MEAT, ...SEAFOOD, ...DAIRY, ...GELATIN, 'egg', 'itlog', 'honey', 'pulot'],
  },
  pescatarian: { forbids: [...PORK, ...BEEF, ...OTHER_MEAT] },
  'dairy-free': { forbids: DAIRY },
  'gluten-free': { forbids: GLUTEN },
};

function key(diet: string): string {
  return diet.trim().toLowerCase();
}

/** Strips phrases that would false-positive a rule — "coconut milk" contains
 *  "milk" as a whole word, and coconut milk is not dairy. */
function withoutExceptions(text: string): string {
  let out = text;
  for (const phrase of DAIRY_EXCEPTIONS) {
    out = out.replace(new RegExp(escape(phrase), 'gi'), ' ');
  }
  return out;
}

/** The first diet this item conflicts with, or null. Mirrors the server's own
 *  forbidsItem exactly — see the file header for why that match matters. */
export function forbidsItem(name: string, diets: string[]): string | null {
  if (diets.length === 0 || !name.trim()) return null;
  const text = withoutExceptions(name);

  for (const diet of diets) {
    const rule = DIET_RULES[key(diet)];
    if (rule && mentions(text, rule.forbids)) return diet.trim();
  }
  return null;
}

// ─── Allergy matching (new) ──────────────────────────────────────────────────

/** A handful of allergen labels a user is likely to pick from
 *  COMMON_ALLERGENS (src/services/profile.ts) that need more than their own
 *  literal word to catch what actually contains them — the same reasoning as
 *  DIET_RULES' shared term lists above, kept small on purpose: an allergy the
 *  user typed in free text that isn't one of these still matches on its own
 *  literal word via `mentions`, which is the correct fallback for a term this
 *  file cannot know about in advance. */
const ALLERGEN_TERMS: Record<string, string[]> = {
  peanuts: ['peanut', 'peanuts', 'mani', 'peanut butter', 'peanut oil'],
  'tree nuts': ['almond', 'almonds', 'cashew', 'cashews', 'kasoy', 'walnut', 'walnuts', 'pistachio', 'hazelnut', 'pecan', 'macadamia', 'nut', 'nuts'],
  shellfish: SHELLFISH,
  fish: ['fish', 'isda', 'bangus', 'tilapia', 'tuna', 'salmon', 'sardines', 'anchovies', 'dilis', 'tuyo', 'daing', 'fish sauce', 'patis', 'bagoong'],
  eggs: ['egg', 'eggs', 'itlog'],
  milk: ['milk', 'gatas', 'cheese', 'keso', 'butter', 'mantikilya', 'cream', 'yoghurt', 'yogurt', 'condensed milk', 'evaporated milk'],
  soy: ['soy', 'soya', 'soybean', 'soy sauce', 'toyo', 'tofu', 'tokwa'],
  wheat: ['wheat', 'flour', 'harina', 'bread', 'pasta', 'noodles', 'soy sauce', 'toyo'],
  gluten: ['wheat', 'flour', 'harina', 'bread', 'pasta', 'noodles', 'soy sauce', 'toyo', 'barley', 'rye'],
  sesame: ['sesame', 'linga'],
};

/** The first allergy this item conflicts with, or null. Same word-boundary
 *  matching as forbidsItem, plus milk's own coconut-milk exception — a
 *  coconut milk allergy warning would be exactly the false alarm
 *  withoutExceptions exists to prevent on the diet side, and a milk allergy
 *  has the identical false-positive shape. */
export function forbidsAllergen(name: string, allergies: string[]): string | null {
  if (allergies.length === 0 || !name.trim()) return null;
  const text = withoutExceptions(name);

  for (const allergen of allergies) {
    const terms = ALLERGEN_TERMS[key(allergen)] ?? [allergen.trim()];
    if (mentions(text, terms)) return allergen.trim();
  }
  return null;
}

export type ItemConflict = {
  type: 'diet' | 'allergy';
  /** The diet or allergy label the item conflicts with, as the user wrote or
   *  picked it — "Vegan", "Peanuts". */
  label: string;
};

/**
 * Every conflict a single item name has with the user's diet and allergies.
 * Allergy conflicts are listed first — see DietAlertModal, which renders them
 * more urgently and wants the worse news up top when both are present.
 */
export function checkItemConflicts(name: string, dietary: string[], allergies: string[]): ItemConflict[] {
  const conflicts: ItemConflict[] = [];

  const allergen = forbidsAllergen(name, allergies);
  if (allergen) conflicts.push({ type: 'allergy', label: allergen });

  const diet = forbidsItem(name, dietary);
  if (diet) conflicts.push({ type: 'diet', label: diet });

  return conflicts;
}
