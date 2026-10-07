// server/src/routes/cookbook.ts
//
// The app's read-only view of the cookbook: every recipe, in the order the
// Recipes screen shows them. The same for every account, so nothing is scoped
// to req.uid; it sits behind requireAuth only because every app route does.
// Writing happens in routes/adminCookbook.ts, behind the admin gate.

import { Router } from 'express';
import { CookbookRecipe } from '../models';
import { cookbookJson } from '../cookbook';
import { withDb } from './helpers';

export const cookbookRouter = Router();

cookbookRouter.get('/', withDb(async (_req, res) => {
  const rows = await CookbookRecipe.find().sort({ position: 1, _id: 1 }).lean();
  // The admin's bookkeeping (revision, updatedAt) is not the app's business.
  res.json({
    recipes: rows.map((row) => {
      const { revision: _revision, updatedAt: _updatedAt, ...recipe } = cookbookJson(row);
      return recipe;
    }),
  });
}));
