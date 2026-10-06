// src/services/__tests__/removals.test.ts
//
// The app's half of /api/pantry/remove: what it sends, the ids it hands back
// for undo, and how a removal's reason reads in History.

jest.mock('../../config/api', () => ({ apiFetch: jest.fn() }));
jest.mock('../live', () => ({ refreshKey: jest.fn(), subscribeToKey: jest.fn() }));
jest.mock('../pantry', () => ({ refreshPantry: jest.fn() }));

import { apiFetch } from '../../config/api';
import {
  EMPTY_HISTORY,
  otherNote,
  reasonLabel,
  removeFromPantry,
  showRemovalChart,
  undoRemovals,
} from '../removals';

const mockFetch = apiFetch as jest.Mock;

beforeEach(() => mockFetch.mockReset());

it('sends each line with the reason and note, and returns the removal ids', async () => {
  mockFetch.mockResolvedValue({ ok: true, removalIds: ['r1'] });
  const ids = await removeFromPantry([{ id: 'a', removed: '2 eggs', remaining: '3 eggs' }], 'other', 'Gave away');
  expect(mockFetch).toHaveBeenCalledWith('/api/pantry/remove', {
    items: [{ id: 'a', removed: '2 eggs', remaining: '3 eggs' }],
    reason: 'other',
    note: 'Gave away',
  });
  expect(ids).toEqual(['r1']);
});

it('sends nothing for no lines', async () => {
  expect(await removeFromPantry([], 'consumed')).toEqual([]);
  expect(mockFetch).not.toHaveBeenCalled();
});

it('undoes by removal id', async () => {
  mockFetch.mockResolvedValue({ ok: true });
  await undoRemovals(['r1', 'r2']);
  expect(mockFetch).toHaveBeenCalledWith('/api/pantry/history/undo', { removalIds: ['r1', 'r2'] });
});

it('labels Other with its note', () => {
  expect(reasonLabel({ reason: 'other', note: 'Gave to neighbour' })).toBe('Other · Gave to neighbour');
  expect(reasonLabel({ reason: 'other', note: null })).toBe('Other');
  expect(reasonLabel({ reason: 'spoiled', note: null })).toBe('Spoiled');
});

describe('otherNote', () => {
  it('is the trimmed text, capped at 80 characters', () => {
    expect(otherNote('  Gave to neighbour  ')).toBe('Gave to neighbour');
    expect(otherNote('x'.repeat(100))).toBe('x'.repeat(80));
  });

  it('is null when nothing was typed', () => {
    expect(otherNote('')).toBeNull();
    expect(otherNote('    ')).toBeNull();
  });
});

describe('showRemovalChart', () => {
  const withRemovals = { ...EMPTY_HISTORY, counts: { ...EMPTY_HISTORY.counts, consumed: 2 } };

  it('keeps the chart when the pantry has been emptied but History has removals', () => {
    expect(showRemovalChart(0, withRemovals)).toBe(true);
  });

  it('shows the chart on a stocked pantry, even before anything was removed', () => {
    expect(showRemovalChart(3, withRemovals)).toBe(true);
    expect(showRemovalChart(3, EMPTY_HISTORY)).toBe(true);
  });

  it('keeps a brand-new empty pantry free of an empty chart', () => {
    expect(showRemovalChart(0, EMPTY_HISTORY)).toBe(false);
  });

  it('waits for the history to load', () => {
    expect(showRemovalChart(3, null)).toBe(false);
    expect(showRemovalChart(null, null)).toBe(false);
  });

  it('shows the chart while the pantry count is still loading, as before', () => {
    expect(showRemovalChart(null, withRemovals)).toBe(true);
  });
});
