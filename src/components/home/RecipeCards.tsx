// src/components/home/RecipeCards.tsx
//
// The recipe card — one design for every suggestion the Recipes screen
// shows, the AI's top pick and its alternates alike. A photo when the dish
// has one (see theme/dishPhotos.ts), the gradient-and-glyph tile otherwise;
// underneath, how well it matches what's actually on the shelf, since that
// match is the whole reason one suggestion beats another here.
//
// Only the top (first visible, post-filter) card gets Start cooking and
// Shuffle — those are actions for the dish being cooked tonight, not for
// something still being browsed. Pass onStartCooking to turn one on.

import React, { useEffect, useRef } from 'react';
import { Animated, View, StyleSheet, TouchableOpacity } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
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
const PROGRESS_DURATION_MS = 400;

export type FeaturedRecipe = {
  title: string;
  look: DishLook;
  dishKey: DishKey;
  minutes: number;
  /** Omitted for a browse-mode card with no pantry to match against — the
   *  on-hand line and progress bar are skipped entirely when absent, rather
   *  than showing a meaningless "0 of 0". */
  ingredientsHave?: number;
  ingredientsTotal?: number;
  usesExpiringCount: number;
  /** The pantry couldn't carry a dish on its own, so this one needs a real
   *  shop. Takes the pill slot, because it is the more useful thing to know. */
  needsShopping?: boolean;
  /** One line on why this was picked tonight, laid over the tile. */
  why?: string;
  /** What the dish IS — shown in place of the on-hand line when there's no
   *  pantry match to report (a browse-mode card). */
  description?: string;
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
  /** Present only on the card that is actually actionable right now — see
   *  the file header. Its absence is what turns this into a plain
   *  browse-and-open card: no button row, and the whole body becomes part
   *  of the tap target since there's nothing else on the card to press. */
  onStartCooking?: () => void;
  onShuffle?: () => void;
  onToggleSave: () => void;
  /** Tapping the tile reads the recipe; the button below starts cooking it.
   *  Two different intentions, and conflating them sends someone who wanted a
   *  look at the ingredients into a full-screen stepper. */
  onOpen: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const actionable = !!onStartCooking;
  const hasPantryMatch = recipe.ingredientsHave !== undefined && recipe.ingredientsTotal !== undefined;
  const inPantry =
    hasPantryMatch && recipe.ingredientsTotal! > 0 && recipe.ingredientsHave === recipe.ingredientsTotal;

  const progress = useRef(new Animated.Value(0)).current;
  const ratio =
    hasPantryMatch && recipe.ingredientsTotal! > 0
      ? recipe.ingredientsHave! / recipe.ingredientsTotal!
      : 0;
  useEffect(() => {
    Animated.timing(progress, {
      toValue: ratio,
      duration: PROGRESS_DURATION_MS,
      // Width can't run on the native driver.
      useNativeDriver: false,
    }).start();
  }, [ratio, progress]);
  const fillWidth = progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });

  return (
    <View style={styles.card}>
      <TouchableOpacity activeOpacity={0.9} onPress={onOpen}>
        <DishTile
          look={recipe.look}
          dishKey={recipe.dishKey}
          size="card"
          style={styles.photo}
        >
          <View style={styles.bandTop}>
            {/* Up to two pills, stacked — a dish can be both fully on hand
                and built from something about to go off, and that is the
                best kind of match this screen can offer, not a conflict to
                resolve down to one badge. */}
            <View style={styles.pillStack}>
              {inPantry && (
                <View style={styles.pantryPill}>
                  <Text style={styles.pantryPillText}>In your pantry</Text>
                </View>
              )}
              {recipe.needsShopping ? (
                <View style={[styles.expiringPill, styles.shoppingPill]}>
                  <Text style={styles.expiringPillText}>WORTH A QUICK TRIP</Text>
                </View>
              ) : (
                recipe.usesExpiringCount > 0 && (
                  <View style={styles.expiringPill}>
                    <Text style={styles.expiringPillText}>
                      USES {recipe.usesExpiringCount} EXPIRING
                    </Text>
                  </View>
                )
              )}
            </View>
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

      <TouchableOpacity
        activeOpacity={actionable ? 1 : 0.7}
        onPress={actionable ? undefined : onOpen}
        disabled={actionable}
        style={styles.body}
      >
        <View style={styles.titleRow}>
          <Text style={styles.title} numberOfLines={2}>
            {recipe.title}
          </Text>
          {recipe.minutes > 0 && <Text style={styles.minutes}>{recipe.minutes} MIN</Text>}
        </View>
        {hasPantryMatch ? (
          <>
            <Text style={styles.onHand}>
              {recipe.ingredientsHave} of {recipe.ingredientsTotal} on hand
            </Text>
            <View style={styles.progressTrack}>
              <Animated.View style={[styles.progressFill, { width: fillWidth }]}>
                <LinearGradient
                  colors={[colors.primaryBright, colors.primaryMid]}
                  start={{ x: 0, y: 0.5 }}
                  end={{ x: 1, y: 0.5 }}
                  style={StyleSheet.absoluteFill}
                />
              </Animated.View>
            </View>
          </>
        ) : (
          !!recipe.description && (
            <Text style={styles.onHand} numberOfLines={2}>
              {recipe.description}
            </Text>
          )
        )}

        {actionable && (
          <View style={styles.buttonRow}>
            <TouchableOpacity style={styles.startButton} onPress={onStartCooking}>
              <Text style={styles.startButtonText}>Start cooking</Text>
            </TouchableOpacity>
            {onShuffle && (
              <TouchableOpacity
                style={styles.shuffleButton}
                onPress={onShuffle}
                accessibilityLabel="Suggest something else"
              >
                <Text style={styles.shuffleIcon}>⟲</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </TouchableOpacity>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  card: {
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: colors.card,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.09,
    shadowRadius: 12,
    elevation: 2,
  },
  photo: {
    padding: space.md2,
    justifyContent: 'space-between',
  },
  bandTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  pillStack: {
    gap: space.xs,
  },
  pantryPill: {
    alignSelf: 'flex-start',
    backgroundColor: colors.overlayStrong,
    borderRadius: 999,
    paddingVertical: space.xs2,
    paddingHorizontal: space.md,
  },
  pantryPillText: {
    color: colors.textPrimary,
    fontWeight: '700',
    fontSize: type.micro.fontSize,
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
    width: 38,
    height: 38,
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
  body: {
    padding: space.lg2,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: space.sm2,
    marginBottom: space.sm,
  },
  title: {
    flex: 1,
    color: colors.primaryDarker,
    fontWeight: '800',
    fontSize: type.title.fontSize,
  },
  minutes: {
    color: colors.textMuted,
    fontWeight: '800',
    fontSize: type.label.fontSize,
    letterSpacing: 0.4,
  },
  onHand: {
    color: colors.textSecondary,
    fontWeight: '500',
    fontSize: type.bodySmall.fontSize,
    marginBottom: space.sm2,
  },
  progressTrack: {
    height: 6,
    borderRadius: 999,
    backgroundColor: colors.backgroundAlt,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
    overflow: 'hidden',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: space.sm2,
    marginTop: space.lg,
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
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shuffleIcon: {
    color: colors.primaryDarker,
    fontSize: type.subtitle.fontSize,
    fontWeight: '700',
  },
}));