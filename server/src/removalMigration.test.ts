// server/src/removalMigration.test.ts
//
// The one-time conversion of retired removal reasons. A dry run only counts;
// --apply converts leftover to consumed and over-purchased to other with a
// note saying what it was.
//
// Run: npx tsx --test src/removalMigration.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convertOldReasons, type ReasonRows } from './removalMigration';

type Row = { reason: string; note?: string | null };

function fakeRows(rows: Row[]): ReasonRows & { rows: Row[] } {
  return {
    rows,
    async countDocuments(filter: { reason: string }) {
      return rows.filter((r) => r.reason === filter.reason).length;
    },
    async updateMany(filter: { reason: string }, update: { $set: Partial<Row> }) {
      let modifiedCount = 0;
      for (const row of rows) {
        if (row.reason !== filter.reason) continue;
        Object.assign(row, update.$set);
        modifiedCount += 1;
      }
      return { modifiedCount };
    },
  };
}

test('a dry run counts each retired reason and changes nothing', async () => {
  const rows = fakeRows([{ reason: 'leftover' }, { reason: 'leftover' }, { reason: 'over-purchased' }, { reason: 'consumed' }]);
  const result = await convertOldReasons(rows, false);
  assert.deepEqual(result, [
    { reason: 'leftover', count: 2 },
    { reason: 'over-purchased', count: 1 },
  ]);
  assert.deepEqual(rows.rows.map((r) => r.reason), ['leftover', 'leftover', 'over-purchased', 'consumed']);
});

test('apply converts leftover to consumed and over-purchased to other with a note', async () => {
  const rows = fakeRows([{ reason: 'leftover' }, { reason: 'over-purchased' }, { reason: 'spoiled' }]);
  const result = await convertOldReasons(rows, true);
  assert.deepEqual(result, [
    { reason: 'leftover', count: 1 },
    { reason: 'over-purchased', count: 1 },
  ]);
  assert.deepEqual(rows.rows, [
    { reason: 'consumed' },
    { reason: 'other', note: 'Over-purchased' },
    { reason: 'spoiled' },
  ]);
});
