// src/screens/RecipesScreen.tsx
//
// Everything the app suggests cooking. These cards used to sit on Home, which
// made the landing screen an answer to a question nobody had asked yet —
// recipes belong behind a tab you tap when you want them.
//
// Two entirely different data sources sit behind the same four category
// tabs (All / Quick and Easy / Main Dish / Snacks), switched by the Pantry
// Only toggle:
//
// Pantry Only OFF is a cookbook. The four tabs read straight from the fixed
// 52-recipe list in data/localRecipes.ts, filtered by category client-side.
// No network call, no pantry, no diet/allergy check — see localRecipeToRecipe
// below for exactly which fields that implies leaving at their "nothing to
// report" defaults, and why that's honest rather than a shortcut.
//
// Pantry Only ON is a suggestion engine. Only in this mode does the recipe
// route get called: real dishes built by Claude from the pantry as it
// stands, weighted toward whatever is about to go off, with the same
// category tab now shaping the question sent to the model instead of
// filtering a local list. The card layout is unchanged either way — its
// shape (title, minutes, ingredients on hand, uses-expiring count) was
// designed for the AI-generated data, so the local path only ever needed
// filling with something that looks the same on screen.
//
// This mode still tries hard not to call the model more than it has to. A
// suggestion is cached against a fingerprint of the pantry, the profile and
// the day, with one entry per mood; opening this tab ten times before
// dinner costs one call, not ten, and flipping between Quick and Ulam and
// back costs nothing at all. Only a real change — food added or eaten, a
// diet edited, a new day, a mood not asked for yet, or the user asking for
// something else — spends another. None of this applies with Pantry Only
// off: LOCAL_RECIPES has nothing to cache, because it never fetches.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  View,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Text from '../components/Text';
import { auth } from '../config/firebaseClient';
import { LOCAL_RECIPES, LocalRecipe } from '../data/localRecipes';
import { PantryItem, subscribeToPantryItems } from '../services/pantry';
import { UserProfile, subscribeToProfile } from '../services/profile';
import {
  BrowseRecipeSet,
  Recipe,
  RecipeError,
  RecipeMood,
  RecipeSet,
  SkippedRecipe,
  browseSignature,
  fetchAlternateRecipes,
  fetchBrowseRecipes,
  fetchFeaturedRecipe,
  ingredientCounts,
  isCookableFromPantry,
  usesPantryItems,
  loadCachedBrowse,
  loadCachedRecipes,
  pantrySignature,
  saveCachedBrowse,
  saveCachedRecipes,
  withLiveIngredients,
} from '../services/recipes';
import {
  SavedRecipe,
  savedKey,
  saveRecipe,
  subscribeToSavedRecipes,
  unsaveRecipe,
} from '../services/savedRecipes';
import { SCAN_BUTTON_LIFT, TAB_BAR_CONTENT_HEIGHT } from '../navigation/TabBar';
import { FeaturedRecipeCard } from '../components/home/RecipeCards';
import RecipeTabs from '../components/recipes/RecipeTabs';
import PantryToggle from '../components/recipes/PantryToggle';
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

/**
 * A local cookbook entry, shaped like the AI-generated Recipe every other
 * screen already knows how to render — FeaturedRecipeCard, RecipeDetailScreen
 * and CookModeScreen all take a Recipe, not a LocalRecipe, so this is the one
 * place that difference gets papered over rather than three.
 *
 * The pantry-specific fields (have, usesExpiring, pantryUsed, needsShopping,
 * why) have no meaning for a dish that was never matched against anyone's
 * shelves — they're set to their "nothing to report" values rather than
 * guessed at. `have: false` on every ingredient is deliberately the honest
 * answer here, not a bug: this dish was not checked against a pantry, so
 * nothing on it can truthfully be marked as already on hand.
 */
function localRecipeToRecipe(local: LocalRecipe): Recipe {
  return {
    title: local.title,
    look: local.look,
    dishKey: local.dishKey,
    minutes: local.minutes,
    servings: local.servings,
    description: local.description,
    why: '',
    needsShopping: false,
    usesExpiring: [],
    pantryUsed: [],
    ingredients: local.ingredients.map((i) => ({
      name: i.name,
      amount: i.amount,
      have: false,
      assumedStaple: false,
    })),
    steps: local.steps,
  };
}

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
  // Pull-to-refresh's own spinner, separate from `phase`: a refresh has
  // something to show already, so it should not be swapped out for the
  // skeleton cards the way a first load or Shuffle is.
  const [refreshing, setRefreshing] = useState(false);
  const [mood, setMood] = useState<RecipeMood>('anything');
  // Independent of mood on purpose — switching category tabs shouldn't
  // silently clear a filter the user just set, any more than checking
  // Pantry Only should reset which category they were browsing.
  const [pantryOnly, setPantryOnly] = useState(false);
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

  // "All Recipes" — a browse list, kept entirely separate from set/phase/
  // builtFor above rather than sharing them. It has its own data shape (no
  // featured/alternates), its own signature (no pantry in it at all), and
  // sharing state with the pantry-anchored path is exactly what let stale
  // pantry-matched cards leak into All before this fix.
  const [browseSet, setBrowseSet] = useState<BrowseRecipeSet | null>(null);
  const [browsePhase, setBrowsePhase] = useState<Phase>('loading');
  const [browseError, setBrowseError] = useState<string | null>(null);
  const browseBuiltFor = useRef<string | null>(null);
  const browseInFlight = useRef(false);

  // Titles already shown this session, per mood (plus a 'browse' bucket for
  // All Recipes) — sent to the server on the next fetch so Shuffle and
  // pull-to-refresh surface something new instead of the same three dishes.
  // Session-only and in memory on purpose: it only needs to outlive the
  // handful of refreshes someone actually does in one sitting, not survive
  // an app restart, so there is nothing here worth the schema-versioning cost
  // the recipe cache above already pays for.
  const recentTitles = useRef<Record<string, string[]>>({});
  const RECENT_TITLES_CAP = 12;

  function rememberTitles(bucket: string, titles: string[]) {
    if (titles.length === 0) return;
    const prev = recentTitles.current[bucket] ?? [];
    const next = [...prev, ...titles.filter((t) => !prev.includes(t))];
    recentTitles.current[bucket] = next.slice(-RECENT_TITLES_CAP);
  }

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
        // Pantry Only itself needs the profile it just lost — its own toggle
        // hides in this state (see the render below) so there'd be no way
        // back to the local cookbook if this left pantryOnly sitting at
        // true. Falling back automatically means a broken profile listener
        // degrades to "the recipes tab still works, just as a cookbook"
        // rather than a dead end.
        setPantryOnly(false);
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
    async (
      pantry: PantryItem[],
      who: UserProfile,
      which: RecipeMood,
      force: boolean,
      // Pull-to-refresh already has a set of cards on screen — the skeleton
      // phase is for when there is nothing to show yet, and swapping the
      // whole page out from under a gesture the user is still holding reads
      // as the screen losing its place, not refreshing it.
      silent = false
    ) => {
      if (!uid || inFlight.current) return;

      const signature = pantrySignature(pantry, who);
      // Mood is part of the guard, not the signature: the signature describes
      // the pantry and has to stay comparable across moods in the cache file.
      const token = `${which}#${signature}`;
      if (!force && builtFor.current === token) return;

      inFlight.current = true;
      if (!silent) setPhase('loading');
      setError(null);

      try {
        if (!force) {
          const cached = await loadCachedRecipes(uid, signature, which);
          if (cached) {
            builtFor.current = token;
            setSet(cached);
            setPhase('ready');
            if (cached.featured) rememberTitles(which, [cached.featured.title, ...cached.alternates.map((r) => r.title)]);
            return;
          }
        }

        // Only asked to dodge titles it has already shown for this mood, and
        // only on a forced re-roll — an ordinary first load has nothing to
        // avoid yet, and asking the model to dodge an empty list would just
        // be dead weight in every request.
        const avoidTitles = force ? (recentTitles.current[which] ?? []) : [];

        // Split in two: the featured dish is one recipe instead of three, so
        // it comes back in a fraction of the old combined call's time — the
        // screen renders it the moment it lands rather than waiting on the
        // two alternates as well. Alternates are then fetched separately and
        // merged in when they arrive; if that second call is slower or even
        // fails, the featured card the user is actually looking at is
        // unaffected — see the catch below, which is deliberately scoped to
        // just that fetch.
        const featuredResult = await fetchFeaturedRecipe(pantry, who, which, avoidTitles);
        builtFor.current = token;
        setSet({ featured: featuredResult.featured, alternates: [], skipped: featuredResult.skipped });
        setPhase('ready');
        if (featuredResult.featured) rememberTitles(which, [featuredResult.featured.title]);

        if (featuredResult.featured) {
          try {
            const alternatesAvoid = [...avoidTitles, featuredResult.featured.title];
            const alternatesResult = await fetchAlternateRecipes(pantry, who, which, alternatesAvoid);
            const complete: RecipeSet = {
              featured: featuredResult.featured,
              alternates: alternatesResult.alternates,
              skipped: [...featuredResult.skipped, ...alternatesResult.skipped],
            };
            setSet(complete);
            if (alternatesResult.alternates.length > 0) {
              rememberTitles(which, alternatesResult.alternates.map((r) => r.title));
            }
            // Only a usable answer is worth keeping — caching a set with no
            // alternates would hold Shuffle's "something different" promise
            // to just one dish for the rest of the day.
            await saveCachedRecipes(uid, signature, which, complete);
          } catch {
            // The featured card is already on screen and correct on its own
            // — losing the alternates costs a shorter list, not a broken
            // page, so this fails silently rather than surfacing an error
            // for a request the user never directly asked for.
          }
        }
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

  const buildBrowse = useCallback(
    async (who: UserProfile, pantry: PantryItem[], force: boolean, silent = false) => {
      if (!uid || browseInFlight.current) return;

      const signature = browseSignature(who);
      if (!force && browseBuiltFor.current === signature) return;

      browseInFlight.current = true;
      if (!silent) setBrowsePhase('loading');
      setBrowseError(null);

      try {
        if (!force) {
          const cached = await loadCachedBrowse(uid, signature);
          if (cached) {
            browseBuiltFor.current = signature;
            setBrowseSet(cached);
            setBrowsePhase('ready');
            rememberTitles('browse', cached.recipes.map((r) => r.title));
            return;
          }
        }

        const avoidTitles = force ? (recentTitles.current.browse ?? []) : [];
        const fresh = await fetchBrowseRecipes(who, pantry, avoidTitles);
        browseBuiltFor.current = signature;
        setBrowseSet(fresh);
        setBrowsePhase('ready');
        rememberTitles('browse', fresh.recipes.map((r) => r.title));
        if (fresh.recipes.length > 0) await saveCachedBrowse(uid, signature, fresh);
      } catch (err) {
        setBrowseError(
          err instanceof RecipeError ? err.message : 'Something went wrong — try again.'
        );
        setBrowsePhase('failed');
      } finally {
        browseInFlight.current = false;
      }
    },
    [uid]
  );

  useEffect(() => {
    // The AI call this effect exists to trigger is Pantry Only's whole
    // reason to run at all — see the top-of-file note and the ticket this
    // gate was added for: every tab used to hit the model regardless of
    // this toggle, which is exactly backwards from what Pantry Only is
    // supposed to mean. With it off, the four tabs read straight from
    // LOCAL_RECIPES below and this effect has nothing to do.
    if (!pantryOnly) return;
    // Handled by the browse effect below — a different data shape, a
    // different signature, no pantry involved at all.
    if (mood === 'anything') return;
    // Both listeners must have reported before the first call. `profile` being
    // null is the gate that stops a request going out with an allergy list
    // that is empty only because it hasn't loaded. Chips do not relax it.
    if (items === null || profile === null) return;
    if (items.length === 0) {
      setPhase('ready');
      setSet(null);
      return;
    }

    const signature = pantrySignature(items, profile);
    const builtMood = builtFor.current?.split('#')[0];
    // A background pantry change altered the signature for the mood already
    // on screen — don't silently swap the cards. The next explicit action
    // (Shuffle, pull-to-refresh, switching mood away and back) re-derives
    // the signature and picks it up then.
    if (builtMood === mood && builtFor.current !== `${mood}#${signature}`) return;

    void build(items, profile, mood, false);
  }, [items, profile, mood, pantryOnly, build]);

  useEffect(() => {
    // Same gate as the pantry-anchored effect above — All Recipes' own AI
    // call (fetchBrowseRecipes) only has a reason to run once Pantry Only
    // asks for something matched against the pantry. Off, this tab reads
    // the local list the same as the other three.
    if (!pantryOnly) return;
    if (mood !== 'anything') return;
    if (profile === null) return;

    const signature = browseSignature(profile);
    // Same principle as the pantry-anchored effect above: once something is
    // showing, a background diet/allergy edit doesn't silently swap it.
    if (browseBuiltFor.current !== null && browseBuiltFor.current !== signature) return;

    void buildBrowse(profile, items ?? [], false);
  }, [profile, mood, pantryOnly, items, buildBrowse]);

  /** Shuffle and Try again. Both need the same two things to have landed. */
  const rebuild = useCallback(() => {
    // Nothing to re-roll — LOCAL_RECIPES is a fixed list, not a suggestion
    // the model could come back with a different answer for. Both this and
    // onPullRefresh below are wired to Shuffle and the pull gesture, neither
    // of which the local-list render path offers in the first place (see
    // the pantryOnly branch in the return below), so this guard is a second
    // line of defence, not the only one.
    if (!pantryOnly) return;
    if (mood === 'anything') {
      if (profile) void buildBrowse(profile, items ?? [], true);
      return;
    }
    if (items && profile) void build(items, profile, mood, true);
  }, [items, profile, mood, pantryOnly, build, buildBrowse]);

  /** Pull-to-refresh at the top of the list — the same forced re-roll as
   *  Shuffle, just reached by a gesture instead of a button, and quiet about
   *  it: the pull spinner is already telling the user something is
   *  happening, so the cards stay on screen instead of clearing to skeletons. */
  const onPullRefresh = useCallback(async () => {
    if (!pantryOnly) return;
    if (!profile) return;
    setRefreshing(true);
    try {
      if (mood === 'anything') {
        await buildBrowse(profile, items ?? [], true, true);
      } else if (items) {
        await build(items, profile, mood, true, true);
      }
    } finally {
      setRefreshing(false);
    }
  }, [items, profile, mood, pantryOnly, build, buildBrowse]);

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

  // The featured pick and its alternates, in the order the server returned
  // them, each carrying its own have/total (the card's on-hand display),
  // whether it's cookable with nothing bought at all (the "In your pantry"
  // badge — still the strict, zero-shopping question), and whether it uses
  // anything from the pantry at all (Pantry Only's own filter — see
  // usesPantryItems's own doc comment for why this is deliberately looser
  // than "cookable": a one- or two-item pantry will almost never clear the
  // zero-shopping bar, which used to make Pantry Only look broken — three
  // matching recipes existed, the toggle just never had a reason to say so).
  const allCards = useMemo(() => {
    if (!featured) return [];
    return [featured, ...(set?.alternates ?? [])].map((recipe) => {
      const { have, total } = ingredientCounts(recipe);
      const cookable = isCookableFromPantry(recipe, items ?? []);
      const usesPantry = usesPantryItems(recipe, items ?? []);
      return { recipe, have, total, cookable, usesPantry };
    });
  }, [featured, set, items]);

  // Against the full list, not the filtered one — this is what Pantry Only
  // is offering to switch to, so it has to keep counting even while the
  // toggle it describes is off.
  const cookableCount = useMemo(
    () => allCards.filter((c) => c.usesPantry).length,
    [allCards]
  );

  const visibleCards = useMemo(
    () => (pantryOnly ? allCards.filter((c) => c.usesPantry) : allCards),
    [allCards, pantryOnly]
  );

  // Same question, asked of the browse list instead — usesPantry depends on
  // "have" being checked against the pantry that was current at the last
  // browse fetch (see fetchBrowseRecipes), not the live pantry, since the
  // list itself only regenerates on a pull-to-refresh/Shuffle/day change.
  const browseCookableCount = useMemo(
    () => (browseSet?.recipes ?? []).filter((r) => usesPantryItems(r, items ?? [])).length,
    [browseSet, items]
  );

  const visibleBrowseRecipes = useMemo(() => {
    const recipes = browseSet?.recipes ?? [];
    return pantryOnly ? recipes.filter((r) => usesPantryItems(r, items ?? [])) : recipes;
  }, [browseSet, pantryOnly, items]);

  // Pantry Only OFF: the fixed cookbook, not a suggestion — see the file
  // header and localRecipes.ts's own header for why this reads a local list
  // instead of asking the model anything. "All" is every entry; the other
  // three tabs are LOCAL_RECIPES filtered by the matching category. No
  // pantry, no diet/allergy gate, no loading state — this is synchronous
  // data, not a fetch.
  const localRecipes = useMemo(() => {
    const filtered = mood === 'anything' ? LOCAL_RECIPES : LOCAL_RECIPES.filter((r) => r.category === mood);
    return filtered.map(localRecipeToRecipe);
  }, [mood]);

  return (
    <View style={styles.container}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onPullRefresh}
            // Disabled the same moments Shuffle already is — a pull that
            // fires off a second request while one is still in flight, or
            // before what it needs has loaded, would race the very call it
            // triggered. Browse mode only needs the profile; every other
            // mood needs the pantry too. With Pantry Only off there is no
            // call to race in the first place — onPullRefresh already
            // no-ops there, and disabling the gesture here keeps the
            // affordance from promising a refresh that does nothing.
            enabled={
              pantryOnly &&
              (mood === 'anything'
                ? browsePhase !== 'loading' && profile !== null
                : !empty && phase !== 'loading' && items !== null && profile !== null)
            }
            tintColor={colors.primaryDark}
            colors={[colors.primaryDark]}
          />
        }
      >
        <View style={styles.headerRow}>
          <View style={styles.headerText}>
            <Text style={styles.title}>Recipe</Text>
            <Text style={styles.subtitle}>
              {!pantryOnly
                ? 'Filipino dishes to try, any night.'
                : mood === 'anything'
                  ? 'Filipino dishes to try, any night.'
                  : empty
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
            was applied at all. Shown in browse mode too — the diet still
            applies there, an empty pantry just isn't the reason it's hidden.
            Hidden entirely with Pantry Only off: LOCAL_RECIPES is a plain,
            unfiltered list, and showing this chip there would claim a
            guarantee — "this is checked against your diet" — that nothing
            on the local-list path actually keeps. */}
        {pantryOnly && (mood === 'anything' || !empty) && diets.length > 0 && (
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

        {/* The tabs stay reachable even when the profile failed to load —
            LOCAL_RECIPES doesn't read the profile at all, so a broken diet/
            allergy listener has no reason to also block browsing the fixed
            cookbook. Pantry Only itself still needs the profile (the model
            call it drives sends the diet/allergy list), so it alone stays
            gated on profileFailed, same as it already was on an empty
            pantry. */}
        <View style={styles.filters}>
          <RecipeTabs
            value={mood}
            onChange={setMood}
            // phase/browsePhase start at 'loading' and, with Pantry Only
            // off, never move past it — nothing sets them, because the
            // effects that would are gated on pantryOnly now (see those
            // effects above). Reading them here unguarded would leave the
            // tabs permanently disabled the moment someone turns Pantry
            // Only off, which is the opposite of what this screen is
            // meant to do in that mode — LOCAL_RECIPES has nothing to
            // wait on, so nothing here should ever read as "loading".
            disabled={pantryOnly && (mood === 'anything' ? browsePhase === 'loading' : phase === 'loading')}
          />
          {!empty && !profileFailed && (
            <PantryToggle
              value={pantryOnly}
              onChange={setPantryOnly}
              cookableCount={mood === 'anything' ? browseCookableCount : cookableCount}
              disabled={pantryOnly && (mood === 'anything' ? browsePhase === 'loading' : phase === 'loading')}
            />
          )}
        </View>

        {/* Everything from here to the end of the scroll view is Pantry
            Only's own territory — the AI-generated, pantry-matched path.
            With the toggle off, none of this fetches, loads or renders;
            the block right after it (LOCAL_RECIPES, below) takes over
            instead. See the ticket this split was made for: every tab used
            to call the model regardless of Pantry Only, which defeated the
            point of the toggle. */}
        {pantryOnly && (
          <>
        {/* Nothing on the shelves. No call is made — asking a model what to
            cook with an empty fridge spends money to be told nothing. Does
            not apply to All Recipes, which never needed a pantry. */}
        {mood !== 'anything' && empty && (
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
        {mood !== 'anything' && !empty && profileFailed && (
          <View style={styles.card}>
            <Text style={styles.emptyTitle}>Can&apos;t check your preferences</Text>
            <Text style={styles.emptyBody}>
              I couldn&apos;t load your diet and allergies just now, and I won&apos;t suggest food
              without them. Check your connection and try again.
            </Text>
          </View>
        )}

        {mood !== 'anything' && !empty && !profileFailed && phase === 'loading' && <LoadingCards />}

        {mood !== 'anything' && !empty && !profileFailed && phase === 'failed' && (
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
        {mood !== 'anything' && !empty && !profileFailed && phase === 'ready' && !featured && (
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

        {mood !== 'anything' &&
          !empty &&
          !profileFailed &&
          phase === 'ready' &&
          featured &&
          visibleCards.length > 0 && (
            <>
              {visibleCards.map((card, i) => (
                <FeaturedRecipeCard
                  key={`${card.recipe.title}-${i}`}
                  recipe={{
                    title: card.recipe.title,
                    look: card.recipe.look,
                    dishKey: card.recipe.dishKey,
                    minutes: card.recipe.minutes,
                    ingredientsHave: card.have,
                    ingredientsTotal: card.total,
                    usesExpiringCount: card.recipe.usesExpiring.length,
                    needsShopping: card.recipe.needsShopping,
                    why: card.recipe.why,
                  }}
                  saved={savedKeys.has(savedKey(card.recipe))}
                  onOpen={() => setOpen(card.recipe)}
                  // Only the first card actually on screen gets to be cooked or
                  // shuffled — usually the AI's own pick, but Pantry Only can
                  // hide that one and leave an alternate standing in its place.
                  onStartCooking={i === 0 ? () => setCooking(card.recipe) : undefined}
                  onShuffle={i === 0 ? rebuild : undefined}
                  onToggleSave={() => toggleSave(card.recipe)}
                />
              ))}

              {/* Why the list is shorter than three. Without this the gate is
                  invisible and a short list looks like a bad night rather than
                  a rule being kept. */}
              {skipped.length > 0 && <SkippedNote skipped={skipped} />}
            </>
          )}

        {/* Pantry Only hid every suggestion this pantry actually has. Said
            plainly, with the way back out right there — the toggle the user
            just reached for is one tap above this card. */}
        {mood !== 'anything' &&
          !empty &&
          !profileFailed &&
          phase === 'ready' &&
          featured &&
          visibleCards.length === 0 && (
            <View style={styles.card}>
              <Text style={styles.emptyTitle}>Nothing here yet</Text>
              <Text style={styles.emptyBody}>
                Switch Pantry only off and we&apos;ll include a one-stop trip.
              </Text>
            </View>
          )}

        {/* All Recipes — a browse list, entirely separate state from
            everything above. Same shape of state machine (loading/failed/
            ready-empty/ready), just against browsePhase/browseSet. */}
        {mood === 'anything' && !profileFailed && browsePhase === 'loading' && <LoadingCards />}

        {mood === 'anything' && !profileFailed && browsePhase === 'failed' && (
          <View style={styles.card}>
            <Text style={styles.emptyTitle}>Couldn&apos;t think of anything</Text>
            <Text style={styles.emptyBody}>{browseError}</Text>
            <TouchableOpacity style={styles.retryButton} onPress={rebuild} activeOpacity={0.85}>
              <Text style={styles.retryText}>Try again</Text>
            </TouchableOpacity>
          </View>
        )}

        {mood === 'anything' &&
          !profileFailed &&
          browsePhase === 'ready' &&
          (browseSet?.recipes.length ?? 0) === 0 && (
            <View style={styles.card}>
              <Text style={styles.emptyTitle}>Nothing I&apos;d suggest right now</Text>
              <Text style={styles.emptyBody}>
                {browseSet && browseSet.skipped.length > 0
                  ? 'Everything I thought of ran into your diet or allergies. Try again in a bit.'
                  : "Couldn't think of anything just now. Try again in a bit."}
              </Text>
              <TouchableOpacity style={styles.retryButton} onPress={rebuild} activeOpacity={0.85}>
                <Text style={styles.retryText}>Try again</Text>
              </TouchableOpacity>
            </View>
          )}

        {/* Pantry Only filtered out everything on the browse list — distinct
            from the "nothing suggested at all" card above, same distinction
            the pantry-anchored path already draws (see visibleCards.length
            === 0 above). Shuffle here doubles as a way to force a fresh
            check against the pantry without relying on the pull gesture. */}
        {mood === 'anything' &&
          !profileFailed &&
          browsePhase === 'ready' &&
          (browseSet?.recipes.length ?? 0) > 0 &&
          visibleBrowseRecipes.length === 0 && (
            <View style={styles.card}>
              <Text style={styles.emptyTitle}>Nothing here yet</Text>
              <Text style={styles.emptyBody}>
                Switch Pantry only off to see everything I thought of, or shuffle for a fresh list.
              </Text>
              <TouchableOpacity style={styles.retryButton} onPress={rebuild} activeOpacity={0.85}>
                <Text style={styles.retryText}>Shuffle</Text>
              </TouchableOpacity>
            </View>
          )}

        {mood === 'anything' &&
          !profileFailed &&
          browsePhase === 'ready' &&
          visibleBrowseRecipes.length > 0 && (
            <>
              {visibleBrowseRecipes.map((recipe, i) => (
                <FeaturedRecipeCard
                  key={`${recipe.title}-${i}`}
                  recipe={{
                    title: recipe.title,
                    look: recipe.look,
                    dishKey: recipe.dishKey,
                    minutes: recipe.minutes,
                    usesExpiringCount: 0,
                    description: recipe.description,
                  }}
                  saved={savedKeys.has(savedKey(recipe))}
                  // The pantry may have moved on since the last browse fetch
                  // (see fetchBrowseRecipes) — recheck against it fresh at the
                  // point of opening detail, so You have/You'll need is
                  // honest without needing a whole new suggestion call.
                  onOpen={() => setOpen(withLiveIngredients(recipe, items ?? []))}
                  // Only the first card — same "one shuffle button per
                  // screen" rule the pantry-anchored list already uses
                  // (visibleCards.map above), and the one reliable way to
                  // force a fresh check against the pantry without depending
                  // on the pull gesture.
                  onShuffle={i === 0 ? rebuild : undefined}
                  onToggleSave={() => toggleSave(recipe)}
                />
              ))}
            </>
          )}
          </>
        )}

        {/* Pantry Only OFF — the fixed cookbook. Synchronous, local,
            unfiltered by the pantry or diet/allergy rules the AI path
            applies: this is a browse list of real dishes, not a claim
            about what's safe or possible to cook with what's on hand. No
            loading state, because there is nothing to wait on; no empty
            state either, because every category tab has at least one
            local recipe (see localRecipes.ts) so this can never render
            zero cards. */}
        {!pantryOnly &&
          localRecipes.map((recipe, i) => (
            <FeaturedRecipeCard
              key={`${recipe.title}-${i}`}
              recipe={{
                title: recipe.title,
                look: recipe.look,
                dishKey: recipe.dishKey,
                minutes: recipe.minutes,
                usesExpiringCount: 0,
                description: recipe.description,
              }}
              saved={savedKeys.has(savedKey(recipe))}
              onOpen={() => setOpen(recipe)}
              onToggleSave={() => toggleSave(recipe)}
            />
          ))}
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
      <View style={styles.skeletonMini} />
      <View style={styles.skeletonMini} />
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
    // flexGrow so the scroll surface always fills the screen even when the
    // list is short (e.g. Pantry Only filtering All Recipes down to a single
    // "Nothing here yet" card) — without it, some platforms don't recognize
    // a pull gesture over content shorter than the viewport as a scroll at
    // all, and RefreshControl never fires.
    flexGrow: 1,
    paddingHorizontal: space.xl,
    paddingTop: space.md,
    // Was SCAN_BUTTON_LIFT + 34 + 24 — the 34 undershot the tab bar's own
    // content height (TAB_BAR_CONTENT_HEIGHT, 72), which left the last
    // card's own bottom padding as the only thing between it and the
    // floating Scan button, not actually clear of the bar underneath that
    // button. Nav height + button overhang + 16px, as intended.
    paddingBottom: SCAN_BUTTON_LIFT + TAB_BAR_CONTENT_HEIGHT + space.lg,
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
  // Was a soft-fill pill (primaryLighter) — still a filled shape sitting
  // right beside the page title, competing with it for the first thing the
  // eye lands on. An outline in the same accent now, so it reads as a
  // secondary action rather than a second headline.
  savedButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs2,
    height: 36,
    paddingHorizontal: space.md2,
    borderRadius: 999,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.primaryLine,
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
  filters: {
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
    height: 236,
    borderRadius: 24,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
  },
}));