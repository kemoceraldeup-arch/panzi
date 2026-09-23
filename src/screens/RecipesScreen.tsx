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
// route get called: real dishes built by the model from the pantry as it
// stands, weighted toward whatever is about to go off, with the same
// category tab now shaping the question sent to the model instead of
// filtering a local list — including "All", which used to mean something
// different (a pantry-blind browse list, filtered afterward by pantry
// match) and is now the same pantry-anchored featured+alternates call the
// other three moods already make, just with mood:'anything' asking the
// model to spread across kinds of meal instead of one. A pantry-blind
// browse almost never has anything matching a small pantry, which is what
// made "All" look broken while Quick/Ulam/Merienda worked fine — the fix is
// this one mood no longer being routed anywhere different. The card layout
// is unchanged either way — its shape (title, minutes, ingredients on
// hand, uses-expiring count) was designed for the AI-generated data, so the
// local path only ever needed filling with something that looks the same
// on screen.
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
  Animated,
  Easing,
  View,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  TextInput,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Text from '../components/Text';
import { auth } from '../config/firebaseClient';
import { LOCAL_RECIPES, LocalRecipe } from '../data/localRecipes';
import { PantryItem, subscribeToPantryItems } from '../services/pantry';
import { UserProfile, subscribeToProfile } from '../services/profile';
import {
  Recipe,
  RecipeError,
  RecipeMood,
  RecipeSet,
  SkippedRecipe,
  fetchAlternateRecipes,
  fetchFeaturedRecipe,
  ingredientCounts,
  isCookableFromPantry,
  usesPantryItems,
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
import { SCAN_BUTTON_LIFT, TAB_BAR_CONTENT_HEIGHT } from '../navigation/TabBar';
import { FeaturedRecipeCard } from '../components/home/RecipeCards';
import RecipeTabs from '../components/recipes/RecipeTabs';
import PantryToggle from '../components/recipes/PantryToggle';
import RecipeDetailScreen from './RecipeDetailScreen';
import CookModeScreen from './CookModeScreen';
import SavedRecipesScreen from './SavedRecipesScreen';
import { isEnforceable } from '../utils/diet';
import { fuzzyMatchesAny } from '../utils/fuzzyMatch';
import { useCollapseOnScroll } from '../navigation/scrollCollapse';
import { fonts, type } from '../theme/typography';
import { makeStyles } from '../theme/makeStyles';
import { useColors } from '../theme/ThemeProvider';
import { space } from '../theme/spacing';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
  const collapseOnScroll = useCollapseOnScroll();
  // The floating tab bar sits its own Math.max(insets.bottom, 10) gap above
  // the screen edge (see TabBar.tsx's `wrap`) — TAB_BAR_CONTENT_HEIGHT is
  // only the bar's own content height and deliberately excludes that gap,
  // so this screen has to add it back itself or the last card ends short of
  // where the bar actually is, leaving a stretch of bare background between
  // the two that reads as the recipe being cut off rather than the floating
  // gap the bar is supposed to have.
  const insets = useSafeAreaInsets();

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
  // Search-by-name across the local cookbook, live per keystroke — see the
  // note on localRecipes below for why a non-empty query overrides the
  // category tab rather than narrowing within it. Pantry Only's own AI-
  // generated cards aren't in scope: those are already a short, freshly-
  // built list for tonight, not a big fixed catalogue worth searching.
  const [recipeSearch, setRecipeSearch] = useState('');

  // Drives the floating copy of the search bar: invisible and untouchable
  // (pointerEvents 'none') until the in-flow search field has scrolled up
  // out of view, then it fades in and floats at the top for the rest of the
  // scroll — the same idea as the bottom tab bar staying fixed, but arriving
  // only once the real one has actually left, rather than being pinned from
  // the very top of the screen.
  const searchBarY = useRef(0);
  const [isFloating, setIsFloating] = useState(false);
  const floatSearch = useRef(new Animated.Value(0)).current;

  // Back-to-top FAB — same fade/scale-in-past-a-threshold shape as the
  // floating search pill above, just gated on a much longer scroll (a full
  // screen's worth) since this button answers "I've scrolled way too far,"
  // not "the header has left." Reusing that exact mechanism rather than a
  // new one so the two floating controls this screen grows feel like one
  // system, not two separate ideas bolted on.
  const scrollRef = useRef<ScrollView>(null);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const backToTop = useRef(new Animated.Value(0)).current;
  const BACK_TO_TOP_THRESHOLD = 600;

  const onListScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = event.nativeEvent.contentOffset.y;
      const shouldFloat = y > searchBarY.current;
      setIsFloating((prev) => {
        if (prev === shouldFloat) return prev;
        Animated.timing(floatSearch, {
          toValue: shouldFloat ? 1 : 0,
          duration: 320,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }).start();
        return shouldFloat;
      });

      const shouldShowBackToTop = y > BACK_TO_TOP_THRESHOLD;
      setShowBackToTop((prev) => {
        if (prev === shouldShowBackToTop) return prev;
        Animated.timing(backToTop, {
          toValue: shouldShowBackToTop ? 1 : 0,
          duration: 240,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }).start();
        return shouldShowBackToTop;
      });
    },
    [floatSearch, backToTop]
  );

  const scrollToTop = useCallback(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  }, []);

  const [open, setOpen] = useState<Recipe | null>(null);
  const [cooking, setCooking] = useState<Recipe | null>(null);
  // Holds the recipe between "Start cooking" being tapped and the detail
  // sheet's own dismiss animation actually finishing — see the onDismiss
  // wiring below for why cook mode doesn't open in the same tick.
  const pendingCookRef = useRef<Recipe | null>(null);
  const [savedOpen, setSavedOpen] = useState(false);
  const [saved, setSaved] = useState<SavedRecipe[]>([]);

  // The signature and mood the current suggestion was built for. Guards the
  // effect below from re-running on every Firestore snapshot — the pantry
  // listener fires whenever anything changes, and most changes don't affect
  // what to cook.
  const builtFor = useRef<string | null>(null);
  // Set while a call is in flight so a second snapshot can't start a second one.
  const inFlight = useRef(false);
  // Bumped whenever a switch away and back arrives while the tab it's
  // returning to is still mid-fetch — build() drops that call rather than
  // queuing it (one in-flight call at a time, see inFlight above), and
  // without this the effect below has already run once for the mood the
  // user is looking at and won't run again on its own once the earlier call
  // finishes, leaving that tab stuck on the skeleton forever. Bumping this
  // is just "something changed, please re-check" — it carries no meaning of
  // its own and the effect re-derives everything from scratch.
  const [retryTick, setRetryTick] = useState(0);

  // Titles already shown this session, per mood — sent to the server on the
  // next fetch so Shuffle and pull-to-refresh surface something new instead
  // of the same three dishes.
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
        // See retryTick's own comment: a mood switch that arrived while this
        // call was running got dropped rather than queued (only one call in
        // flight at a time). Bumping this now — the instant it's actually
        // possible to succeed — asks the effect to look again at whatever
        // mood the user is on right now, not the one that got dropped, in
        // case they've moved on since. A no-op when nothing was dropped: the
        // effect just re-derives the same builtFor comparison and exits.
        setRetryTick((t) => t + 1);
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
    // Both listeners must have reported before the first call. `profile` being
    // null is the gate that stops a request going out with an allergy list
    // that is empty only because it hasn't loaded. Chips do not relax it.
    if (items === null || profile === null) return;
    // A truly empty pantry is the one case /featured and /alternates refuse
    // outright (server-side 400, "nothing to cook with yet") rather than
    // answering with a shopping-trip suggestion — that graceful fallback is
    // for a pantry that has *something* but not enough for a good dish, a
    // different case from having nothing at all. One item is already enough
    // to clear this and reach the model; only zero short-circuits here.
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
  }, [items, profile, mood, pantryOnly, build, retryTick]);

  /** Shuffle and Try again. Both need the same two things to have landed. */
  const rebuild = useCallback(() => {
    // Nothing to re-roll — LOCAL_RECIPES is a fixed list, not a suggestion
    // the model could come back with a different answer for. Both this and
    // onPullRefresh below are wired to Shuffle and the pull gesture, neither
    // of which the local-list render path offers in the first place (see
    // the pantryOnly branch in the return below), so this guard is a second
    // line of defence, not the only one.
    if (!pantryOnly) return;
    if (items && profile) void build(items, profile, mood, true);
  }, [items, profile, mood, pantryOnly, build]);

  /** Pull-to-refresh at the top of the list — the same forced re-roll as
   *  Shuffle, just reached by a gesture instead of a button, and quiet about
   *  it: the pull spinner is already telling the user something is
   *  happening, so the cards stay on screen instead of clearing to skeletons.
   *  Every mood, including "All", goes through the same pantry-anchored
   *  build() — refreshing re-reads the pantry as it stands right now and
   *  asks for a fresh set built from it, which is what "based on the
   *  current pantry stock" means for every tab alike. */
  const onPullRefresh = useCallback(async () => {
    if (!pantryOnly) return;
    if (!profile || !items) return;
    setRefreshing(true);
    try {
      await build(items, profile, mood, true, true);
    } finally {
      setRefreshing(false);
    }
  }, [items, profile, mood, pantryOnly, build]);

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

  // Pantry Only OFF: the fixed cookbook, not a suggestion — see the file
  // header and localRecipes.ts's own header for why this reads a local list
  // instead of asking the model anything. "All" is every entry; the other
  // three tabs are LOCAL_RECIPES filtered by the matching category. No
  // pantry, no diet/allergy gate, no loading state — this is synchronous
  // data, not a fetch.
  //
  // A live search overrides the category tab rather than combining with it:
  // once someone is searching for a dish by name they mean to search the
  // whole cookbook for it, not just whichever tab happened to be open —
  // typing "turon" while sitting on Main Dish should still find it under
  // Snacks, not come back empty. Typo-tolerant via fuzzyMatchesAny (see
  // utils/fuzzyMatch.ts) so a misspelled dish name still surfaces it, and
  // matched against title, description and every ingredient name so "beef"
  // finds dishes that use beef even when it isn't in the title.
  const search = recipeSearch.trim();
  const localRecipes = useMemo(() => {
    if (search) {
      return LOCAL_RECIPES.filter((r) =>
        fuzzyMatchesAny(search, [r.title, r.description, ...r.ingredients.map((i) => i.name)])
      ).map(localRecipeToRecipe);
    }
    const filtered = mood === 'anything' ? LOCAL_RECIPES : LOCAL_RECIPES.filter((r) => r.category === mood);
    return filtered.map(localRecipeToRecipe);
  }, [mood, search]);

  // Below every hook, deliberately — signing out flips uid to null and
  // re-renders this screen, and an early return sitting above the useMemos
  // further up would skip them on that render. React counts hooks per
  // render and throws "rendered fewer hooks than expected" the moment the
  // count drops, which is exactly the crash this used to cause on every
  // sign-out. Nothing above this point may return early for the same reason.
  if (!uid) {
    return (
      <View style={[styles.container, styles.centre]}>
        <Text style={styles.emptyBody}>Sign in to get suggestions.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* The floating copy: normally invisible, sitting on top of everything
          at the same horizontal position the in-flow search field occupies.
          Fades and slides in only once the real field has scrolled up out of
          view, then intercepts input in its place — see searchBarY/floatSearch
          below. Rendering it unconditionally (rather than mounting it only
          once floating) is what lets it fade in smoothly instead of popping
          in the instant the threshold is crossed. */}
      {!pantryOnly && (
        <Animated.View
          style={[
            styles.floatingSearchWrap,
            // insets.top belongs here, not in the static style below — this
            // screen has no SafeAreaView above it to have already spent it
            // (see FULL_BLEED in navigation/MainTabs), so without this the
            // pill would float in at the very top of the physical screen,
            // under the Dynamic Island, instead of clearing it.
            { top: insets.top },
            {
              opacity: floatSearch,
              transform: [
                {
                  translateY: floatSearch.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-8, 0],
                  }),
                },
              ],
            },
          ]}
          pointerEvents={isFloating ? 'auto' : 'none'}
        >
          <View style={[styles.searchField, styles.floatingSearchField]}>
            <Ionicons name="search-outline" size={15} color={colors.mutedLight} />
            <TextInput
              style={styles.searchInput}
              value={recipeSearch}
              onChangeText={setRecipeSearch}
              placeholder="Search recipes, e.g. adobo"
              placeholderTextColor={colors.mutedLight}
              returnKeyType="search"
              autoCorrect={false}
              autoCapitalize="none"
            />
            {recipeSearch.length > 0 && (
              <TouchableOpacity
                onPress={() => setRecipeSearch('')}
                hitSlop={HIT_SLOP}
                accessibilityRole="button"
                accessibilityLabel="Clear search"
              >
                <Ionicons name="close-circle" size={16} color={colors.mutedLight} />
              </TouchableOpacity>
            )}
          </View>
        </Animated.View>
      )}

      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={[
          styles.content,
          {
            // Spent here rather than by a SafeAreaView above this screen —
            // see FULL_BLEED in navigation/MainTabs — so styles.container's
            // own background runs all the way to the top of the screen
            // instead of stopping at a separate padded strip.
            paddingTop: insets.top + space.md,
            paddingBottom: SCAN_BUTTON_LIFT + TAB_BAR_CONTENT_HEIGHT + Math.max(insets.bottom, 10) + space.lg,
          },
        ]}
        showsVerticalScrollIndicator={false}
        onScroll={(event) => {
          collapseOnScroll.onScroll(event);
          onListScroll(event);
        }}
        scrollEventThrottle={collapseOnScroll.scrollEventThrottle}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onPullRefresh}
            // Disabled the same moments Shuffle already is — a pull that
            // fires off a second request while one is still in flight, or
            // before what it needs has loaded, would race the very call it
            // triggered. With Pantry Only off there is no call to race in
            // the first place — onPullRefresh already no-ops there, and
            // disabling the gesture here keeps the affordance from
            // promising a refresh that does nothing.
            enabled={pantryOnly && !empty && phase !== 'loading' && items !== null && profile !== null}
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
            was applied at all. Shown for "All" even when the pantry is
            empty — the model still applies the diet to whatever it suggests
            buying, so an empty pantry isn't a reason to hide the rule the
            way it is for the other three moods (see the "Nothing to cook
            with yet" card above, which those moods show instead of a call).
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

        {/* Search-by-name for the local cookbook, live per keystroke —
            typo-tolerant (see utils/fuzzyMatch.ts) so "adboo" still finds
            "Chicken adobo". Hidden with Pantry Only on: that list is
            already a short, freshly-built set of AI suggestions for
            tonight, not a catalogue worth searching, and the field would
            have nothing meaningful to filter.
            Its own position is measured (onLayout) so the floating copy
            above knows exactly when this one has scrolled out of view. */}
        {!pantryOnly && (
          <View
            style={styles.searchWrap}
            onLayout={(e) => {
              searchBarY.current = e.nativeEvent.layout.y;
            }}
          >
            <View style={styles.searchField}>
              <Ionicons name="search-outline" size={15} color={colors.mutedLight} />
              <TextInput
                style={styles.searchInput}
                value={recipeSearch}
                onChangeText={setRecipeSearch}
                placeholder="Search recipes, e.g. adobo"
                placeholderTextColor={colors.mutedLight}
                returnKeyType="search"
                autoCorrect={false}
                autoCapitalize="none"
              />
              {recipeSearch.length > 0 && (
                <TouchableOpacity
                  onPress={() => setRecipeSearch('')}
                  hitSlop={HIT_SLOP}
                  accessibilityRole="button"
                  accessibilityLabel="Clear search"
                >
                  <Ionicons name="close-circle" size={16} color={colors.mutedLight} />
                </TouchableOpacity>
              )}
            </View>
          </View>
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
            onChange={(next) => {
              // Tapping a category is a clear signal to leave search mode —
              // otherwise the tab would visibly change while the list stayed
              // pinned to whatever the search text still matched, which
              // reads as the tap not having worked.
              setRecipeSearch('');
              setMood(next);
            }}
            // phase starts at 'loading' and, with Pantry Only off, never
            // moves past it — nothing sets it, because the effect that
            // would is gated on pantryOnly now (see that effect above).
            // Reading it here unguarded would leave the tabs permanently
            // disabled the moment someone turns Pantry Only off, which is
            // the opposite of what this screen is meant to do in that mode
            // — LOCAL_RECIPES has nothing to wait on, so nothing here
            // should ever read as "loading".
            disabled={pantryOnly && phase === 'loading'}
          />
          {/* Stays visible once Pantry Only is already on, even if the
              pantry empties out underneath it (eat/remove everything while
              the toggle is on) — otherwise the only control that can turn
              it back off disappears the moment the empty-state card shows,
              and there is no way back to the local cookbook without first
              scanning something back in. A pantry that starts out empty
              still hides the toggle by default, same as before. */}
          {(!empty || pantryOnly) && !profileFailed && (
            <PantryToggle
              value={pantryOnly}
              onChange={setPantryOnly}
              cookableCount={cookableCount}
              disabled={pantryOnly && phase === 'loading'}
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
            not apply to a screen with no pantry to speak of. */}
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

        {!empty &&
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
        {!empty &&
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

      {/* Back to top — appears once the list has been scrolled far enough
          that finding your way back up by hand would be a chore, same
          fade+scale-in shape as the floating search pill above so the two
          floating controls this screen has read as one system. Sits clear
          of the floating tab bar rather than on top of it (see
          SCAN_BUTTON_LIFT/TAB_BAR_CONTENT_HEIGHT, the same figures this
          screen's own contentContainerStyle already reserves at the
          bottom), and pointerEvents keeps it from swallowing taps on
          whatever card is faded under it while hidden. */}
      <Animated.View
        pointerEvents={showBackToTop ? 'auto' : 'none'}
        style={[
          styles.backToTopWrap,
          {
            bottom: TAB_BAR_CONTENT_HEIGHT + Math.max(insets.bottom, 10) + space.sm,
            opacity: backToTop,
            transform: [
              {
                scale: backToTop.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.6, 1],
                }),
              },
            ],
          },
        ]}
      >
        <TouchableOpacity
          onPress={scrollToTop}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Back to top"
        >
          <View style={styles.backToTopButton}>
            <Ionicons name="arrow-up" size={20} color={colors.onAccent} />
          </View>
        </TouchableOpacity>
      </Animated.View>

      <RecipeDetailScreen
        recipe={open}
        saved={open ? savedKeys.has(savedKey(open)) : false}
        onToggleSave={() => open && toggleSave(open)}
        onStartCooking={() => {
          // Closing this sheet and opening cook mode's own Modal in the same
          // tick makes iOS animate a dismiss and a present at once — the
          // loser of that race shows as a blank white sheet for a frame.
          // Stashing the recipe and waiting for onDismiss (below) to actually
          // open cook mode keeps the two transitions sequential instead.
          // RN's Modal only calls onDismiss on iOS (Android's Modal has no
          // separate native dismiss animation to race against a second Modal
          // presenting, so there is nothing to sequence there) — Android opens
          // cook mode immediately rather than waiting for a callback that
          // never fires.
          if (Platform.OS === 'ios') {
            pendingCookRef.current = open;
            setOpen(null);
          } else {
            const recipe = open;
            setOpen(null);
            setCooking(recipe);
          }
        }}
        onDismiss={() => {
          if (pendingCookRef.current) {
            setCooking(pendingCookRef.current);
            pendingCookRef.current = null;
          }
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
  // The floating copy of the search bar — absolutely positioned over
  // everything else, invisible/untouchable until onListScroll flips
  // isFloating true (see the note above the JSX). No background of its
  // own, same as TabBar's outer `wrap`: the pill look comes entirely from
  // searchField's own card background and shadow (see floatingSearchField
  // below), so the list underneath stays visible right up to the pill's
  // rounded edge instead of sitting behind a solid strip.
  //
  // `top` is NOT set here — this screen has no SafeAreaView above it to
  // rely on (see FULL_BLEED in navigation/MainTabs), so `top: insets.top` is
  // applied inline at the call site instead, where the hook's value is
  // actually available; a static StyleSheet can't read it.
  floatingSearchWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    paddingTop: space.xs,
    paddingHorizontal: space.xl,
    zIndex: 1,
  },
  floatingSearchField: {
    shadowColor: colors.shadow,
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  // `bottom` is set inline (see the JSX) — it needs insets.bottom, which a
  // static StyleSheet can't read, same reasoning as floatingSearchWrap's own
  // `top` above.
  backToTopWrap: {
    position: 'absolute',
    right: space.xl,
    zIndex: 1,
  },
  backToTopButton: {
    width: 44,
    height: 44,
    borderRadius: 999,
    backgroundColor: colors.primaryDark,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.shadow,
    shadowOpacity: 0.22,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  centre: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xxl,
  },
  content: {
    // flexGrow so the scroll surface always fills the screen even when the
    // list is short (e.g. a single "Nothing here yet" card) — without it,
    // some platforms don't recognize a pull gesture over content shorter
    // than the viewport as a scroll at all, and RefreshControl never fires.
    flexGrow: 1,
    paddingHorizontal: space.xl,
    paddingTop: space.md,
    // The real paddingBottom is computed at render time (see the ScrollView
    // JSX) and overrides this — it needs insets.bottom, which isn't
    // available in a static StyleSheet. Kept here anyway as the fallback
    // any static read of this style object sees, roughly matching the
    // render-time value on a device with no home-indicator inset.
    paddingBottom: SCAN_BUTTON_LIFT + TAB_BAR_CONTENT_HEIGHT + 10 + space.lg,
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
  searchWrap: {},
  searchField: {
    height: 44,
    borderRadius: 16,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm2,
    paddingHorizontal: space.md2,
  },
  searchInput: {
    flex: 1,
    fontWeight: '600',
    fontSize: type.bodySmall.fontSize,
    color: colors.primaryDarker,
    padding: space.none,
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