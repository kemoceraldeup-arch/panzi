// server/src/cookbook.ts
//
// The rules for a cookbook recipe, in one place, with no database or Express
// in sight — so the admin routes and their tests check exactly the same
// thing. A recipe the console sends is either turned into a clean value here
// or rejected with one sentence the admin can act on.

export const COOKBOOK_CATEGORIES = ['quick', 'ulam', 'merienda'] as const;
export type CookbookCategory = (typeof COOKBOOK_CATEGORIES)[number];

export const LIMITS = {
  title: 60,
  description: 200,
  ingredientName: 80,
  ingredientAmount: 40,
  ingredients: 40,
  step: 500,
  steps: 30,
  minutes: 600,
  servings: 30,
} as const;

/** The gradient a new dish gets when it has no photo, by category. The seeded
 *  dishes keep the look they had in the app. */
export const LOOK_FOR_CATEGORY: Record<CookbookCategory, string> = {
  ulam: 'stew',
  quick: 'rice',
  merienda: 'merienda',
};

export type CookbookInput = {
  title: string;
  category: CookbookCategory;
  minutes: number;
  servings: number;
  description: string;
  ingredients: { name: string; amount: string }[];
  steps: string[];
};

export type Checked = { ok: true; value: CookbookInput } | { ok: false; message: string };

/** One line of text: trimmed, inner runs of whitespace collapsed. */
function line(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function wholeNumber(value: unknown, min: number, max: number): number | null {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max ? n : null;
}

export function titleKey(title: string): string {
  return line(title).toLowerCase();
}

export function checkCookbookInput(body: unknown): Checked {
  const b = (body ?? {}) as Record<string, unknown>;
  const fail = (message: string): Checked => ({ ok: false, message });

  const title = line(b.title);
  if (!title) return fail('Give the recipe a name.');
  if (title.length > LIMITS.title) return fail(`Keep the name within ${LIMITS.title} characters.`);

  const category = b.category;
  if (!COOKBOOK_CATEGORIES.includes(category as CookbookCategory)) {
    return fail('Choose Main Dish, Quick and Easy, or Snacks.');
  }

  const minutes = wholeNumber(b.minutes, 1, LIMITS.minutes);
  if (minutes === null) return fail(`Minutes must be a whole number from 1 to ${LIMITS.minutes}.`);
  const servings = wholeNumber(b.servings, 1, LIMITS.servings);
  if (servings === null) return fail(`Serves must be a whole number from 1 to ${LIMITS.servings}.`);

  const description = line(b.description);
  if (description.length > LIMITS.description) {
    return fail(`Keep the description within ${LIMITS.description} characters.`);
  }

  if (!Array.isArray(b.ingredients)) return fail('Add at least one ingredient.');
  const ingredients: CookbookInput['ingredients'] = [];
  for (const raw of b.ingredients) {
    const name = line((raw as any)?.name);
    const amount = line((raw as any)?.amount);
    if (!name && !amount) continue;
    if (!name) return fail(`The ingredient with amount “${amount}” needs a name.`);
    if (name.length > LIMITS.ingredientName || amount.length > LIMITS.ingredientAmount) {
      return fail(`“${name.slice(0, 30)}” is too long. Keep ingredient names short.`);
    }
    ingredients.push({ name, amount });
  }
  if (!ingredients.length) return fail('Add at least one ingredient.');
  if (ingredients.length > LIMITS.ingredients) return fail(`A recipe can have up to ${LIMITS.ingredients} ingredients.`);

  if (!Array.isArray(b.steps)) return fail('Add at least one step.');
  const steps = b.steps.map(line).filter(Boolean);
  if (!steps.length) return fail('Add at least one step.');
  if (steps.length > LIMITS.steps) return fail(`A recipe can have up to ${LIMITS.steps} steps.`);
  if (steps.some((s) => s.length > LIMITS.step)) return fail(`Keep each step within ${LIMITS.step} characters.`);

  return { ok: true, value: { title, category: category as CookbookCategory, minutes, servings, description, ingredients, steps } };
}

/** What both the app and the console receive for one recipe. */
export function cookbookJson(doc: any) {
  return {
    id: String(doc._id),
    title: doc.title,
    category: doc.category,
    minutes: doc.minutes,
    servings: doc.servings,
    description: doc.description ?? '',
    ingredients: (doc.ingredients ?? []).map((i: any) => ({ name: i.name, amount: i.amount ?? '' })),
    steps: doc.steps ?? [],
    dishKey: doc.dishKey ?? 'other',
    look: doc.look ?? 'other',
    photoUrl: doc.photoUrl ?? null,
    revision: doc.revision ?? 0,
    updatedAt: doc.updatedAt ? new Date(doc.updatedAt).toISOString() : null,
  };
}
