// server/src/routes/diets.ts
//
// What a diet forbids, and what it leaves you to cook.
//
// Until now a diet was a word passed to the model with "these are requirements,
// not hints" attached, and nothing checked the answer. Allergies got a code
// gate; diet got a polite sentence. For someone keeping halal, being served
// pork is not a preference mismatch, so this file gives diet the same standing:
// the model is told plainly, and the reply is checked.
//
// Each rule carries two things, and the second matters as much as the first.
// `forbids` is the gate. `guidance` is what the model is told, and it names
// what to cook INSTEAD — because a ban on its own produces grudging suggestions
// while a ban plus a list produces dinner. That is especially true here: the
// system prompt pushes Filipino cooking, and five of the dishes it names are
// pork. Without substitutions the two instructions just fight.

// ─── Matching ─────────────────────────────────────────────────────────────
//
// Word boundaries, NOT the loose substring matching that routes/recipes.ts uses
// for allergens. The asymmetry there is deliberate and does not carry over:
// over-filtering an allergy costs a suggestion, under-filtering costs a
// hospital visit, so loose is correct. Diet terms are short and collide —
// substring "ham" strikes out "hamburger", and a halal user loses a beef burger
// for nothing. So: boundaries, and specific phrases over bare words.

function escape(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Singular and plural of one term.
 *
 * Word-boundary matching is exact, which means a list entry of "egg" silently
 * failed to match an ingredient called "Eggs" — and the two sides of this file
 * disagreed as a result: the pantry showed eggs to a vegan while the recipe
 * gate blocked the dish made from them. Rather than pair every entry by hand
 * and get it wrong again on the next addition, both forms are generated.
 */
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

// ─── The rules ────────────────────────────────────────────────────────────

type DietRule = {
  /** Ingredient terms that disqualify a recipe outright. */
  forbids: string[];
  /**
   * Fine apart, forbidden in one dish. Only kosher uses this — meat and dairy
   * are each perfectly kosher alone, which no flat forbidden-ingredient list
   * can express.
   */
  neverTogether?: [string[], string[]];
  /** Told to the model, in the user turn. The ban and the way around it. */
  guidance: string;
};

// Shared fragments, so "no pork" means the same thing everywhere it appears and
// a term added for halal is not quietly missing from vegetarian.
const PORK = [
  'pork',
  'baboy',
  'bacon',
  'ham',
  'gammon',
  'lechon',
  'lechon kawali',
  'crispy pata',
  'sisig',
  'longganisa',
  'tocino',
  'chorizo',
  'salami',
  'pepperoni',
  'prosciutto',
  'lard',
  'dinuguan',
];

const BEEF = ['beef', 'baka', 'steak', 'veal', 'oxtail', 'bulalo', 'tapa', 'corned beef'];

const OTHER_MEAT = [
  'chicken',
  'manok',
  'turkey',
  'duck',
  'itik',
  'lamb',
  'mutton',
  'goat',
  'kambing',
  'liver',
  'atay',
  'chicharon',
  'meat',
  'karne',
];

const SEAFOOD = [
  'fish',
  'isda',
  'bangus',
  'tilapia',
  'galunggong',
  'tuna',
  'salmon',
  'sardines',
  'anchovies',
  'dilis',
  'tuyo',
  'daing',
  'shrimp',
  'hipon',
  'prawn',
  'crab',
  'alimasag',
  'alimango',
  'squid',
  'pusit',
  'clams',
  'tahong',
  'mussels',
  'oyster sauce',
  'fish sauce',
  'patis',
  'bagoong',
];

const SHELLFISH = [
  'shrimp',
  'hipon',
  'prawn',
  'crab',
  'alimasag',
  'alimango',
  'squid',
  'pusit',
  'clams',
  'tahong',
  'mussels',
  'oyster',
  'shellfish',
];

const DAIRY = [
  'milk',
  'gatas',
  'cheese',
  'keso',
  'butter',
  'mantikilya',
  'cream',
  'yoghurt',
  'yogurt',
  'condensed milk',
  'evaporated milk',
];

// Coconut milk is not dairy and must never be caught by it — "gata" and
// "coconut milk" are absent from DAIRY on purpose, and `mentions` is
// word-boundary so "milk" cannot match inside "coconut milk"... except that it
// can, because "coconut milk" contains "milk" as a whole word. Handled by
// checking exclusions before the forbidden list.
const DAIRY_EXCEPTIONS = ['coconut milk', 'gata', 'coconut cream', 'kakang gata'];

// Alcohol, for halal. Drinking alcohol only — vinegar is deliberately absent.
//
// Suka is the backbone of adobo, paksiw and kinilaw, and the mainstream reading
// permits vinegar even when it began as wine. Blocking anything alcohol-derived
// would delete most of the cuisine to satisfy a minority reading. Note the
// entries are "rice wine" and "cooking wine", never bare "wine" — that would
// catch "wine vinegar" and take adobo with it.
const ALCOHOL = [
  'rice wine',
  'cooking wine',
  'red wine',
  'white wine',
  'shaoxing',
  'mirin',
  'sake',
  'beer',
  'lambanog',
  'rum',
  'brandy',
  'whisky',
  'whiskey',
  'vodka',
  'gin',
  'sherry',
  'liqueur',
];

const GELATIN = ['gelatin', 'gelatine'];

const NUTS = [
  'peanut',
  'peanuts',
  'mani',
  'almond',
  'almonds',
  'cashew',
  'cashews',
  'kasoy',
  'walnut',
  'walnuts',
  'pistachio',
  'hazelnut',
  'pecan',
  'macadamia',
];

const GLUTEN = [
  'wheat',
  'flour',
  'harina',
  'bread',
  'tinapay',
  'pandesal',
  'pasta',
  'spaghetti',
  'noodles',
  'pancit canton',
  'miki',
  'lumpia wrapper',
  'soy sauce',
  'toyo',
  'barley',
  'rye',
  'semolina',
  'breadcrumbs',
];

export const DIET_RULES: Record<string, DietRule> = {
  halal: {
    forbids: [...PORK, ...ALCOHOL, ...GELATIN, 'blood'],
    guidance:
      'HALAL: no pork in any form (no baboy, bacon, ham, chorizo, lard, lechon kawali, crispy pata, sisig, longganisa, tocino) and no drinking alcohol (no rice wine, cooking wine, beer, mirin, sake, rum). Vinegar and suka are fine and you should use them freely. This is not a limitation on Filipino cooking — cook chicken or beef adobo, tinola, ginataang manok, sinigang na hipon or bangus, pancit with chicken, kaldereta with beef or goat, ginisang gulay, tortang talong, arroz caldo, inihaw na bangus, laing. Where a dish would normally use pork, use chicken or beef and say so plainly in the title.',
  },
  kosher: {
    forbids: [...PORK, ...SHELLFISH, ...GELATIN, 'blood'],
    // Each list is fine alone. Together in one dish they are not.
    neverTogether: [[...BEEF, ...OTHER_MEAT], DAIRY],
    guidance:
      'KOSHER: no pork and no shellfish (no hipon, alimasag, pusit, tahong). Meat and dairy must never appear in the same dish — no cheese on a meat dish, no milk or butter in a chicken or beef recipe. Fish is fine and does not count as meat here. Cook chicken tinola, sinigang na bangus, ginisang gulay, pancit with chicken, beef nilaga, tortang talong.',
  },
  'no pork': {
    forbids: PORK,
    guidance:
      'NO PORK: no baboy, bacon, ham, chorizo, lard, lechon kawali, crispy pata, sisig, longganisa or tocino. Use chicken, beef or fish instead — chicken adobo, tinola, sinigang na hipon, beef kaldereta, ginataang manok all work without it.',
  },
  'no beef': {
    forbids: BEEF,
    guidance:
      'NO BEEF: no baka, steak, bulalo, tapa or corned beef. Chicken, pork, fish and vegetables are all fine.',
  },
  vegetarian: {
    forbids: [...PORK, ...BEEF, ...OTHER_MEAT, ...SEAFOOD, ...GELATIN],
    guidance:
      'VEGETARIAN: no meat, no fish, and none of the things people forget — no patis, no bagoong, no oyster sauce, no chicken or pork broth, no lard, no gelatine. Filipino vegetarian cooking is not thin: ginisang munggo without the chicharon, tortang talong, ginataang gulay, laing without bagoong, pinakbet with vegetable stock, chopsuey, lumpiang gulay, ginisang sayote, adobong kangkong.',
  },
  vegan: {
    forbids: [...PORK, ...BEEF, ...OTHER_MEAT, ...SEAFOOD, ...DAIRY, ...GELATIN, 'egg', 'itlog', 'honey', 'pulot'],
    guidance:
      'VEGAN: no meat, fish, dairy, eggs or honey, and no patis, bagoong, oyster sauce or gelatine. Coconut milk and gata are fine and are your best friend here — ginataang gulay, laing without bagoong, ginisang munggo, pinakbet with vegetable stock, adobong kangkong, lumpiang gulay, banana cue, turon.',
  },
  pescatarian: {
    forbids: [...PORK, ...BEEF, ...OTHER_MEAT],
    guidance:
      'PESCATARIAN: no meat or poultry, but fish and seafood are fine. Sinigang na bangus or hipon, inihaw na isda, paksiw na isda, ginataang isda, kinilaw, tortang talong, ginisang gulay.',
  },
  'dairy-free': {
    forbids: DAIRY,
    guidance:
      'DAIRY-FREE: no milk, cheese, butter, cream, condensed or evaporated milk. Coconut milk and gata are NOT dairy and are fine — most Filipino cooking is naturally dairy-free already.',
  },
  'gluten-free': {
    forbids: GLUTEN,
    guidance:
      'GLUTEN-FREE: no wheat flour, bread, pasta, wheat noodles or lumpia wrappers, and no ordinary soy sauce or toyo unless it is a gluten-free one. Rice is naturally fine — sinangag, silog plates, arroz caldo, bihon (rice noodles), sinigang, tinola, ginataang gulay all work.',
  },
  'nut-free': {
    forbids: NUTS,
    guidance:
      'NUT-FREE: no peanuts, mani, cashews, kasoy or tree nuts of any kind. That rules out kare-kare, which is peanut-based — do not suggest it.',
  },
};

// Diets that are about quantity, not ingredient identity. No ingredient list
// can settle whether a dish is "low carb", so these are passed to the model and
// never claimed as enforced. The client greys their chips for the same reason.
const GUIDANCE_ONLY: Record<string, string> = {
  'low carb':
    'LOW CARB: go easy on rice, noodles and bread. Lean on ulam eaten on its own, grilled fish or chicken, and vegetable dishes — but say if a dish is normally eaten with rice rather than pretending it is not.',
  'low sugar':
    'LOW SUGAR: avoid sweet dishes and heavy sugar. Filipino spaghetti, tocino, banana cue, turon and most merienda are out; savoury ulam is fine.',
};

/** Normalised lookup key: 'No Pork ' -> 'no pork'. */
function key(diet: string): string {
  return diet.trim().toLowerCase();
}

/**
 * Diets whose rules completely contain another's.
 *
 * A user can tick every chip on the list, and people do — "Vegan" and
 * "Vegetarian" and "Dairy-free" together, because each felt true. Enforcement
 * does not care: the union of the forbidden terms is identical either way. The
 * prompt cares a great deal. Twelve paragraphs of overlapping prohibitions cost
 * around 700 tokens on every call and, worse, bury the rules that matter in
 * repetition — the model reads "no meat" five times and the substitution lists
 * that make the suggestions good get lost in it.
 *
 * So the redundant ones are dropped from what the model is told. The rules they
 * carried are still enforced, because the diet that subsumes them forbids
 * everything they did.
 */
const SUBSUMES: Record<string, string[]> = {
  vegan: ['vegetarian', 'pescatarian', 'dairy-free'],
  vegetarian: ['pescatarian'],
  halal: ['no pork'],
  kosher: ['no pork'],
};

function withoutRedundant(diets: string[]): string[] {
  const present = new Set(diets.map(key));
  const covered = new Set<string>();

  for (const diet of present) {
    for (const lesser of SUBSUMES[diet] ?? []) {
      if (present.has(lesser)) covered.add(lesser);
    }
  }

  return diets.filter((diet) => !covered.has(key(diet)));
}

/** True when a diet is checked in code rather than only asked for. */
export function isEnforceable(diet: string): boolean {
  return key(diet) in DIET_RULES;
}

/**
 * The lines describing the user's diets, for the user turn.
 *
 * Never the system prompt — that is cached and must stay byte-identical, and a
 * per-user paragraph in it would stop the cache hitting on every request. Free
 * text we have no rule for is passed through as the user wrote it; the model
 * can usually do something sensible with "no shellfish on Fridays" even though
 * nothing here can check it.
 */
export function dietGuidance(diets: string[]): string[] {
  const lines: string[] = [];
  const unknown: string[] = [];

  for (const diet of withoutRedundant(diets)) {
    const rule = DIET_RULES[key(diet)];
    if (rule) {
      lines.push(rule.guidance);
      continue;
    }
    const only = GUIDANCE_ONLY[key(diet)];
    if (only) {
      lines.push(only);
      continue;
    }
    unknown.push(diet.trim());
  }

  if (unknown.length > 0) {
    lines.push(`Also honour these, as the user wrote them: ${unknown.join(', ')}.`);
  }

  return lines;
}

/** Text of a recipe, for matching. Title, ingredients and method — a dish that
 *  fries something in lard has it in the steps, not the ingredient list. */
function haystackOf(recipe: {
  title: string;
  ingredients: { name: string }[];
  steps: string[];
}): string {
  return [recipe.title, ...recipe.ingredients.map((i) => i.name), ...recipe.steps].join(' | ');
}

/** Strips the things that would false-positive, before matching. Coconut milk
 *  contains "milk" as a whole word, and gata is not dairy. */
/**
 * Removes the phrases that would match the wrong rule.
 *
 * Coconut milk is not dairy, and "coconut milk" contains "milk" as a whole
 * word, so boundaries alone do not save it. Exported because the allergy gate
 * in routes/recipes.ts has exactly the same problem: a milk allergy was
 * blocking every ginataan, laing and Bicol express in the cuisine over a
 * coconut, which is a lot of Filipino food to lose to a substring.
 */
export function withoutExceptions(text: string): string {
  let out = text;
  for (const phrase of DAIRY_EXCEPTIONS) {
    out = out.replace(new RegExp(escape(phrase), 'gi'), ' ');
  }
  return out;
}

/**
 * The first diet term a recipe breaks, or null when it breaks none.
 *
 * The prompt already carries every rule above in plain words, so with the
 * guidance landing this should almost never fire. It exists for when it does —
 * the same reasoning as the allergy gate, and the same reason `cleanUnit` and
 * `MAX_PLAUSIBLE_COUNT` exist in the scan route.
 */
export function violatesDiet(
  recipe: { title: string; ingredients: { name: string }[]; steps: string[] },
  diets: string[]
): { diet: string; term: string } | null {
  if (diets.length === 0) return null;

  const raw = haystackOf(recipe);
  const text = withoutExceptions(raw);

  for (const diet of diets) {
    const rule = DIET_RULES[key(diet)];
    if (!rule) continue;

    const hit = mentions(text, rule.forbids);
    if (hit) return { diet: diet.trim(), term: hit };

    if (rule.neverTogether) {
      const [left, right] = rule.neverTogether;
      const a = mentions(text, left);
      const b = mentions(text, right);
      // Only a violation when both sides are present. Either alone is fine,
      // which is the whole reason this is not just a longer `forbids` list.
      if (a && b) return { diet: diet.trim(), term: `${a} with ${b}` };
    }
  }

  return null;
}

/**
 * Whether a pantry item is something this user does not eat.
 *
 * Used to drop it from what the model is shown. The item stays in the pantry
 * and on Home — a housemate's bacon is not Panzi's business to comment on — it
 * simply never becomes a suggestion. The model cannot offer what it never saw,
 * which is a stronger guarantee than asking it to ignore something.
 */
export function forbidsItem(name: string, diets: string[]): boolean {
  if (diets.length === 0) return false;
  const text = withoutExceptions(name);

  return diets.some((diet) => {
    const rule = DIET_RULES[key(diet)];
    if (!rule) return false;
    // `neverTogether` is deliberately not consulted here. Cheese is perfectly
    // kosher sitting in the fridge; it is only a problem next to beef in one
    // dish, and that is the recipe gate's job, not this one's.
    return mentions(text, rule.forbids) !== null;
  });
}
