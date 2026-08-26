// src/screens/CookModeScreen.tsx
//
// Cooking, one step at a time — and then the part that matters.
//
// Two things shape this screen. The first is where it is read from: a phone
// propped against a rice cooker, a metre away, by someone with oily hands. So
// the type is large, there is exactly one instruction visible at a time, and
// the targets are buttons rather than swipes. The screen is kept awake, because
// a phone that sleeps between step three and step four has to be unlocked with
// a wet thumb.
//
// The second is the last screen. Panzi has always tracked food coming in and
// food running out of time, but nothing has ever recorded food being *eaten* —
// a pantry item's only exits were "deleted by hand" and "expired". Cooking is
// the exit the whole app is arguing for, and "What did you use?" is where it
// finally gets recorded.
//
// That screen deletes rows from someone's kitchen, so: nothing is offered that
// the recipe did not name, the button says how many it will clear, backing out
// cancels, and skipping costs one tap.

import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useKeepAwake } from 'expo-keep-awake';
import {
  SafeAreaProvider,
  initialWindowMetrics,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import Text from '../components/Text';
import DishTile from '../components/recipes/DishTile';
import { PantryItem, deletePantryItems } from '../services/pantry';
import { Recipe, matchPantryUsed } from '../services/recipes';
import { fonts, type } from '../theme/typography';
import { makeStyles } from '../theme/makeStyles';
import { useColors } from '../theme/ThemeProvider';
import { space } from '../theme/spacing';

const HIT_SLOP = { top: 12, bottom: 12, left: 12, right: 12 };

type Props = {
  recipe: Recipe | null;
  /** The pantry as it stands, for resolving what the dish used. */
  items: PantryItem[];
  onClose: () => void;
};

export default function CookModeScreen({ recipe, items, onClose }: Props) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <Modal
      visible={recipe !== null}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        {recipe && <Body recipe={recipe} items={items} onClose={onClose} />}
      </SafeAreaProvider>
    </Modal>
  );
}

function Body({ recipe, items, onClose }: { recipe: Recipe; items: PantryItem[]; onClose: () => void }) {
  const styles = useStyles();
  const colors = useColors();
  useKeepAwake();
  const insets = useSafeAreaInsets();

  // 0 is the ingredient list, 1..n are the steps, and n+1 is the finish screen.
  // Starting on the ingredients rather than on step one means nobody discovers
  // a missing egg with the pan already hot.
  const last = recipe.steps.length + 1;
  const [page, setPage] = useState(0);

  const used = useMemo(() => matchPantryUsed(recipe, items), [recipe, items]);
  const [ticked, setTicked] = useState<Set<string>>(() => new Set(used.map((i) => i.id)));
  const [clearing, setClearing] = useState(false);
  const [clearFailed, setClearFailed] = useState(false);

  const finishing = page === last;

  const toggle = (id: string) => {
    setTicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const finish = async () => {
    const ids = used.filter((item) => ticked.has(item.id)).map((item) => item.id);
    if (ids.length === 0) {
      onClose();
      return;
    }

    setClearing(true);
    setClearFailed(false);
    try {
      await deletePantryItems(ids);
      onClose();
    } catch {
      // Kept open rather than closed with a toast. The user believes their
      // pantry is now correct; letting them leave on that belief when nothing
      // was written is the worse failure.
      setClearFailed(true);
    } finally {
      setClearing(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          onPress={onClose}
          hitSlop={HIT_SLOP}
          style={styles.closeButton}
          accessibilityLabel="Stop cooking"
        >
          <Ionicons name="close" size={20} color={colors.primaryDarker} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {recipe.title}
          </Text>
          <Text style={styles.headerMeta}>
            {finishing
              ? 'Finished'
              : page === 0
                ? 'Before you start'
                : `Step ${page} of ${recipe.steps.length}`}
          </Text>
        </View>
      </View>

      {/* Dots, not a bar. A cook wants to know how many moves are left, and
          counting four dots is faster than reading a percentage. */}
      {!finishing && (
        <View style={styles.dots}>
          {Array.from({ length: recipe.steps.length + 1 }).map((_, i) => (
            <View key={i} style={[styles.dot, i <= page && styles.dotDone]} />
          ))}
        </View>
      )}

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {page === 0 && <Ingredients recipe={recipe} />}

        {page > 0 && !finishing && (
          <View style={styles.stepPage}>
            <DishTile
              look={recipe.look}
              dishKey={recipe.dishKey}
              size="mini"
              radius={20}
              style={styles.stepTile}
            />
            <Text style={styles.stepText}>{recipe.steps[page - 1]}</Text>
          </View>
        )}

        {finishing && (
          <Finish
            used={used}
            ticked={ticked}
            onToggle={toggle}
            failed={clearFailed}
          />
        )}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 14 }]}>
        {page > 0 && (
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => setPage((p) => p - 1)}
            disabled={clearing}
          >
            <Ionicons name="chevron-back" size={22} color={colors.primaryDarker} />
          </TouchableOpacity>
        )}

        {!finishing ? (
          <TouchableOpacity
            style={styles.nextButton}
            onPress={() => setPage((p) => p + 1)}
            activeOpacity={0.85}
          >
            <Text style={styles.nextText}>
              {page === 0 ? 'Start' : page === recipe.steps.length ? "I'm done" : 'Next'}
            </Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.nextButton, clearing && styles.nextBusy]}
            onPress={finish}
            disabled={clearing}
            activeOpacity={0.85}
          >
            {clearing ? (
              <ActivityIndicator color={colors.onAccent} />
            ) : (
              <Text style={styles.nextText}>
                {/* Says the number out loud. A button labelled "Done" that
                    silently deletes four things is a trap. */}
                {ticked.size === 0
                  ? 'Close'
                  : `Clear ${ticked.size} from pantry`}
              </Text>
            )}
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

function Ingredients({ recipe }: { recipe: Recipe }) {
  const styles = useStyles();
  const colors = useColors();
  const have = recipe.ingredients.filter((i) => i.have);
  const need = recipe.ingredients.filter((i) => !i.have);

  return (
    <View>
      <DishTile
        look={recipe.look}
        dishKey={recipe.dishKey}
        size="hero"
        radius={24}
        style={styles.heroTile}
      />
      <Text style={styles.pageTitle}>Get these out</Text>

      {have.map((item, i) => (
        <View key={`have-${i}`} style={styles.ingredientRow}>
          <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
          <Text style={styles.ingredientName}>{item.name}</Text>
          <Text style={styles.ingredientAmount}>{item.amount}</Text>
        </View>
      ))}

      {need.length > 0 && (
        <>
          <Text style={[styles.pageTitle, styles.pageTitleNeed]}>You&apos;ll need to get</Text>
          {need.map((item, i) => (
            <View key={`need-${i}`} style={styles.ingredientRow}>
              <Ionicons name="ellipse-outline" size={20} color={colors.accentDeep} />
              <Text style={styles.ingredientName}>{item.name}</Text>
              <Text style={styles.ingredientAmount}>{item.amount}</Text>
            </View>
          ))}
        </>
      )}
    </View>
  );
}

function Finish({
  used,
  ticked,
  onToggle,
  failed,
}: {
  used: PantryItem[];
  ticked: Set<string>;
  onToggle: (id: string) => void;
  failed: boolean;
}) {
  const styles = useStyles();
  const colors = useColors();
  if (used.length === 0) {
    return (
      <View>
        <Text style={styles.pageTitle}>Nice one</Text>
        <Text style={styles.finishBody}>
          Nothing from your pantry matched this recipe, so there is nothing to tidy up.
        </Text>
      </View>
    );
  }

  return (
    <View>
      <Text style={styles.pageTitle}>What did you use?</Text>
      <Text style={styles.finishBody}>
        Ticked items leave your pantry. Untick anything you still have left.
      </Text>

      {used.map((item) => {
        const on = ticked.has(item.id);
        return (
          <TouchableOpacity
            key={item.id}
            style={[styles.usedRow, on && styles.usedRowOn]}
            onPress={() => onToggle(item.id)}
            activeOpacity={0.8}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
          >
            <Ionicons
              name={on ? 'checkbox' : 'square-outline'}
              size={22}
              color={on ? colors.primary : colors.checkboxRing}
            />
            <Text style={styles.usedName} numberOfLines={2}>
              {item.name}
            </Text>
            {!!item.quantity && <Text style={styles.usedQuantity}>{item.quantity}</Text>}
          </TouchableOpacity>
        );
      })}

      {failed && (
        <Text style={styles.finishError}>
          Couldn&apos;t update your pantry just now — check your connection and try again.
        </Text>
      )}
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
    gap: space.md,
    paddingHorizontal: space.xl,
    paddingBottom: space.md,
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
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  headerTitle: {
    fontFamily: fonts.display,
    fontWeight: '800',
    fontSize: type.subtitle.fontSize,
    color: colors.primaryDarker,
  },
  headerMeta: {
    fontWeight: '700',
    fontSize: type.caption.fontSize,
    color: colors.textSecondary,
    marginTop: space.half,
  },
  dots: {
    flexDirection: 'row',
    gap: space.xs2,
    paddingHorizontal: space.xl,
    paddingBottom: space.sm,
  },
  dot: {
    flex: 1,
    height: 4,
    borderRadius: 999,
    backgroundColor: colors.backgroundAlt,
  },
  dotDone: {
    backgroundColor: colors.primary,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: space.xl,
    paddingTop: space.md2,
    paddingBottom: space.xxl,
  },
  heroTile: {
    marginBottom: space.xl,
  },
  pageTitle: {
    fontFamily: fonts.display,
    fontWeight: '800',
    fontSize: type.headline.fontSize,
    color: colors.primaryDarker,
    marginBottom: space.md,
  },
  pageTitleNeed: {
    marginTop: space.xl2,
    color: colors.accentDeep,
  },
  ingredientRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  ingredientName: {
    flex: 1,
    minWidth: 0,
    fontWeight: '700',
    fontSize: type.bodyLarge.fontSize,
    color: colors.primaryDarker,
  },
  ingredientAmount: {
    fontWeight: '600',
    fontSize: type.body.fontSize,
    color: colors.textSecondary,
  },
  stepPage: {
    paddingTop: space.sm,
  },
  stepTile: {
    width: 74,
    marginBottom: space.xxl,
  },
  stepText: {
    // The whole reason this screen exists. Read from a metre away.
    fontWeight: '700',
    fontSize: type.headline.fontSize,
    lineHeight: 36,
    color: colors.primaryDarker,
  },
  finishBody: {
    fontWeight: '600',
    fontSize: type.bodySmall.fontSize,
    lineHeight: 20,
    color: colors.textSecondary,
    marginBottom: space.lg2,
  },
  usedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md2,
    paddingHorizontal: space.md2,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
    backgroundColor: colors.card,
    marginBottom: space.sm2,
  },
  usedRowOn: {
    borderColor: colors.primaryLine,
    backgroundColor: colors.primaryWash,
  },
  usedName: {
    flex: 1,
    minWidth: 0,
    fontWeight: '700',
    fontSize: type.body.fontSize,
    color: colors.primaryDarker,
  },
  usedQuantity: {
    fontWeight: '600',
    fontSize: type.label.fontSize,
    color: colors.textSecondary,
  },
  finishError: {
    fontWeight: '700',
    fontSize: type.label.fontSize,
    lineHeight: 18,
    color: colors.rust,
    marginTop: space.xs2,
  },
  footer: {
    flexDirection: 'row',
    gap: space.md,
    paddingHorizontal: space.xl,
    paddingTop: space.md,
    borderTopWidth: 1,
    borderTopColor: colors.borderWarm,
    backgroundColor: colors.backgroundLight,
  },
  backButton: {
    width: 58,
    height: 58,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextButton: {
    flex: 1,
    height: 58,
    borderRadius: 18,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextBusy: {
    backgroundColor: colors.primaryPressed,
  },
  nextText: {
    fontWeight: '800',
    fontSize: type.subtitle.fontSize,
    color: colors.onAccent,
  },
}));