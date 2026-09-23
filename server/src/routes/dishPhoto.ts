// server/src/routes/dishPhoto.ts
//
// A photo for a dish that has no bundled one — src/theme/dishPhotos.ts only
// ships a fixed, hand-curated list, and everything outside it is 'other'. This
// route is the second tier the client reaches for before falling back to the
// gradient tile: check Supabase for a photo of this exact dish first, and only
// pay to generate one the first time a given dish is ever asked for. Every
// later request for the same dish — anyone's, not just this user's — reuses
// the stored file, so the real cost is one generation per unique dish, not one
// per request.
//
// The cache key is the dish title, not dishKey — dishKey is 'other' for every
// dish this route is even asked about (the hand-curated list already covers
// its own dishKey values via the bundled require()s, so the client never
// calls here for those), so title is the only thing that actually
// distinguishes "Chocolate Palitaw" from "Beef Caldereta". Titles are
// normalised before hashing so trivial rewordings ("Chicken Adobo" vs
// "chicken adobo!") still hit the same file instead of paying to regenerate a
// near-duplicate.

import { createHash } from 'crypto';
import { Router } from 'express';
import OpenAI from 'openai';
import { supabase } from '../supabase';

export const dishPhotoRouter = Router();

export const DISH_PHOTO_BUCKET = 'dish-photos';

const MODEL = 'gpt-image-1';

let client: OpenAI | null = null;

function openai(): OpenAI {
  if (!client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY is not set — copy .env.example to .env');
    client = new OpenAI({ apiKey });
  }
  return client;
}

const MAX_TITLE_LENGTH = 80;

/** Same dish, differently capitalised or punctuated, must land on the same
 *  file — otherwise "Chicken Adobo" and "chicken adobo" pay for two images of
 *  the same thing. */
function normaliseTitle(title: string): string {
  return title.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function objectPathFor(title: string): string {
  const hash = createHash('sha256').update(normaliseTitle(title)).digest('hex').slice(0, 24);
  return `${hash}.png`;
}

dishPhotoRouter.post('/', async (req, res) => {
  const uid = req.uid;
  const { title } = (req.body ?? {}) as { title?: string };
  const clean = typeof title === 'string' ? title.trim().slice(0, MAX_TITLE_LENGTH) : '';

  if (!clean) {
    res.status(400).json({ error: 'bad-request', message: 'A dish title is required.' });
    return;
  }

  const path = objectPathFor(clean);
  const bucket = supabase().storage.from(DISH_PHOTO_BUCKET);

  // Tier one: something already generated this dish, for this user or any
  // other — Supabase has no "does this object exist" call, so listing its
  // one-row directory is the cheap way to ask without downloading anything.
  try {
    const { data: existing, error: listError } = await bucket.list('', { search: path });
    if (listError) throw listError;
    if (existing?.some((entry) => entry.name === path)) {
      const { data } = bucket.getPublicUrl(path);
      res.json({ url: data.publicUrl });
      return;
    }
  } catch (err: any) {
    console.error('Dish photo lookup failed', { uid, title: clean, message: err?.message });
    // Falls through to generation rather than failing outright — a lookup
    // hiccup shouldn't cost the user a photo that a moment's retry would have
    // found, and upload below will simply overwrite if this guess is wrong.
  }

  // Tier two: nobody has asked for this dish before. Generate once, store it,
  // and every future request — anyone's — hits the tier above instead.
  let imageB64: string;
  try {
    const response = await openai().images.generate({
      model: MODEL,
      prompt: `A single appetizing photo of the finished dish "${clean}", plated and ready to eat, shot from a 45-degree angle on a plain background, natural lighting, no text or watermark, no people, no hands, no utensils in motion — just the food.`,
      size: '1024x1024',
      n: 1,
    });
    const first = response.data?.[0];
    if (!first?.b64_json) throw new Error('No image data in response');
    imageB64 = first.b64_json;
  } catch (err: any) {
    console.error('Dish photo generation failed', { uid, title: clean, message: err?.message });
    res.status(503).json({ error: 'unavailable', message: 'Could not create a photo for that dish right now.' });
    return;
  }

  try {
    const { error: uploadError } = await bucket.upload(path, Buffer.from(imageB64, 'base64'), {
      contentType: 'image/png',
      // True in case two requests for the same brand-new dish race each other
      // — the second upload should replace, not fail, since both are the same
      // dish and only one file needs to survive.
      upsert: true,
      cacheControl: '31536000',
    });
    if (uploadError) throw uploadError;

    const { data } = bucket.getPublicUrl(path);
    console.info('Dish photo generated', { uid, title: clean });
    res.json({ url: data.publicUrl });
  } catch (err: any) {
    console.error('Dish photo upload failed', { uid, title: clean, message: err?.message });
    res.status(502).json({ error: 'upload-failed', message: 'Could not save that photo.' });
  }
});
