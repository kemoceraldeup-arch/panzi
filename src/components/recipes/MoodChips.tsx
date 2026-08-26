// src/components/recipes/MoodChips.tsx
//
// How the user steers. Before this, the only control over a suggestion was
// shuffle, which re-rolls blindly — "not that, but I can't tell you why".
//
// Each chip changes the question, not the answer: it goes into the request and
// the model works within it. Nothing is filtered out client-side, because
// filtering three suggestions down to zero to honour "Quick" hands the user an
// empty screen as a reward for tapping something.

import React from 'react';
import { ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import Text from '../Text';
import { MOODS, RecipeMood } from '../../services/recipes';
import { makeStyles } from '../../theme/makeStyles';
import { useColors } from '../../theme/ThemeProvider';
import { space } from '../../theme/spacing';
import { type } from '../../theme/typography';

type Props = {
  value: RecipeMood;
  onChange: (mood: RecipeMood) => void;
  /** Chips go flat while a call is in flight — tapping four in a row should
   *  queue nothing, and the loading state below is already saying wait. */
  disabled?: boolean;
};

export default function MoodChips({ value, onChange, disabled }: Props) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      // The row is full-bleed while the rest of the screen is inset, so the
      // last chip can sit under the edge instead of stopping short of it.
      style={styles.scroll}
    >
      {MOODS.map((mood) => {
        const active = mood.id === value;
        return (
          <TouchableOpacity
            key={mood.id}
            style={[styles.chip, active && styles.chipActive, disabled && styles.chipDisabled]}
            onPress={() => !disabled && !active && onChange(mood.id)}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityState={{ selected: active, disabled: !!disabled }}
          >
            <Text style={[styles.label, active && styles.labelActive]}>{mood.label}</Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const useStyles = makeStyles((colors) => ({
  scroll: {
    marginHorizontal: -20,
    flexGrow: 0,
  },
  row: {
    paddingHorizontal: space.xl,
    gap: space.sm,
  },
  chip: {
    height: 36,
    justifyContent: 'center',
    paddingHorizontal: space.lg,
    borderRadius: 999,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
  },
  chipActive: {
    backgroundColor: colors.inkFill,
    borderColor: colors.primaryDarker,
  },
  chipDisabled: {
    opacity: 0.5,
  },
  label: {
    fontWeight: '700',
    fontSize: type.label.fontSize,
    color: colors.textDark,
  },
  labelActive: {
    color: colors.onAccent,
  },
}));