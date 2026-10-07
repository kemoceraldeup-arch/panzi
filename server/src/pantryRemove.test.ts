// server/src/pantryRemove.test.ts
//
// What /api/pantry/remove accepts and what it writes. Partial and whole
// removals, the note that only 'other' keeps, the retired reasons and the old
// body being refused, and items the caller doesn't own being skipped.
//
// Run: npx tsx --test src/pantryRemove.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRemoveBody, parseUndoBody, planRemovalWrites, undoFilter, type RemoveRequest } from './pantryRemove';

const line = (id: string, removed: string, remaining: string | null) => ({ id, removed, remaining });

test('accepts a partial and a whole removal', () => {
  const parsed = parseRemoveBody({
    items: [line('a', '2 eggs', '3 eggs'), line('b', '1 kg', null)],
    reason: 'consumed',
  });
  assert.deepEqual(parsed, {
    lines: [line('a', '2 eggs', '3 eggs'), line('b', '1 kg', null)],
    reason: 'consumed',
    note: null,
  });
});

test('keeps a trimmed note for other, capped at 80 characters', () => {
  const parsed = parseRemoveBody({ items: [line('a', '1 bag', null)], reason: 'other', note: `  ${'x'.repeat(100)}  ` });
  assert.equal(typeof parsed, 'object');
  assert.equal((parsed as RemoveRequest).note, 'x'.repeat(80));
});

test('other needs a note: blank, missing or non-text is refused', () => {
  for (const note of ['   ', '', undefined, null, 42]) {
    assert.equal(
      parseRemoveBody({ items: [line('a', '1 bag', null)], reason: 'other', note }),
      'Say why it is going.',
      String(note)
    );
  }
});

test('a note on any other reason is dropped', () => {
  const ignored = parseRemoveBody({ items: [line('a', '1 bag', null)], reason: 'spoiled', note: 'mouldy' });
  assert.equal((ignored as RemoveRequest).note, null);
});

test('refuses the old { ids, reason } body', () => {
  assert.equal(
    parseRemoveBody({ ids: ['a'], reason: 'consumed' }),
    'This version of Panzi is out of date — reload the app.'
  );
});

test('refuses retired and unknown reasons', () => {
  for (const reason of ['leftover', 'over-purchased', 'eaten', undefined]) {
    assert.equal(typeof parseRemoveBody({ items: [line('a', '1 egg', null)], reason }), 'string', String(reason));
  }
});

test('refuses an empty removed amount, a missing remaining, a blank remaining, and a repeated id', () => {
  const bad = [
    { items: [line('a', '  ', null)], reason: 'consumed' },
    { items: [{ id: 'a', removed: '1 egg' }], reason: 'consumed' },
    { items: [line('a', '1 egg', ' ')], reason: 'consumed' },
    { items: [line('a', '1 egg', '2 eggs'), line('a', '1 egg', '1 egg')], reason: 'consumed' },
  ];
  for (const body of bad) assert.equal(typeof parseRemoveBody(body), 'string', JSON.stringify(body));
});

test('writes a row per owned item, then shrinks or deletes it, and skips the rest', () => {
  const request: RemoveRequest = {
    lines: [line('a', '2 eggs', '3 eggs'), line('gone', '1 L', null), line('b', '500 g', null)],
    reason: 'other',
    note: 'Gave to neighbour',
  };
  const owned = [
    { _id: 'a', name: 'Eggs', quantity: '5 eggs', category: 'Dairy', createdAt: new Date(0) },
    { _id: 'b', name: 'Rice', quantity: '500 g', category: 'Grains', expiryDate: '2026-12-01' },
  ];
  const at = new Date(1000);
  let n = 0;
  const writes = planRemovalWrites(request, owned, 'u1', at, () => `r${++n}`);

  assert.deepEqual(writes.rows.map((r) => [r._id, r.itemId, r.quantity, r.reason, r.note, r.userId]), [
    ['r1', 'a', '2 eggs', 'other', 'Gave to neighbour', 'u1'],
    ['r2', 'b', '500 g', 'other', 'Gave to neighbour', 'u1'],
  ]);
  assert.deepEqual(writes.updates, [{ id: 'a', quantity: '3 eggs' }]);
  assert.deepEqual(writes.deletes, ['b']);
});

test('undo takes removal ids and deletes by row id, never by item', () => {
  assert.deepEqual(parseUndoBody({ removalIds: ['r1', 'r2'] }), ['r1', 'r2']);
  assert.deepEqual(parseUndoBody({ removalIds: [] }), []);
  assert.equal(typeof parseUndoBody({ itemIds: ['a'] }), 'string');
  assert.deepEqual(undoFilter('u1', ['r1']), { _id: { $in: ['r1'] }, userId: 'u1' });
});
