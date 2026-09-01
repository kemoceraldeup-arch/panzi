// src/components/recipes/PantryToggle.tsx
//
// The other half of narrowing the list, alongside RecipeTabs — but a
// yes/no filter rather than a category, so it gets its own strip instead of
// sitting in the same row. "Pantry only" hides any of the current
// suggestions that need even one thing not already on the shelf; the count
// beside it answers the question the toggle is about to ask, before asking it.

import React from 'react';
import { TouchableOpacity, View } from 'react-native';
import Text from '../Text';
import { makeStyles } from '../../theme/makeStyles';
import { useColors } from '../../theme/ThemeProvider';
import { space } from '../../theme/spacing';
import { type } from '../../theme/typography';

type Props = {
  value: boolean;
  onChange: (value: boolean) => void;
  /** How many of the current suggestions need nothing from the shop. */
  cookableCount: number;
  disabled?: boolean;
};

export default function PantryToggle({ value, onChange, cookableCount, disabled }: Props) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={styles.strip}>
      <TouchableOpacity
        style={[
          styles.pill,
          value && { backgroundColor: colors.inkFill, borderColor: colors.inkFill },
          disabled && styles.pillDisabled,
        ]}
        onPress={() => !disabled && onChange(!value)}
        activeOpacity={0.85}
        accessibilityRole="switch"
        accessibilityState={{ checked: value, disabled: !!disabled }}
        accessibilityLabel="Pantry only"
      >
        <View style={[styles.dot, { backgroundColor: value ? colors.onAccent : colors.textDark }]} />
        <Text style={[styles.pillLabel, { color: value ? colors.onAccent : colors.textDark }]}>
          Pantry only
        </Text>
      </TouchableOpacity>
      <Text style={styles.helper} numberOfLines={1}>
        {cookableCount} cookable with zero shopping
      </Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm2,
    backgroundColor: colors.backgroundAlt,
    borderRadius: 16,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.sm,
    paddingHorizontal: space.md2,
    borderRadius: 999,
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
  },
  pillDisabled: {
    opacity: 0.5,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  pillLabel: {
    fontWeight: '700',
    fontSize: type.label.fontSize,
  },
  helper: {
    flex: 1,
    fontWeight: '500',
    fontSize: type.caption.fontSize,
    color: colors.textSecondary,
  },
}));
