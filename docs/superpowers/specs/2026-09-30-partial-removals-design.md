# Partial removals, four reasons, and cooking takes from the pantry at the finish

Date: 2026-09-30. Status: spec approved 2026-10-01.

## Goal

Removing food from the pantry says how much went, not just which item. Every removal, whole or partial, is kept in History, and History is what Home's graph and Pantry History show. The reasons are the four Panzi can actually tell apart, plus a free-text "Other". Cook mode takes a recipe's ingredients out when the recipe is finished and records what it took.

## Background

- `POST /api/pantry/remove` takes `{ ids, reason }`, writes one `pantry_removals` row per item holding the item's whole quantity, then deletes the items. There is no partial removal.
- Home's "Where your food went" chart (`src/components/home/RemovalChart.tsx`) already reads the per-reason counts from `GET /api/pantry/history`, which counts `pantry_removals`, not current pantry items. Removed items already stay on the graph. Pantry History (`src/screens/PantryHistoryScreen.tsx`) is only reachable from Profile.
- Reasons are `consumed, spoiled, expired, leftover, over-purchased, other`, defined in both `src/services/removals.ts` and `server/src/models.ts`. The admin console maps them in `server/src/removalOutcome.ts` and labels them in `admin/src/screens/Users.tsx` (admin website folder, not a git repo).
- Cook mode (`src/screens/CookModeScreen.tsx`) runs `planDeduction`/`applyDeduction` (`src/services/cookDeduction.ts`) when the screen opens. Partly used items are updated with `updatePantryItem` and leave no History row. Used-up items go through `removePantryItems(ids, 'consumed')`.
- Undo (`POST /api/pantry/history/undo`) deletes every row for the given item ids.
- `src/services/quantity.ts` parses and formats pantry quantities (`parseQuantityString`, `formatQuantityString`). `MeasureControl` (`src/screens/scan/atoms.tsx`) is the amount stepper the edit and scan screens use.

## Decisions

### 1. Reasons

- The reasons are `consumed`, `spoiled`, `expired` and `other`, in that order, on the client and server.
- `consumed` is eaten; the other three are waste on Home's graph, as now.
- Admin mapping: `consumed` is eaten; `spoiled` and `expired` are wasted; `other` is unclassified.
- `other` must carry a `note`: free text, trimmed, at most 80 characters. A blank note is refused (the app keeps Save off until something is typed; the server answers 400 "Say why it is going."). A note sent with any other reason is ignored. (Changed 2026-10-01 at the user's request; it was optional before.)

### 2. Converting existing rows

A one-time script `server/scripts/migrate-removal-reasons.ts`:

- sets `leftover` rows to `consumed`;
- sets `over-purchased` rows to `other` with note `Over-purchased`;
- prints the number of rows it would change and exits unless run with `--apply`.

It is run with `--apply` against Atlas only after the user has seen the dry-run count. The server's reason list is narrowed in the same change, so the script runs before the new server serves traffic. Mongoose's enum is only checked on write, so old rows still read fine in between.

### 3. Server API

`POST /api/pantry/remove` body:

```json
{
  "items": [{ "id": "…", "removed": "2 eggs", "remaining": "3 eggs" }],
  "reason": "other",
  "note": "Gave to neighbour"
}
```

- `removed` is the quantity string recorded in History. It must not be empty.
- `remaining` is the item's new quantity, or `null` when nothing is left.
- For each item that belongs to the caller, the server writes the History row first, then sets the item's quantity to `remaining` or deletes it when `remaining` is `null`. Items not found are skipped.
- The app computes both strings; the server does not do quantity arithmetic.
- The response is `{ ok: true, removalIds: [...] }`, one id per row written, in item order.
- The old `{ ids, reason }` body is no longer accepted. The Expo app is the only caller and ships with the server.

`pantry_removals` gains `note: String | null` (default `null`). `quantity` now means the amount removed in that row.

`GET /api/pantry/history` returns `note` on each record and counts for the four reasons only.

`POST /api/pantry/history/undo` takes `{ removalIds }` and deletes exactly those rows, scoped to the caller. The item-id form is removed.

Admin: `removalOutcome.ts` and its test drop the two old reasons. Wherever the admin routes return a removal row, `note` is included. The Users screen's reason labels drop the two old reasons and show the note after "Other".

### 4. App: removing from the Pantry list

The sheet (`RemovalReasonSheet`, reworked) has two steps.

1. **How much?** This step covers one item at a time.
   - It shows the item's name, and "N of M" when several are selected.
   - A `MeasureControl` in the item's own measure starts at the full amount, with an **All** shortcut.
   - The step ends with a Next button.
   - When the item's quantity has no number in it (e.g. "a bit"), the stepper is not shown and only "All" is offered.
   - Choosing zero is not possible.
2. **Why is it going?** One pick for all items in this removal: Consumed, Spoiled, Expired or Other.
   - Picking Other shows a text field (80 characters) and a Save button. The other three save on tap, as now.
   - "Added by mistake — delete without recording" stays on this step and deletes every selected item whole with no History rows, as now.

**Use up** runs step 1 only and saves as `consumed`. Its current confirm alert is removed, because the sheet's own Next button is the deliberate action.

The app builds each item's `removed` and `remaining` strings from the chosen amount with `quantity.ts`. When the whole amount is chosen, `removed` is the item's current quantity unchanged and `remaining` is `null`.

`removePantryItems` becomes `removeFromPantry(items: { id, removed, remaining }[], reason, note?)` and returns the removal ids.

### 5. App: cook mode

- The deduction runs when the last step is completed, i.e. when `CookStepScreen` shows the complete sheet. `CookStepScreen` gets an `onComplete` prop, which `CookModeScreen` uses in place of its open-time effect.
- It plans against the pantry as it is at that moment. Leaving cook mode early takes nothing.
- `applyDeduction` sends every change, partial or whole, through one `removeFromPantry(…, 'consumed')` call. `removed` is the amount the recipe took, formatted in the item's measure.
- The plan records the returned removal ids.
- `undoDeduction` does three things:
  - restores quantities for partly used items;
  - re-adds used-up items with `restorePantryItems`;
  - calls undo with the plan's removal ids.
- The summary alert with Undo appears after the complete sheet is up. The existing wait-for-modal handling is kept.

`DeductionChange` gains a `removed: string` field. `planDeduction` computes it from the amount actually taken.

### 6. App: Home graph and History

- `RemovalChart` shows the four reasons. Its summary reads "{eaten} of {total} removals eaten · {wasted} wasted", and its empty-state text is unchanged.
- A **View More** button under the chart opens `PantryHistoryScreen`. Home already subscribes to the history, so it keeps the full `RemovalHistory` rather than just the counts.
- The graph counts removal rows. Two partial removals of one item count twice.
- A History row reads "{name}", then "{removed amount} · {time}", then the reason chip. For Other with a note, the chip reads "Other · {note}".
- The reason filter chips are the four reasons.

## Out of scope

- Editing or deleting History rows, which stay read-only.
- Summing amounts across units on the graph.
- Changing `/api/pantry/delete` or the scan Undo.

## Verification

- New and updated tests, written before the code they cover:
  - `removed`/`remaining` construction for each measure (pieces, pack, weight, volume) and for non-numeric quantities;
  - `planDeduction` fills `removed`;
  - `removalOutcome` covers the four reasons;
  - `/remove` handles partial, whole, notes, rejected old reasons and foreign ids;
  - undo by removal id leaves other rows for the same item alone;
  - the migration script counts and converts.
- `npx tsc --noEmit` passes in the app and in `server/`. The app's jest suite and the server tests pass.
- The migration dry run against Atlas prints its count to the user before `--apply` is run.
- By hand, on a phone through `start.bat`:
  - remove 2 of 5 eggs as Consumed and see 3 left, with a History row and the graph count going up;
  - remove the rest as Other with a note and see the note in History;
  - remove three selected items with an amount each;
  - use up half a pack;
  - quit cook mode partway and see nothing taken;
  - finish a recipe and see partial and whole Consumed rows;
  - press Undo and see the pantry and History restored;
  - tap View More and see Pantry History open.
