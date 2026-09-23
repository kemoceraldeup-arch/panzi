// src/components/chat/ChatRecipeCard.tsx
//
// A recipe, answered inline in the chat instead of as a sentence.
//
// Distinct from FeaturedRecipeCard (home/RecipeCards.tsx): that one is a
// browsing card sized for a feed, this one is a direct reply to "what can I
// make with X" and shows its work — every ingredient the dish needs, ticked
// against what's actually in the pantry, so a card built around something the
// user doesn't own is still honest about the gap rather than pretending
// otherwise. Tapping it opens the same RecipeDetailScreen every other
// suggestion does; this card is the chat bubble's compressed preview of that.

import React from 'react';
import { TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Text from '../Text';
import DishTile from '../recipes/DishTile';
import { Recipe } from '../../services/recipes';
import { makeStyles } from '../../theme/makeStyles';
import { useColors } from '../../theme/ThemeProvider';
import { space } from '../../theme/spacing';
import { type } from '../../theme/typography';

// Ingredient rows past this many collapse behind the missing-count pill rather
// than pushing a chat bubble taller than the screen it's on.
const MAX_INGREDIENT_ROWS = 4;

export type ChatAlternate = { title: string };

type Props = {
  recipe: Recipe;
  onOpen: () => void;
  onStartCooking: () => void;
};

export default function ChatRecipeCard({ recipe, onOpen, onStartCooking }: Props) {
  const styles = useStyles();
  const colors = useColors();

  // "Missing" means genuinely needed and not on hand — an optional extra
  // that happens to be absent isn't a gap in the recipe, so it's excluded
  // from both the collapsed count and the missing/have binary below.
  const missing = recipe.ingredients.filter((i) => !i.have && !i.optional);
  const shown = recipe.ingredients.slice(0, MAX_INGREDIENT_ROWS);

  return (
    <View style={styles.card}>
      <TouchableOpacity activeOpacity={0.9} onPress={onOpen} style={styles.header}>
        <DishTile look={recipe.look} dishKey={recipe.dishKey} title={recipe.title} size="mini" style={styles.thumb} />
        <View style={styles.headerText}>
          <Text style={styles.eyebrow}>
            {recipe.needsShopping ? 'WORTH A QUICK TRIP' : 'BEST MATCH'}
          </Text>
          <Text style={styles.title} numberOfLines={2}>
            {recipe.title}
          </Text>
          <Text style={styles.subtitle}>
            {recipe.minutes > 0 ? `${recipe.minutes} min` : 'Quick'} · one pan · serves 3
          </Text>
        </View>
      </TouchableOpacity>

      {shown.length > 0 && (
        <View style={styles.ingredientList}>
          {shown.map((ingredient, i) => {
            // Three states: have (checked), optional-but-absent (muted, not
            // an alarm), and genuinely missing (flagged) — see the note on
            // `missing` above for why optional is carved out of the binary.
            const isOptionalGap = !ingredient.have && ingredient.optional === true;
            return (
              <View
                key={`${ingredient.name}-${i}`}
                style={[styles.ingredientRow, i > 0 && styles.ingredientDivider]}
              >
                <View
                  style={[
                    styles.checkbox,
                    ingredient.have ? styles.checkboxHave : styles.checkboxMissing,
                  ]}
                >
                  {ingredient.have ? (
                    <Ionicons name="checkmark" size={12} color={colors.onAccent} />
                  ) : (
                    <Ionicons name="add" size={12} color={colors.textMuted} />
                  )}
                </View>
                <Text style={styles.ingredientName} numberOfLines={1}>
                  {ingredient.name}
                </Text>
                <Text
                  style={
                    ingredient.have
                      ? styles.ingredientAmount
                      : isOptionalGap
                        ? styles.ingredientOptional
                        : styles.ingredientMissing
                  }
                >
                  {ingredient.have ? ingredient.amount : isOptionalGap ? 'optional' : 'missing'}
                </Text>
              </View>
            );
          })}
        </View>
      )}

      <View style={styles.actions}>
        <TouchableOpacity style={styles.startButton} onPress={onStartCooking} activeOpacity={0.85}>
          <Text style={styles.startButtonText}>Start cooking</Text>
        </TouchableOpacity>
        {missing.length > 0 && (
          <View style={styles.missingPill}>
            <Text style={styles.missingPillText}>+ {missing.length} missing</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  card: {
    width: '100%',
    borderRadius: 20,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md2,
  },
  thumb: {
    width: 56,
    minHeight: 56,
    height: 56,
    borderRadius: 14,
  },
  headerText: {
    flex: 1,
  },
  eyebrow: {
    fontWeight: '800',
    fontSize: type.micro.fontSize,
    letterSpacing: 1,
    color: colors.primaryDark,
    marginBottom: 2,
  },
  title: {
    fontWeight: '800',
    fontSize: type.subtitle.fontSize,
    lineHeight: 22,
    color: colors.primaryDarker,
  },
  subtitle: {
    fontWeight: '600',
    fontSize: type.caption.fontSize,
    color: colors.textSecondary,
    marginTop: 2,
  },
  ingredientList: {
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    paddingHorizontal: space.md2,
  },
  ingredientRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm2,
    paddingVertical: space.sm2,
  },
  ingredientDivider: {
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxHave: {
    backgroundColor: colors.primary,
  },
  checkboxMissing: {
    backgroundColor: colors.backgroundAlt,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  ingredientName: {
    flex: 1,
    fontWeight: '700',
    fontSize: type.label.fontSize,
    color: colors.textPrimary,
  },
  ingredientAmount: {
    fontWeight: '600',
    fontSize: type.caption.fontSize,
    color: colors.textSecondary,
  },
  ingredientMissing: {
    fontWeight: '700',
    fontSize: type.caption.fontSize,
    color: colors.rustMuted,
  },
  ingredientOptional: {
    fontWeight: '600',
    fontSize: type.caption.fontSize,
    color: colors.textMuted,
    fontStyle: 'italic',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm2,
    padding: space.md2,
  },
  startButton: {
    flex: 1,
    height: 46,
    borderRadius: 14,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  startButtonText: {
    fontWeight: '800',
    fontSize: type.body.fontSize,
    color: colors.onAccent,
  },
  missingPill: {
    height: 46,
    borderRadius: 14,
    paddingHorizontal: space.md2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryLighter,
  },
  missingPillText: {
    fontWeight: '800',
    fontSize: type.caption.fontSize,
    color: colors.primaryDark,
  },
}));
