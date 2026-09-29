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

test('consumed and leftover count as eaten', () => {
  assert.equal(outcomeOf('consumed'), 'eaten');
  assert.equal(outcomeOf('leftover'), 'eaten');
});

test('spoiled, expired and over-purchased count as wasted', () => {
  for (const reason of ['spoiled', 'expired', 'over-purchased']) {
    assert.equal(outcomeOf(reason), 'wasted', reason);
  }
});

test('other and unknown reasons are unclassified', () => {
  assert.equal(outcomeOf('other'), 'unclassified');
  assert.equal(outcomeOf('discarded'), 'unclassified');
  assert.equal(outcomeOf(''), 'unclassified');
  assert.equal(outcomeOf('toString'), 'unclassified');
});
