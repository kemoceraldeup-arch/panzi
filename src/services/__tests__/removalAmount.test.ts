// src/services/__tests__/removalAmount.test.ts
//
// Taking part of a pantry item: what History records as removed and what
// stays on the shelf, in the item's own measure. Taking all of it (or more)
// removes the item and records its quantity as it was.

import { parseQuantityString, unitWordOf } from '../quantity';
import { removableAmount, splitRemoval } from '../removalAmount';

describe('parseQuantityString with fraction glyphs', () => {
  it('reads a whole number and a glyph together', () => {
    expect(parseQuantityString('1½ packs')).toEqual({ measure: 'pack', splittable: true, amount: 1.5 });
    expect(parseQuantityString('2¼ loaves')).toEqual({ measure: 'pieces', splittable: true, amount: 2.25 });
  });
});

describe('unitWordOf', () => {
  it.each([
    ['5 eggs', 'egg'],
    ['1½ loaves', 'loaf'],
    ['2 packs', 'pack'],
    ['1 kg', 'kg'],
    ['a bit', ''],
  ])('%s → %s', (quantity, word) => {
    expect(unitWordOf(quantity)).toBe(word);
  });
});

describe('removableAmount', () => {
  it('offers a stepper for an amount with room to take part of it', () => {
    expect(removableAmount('5 eggs')).toEqual({
      full: { measure: 'pieces', splittable: false, amount: 5 },
      unit: 'egg',
    });
  });

  it.each(['a bit', '', '1 egg', '30 g', '¼ pack'])('only offers All for "%s"', (quantity) => {
    expect(removableAmount(quantity)).toBeNull();
  });
});

describe('splitRemoval', () => {
  it.each([
    ['5 eggs', 2, '2 eggs', '3 eggs'],
    ['1 kg', 250, '250 g', '750 g'],
    ['2 L', 500, '500 ml', '1.5 L'],
    ['2 packs', 0.5, '½ packs', '1½ packs'],
    ['1½ packs', 1, '1 pack', '½ packs'],
  ])('%s, taking %s → removed %s, left %s', (quantity, take, removed, remaining) => {
    expect(splitRemoval('a', quantity, take)).toEqual({ id: 'a', removed, remaining });
  });

  it('records the quantity unchanged when all of it goes', () => {
    expect(splitRemoval('a', '5 eggs', 'all')).toEqual({ id: 'a', removed: '5 eggs', remaining: null });
    expect(splitRemoval('a', '5 eggs', 5)).toEqual({ id: 'a', removed: '5 eggs', remaining: null });
    expect(splitRemoval('a', '5 eggs', 9)).toEqual({ id: 'a', removed: '5 eggs', remaining: null });
  });

  it('refuses a take that rounds to nothing', () => {
    expect(() => splitRemoval('a', '5 eggs', 0.1)).toThrow('A removal has to take something.');
  });

  it('removes the item when what would be left rounds to nothing', () => {
    expect(splitRemoval('a', '1 kg', 999.6)).toEqual({ id: 'a', removed: '1 kg', remaining: null });
  });

  it('never records an empty amount', () => {
    expect(splitRemoval('a', '', 'all')).toEqual({ id: 'a', removed: 'All', remaining: null });
    expect(splitRemoval('a', 'a bit', 'all')).toEqual({ id: 'a', removed: 'a bit', remaining: null });
  });

  it('refuses to take nothing', () => {
    expect(() => splitRemoval('a', '5 eggs', 0)).toThrow();
  });
});
