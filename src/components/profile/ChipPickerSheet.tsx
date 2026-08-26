// src/components/profile/ChipPickerSheet.tsx
//
// What "+ Add" opens on the Profile screen's "What you eat" card: a searchable
// list of the common options for that group, plus free text for anything not
// on it. One component serves both diet and allergies — only the suggestion
// list, the accent colour and the copy differ.

import React, { useMemo, useState } from 'react';
import {
  View,
  StyleSheet,
  Modal,
  TextInput,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Text from '../Text';
import { fonts, type } from '../../theme/typography';
import { makeStyles } from '../../theme/makeStyles';
import { useColors } from '../../theme/ThemeProvider';
import { space } from '../../theme/spacing';

const MAX_LENGTH = 32;

type Props = {
  visible: boolean;
  title: string;
  /** Suggestions for this group — already-chosen ones are filtered out. */
  options: string[];
  /** What the user already has, so we never offer a duplicate. */
  chosen: string[];
  /** Green for diet, orange for allergies. */
  tone: 'diet' | 'allergy';
  onAdd: (value: string) => void;
  onClose: () => void;
};

export default function ChipPickerSheet({
  visible,
  title,
  options,
  chosen,
  tone,
  onAdd,
  onClose,
}: Props) {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');

  const accent = tone === 'diet' ? colors.primaryDark : colors.accent;
  const fill = tone === 'diet' ? colors.primaryLighter : colors.accentSoft;

  const lowerChosen = useMemo(
    () => new Set(chosen.map((c) => c.toLowerCase())),
    [chosen]
  );

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return options.filter(
      (option) => !lowerChosen.has(option.toLowerCase()) && (!q || option.toLowerCase().includes(q))
    );
  }, [options, lowerChosen, query]);

  const trimmed = query.trim();
  // Only offer "Add X" when the typed text isn't already an exact suggestion or
  // an existing chip — otherwise the sheet shows the same thing twice.
  const canAddFreeText =
    trimmed.length > 0 &&
    !lowerChosen.has(trimmed.toLowerCase()) &&
    !options.some((option) => option.toLowerCase() === trimmed.toLowerCase());

  function pick(value: string) {
    onAdd(value);
    setQuery('');
    onClose();
  }

  function close() {
    setQuery('');
    onClose();
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={close}>
      <View style={styles.backdrop}>
        {/* Tapping the dimmed area behind the sheet closes it. */}
        <TouchableOpacity style={styles.backdropTap} activeOpacity={1} onPress={close} />

        <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.grabber} />

          <View style={styles.header}>
            <Text style={styles.title}>{title}</Text>
            <TouchableOpacity onPress={close} hitSlop={HIT_SLOP}>
              <Ionicons name="close" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <View style={styles.searchRow}>
            <Ionicons name="search" size={16} color={colors.mutedLight} />
            <TextInput
              style={styles.search}
              placeholder="Search or type your own"
              placeholderTextColor={colors.mutedLight}
              value={query}
              onChangeText={setQuery}
              maxLength={MAX_LENGTH}
              autoCorrect={false}
              returnKeyType="done"
              onSubmitEditing={() => canAddFreeText && pick(trimmed)}
            />
          </View>

          <ScrollView
            style={styles.list}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {canAddFreeText && (
              <TouchableOpacity style={styles.row} onPress={() => pick(trimmed)}>
                <View style={[styles.rowIcon, { backgroundColor: fill }]}>
                  <Ionicons name="add" size={16} color={accent} />
                </View>
                <Text style={styles.rowLabel} numberOfLines={1}>
                  Add “{trimmed}”
                </Text>
              </TouchableOpacity>
            )}

            {matches.map((option) => (
              <TouchableOpacity key={option} style={styles.row} onPress={() => pick(option)}>
                <View style={[styles.rowIcon, { backgroundColor: fill }]}>
                  <Ionicons name="add" size={16} color={accent} />
                </View>
                <Text style={styles.rowLabel}>{option}</Text>
              </TouchableOpacity>
            ))}

            {matches.length === 0 && !canAddFreeText && (
              <Text style={styles.empty}>Nothing left to add here.</Text>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const HIT_SLOP = { top: 12, bottom: 12, left: 12, right: 12 };

const useStyles = makeStyles((colors) => ({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(23,23,15,0.35)',
  },
  backdropTap: {
    flex: 1,
  },
  sheet: {
    maxHeight: '70%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: space.xl,
    paddingTop: space.sm2,
  },
  grabber: {
    alignSelf: 'center',
    width: 42,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.backgroundAlt,
    marginBottom: space.md2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.md2,
  },
  title: {
    fontFamily: fonts.display,
    fontWeight: '700',
    fontSize: type.title.fontSize,
    color: colors.primaryDarker,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm2,
    height: 44,
    paddingHorizontal: space.md2,
    borderRadius: 16,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
  },
  search: {
    flex: 1,
    fontFamily: 'Nunito_600SemiBold',
    fontSize: type.bodySmall.fontSize,
    color: colors.primaryDarker,
    padding: space.none,
  },
  list: {
    marginTop: space.xs2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
  },
  rowIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowLabel: {
    flex: 1,
    fontWeight: '700',
    fontSize: type.body.fontSize,
    color: colors.primaryDarker,
  },
  empty: {
    paddingVertical: space.xxl,
    textAlign: 'center',
    fontWeight: '600',
    fontSize: type.label.fontSize,
    color: colors.textSecondary,
  },
}));