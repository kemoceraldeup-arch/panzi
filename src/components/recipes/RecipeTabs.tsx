// src/components/recipes/RecipeTabs.tsx
//
// How the user steers, replacing the old pill row (see git history for
// MoodChips.tsx). Same job — each tab changes the question sent to the
// model, nothing is filtered client-side by category — but drawn as
// underline tabs spanning the row rather than a scrollable chip strip, since
// four short labels always fit one row on a phone width.

import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, TouchableOpacity, View } from 'react-native';
import { MOODS, RecipeMood } from '../../services/recipes';
import { makeStyles } from '../../theme/makeStyles';
import { useColors } from '../../theme/ThemeProvider';
import { space } from '../../theme/spacing';
import { type } from '../../theme/typography';

const TAB_TRANSITION_MS = 180;

type Props = {
  value: RecipeMood;
  onChange: (mood: RecipeMood) => void;
  /** Tabs go flat while a call is in flight — tapping four in a row should
   *  queue nothing, and the loading state below is already saying wait. */
  disabled?: boolean;
};

export default function RecipeTabs({ value, onChange, disabled }: Props) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View>
      <View style={styles.row}>
        {MOODS.map((mood) => (
          <Tab
            key={mood.id}
            label={mood.label}
            active={mood.id === value}
            disabled={disabled}
            onPress={() => onChange(mood.id)}
          />
        ))}
      </View>
      <View style={[styles.divider, { backgroundColor: colors.divider }]} />
    </View>
  );
}

function Tab({
  label,
  active,
  disabled,
  onPress,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  // 0 = inactive, 1 = active. One value per tab rather than one shared
  // "which index is selected" value, because each tab's colour and
  // underline are independent interpolations, not a single moving bar.
  const progress = useRef(new Animated.Value(active ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(progress, {
      toValue: active ? 1 : 0,
      duration: TAB_TRANSITION_MS,
      // Colour and border-color can't run on the native driver.
      useNativeDriver: false,
    }).start();
  }, [active, progress]);

  const textColor = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [colors.tabInactive, colors.textPrimary],
  });
  const underlineColor = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ['transparent', colors.textPrimary],
  });

  return (
    <TouchableOpacity
      style={[styles.tab, disabled && styles.tabDisabled]}
      onPress={() => !disabled && !active && onPress()}
      activeOpacity={0.7}
      accessibilityRole="tab"
      accessibilityState={{ selected: active, disabled: !!disabled }}
    >
      <Animated.Text style={[styles.label, { color: textColor }]} maxFontSizeMultiplier={1.3}>
        {label}
      </Animated.Text>
      <Animated.View style={[styles.underline, { borderBottomColor: underlineColor }]} />
    </TouchableOpacity>
  );
}

const useStyles = makeStyles(() => ({
  row: {
    flexDirection: 'row',
  },
  tab: {
    flex: 1,
    alignItems: 'center',
  },
  tabDisabled: {
    opacity: 0.5,
  },
  label: {
    fontFamily: 'Baloo2_700Bold',
    fontSize: type.body.fontSize,
    paddingBottom: space.md,
  },
  underline: {
    width: '100%',
    borderBottomWidth: 3,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
  },
}));
