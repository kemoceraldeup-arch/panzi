// server/src/routes/recipeRatings.ts
//
// What "Rate this cook" writes, once cook mode's complete sheet is closed with
// a star picked instead of "Back to recipe". Same shape as savedRecipes.ts:
// one upsert keyed by an id the phone already built, filtered by the token's
// uid regardless of what the id claims to be.

import { Router } from 'express';
import { RecipeRating } from '../models';
import { badRequest, isValidId, withDb } from './helpers';

export const recipeRatingsRouter = Router();

recipeRatingsRouter.post(
  '/',
  withDb(async (req, res) => {
    const { id, title, stars } = (req.body ?? {}) as {
      id?: string;
      title?: string;
      stars?: number;
    };

    if (!isValidId(id)) return badRequest(res, 'No rating id was sent.');
    if (typeof title !== 'string' || !title.trim()) {
      return badRequest(res, 'That recipe has no title.');
    }
    if (typeof stars !== 'number' || !Number.isInteger(stars) || stars < 1 || stars > 5) {
      return badRequest(res, 'Rating must be 1 to 5 stars.');
    }

    await RecipeRating.updateOne(
      { _id: id, userId: req.uid },
      { $set: { userId: req.uid, title: title.trim(), stars } },
      { upsert: true }
    );
    res.json({ ok: true });
  })
);
