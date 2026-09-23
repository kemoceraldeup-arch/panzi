# Panzi API

One backend for two clients: the Expo app and, later, the admin panel.

It replaces both halves of the old Firebase backend — Firestore for data and
Cloud Functions for the scanner. Firebase stays in the stack for logins only,
which is free on the Spark plan. Nothing here needs the Blaze plan.

## What runs where

```
Panzi app (Expo)  ─┐
                   ├─→  this server  ─→  MongoDB Atlas
Admin panel (web) ─┘         │
                             ├─→  OpenAI  (the scanner)
                             └─→  firebase-admin  (verifies login tokens)
```

## Setup

```bash
cd server
npm install
cp .env.example .env      # then fill in OPENAI_API_KEY
npm run dev
```

The OpenAI key is the only secret in `.env`, and `.env` is gitignored. It
must never be pasted into a source file, a chat, or a commit.

Point the app at the server by copying the repo root's `.env.example` to `.env`
and setting `EXPO_PUBLIC_API_URL` to this computer's LAN address. `localhost`
will not work: the app runs on the phone, where localhost means the phone.

## Routes

| Method | Path                       | Auth       | Does |
| ------ | -------------------------- | ---------- | ---- |
| GET    | `/health`                  | none       | liveness check for the host |
| POST   | `/api/scan`                | user token | reads a photo, returns pantry candidates |
| POST   | `/api/recipes`             | user token | suggests dishes for tonight |
| GET    | `/api/pantry`              | user token | the shelves, soonest-expiring first |
| POST   | `/api/pantry/add`          | user token | writes a whole approved scan at once |
| POST   | `/api/pantry/update`       | user token | corrections onto one item |
| POST   | `/api/pantry/patch-many`   | user token | different fields onto different items, one write |
| POST   | `/api/pantry/delete`       | user token | removes items; also what Undo calls |
| POST   | `/api/pantry/move`         | user token | changes an item's storage location |
| POST   | `/api/pantry/scan-photo`   | user token | points a scan's items at the uploaded capture |
| GET    | `/api/profile`             | user token | the user document |
| POST   | `/api/profile/survey`      | user token | the onboarding answers; the only writer of `name` |
| POST   | `/api/profile/save`        | user token | merges diets, allergies, photo URL |
| POST   | `/api/profile/photo`       | user token | uploads an avatar to Supabase Storage |
| POST   | `/api/profile/photo/remove`| user token | deletes it again |
| GET    | `/api/saved-recipes`       | user token | dishes the user kept |
| POST   | `/api/saved-recipes/save`  | user token | keeps one; saving twice overwrites |
| POST   | `/api/saved-recipes/unsave`| user token | drops one |
| GET    | `/api/scans`               | user token | scan history, newest first, capped at 30 |
| POST   | `/api/scans/save`          | user token | records a scan that just landed |
| POST   | `/api/scans/update`        | user token | corrections made later from history |
| POST   | `/api/scans/photo`         | user token | repoints a scan at its uploaded capture |
| POST   | `/api/feedback`            | user token | what "Send feedback" writes |

Still to build: `/api/chat`, `/api/admin/*`.

## Data

MongoDB Atlas, through Mongoose. Five collections — `users`, `pantry_items`,
`saved_recipes`, `scans`, `feedback` — defined in `src/models.ts`.

Two things are true of all of them. `_id` is a String rather than an ObjectId,
because the app generates ids before it writes: the scan modal wires up "N items
added · Undo" the moment a batch is approved, and waiting for the server to mint
an id would mean waiting for a round trip before the interface could respond.
And every query filters on `userId` taken from the verified token — written as
`updateOne({ _id, userId })` rather than a fetch followed by a permission check,
so the owner cannot be forgotten halfway down a function.

The connection opens lazily on the first request that needs it (`src/mongo.ts`),
so running only the scanner still needs no cluster and no connection string.

The app has no database client of its own any more. Firebase is down to
identity; there is no Firestore, and therefore no security rules to keep in step
with these routes.

## Auth

The phone signs in with the Firebase SDK and sends the resulting ID token as
`Authorization: Bearer <token>`. `requireAuth` verifies the signature against
Google's public keys and puts the user id on `req.uid`.

Routes read `req.uid`. They must never trust a user id sent in a body or a
query string — a client can write anything into a payload, but it cannot forge
a token signed by Google.

Admin rights ride on a Firebase custom claim rather than a database field, so a
compromised Mongo document cannot promote anyone. Granting one needs a service
account:

```js
await admin.auth().setCustomUserClaims(uid, { admin: true });
```

## Deploying

Any Node host works — Render, Fly, Railway, a VPS. Set the same environment
variables there. Free tiers sleep after a few minutes idle and cold-start
slowly, which reads as a broken scanner during a demo; an always-on instance is
worth the small monthly cost before showing it to anyone.
