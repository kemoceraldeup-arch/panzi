// server/src/routes/savedRecipes.ts
//
// Recipes the user kept.
//
// Suggestions are disposable — regenerated whenever the pantry moves, cached on
// the device, gone on reinstall. A saved recipe is the opposite: the user said
// they want this one again, so it goes to the database, survives the phone, and
// is stored whole rather than as a reference. A saved dish that quietly changed
// because tonight's pantry is different would be a strange thing to hand
// somebody who asked to keep it.
//
// The document id is built from the uid and a slug of the title, on the phone,
// so saving the same dish twice overwrites rather than duplicating and unsaving
// needs no lookup. It is still filtered by userId on every query — an id that
// starts with somebody else's uid is only a convention, and a convention is not
// an access control.

import { Router } from 'express';
import { SavedRecipe } from '../models';
import { badRequest, isValidId, withDb } from './helpers';

export const savedRecipesRouter = Router();

// Nobody scrolls past this many, and an unbounded read on a collection that
// only grows is a bill waiting to happen.
const SAVED_LIMIT = 60;

savedRecipesRouter.get(
  '/',
  withDb(async (req, res) => {
    const rows = await SavedRecipe.find({ userId: req.uid })
      .sort({ savedAtMs: -1 })
      .limit(SAVED_LIMIT)
      .lean();

    res.json({
      saved: rows.map((row: any) => ({
        id: row._id,
        savedAt: typeof row.savedAtMs === 'number' ? row.savedAtMs : 0,
        recipe: row.recipe,
      })),
    });
  })
);

savedRecipesRouter.post(
  '/save',
  withDb(async (req, res) => {
    const { id, key, recipe } = (req.body ?? {}) as { id?: string; key?: string; recipe?: any };
    if (!isValidId(id)) return badRequest(res, 'No recipe id was sent.');
    if (!recipe || typeof recipe.title !== 'string') {
      return badRequest(res, 'That recipe has no title.');
    }

    await SavedRecipe.updateOne(
      { _id: id, userId: req.uid },
      {
        $set: {
          userId: req.uid,
          key: typeof key === 'string' ? key : recipe.title.trim().toLowerCase(),
          // Written by the server rather than taken from the body: this is what
          // the list sorts on, and a clock the client controls would let a
          // wrong device time reorder somebody's saved dishes.
          savedAtMs: Date.now(),
          recipe,
        },
      },
      { upsert: true }
    );
    res.json({ ok: true });
  })
);

savedRecipesRouter.post(
  '/unsave',
  withDb(async (req, res) => {
    const { id } = (req.body ?? {}) as { id?: string };
    if (!isValidId(id)) return badRequest(res, 'No recipe id was sent.');

    await SavedRecipe.deleteOne({ _id: id, userId: req.uid });
    res.json({ ok: true });
  })
);
