// src/components/home/RecipeCards.tsx
//
// The recipe cards. Fed live by the recipe route from real pantry contents,
// expiry dates and the dietary profile.
//
// There is no photo — see theme/dishLooks.ts for why. The band is a gradient
// and a glyph chosen from the kind of dish it is, with the reason it was picked
// written across it. Words the user will act on, rather than a picture of food
// they haven't decided to cook.

import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Text from '../Text';
import DishTile from '../recipes/DishTile';
import { DishLook } from '../../theme/dishLooks';
import { DishKey } from '../../theme/dishPhotos';
import { makeStyles } from '../../theme/makeStyles';
import { useColors } from '../../theme/ThemeProvider';
import { space } from '../../theme/spacing';
import { type } from '../../theme/typography';

const HIT_SLOP = { top: 10, bottom: 10, left: 10, right: 10 };

export type FeaturedRecipe = {
  title: string;
  look: DishLook;
  dishKey: DishKey;
  minutes: number;
  ingredientsHave: number;
  ingredientsTotal: number;
  usesExpiringCount: number;
  /** The pantry couldn't carry a dish on its own, so this one needs a real
   *  shop. Takes the pill slot, because it is the more useful thing to know. */
  needsShopping?: boolean;
  /** One line on why this was picked tonight, laid over the tile. */
  why?: string;
};

export type MiniRecipe = {
  title: string;
  look: DishLook;
  dishKey: DishKey;
  minutes: number;
};

export function FeaturedRecipeCard({
  recipe,
  saved,
  onStartCooking,
  onShuffle,
  onToggleSave,
  onOpen,
}: {
  recipe: FeaturedRecipe;
  saved: boolean;
  onStartCooking: () => void;
  onShuffle: () => void;
  onToggleSave: () => void;
  /** Tapping the tile reads the recipe; the button below starts cooking it.
   *  Two different intentions, and conflating them sends someone who wanted a
   *  look at the ingredients into a full-screen stepper. */
  onOpen: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={styles.featuredCard}>
      <TouchableOpacity activeOpacity={0.9} onPress={onOpen}>
        <DishTile
          look={recipe.look}
          dishKey={recipe.dishKey}
          size="card"
          style={styles.featuredPhoto}
        >
          <View style={styles.bandTop}>
            {/* Hidden at zero. "USES 0 EXPIRING" is a badge announcing that the
                card has nothing to boast about. */}
            {recipe.needsShopping ? (
              <View style={[styles.expiringPill, styles.shoppingPill]}>
                <Text style={styles.expiringPillText}>WORTH A QUICK TRIP</Text>
              </View>
            ) : recipe.usesExpiringCount > 0 ? (
              <View style={styles.expiringPill}>
                <Text style={styles.expiringPillText}>
                  USES {recipe.usesExpiringCount} EXPIRING
                </Text>
              </View>
            ) : (
              <View />
            )}
            <TouchableOpacity
              onPress={onToggleSave}
              hitSlop={HIT_SLOP}
              accessibilityRole="button"
              accessibilityLabel={saved ? 'Remove from saved' : 'Save this recipe'}
              style={styles.heart}
            >
              <Ionicons
                name={saved ? 'heart' : 'heart-outline'}
                size={19}
                color={colors.onAccent}
              />
            </TouchableOpacity>
          </View>
          {!!recipe.why && (
            <Text style={styles.whyLine} numberOfLines={2}>
              {recipe.why}
            </Text>
          )}
        </DishTile>
      </TouchableOpacity>

      <View style={styles.featuredBody}>
        <Text style={styles.featuredTitle}>{recipe.title}</Text>
        <Text style={styles.featuredSubtitle}>
          {recipe.minutes > 0 ? `${recipe.minutes} min · ` : ''}
          {recipe.ingredientsHave} of {recipe.ingredientsTotal} ingredients on hand
        </Text>
        <View style={styles.featuredButtonRow}>
          <TouchableOpacity style={styles.startButton} onPress={onStartCooking}>
            <Text style={styles.startButtonText}>Start cooking</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.shuffleButton}
            onPress={onShuffle}
            accessibilityLabel="Suggest something else"
          >
            <Text style={styles.shuffleIcon}>⟲</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

export function MiniRecipeCard({ recipe, onPress }: { recipe: MiniRecipe; onPress: () => void }) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <TouchableOpacity style={styles.miniCard} onPress={onPress} activeOpacity={0.85}>
      <DishTile look={recipe.look} dishKey={recipe.dishKey} size="mini" />
      <View style={styles.miniBody}>
        <Text style={styles.miniTitle} numberOfLines={2}>
          {recipe.title}
        </Text>
        {recipe.minutes > 0 && <Text style={styles.miniMinutes}>{recipe.minutes} min</Text>}
      </View>
    </TouchableOpacity>
  );
}

const useStyles = makeStyles((colors) => ({
  featuredCard: {
    borderRadius: 26,
    overflow: 'hidden',
    backgroundColor: colors.inkFill,
  },
  featuredPhoto: {
    padding: space.md2,
    justifyContent: 'space-between',
  },
  bandTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  expiringPill: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(23,23,15,0.35)',
    borderRadius: 999,
    paddingVertical: space.xs2,
    paddingHorizontal: space.md,
  },
  shoppingPill: {
    // Warmer than the expiring pill, and never shown at the same time — the two
    // say opposite things about where tonight's dinner is coming from.
    backgroundColor: 'rgba(194,87,31,0.75)',
  },
  heart: {
    width: 32,
    height: 32,
    borderRadius: 999,
    backgroundColor: 'rgba(23,23,15,0.28)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  expiringPillText: {
    color: colors.onAccent,
    fontWeight: '800',
    fontSize: type.micro.fontSize,
    letterSpacing: 0.5,
  },
  whyLine: {
    // Pushed to the bottom of the band whether or not the pill above it is
    // rendered, so the layout doesn't shift between a card that uses expiring
    // food and one that doesn't.
    marginTop: 'auto',
    color: colors.onAccent,
    fontWeight: '700',
    fontSize: type.bodySmall.fontSize,
    lineHeight: 19,
    // A shadow rather than a scrim panel: the gradients run light in places and
    // white text on the amber one is otherwise hard to read.
    textShadowColor: 'rgba(23,23,15,0.45)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  featuredBody: {
    padding: space.lg2,
  },
  featuredTitle: {
    color: colors.onAccent,
    fontWeight: '800',
    fontSize: type.title.fontSize,
    marginBottom: space.xs,
  },
  featuredSubtitle: {
    color: colors.primaryLight,
    fontWeight: '600',
    fontSize: type.label.fontSize,
    marginBottom: space.lg,
  },
  featuredButtonRow: {
    flexDirection: 'row',
    gap: space.sm2,
  },
  startButton: {
    flex: 1,
    height: 48,
    borderRadius: 16,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  startButtonText: {
    color: colors.onAccent,
    fontWeight: '800',
    fontSize: type.body.fontSize,
  },
  shuffleButton: {
    width: 48,
    height: 48,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shuffleIcon: {
    color: colors.onAccent,
    fontSize: type.subtitle.fontSize,
    fontWeight: '700',
  },
  miniCard: {
    flex: 1,
    borderRadius: 20,
    backgroundColor: colors.card,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
  },
  miniBody: {
    padding: space.md,
  },
  miniTitle: {
    fontWeight: '700',
    fontSize: type.bodySmall.fontSize,
    color: colors.primaryDarker,
    marginBottom: space.xs,
  },
  miniMinutes: {
    fontWeight: '600',
    fontSize: type.caption.fontSize,
    color: colors.textSecondary,
  },
}));