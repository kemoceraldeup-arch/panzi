// src/components/profile/MultiSelectDropdown.tsx
//
// A normal form dropdown for picking any number of options from a fixed
// list — tap the field, a checklist opens directly under it, tap rows to
// toggle them, tap the field again (or outside it) to close. Same shape as
// UnitPicker in screens/scan/atoms.tsx, generalised to multi-select with a
// scrollable panel instead of that one's two-or-four bare rows.
//
// Deliberately not ChipPickerSheet: that's a full-screen search sheet you
// reopen once per addition, which reads as an "add" flow rather than a
// dropdown. This opens in place, shows every selection with a check at
// once, and free text isn't offered — the whole point is picking from a
// known list rather than typing, so anything not on it just isn't here.

import React, { useState } from 'react';
import { ScrollView, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Text from '../Text';
import { makeStyles } from '../../theme/makeStyles';
import { useColors } from '../../theme/ThemeProvider';
import { space } from '../../theme/spacing';
import { type } from '../../theme/typography';

// Past this many rows the panel scrolls rather than growing forever — long
// enough to show most lists in full without a scroll at all.
const MAX_PANEL_HEIGHT = 220;

type Props = {
  placeholder: string;
  options: string[];
  selected: string[];
  onToggle: (option: string) => void;
};

export default function MultiSelectDropdown({ placeholder, options, selected, onToggle }: Props) {
  const styles = useStyles();
  const colors = useColors();
  const [open, setOpen] = useState(false);

  const summary = selected.length > 0 ? selected.join(', ') : placeholder;

  return (
    <View>
      <TouchableOpacity
        style={[styles.field, open && styles.fieldOpen]}
        onPress={() => setOpen((v) => !v)}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={placeholder}
        accessibilityState={{ expanded: open }}
      >
        <Text
          style={[styles.fieldText, selected.length === 0 && styles.fieldPlaceholder]}
          numberOfLines={1}
        >
          {summary}
        </Text>
        <Ionicons
          name={open ? 'chevron-up' : 'chevron-down'}
          size={16}
          color={colors.mutedLight}
        />
      </TouchableOpacity>

      {open && (
        <View style={styles.panel}>
          <ScrollView
            style={{ maxHeight: MAX_PANEL_HEIGHT }}
            nestedScrollEnabled
            showsVerticalScrollIndicator={false}
          >
            {options.map((option) => {
              const checked = selected.includes(option);
              return (
                <TouchableOpacity
                  key={option}
                  style={styles.row}
                  onPress={() => onToggle(option)}
                  activeOpacity={0.7}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked }}
                >
                  <View style={[styles.checkbox, checked && styles.checkboxOn]}>
                    {checked && <Ionicons name="checkmark" size={13} color={colors.onAccent} />}
                  </View>
                  <Text style={styles.rowText}>{option}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 52,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
    backgroundColor: colors.card,
    paddingHorizontal: space.lg,
  },
  // Squares off the bottom corners while open, so the field and the panel
  // directly under it read as one continuous shape rather than two
  // separate cards stacked with a visible seam.
  fieldOpen: {
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    borderBottomWidth: 0,
  },
  fieldText: {
    flex: 1,
    fontWeight: '600',
    fontSize: type.body.fontSize,
    color: colors.textPrimary,
    marginRight: space.sm,
  },
  fieldPlaceholder: {
    color: colors.textSecondary,
  },
  panel: {
    borderWidth: 1,
    borderTopWidth: 0,
    borderColor: colors.backgroundAlt,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
    backgroundColor: colors.card,
    paddingVertical: space.xs2,
    shadowColor: colors.shadow,
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.sm2,
    paddingHorizontal: space.lg,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.backgroundAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  rowText: {
    flex: 1,
    fontWeight: '600',
    fontSize: type.bodySmall.fontSize,
    color: colors.textPrimary,
  },
}));
