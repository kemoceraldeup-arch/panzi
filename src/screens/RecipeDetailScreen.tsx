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

import React from 'react';
import { Modal, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaProvider, initialWindowMetrics, useSafeAreaInsets } from 'react-native-safe-area-context';
import Text from '../components/Text';
import DishTile from '../components/recipes/DishTile';
import { Recipe } from '../services/recipes';
import { fonts, type } from '../theme/typography';
import { makeStyles } from '../theme/makeStyles';
import { useColors } from '../theme/ThemeProvider';
import { space } from '../theme/spacing';

const HIT_SLOP = { top: 12, bottom: 12, left: 12, right: 12 };

type Props = {
  recipe: Recipe | null;
  saved: boolean;
  onToggleSave: () => void;
  onStartCooking: () => void;
  onClose: () => void;
};

export default function RecipeDetailScreen({
  recipe,
  saved,
  onToggleSave,
  onStartCooking,
  onClose,
}: Props) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <Modal
      visible={recipe !== null}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
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

  const have = recipe.ingredients.filter((i) => i.have);
  const need = recipe.ingredients.filter((i) => !i.have);

  return (
    <View style={styles.container}>
      <DishTile
        look={recipe.look}
        dishKey={recipe.dishKey}
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
          {/* `minutes` is 0 when the model returned something implausible and
              the route zeroed it. Showing "0 min" would be worse than showing
              nothing, so the line collapses to whatever is real. */}
          {recipe.minutes > 0 && <Text style={styles.minutes}>{recipe.minutes} min</Text>}
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
                  <Text style={styles.rowAmount}>{item.amount}</Text>
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
                  <Text style={styles.rowAmount}>{item.amount}</Text>
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
  minutes: {
    fontWeight: '600',
    fontSize: type.label.fontSize,
    color: colors.textSecondary,
    marginTop: space.xs,
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