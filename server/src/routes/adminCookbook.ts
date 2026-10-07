// server/src/routes/adminCookbook.ts
//
// Create, read, update and delete for the cookbook the app's Recipes screen
// shows. Mounted inside adminRouter, so every route here is already behind
// requireAuth + requireAdmin and written to admin_audit. The app reads the
// same collection through routes/cookbook.ts, which cannot write.
//
// A photo arrives as base64 JPEG (the console shrinks it first) and is stored
// in the public dish-photos bucket under cookbook/. The old file is removed
// once the recipe no longer points at it, so a replaced or deleted photo does
// not stay readable forever.

import { Router, Response } from 'express';
import { CookbookRecipe } from '../models';
import { checkCookbookInput, cookbookJson, LOOK_FOR_CATEGORY, titleKey } from '../cookbook';
import { supabase } from '../supabase';
import { DISH_PHOTO_BUCKET } from './dishPhoto';
import { badRequest, withDb } from './helpers';

export const adminCookbookRouter = Router();

// The console resizes to 1000px JPEG, which lands well under 400KB of base64.
// Matches the body limit set for this path in index.ts.
const MAX_PHOTO_BASE64 = 1_500_000;

const isObjectId = (id: unknown): id is string => typeof id === 'string' && /^[a-f\d]{24}$/i.test(id);

function notFound(res: Response) {
  res.status(404).json({ error: 'not-found', message: 'This recipe no longer exists. Reload the list.' });
}

function duplicate(res: Response, title: string) {
  res.status(409).json({ error: 'duplicate-title', message: `A recipe called “${title}” already exists.` });
}

/** The decoded photo, null for none, or a sentence saying what is wrong. */
function readPhoto(value: unknown): Buffer | null | string {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !value) return 'That photo could not be read.';
  if (value.length > MAX_PHOTO_BASE64) return 'That photo is too big. Use one under 1 MB.';
  const bytes = Buffer.from(value, 'base64');
  // JPEG files start FF D8 FF. Checking the bytes rather than trusting a
  // content type keeps anything that is not a picture out of a public bucket.
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
    return 'The photo must be a JPEG image.';
  }
  return bytes;
}

async function uploadPhoto(id: string, bytes: Buffer): Promise<{ url: string; path: string }> {
  // A new name every time, so the CDN and the phone's image cache never show
  // the previous photo under the new one's URL.
  const path = `cookbook/${id}-${Date.now()}.jpg`;
  const bucket = supabase().storage.from(DISH_PHOTO_BUCKET);
  const { error } = await bucket.upload(path, bytes, { contentType: 'image/jpeg', upsert: false, cacheControl: '31536000' });
  if (error) throw error;
  return { url: bucket.getPublicUrl(path).data.publicUrl, path };
}

/** Best effort: a file left behind costs a few kilobytes, not a failed save. */
async function removePhoto(path: string | null | undefined): Promise<void> {
  if (!path) return;
  try {
    const { error } = await supabase().storage.from(DISH_PHOTO_BUCKET).remove([path]);
    if (error) throw error;
  } catch (err: any) {
    console.warn('Cookbook photo cleanup failed', { path, message: err?.message });
  }
}

// ------------------------------------------------------------------ Read

adminCookbookRouter.get('/cookbook', withDb(async (_req, res) => {
  const rows = await CookbookRecipe.find().sort({ position: 1, _id: 1 }).lean();
  res.json({ recipes: rows.map(cookbookJson) });
}));

// ---------------------------------------------------------------- Create

adminCookbookRouter.post('/cookbook', withDb(async (req, res) => {
  const checked = checkCookbookInput(req.body);
  if (!checked.ok) return badRequest(res, checked.message);
  const photo = readPhoto(req.body?.photoBase64);
  if (typeof photo === 'string') return badRequest(res, photo);

  const input = checked.value;
  if (await CookbookRecipe.exists({ titleKey: titleKey(input.title) })) return duplicate(res, input.title);

  const first: any = await CookbookRecipe.findOne().sort({ position: 1 }).select({ position: 1 }).lean();
  const doc = new CookbookRecipe({
    ...input,
    titleKey: titleKey(input.title),
    look: LOOK_FOR_CATEGORY[input.category],
    position: (first?.position ?? 0) - 1,
    updatedBy: req.uid,
  });

  if (photo) {
    try {
      const stored = await uploadPhoto(String(doc._id), photo);
      doc.set({ photoUrl: stored.url, photoPath: stored.path });
    } catch (err: any) {
      console.error('Cookbook photo upload failed', { message: err?.message });
      res.status(502).json({ error: 'upload-failed', message: 'The photo could not be saved. Try again, or save without a photo.' });
      return;
    }
  }

  try {
    await doc.save();
  } catch (err: any) {
    await removePhoto(doc.get('photoPath'));
    if (err?.code === 11000) return duplicate(res, input.title);
    throw err;
  }
  res.status(201).json({ recipe: cookbookJson(doc.toObject()) });
}));

// ---------------------------------------------------------------- Update

adminCookbookRouter.patch('/cookbook/:id', withDb(async (req, res) => {
  const { id } = req.params;
  if (!isObjectId(id)) return notFound(res);
  const checked = checkCookbookInput(req.body);
  if (!checked.ok) return badRequest(res, checked.message);
  const revision = req.body?.revision;
  if (!Number.isSafeInteger(revision) || revision < 0) return badRequest(res, 'Reload the recipe and try again.');
  const photo = readPhoto(req.body?.photoBase64);
  if (typeof photo === 'string') return badRequest(res, photo);
  const dropPhoto = req.body?.removePhoto === true;

  const current: any = await CookbookRecipe.findById(id).lean();
  if (!current) return notFound(res);
  if (current.revision !== revision) return conflict(res);

  const input = checked.value;
  const set: Record<string, unknown> = { ...input, titleKey: titleKey(input.title), updatedBy: req.uid };
  let uploadedPath: string | null = null;
  if (photo) {
    try {
      const stored = await uploadPhoto(id, photo);
      uploadedPath = stored.path;
      Object.assign(set, { photoUrl: stored.url, photoPath: stored.path });
    } catch (err: any) {
      console.error('Cookbook photo upload failed', { message: err?.message });
      res.status(502).json({ error: 'upload-failed', message: 'The photo could not be saved. Try again, or save without changing it.' });
      return;
    }
  } else if (dropPhoto) {
    Object.assign(set, { photoUrl: null, photoPath: null });
  }

  let saved: any;
  try {
    saved = await CookbookRecipe.findOneAndUpdate(
      { _id: id, revision },
      { $set: set, $inc: { revision: 1 } },
      { returnDocument: 'after', runValidators: true }
    ).lean();
  } catch (err: any) {
    await removePhoto(uploadedPath);
    if (err?.code === 11000) return duplicate(res, input.title);
    throw err;
  }
  if (!saved) {
    await removePhoto(uploadedPath);
    return (await CookbookRecipe.exists({ _id: id })) ? conflict(res) : notFound(res);
  }
  if (photo || dropPhoto) await removePhoto(current.photoPath);
  res.json({ recipe: cookbookJson(saved) });
}));

function conflict(res: Response) {
  res.status(409).json({
    error: 'cookbook-conflict',
    message: 'Another administrator changed this recipe while you were editing. Close this panel to load their version.',
  });
}

// ---------------------------------------------------------------- Delete

adminCookbookRouter.delete('/cookbook/:id', withDb(async (req, res) => {
  const { id } = req.params;
  if (!isObjectId(id)) return notFound(res);
  const removed: any = await CookbookRecipe.findByIdAndDelete(id).lean();
  if (!removed) return notFound(res);
  await removePhoto(removed.photoPath);
  res.json({ deleted: id, title: removed.title });
}));
