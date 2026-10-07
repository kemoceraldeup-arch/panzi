// src/services/__tests__/typedQuantity.test.ts
//
// What a typed amount turns into: the same number the field shows, in base
// units, held between the measure's floor and the item's ceiling.

import { ItemQuantity, typedQuantity } from '../quantity';

const eggs: ItemQuantity = { measure: 'pieces', splittable: false, amount: 5 };
const flour: ItemQuantity = { measure: 'weight', splittable: true, amount: 2000, displayUnit: 'kg' };

describe('typedQuantity', () => {
  it('reads pieces as typed', () => {
    expect(typedQuantity('2', eggs, 5)).toEqual({ ...eggs, amount: 2 });
  });

  it('converts weight typed in kg to grams', () => {
    expect(typedQuantity('1.5', flour, 2000)).toEqual({ ...flour, amount: 1500 });
  });

  it('reads grams as typed when g is showing', () => {
    expect(typedQuantity('250', { ...flour, displayUnit: 'g' }, 2000)).toEqual({
      ...flour,
      displayUnit: 'g',
      amount: 250,
    });
  });

  it('clamps to the ceiling', () => {
    expect(typedQuantity('9', eggs, 5)).toEqual({ ...eggs, amount: 5 });
    expect(typedQuantity('9', flour, 2000)).toEqual({ ...flour, amount: 2000 });
  });

  it('clamps to the floor', () => {
    expect(typedQuantity('0.01', flour, 2000)).toEqual({ ...flour, amount: 50 });
    expect(typedQuantity('0.2', eggs, 5)).toEqual({ ...eggs, amount: 1 });
  });

  it.each(['', '0', 'abc', '.', '-'])('returns null for %p', (text) => {
    expect(typedQuantity(text, eggs, 5)).toBeNull();
  });
});
