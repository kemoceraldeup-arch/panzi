// src/services/__tests__/cookDeduction.test.ts
//
// "Start cooking" takes a recipe's ingredients out of the pantry. These pin
// the arithmetic (5 eggs − 2 = 3, a used-up item is removed) and the refusals
// (never subtracting across units it can't convert, never matching "chicken"
// to a pantry "chicken broth" unless the recipe said it uses the broth).

jest.mock('../pantry', () => ({
  restorePantryItems: jest.fn(),
  updatePantryItem: jest.fn(),
}));
jest.mock('../removals', () => ({
  removePantryItems: jest.fn(),
  undoRemovals: jest.fn(),
}));

import { parseRecipeAmount, planDeduction } from '../cookDeduction';
import type { PantryItem } from '../pantry';
import type { Recipe, RecipeIngredient } from '../recipes';

function item(id: string, name: string, quantity: string, expiryDate: string | null = null): PantryItem {
  return { id, name, quantity, expiryDate, category: '', location: null } as unknown as PantryItem;
}

function recipe(ingredients: Partial<RecipeIngredient>[], pantryUsed: string[] = []): Recipe {
  return {
    pantryUsed,
    ingredients: ingredients.map((i) => ({ amount: '', have: true, assumedStaple: false, name: '', ...i })),
  } as unknown as Recipe;
}

describe('parseRecipeAmount', () => {
  it.each([
    ['2', 2, ''],
    ['2 eggs', 2, 'eggs'],
    ['1 1/2 cups', 1.5, 'cups'],
    ['½ kg', 0.5, 'kg'],
    ['250g', 250, 'g'],
    ['2-3 cloves', 2, 'cloves'],
  ])('%s', (text, value, unit) => {
    expect(parseRecipeAmount(text)).toEqual({ value, unit });
  });

  it('has no amount for "to taste"', () => {
    expect(parseRecipeAmount('to taste')).toBeNull();
  });
});

describe('planDeduction', () => {
  it('takes 2 eggs from 5, leaving 3', () => {
    const plan = planDeduction(recipe([{ name: 'eggs', amount: '2' }]), [item('a', 'Eggs', '5 eggs')]);
    expect(plan.changes).toEqual([expect.objectContaining({ before: '5 eggs', after: '3 eggs' })]);
  });

  it('removes an item the recipe uses up', () => {
    const plan = planDeduction(recipe([{ name: 'large eggs', amount: '3 pcs' }]), [item('a', 'Egg', '2 eggs')]);
    expect(plan.changes).toEqual([expect.objectContaining({ after: null })]);
  });

  it('converts between g and kg', () => {
    const plan = planDeduction(recipe([{ name: 'ground pork', amount: '250 g' }]), [
      item('a', 'Ground pork', '1 kg'),
    ]);
    expect(plan.changes[0].after).toBe('750 g');
  });

  it('matches a pantry name inside the ingredient name', () => {
    const plan = planDeduction(recipe([{ name: 'jasmine rice', amount: '0.5 kg' }]), [item('a', 'Rice', '2 kg')]);
    expect(plan.changes[0].after).toBe('1.5 kg');
  });

  it('does not treat chicken as chicken broth unless the recipe uses the broth', () => {
    const pantry = [item('a', 'Chicken broth', '1 L')];
    expect(planDeduction(recipe([{ name: 'chicken', amount: '500 ml' }]), pantry).changes).toEqual([]);
    expect(
      planDeduction(recipe([{ name: 'chicken', amount: '500 ml' }], ['Chicken broth']), pantry).changes[0].after,
    ).toBe('500 ml');
  });

  it('leaves packs alone for a recipe amount in cups, and says why', () => {
    const plan = planDeduction(recipe([{ name: 'rice', amount: '1 cup' }]), [item('a', 'Rice', '2 packs')]);
    expect(plan.changes).toEqual([]);
    expect(plan.skipped).toEqual([expect.objectContaining({ ingredient: 'rice' })]);
  });

  it('takes from the soonest-expiring row first and spills onto the next', () => {
    const plan = planDeduction(recipe([{ name: 'eggs', amount: '4' }]), [
      item('late', 'Eggs', '6 eggs', '2026-12-01'),
      item('soon', 'Eggs', '3 eggs', '2026-10-01'),
    ]);
    const byId = Object.fromEntries(plan.changes.map((c) => [c.item.id, c.after]));
    expect(byId).toEqual({ soon: null, late: '5 eggs' });
  });

  it('skips optional ingredients and ones not in the pantry', () => {
    const plan = planDeduction(
      recipe([
        { name: 'eggs', amount: '2', optional: true },
        { name: 'saffron', amount: '1 tsp' },
      ]),
      [item('a', 'Eggs', '5 eggs')],
    );
    expect(plan.changes).toEqual([]);
    expect(plan.skipped).toEqual([]);
  });
});
