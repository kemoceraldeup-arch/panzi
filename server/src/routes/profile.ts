// server/src/routes/profile.ts
//
// The account's own picture. One object per user at a fixed path, overwritten
// in place, so an account can never accumulate a trail of avatars nobody can
// see and there is nothing to clean up when one is replaced.
//
// The path is built from req.uid — the token this server verified — and never
// from anything in the body. That is the only thing standing between this
// endpoint and any signed-in user overwriting any other user's avatar.

import { Router } from 'express';
import admin from '../firebase';
import { AVATAR_BUCKET, supabase } from '../supabase';
import {
  ChatConversation,
  ChatMessage,
  DeletionAuditLog,
  EmailVerification,
  Feedback,
  PantryItem,
  SavedRecipe,
  Scan,
  User,
} from '../models';
import { badRequest, withDb } from './helpers';

export const profileRouter = Router();

// The phone shrinks an avatar to 400px before sending, which lands around 40KB
// — roughly 55KB once base64 has added its third. A megabyte is far above any
// legitimate avatar and far below the 10mb body limit, so an oversized one is
// rejected here with a sentence rather than by Express with a stack trace.
const MAX_BASE64_LENGTH = 1_000_000;

function objectPath(uid: string): string {
  return `users/${uid}/avatar.jpg`;
}

profileRouter.post('/photo', async (req, res) => {
  const uid = req.uid!;
  const { imageBase64 } = (req.body ?? {}) as { imageBase64?: string };

  if (typeof imageBase64 !== 'string' || !imageBase64) {
    res.status(400).json({ error: 'bad-request', message: 'No photo was sent.' });
    return;
  }
  if (imageBase64.length > MAX_BASE64_LENGTH) {
    res.status(413).json({ error: 'too-large', message: 'That photo is too big.' });
    return;
  }

  const path = objectPath(uid);

  try {
    const { error } = await supabase()
      .storage.from(AVATAR_BUCKET)
      .upload(path, Buffer.from(imageBase64, 'base64'), {
        contentType: 'image/jpeg',
        upsert: true,
        // A minute rather than Supabase's hour. CDN cache invalidation on
        // delete is a paid feature, so this number is how long a removed
        // avatar stays fetchable by anyone holding its URL. Replacement does
        // not depend on it — that gets a fresh URL below — so the only thing a
        // longer cache would buy is bandwidth on a 40KB file.
        cacheControl: '60',
      });
    if (error) throw error;

    const { data } = supabase().storage.from(AVATAR_BUCKET).getPublicUrl(path);

    // The path never changes, so neither does the public URL — which means a
    // replaced photo would keep showing the old bytes out of the CDN and out of
    // the phone's own image cache. The version parameter is what makes a new
    // photo a new URL to everything downstream.
    res.json({ url: `${data.publicUrl}?v=${Date.now()}` });
  } catch (err: any) {
    // Supabase's storage errors carry more than `message` — `name` tells a
    // missing/misnamed bucket ("StorageApiError" / "Bucket not found") apart
    // from an auth failure (bad service-role key) or a network failure to the
    // project itself, which otherwise all collapse into the same generic
    // sentence the client shows. None of this is sent to the client — see the
    // comment on this route's message below for why.
    console.error('Avatar upload failed', {
      uid,
      name: err?.name,
      message: err?.message,
      status: err?.status ?? err?.statusCode,
    });
    res.status(502).json({ error: 'upload-failed', message: 'Could not save that photo.' });
  }
});

// Removal deletes the object as well as the reference to it: a public bucket
// means an orphaned file stays readable to anyone holding its URL. The CDN
// keeps serving the deleted bytes until the cache-control above lapses, which
// is why that number is small.
profileRouter.post('/photo/remove', async (req, res) => {
  const uid = req.uid!;
  try {
    const { error } = await supabase().storage.from(AVATAR_BUCKET).remove([objectPath(uid)]);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err: any) {
    console.error('Avatar removal failed', { uid, message: err?.message });
    res.status(502).json({ error: 'remove-failed', message: 'Could not remove that photo.' });
  }
});

// ---------------------------------------------------------------------------
// The user document
// ---------------------------------------------------------------------------
//
// Everything below moved off Firestore, where the phone wrote it directly, onto
// this server. The shape did not change — `allergies` is still one
// comma-separated string, because that is what the survey's free-text field
// writes and what the app already splits on read.
//
// The document id is the Firebase uid taken from the verified token. There is
// no route here that accepts a user id, so there is no route here that can be
// pointed at somebody else's profile.

// What a merge write is allowed to touch. `name` is deliberately absent: it is
// set once by the survey below, and letting the general save path clear it
// would send a returning user back through onboarding.
const PROFILE_FIELDS = ['dietaryPreferences', 'allergies', 'photoURL', 'mealPlanOptIn'] as const;

// Called once, right after Firebase creates the account — before this, a
// brand-new signup had no row here at all until the onboarding survey ran,
// which meant "create account" didn't actually put anything in the
// database until a second, later step. This is a bare upsert with nothing
// in it: no `name`, so GET / and the survey gate still correctly read this
// account as "hasn't onboarded yet" — it only guarantees the row exists,
// it doesn't finish the account the way the survey does.
profileRouter.post(
  '/create',
  withDb(async (req, res) => {
    await User.updateOne({ _id: req.uid }, { $setOnInsert: { _id: req.uid } }, { upsert: true });
    res.json({ ok: true });
  })
);

profileRouter.get(
  '/',
  withDb(async (req, res) => {
    const doc = await User.findById(req.uid).lean();
    // An account that has never answered the survey has no document at all.
    // Empty defaults rather than a 404: "no profile yet" is a normal state on
    // first launch, not a failure the app should have to branch on.
    res.json({
      profile: {
        name: doc?.name ?? null,
        dietaryPreferences: doc?.dietaryPreferences ?? [],
        allergies: doc?.allergies ?? '',
        photoURL: doc?.photoURL ?? null,
        mealPlanOptIn: doc?.mealPlanOptIn ?? false,
      },
    });
  })
);

// A merge, not a replace. The Profile screen saves diets and allergies from two
// separate controls, and a replace would mean each one wiping whatever the
// other had just written.
profileRouter.post(
  '/save',
  withDb(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    for (const key of PROFILE_FIELDS) {
      if (key in body) patch[key] = body[key] ?? null;
    }
    if (Object.keys(patch).length === 0) return badRequest(res, 'Nothing to change.');

    await User.updateOne({ _id: req.uid }, { $set: patch }, { upsert: true });
    res.json({ ok: true });
  })
);

// The onboarding survey, which is the only writer of `name` and therefore the
// only thing that can mark an account as having finished onboarding.
profileRouter.post(
  '/survey',
  withDb(async (req, res) => {
    const { name, dietaryPreferences, allergies, mealPlanOptIn } = (req.body ?? {}) as {
      name?: string;
      dietaryPreferences?: string[];
      allergies?: string;
      mealPlanOptIn?: boolean;
    };

    if (typeof name !== 'string' || !name.trim()) {
      return badRequest(res, 'A name is needed.');
    }

    await User.updateOne(
      { _id: req.uid },
      {
        $set: {
          name: name.trim(),
          dietaryPreferences: Array.isArray(dietaryPreferences) ? dietaryPreferences : [],
          allergies: typeof allergies === 'string' ? allergies : '',
          mealPlanOptIn: mealPlanOptIn === true,
        },
      },
      { upsert: true }
    );
    res.json({ ok: true });
  })
);

// The one place `name` can be changed once onboarding is done — kept out of
// PROFILE_FIELDS/`/save` deliberately (see that route's own comment), since a
// general merge write letting `name` through would let a caller null out the
// one field the survey gate is keyed on. Also renames the Firebase Auth
// account, so the two names this app shows for someone (the document, and
// anything reading auth.currentUser.displayName) never drift apart.
profileRouter.post(
  '/name',
  withDb(async (req, res) => {
    const { name } = (req.body ?? {}) as { name?: string };
    const trimmed = typeof name === 'string' ? name.trim() : '';
    if (!trimmed) return badRequest(res, 'A name is needed.');

    await User.updateOne({ _id: req.uid }, { $set: { name: trimmed } }, { upsert: true });
    try {
      await admin.auth().updateUser(req.uid!, { displayName: trimmed });
    } catch (err: any) {
      // The document is the name every screen in this app actually reads, so
      // a failure here is not sent back as a failure of the save itself —
      // only logged, so the Auth record can drift and be noticed rather than
      // stopping the user's name from changing.
      console.error('Auth displayName update failed', { uid: req.uid, message: err?.message });
    }
    res.json({ ok: true });
  })
);

// ---------------------------------------------------------------------------
// Export & delete
// ---------------------------------------------------------------------------

/** Everything this account has, gathered from every collection that keys off
 *  it — one JSON document, handed back for the user to keep. Read-only: this
 *  route changes nothing. */
profileRouter.get(
  '/export',
  withDb(async (req, res) => {
    const uid = req.uid!;
    const [user, pantryItems, savedRecipes, scans, conversations, messages] = await Promise.all([
      User.findById(uid).lean(),
      PantryItem.find({ userId: uid }).lean(),
      SavedRecipe.find({ userId: uid }).lean(),
      Scan.find({ userId: uid }).lean(),
      ChatConversation.find({ userId: uid }).lean(),
      ChatMessage.find({ userId: uid }).lean(),
    ]);

    res.json({
      exportedAt: new Date().toISOString(),
      account: user ?? null,
      pantryItems,
      savedRecipes,
      scans,
      chatConversations: conversations,
      chatMessages: messages,
    });
  })
);

/**
 * Erases the account: the Firebase sign-in is disabled first — so a token
 * already in flight can't slip in a write to a collection this route is about
 * to empty — then every collection keyed to this uid is removed, the Supabase
 * avatar object with it, and only then is the Firebase user itself deleted.
 * Firebase last, because a failure partway through still leaves req.uid
 * resolvable for a retry; deleting it first would mean a failed step 2 has no
 * verified uid left to clean up under.
 *
 * The one thing this deliberately does not delete is the audit row itself
 * (`deletionAuditLog`, a separate collection from `users` so the record
 * survives the User document it is about): a right to erasure is not a right
 * to make the erasure unaccountable, and this row holds nothing about the
 * person beyond the uid and when they asked.
 */
profileRouter.post(
  '/delete',
  withDb(async (req, res) => {
    const uid = req.uid!;

    try {
      await admin.auth().updateUser(uid, { disabled: true });
    } catch (err: any) {
      console.error('Account disable failed', { uid, message: err?.message });
      res.status(502).json({ error: 'disable-failed', message: 'Could not delete that account — try again in a moment.' });
      return;
    }

    await DeletionAuditLog.create({ uid, requestedAt: new Date(), requestedVia: 'profile-screen' });

    try {
      await supabase().storage.from(AVATAR_BUCKET).remove([objectPath(uid)]);
    } catch (err: any) {
      // A public bucket means a leftover object stays readable, but it is
      // orphaned and unlisted (nothing left in Mongo names its path once
      // User.deleteOne below runs) — not something worth failing the rest of
      // the erasure over.
      console.error('Avatar removal during account deletion failed', { uid, message: err?.message });
    }

    await Promise.all([
      PantryItem.deleteMany({ userId: uid }),
      SavedRecipe.deleteMany({ userId: uid }),
      Scan.deleteMany({ userId: uid }),
      ChatConversation.deleteMany({ userId: uid }),
      ChatMessage.deleteMany({ userId: uid }),
      Feedback.deleteMany({ userId: uid }),
      EmailVerification.deleteOne({ _id: uid }),
      User.deleteOne({ _id: uid }),
    ]);

    try {
      await admin.auth().deleteUser(uid);
    } catch (err: any) {
      // Every trace of the account's data is already gone at this point; a
      // dangling disabled Firebase record is the one thing this can leave
      // behind, and it can never sign in again regardless.
      console.error('Firebase user deletion failed', { uid, message: err?.message });
    }

    res.json({ ok: true });
  })
);
