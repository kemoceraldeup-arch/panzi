// src/screens/RecipeDetailScreen.tsx
//
// One suggestion, opened.
//
// The ingredients are split into what the user has and what they don't, which
// is the honest half of the screen and the reason it exists. A recipe app that
// lists twelve ingredients as one undifferentiated column makes the reader do
// the cross-referencing against their own kitchen; this app already knows the
// answer, so it should say it.
//
// Presented as a Modal from RecipesScreen rather than a route, the same way
// ScanModal is — the tab bar has no place in a recipe, and this keeps the
// navigation shape unchanged.

import React, { useEffect, useState } from 'react';
import { Modal, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaProvider, initialWindowMetrics, useSafeAreaInsets } from 'react-native-safe-area-context';
import Text from '../components/Text';
import DishTile from '../components/recipes/DishTile';
import { Eyebrow, MacroPill } from './scan/atoms';
import { Recipe, scaleAmount } from '../services/recipes';
import { lookupRecipeNutrition, RecipeNutritionEstimate } from '../services/nutrition';
import { fonts, type } from '../theme/typography';
import { makeStyles } from '../theme/makeStyles';
import { useColors } from '../theme/ThemeProvider';
import { space } from '../theme/spacing';

const HIT_SLOP = { top: 12, bottom: 12, left: 12, right: 12 };

// Mirrors the server's own MIN_SERVINGS/MAX_SERVINGS (server/src/routes/
// recipes.ts) — the stepper simply can't be pushed past what the model was
// ever asked to produce a believable figure within.
const MIN_SERVINGS = 1;
const MAX_SERVINGS = 12;

// Below this, the estimate is missing too much of the recipe's actual mass
// to be worth showing as a number — a dish whose main ingredient (by weight)
// never matched can still have most of its *rows* matched, so gating on
// coverage (grams) rather than matchedCount/totalCount (rows) is what
// catches that case. Matches this app's photo-matching stance elsewhere
// (src/theme/dishPhotos.ts): a confidently-wrong number is worse than none,
// so below the line this shows nothing rather than a number that looks
// precise and isn't.
const MIN_NUTRITION_COVERAGE = 0.6;

type Props = {
  recipe: Recipe | null;
  saved: boolean;
  onToggleSave: () => void;
  onStartCooking: () => void;
  onClose: () => void;
  /** Fires once this sheet's own dismiss animation has actually finished —
   *  iOS-only (RN no-ops it elsewhere), but this is an iOS-only problem: a
   *  pageSheet's slide-down and another Modal's slide-up presenting in the
   *  same commit race on the native side, and the loser shows as a blank
   *  white sheet for a frame. Callers that need to open another Modal right
   *  after this one closes (RecipesScreen's "Start cooking") wait for this
   *  rather than firing in the same handler that calls onClose. */
  onDismiss?: () => void;
};

export default function RecipeDetailScreen({
  recipe,
  saved,
  onToggleSave,
  onStartCooking,
  onClose,
  onDismiss,
}: Props) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <Modal
      visible={recipe !== null}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
      onDismiss={onDismiss}
    >
      {/* Unconditional, painted before Body (and its own same-colour
          container) ever mounts: a pageSheet's native surface is its own
          UIViewController, presented — and given at least one native paint —
          before RN's first frame lands inside it. With nothing here but
          {recipe && <Body/>}, that first native paint had nothing but the
          system's default white to show. Same fix as CookModeScreen's own
          Modal, which already wraps {hasSteps && <Body/>} in a colour-filled
          View for exactly this reason. */}
      <View style={{ flex: 1, backgroundColor: colors.backgroundLight }}>
        <SafeAreaProvider initialMetrics={initialWindowMetrics}>
          {recipe && (
            <Body
              recipe={recipe}
              saved={saved}
              onToggleSave={onToggleSave}
              onStartCooking={onStartCooking}
              onClose={onClose}
            />
          )}
        </SafeAreaProvider>
      </View>
    </Modal>
  );
}

function Body({
  recipe,
  saved,
  onToggleSave,
  onStartCooking,
  onClose,
}: {
  recipe: Recipe;
  saved: boolean;
  onToggleSave: () => void;
  onStartCooking: () => void;
  onClose: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();

  // Serving count as chosen on this screen, independent of the recipe's own
  // authored value — Cook Mode is a separate navigation away and keeps
  // showing the original amounts, so this state doesn't need to travel
  // anywhere. Seeded once per recipe: Body remounts whenever the modal opens
  // on a different recipe (see the parent component below), so reopening
  // always starts back at the authored serving count.
  const [servings, setServings] = useState(recipe.servings > 0 ? recipe.servings : 0);
  const ratio = recipe.servings > 0 && servings > 0 ? servings / recipe.servings : 1;

  const have = recipe.ingredients.filter((i) => i.have);
  const need = recipe.ingredients.filter((i) => !i.have);

  // Looked up on demand, from the recipe's own ingredient list — the model
  // that wrote the recipe doesn't reliably know real macros, and searching
  // FatSecret for the dish's title ("Chicken adobo") matches whatever
  // unrelated packaged product ranks first, with that product's own serving
  // size rather than anything to do with this recipe. Summing each real
  // ingredient at its real amount (services/nutrition.ts) is slower but
  // actually describes this dish.
  // undefined: not looked up yet (or this recipe). null: looked up, no match.
  const [nutrition, setNutrition] = useState<RecipeNutritionEstimate | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    setNutrition(undefined);
    lookupRecipeNutrition(
      recipe.ingredients.map((i) => ({ name: i.name, amount: i.amount })),
      recipe.servings > 0 ? recipe.servings : 1
    )
      .then((result) => {
        if (!cancelled) setNutrition(result ?? null);
      })
      .catch(() => {
        // Same as the scan review card: a failed lookup (offline, rate
        // limited) leaves this at undefined rather than asserting "no
        // match" — the section just doesn't render rather than lying.
      });
    return () => {
      cancelled = true;
    };
  }, [recipe.ingredients, recipe.servings]);

  return (
    <View style={styles.container}>
      <DishTile
        look={recipe.look}
        dishKey={recipe.dishKey}
        title={recipe.title}
        size="hero"
        style={[styles.hero, { paddingTop: insets.top + 8 }]}
      >
        <View style={styles.heroTop}>
          <TouchableOpacity
            style={styles.roundButton}
            onPress={onClose}
            hitSlop={HIT_SLOP}
            accessibilityLabel="Close"
          >
            <Ionicons name="close" size={20} color={colors.onAccent} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.roundButton}
            onPress={onToggleSave}
            hitSlop={HIT_SLOP}
            accessibilityRole="button"
            accessibilityLabel={saved ? 'Remove from saved' : 'Save this recipe'}
          >
            <Ionicons name={saved ? 'heart' : 'heart-outline'} size={20} color={colors.onAccent} />
          </TouchableOpacity>
        </View>
      </DishTile>

      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title}>{recipe.title}</Text>
          {/* What the dish IS, not why it's suggested tonight — that's
              `why`, shown further down in its own card. '' on anything
              cached before this field existed, so it collapses cleanly. */}
          {!!recipe.description && (
            <Text style={styles.description}>{recipe.description}</Text>
          )}
          {/* `minutes` is 0 when the model returned something implausible and
              the route zeroed it. Showing "0 min" would be worse than showing
              nothing, so the line collapses to whatever is real. Servings is
              the same idea — the stepper only appears when there is a real
              base figure to scale from. */}
          {(recipe.minutes > 0 || recipe.servings > 0) && (
            <View style={styles.factsRow}>
              {recipe.minutes > 0 && <Text style={styles.minutes}>{recipe.minutes} min</Text>}
              {recipe.servings > 0 && (
                <ServingsStepper value={servings} onChange={setServings} />
              )}
            </View>
          )}
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: space.xxl2 + insets.bottom }]}
        showsVerticalScrollIndicator={false}
      >
        {!!recipe.why && (
          <View style={styles.whyCard}>
            <Ionicons name="leaf-outline" size={16} color={colors.primaryDark} />
            <Text style={styles.whyText}>{recipe.why}</Text>
          </View>
        )}

        {/* Nothing renders while the lookup is still in flight (undefined),
            came back with no match (null), or matched too little of the
            recipe's actual mass to trust — see MIN_NUTRITION_COVERAGE.
            An estimate per serving, not per the whole dish, so it's offered
            rather than asserted; see the note on FatSecret's own
            serving_description on the pantry item version of this same
            card. */}
        {nutrition && nutrition.coverage >= MIN_NUTRITION_COVERAGE && (
          <View style={styles.nutritionSection}>
            <Eyebrow>Nutrition</Eyebrow>
            <Text style={styles.nutritionMatchedName} numberOfLines={1}>
              Estimated per serving
              {nutrition.matchedCount < nutrition.totalCount
                ? ` · based on ${nutrition.matchedCount} of ${nutrition.totalCount} ingredients`
                : ''}
              {nutrition.coverage < 0.9 ? ' · may run low' : ''}
            </Text>
            <View style={styles.macroRow}>
              <MacroPill label="Calories" value={Math.round(nutrition.perServing.calories * ratio)} />
              <MacroPill label="Protein" value={Math.round(nutrition.perServing.proteinG * ratio)} unit="g" />
              <MacroPill label="Carbs" value={Math.round(nutrition.perServing.carbsG * ratio)} unit="g" />
              <MacroPill label="Fat" value={Math.round(nutrition.perServing.fatG * ratio)} unit="g" />
            </View>
          </View>
        )}

        {have.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>You have</Text>
            <View style={styles.list}>
              {have.map((item, i) => (
                <View key={`${item.name}-${i}`} style={[styles.row, i > 0 && styles.rowDivided]}>
                  <Ionicons name="checkmark-circle" size={17} color={colors.primary} />
                  <Text style={styles.rowName} numberOfLines={2}>
                    {item.name}
                  </Text>
                  <Text style={styles.rowAmount}>{scaleAmount(item.amount, ratio)}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {need.length > 0 && (
          <>
            {/* The part worth knowing before starting. Deliberately not hidden
                behind a tap — finding out mid-recipe that three things are
                missing is the failure this screen exists to prevent. */}
            <Text style={[styles.sectionLabel, styles.sectionLabelNeed]}>
              You&apos;ll need {need.length === 1 ? 'this' : 'these'}
            </Text>
            <View style={[styles.list, styles.listNeed]}>
              {need.map((item, i) => (
                <View key={`${item.name}-${i}`} style={[styles.row, i > 0 && styles.rowDivided]}>
                  <Ionicons name="ellipse-outline" size={17} color={colors.accentDeep} />
                  <Text style={styles.rowName} numberOfLines={2}>
                    {item.name}
                  </Text>
                  <Text style={styles.rowAmount}>{scaleAmount(item.amount, ratio)}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        <Text style={styles.sectionLabel}>Method</Text>
        <View style={styles.steps}>
          {recipe.steps.map((step, i) => (
            <View key={`${i}-${step.slice(0, 12)}`} style={styles.stepRow}>
              <View style={styles.stepNumber}>
                <Text style={styles.stepNumberText}>{i + 1}</Text>
              </View>
              <Text style={styles.stepText}>{step}</Text>
            </View>
          ))}
        </View>

        <TouchableOpacity style={styles.cookButton} onPress={onStartCooking} activeOpacity={0.85}>
          <Text style={styles.cookButtonText}>Start cooking</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

/** −/+ around the serving count, reusing the hero's own round-button look at
 *  a smaller size rather than inventing a new control style. */
function ServingsStepper({
  value,
  onChange,
}: {
  value: number;
  onChange: (next: number) => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={styles.servingsRow}>
      <TouchableOpacity
        style={[styles.stepButton, value <= MIN_SERVINGS && styles.stepButtonDisabled]}
        onPress={() => onChange(Math.max(MIN_SERVINGS, value - 1))}
        disabled={value <= MIN_SERVINGS}
        hitSlop={HIT_SLOP}
        accessibilityRole="button"
        accessibilityLabel="Fewer servings"
      >
        <Ionicons name="remove" size={15} color={colors.primaryDark} />
      </TouchableOpacity>
      <Text style={styles.servingsValue}>
        {value} {value === 1 ? 'serving' : 'servings'}
      </Text>
      <TouchableOpacity
        style={[styles.stepButton, value >= MAX_SERVINGS && styles.stepButtonDisabled]}
        onPress={() => onChange(Math.min(MAX_SERVINGS, value + 1))}
        disabled={value >= MAX_SERVINGS}
        hitSlop={HIT_SLOP}
        accessibilityRole="button"
        accessibilityLabel="More servings"
      >
        <Ionicons name="add" size={15} color={colors.primaryDark} />
      </TouchableOpacity>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: {
    flex: 1,
    backgroundColor: colors.backgroundLight,
  },
  hero: {
    paddingHorizontal: space.lg,
    paddingBottom: space.lg,
  },
  heroTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  roundButton: {
    width: 38,
    height: 38,
    borderRadius: 13,
    backgroundColor: 'rgba(23,23,15,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    paddingHorizontal: space.xl,
    paddingTop: space.lg,
    paddingBottom: space.md2,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontFamily: fonts.display,
    fontWeight: '800',
    fontSize: type.headline.fontSize,
    lineHeight: 29,
    color: colors.primaryDarker,
  },
  description: {
    fontWeight: '600',
    fontSize: type.body.fontSize,
    lineHeight: 20,
    color: colors.textSecondary,
    marginTop: space.xs,
  },
  minutes: {
    fontWeight: '600',
    fontSize: type.label.fontSize,
    color: colors.textSecondary,
  },
  factsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginTop: space.xs,
  },
  servingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm2,
  },
  stepButton: {
    width: 26,
    height: 26,
    borderRadius: 999,
    backgroundColor: colors.primaryLighter,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepButtonDisabled: {
    opacity: 0.4,
  },
  servingsValue: {
    fontWeight: '600',
    fontSize: type.label.fontSize,
    color: colors.textSecondary,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: space.xl,
  },
  whyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm2,
    backgroundColor: colors.primaryLighter,
    borderRadius: 18,
    paddingVertical: space.md2,
    paddingHorizontal: space.md2,
    marginBottom: space.xl2,
  },
  whyText: {
    flex: 1,
    fontWeight: '700',
    fontSize: type.label.fontSize,
    lineHeight: 18,
    color: colors.primaryDark,
  },
  nutritionSection: {
    marginBottom: space.xl2,
  },
  nutritionMatchedName: {
    fontSize: type.caption.fontSize,
    color: colors.textSecondary,
    marginTop: -2,
    marginBottom: space.sm,
  },
  macroRow: {
    flexDirection: 'row',
    gap: space.sm2,
  },
  sectionLabel: {
    fontWeight: '800',
    fontSize: type.micro.fontSize,
    letterSpacing: 1.54,
    textTransform: 'uppercase',
    color: colors.tabInactive,
    marginBottom: space.sm2,
  },
  sectionLabelNeed: {
    color: colors.accentDeep,
    marginTop: space.xl,
  },
  list: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
    borderRadius: 20,
    overflow: 'hidden',
    marginBottom: space.xs,
  },
  listNeed: {
    borderColor: colors.warmBorder,
    backgroundColor: colors.warmCard,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md2,
    paddingHorizontal: space.md2,
  },
  rowDivided: {
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  rowName: {
    flex: 1,
    minWidth: 0,
    fontWeight: '700',
    fontSize: type.bodySmall.fontSize,
    lineHeight: 19,
    color: colors.primaryDarker,
  },
  rowAmount: {
    fontWeight: '600',
    fontSize: type.label.fontSize,
    color: colors.textSecondary,
    flexShrink: 0,
  },
  steps: {
    gap: space.md,
    marginBottom: space.xxl2,
  },
  stepRow: {
    flexDirection: 'row',
    gap: space.md,
  },
  stepNumber: {
    width: 26,
    height: 26,
    borderRadius: 999,
    backgroundColor: colors.primaryLighter,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: space.half,
  },
  stepNumberText: {
    fontWeight: '800',
    fontSize: type.caption.fontSize,
    color: colors.primaryDark,
  },
  stepText: {
    flex: 1,
    fontWeight: '600',
    fontSize: type.bodySmall.fontSize,
    lineHeight: 21,
    color: colors.primaryDarker,
  },
  cookButton: {
    height: 54,
    borderRadius: 17,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cookButtonText: {
    fontWeight: '800',
    fontSize: type.bodyLarge.fontSize,
    color: colors.onAccent,
  },
}));