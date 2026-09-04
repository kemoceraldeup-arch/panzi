// src/screens/scan/PickDateModal.tsx
//
// The "Pick date" chip on PACKAGE STATUS's WHEN WAS IT OPENED? row needs a
// past-dates-only date picker. The spec this was built against forbids
// adding a library, and nothing native is already a dependency here (see
// package.json), so this reuses the same MM/DD/YYYY boxes DateField already
// uses, inside the same bare-Modal-plus-sheet shape ChipPickerSheet already
// uses elsewhere in the app — no new pattern, no new dependency.

import React, { useState } from 'react';
import { Modal, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import Text from '../../components/Text';
import { fonts, type } from '../../theme/typography';
import { makeStyles } from '../../theme/makeStyles';
import { useColors } from '../../theme/ThemeProvider';
import { space } from '../../theme/spacing';

type Parts = { day: string; month: string; year: string };

function toIso({ day, month, year }: Parts): string | null {
  if (day.length === 0 || month.length === 0 || year.length !== 4) return null;
  const d = Number(day);
  const m = Number(month);
  const y = Number(year);
  if (!d || !m || !y) return null;
  if (m > 12 || d > 31) return null;
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

type Props = {
  visible: boolean;
  onClose: () => void;
  onPick: (iso: string) => void;
};

export default function PickDateModal({ visible, onClose, onPick }: Props) {
  const styles = useStyles();
  const colors = useColors();
  const [parts, setParts] = useState<Parts>({ day: '', month: '', year: '' });
  const [error, setError] = useState(false);

  function edit(key: keyof Parts, raw: string, max: number) {
    const digits = raw.replace(/[^0-9]/g, '').slice(0, max);
    setParts((p) => ({ ...p, [key]: digits }));
    setError(false);
  }

  function close() {
    setParts({ day: '', month: '', year: '' });
    setError(false);
    onClose();
  }

  function confirm() {
    const iso = toIso(parts);
    // Past dates only — an item can't have been opened in the future.
    if (!iso || iso > todayIso()) {
      setError(true);
      return;
    }
    onPick(iso);
    close();
  }

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={close}>
      <View style={styles.backdrop}>
        <TouchableOpacity style={styles.backdropTap} activeOpacity={1} onPress={close} />
        <View style={styles.sheet}>
          <Text style={styles.title}>When was it opened?</Text>

          <View style={styles.field}>
            <TextInput
              style={styles.box}
              value={parts.month}
              onChangeText={(t) => edit('month', t, 2)}
              placeholder="MM"
              placeholderTextColor={colors.mutedLight}
              keyboardType="number-pad"
              maxLength={2}
              selectionColor={colors.primaryDark}
              accessibilityLabel="Month"
            />
            <Text style={styles.slash}>/</Text>
            <TextInput
              style={styles.box}
              value={parts.day}
              onChangeText={(t) => edit('day', t, 2)}
              placeholder="DD"
              placeholderTextColor={colors.mutedLight}
              keyboardType="number-pad"
              maxLength={2}
              selectionColor={colors.primaryDark}
              accessibilityLabel="Day"
            />
            <Text style={styles.slash}>/</Text>
            <TextInput
              style={[styles.box, styles.boxYear]}
              value={parts.year}
              onChangeText={(t) => edit('year', t, 4)}
              placeholder="YYYY"
              placeholderTextColor={colors.mutedLight}
              keyboardType="number-pad"
              maxLength={4}
              selectionColor={colors.primaryDark}
              accessibilityLabel="Year"
            />
          </View>

          {error && <Text style={styles.error}>Enter a real past date.</Text>}

          <View style={styles.actions}>
            <TouchableOpacity style={styles.cancel} onPress={close} activeOpacity={0.7}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.confirm} onPress={confirm} activeOpacity={0.7}>
              <Text style={styles.confirmText}>Set date</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(23,23,15,0.35)',
    padding: space.xl,
  },
  backdropTap: {
    ...StyleSheet.absoluteFillObject,
  },
  sheet: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: space.xl,
    gap: space.md2,
  },
  title: {
    fontFamily: fonts.display,
    fontWeight: '700',
    fontSize: type.title.fontSize,
    color: colors.primaryDarker,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
    borderRadius: 14,
    paddingHorizontal: space.md2,
  },
  box: {
    fontFamily: 'Nunito_700Bold',
    fontSize: type.bodyLarge.fontSize,
    color: colors.primaryDarker,
    paddingVertical: space.md,
    paddingHorizontal: space.xs2,
    textAlign: 'center',
    minWidth: 36,
  },
  boxYear: {
    minWidth: 62,
  },
  slash: {
    fontWeight: '700',
    fontSize: type.body.fontSize,
    color: colors.chevron,
  },
  error: {
    fontWeight: '600',
    fontSize: type.caption.fontSize,
    color: colors.error,
  },
  actions: {
    flexDirection: 'row',
    gap: space.sm2,
  },
  cancel: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
  },
  cancelText: {
    fontWeight: '700',
    fontSize: type.body.fontSize,
    color: colors.textSecondary,
  },
  confirm: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    backgroundColor: colors.primaryDark,
  },
  confirmText: {
    fontWeight: '700',
    fontSize: type.body.fontSize,
    color: colors.onAccent,
  },
}));
