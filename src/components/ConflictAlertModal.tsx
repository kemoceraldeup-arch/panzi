// src/components/ConflictAlertModal.tsx
//
// "This doesn't match your diet/allergies — add it anyway?" — shown right
// before an item (or a whole scanned batch) is saved to the pantry, when a
// name matches something the user's profile rules out. See
// src/services/dietCheck.ts for the matching itself; this component only
// presents what that check already found.
//
// A native Alert.alert (the app's usual confirm/cancel pattern — see
// ListScreen's confirmRemove) can't be made to look more alarming than an
// ordinary confirmation beyond red button text, and the allergy case
// specifically asks to stand out more than the diet one. So this is a small
// custom modal instead, styled by the same diet/allergy tone split
// ChipPickerSheet already uses (green vs. accent orange) — an allergy gets
// the orange treatment plus a warning icon and a heavier border, which a
// system alert has no way to offer.
//
// Takes a list of items rather than one, so the exact same component covers
// both call sites: a single renamed pantry row (ListScreen) and a whole batch
// of scanned candidates, any number of which might conflict (ScanModal).

import React from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Text from './Text';
import { type } from '../theme/typography';
import { space } from '../theme/spacing';
import { useColors } from '../theme/ThemeProvider';
import { ItemConflict } from '../services/dietCheck';

export type ConflictingItem = {
  name: string;
  /** Allergy first, if present — see checkItemConflicts. */
  conflicts: ItemConflict[];
};

type Props = {
  visible: boolean;
  items: ConflictingItem[];
  onCancel: () => void;
  onAddAnyway: () => void;
};

/** One item's line — "Chicken breast doesn't match your Vegan diet." — reused
 *  for both the single-item message and each row of a multi-item list. */
function lineFor(item: ConflictingItem): { text: string; isAllergy: boolean } {
  const primary = item.conflicts[0];
  const rest = item.conflicts.slice(1);
  const restLabel = rest.length > 0 ? ` It also doesn't match ${rest.map((c) => c.label).join(', ')}.` : '';

  if (primary.type === 'allergy') {
    return {
      text: `${item.name} contains ${primary.label}, which you're allergic to.${restLabel}`,
      isAllergy: true,
    };
  }
  return {
    text: `${item.name} doesn't match your ${primary.label} diet.${restLabel}`,
    isAllergy: false,
  };
}

export default function ConflictAlertModal({ visible, items, onCancel, onAddAnyway }: Props) {
  const colors = useColors();
  if (items.length === 0) return null;

  // Allergy outranks diet the instant either is present anywhere in the
  // batch — one allergy conflict among five diet-only ones is still the worse
  // news, and the one that should set the modal's whole tone.
  const isAllergy = items.some((item) => item.conflicts.some((c) => c.type === 'allergy'));
  const tone = isAllergy ? colors.accentDeep : colors.primaryDark;
  const toneSoft = isAllergy ? colors.accentSoft : colors.primaryLighter;

  const lines = items.map(lineFor);
  const message =
    lines.length === 1
      ? `${lines[0].text} Are you sure you want to add it?`
      : `${lines.map((l) => l.text).join(' ')} Are you sure you want to add ${lines.length === items.length ? 'these' : 'them'}?`;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.scrim}>
        <View style={[styles.card, { backgroundColor: colors.card }, isAllergy && { borderColor: tone, borderWidth: 2 }]}>
          <View style={[styles.iconWrap, { backgroundColor: toneSoft }]}>
            <Ionicons name={isAllergy ? 'warning' : 'nutrition-outline'} size={28} color={tone} />
          </View>

          <Text style={[type.title, styles.titleWeight, styles.title, { color: colors.textPrimary }]}>
            {isAllergy ? 'Allergy warning' : "Doesn't match your diet"}
          </Text>

          <Text style={[type.body, styles.message, { color: colors.textDark }]}>{message}</Text>

          <View style={styles.actions}>
            <Pressable
              onPress={onCancel}
              style={[styles.button, styles.cancelButton, { backgroundColor: colors.backgroundAlt }]}
            >
              <Text style={[type.subtitle, styles.buttonWeight, { color: colors.textPrimary }]}>Cancel</Text>
            </Pressable>
            <Pressable onPress={onAddAnyway} style={[styles.button, { backgroundColor: tone }]}>
              <Text style={[type.subtitle, styles.buttonWeight, { color: colors.onAccent }]}>Add anyway</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.lg,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 20,
    padding: space.lg,
    alignItems: 'center',
  },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.md,
  },
  title: {
    textAlign: 'center',
    marginBottom: space.sm,
  },
  titleWeight: {
    fontWeight: '800',
  },
  message: {
    textAlign: 'center',
    marginBottom: space.lg,
  },
  actions: {
    flexDirection: 'row',
    gap: space.sm,
    width: '100%',
  },
  button: {
    flex: 1,
    paddingVertical: space.sm,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonWeight: {
    fontWeight: '700',
  },
  cancelButton: {},
});
