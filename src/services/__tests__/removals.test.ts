// src/services/__tests__/removals.test.ts
//
// The app's half of /api/pantry/remove: what it sends, the ids it hands back
// for undo, and how a removal's reason reads in History.

jest.mock('../../config/api', () => ({ apiFetch: jest.fn() }));
jest.mock('../live', () => ({ refreshKey: jest.fn(), subscribeToKey: jest.fn() }));
jest.mock('../pantry', () => ({ refreshPantry: jest.fn() }));

import { apiFetch } from '../../config/api';
import { reasonLabel, removeFromPantry, undoRemovals } from '../removals';

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
