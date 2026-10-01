// server/src/removalOutcome.test.ts
//
// The admin console's waste rate reads the app's removal reasons. These pin
// which reasons count as eaten and which as wasted, and that anything the app
// might send later (or an old client sends today) lands outside both rather
// than being guessed into one.
//
// Run: npx tsx --test src/removalOutcome.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { outcomeOf } from './removalOutcome';

test('consumed counts as eaten', () => {
  assert.equal(outcomeOf('consumed'), 'eaten');
});

test('spoiled and expired count as wasted', () => {
  for (const reason of ['spoiled', 'expired']) {
    assert.equal(outcomeOf(reason), 'wasted', reason);
  }
});

test('other, retired and unknown reasons are unclassified', () => {
  assert.equal(outcomeOf('other'), 'unclassified');
  // Retired reasons: rows are converted by scripts/migrate-removal-reasons.ts,
  // but one read before that runs must not be guessed into a side.
  assert.equal(outcomeOf('leftover'), 'unclassified');
  assert.equal(outcomeOf('over-purchased'), 'unclassified');
  assert.equal(outcomeOf('discarded'), 'unclassified');
  assert.equal(outcomeOf(''), 'unclassified');
  assert.equal(outcomeOf('toString'), 'unclassified');
});
