# Partial Removals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Removing food from the pantry records how much went and why (Consumed, Spoiled, Expired, or Other with a typed note), keeps every removal in History, shows a View More link from Home's chart to Pantry History, and makes cook mode take ingredients when the recipe is finished.

**Architecture:** The app works out the amount strings (`removed`, `remaining`) with the existing `quantity.ts` model. The server writes one `pantry_removals` row per item, then shrinks or deletes the item. The server's request checks and write planning live in a pure module (`server/src/pantryRemove.ts`) so they can be tested without a database. Undo works by removal id, not item id.

**Tech Stack:** Expo SDK 57 / React Native (TypeScript, jest-expo). Express 5 + Mongoose 9 server, tested with `node:test` through `tsx`. Admin website: Vite + React (separate folder, not a git repo).

**Spec:** `docs/superpowers/specs/2026-09-30-partial-removals-design.md`

## Global Constraints

- Reasons are exactly `consumed`, `spoiled`, `expired`, `other`, in that order, on the client and the server.
- `consumed` is eaten. The other three are waste on Home's graph. Admin: `consumed` → eaten, `spoiled`/`expired` → wasted, `other` → unclassified.
- `note` applies only to `other`. It is trimmed and capped at 80 characters, and an empty note is stored as `null`. A note sent with any other reason is ignored.
- `POST /api/pantry/remove` body: `{ items: [{ id, removed, remaining }], reason, note }`. `removed` is non-empty. `remaining` is a string or `null` (`null` = nothing left). The response is `{ ok: true, removalIds }`. The old `{ ids, reason }` body is rejected with 400.
- `POST /api/pantry/history/undo` takes `{ removalIds }` and deletes exactly those rows, scoped to the caller.
- The server never does quantity arithmetic.
- `npx tsc --noEmit` passes in the repo root and in `server/`. `npx jest` (root) and `npm test` (server) pass.
- The migration script is run with `--apply` only after the user has seen the dry-run count.
- Read Expo's v54 docs per AGENTS.md before touching app code (`https://docs.expo.dev/versions/v54.0.0/`). This plan uses only core React Native components (`Modal`, `TextInput`, `KeyboardAvoidingView`) that the app already uses.

Paths below use this name:
- **ADMIN** = `C:\Users\Kenne\Our admin website\Our admin website\admin`

## Review Focus

- **An app build that still sends the old body.** Expo Go cached a stale bundle earlier today, so a phone running the old app is realistic. `{ ids, reason }` must get a 400 with a sentence and must not delete anything. Test in Task 2: `parseRemoveBody({ ids: ['a'], reason: 'consumed' })` returns an error string.
- **Fraction quantities that this feature itself writes.** A partial removal produces strings like `1½ packs`. Today `parseQuantityString` reads that as 1 piece, so the next removal would be wrong. Test in Task 4: `parseQuantityString('1½ packs')` is `{ measure: 'pack', amount: 1.5 }`.
- **An item below one stepper step** (`30 g`, `1 egg`) or **with no number** (`a bit`, `''`). Only "All" is offered, and `removed` is never empty. Test in Task 4: `removableAmount('30 g')` is `null`, and `splitRemoval('x', '', 'all').removed` is `'All'`.
- **An item gone by the time Save is pressed** (deleted on another phone, or not owned by the caller). No row is written, nothing fails, and the other items still go through. Test in Task 2: `planRemovalWrites` skips ids missing from `owned`.
- **Undo after a second removal of the same item.** Undoing a cook must delete only that cook's rows, not an earlier manual partial removal of the same eggs. Test in Task 2: `undoFilter` keys on `_id`, never `itemId`. Test in Task 6: `undoDeduction` passes the cook's removal ids.

---

### Task 1: Server — four reasons, `note` field, admin outcome, and the migration logic

**Files:**
- Modify: `server/src/models.ts:188-224`
- Modify: `server/src/removalOutcome.ts`
- Modify: `server/src/removalOutcome.test.ts`
- Create: `server/src/removalMigration.ts`
- Create: `server/src/removalMigration.test.ts`
- Create: `server/scripts/migrate-removal-reasons.ts`

**Interfaces:**
- Produces: `REMOVAL_REASONS = ['consumed','spoiled','expired','other'] as const` and `type RemovalReason` from `server/src/models.ts`. `PantryRemoval` schema has `note: String | null`.
- Produces: `convertOldReasons(rows: ReasonRows, apply: boolean): Promise<{ reason: string; count: number }[]>` from `server/src/removalMigration.ts`.

- [ ] **Step 1: Update the outcome test to the four reasons**

Replace the three tests in `server/src/removalOutcome.test.ts` (keep the header comment) with:

```ts
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
```

- [ ] **Step 2: Write the migration test**

Create `server/src/removalMigration.test.ts`:

```ts
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
```

- [ ] **Step 3: Run both tests to see them fail**

Run from `server/`: `npx tsx --test src/removalOutcome.test.ts src/removalMigration.test.ts`
Expected: FAIL. `leftover` is still `eaten`, and `./removalMigration` cannot be found.

- [ ] **Step 4: Narrow the reasons and add `note` in `models.ts`**

Replace the `REMOVAL_REASONS` block (lines 188-196) with:

```ts
/** Why an item left the shelves. The order is the order the app offers them. */
export const REMOVAL_REASONS = ['consumed', 'spoiled', 'expired', 'other'] as const;

export type RemovalReason = (typeof REMOVAL_REASONS)[number];
```

In the comment above `pantryRemovalSchema`, replace its first sentence ("One row per item taken off the shelves, written in the same request that deletes it.") with:

```ts
// One row per removal, written in the same request that shrinks or deletes
// the item. `quantity` is the amount that left in this removal, not what the
// item held: taking 2 of 5 eggs writes "2 eggs" here and leaves the item at 3.
```

In the schema, after the `reason` line, add:

```ts
    // Only for 'other': what the user typed, at most 80 characters.
    note: { type: String, default: null },
```

- [ ] **Step 5: Update `removalOutcome.ts`**

Replace the file body below the header comment's first line with:

```ts
//
// What a pantry removal means for the admin console's waste figures.
//
// The app asks why an item left (models.ts REMOVAL_REASONS); the console only
// asks whether the food was eaten or wasted. "Other" says nothing either way,
// so it stays out of the rate rather than being guessed into one side.

import type { RemovalReason } from './models';

export type RemovalOutcome = 'eaten' | 'wasted' | 'unclassified';

const OUTCOMES: Record<RemovalReason, RemovalOutcome> = {
  consumed: 'eaten',
  spoiled: 'wasted',
  expired: 'wasted',
  other: 'unclassified',
};

export function outcomeOf(reason: string): RemovalOutcome {
  return Object.hasOwn(OUTCOMES, reason) ? OUTCOMES[reason as RemovalReason] : 'unclassified';
}
```

- [ ] **Step 6: Write `removalMigration.ts`**

```ts
// server/src/removalMigration.ts
//
// Converts rows written with the two retired removal reasons. Leftovers were
// cooked and eaten, so they become 'consumed'. Over-purchased food was bought
// and not used for a reason Panzi cannot tell apart, so it becomes 'other' and
// keeps what it used to say as its note.
//
// Takes the collection as an argument so it can be tested with a fake one.
// scripts/migrate-removal-reasons.ts passes the real collection, which skips
// Mongoose's enum check (the retired values are no longer in it).

export const REASON_CONVERSIONS = [
  { from: 'leftover', set: { reason: 'consumed' } },
  { from: 'over-purchased', set: { reason: 'other', note: 'Over-purchased' } },
] as const;

export type ReasonRows = {
  countDocuments(filter: { reason: string }): Promise<number>;
  updateMany(filter: { reason: string }, update: { $set: Record<string, string> }): Promise<{ modifiedCount: number }>;
};

/** Counts (dry run) or converts (apply) each retired reason, in order. */
export async function convertOldReasons(
  rows: ReasonRows,
  apply: boolean
): Promise<{ reason: string; count: number }[]> {
  const result: { reason: string; count: number }[] = [];
  for (const conversion of REASON_CONVERSIONS) {
    const filter = { reason: conversion.from };
    const count = apply
      ? (await rows.updateMany(filter, { $set: { ...conversion.set } })).modifiedCount
      : await rows.countDocuments(filter);
    result.push({ reason: conversion.from, count });
  }
  return result;
}
```

- [ ] **Step 7: Write the script**

Create `server/scripts/migrate-removal-reasons.ts`:

```ts
// server/scripts/migrate-removal-reasons.ts
//
// One-time: converts pantry_removals rows that use the retired reasons
// 'leftover' and 'over-purchased' (see src/removalMigration.ts).
//
// Run it from server/:
//   npx tsx scripts/migrate-removal-reasons.ts           # counts only
//   npx tsx scripts/migrate-removal-reasons.ts --apply   # converts
//
// Run the dry run first and show the counts before applying.

import 'dotenv/config';
import mongoose from 'mongoose';
import { connectMongo } from '../src/mongo';
import { PantryRemoval } from '../src/models';
import { convertOldReasons, type ReasonRows } from '../src/removalMigration';

const apply = process.argv.includes('--apply');

async function main(): Promise<void> {
  await connectMongo();
  const result = await convertOldReasons(PantryRemoval.collection as unknown as ReasonRows, apply);
  for (const { reason, count } of result) {
    console.log(`${apply ? 'Converted' : 'Would convert'} ${count} row${count === 1 ? '' : 's'} with reason "${reason}".`);
  }
  if (!apply) console.log('Nothing was changed. Run again with --apply to convert.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect().catch(() => {}));
```

- [ ] **Step 8: Run the tests and typecheck**

Run from `server/`: `npx tsx --test src/removalOutcome.test.ts src/removalMigration.test.ts`
Expected: PASS (5 tests).

Run from `server/`: `npx tsc --noEmit`
Expected: errors only in `src/routes/pantry.ts`, `src/routes/admin.ts` or `src/routes/adminReports.ts` if they name a removed reason. Otherwise clean. Task 2 fixes `pantry.ts`.

- [ ] **Step 9: Commit**

```bash
git add server/src/models.ts server/src/removalOutcome.ts server/src/removalOutcome.test.ts server/src/removalMigration.ts server/src/removalMigration.test.ts server/scripts/migrate-removal-reasons.ts
git commit -m "Server: four removal reasons, note on removals, migration for retired reasons"
```

---

### Task 2: Server — partial `/remove`, notes in History, undo by removal id, admin note

**Files:**
- Create: `server/src/pantryRemove.ts`
- Create: `server/src/pantryRemove.test.ts`
- Modify: `server/src/routes/pantry.ts:183-292` (the `/remove`, `/history` and `/history/undo` routes and their comments)
- Modify: `server/src/routes/admin.ts:420-478` (user activity removals)
- Modify: `server/src/routes/adminReports.ts:309-358` (stat notes)

**Interfaces:**
- Consumes: `REMOVAL_REASONS`, `RemovalReason` from `server/src/models.ts` (Task 1). `isValidId` from `server/src/routes/helpers.ts`.
- Produces: `parseRemoveBody(body: unknown): RemoveRequest | string`, `planRemovalWrites(request, owned, uid, removedAt, newId?): RemovalWrites`, `parseUndoBody(body: unknown): string[] | string`, `undoFilter(uid: string, removalIds: string[])`, and `NOTE_MAX = 80`.
- HTTP: `POST /api/pantry/remove` → `{ ok: true, removalIds: string[] }`. `GET /api/pantry/history` records gain `note: string | null`. `POST /api/pantry/history/undo` takes `{ removalIds }` → `{ ok: true, deleted }`.

- [ ] **Step 1: Write the failing tests**

Create `server/src/pantryRemove.test.ts`:

```ts
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

test('a blank note is null, and a note on any other reason is dropped', () => {
  const blank = parseRemoveBody({ items: [line('a', '1 bag', null)], reason: 'other', note: '   ' });
  assert.equal((blank as RemoveRequest).note, null);
  const ignored = parseRemoveBody({ items: [line('a', '1 bag', null)], reason: 'spoiled', note: 'mouldy' });
  assert.equal((ignored as RemoveRequest).note, null);
});

test('refuses the old { ids, reason } body', () => {
  assert.equal(typeof parseRemoveBody({ ids: ['a'], reason: 'consumed' }), 'string');
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
```

- [ ] **Step 2: Run to see it fail**

Run from `server/`: `npx tsx --test src/pantryRemove.test.ts`
Expected: FAIL, because `./pantryRemove` cannot be found.

- [ ] **Step 3: Write `pantryRemove.ts`**

```ts
// server/src/pantryRemove.ts
//
// The checks and the write plan behind POST /api/pantry/remove and
// /history/undo, kept free of the database so they can be tested on their own.
//
// The phone works out both amounts ("2 eggs" removed, "3 eggs" left) with its
// own quantity model. This side only checks they are there and writes them —
// a second copy of the unit arithmetic here would be a second place for "1½
// packs" to be read differently.

import { randomUUID } from 'crypto';
import { REMOVAL_REASONS, type RemovalReason } from './models';
import { isValidId } from './routes/helpers';

/** The longest note kept with an 'other' removal. */
export const NOTE_MAX = 80;
const AMOUNT_MAX = 100;

export type RemoveLine = { id: string; removed: string; remaining: string | null };
export type RemoveRequest = { lines: RemoveLine[]; reason: RemovalReason; note: string | null };

/** The /remove body, checked. A string is the sentence for the 400. */
export function parseRemoveBody(body: unknown): RemoveRequest | string {
  const { items, reason, note } = (body ?? {}) as { items?: unknown; reason?: unknown; note?: unknown };
  if (!Array.isArray(items) || items.length === 0) return 'No items were sent.';

  const lines: RemoveLine[] = [];
  const seen = new Set<string>();
  for (const raw of items as any[]) {
    if (!isValidId(raw?.id)) return 'An id was not usable.';
    if (seen.has(raw.id)) return 'An item was sent twice.';
    seen.add(raw.id);

    const removed = typeof raw.removed === 'string' ? raw.removed.trim() : '';
    if (!removed || removed.length > AMOUNT_MAX) return 'Each item needs the amount removed.';

    // Required, not defaulted: a body that leaves it out must not be read as
    // "nothing left" and delete the item.
    if (!('remaining' in raw)) return 'Each item needs the amount left.';
    let remaining: string | null = null;
    if (raw.remaining !== null) {
      const text = typeof raw.remaining === 'string' ? raw.remaining.trim() : '';
      if (!text || text.length > AMOUNT_MAX) return 'An amount left was not usable.';
      remaining = text;
    }
    lines.push({ id: raw.id, removed, remaining });
  }

  if (!REMOVAL_REASONS.includes(reason as RemovalReason)) return 'That is not a removal reason.';
  const kept = reason === 'other' && typeof note === 'string' ? note.trim().slice(0, NOTE_MAX).trim() : '';
  return { lines, reason: reason as RemovalReason, note: kept || null };
}

export type RemovalWrites = {
  rows: Record<string, unknown>[];
  updates: { id: string; quantity: string }[];
  deletes: string[];
};

/**
 * The rows to insert and the items to shrink or delete. `owned` is what the
 * owner-scoped find returned; a line for anything not in it (someone else's
 * id, an item already gone) is skipped rather than failing the others.
 */
export function planRemovalWrites(
  request: RemoveRequest,
  owned: any[],
  uid: string,
  removedAt: Date,
  newId: () => string = randomUUID
): RemovalWrites {
  const byId = new Map(owned.map((item) => [String(item._id), item]));
  const writes: RemovalWrites = { rows: [], updates: [], deletes: [] };
  for (const line of request.lines) {
    const item = byId.get(line.id);
    if (!item) continue;
    writes.rows.push({
      _id: newId(),
      userId: uid,
      itemId: item._id,
      name: item.name,
      quantity: line.removed,
      category: item.category ?? '',
      location: item.location ?? null,
      expiryDate: item.expiryDate ?? item.estimatedUseBy ?? null,
      addedAt: item.createdAt ?? null,
      reason: request.reason,
      note: request.note,
      removedAt,
    });
    if (line.remaining === null) writes.deletes.push(line.id);
    else writes.updates.push({ id: line.id, quantity: line.remaining });
  }
  return writes;
}

/** The /history/undo body, checked. A string is the sentence for the 400. */
export function parseUndoBody(body: unknown): string[] | string {
  const { removalIds } = (body ?? {}) as { removalIds?: unknown };
  if (!Array.isArray(removalIds)) return 'No removal ids were sent.';
  if (!removalIds.every(isValidId)) return 'An id was not usable.';
  return removalIds;
}

/** By row id, so undoing a cook leaves an earlier removal of the same item alone. */
export function undoFilter(uid: string, removalIds: string[]) {
  return { _id: { $in: removalIds }, userId: uid };
}
```

- [ ] **Step 4: Run the tests**

Run from `server/`: `npx tsx --test src/pantryRemove.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Rewrite the three routes in `pantry.ts`**

Change the imports at the top:

```ts
import { Router } from 'express';
import { PantryItem, PantryRemoval, REMOVAL_REASONS } from '../models';
import { parseRemoveBody, parseUndoBody, planRemovalWrites, undoFilter } from '../pantryRemove';
import { badRequest, isValidId, withDb } from './helpers';
```

(`randomUUID` is no longer used here. Remove that import, or `noUnusedLocals` fails.)

Replace the `/remove` route and its doc comment with:

```ts
/**
 * Takes food off the shelves — all of an item or part of it — and writes down
 * how much and why, in one request.
 *
 * Separate from '/delete' on purpose. '/delete' is for taking back something
 * that should never have been there — a scan's Undo, an item added by mistake
 * — and logging those as "removed" would count food nobody ate or wasted.
 * This is the route for food actually leaving the kitchen.
 *
 * The history rows are written before the items change, so a failure in
 * between leaves food on the shelf with a history row the user can see, rather
 * than food gone with no record of where it went. The phone sends both
 * amounts; see pantryRemove.ts for why this side does no arithmetic.
 */
pantryRouter.post(
  '/remove',
  withDb(async (req, res) => {
    const request = parseRemoveBody(req.body);
    if (typeof request === 'string') return badRequest(res, request);

    const owned = await PantryItem.find({
      _id: { $in: request.lines.map((l) => l.id) },
      userId: req.uid,
    }).lean();
    const writes = planRemovalWrites(request, owned, req.uid!, new Date());

    if (writes.rows.length > 0) await PantryRemoval.insertMany(writes.rows);
    if (writes.updates.length > 0) {
      await PantryItem.bulkWrite(
        writes.updates.map((u) => ({
          updateOne: { filter: { _id: u.id, userId: req.uid }, update: { $set: { quantity: u.quantity } } },
        }))
      );
    }
    if (writes.deletes.length > 0) {
      await PantryItem.deleteMany({ _id: { $in: writes.deletes }, userId: req.uid });
    }
    res.json({ ok: true, removalIds: writes.rows.map((r) => r._id) });
  })
);
```

In `/history`'s record mapping, after `reason: row.reason,` add:

```ts
        note: row.note ?? null,
```

Replace the `/history/undo` route and its comment with:

```ts
// The other half of an undo that puts food back on the shelves. Keyed by the
// ids '/remove' returned rather than by item, so undoing a cook leaves an
// earlier removal of the same item where it is.
pantryRouter.post(
  '/history/undo',
  withDb(async (req, res) => {
    const removalIds = parseUndoBody(req.body);
    if (typeof removalIds === 'string') return badRequest(res, removalIds);
    if (removalIds.length === 0) {
      res.json({ ok: true, deleted: 0 });
      return;
    }
    const result = await PantryRemoval.deleteMany(undoFilter(req.uid!, removalIds));
    res.json({ ok: true, deleted: result.deletedCount ?? 0 });
  })
);
```

- [ ] **Step 6: Admin routes send the note and drop the retired wording**

In `server/src/routes/admin.ts`, change the removals `.select({ name: 1, reason: 1, removedAt: 1 })` (around line 423) to `.select({ name: 1, reason: 1, note: 1, removedAt: 1 })`. In the `removals: removals.map(...)` block, after `reason: row.reason,` add `note: row.note ?? null,`.

In `server/src/routes/adminReports.ts`, change the stat notes:
- `'eaten, cooked, or finished as leftovers'` → `'eaten or cooked with'`
- `'spoiled, expired, or over-purchased'` → `'spoiled or expired'`
- `'Outcomes come from the reason picked in the app. Each recorded pantry entry counts once, regardless of its quantity.'` → `'Outcomes come from the reason picked in the app. Each removal counts once, whatever the amount.'`

- [ ] **Step 7: Typecheck and run all server tests**

Run from `server/`: `npx tsc --noEmit`
Expected: no output.

Run from `server/`: `npm test`
Expected: all pass (10 existing tests, minus the 3 outcome tests Task 1 replaced, plus the new ones).

- [ ] **Step 8: Commit**

```bash
git add server/src/pantryRemove.ts server/src/pantryRemove.test.ts server/src/routes/pantry.ts server/src/routes/admin.ts server/src/routes/adminReports.ts
git commit -m "Server: partial removals with notes; undo by removal id"
```

---

### Task 3: Admin website — four reason labels and the note

ADMIN is not a git repo. There is nothing to commit.

**Files:**
- Modify: `ADMIN/src/screens/Users.tsx:110-113` and `:200`
- Modify: `ADMIN/src/api/types.ts:499`

**Interfaces:**
- Consumes: the admin user-activity response from Task 2, whose removals gain `note: string | null`.

- [ ] **Step 1: Type the note**

In `ADMIN/src/api/types.ts`, change the `removals` line of `UserActivity` to:

```ts
  removals: { id: string; name: string; reason: string; note: string | null; outcome: RemovalOutcome; at: string }[];
```

- [ ] **Step 2: Labels and the note in `Users.tsx`**

Replace `REASON_WORD` with:

```ts
// The words the app shows on its own removal sheet (src/services/removals.ts).
const REASON_WORD: Record<string, string> = {
  consumed: 'Consumed', spoiled: 'Spoiled', expired: 'Expired', other: 'Other',
};

/** "Other · Gave to neighbour" when the person typed why. */
function reasonText(row: { reason: string; note: string | null }): string {
  const word = REASON_WORD[row.reason] ?? row.reason;
  return row.reason === 'other' && row.note ? `${word} · ${row.note}` : word;
}
```

In the removals list, replace `{REASON_WORD[row.reason] ?? row.reason}` with `{reasonText(row)}`.

- [ ] **Step 3: Typecheck**

Run in ADMIN: `npm run typecheck`
Expected: no errors. If `api/index.ts` or `api/sample.ts` build sample `removals` rows, add `note: null` to each one the compiler names.

---

### Task 4: App — amount arithmetic for a removal

**Files:**
- Modify: `src/services/quantity.ts` (fix the fraction parse, add `singularWord` and `unitWordOf`)
- Create: `src/services/removalAmount.ts`
- Create: `src/services/__tests__/removalAmount.test.ts`
- Modify: `src/services/cookDeduction.ts` (use the moved helpers)

**Interfaces:**
- Produces from `quantity.ts`: `singularWord(word: string): string` and `unitWordOf(quantity: string): string` (the singular unit noun after the number, e.g. `'egg'` for `'5 eggs'`).
- Produces from `removalAmount.ts`:
  - `type RemovalLine = { id: string; removed: string; remaining: string | null }`
  - `type Removable = { full: ItemQuantity; unit: string }`
  - `removableAmount(quantity: string): Removable | null`. This is `null` when only "All" makes sense.
  - `settleAmount(measure: Measure, amount: number): number`
  - `splitRemoval(id: string, quantity: string, take: number | 'all'): RemovalLine`

- [ ] **Step 1: Write the failing tests**

Create `src/services/__tests__/removalAmount.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to see it fail**

Run: `npx jest src/services/__tests__/removalAmount.test.ts`
Expected: FAIL, because `../removalAmount` cannot be found and `unitWordOf` is not exported.

- [ ] **Step 3: Fix the fraction parse in `quantity.ts`**

In `parseQuantityString`, change the match so a mixed number is tried before a plain one:

```ts
  // Mixed numbers ("1½") first: the plain-number branch would otherwise take
  // the "1" alone and leave "½ packs" as the unit, reading 1½ packs as 1 piece.
  const match = trimmed.match(/^(\d+[¼½¾]|[¼½¾]|[\d.]+)\s*(.*)$/);
```

- [ ] **Step 4: Move the unit-noun helpers into `quantity.ts`**

Add after `pluralizeUnit`:

```ts
/** The inverse of pluralizeUnit, loosely — "eggs" → "egg", "loaves" → "loaf".
 *  Good enough for the unit nouns pantry rows and recipes actually use. */
export function singularWord(word: string): string {
  if (word.endsWith('ies') && word.length > 4) return `${word.slice(0, -3)}y`;
  if (word.endsWith('oes')) return word.slice(0, -2);
  if (word.endsWith('ves')) return `${word.slice(0, -3)}f`;
  if (word.endsWith('ses') || word.endsWith('ches') || word.endsWith('shes')) return word.slice(0, -2);
  if (word.endsWith('s') && !word.endsWith('ss') && word.length > 3) return word.slice(0, -1);
  return word;
}

/** The unit noun after a saved quantity's number, singular — "egg" in "5
 *  eggs". What formatQuantityString takes back to write a new amount in the
 *  same words. Empty when there is no number. */
export function unitWordOf(quantity: string): string {
  const m = quantity.trim().match(/^[\d.¼½¾]+\s*(.*)$/);
  return m ? singularWord(m[1].trim().toLowerCase()) : '';
}
```

In `src/services/cookDeduction.ts`:
- Delete the local `singular` function and the local `pantryUnitWord` function.
- Change the quantity import to `import { ItemQuantity, formatQuantityString, parseQuantityString, singularWord as singular, unitWordOf } from './quantity';`
- Replace the one call `pantryUnitWord(item.quantity)` with `unitWordOf(item.quantity)`.

- [ ] **Step 5: Write `removalAmount.ts`**

```ts
// src/services/removalAmount.ts
//
// How much of a pantry item is leaving, as the two strings the server stores:
// what History records as removed, and what stays on the shelf. Both are
// written in the item's own measure and words ("2 eggs" out of "5 eggs"
// leaves "3 eggs"), through the same quantity model the edit sheet uses, so a
// row the user shrinks reads the same as one they typed.

import {
  ItemQuantity,
  Measure,
  formatQuantityString,
  minFor,
  parseQuantityString,
  unitWordOf,
} from './quantity';

/** One item's part of a removal, as /api/pantry/remove takes it. */
export type RemovalLine = { id: string; removed: string; remaining: string | null };

export type Removable = { full: ItemQuantity; unit: string };

/**
 * The item's amount as something a stepper can count down from, or null when
 * the only sensible choice is All: no number to count ("a bit"), or no more
 * than one step of it (1 egg, 30 g), where any part is the whole.
 */
export function removableAmount(quantity: string): Removable | null {
  const text = quantity.trim();
  if (!/^[\d.¼½¾]/.test(text)) return null;
  const full = parseQuantityString(text);
  if (!(full.amount > minFor(full.measure, full.splittable))) return null;
  return { full, unit: unitWordOf(text) };
}

/** Rounds an amount the way a pantry row stores it: whole grams and
 *  millilitres, quarters of packs and pieces. */
export function settleAmount(measure: Measure, amount: number): number {
  if (measure === 'weight' || measure === 'volume') return Math.round(amount);
  return Math.round(amount * 4) / 4;
}

/**
 * What taking `take` (in the item's base unit) out of `quantity` records and
 * leaves. 'all', or anything that leaves nothing, removes the item and
 * records its quantity as it was.
 */
export function splitRemoval(id: string, quantity: string, take: number | 'all'): RemovalLine {
  const whole: RemovalLine = { id, removed: quantity.trim() || 'All', remaining: null };
  if (take === 'all') return whole;
  if (!(take > 0)) throw new Error('A removal has to take something.');

  const removable = removableAmount(quantity);
  if (!removable) return whole;
  const { full, unit } = removable;
  const taken = settleAmount(full.measure, take);
  const left = settleAmount(full.measure, full.amount - taken);
  if (taken >= full.amount || left <= 0) return whole;

  return {
    id,
    removed: formatQuantityString({ ...full, amount: taken }, unit),
    remaining: formatQuantityString({ ...full, amount: left }, unit),
  };
}
```

- [ ] **Step 6: Run the new and the existing cook tests**

Run: `npx jest src/services/__tests__/removalAmount.test.ts src/services/__tests__/cookDeduction.test.ts`
Expected: PASS for both. If a `splitRemoval` row fails only because a plural differs (e.g. `½ pack` vs `½ packs`), the test is wrong: `formatQuantityString` is the source of truth. Correct the test's expected string and note it in the commit.

- [ ] **Step 7: Commit**

```bash
git add src/services/quantity.ts src/services/removalAmount.ts src/services/__tests__/removalAmount.test.ts src/services/cookDeduction.ts
git commit -m "App: removal amounts in the item's own measure; read 1½ as one and a half"
```

---

### Task 5: App — removals service: four reasons, notes, `removeFromPantry`, undo by id

**Files:**
- Modify: `src/services/removals.ts`
- Create: `src/services/__tests__/removals.test.ts`

**Interfaces:**
- Consumes: `RemovalLine` from `src/services/removalAmount.ts` (Task 4).
- Produces from `removals.ts`:
  - `REMOVAL_REASONS = ['consumed','spoiled','expired','other'] as const`
  - `NOTE_MAX = 80`
  - `RemovalRecord.note: string | null`
  - `reasonLabel(record: { reason: RemovalReason; note: string | null }): string`
  - `removeFromPantry(lines: RemovalLine[], reason: RemovalReason, note?: string | null): Promise<string[]>`, which returns the removal ids
  - `undoRemovals(removalIds: string[]): Promise<void>`
- Removed: `removePantryItems`. Tasks 6 and 7 replace its two callers. The app does not typecheck again until both are done.

- [ ] **Step 1: Write the failing test**

Create `src/services/__tests__/removals.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to see it fail**

Run: `npx jest src/services/__tests__/removals.test.ts`
Expected: FAIL, because `reasonLabel` and `removeFromPantry` are not exported.

- [ ] **Step 3: Update `removals.ts`**

Header comment: replace "copies the item into a history row alongside the reason before deleting it" with "writes a history row with how much went and why, then shrinks the item or deletes it".

Add the import `import type { RemovalLine } from './removalAmount';`

Replace the reasons, labels and hints with:

```ts
export const REMOVAL_REASONS = ['consumed', 'spoiled', 'expired', 'other'] as const;

export type RemovalReason = (typeof REMOVAL_REASONS)[number];

/** The longest note kept with an Other removal (the server trims to this too). */
export const NOTE_MAX = 80;

export const REMOVAL_LABELS: Record<RemovalReason, string> = {
  consumed: 'Consumed',
  spoiled: 'Spoiled',
  expired: 'Expired',
  other: 'Other',
};

/** One line under each reason in the picker, so "Spoiled" and "Expired" don't
 *  read as the same thing — the difference is what the research needs. */
export const REMOVAL_HINTS: Record<RemovalReason, string> = {
  consumed: 'Eaten or cooked with',
  spoiled: 'Went bad before its date',
  expired: 'Past its date, thrown out',
  other: 'Given away, or something else — say what',
};
```

In `RemovalRecord`, change the `quantity` field's line and add `note`:

```ts
  /** How much left in this removal — not what the item held before. */
  quantity: string;
```

```ts
  reason: RemovalReason;
  /** What the user typed for Other; null otherwise. */
  note: string | null;
```

Change `EMPTY_HISTORY.counts` to `{ consumed: 0, spoiled: 0, expired: 0, other: 0 }`.

In `toRecord`, after `reason: raw.reason,` add `note: typeof raw.note === 'string' && raw.note ? raw.note : null,`.

Add after `isWaste`:

```ts
/** "Other · Gave to neighbour" when the user said why; the plain label otherwise. */
export function reasonLabel(record: { reason: RemovalReason; note: string | null }): string {
  return record.reason === 'other' && record.note
    ? `${REMOVAL_LABELS.other} · ${record.note}`
    : REMOVAL_LABELS[record.reason];
}
```

Replace `removePantryItems` and `undoRemovals` with:

```ts
/**
 * Takes food off the shelves — all of an item or part of it — and records why.
 * Each line says how much went and what is left (removalAmount.ts works both
 * out). Refreshes the pantry and the history, which is what moves Home's
 * chart the moment something is removed. Returns one removal id per row
 * written, for undo.
 */
export async function removeFromPantry(
  lines: RemovalLine[],
  reason: RemovalReason,
  note: string | null = null
): Promise<string[]> {
  if (lines.length === 0) return [];
  const body = await apiFetch<{ removalIds?: unknown }>('/api/pantry/remove', { items: lines, reason, note });
  refreshPantry();
  refreshKey(KEY);
  return Array.isArray(body.removalIds) ? body.removalIds.filter((id): id is string => typeof id === 'string') : [];
}

/**
 * Drops the history rows a removal wrote, by the ids removeFromPantry
 * returned. Call alongside putting the food back — food back on the shelf
 * was never really removed.
 */
export async function undoRemovals(removalIds: string[]) {
  if (removalIds.length === 0) return;
  await apiFetch('/api/pantry/history/undo', { removalIds });
  refreshKey(KEY);
}
```

- [ ] **Step 4: Run the test**

Run: `npx jest src/services/__tests__/removals.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/removals.ts src/services/__tests__/removals.test.ts
git commit -m "App: removals service sends amounts and notes, undoes by removal id"
```

---

### Task 6: App — cook deduction records amounts and undoes by removal id

**Files:**
- Modify: `src/services/cookDeduction.ts`
- Modify: `src/services/__tests__/cookDeduction.test.ts`

**Interfaces:**
- Consumes: `removeFromPantry`, `undoRemovals` (Task 5) and `settleAmount` (Task 4).
- Produces: `DeductionChange.removed: string`, `applyDeduction(plan): Promise<string[]>` (returns removal ids), and `undoDeduction(plan, removalIds: string[]): Promise<void>`.

- [ ] **Step 1: Update the test mocks and add the failing tests**

In `src/services/__tests__/cookDeduction.test.ts`, change the removals mock to:

```ts
jest.mock('../removals', () => ({
  removeFromPantry: jest.fn(),
  undoRemovals: jest.fn(),
}));
```

Change the import line to:

```ts
import { applyDeduction, parseRecipeAmount, planDeduction, undoDeduction } from '../cookDeduction';
import { restorePantryItems, updatePantryItem } from '../pantry';
import { removeFromPantry, undoRemovals } from '../removals';
```

In `describe('planDeduction')`, change the first three tests' expectations:

```ts
  it('takes 2 eggs from 5, leaving 3', () => {
    const plan = planDeduction(recipe([{ name: 'eggs', amount: '2' }]), [item('a', 'Eggs', '5 eggs')]);
    expect(plan.changes).toEqual([expect.objectContaining({ before: '5 eggs', after: '3 eggs', removed: '2 eggs' })]);
  });

  it('removes an item the recipe uses up, recording all of it', () => {
    const plan = planDeduction(recipe([{ name: 'large eggs', amount: '3 pcs' }]), [item('a', 'Egg', '2 eggs')]);
    expect(plan.changes).toEqual([expect.objectContaining({ after: null, removed: '2 eggs' })]);
  });

  it('converts between g and kg', () => {
    const plan = planDeduction(recipe([{ name: 'ground pork', amount: '250 g' }]), [
      item('a', 'Ground pork', '1 kg'),
    ]);
    expect(plan.changes[0]).toEqual(expect.objectContaining({ after: '750 g', removed: '250 g' }));
  });
```

Append at the end of the file:

```ts
describe('applyDeduction and undoDeduction', () => {
  beforeEach(() => jest.clearAllMocks());

  it('sends every change through one Consumed removal and returns its ids', async () => {
    (removeFromPantry as jest.Mock).mockResolvedValue(['r1', 'r2']);
    const plan = planDeduction(recipe([{ name: 'eggs', amount: '2' }, { name: 'rice', amount: '1 kg' }]), [
      item('a', 'Eggs', '5 eggs'),
      item('b', 'Rice', '1 kg'),
    ]);
    const ids = await applyDeduction(plan);
    expect(removeFromPantry).toHaveBeenCalledWith(
      [
        { id: 'a', removed: '2 eggs', remaining: '3 eggs' },
        { id: 'b', removed: '1 kg', remaining: null },
      ],
      'consumed'
    );
    expect(updatePantryItem).not.toHaveBeenCalled();
    expect(ids).toEqual(['r1', 'r2']);
  });

  it('undo restores amounts, re-adds used-up items, and drops only this cook’s rows', async () => {
    const eggs = item('a', 'Eggs', '5 eggs');
    const rice = item('b', 'Rice', '1 kg');
    const plan = planDeduction(recipe([{ name: 'eggs', amount: '2' }, { name: 'rice', amount: '1 kg' }]), [eggs, rice]);
    await undoDeduction(plan, ['r1', 'r2']);
    expect(updatePantryItem).toHaveBeenCalledWith('a', { quantity: '5 eggs' });
    expect(restorePantryItems).toHaveBeenCalledWith([rice]);
    expect(undoRemovals).toHaveBeenCalledWith(['r1', 'r2']);
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx jest src/services/__tests__/cookDeduction.test.ts`
Expected: FAIL. The `removed` expectations fail and `removeFromPantry` is never called.

- [ ] **Step 3: Update `cookDeduction.ts`**

Change the header comment's first paragraph to:

```ts
// Finishing a recipe in cook mode takes its ingredients out of the pantry: 5
// eggs on the shelf and a recipe calling for 2 leaves 3, and an item the
// recipe uses up entirely is removed. Every change is recorded in History as
// Consumed, with how much the recipe took.
```

Change the removals import to `import { removeFromPantry, undoRemovals } from './removals';` and add `import { settleAmount } from './removalAmount';`.

Add `removed` to `DeductionChange`:

```ts
export type DeductionChange = {
  item: PantryItem;
  before: string;
  /** null when the recipe uses it all and the item is removed. */
  after: string | null;
  /** What the recipe took, in the item's own measure — the History row's amount. */
  removed: string;
};
```

Replace the final loop of `planDeduction` (from `const changes: DeductionChange[] = [];` to `return { changes, skipped };`) with:

```ts
  const changes: DeductionChange[] = [];
  for (const w of working.values()) {
    const left = settle(w.quantity);
    const after = left ? formatQuantityString(left, w.unitWord) : null;
    if (after === w.item.quantity) continue;
    const start = parseQuantityString(w.item.quantity);
    const removed =
      after === null
        ? w.item.quantity
        : formatQuantityString(
            { ...start, amount: settleAmount(start.measure, start.amount - left!.amount) },
            w.unitWord,
          );
    changes.push({ item: w.item, before: w.item.quantity, after, removed });
  }
  return { changes, skipped };
```

Replace `applyDeduction` and `undoDeduction` with:

```ts
/** Takes every change out in one removal, recorded as Consumed — cooked with.
 *  Returns the removal ids, which undoDeduction needs. */
export async function applyDeduction(plan: DeductionPlan): Promise<string[]> {
  return removeFromPantry(
    plan.changes.map((c) => ({ id: c.item.id, removed: c.removed, remaining: c.after })),
    'consumed',
  );
}

/** Puts every change back: amounts restored, removed rows re-added whole, and
 *  only this cook's History rows dropped. */
export async function undoDeduction(plan: DeductionPlan, removalIds: string[]): Promise<void> {
  const restored = plan.changes.filter((c) => c.after === null).map((c) => c.item);
  await Promise.all([
    restorePantryItems(restored),
    undoRemovals(removalIds),
    ...plan.changes
      .filter((c) => c.after !== null)
      .map((c) => updatePantryItem(c.item.id, { quantity: c.before })),
  ]);
}
```

Change `describeDeduction`'s doc comment to "One line per change, for the summary shown when cooking is finished."

- [ ] **Step 4: Run the tests**

Run: `npx jest src/services/__tests__/cookDeduction.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/cookDeduction.ts src/services/__tests__/cookDeduction.test.ts
git commit -m "App: cook deduction records what it took and undoes only its own rows"
```

---

### Task 7: App — the two-step removal sheet and the Pantry list

**Files:**
- Modify: `src/screens/scan/atoms.tsx` (`MeasureControl` gains `max`, `fixedMeasure`, `label`)
- Modify: `src/components/pantry/RemovalReasonSheet.tsx` (rewrite)
- Modify: `src/screens/ListScreen.tsx:56-57, 182, 353-392, 761-766`

**Interfaces:**
- Consumes: `removableAmount`, `splitRemoval`, `RemovalLine` (Task 4) and `removeFromPantry`, `NOTE_MAX` (Task 5).
- Produces: `RemovalReasonSheet` props `{ items: PantryItem[]; mode: 'remove' | 'useUp'; onSave(lines, reason, note); onDiscard(); onClose() }`. It keeps exporting `REASON_ICONS` with four keys.

- [ ] **Step 1: Give `MeasureControl` a ceiling, a fixed measure and a label**

In `src/screens/scan/atoms.tsx`, add three optional props to `MeasureControl`'s destructuring and type:

```ts
  /** A ceiling below maxFor, in base units — the removal sheet caps at what
   *  the item holds. */
  max?: number;
  /** Hides the measure pill: the removal sheet counts in the item's own
   *  measure and switching it would make the amount meaningless. */
  fixedMeasure?: boolean;
  /** The eyebrow over the stepper. Defaults to "How many". */
  label?: string;
```

Use them:
- `nudge` becomes:

```ts
  function nudge(direction: 1 | -1) {
    const next = step(quantity, direction);
    onChange(max === undefined ? next : { ...next, amount: Math.min(max, next.amount) });
  }
```

- Before `typedCeiling`, add `const ceilingBase = Math.min(maxFor(quantity.measure), max ?? Infinity);`. In `typedCeiling`, use `ceilingBase` in place of both `maxFor(quantity.measure)` calls. In `commitTyped`, change `const ceiling = maxFor(quantity.measure);` to `const ceiling = ceilingBase;`.
- `<Eyebrow>How many</Eyebrow>` becomes `<Eyebrow>{label ?? 'How many'}</Eyebrow>`.
- Wrap the measure pill `TouchableOpacity` in `{!fixedMeasure && ( … )}`, and change `{typePanelOpen && (` to `{!fixedMeasure && typePanelOpen && (`.

Run: `npx tsc --noEmit 2>&1 | grep atoms.tsx`
Expected: no lines. Other files still fail until this task finishes.

- [ ] **Step 2: Rewrite `RemovalReasonSheet.tsx`**

Replace the whole file with:

```tsx
// src/components/pantry/RemovalReasonSheet.tsx
//
// What Delete and Use up open on the List screen.
//
// Step 1, "How much?", goes item by item: a stepper in the item's own measure
// that starts at all of it, with an All shortcut. An item with no number to
// count, or no more than one step of it, only offers All. Use up stops here and
// saves as Consumed — the Next button on the last item is the deliberate
// action, so there is no confirm after it.
//
// Step 2, "Why is it going?", is one pick for everything in this removal.
// Three reasons save on tap; Other opens a short note and its own Save. The
// last row is the way out for a row that should never have been there: it
// deletes without writing any history, because a misread scan logged as
// "Other" would count food that never left the kitchen.

import React, { useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Text from '../Text';
import { MeasureControl } from '../../screens/scan/atoms';
import { PantryItem } from '../../services/pantry';
import { RemovalLine, removableAmount, splitRemoval } from '../../services/removalAmount';
import {
  NOTE_MAX,
  REMOVAL_HINTS,
  REMOVAL_LABELS,
  REMOVAL_REASONS,
  RemovalReason,
  isWaste,
} from '../../services/removals';
import { fonts, type } from '../../theme/typography';
import { makeStyles } from '../../theme/makeStyles';
import { useColors } from '../../theme/ThemeProvider';
import { space } from '../../theme/spacing';

const HIT_SLOP = { top: 12, bottom: 12, left: 12, right: 12 };

export const REASON_ICONS: Record<RemovalReason, keyof typeof Ionicons.glyphMap> = {
  consumed: 'restaurant-outline',
  spoiled: 'warning-outline',
  expired: 'calendar-outline',
  other: 'ellipsis-horizontal',
};

type Take = number | 'all';

type Props = {
  /** The items being removed, or [] when closed. */
  items: PantryItem[];
  /** 'useUp' asks only how much and saves as Consumed. */
  mode: 'remove' | 'useUp';
  onSave: (lines: RemovalLine[], reason: RemovalReason, note: string | null) => void;
  /** Deletes without recording anything — added by mistake. */
  onDiscard: () => void;
  onClose: () => void;
};

export default function RemovalReasonSheet({ items, mode, onSave, onDiscard, onClose }: Props) {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();

  // 0..items.length-1 is "How much?" for that item; items.length is "Why?".
  const [index, setIndex] = useState(0);
  const [takes, setTakes] = useState<Record<string, Take>>({});
  const [otherOpen, setOtherOpen] = useState(false);
  const [note, setNote] = useState('');

  // A fresh removal starts from the first item, all of everything.
  const key = items.map((i) => i.id).join(',');
  useEffect(() => {
    setIndex(0);
    setTakes({});
    setOtherOpen(false);
    setNote('');
  }, [key]);

  const count = items.length;
  const onReasonStep = index >= count;
  const item = onReasonStep ? null : items[index];
  const removable = useMemo(() => (item ? removableAmount(item.quantity) : null), [item]);
  const take: Take = item ? (takes[item.id] ?? 'all') : 'all';

  function lines(): RemovalLine[] {
    return items.map((i) => splitRemoval(i.id, i.quantity, takes[i.id] ?? 'all'));
  }

  function setTake(next: Take) {
    if (!item) return;
    setTakes((prev) => ({ ...prev, [item.id]: next }));
  }

  function next() {
    if (index === count - 1 && mode === 'useUp') {
      onSave(lines(), 'consumed', null);
      return;
    }
    setIndex(index + 1);
  }

  function pick(reason: RemovalReason) {
    if (reason === 'other') {
      setOtherOpen(true);
      return;
    }
    onSave(lines(), reason, null);
  }

  const title = onReasonStep ? 'Why is it going?' : 'How much?';
  const subtitle = onReasonStep
    ? `${count === 1 ? '1 item' : `${count} items`} · saved to your history`
    : `${item!.name}${count > 1 ? ` · ${index + 1} of ${count}` : ''}`;
  const nextLabel = index === count - 1 && mode === 'useUp' ? 'Use up' : 'Next';

  return (
    <Modal visible={count > 0} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <TouchableOpacity style={styles.backdropTap} activeOpacity={1} onPress={onClose} />

        <View style={[styles.sheet, { paddingBottom: insets.bottom + space.lg }]}>
          <View style={styles.grabber} />

          <View style={styles.header}>
            {index > 0 && (
              <TouchableOpacity
                onPress={() => {
                  setOtherOpen(false);
                  setIndex(index - 1);
                }}
                hitSlop={HIT_SLOP}
                accessibilityLabel="Back"
              >
                <Ionicons name="chevron-back" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{title}</Text>
              <Text style={styles.subtitle} numberOfLines={1}>
                {subtitle}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={HIT_SLOP} accessibilityLabel="Cancel">
              <Ionicons name="close" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {!onReasonStep && item && (
            <>
              <View style={styles.card}>
                <View style={styles.amountBody}>
                  {removable ? (
                    <MeasureControl
                      quantity={{
                        ...removable.full,
                        amount: take === 'all' ? removable.full.amount : take,
                      }}
                      unit={removable.unit}
                      max={removable.full.amount}
                      fixedMeasure
                      label="How much"
                      onChange={(q) => setTake(q.amount >= removable.full.amount ? 'all' : q.amount)}
                    />
                  ) : (
                    <Text style={styles.allOnly}>
                      {item.quantity.trim() ? `All of it (${item.quantity.trim()})` : 'All of it'}
                    </Text>
                  )}
                  {removable && (
                    <TouchableOpacity
                      style={[styles.allChip, take === 'all' && styles.allChipOn]}
                      onPress={() => setTake('all')}
                      accessibilityRole="button"
                      accessibilityState={{ selected: take === 'all' }}
                    >
                      <Text style={[styles.allChipText, take === 'all' && styles.allChipTextOn]}>
                        All ({item.quantity.trim()})
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
              <TouchableOpacity style={styles.primary} onPress={next} accessibilityRole="button">
                <Text style={styles.primaryText}>{nextLabel}</Text>
              </TouchableOpacity>
            </>
          )}

          {onReasonStep && (
            <>
              <View style={styles.card}>
                {REMOVAL_REASONS.map((reason, i) => {
                  const waste = isWaste(reason);
                  const selected = reason === 'other' && otherOpen;
                  return (
                    <TouchableOpacity
                      key={reason}
                      style={[styles.row, i > 0 && styles.rowDivided, selected && styles.rowSelected]}
                      onPress={() => pick(reason)}
                      activeOpacity={0.7}
                    >
                      <View style={[styles.icon, waste ? styles.iconWaste : styles.iconEaten]}>
                        <Ionicons
                          name={REASON_ICONS[reason]}
                          size={17}
                          color={waste ? colors.accentDeep : colors.primaryDark}
                        />
                      </View>
                      <View style={styles.rowText}>
                        <Text style={styles.rowLabel}>{REMOVAL_LABELS[reason]}</Text>
                        <Text style={styles.rowHint}>{REMOVAL_HINTS[reason]}</Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {otherOpen && (
                <View style={styles.noteBlock}>
                  <TextInput
                    style={styles.noteInput}
                    value={note}
                    onChangeText={setNote}
                    placeholder="What happened? e.g. Gave to neighbour"
                    placeholderTextColor={colors.textSecondary}
                    maxLength={NOTE_MAX}
                    autoFocus
                    returnKeyType="done"
                    onSubmitEditing={() => onSave(lines(), 'other', note.trim() || null)}
                    accessibilityLabel="Reason for removing"
                  />
                  <TouchableOpacity
                    style={styles.primary}
                    onPress={() => onSave(lines(), 'other', note.trim() || null)}
                    accessibilityRole="button"
                  >
                    <Text style={styles.primaryText}>Save</Text>
                  </TouchableOpacity>
                </View>
              )}

              <TouchableOpacity style={styles.discard} onPress={onDiscard} hitSlop={HIT_SLOP}>
                <Text style={styles.discardText}>Added by mistake — delete without recording</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(23,23,15,0.35)',
  },
  backdropTap: {
    flex: 1,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: space.xl,
    paddingTop: space.sm2,
  },
  grabber: {
    alignSelf: 'center',
    width: 42,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.backgroundAlt,
    marginBottom: space.md2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    marginBottom: space.md2,
  },
  title: {
    fontFamily: fonts.display,
    fontWeight: '700',
    fontSize: type.title.fontSize,
    color: colors.primaryDarker,
  },
  subtitle: {
    fontWeight: '600',
    fontSize: type.label.fontSize,
    color: colors.textSecondary,
    marginTop: space.xs,
  },
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
    borderRadius: 20,
    overflow: 'hidden',
  },
  amountBody: {
    padding: space.lg,
    gap: space.md,
  },
  allOnly: {
    fontWeight: '700',
    fontSize: type.body.fontSize,
    color: colors.primaryDarker,
  },
  allChip: {
    alignSelf: 'flex-start',
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
  },
  allChipOn: {
    backgroundColor: colors.primaryLighter,
    borderColor: colors.primaryLighter,
  },
  allChipText: {
    fontWeight: '700',
    fontSize: type.label.fontSize,
    color: colors.textSecondary,
  },
  allChipTextOn: {
    color: colors.primaryDark,
  },
  primary: {
    marginTop: space.md2,
    minHeight: 50,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryDark,
  },
  primaryText: {
    fontWeight: '800',
    fontSize: type.body.fontSize,
    color: colors.surface,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 56,
    paddingVertical: space.sm2,
    paddingHorizontal: space.lg,
  },
  rowDivided: {
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  rowSelected: {
    backgroundColor: colors.backgroundAlt,
  },
  icon: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconEaten: {
    backgroundColor: colors.primaryLighter,
  },
  iconWaste: {
    backgroundColor: colors.accentSoft,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowLabel: {
    fontWeight: '700',
    fontSize: type.body.fontSize,
    color: colors.primaryDarker,
  },
  rowHint: {
    fontWeight: '600',
    fontSize: type.caption.fontSize,
    color: colors.textSecondary,
    marginTop: space.half,
  },
  noteBlock: {
    marginTop: space.md2,
  },
  noteInput: {
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
    backgroundColor: colors.card,
    paddingHorizontal: space.lg,
    fontSize: type.body.fontSize,
    color: colors.primaryDarker,
  },
  discard: {
    alignSelf: 'center',
    paddingVertical: space.md2,
    marginTop: space.xs,
  },
  discardText: {
    fontWeight: '700',
    fontSize: type.label.fontSize,
    color: colors.textSecondary,
  },
}));
```

Every colour and spacing token above is already used in this file or in `RemovalChart.tsx`. If `tsc` reports one missing from the theme, use the nearest existing token from `src/theme/palettes.ts`.

- [ ] **Step 3: Wire `ListScreen.tsx`**

Change the imports:

```ts
import RemovalReasonSheet from '../components/pantry/RemovalReasonSheet';
import { RemovalReason, removeFromPantry } from '../services/removals';
import { RemovalLine } from '../services/removalAmount';
```

Replace `const [removingIds, setRemovingIds] = useState<string[] | null>(null);` with:

```ts
  // What the removal sheet is open for: which items, and whether it was
  // Delete (asks why) or Use up (Consumed, no reason step).
  const [removing, setRemoving] = useState<{ ids: string[]; mode: 'remove' | 'useUp' } | null>(null);
  const removingItems = useMemo(
    () => (removing ? items.filter((i) => removing.ids.includes(i.id)) : []),
    [removing, items]
  );
```

Replace `removeItems`, `finishRemoving` and `confirmRemove` (lines 353-392) with:

```ts
  function closeRemoval() {
    setRemoving(null);
    setOpenSwipeId(null);
    exitSelection();
  }

  async function saveRemoval(lines: RemovalLine[], reason: RemovalReason, note: string | null) {
    closeRemoval();
    try {
      await removeFromPantry(lines, reason, note);
    } catch (err: any) {
      Alert.alert('Could not remove those', err.message);
    }
  }

  /** Added by mistake: deleted, nothing recorded. */
  async function discardRemoval() {
    const ids = removing?.ids ?? [];
    closeRemoval();
    try {
      await deletePantryItems(ids);
    } catch (err: any) {
      Alert.alert('Could not delete those', err.message);
    }
  }

  // Both ask how much (see RemovalReasonSheet). Delete then asks why; Use up
  // already says why — it was eaten — and saves as Consumed.
  function confirmRemove(ids: string[], mode: 'delete' | 'useUp') {
    setRemoving({ ids, mode: mode === 'delete' ? 'remove' : 'useUp' });
  }
```

Replace the sheet element (lines 761-766) with:

```tsx
      <RemovalReasonSheet
        items={removingItems}
        mode={removing?.mode ?? 'remove'}
        onSave={saveRemoval}
        onDiscard={discardRemoval}
        onClose={() => setRemoving(null)}
      />
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors only in files Tasks 8 and 9 change (`CookModeScreen.tsx`, `RemovalChart.tsx`, `PantryHistoryScreen.tsx`, `HomeScreen.tsx`), or none. Fix anything in the files this task touched.

- [ ] **Step 5: Commit**

```bash
git add src/screens/scan/atoms.tsx src/components/pantry/RemovalReasonSheet.tsx src/screens/ListScreen.tsx
git commit -m "App: removal sheet asks how much, then why; Other takes a note"
```

---

### Task 8: App — cook mode takes ingredients at the finish

**Files:**
- Modify: `src/screens/cook/CookCompleteSheet.tsx` (Props, plus the `Modal`'s `onShow`)
- Modify: `src/screens/cook/CookStepScreen.tsx` (Props, `handleNext`, `CookCompleteSheet` element)
- Modify: `src/screens/CookModeScreen.tsx`

**Interfaces:**
- Consumes: `applyDeduction(plan): Promise<string[]>` and `undoDeduction(plan, removalIds)` (Task 6).
- Produces: `CookCompleteSheet` prop `onShow?: () => void`. `CookStepScreen` props `onComplete?: () => void` (Finish pressed on the last step) and `onCompleteShown?: () => void` (the complete sheet has finished presenting).

- [ ] **Step 1: `CookCompleteSheet` reports when it is up**

Add to `Props`:

```ts
  /** Fired once the sheet's modal has finished presenting — the earliest an
   *  Alert can be raised over it without iOS dropping it. */
  onShow?: () => void;
```

Destructure `onShow` in the component signature. On the `<Modal` element, add `onShow={onShow}`.

- [ ] **Step 2: `CookStepScreen` passes Finish and the sheet's arrival up**

Add to `CookStepScreenProps`:

```ts
  /** Finish pressed on the last step — the recipe was cooked. */
  onComplete?: () => void;
  /** The complete sheet is up. */
  onCompleteShown?: () => void;
```

Destructure both. In `handleNext`, change the `isLast` branch to:

```ts
    if (isLast) {
      setCompleted(true);
      onComplete?.();
      return;
    }
```

On the `<CookCompleteSheet` element, add `onShow={onCompleteShown}`.

- [ ] **Step 3: `CookModeScreen` deducts on completion**

Replace the header comment's last paragraph ("Opening cook mode is also what takes…") with:

```ts
// Finishing the last step is what takes the recipe's ingredients out of the
// pantry — every "Start cooking" (recipe page, recipe cards, chat, saved
// recipes) lands here, so this is the one place that covers them all. Leaving
// early takes nothing. What was taken is shown over the complete sheet, with
// an Undo, since a recipe marked done by mistake shouldn't cost the eggs.
```

Change the `items` prop doc to `/** The pantry as it stands; the recipe's ingredients are taken out of it when the last step is finished. */`.

Replace everything from `const deductedFor = useRef<Recipe | null>(null);` down to the end of `showSummary` with:

```tsx
  // Read when Finish is pressed, not when cook mode opened: the pantry may
  // have changed while the user cooked.
  const itemsRef = useRef(items);
  itemsRef.current = items;

  // Once per cook: keyed on the recipe object, so the pantry refreshing
  // underneath (which it does, straight after this writes) can't take the
  // same ingredients twice.
  const deductedFor = useRef<Recipe | null>(null);
  // The summary waits for both the write and the complete sheet's arrival —
  // an Alert raised while a modal is still presenting can be dropped on iOS.
  const pending = useRef<{ plan: DeductionPlan | null; removalIds: string[]; error: boolean } | null>(null);
  const sheetUp = useRef(false);

  useEffect(() => {
    deductedFor.current = null;
    pending.current = null;
    sheetUp.current = false;
  }, [recipe]);

  function handleComplete() {
    if (!recipe || deductedFor.current === recipe) return;
    deductedFor.current = recipe;

    const plan = planDeduction(recipe, itemsRef.current);
    if (plan.changes.length === 0 && plan.skipped.length === 0) return;
    if (plan.changes.length === 0) {
      pending.current = { plan, removalIds: [], error: false };
      if (sheetUp.current) showSummary();
      return;
    }
    applyDeduction(plan)
      .then((removalIds) => {
        pending.current = { plan, removalIds, error: false };
      })
      .catch(() => {
        pending.current = { plan: null, removalIds: [], error: true };
      })
      .finally(() => {
        if (sheetUp.current) showSummary();
      });
  }

  function handleCompleteShown() {
    sheetUp.current = true;
    showSummary();
  }

  function showSummary() {
    const next = pending.current;
    if (!next) return;
    pending.current = null;
    if (next.error || !next.plan) {
      Alert.alert(
        "Couldn't update your pantry",
        'The ingredients for this recipe were not taken out. Check your connection and adjust the amounts in your pantry by hand.',
      );
      return;
    }
    const { plan, removalIds } = next;
    if (plan.changes.length === 0) {
      Alert.alert('Nothing taken from your pantry', describeDeduction(plan));
      return;
    }
    Alert.alert('Taken from your pantry', describeDeduction(plan), [
      {
        text: 'Undo',
        style: 'destructive',
        onPress: () => {
          undoDeduction(plan, removalIds).catch(() =>
            Alert.alert("Couldn't undo", 'Your pantry could not be put back. Check your connection and try again.'),
          );
        },
      },
      { text: 'OK', style: 'default' },
    ]);
  }
```

On the outer `<Modal`, delete the `onShow={() => { shown.current = true; showSummary(); }}` prop.

Change the `Body` call to `<Body recipe={recipe} onClose={onClose} onComplete={handleComplete} onCompleteShown={handleCompleteShown} />`. Change `Body`'s signature to:

```tsx
function Body({
  recipe,
  onClose,
  onComplete,
  onCompleteShown,
}: {
  recipe: Recipe;
  onClose: () => void;
  onComplete: () => void;
  onCompleteShown: () => void;
}) {
```

Pass `onComplete={onComplete}` and `onCompleteShown={onCompleteShown}` to `<CookStepScreen`.

- [ ] **Step 4: Typecheck and run the cook tests**

Run: `npx tsc --noEmit`
Expected: errors only in the Task 9 files, or none.

Run: `npx jest src/services/__tests__/cookDeduction.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/screens/cook/CookCompleteSheet.tsx src/screens/cook/CookStepScreen.tsx src/screens/CookModeScreen.tsx
git commit -m "App: cook mode takes ingredients when the recipe is finished"
```

---

### Task 9: App — Home chart with View More, and History rows with notes

**Files:**
- Modify: `src/components/home/RemovalChart.tsx`
- Modify: `src/screens/HomeScreen.tsx:26-27, 180, 266-268, 318-330, 622`
- Modify: `src/screens/PantryHistoryScreen.tsx`

**Interfaces:**
- Consumes: `RemovalHistory`, `reasonLabel` (Task 5).
- Produces: `RemovalChart` props `{ counts: Record<RemovalReason, number>; onViewMore: () => void }`.

- [ ] **Step 1: `RemovalChart`**

Header comment: change "six reasons with labels long enough (\"Over-purchased\") to need their own column" to "four reasons, each label in its own column", and "Two colours, not six" to "Two colours, not four".

Add `TouchableOpacity` to the react-native import. Add `Ionicons`: `import { Ionicons } from '@expo/vector-icons';`.

Change `Props`:

```ts
type Props = {
  counts: Record<RemovalReason, number>;
  /** Opens Pantry History, where each removal is listed. */
  onViewMore: () => void;
};
```

Change the signature to `export default function RemovalChart({ counts, onViewMore }: Props)`.

Change the summary line to:

```tsx
      <Text style={styles.summary}>
        {eaten} of {total} removal{total === 1 ? '' : 's'} eaten · {wasted} wasted
      </Text>
```

After the legend `View`, add:

```tsx
      <TouchableOpacity
        style={styles.viewMore}
        onPress={onViewMore}
        accessibilityRole="button"
        accessibilityLabel="View more in Pantry history"
      >
        <Text style={styles.viewMoreText}>View More</Text>
        <Ionicons name="chevron-forward" size={14} color={colors.primaryDark} />
      </TouchableOpacity>
```

Add to the styles:

```ts
  viewMore: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: space.xs,
    marginTop: space.md,
    paddingVertical: space.sm,
  },
  viewMoreText: {
    fontWeight: '700',
    fontSize: type.label.fontSize,
    color: colors.primaryDark,
  },
```

The empty-state branch stays as it is, with no button: there is nothing to view yet.

- [ ] **Step 2: `HomeScreen` keeps the whole history and opens Pantry History**

Imports:

```ts
import RemovalChart from '../components/home/RemovalChart';
import PantryHistoryScreen from './PantryHistoryScreen';
import { RemovalHistory, subscribeToRemovalHistory } from '../services/removals';
```

Change `removalCache` to `const removalCache = new Map<string, RemovalHistory>();`. Change the state to:

```ts
  const [removals, setRemovals] = useState<RemovalHistory | null>(
    () => (uid ? removalCache.get(uid) ?? null : null)
  );
  const [historyOpen, setHistoryOpen] = useState(false);
```

In the subscription callback, change the two lines to `removalCache.set(uid, history);` and `setRemovals(history);`.

Replace `{removals && <RemovalChart counts={removals} />}` with:

```tsx
        {removals && <RemovalChart counts={removals.counts} onViewMore={() => setHistoryOpen(true)} />}
```

Add the screen next to the other modals Home renders, after the closing `</ScrollView>`:

```tsx
      <PantryHistoryScreen
        visible={historyOpen}
        history={removals}
        onClose={() => setHistoryOpen(false)}
      />
```

- [ ] **Step 3: `PantryHistoryScreen` shows notes and counts removals**

Header comment: change "Profile > Pantry history" to "Pantry history, opened from Profile or from View More under Home's chart". Change "how much" to "how much went".

Add `reasonLabel` to the removals import, and remove `REMOVAL_LABELS` from it if nothing else in the file uses it. The filter chips still use it, so keep it.

Change the subtitle's third branch to:

```tsx
                : `${total} removal${total === 1 ? '' : 's'}`}
```

In `HistoryRow`, add `const label = reasonLabel(record);`. Use `label` in the `accessibilityLabel` and in the chip text in place of `REMOVAL_LABELS[record.reason]`, and give the chip text `numberOfLines={1}`. In the styles, add `maxWidth: '50%'` to the `reason` chip style so a long note truncates instead of pushing the name off the row.

- [ ] **Step 4: Typecheck and the full app suite**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx jest`
Expected: all suites pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/home/RemovalChart.tsx src/screens/HomeScreen.tsx src/screens/PantryHistoryScreen.tsx
git commit -m "App: View More under Home's chart opens Pantry history; notes show in History"
```

---

### Task 10: Migrate the data, restart, and check on a phone

**Files:** none changed. This task runs things and reports what happened.

- [ ] **Step 1: Full checks**

Run in the repo root: `npx tsc --noEmit && npx jest`
Run in `server/`: `npx tsc --noEmit && npm test`
Expected: everything passes. Paste the summary lines into the report.

- [ ] **Step 2: Dry run against Atlas**

Run in `server/`: `npx tsx scripts/migrate-removal-reasons.ts`
Expected: two "Would convert N rows…" lines and "Nothing was changed."

**STOP.** Show the user both counts and ask before going on. Do not run `--apply` without a yes.

- [ ] **Step 3: Apply (after the user says yes)**

Run in `server/`: `npx tsx scripts/migrate-removal-reasons.ts --apply`
Expected: "Converted N rows…" with the same counts as the dry run.

- [ ] **Step 4: Restart the presentation stack**

Stop the running `present.ps1` background task, then start `present.ps1` again in the background. It restarts the API with the new routes and rebuilds the bundle with `--clear`. Send the user the new `present-qr.png`. Tell them to swipe away the old project in Expo Go and scan the new QR, because the old bundle sends the old body and gets a 400.

- [ ] **Step 5: Hand the user the phone checklist**

Ask the user to try these on the phone and report back. Don't claim any of them passed until they do:

1. Remove 2 of 5 eggs as Consumed. 3 are left, History has a "2 eggs · Consumed" row, and the chart's Consumed count goes up by one.
2. Remove the rest as Other with a note. The eggs leave the pantry and History shows "Other · {note}".
3. Select three items, Delete, and set an amount for each ("1 of 3", "2 of 3", "3 of 3").
4. Use up half a pack. One step, then Use up, and the pack shows ½ left.
5. Start a recipe and leave cook mode partway. Nothing is taken.
6. Finish a recipe. The summary shows what was taken, and History has Consumed rows with the amounts.
7. Press Undo on that summary. The pantry and History are back to how they were, and earlier rows for the same items are still there.
8. Tap View More under Home's chart. Pantry history opens.
