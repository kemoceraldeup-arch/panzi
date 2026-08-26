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
import { AVATAR_BUCKET, supabase } from '../supabase';
import { User } from '../models';
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
    console.error('Avatar upload failed', { uid, message: err?.message });
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
