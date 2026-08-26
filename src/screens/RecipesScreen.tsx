// src/screens/RecipesScreen.tsx
//
// Everything the app suggests cooking. These cards used to sit on Home, which
// made the landing screen an answer to a question nobody had asked yet —
// recipes belong behind a tab you tap when you want them.
//
// The suggestions are real now: built by the recipe route from the pantry as it
// stands, weighted toward whatever is about to go off. The card layout is
// unchanged — its shape (title, minutes, ingredients on hand, uses-expiring
// count) was designed for this data, so it only ever needed filling.
//
// The screen tries hard not to call the model. A suggestion is cached against a
// fingerprint of the pantry, the profile and the day, with one entry per mood;
// opening this tab ten times before dinner costs one call, not ten, and
// flipping between Quick and Ulam and back costs nothing at all. Only a real
// change — food added or eaten, a diet edited, a new day, a mood not asked for
// yet, or the user asking for something else — spends another.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, View, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Text from '../components/Text';
import { auth } from '../config/firebaseClient';
import { PantryItem, subscribeToPantryItems } from '../services/pantry';
import { UserProfile, subscribeToProfile } from '../services/profile';
import {
  Recipe,
  RecipeError,
  RecipeMood,
  RecipeSet,
  SkippedRecipe,
  fetchRecipes,
  ingredientCounts,
  loadCachedRecipes,
  pantrySignature,
  saveCachedRecipes,
} from '../services/recipes';
import {
  SavedRecipe,
  savedKey,
  saveRecipe,
  subscribeToSavedRecipes,
  unsaveRecipe,
} from '../services/savedRecipes';
import { SCAN_BUTTON_LIFT } from '../navigation/TabBar';
import { FeaturedRecipeCard, MiniRecipeCard } from '../components/home/RecipeCards';
import MoodChips from '../components/recipes/MoodChips';
import RecipeDetailScreen from './RecipeDetailScreen';
import CookModeScreen from './CookModeScreen';
import SavedRecipesScreen from './SavedRecipesScreen';
import { isEnforceable } from '../utils/diet';
import { fonts, type } from '../theme/typography';
import { makeStyles } from '../theme/makeStyles';
import { useColors } from '../theme/ThemeProvider';
import { space } from '../theme/spacing';

const HIT_SLOP = { top: 10, bottom: 10, left: 10, right: 10 };

type Phase = 'loading' | 'ready' | 'failed';

type Props = {
  /** Jumps to the Profile tab. The diet shown here is set there, and a chip
   *  that describes a rule should lead to where the rule is changed. */
  onOpenProfile?: () => void;
};

export default function RecipesScreen({ onOpenProfile }: Props) {
  const styles = useStyles();
  const colors = useColors();
  const uid = auth.currentUser?.uid ?? null;

  const [items, setItems] = useState<PantryItem[] | null>(null);
  // Null until the profile listener has reported once. Not seeded with
  // EMPTY_PROFILE, because "we haven't read it yet" and "this user has no
  // allergies" are the same value and must not be the same state — the pantry
  // listener can easily land first, and a suggestion built on an assumed-empty
  // allergy list is exactly the mistake this feature cannot make.
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileFailed, setProfileFailed] = useState(false);
  const [set, setSet] = useState<RecipeSet | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState<string | null>(null);
  const [mood, setMood] = useState<RecipeMood>('anything');
  const [open, setOpen] = useState<Recipe | null>(null);
  const [cooking, setCooking] = useState<Recipe | null>(null);
  const [savedOpen, setSavedOpen] = useState(false);
  const [saved, setSaved] = useState<SavedRecipe[]>([]);

  // The signature and mood the current suggestion was built for. Guards the
  // effect below from re-running on every Firestore snapshot — the pantry
  // listener fires whenever anything changes, and most changes don't affect
  // what to cook.
  const builtFor = useRef<string | null>(null);
  // Set while a call is in flight so a second snapshot can't start a second one.
  const inFlight = useRef(false);

  useEffect(() => {
    if (!uid) return;
    return subscribeToPantryItems(
      uid,
      setItems,
      () => setItems([])
    );
  }, [uid]);

  useEffect(() => {
    if (!uid) return;
    return subscribeToProfile(
      uid,
      (next) => {
        setProfileFailed(false);
        setProfile(next);
      },
      () => {
        // Fails closed. Everywhere else in the app a dropped profile listener
        // is cosmetic — the greeting keeps the old name. Here it decides
        // whether the allergy list reaching the model is real or just empty by
        // default, so the screen refuses to suggest food rather than suggest it
        // blind. Annoying for a user with no allergies; the alternative is
        // serving peanuts to someone who wrote down that they can't eat them.
        setProfileFailed(true);
      }
    );
  }, [uid]);

  useEffect(() => {
    if (!uid) return;
    return subscribeToSavedRecipes(
      uid,
      setSaved,
      // Cosmetic, unlike the profile listener: a dropped saved list means an
      // unfilled heart, not an unsafe suggestion.
      () => setSaved([])
    );
  }, [uid]);

  const build = useCallback(
    async (pantry: PantryItem[], who: UserProfile, which: RecipeMood, force: boolean) => {
      if (!uid || inFlight.current) return;

      const signature = pantrySignature(pantry, who);
      // Mood is part of the guard, not the signature: the signature describes
      // the pantry and has to stay comparable across moods in the cache file.
      const token = `${which}#${signature}`;
      if (!force && builtFor.current === token) return;

      inFlight.current = true;
      setPhase('loading');
      setError(null);

      try {
        if (!force) {
          const cached = await loadCachedRecipes(uid, signature, which);
          if (cached) {
            builtFor.current = token;
            setSet(cached);
            setPhase('ready');
            return;
          }
        }

        const fresh = await fetchRecipes(pantry, who, which);
        builtFor.current = token;
        setSet(fresh);
        setPhase('ready');
        // Only a usable answer is worth keeping — caching an empty one would
        // hold the screen at "nothing to suggest" for a day.
        if (fresh.featured) await saveCachedRecipes(uid, signature, which, fresh);
      } catch (err) {
        setError(
          err instanceof RecipeError ? err.message : 'Something went wrong — try again.'
        );
        setPhase('failed');
      } finally {
        inFlight.current = false;
      }
    },
    [uid]
  );

  useEffect(() => {
    // Both listeners must have reported before the first call. `profile` being
    // null is the gate that stops a request going out with an allergy list
    // that is empty only because it hasn't loaded. Chips do not relax it.
    if (items === null || profile === null) return;
    if (items.length === 0) {
      setPhase('ready');
      setSet(null);
      return;
    }
    void build(items, profile, mood, false);
  }, [items, profile, mood, build]);

  /** Shuffle and Try again. Both need the same two things to have landed. */
  const rebuild = useCallback(() => {
    if (items && profile) void build(items, profile, mood, true);
  }, [items, profile, mood, build]);

  const savedKeys = useMemo(
    () => new Set(saved.map((entry) => savedKey(entry.recipe))),
    [saved]
  );

  const toggleSave = useCallback(
    (recipe: Recipe) => {
      if (!uid) return;
      const call = savedKeys.has(savedKey(recipe)) ? unsaveRecipe : saveRecipe;
      // Nothing awaits this. The listener echoes the change back and fills the
      // heart; a failed write leaves the heart as it was, which is the truth.
      void call(uid, recipe).catch(() => {});
    },
    [uid, savedKeys]
  );

  if (!uid) {
    return (
      <View style={[styles.container, styles.centre]}>
        <Text style={styles.emptyBody}>Sign in to get suggestions.</Text>
      </View>
    );
  }

  const empty = items !== null && items.length === 0;
  const featured = set?.featured ?? null;
  const diets = profile?.dietary ?? [];
  const skipped = set?.skipped ?? [];
  // The ingredient that knocked out the most suggestions, when a diet did it.
  // Allergy blocks stay unnamed — the user knows what they're allergic to.
  const blockingTerm = skipped.find((entry) => entry.reason === 'diet' && entry.term)?.term ?? null;

  return (
    <View style={styles.container}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerRow}>
          <View style={styles.headerText}>
            <Text style={styles.title}>Kusina</Text>
            <Text style={styles.subtitle}>
              {empty
                ? 'Once there is food to work with.'
                : featured?.needsShopping
                  ? "Nothing quite fits tonight — here's one worth a trip."
                  : 'Built around what you already have.'}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.savedButton}
            onPress={() => setSavedOpen(true)}
            hitSlop={HIT_SLOP}
            accessibilityRole="button"
            accessibilityLabel="Saved recipes"
          >
            <Ionicons name="heart" size={16} color={colors.primaryDark} />
            <Text style={styles.savedButtonText}>
              {saved.length > 0 ? `Saved ${saved.length}` : 'Saved'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* The diet, shown on the screen it governs. Without this the rule is
            invisible here and the user has to take it on trust that anything
            was applied at all. */}
        {!empty && diets.length > 0 && (
          <TouchableOpacity
            style={styles.dietRow}
            onPress={onOpenProfile}
            disabled={!onOpenProfile}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`Your diet: ${diets.join(', ')}. Change in Profile.`}
          >
            <Ionicons name="leaf" size={13} color={colors.primaryDark} />
            {diets.map((diet) => (
              <View
                key={diet}
                // Solid when the rule is checked ingredient by ingredient,
                // outline when Panzi can only aim for it. "Low sugar" is not a
                // promise it can keep the way "Halal" is, and one chip style
                // for both would say otherwise.
                style={[styles.dietChip, !isEnforceable(diet) && styles.dietChipSoft]}
              >
                <Text
                  style={[styles.dietChipText, !isEnforceable(diet) && styles.dietChipTextSoft]}
                >
                  {diet}
                </Text>
              </View>
            ))}
          </TouchableOpacity>
        )}

        {/* Hidden on an empty pantry: a row of ways to refine nothing. */}
        {!empty && !profileFailed && (
          <MoodChips value={mood} onChange={setMood} disabled={phase === 'loading'} />
        )}

        {/* Nothing on the shelves. No call is made — asking a model what to
            cook with an empty fridge spends money to be told nothing. */}
        {empty && (
          <View style={styles.card}>
            <Text style={styles.emptyTitle}>Nothing to cook with yet</Text>
            <Text style={styles.emptyBody}>
              Scan a few things in and I&apos;ll build dinner around whatever needs eating first.
            </Text>
          </View>
        )}

        {/* Sits above every other state on purpose. Without the profile we do
            not know what the user cannot eat, so this screen has nothing safe
            to say — and saying nothing is the correct output, not a
            degraded one. */}
        {!empty && profileFailed && (
          <View style={styles.card}>
            <Text style={styles.emptyTitle}>Can&apos;t check your preferences</Text>
            <Text style={styles.emptyBody}>
              I couldn&apos;t load your diet and allergies just now, and I won&apos;t suggest food
              without them. Check your connection and try again.
            </Text>
          </View>
        )}

        {!empty && !profileFailed && phase === 'loading' && <LoadingCards />}

        {!empty && !profileFailed && phase === 'failed' && (
          <View style={styles.card}>
            <Text style={styles.emptyTitle}>Couldn&apos;t think of anything</Text>
            <Text style={styles.emptyBody}>{error}</Text>
            <TouchableOpacity
              style={styles.retryButton}
              onPress={rebuild}
              activeOpacity={0.85}
            >
              <Text style={styles.retryText}>Try again</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* A successful call that produced nothing usable — every suggestion
            was filtered out by one of the gates. Said plainly rather than shown
            as an error, because nothing failed.

            The rule that did it is named where we know it. "Nothing tonight" on
            its own leaves the user to guess, and the likeliest guess is that the
            app is broken rather than that their own list is tight. */}
        {!empty && !profileFailed && phase === 'ready' && !featured && (
          <View style={styles.card}>
            <Text style={styles.emptyTitle}>Nothing I&apos;d suggest tonight</Text>
            <Text style={styles.emptyBody}>
              {blockingTerm
                ? `Everything I thought of ran into ${blockingTerm}. Try a different mood, or loosen a rule in your profile.`
                : "I couldn't find something that works with what you have and what you avoid. Try again once there is a bit more in."}
            </Text>
            <TouchableOpacity
              style={styles.retryButton}
              onPress={rebuild}
              activeOpacity={0.85}
            >
              <Text style={styles.retryText}>Try again</Text>
            </TouchableOpacity>
          </View>
        )}

        {!empty && !profileFailed && phase === 'ready' && featured && (
          <>
            <FeaturedRecipeCard
              recipe={{
                title: featured.title,
                look: featured.look,
                dishKey: featured.dishKey,
                minutes: featured.minutes,
                ingredientsHave: ingredientCounts(featured).have,
                ingredientsTotal: ingredientCounts(featured).total,
                usesExpiringCount: featured.usesExpiring.length,
                needsShopping: featured.needsShopping,
                why: featured.why,
              }}
              saved={savedKeys.has(savedKey(featured))}
              onOpen={() => setOpen(featured)}
              onStartCooking={() => setCooking(featured)}
              onShuffle={rebuild}
              onToggleSave={() => toggleSave(featured)}
            />

            {set!.alternates.length > 0 && (
              <>
                <View style={styles.sectionHeaderRow}>
                  <Text style={styles.sectionHeader}>Also tonight</Text>
                </View>
                <View style={styles.miniRow}>
                  {set!.alternates.map((recipe, i) => (
                    <MiniRecipeCard
                      key={`${recipe.title}-${i}`}
                      recipe={{
                        title: recipe.title,
                        look: recipe.look,
                        dishKey: recipe.dishKey,
                        minutes: recipe.minutes,
                      }}
                      onPress={() => setOpen(recipe)}
                    />
                  ))}
                </View>
              </>
            )}

            {/* Why there are two cards instead of three. Without this the gate
                is invisible and a short list looks like a bad night rather than
                a rule being kept. */}
            {skipped.length > 0 && <SkippedNote skipped={skipped} />}
          </>
        )}
      </ScrollView>

      <RecipeDetailScreen
        recipe={open}
        saved={open ? savedKeys.has(savedKey(open)) : false}
        onToggleSave={() => open && toggleSave(open)}
        onStartCooking={() => {
          // The detail sheet closes as cook mode opens. Two stacked modals is a
          // way to end up behind the wrong one when cook mode is dismissed.
          const recipe = open;
          setOpen(null);
          setCooking(recipe);
        }}
        onClose={() => setOpen(null)}
      />

      <CookModeScreen recipe={cooking} items={items ?? []} onClose={() => setCooking(null)} />

      <SavedRecipesScreen
        visible={savedOpen}
        saved={saved}
        diets={diets}
        onOpen={(recipe) => {
          setSavedOpen(false);
          setOpen(recipe);
        }}
        onClose={() => setSavedOpen(false)}
      />
    </View>
  );
}

/**
 * "Skipped 1 that had pork in it."
 *
 * Stated once, in one line, and never as an error — nothing failed. The term is
 * named when a diet caught it, because "pork" tells the user the rule is
 * working. An allergy catch is left unnamed: they know what they're allergic to,
 * and repeating it back adds nothing.
 */
function SkippedNote({ skipped }: { skipped: SkippedRecipe[] }) {
  const styles = useStyles();
  const colors = useColors();
  const terms = skipped
    .filter((entry) => entry.reason === 'diet' && entry.term)
    .map((entry) => entry.term);

  const count = skipped.length;
  const what = count === 1 ? 'one' : `${count}`;
  const detail = terms.length > 0 ? ` that had ${terms[0]} in it` : " that didn't fit what you avoid";

  return (
    <View style={styles.skippedRow}>
      <Ionicons name="filter-outline" size={13} color={colors.textSecondary} />
      <Text style={styles.skippedText}>
        Skipped {what}
        {detail}.
      </Text>
    </View>
  );
}

/** Placeholders in the cards' own shape, so the screen doesn't jump when the
 *  answer lands. A centred spinner on an empty page would move everything. */
function LoadingCards() {
  const styles = useStyles();
  const colors = useColors();
  return (
    <>
      <View style={styles.skeletonFeatured}>
        <ActivityIndicator color={colors.primaryDark} />
        <Text style={styles.skeletonText}>Looking at what you have…</Text>
      </View>
      <View style={styles.miniRow}>
        <View style={styles.skeletonMini} />
        <View style={styles.skeletonMini} />
      </View>
    </>
  );
}

const useStyles = makeStyles((colors) => ({
  container: {
    flex: 1,
    backgroundColor: colors.backgroundLight,
  },
  centre: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xxl,
  },
  content: {
    paddingHorizontal: space.xl,
    paddingTop: space.md,
    paddingBottom: SCAN_BUTTON_LIFT + 34 + 24,
    gap: space.xl,
  },
  dietRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: space.xs2,
    marginTop: -8,
  },
  dietChip: {
    paddingVertical: space.xs,
    paddingHorizontal: space.sm2,
    borderRadius: 999,
    backgroundColor: colors.primaryLighter,
  },
  dietChipSoft: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.primaryLine,
  },
  dietChipText: {
    fontWeight: '800',
    fontSize: type.micro.fontSize,
    color: colors.primaryDark,
  },
  dietChipTextSoft: {
    color: colors.tabInactive,
  },
  skippedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginTop: -6,
  },
  skippedText: {
    flex: 1,
    fontWeight: '600',
    fontSize: type.caption.fontSize,
    color: colors.textSecondary,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  savedButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs2,
    height: 36,
    paddingHorizontal: space.md2,
    borderRadius: 999,
    backgroundColor: colors.primaryLighter,
  },
  savedButtonText: {
    fontWeight: '800',
    fontSize: type.label.fontSize,
    color: colors.primaryDark,
  },
  title: {
    fontFamily: fonts.display,
    fontWeight: '800',
    fontSize: type.headline.fontSize,
    color: colors.primaryDarker,
  },
  subtitle: {
    fontWeight: '600',
    fontSize: type.label.fontSize,
    color: colors.textSecondary,
    marginTop: space.xs,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionHeader: {
    fontWeight: '800',
    fontSize: type.subtitle.fontSize,
    color: colors.primaryDarker,
  },
  miniRow: {
    flexDirection: 'row',
    gap: space.md,
  },
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
    borderRadius: 22,
    padding: space.xl,
  },
  emptyTitle: {
    fontFamily: fonts.display,
    fontWeight: '700',
    fontSize: type.title.fontSize,
    lineHeight: 24,
    color: colors.primaryDarker,
    marginBottom: space.sm,
  },
  emptyBody: {
    fontWeight: '600',
    fontSize: type.label.fontSize,
    lineHeight: 19,
    color: colors.textSecondary,
  },
  retryButton: {
    alignSelf: 'flex-start',
    marginTop: space.lg,
    height: 44,
    justifyContent: 'center',
    paddingHorizontal: space.lg2,
    borderRadius: 14,
    backgroundColor: colors.primary,
  },
  retryText: {
    fontWeight: '800',
    fontSize: type.bodySmall.fontSize,
    color: colors.onAccent,
  },
  skeletonFeatured: {
    height: 236,
    borderRadius: 26,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.md,
  },
  skeletonText: {
    fontWeight: '700',
    fontSize: type.label.fontSize,
    color: colors.textSecondary,
  },
  skeletonMini: {
    flex: 1,
    height: 118,
    borderRadius: 20,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
  },
}));