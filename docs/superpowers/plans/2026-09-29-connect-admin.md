# Connect Admin Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `panzi-handoff/server` the one API that serves both the Expo app and the admin website.

**Architecture:** Three-way merge of the admin copy's server changes (base `5b8712f`) into this repo's server. Copy over the admin-only files. Point the admin reports at the app's `pantry_removals` collection instead of `item_dispositions`. Switch the admin launcher to this server.

**Tech Stack:** Express 5 + TypeScript (tsx), Mongoose / MongoDB Atlas, Firebase Admin, `node:test` via tsx.

**Spec:** `docs/superpowers/specs/2026-09-29-connect-admin-design.md`

## Global Constraints

- Routes the app already calls keep their request/response shapes; no Expo app code changes.
- `item_dispositions` is no longer read or written anywhere.
- Reason mapping:
  - `consumed`, `leftover` → eaten.
  - `spoiled`, `expired`, `over-purchased` → wasted.
  - `other` → unclassified.
- Server must pass `npx tsc --noEmit` (strict, `noUnusedLocals`).
- Secrets (`.env`, `serviceAccount.json`) are never committed.

Paths below use these names:
- **ADMIN** = `C:\Users\Kenne\Our admin website\Our admin website`
- **MERGE** = scratchpad `merge/` folder holding `base/`, `theirs/` and `out/` copies of each shared file, with LF line endings

## Review Focus

- **A removal with an unknown or legacy reason string** must count as unclassified, never crash the analytics route. Test: `outcomeOf('whatever')` returns `'unclassified'`.
- **Account deletion** must remove the user's `pantry_removals` rows, and the export must include them exactly once. Covered in Task 2 by reading the merged `profile.ts`.
- **A phone request without the admin claim** hitting `/api/admin/*` must get 401/403, never data. Test: curl in Task 4.
- **The app's scan route** must still run the fill-level pass AND record usage; neither side of the conflict may be dropped. Covered in Task 1, conflict resolution plus typecheck.
- **CORS:** the admin origin `http://localhost:5173` is allowed and a native app (no Origin header) still works. Test: curl without an Origin header in Task 4.

---

### Task 1: Merge the admin server changes

**Files:**
- Modify: 14 shared files under `server/src/`: `index.ts`, `mail.ts`, `middleware/auth.ts`, `models.ts`, `routes/{chat,helpers,pantry,panziIntent,profile,recipeRatings,recipes,savedRecipes,scan,verifyEmail}.ts`
- Create (copied from ADMIN/server/src): `usage.ts`, `device.ts`, `middleware/audit.ts`, `routes/admin.ts`, `routes/adminAccess.ts`, `routes/adminAlerts.ts`, `routes/adminBrowse.ts`, `routes/adminCatalog.ts`, `routes/adminReports.ts`, `routes/adminReview.ts`
- Modify: `server/package.json` (add `helmet`, `express-rate-limit`), plus any `server/scripts/*` the admin copy has that this one lacks (e.g. `npm run check`)

- [ ] Step 1: Copy each MERGE/out file (already merged with `git merge-file`) into `server/src/`.
- [ ] Step 2: Resolve the conflicts:
  - `pantry.ts` imports: keep the app line plus `localDay` only if still used after Task 2.
  - `profile.ts`: import both `PantryRemoval` and `RecipeRating`. The export reads `pantryRemovals` from `PantryRemoval` and adds `feedback` and `ratings`.
  - `scan.ts`: keep BOTH `measureFillLevels` and `recordUsage`.
- [ ] Step 3: Copy the admin-only files. Run `npm install helmet@^8.3.0 express-rate-limit@^8.7.0` in `server/`.
- [ ] Step 4: Run `npx tsc --noEmit` in `server/`. Expected: only errors that come from `ItemDisposition` (fixed in Task 2).
- [ ] Step 5: Commit after Task 2 is also typechecking (one commit covers both tasks, since neither compiles alone).

### Task 2: Admin reports read `pantry_removals`

**Files:**
- Create: `server/src/removalOutcome.ts`, `server/src/removalOutcome.test.ts`
- Modify: `server/src/routes/adminReports.ts` (`/analytics`), `server/src/routes/pantry.ts`, `server/src/routes/profile.ts`, `server/src/models.ts` (drop `itemDispositionSchema` / `ItemDisposition`)

**Interfaces:**
- Produces: `export type RemovalOutcome = 'eaten' | 'wasted' | 'unclassified'` and `export function outcomeOf(reason: string): RemovalOutcome`

- [ ] Step 1: Write the failing test.

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { outcomeOf } from './removalOutcome';

test('eaten reasons', () => {
  assert.equal(outcomeOf('consumed'), 'eaten');
  assert.equal(outcomeOf('leftover'), 'eaten');
});
test('wasted reasons', () => {
  for (const r of ['spoiled', 'expired', 'over-purchased']) assert.equal(outcomeOf(r), 'wasted');
});
test('other and unknown reasons are unclassified', () => {
  assert.equal(outcomeOf('other'), 'unclassified');
  assert.equal(outcomeOf('discarded'), 'unclassified');
  assert.equal(outcomeOf(''), 'unclassified');
});
```

- [ ] Step 2: Run `npx tsx --test src/removalOutcome.test.ts`. Expected: FAIL, because the module is not found.
- [ ] Step 3: Implement.

```ts
import type { REMOVAL_REASONS } from './models';

export type RemovalOutcome = 'eaten' | 'wasted' | 'unclassified';

const OUTCOMES: Record<(typeof REMOVAL_REASONS)[number], RemovalOutcome> = {
  consumed: 'eaten',
  leftover: 'eaten',
  spoiled: 'wasted',
  expired: 'wasted',
  'over-purchased': 'wasted',
  other: 'unclassified',
};

export function outcomeOf(reason: string): RemovalOutcome {
  return OUTCOMES[reason as keyof typeof OUTCOMES] ?? 'unclassified';
}
```

- [ ] Step 4: Run the test. Expected: PASS.
- [ ] Step 5: In `/analytics`:
  - Query `PantryRemoval.find({ removedAt: { $gte: from } }).select({ name: 1, reason: 1, removedAt: 1 })`.
  - Split rows with `outcomeOf`.
  - Bucket by `removedAt`.
  - Drop the "Waste by amount" stat and the `share`/`portion` logic.
  - Update the note text to name the app's reasons.
- [ ] Step 6: In `pantry.ts`, remove any leftover `ItemDisposition` writes. The app's own `PantryRemoval` writes stay as they are.
- [ ] Step 7: In `profile.ts`, delete and export use `PantryRemoval` only.
- [ ] Step 8: Remove `ItemDisposition` from `models.ts`. Grep `server/src` for `ItemDisposition|item_dispositions`. Expected: no hits.
- [ ] Step 9: Run `npx tsc --noEmit`. Expected: 0 errors. Run the root `npx jest`. Expected: passes.
- [ ] Step 10: Commit: "Merge admin console API into server; reports read pantry_removals".

### Task 3: Launcher and docs

**Files:**
- Modify: `ADMIN/start.bat`, `ADMIN/README.md`, `ADMIN/scripts/prepare-connected-admin.ps1` (only if it references `server\`)
- Rename: `ADMIN/server` → `ADMIN/server-old-backup`
- Modify: `server/README.md` (list the admin routes; note that the console lives in ADMIN)

- [ ] Step 1: In `start.bat`, set `SERVER_DIR=%USERPROFILE%\panzi-handoff\server`. Use it for the key-file checks, `npm install` and the API window.
- [ ] Step 2: Rename the old server folder. Fix the README paths (`$HOME\Our admin website\Our admin website\...`, server at `$HOME\panzi-handoff\server`).
- [ ] Step 3: Commit the repo-side README change. The ADMIN folder is not in git.

### Task 4: End-to-end verification

- [ ] Step 1: Start the server (`npm run dev` in `server/`). Expected: it logs that it is listening on 8080 and Mongo is connected.
- [ ] Step 2: Check the routes with curl:
  - `curl localhost:8080/health` → 200.
  - `curl -i localhost:8080/api/admin/dashboard` → 401.
  - `curl -i localhost:8080/api/pantry` → 401 (not 404).
  - Curl with `-H "Origin: http://localhost:5173"` → the `Access-Control-Allow-Origin` header is present.
- [ ] Step 3: Run `npm run typecheck` and `npm run build` in `ADMIN/admin`. Expected: pass.
- [ ] Step 4: Start the admin dev server and load `http://localhost:5173`. Expected: the sign-in page renders, with no "Failed to fetch" error.
