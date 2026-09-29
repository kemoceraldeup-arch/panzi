// server/src/usage.test.ts
//
// A scan can make two model calls: the read, and a second high-detail look to
// measure fill levels ('scan-measure'). The Costs screen's "Per scan" has to
// carry both, divided by the number of scans — not by the number of calls.
//
// Run: npx tsx --test src/usage.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { perScanCost } from './usage';

test('per-scan cost includes the fill-level measurement', () => {
  const byRoute = new Map([
    ['scan', { calls: 2, cost: 0.02 }],
    ['scan-measure', { calls: 1, cost: 0.01 }],
    ['recipes', { calls: 5, cost: 1 }],
  ]);
  assert.equal(perScanCost(byRoute), 0.015);
});

test('per-scan cost without any measurement is the scan route alone', () => {
  assert.equal(perScanCost(new Map([['scan', { calls: 4, cost: 0.08 }]])), 0.02);
});

test('no scans means no per-scan figure', () => {
  assert.equal(perScanCost(new Map([['scan-measure', { calls: 1, cost: 0.01 }]])), null);
  assert.equal(perScanCost(new Map()), null);
});
