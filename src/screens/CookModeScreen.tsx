// src/screens/CookModeScreen.tsx
//
// Cook mode's entry point: fetches what CookStepScreen needs from a real
// Recipe and mounts it full-screen. The step-by-step UI and the completion
// sheet both live in src/screens/cook/ — this file's only job is the adapter
// between the app's Recipe shape and that fixed, literally-specified design.
//
// Real recipes are missing three things the design wants: a named phase per
// step (Recipe.steps is plain strings), a per-step ingredient list (only a
// whole-recipe list exists), and a per-step photo (only one photo exists per
// dish). Each is derived as far as the real data allows and omitted rather
// than invented where it can't be — see stepsFromRecipe below for exactly
// what that means per field. Cook time and servings are real fields
// (Recipe.minutes, Recipe.servings) and are shown as given, including the
// app's own "0 means the model didn't give a believable figure" convention.
//
// This replaces an earlier version of this screen that opened on an
// ingredients-first page and, on finishing, offered to clear the recipe's
// matched items from the pantry. Neither has an equivalent in the new design
// (which starts directly on step one and ends on stats + Rate this cook /
// Back to recipe) and both are dropped rather than grafted on.

import React, { useEffect, useState } from 'react';
import { Modal, View } from 'react-native';
import {
  SafeAreaProvider,
  initialWindowMetrics,
} from 'react-native-safe-area-context';
import { ImageSourcePropType } from 'react-native';
import CookStepScreen, { CookStep } from './cook/CookStepScreen';
import { CookCompleteStat } from './cook/CookCompleteSheet';
import { cookTokens } from './cook/cookTokens';
import { auth } from '../config/firebaseClient';
import { PantryItem } from '../services/pantry';
import { Recipe, fetchDishPhoto } from '../services/recipes';
import { rateRecipe } from '../services/recipeRatings';
import { dishPhoto } from '../theme/dishPhotos';
import { useTheme } from '../theme/ThemeProvider';

type Props = {
  recipe: Recipe | null;
  /** Accepted for call-site compatibility with the screens that open cook
   *  mode (RecipesScreen, MainTabs) — unused now that finishing a cook no
   *  longer offers to clear matched pantry items. */
  items: PantryItem[];
  onClose: () => void;
};

/** One phase name per step, since the model that writes Recipe.steps never
 *  names one — "Step 1", "Step 2"... reads honestly as what it is rather than
 *  guessing at a phase ("Marinate", "Sear"...) the data doesn't actually say. */
function phaseFor(index: number): string {
  return `Step ${index + 1}`;
}

/**
 * Recipe.ingredients is one whole-recipe list with no line saying which step
 * uses which item, so there is no real per-step ingredient list to show —
 * per the screen's own rule ("omit the label + row entirely when a step has
 * no ingredients"), every step's chip row is correctly empty rather than
 * populated with a guess.
 */
function stepsFromRecipe(recipe: Recipe, photo: ImageSourcePropType | null): CookStep[] {
  return recipe.steps.map((instruction, i) => ({
    phase: phaseFor(i),
    instruction,
    ingredients: [],
    photo,
  }));
}

function statsFor(recipe: Recipe): [CookCompleteStat, CookCompleteStat, CookCompleteStat] {
  return [
    { value: String(recipe.steps.length), label: 'STEPS' },
    // 0 means the model's figure wasn't believable — shown as "—" rather
    // than a false "0 min", matching how the rest of the app hides this case.
    recipe.minutes > 0
      ? { value: String(recipe.minutes), unit: 'min', label: 'COOK TIME' }
      : { value: '—', label: 'COOK TIME' },
    recipe.servings > 0
      ? { value: String(recipe.servings), label: 'SERVINGS' }
      : { value: '—', label: 'SERVINGS' },
  ];
}

export default function CookModeScreen({ recipe, onClose }: Props) {
  // CookStepScreen indexes steps[0] unconditionally — a real assumption for a
  // screen built to a fixed 5-step example, but not a safe one for a Recipe
  // the model could in principle return with no steps at all. Closing
  // immediately (rather than opening onto a screen with nothing to show) is
  // the same "nothing to cook" outcome recipes with zero steps already have
  // everywhere else they're used.
  const hasSteps = !!recipe && recipe.steps.length > 0;
  const { scheme } = useTheme();

  return (
    <Modal
      visible={hasSteps}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      {/* iOS/Android both paint the Modal's native surface white for the
          first frame of the slide-up transition, before any React content
          underneath has had a chance to render on top of it — visible as a
          blank white flash between tapping "Start cooking" and cook mode's
          own page color appearing. An opaque View at cook mode's own page
          color, sized to fill the modal before anything else mounts, removes
          that gap: the surface is never bare white to begin with. */}
      <View style={{ flex: 1, backgroundColor: cookTokens[scheme].page }}>
        <SafeAreaProvider initialMetrics={initialWindowMetrics}>
          {hasSteps && <Body recipe={recipe} onClose={onClose} />}
        </SafeAreaProvider>
      </View>
    </Modal>
  );
}

function Body({ recipe, onClose }: { recipe: Recipe; onClose: () => void }) {
  // Same two-tier lookup DishTile uses everywhere else a dish gets a photo:
  // the bundled photo for recipe.dishKey wins outright when there is one, and
  // only a dish outside that hand-curated list asks the server to generate
  // one. Fetched once per recipe, not once per step — every step reuses the
  // same dish photo, and fetchDishPhoto pays a real generation cost the first
  // time any user asks for a given title, so five calls for one recipe would
  // be four wasted round trips for a picture that never changes within a cook.
  const bundledPhoto = dishPhoto(recipe.dishKey);
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null);

  useEffect(() => {
    if (bundledPhoto) return;
    let alive = true;
    fetchDishPhoto(recipe.title).then((url) => {
      if (alive) setGeneratedUrl(url);
    });
    return () => {
      alive = false;
    };
  }, [bundledPhoto, recipe.title]);

  const photo = bundledPhoto ?? (generatedUrl ? { uri: generatedUrl } : null);
  const steps = stepsFromRecipe(recipe, photo);
  const stats = statsFor(recipe);

  return (
    <CookStepScreen
      recipeName={recipe.title}
      steps={steps}
      stats={stats}
      completeTitle={`${recipe.title} done!`}
      completeBody={recipe.why || recipe.description || 'Nicely done.'}
      onClose={onClose}
      onRate={(stars) => {
        const uid = auth.currentUser?.uid;
        if (!uid) return;
        // Fire-and-forget, same as saveRecipe/unsaveRecipe elsewhere — the
        // sheet has already closed by the time this resolves, and a failed
        // rating isn't worth blocking the "done cooking" moment over.
        rateRecipe(uid, recipe.title, stars).catch(() => {});
      }}
    />
  );
}
