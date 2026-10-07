// server/src/cookbook.test.ts
//
// What the admin console may save as a cookbook recipe. These pin the
// sentences an admin sees for each mistake, and that a clean value comes out
// trimmed, with blank lines dropped, ready to store.
//
// Run: npx tsx --test src/cookbook.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkCookbookInput, titleKey } from './cookbook';

const good = {
  title: '  Pork   barbecue ',
  category: 'merienda',
  minutes: 40,
  servings: 6,
  description: 'Sweet, smoky pork skewers.',
  ingredients: [{ name: 'Pork shoulder', amount: '1 kg' }, { name: '', amount: '' }, { name: 'Banana ketchup', amount: '1 cup' }],
  steps: ['Marinate overnight.', '   ', 'Grill until charred.'],
};

test('a complete recipe comes out clean', () => {
  const result = checkCookbookInput(good);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.title, 'Pork barbecue');
  assert.deepEqual(result.value.ingredients, [
    { name: 'Pork shoulder', amount: '1 kg' },
    { name: 'Banana ketchup', amount: '1 cup' },
  ]);
  assert.deepEqual(result.value.steps, ['Marinate overnight.', 'Grill until charred.']);
});

test('numbers typed into a form as text are accepted', () => {
  const result = checkCookbookInput({ ...good, minutes: '25', servings: '4' });
  assert.equal(result.ok && result.value.minutes, 25);
});

test('each missing or wrong field gets its own sentence', () => {
  const cases: [Record<string, unknown>, RegExp][] = [
    [{ title: '' }, /name/],
    [{ title: 'x'.repeat(61) }, /60 characters/],
    [{ category: 'dessert' }, /Main Dish/],
    [{ minutes: 0 }, /Minutes/],
    [{ minutes: 12.5 }, /Minutes/],
    [{ servings: 31 }, /Serves/],
    [{ ingredients: [] }, /ingredient/],
    [{ ingredients: [{ name: '', amount: '2 cups' }] }, /needs a name/],
    [{ steps: ['', ' '] }, /step/],
    [{ steps: 'Grill it' }, /step/],
  ];
  for (const [change, message] of cases) {
    const result = checkCookbookInput({ ...good, ...change });
    assert.equal(result.ok, false, JSON.stringify(change));
    if (!result.ok) assert.match(result.message, message, JSON.stringify(change));
  }
});

test('an empty or missing body is rejected, not thrown on', () => {
  assert.equal(checkCookbookInput(undefined).ok, false);
  assert.equal(checkCookbookInput(null).ok, false);
});

test('titles that differ only in case or spacing collide', () => {
  assert.equal(titleKey('Chicken  Adobo '), titleKey('chicken adobo'));
});
