// server/scripts/seed-cookbook.ts
//
// Copies the app's built-in cookbook (src/data/localRecipes.ts) into the
// cookbook_recipes collection, so the admin console has the same 52 dishes to
// manage that the app has always shown.
// Run from server/:  npm run seed:cookbook
//
// Safe to run more than once: a dish already in the collection, matched by
// title, is left exactly as an admin last saved it. The one thing a re-run
// does change is bring back a seeded dish an admin has deleted, so run it
// once, not as part of every start.

import 'dotenv/config';
import mongoose from 'mongoose';
import { connectMongo } from '../src/mongo';
import { CookbookRecipe } from '../src/models';
import { checkCookbookInput, titleKey } from '../src/cookbook';
import { LOCAL_RECIPES } from '../../src/data/localRecipes';

async function main() {
  await connectMongo();
  let added = 0;
  let kept = 0;

  for (const [index, recipe] of LOCAL_RECIPES.entries()) {
    // The same check the console's saves go through, so a seeded dish is one
    // an admin could open and save without being told to fix it first.
    const checked = checkCookbookInput(recipe);
    if (!checked.ok) throw new Error(`${recipe.title}: ${checked.message}`);
    const key = titleKey(recipe.title);
    const result = await CookbookRecipe.updateOne(
      { titleKey: key },
      {
        $setOnInsert: {
          ...checked.value,
          titleKey: key,
          dishKey: recipe.dishKey,
          look: recipe.look,
          position: index,
          updatedBy: 'seed',
        },
      },
      { upsert: true }
    );
    if (result.upsertedCount) added++;
    else kept++;
  }

  const total = await CookbookRecipe.countDocuments();
  console.log(`Cookbook: ${added} added, ${kept} already there. ${total} recipes in cookbook_recipes.`);
}

main()
  .catch((err) => {
    console.error('Seeding failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
