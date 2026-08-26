// src/screens/SavedRecipesScreen.tsx
//
// The dishes the user kept.
//
// Tonight's suggestions are disposable by design — rebuilt whenever the pantry
// moves. This list is the one place in the tab where something stays put, so it
// is the answer to "that adobo from last week, where did it go".
//
// Notably it does not re-check the pantry. A saved recipe shows the ingredients
// as they were when it was saved, with the have/need split from that evening,
// because re-deriving it would quietly rewrite what the user chose to keep.
// Opening one and cooking it works from tonight's shelves as normal.

import React from 'react';
import { Modal, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  SafeAreaProvider,
  initialWindowMetrics,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import Text from '../components/Text';
import DishTile from '../components/recipes/DishTile';
import { Recipe } from '../services/recipes';
import { SavedRecipe } from '../services/savedRecipes';
import { clashesWithDiet } from '../utils/diet';
import { fonts, type } from '../theme/typography';
import { makeStyles } from '../theme/makeStyles';
import { useColors } from '../theme/ThemeProvider';
import { space } from '../theme/spacing';

const HIT_SLOP = { top: 12, bottom: 12, left: 12, right: 12 };

type Props = {
  visible: boolean;
  saved: SavedRecipe[];
  /** The diet as it stands now, which may have been set long after a dish was
   *  kept. Used to mark clashes, never to remove them. */
  diets: string[];
  onOpen: (recipe: Recipe) => void;
  onClose: () => void;
};

export default function SavedRecipesScreen({ visible, saved, diets, onOpen, onClose }: Props) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <Body saved={saved} diets={diets} onOpen={onOpen} onClose={onClose} />
      </SafeAreaProvider>
    </Modal>
  );
}

function Body({ saved, diets, onOpen, onClose }: Omit<Props, 'visible'>) {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Text style={styles.title}>Saved</Text>
        <TouchableOpacity
          style={styles.closeButton}
          onPress={onClose}
          hitSlop={HIT_SLOP}
          accessibilityLabel="Close"
        >
          <Ionicons name="close" size={20} color={colors.primaryDarker} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: space.xxl2 + insets.bottom }]}
        showsVerticalScrollIndicator={false}
      >
        {saved.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>Nothing saved yet</Text>
            <Text style={styles.emptyBody}>
              Tap the heart on a suggestion and it will wait here for you.
            </Text>
          </View>
        ) : (
          saved.map((entry) => {
            // Marked, never hidden and never deleted. The user chose to keep
            // this dish; a setting changed later does not entitle the app to
            // quietly take it off their list.
            const clash = clashesWithDiet(entry.recipe, diets);
            return (
              <TouchableOpacity
                key={entry.id}
                style={styles.row}
                onPress={() => onOpen(entry.recipe)}
                activeOpacity={0.85}
              >
                <DishTile
                  look={entry.recipe.look}
                  dishKey={entry.recipe.dishKey}
                  size="mini"
                  radius={16}
                  style={styles.rowTile}
                />
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle} numberOfLines={2}>
                    {entry.recipe.title}
                  </Text>
                  {clash ? (
                    <View style={styles.clashRow}>
                      <Ionicons name="alert-circle" size={13} color={colors.rust} />
                      <Text style={styles.clashText} numberOfLines={1}>
                        Doesn&apos;t fit your diet now
                      </Text>
                    </View>
                  ) : (
                    <Text style={styles.rowMeta} numberOfLines={1}>
                      {entry.recipe.minutes > 0 ? `${entry.recipe.minutes} min · ` : ''}
                      {entry.recipe.ingredients.length} ingredients
                    </Text>
                  )}
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.chevron} />
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: {
    flex: 1,
    backgroundColor: colors.backgroundLight,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.xl,
    paddingBottom: space.md2,
  },
  title: {
    fontFamily: fonts.display,
    fontWeight: '800',
    fontSize: type.headline.fontSize,
    color: colors.primaryDarker,
  },
  closeButton: {
    width: 38,
    height: 38,
    borderRadius: 13,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    paddingHorizontal: space.xl,
    gap: space.sm2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.sm2,
    borderRadius: 20,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
  },
  rowTile: {
    width: 64,
    minHeight: 64,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    fontWeight: '700',
    fontSize: type.body.fontSize,
    lineHeight: 20,
    color: colors.primaryDarker,
  },
  rowMeta: {
    fontWeight: '600',
    fontSize: type.caption.fontSize,
    color: colors.textSecondary,
    marginTop: space.xs,
  },
  clashRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs2,
    marginTop: space.xs,
  },
  clashText: {
    flex: 1,
    fontWeight: '700',
    fontSize: type.caption.fontSize,
    color: colors.rust,
  },
  emptyCard: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
    borderRadius: 22,
    padding: space.xl,
  },
  emptyTitle: {
    fontFamily: fonts.display,
    fontWeight: '700',
    fontSize: type.subtitle.fontSize,
    color: colors.primaryDarker,
    marginBottom: space.xs2,
  },
  emptyBody: {
    fontWeight: '600',
    fontSize: type.label.fontSize,
    lineHeight: 19,
    color: colors.textSecondary,
  },
}));