# Picking up Panzi

Everything a second developer needs to get the app running on their own machine
and start making changes. If you only want to *demo* the app to someone without
them setting anything up, read `SHARING.md` instead — that is a different job.

## What the thing is

An Expo app plus an Express API. The app never talks to a database; it talks to
the API, and the API talks to MongoDB.

```
Panzi app (Expo)  ─┐
                   ├─→  server/ (Express)  ─→  MongoDB
Admin panel (web) ─┘            │
                                ├─→  Anthropic     (the scanner and recipes)
                                ├─→  firebase-admin (verifies login tokens)
                                └─→  Supabase Storage (avatar files)
```

Firebase does logins and nothing else. There is no Firestore and no Cloud
Functions in the running system — `functions/` is the old Cloud Function the
scanner used before `server/` existed, kept for reference only. Nothing calls
it.

## What you need before you start

| Thing | Where from | Who pays |
|---|---|---|
| Node 20+ | nodejs.org | — |
| An Anthropic API key | console.anthropic.com | whoever owns the key |
| A MongoDB | Atlas free tier, or MongoDB Community locally | free either way |
| Firebase project access | ask the original owner to add you | free (Spark plan) |
| Supabase project | supabase.com, free tier | free |

You do **not** need the Firebase Blaze plan. Everything that used to require it
was moved to `server/`.

## Setup

```sh
git clone <the repo>
cd panzi
npm install
cd server && npm install && cd ..
```

Then two `.env` files, neither of which is in the repo. Copy the examples and
fill them in.

**`server/.env`** — copy from `server/.env.example`. The values that matter:

- `ANTHROPIC_API_KEY` — every scan and every recipe costs money against this
  key. Get your own rather than sharing one; see "Cost" below.
- `MONGODB_URI` — Atlas gives you this under Connect → Drivers. Add the
  database name before the query string:
  `mongodb+srv://user:pass@cluster0.xxxxx.mongodb.net/panzi?retryWrites=true&w=majority`
  A local install works too: `mongodb://127.0.0.1:27017/panzi`
- `FIREBASE_PROJECT_ID` — already filled in with the shared project. Leave it
  unless you are making your own.
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` — only needed for profile
  photos. Everything else runs without them.

**`.env`** in the repo root — copy from `.env.example`. One value:

- `EXPO_PUBLIC_API_URL` — this computer's LAN address, not `localhost`. The app
  runs on your phone, where `localhost` means the phone. Find it with
  `ipconfig` and take the IPv4 address of the adapter you are actually on. It
  changes when you switch networks, and the app shows "could not reach the
  server" when it is wrong.

## Running it

Two terminals.

```sh
cd server && npm run dev     # http://localhost:8080
```

```sh
npx expo start               # scan the QR with Expo Go
```

Check the server first: `curl http://localhost:8080/health` should return
`{"ok":true}`. The phone and the computer must be on the same wifi.

## Verifying it works

Sign in, add a pantry item, then look at the database. If the document is there
with your Firebase uid in `userId`, the whole chain works.

MongoDB Compass is the easiest way to look. Connect to your `MONGODB_URI` and
open the `panzi` database. Five collections:

| Collection | Holds |
|---|---|
| `users` | one document per account, keyed by Firebase uid |
| `pantry_items` | the shelves |
| `saved_recipes` | dishes the user kept |
| `scans` | scan history, so a scan can be finished later |
| `feedback` | what "Send feedback" writes |

Images are **not** in MongoDB. Only their URLs are — the files live in Supabase
Storage (avatars) and Firebase Storage (scan and item photos).

## The rules that are not obvious

**Never trust a user id from a request body.** Every route reads `req.uid`,
which `requireAuth` puts there after verifying a Firebase token. Queries are
written as `updateOne({ _id, userId })` rather than a fetch followed by a
permission check, so the owner cannot be forgotten halfway down a function.
This is the only thing stopping any signed-in account from reading any other
account's pantry.

**The Anthropic key never goes near the app.** Expo inlines every
`EXPO_PUBLIC_*` variable into the bundle, and the bundle ships to every phone.
That is the entire reason `server/` exists.

**Document ids are generated on the phone**, in `src/utils/ids.ts`, before the
write is sent. The scan modal wires up "N items added · Undo" the moment a batch
is approved, and waiting for the server to mint an id would mean waiting for a
round trip before the interface could respond.

**There is no live database listener.** `src/services/live.ts` replaced
Firestore's `onSnapshot`: a write refreshes its own key immediately, screens
watching the same key share one request, and returning to the app refetches. A
change made on a *second device* appears on the next poll rather than within the
second. If you add a new collection, follow the same pattern — subscribe through
`subscribeToKey`, and call `refreshKey` after every write.

**Estimates must stay visibly estimates.** The scanner is allowed to guess a
shelf life for loose fruit with no printed date. The deal that makes that
acceptable is `dateSource`, which travels with the item for its whole life.
Anything that drops or overwrites that field turns a guess into a fact.

## Cost

Each scan costs roughly $0.065 against the Anthropic key, and each recipe
generation about $0.039 — the scan route uses `claude-opus-5`, recipes use
`claude-sonnet-5`. There is no free tier. Get your own key rather than sharing
one, or you will be spending someone else's money every time you press the
shutter during development.

Measure before quoting those numbers anywhere: `client.messages.countTokens`
on a real request gives the exact figure.

## Known broken

**Scan photo uploads.** Firebase Storage returns `storage/unknown` on this
project, so scan and item photos never leave the device. The app degrades
gracefully — rows show a plain tile instead of a photo — but pictures do not
sync to a second device. Avatars are unaffected; they go through the server to
Supabase instead.

## Still to build

- `/api/admin/*` and the admin web panel — recognition accuracy across users,
  API cost per scan, most-wasted categories
- `/api/chat`
- A data migration script, if there is ever Firestore data worth importing

## Secrets

`.env` files are gitignored, including backups like `.env.backup`. Never commit
one, never paste a key into a chat or an issue, and if a key does reach a commit
treat it as burned — rotate it in the Anthropic console rather than deleting the
commit and hoping.
