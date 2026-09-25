# Panzi admin

This folder is the admin website. The API it talks to is the sibling `server/` folder (`Our admin website\server`), and the Expo app talks to the same API. The quickest way to run both is `start.bat` one level up.

The admin website and Expo app share the Express API in `server/`. Firebase handles identity, MongoDB holds app data, and administrator routes enforce the Firebase admin claim on the server.

## Run the connected workspace

Run the backend in one terminal:

```powershell
cd "$HOME\Desktop\Our admin website\server"
npm install
npm run dev
```

Run the admin in a second terminal, from this folder:

```powershell
cd "$HOME\Desktop\Our admin website\admin"
npm install
npm run dev
```

To look at the design without the server, set `VITE_SAMPLE_DATA=true` and `VITE_SKIP_AUTH=true` for `npm run dev`. Both flags are ignored by `npm run build`.

Use the existing `.env` files. For a fresh checkout, copy each package's `.env.example` and configure it before starting. The admin normally opens at `http://localhost:5173` and the API at `http://localhost:8080`.

- `admin/.env`: set `VITE_API_URL` to the shared API, `VITE_SAMPLE_DATA=false`, and `VITE_SKIP_AUTH=false`. Use the same Firebase project as the app.
- `server/.env`: configure MongoDB Atlas, the Firebase project, and the existing service credentials. `ALLOWED_ORIGINS` must include the exact admin website origin.
- The phone uses `EXPO_PUBLIC_API_URL` from the root environment. During LAN development, use the computer's LAN address; localhost on a phone means the phone itself.
- Pantry removals use MongoDB transactions. Atlas supports these; local MongoDB must run as a replica set.

Use the existing administrator account for the defense/testing setup. No additional administrator accounts are required. To grant the first administrator, run `npx tsx scripts/grant-admin.ts you@example.com` from `server/`, using the project's configured service account. The console itself no longer grants, revokes, or suspends accounts; Settings lists who holds admin access, read-only.

For an isolated local design preview, set both preview flags to `true` for `npm run dev`. Production builds always use the API and require authentication, regardless of those flags. Review writes are disabled in sample mode.

## Workspace screens

| Screen | Purpose |
|---|---|
| Dashboard | Recent app activity and summary metrics |
| Analytics | Scanner corrections and confirmed food outcomes |
| Users | Account support, pantry inspection, suspension, and admin grants |
| Pantry insights | Aggregates of stored ingredients; not an editable ingredient catalog |
| Recipes | Dishes people saved, and the stars they gave after cooking |
| Needs review | Scan issues and feedback with saved status and internal notes |
| Conversations | Conversation summaries and separately audited transcripts |
| API costs | Estimated AI usage costs from recorded tokens |
| System logs | API usage, administrator activity, and account deletions |
| Settings | Admin access, with technical configuration collapsed by default |

Recipes is a connected screen again. It was hidden while it had nothing behind it; `saved_recipes` and `recipe_ratings` now answer the two questions its cards ask, so it reads the server like the rest. There is still no recipe catalog to edit: every dish is written by the model on the night it is suggested, and the lowercased title is the only identity it has.

Each connected screen has Refresh and a last-successful-update timestamp. Light/dark mode follows the system until explicitly selected, then persists across reloads. Date charts and summary values respect reduced motion.

## Review workflow

`GET /api/admin/review?status=open&page=1` returns separate scan and feedback queues, with 20 records per queue per page. Filters are `open`, `new`, `in_progress`, `resolved`, and `all`. Status filtering happens before pagination, so resolved records do not conceal older pending work. CSV exports the current queue page.

`PATCH /api/admin/review/:kind/:id` accepts `{ status, note, revision }`; kind is `scans` or `feedback`. Notes are limited to 2,000 characters. A revision conflict returns 409 instead of overwriting another administrator's edits. The UI preserves the draft and offers an explicit reload of the latest decision.

Decisions live in `admin_reviews`, separate from app records. The server records the verified actor and update time. Administrator activity is also recorded by the existing audit middleware. Internal notes never enter mobile scan responses. Resolving an issue records a support decision; it does not alter the user's scan or pantry. Resolved work remains available for reopening.

## Food outcomes

- The pantry list's Use up sends `consumed`; its Delete sends `removed`, because "Remove from your pantry" is not a statement that the food was thrown away.
- Undo, Clear pantry, and older clients without a reason remain unclassified. Legacy `expired` outcomes still count as discarded.
- Removal and outcome recording commit in one MongoDB transaction. Failed recording leaves the pantry entry intact; repeated deletions do not duplicate outcomes.
- Analytics counts confirmed consumed/discarded entries. Waste rate uses confirmed outcomes as its denominator, excluding unclassified removals. Each entry counts once, regardless of its quantity.
- Chart values and CSV rows contain actual counts; percentage fields control bar heights only.

## Expiry provenance

Phase 2 gave pantry items a `basis` next to the older `dateSource`, and the console folds both into one set of buckets (`provenanceBucket` in `server/src/routes/admin.ts`):

| Bucket | Written by |
|---|---|
| `printed` | `basis: 'printed'`, or legacy `dateSource: 'label'` |
| `typed` | `basis: 'manual'`, or legacy `dateSource: 'user'` |
| `rough` | `basis: 'rough'` — a chip pick such as "about a week" |
| `estimated` | `basis: 'estimated'`, or legacy `dateSource: 'estimated'` — Panzi's own use-by |
| `unknown` | `expiryUnknown: true` — the person said they do not know |
| `none` | nothing recorded yet |

Anywhere the console reads a due date it reads `expiryDate ?? estimatedUseBy`, the same one timeline the app sorts by: the dashboard's 72-hour card, the undated count on System health, the typical shelf life on Pantry insights, and the pantry snapshot in a user's record, which marks an estimate as `(est.)` rather than passing it off as a stated date. Pantry insights also shows how many rows Panzi dated for an ingredient and what share of those were high confidence, from `estimateInputs.confidence`.

## Verification

From the repository root:

```powershell
npm run build --prefix server
npm run build --prefix admin
npx tsc --noEmit
```

The backend test suite that shipped with the earlier admin branch is not in this tree; `npm test --prefix server` has nothing to run. The three commands above are the whole of what is checked automatically today, so anything touching the admin routes still needs a look against a real database.

A real-device acceptance pass still needs the configured app and admin accounts: complete onboarding, scan and save food, correct a pantry item, send feedback, then refresh the corresponding admin pages. Use up one item and discard another; verify the outcomes. Save and reopen a review, then verify it after signing in again with the same administrator account. This confirms Firebase, hosting, device networking, and image recognition in the actual environment.

Deploy the backend and admin together because Analytics now distinguishes raw counts from display percentages. Deploy the updated mobile app to start recording explicit outcomes. Apply the security headers in `vite.config.ts` to the static production host. Configuration details and visual conventions are documented in `DESIGN.md`.


## Browsing and operational alerts

Users, Conversations, and System logs request 25 rows per page from the server. Search and filters run before pagination, and CSV exports the displayed page. Date filters support all time or the last 7, 30, or 90 days: Users filters signup dates, Conversations filters last activity, Review filters submission dates, and Logs filters recorded timestamps. Review retains its 20-row pages.

List endpoints accept page, q, range, and an optional before timestamp. Responses include pagination metadata with an asOf cutoff. The UI carries that cutoff across pages and clears it on Refresh or filter changes. This keeps incoming log entries from shifting pages. Users still joins Firebase identity with Mongo activity before filtering on the server; this is suitable for the defense dataset, but large-scale identity browsing would need a synchronized search index.

The Dashboard checks `/api/admin/alerts` when opened and when refreshed. Conditions use recorded AI requests in rolling 24-hour windows:

- At least three failures, or at least three responses slower than ten seconds.
- At least thirty requests, at least twice the prior 24-hour count, with at least ten prior requests.
- Estimated spend reaching `ADMIN_DAILY_BUDGET_USD`, when a positive budget is configured in the server environment.
- Requests whose model has no usable price estimate.

Alerts link to matching logs or API costs, and clear when the recorded condition no longer applies. They do not send email, notifications, or change app behavior. An empty log is not an uptime measurement. The existing administrator login, permissions, and accounts are retained.
