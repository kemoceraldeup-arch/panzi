# Connect the admin console to the Panzi server

Date: 2026-09-29. Status: approved ("do it all").

## Goal

One Express server that the Expo app and the admin website (`C:\Users\Kenne\Our admin website\Our admin website\admin`) both use at the same time, so the console shows real app activity and nothing the app relies on is lost.

## Background

- Both clients already share Firebase project `panzi-c2830` and the MongoDB Atlas `panzi` database.
- The admin folder carried its own server copy, forked from commit `5b8712f`. It added the `/api/admin/*` routes, the admin claim check, audit logging and AI usage recording. Meanwhile this repo's server gained scan, pantry-removal, profile and email-verification work. Both listen on 8080, so only one could run.

## Decisions

1. **Home:** `panzi-handoff/server` is the only server. The admin copy is renamed `server-old-backup/` and no longer started.
2. **Merge method:** three-way, per shared file, with base `5b8712f`, ours = this repo, theirs = the admin copy. Files that exist only in the admin copy are copied as they are: `routes/admin*.ts`, `usage.ts`, `device.ts`, `middleware/audit.ts`. Their dependencies `helmet` and `express-rate-limit` are added.
3. **Removals:** `pantry_removals` (written by the app) is the one record of an item leaving the pantry. `item_dispositions` and every write to it are dropped; both collections were empty on 2026-09-29, so there is no data to migrate. Admin reports read `pantry_removals`, mapping reasons as follows:
   - `consumed`, `leftover` count as eaten.
   - `spoiled`, `expired`, `over-purchased` count as wasted.
   - `other` has no confirmed outcome and is excluded from rates.
   - The admin-only `portion` concept is removed, and each wasted row weighs 1.
4. **API contract:** routes the app already calls keep their request and response shapes, so the Expo app needs no changes.
5. **Launchers:** the admin `start.bat` starts `panzi-handoff\server`, and its README paths are corrected. `present.ps1` is unchanged.

## Verification

- `npx tsc --noEmit` passes in `server/`.
- The app's jest test passes.
- The server boots against Atlas.
- `/health` returns ok.
- `/api/admin/dashboard` without a token returns 401.
- An app route without a token returns 401, not 404.
- The admin website builds and typechecks against the merged API types.
