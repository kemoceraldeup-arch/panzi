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
// Finishing the last step is what takes the recipe's ingredients out of the
// pantry — every "Start cooking" (recipe page, recipe cards, chat, saved
// recipes) lands here, so this is the one place that covers them all. Leaving
// early takes nothing. What was taken is shown over the complete sheet, with
// an Undo, since a recipe marked done by mistake shouldn't cost the eggs.

import React, { useEffect, useRef, useState } from 'react';
import { Alert, Modal, View } from 'react-native';
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
import {
  DeductionPlan,
  applyDeduction,
  describeDeduction,
  planDeduction,
  undoDeduction,
} from '../services/cookDeduction';
import { Recipe, fetchDishPhoto } from '../services/recipes';
import { rateRecipe } from '../services/recipeRatings';
import { dishPhoto } from '../theme/dishPhotos';
import { useTheme } from '../theme/ThemeProvider';

type Props = {
  recipe: Recipe | null;
  /** The pantry as it stands; the recipe's ingredients are taken out of it when the last step is finished. */
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

export default function CookModeScreen({ recipe, items, onClose }: Props) {
  // CookStepScreen indexes steps[0] unconditionally — a real assumption for a
  // screen built to a fixed 5-step example, but not a safe one for a Recipe
  // the model could in principle return with no steps at all. Closing
  // immediately (rather than opening onto a screen with nothing to show) is
  // the same "nothing to cook" outcome recipes with zero steps already have
  // everywhere else they're used.
  const hasSteps = !!recipe && recipe.steps.length > 0;
  const { scheme } = useTheme();

  // Read when Finish is pressed, not when cook mode opened: the pantry may
  // have changed while the user cooked.
  const itemsRef = useRef(items);
  itemsRef.current = items;

  // Once per cook: keyed on the recipe object, so the pantry refreshing
  // underneath (which it does, straight after this writes) can't take the
  // same ingredients twice.
  const deductedFor = useRef<Recipe | null>(null);
  // The summary waits for both the write and the complete sheet's arrival —
  // an Alert raised while a modal is still presenting can be dropped on iOS.
  const pending = useRef<{ plan: DeductionPlan | null; removalIds: string[]; error: boolean } | null>(null);
  const sheetUp = useRef(false);

  useEffect(() => {
    deductedFor.current = null;
    pending.current = null;
    sheetUp.current = false;
  }, [recipe]);

  function handleComplete() {
    if (!recipe || deductedFor.current === recipe) return;
    deductedFor.current = recipe;

    const plan = planDeduction(recipe, itemsRef.current);
    if (plan.changes.length === 0 && plan.skipped.length === 0) return;
    if (plan.changes.length === 0) {
      pending.current = { plan, removalIds: [], error: false };
      if (sheetUp.current) showSummary();
      return;
    }
    applyDeduction(plan)
      .then((removalIds) => {
        pending.current = { plan, removalIds, error: false };
      })
      .catch(() => {
        pending.current = { plan: null, removalIds: [], error: true };
      })
      .finally(() => {
        if (sheetUp.current) showSummary();
      });
  }

  function handleCompleteShown() {
    sheetUp.current = true;
    showSummary();
  }

  function showSummary() {
    const next = pending.current;
    if (!next) return;
    pending.current = null;
    if (next.error || !next.plan) {
      Alert.alert(
        "Couldn't update your pantry",
        'The ingredients for this recipe were not taken out. Check your connection and adjust the amounts in your pantry by hand.',
      );
      return;
    }
    const { plan, removalIds } = next;
    if (plan.changes.length === 0) {
      Alert.alert('Nothing taken from your pantry', describeDeduction(plan));
      return;
    }
    Alert.alert('Taken from your pantry', describeDeduction(plan), [
      {
        text: 'Undo',
        style: 'destructive',
        onPress: () => {
          undoDeduction(plan, removalIds).catch(() =>
            Alert.alert("Couldn't undo", 'Your pantry could not be put back. Check your connection and try again.'),
          );
        },
      },
      { text: 'OK', style: 'default' },
    ]);
  }

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
          {hasSteps && <Body recipe={recipe} onClose={onClose} onComplete={handleComplete} onCompleteShown={handleCompleteShown} />}
        </SafeAreaProvider>
      </View>
    </Modal>
  );
}

function Body({
  recipe,
  onClose,
  onComplete,
  onCompleteShown,
}: {
  recipe: Recipe;
  onClose: () => void;
  onComplete: () => void;
  onCompleteShown: () => void;
}) {
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
    // An admin-uploaded cookbook photo counts as having one, same as DishTile.
    if (bundledPhoto || recipe.photoUrl) return;
    let alive = true;
    fetchDishPhoto(recipe.title).then((url) => {
      if (alive) setGeneratedUrl(url);
    });
    return () => {
      alive = false;
    };
  }, [bundledPhoto, recipe.photoUrl, recipe.title]);

  const photo = recipe.photoUrl
    ? { uri: recipe.photoUrl }
    : bundledPhoto ?? (generatedUrl ? { uri: generatedUrl } : null);
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
      onComplete={onComplete}
      onCompleteShown={onCompleteShown}
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
