# Panzi admin

This folder is the admin website. The API it talks to is the Expo app's own server, `C:\Users\Kenne\panzi-handoff\server`; the app and the console share it. The quickest way to run both is `start.bat` one level up.

Firebase handles identity, MongoDB holds app data, and administrator routes enforce the Firebase admin claim on the server. Paths below written `server/...` mean `panzi-handoff\server\...`.

## Run the connected workspace

Run the backend in one terminal:

```powershell
cd "$HOME\panzi-handoff\server"
npm install
npm run dev
```

Run the admin in a second terminal, from this folder:

```powershell
cd "$HOME\Our admin website\Our admin website\admin"
npm install
npm run dev
```

To look at the design without the server, set `VITE_SAMPLE_DATA=true` and `VITE_SKIP_AUTH=true` for `npm run dev`. Both flags are ignored by `npm run build`.

`start.bat` always overrides these flags to `false` and disables public preview. It replaces a sample-mode Vite process from this workspace instead of silently reusing it. Use the manual `npm run dev` command above for an intentional sample preview.

Use the existing `.env` files. For a fresh checkout, copy each package's `.env.example` and configure it before starting. The admin normally opens at `http://localhost:5173` and the API at `http://localhost:8080`.

- `admin/.env`: set `VITE_API_URL` to the shared API, `VITE_SAMPLE_DATA=false`, and `VITE_SKIP_AUTH=false`. Use the same Firebase project as the app.
- `server/.env`: configure MongoDB Atlas, the Firebase project, and the existing service credentials. `ALLOWED_ORIGINS` must include the exact admin website origin.
- The phone uses `EXPO_PUBLIC_API_URL` from the root environment. During LAN development, use the computer's LAN address; localhost on a phone means the phone itself.
- Pantry removals use MongoDB transactions. Atlas supports these; local MongoDB must run as a replica set.

Use the existing administrator account for the defense/testing setup. No additional administrator accounts are required. To grant the first administrator, run `npx tsx scripts/grant-admin.ts you@example.com` from `server/`, using the project's configured service account. The console itself no longer grants, revokes, or suspends accounts; Settings lists who holds admin access, read-only.

For an isolated local design preview, set both preview flags to `true` for `npm run dev`. Production builds always use the API and require authentication, regardless of those flags.

## Workspace screens

| Screen | Purpose |
|---|---|
| Dashboard | Summary metrics, AI alerts from the last 24 hours, latest open feedback, recent activity |
| Analytics | Scanner corrections and confirmed food outcomes |
| Users | Accounts; the person panel shows their pantry, recent scans, where their food went, their feedback and their AI cost. Other pages open it with `/users?user=<uid>` |
| Feedback | Messages from the app's Help & feedback, with a status (New, In progress, Resolved) and an internal note per message |
| Pantry | Aggregates of stored ingredients; not an editable ingredient catalog |
| Recipes | Dishes people saved, and the stars they gave after cooking |
| Cookbook | Create, read, update and delete the dishes on the app's Recipes screen |
| API costs | Estimated AI usage costs from recorded tokens |
| System logs | API usage, administrator activity, and account deletions |
| Settings | Admin access and read-only app configuration |

Recipes is a connected screen again. It was hidden while it had nothing behind it; `saved_recipes` and `recipe_ratings` now answer the two questions its cards ask, so it reads the server like the rest. Those AI-suggested dishes are not editable: every one is written by the model on the night it is suggested, and the lowercased title is the only identity it has.

## Cookbook

The one screen that changes what people see in the app. It manages the dishes on the app's Recipes screen (the category tabs with Pantry Only off), stored in the `cookbook_recipes` collection.

| Action | In the console | Server route | In the app |
|---|---|---|---|
| Create | Add recipe, fill the side panel, save | `POST /api/admin/cookbook` | Appears at the top of its category |
| Read | The table, with search and category filter | `GET /api/admin/cookbook` | `GET /api/cookbook` loads the list |
| Update | Edit on a row, change, save | `PATCH /api/admin/cookbook/:id` | Shows the change |
| Delete | Delete on a row, confirm | `DELETE /api/admin/cookbook/:id` | Disappears |

The app picks up changes when the Recipes screen opens or is pulled down. Every write is admin-only and recorded in the audit log like the other admin routes. A photo is shrunk to 1000px JPEG in the browser and stored in the Supabase `dish-photos` bucket; it replaces the photo built into the app for that dish. Two administrators editing the same dish cannot overwrite each other: the second save is refused and asks them to reload.

The 51 dishes built into the app were copied in once with `npm run seed:cookbook` in the server folder. Running it again only adds dishes that are missing by title, so it never overwrites an edit, but it does bring back a built-in dish that was deleted. If the server cannot be reached, the app shows the last list it downloaded, or the built-in list.

Each connected screen has Refresh and a last-successful-update timestamp. Light/dark mode follows the system until explicitly selected, then persists across reloads. Date charts and summary values respect reduced motion.

## Removed screens

Conversations and the scan half of Needs review are removed from the admin, including routes, navigation, command search, and review badge requests. Old URLs redirect to Dashboard. Existing backend records and mobile app features are unaffected. The feedback half came back as its own Feedback screen.

The Dashboard's "Expiring in the next 3 days" panel was removed: it listed food across every user's pantry, which an administrator cannot act on. Latest open feedback took its place.

## Food outcomes

- Outcomes come from `pantry_removals`, which the app writes when someone removes an item and picks a reason. The old `item_dispositions` collection is no longer read or written.
- Reasons map to outcomes in `server/src/removalOutcome.ts`:
  - `consumed` and `leftover` count as consumed.
  - `spoiled`, `expired` and `over-purchased` count as wasted.
  - `other` is unclassified.
- Cook mode's undo deletes the rows it created, so food put back on the shelf is never counted.
- Analytics counts consumed and wasted entries. Waste rate uses those confirmed outcomes as its denominator, excluding unclassified removals. Each entry counts once, regardless of its quantity.
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

From this folder:

```powershell
npm run build --prefix "$HOME\panzi-handoff\server"
npm test --prefix "$HOME\panzi-handoff\server"
npm run build
npm run typecheck
```

The server has one unit test today (removal reasons to outcomes). Anything touching the admin routes still needs a look against a real database.

A real-device acceptance pass still needs the configured app and admin accounts: complete onboarding, scan and save food, correct a pantry item, send feedback, then refresh the corresponding admin pages. Remove one item as "consumed" and another as "spoiled"; verify Analytics shows one of each. This confirms Firebase, hosting, device networking, and image recognition in the actual environment.

Deploy the backend and admin together because Analytics now distinguishes raw counts from display percentages. Deploy the updated mobile app to start recording explicit outcomes. Apply the security headers in `vite.config.ts` to the static production host. Configuration details and visual conventions are documented in `DESIGN.md`.


## Browsing

Users and System logs retain server-side search, status/level filters, and 25-row pagination. CSV exports the displayed page. Pantry categories and recipe search/sorting work on the returned data. The redesigned dashboard focuses on food outcomes, scan activity, expiry dates, and shortcuts into the remaining workspace screens.
