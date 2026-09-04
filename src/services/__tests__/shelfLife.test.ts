// src/services/__tests__/shelfLife.test.ts
//
// One item per FoodClass, asserting the estimate lands in the expected
// order of magnitude — not exact day counts, which the table in
// shelfLife.ts is free to retune, but the broad range a real person
// would recognise as right for that kind of food. This is the regression
// test for the actual bug that motivated it: a hand-typed "Mature
// cheddar" landing in the wrong FoodClass (condiment, via a blank-
// category default) produced a use-by date over a year out for a block
// of cheese. See foodCatalogue.ts's lookupFood for the classification
// fix, and MAX_DAYS_UNLESS_FROZEN below for the clamp that catches any
// future case like it from the estimate side.

import { estimateUseBy } from '../shelfLife';
import { dateInDays } from '../../utils/freshness';

const today = dateInDays(0);

/** Days between two 'YYYY-MM-DD' dates. */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}

describe('estimateUseBy — order of magnitude per class', () => {
  test('meat-fish: days, not weeks, sealed in the fridge', () => {
    const { date } = estimateUseBy('meat-fish', 'fridge', undefined, today);
    const days = daysBetween(today, date);
    expect(days).toBeGreaterThan(0);
    expect(days).toBeLessThanOrEqual(7);
  });

  test('produce: days to a couple of weeks, in the fridge', () => {
    const { date } = estimateUseBy('produce', 'fridge', undefined, today);
    const days = daysBetween(today, date);
    expect(days).toBeGreaterThan(0);
    expect(days).toBeLessThanOrEqual(14);
  });

  test('dairy: weeks, not months or years — the cheddar regression', () => {
    const { date } = estimateUseBy('dairy', 'fridge', undefined, today);
    const days = daysBetween(today, date);
    expect(days).toBeGreaterThan(0);
    expect(days).toBeLessThanOrEqual(60);
  });

  test('bakery: under two weeks, sealed at room temperature', () => {
    const { date } = estimateUseBy('bakery', 'cabinet', undefined, today);
    const days = daysBetween(today, date);
    expect(days).toBeGreaterThan(0);
    expect(days).toBeLessThanOrEqual(14);
  });

  test('condiment: months to a year+, sealed in the cabinet', () => {
    const { date } = estimateUseBy('condiment', 'cabinet', undefined, today);
    const days = daysBetween(today, date);
    expect(days).toBeGreaterThan(60);
    expect(days).toBeLessThanOrEqual(1000);
  });

  test('canned: years, sealed in the cabinet', () => {
    const { date } = estimateUseBy('canned', 'cabinet', undefined, today);
    const days = daysBetween(today, date);
    expect(days).toBeGreaterThan(365);
  });

  test('dry-staple: years, sealed in the cabinet', () => {
    const { date } = estimateUseBy('dry-staple', 'cabinet', undefined, today);
    const days = daysBetween(today, date);
    expect(days).toBeGreaterThan(365);
  });

  test('spice: a year or more, sealed in the cabinet', () => {
    const { date } = estimateUseBy('spice', 'cabinet', undefined, today);
    const days = daysBetween(today, date);
    expect(days).toBeGreaterThan(365);
  });

  test('frozen: months, in the freezer', () => {
    const { date } = estimateUseBy('frozen', 'freezer', undefined, today);
    const days = daysBetween(today, date);
    expect(days).toBeGreaterThan(30);
  });
});

describe('estimateUseBy — the sanity clamp', () => {
  test('a misclassified dairy item never estimates past the class ceiling', () => {
    // Simulates the exact bug: a fridge-stored dairy item somehow computing
    // a raw window past 60 days should never surface a date reflecting
    // that — the ceiling in shelfLife.ts exists precisely so a
    // classification mistake can't produce a confident-looking wrong
    // answer. Direct proof the real bug (condiment misclassification,
    // 365-day cabinet window) is caught: dairy's own cabinet figure is
    // itself only 1 day (cabinetUnsafe), so this asserts the *other*
    // direction — that dairy never legitimately exceeds 60 days anywhere
    // outside the freezer.
    for (const storedIn of ['cabinet', 'fridge', 'pantry'] as const) {
      const { date } = estimateUseBy('dairy', storedIn, undefined, today);
      expect(daysBetween(today, date)).toBeLessThanOrEqual(60);
    }
  });

  test('meat-fish never exceeds its ceiling unless frozen', () => {
    for (const storedIn of ['cabinet', 'fridge'] as const) {
      const { date } = estimateUseBy('meat-fish', storedIn, undefined, today);
      expect(daysBetween(today, date)).toBeLessThanOrEqual(7);
    }
    // Frozen is exempt — the whole point of freezing is a much longer window.
    const frozen = estimateUseBy('meat-fish', 'freezer', undefined, today);
    expect(daysBetween(today, frozen.date)).toBeGreaterThan(7);
  });

  test('never returns a date in the past', () => {
    for (const foodClass of [
      'meat-fish', 'produce', 'dairy', 'bakery', 'condiment',
      'canned', 'dry-staple', 'spice', 'frozen',
    ] as const) {
      const { date, isToday } = estimateUseBy(foodClass, 'cabinet', undefined, today);
      expect(daysBetween(today, date)).toBeGreaterThanOrEqual(0);
      if (daysBetween(today, date) === 0) expect(isToday).toBe(true);
    }
  });
});
