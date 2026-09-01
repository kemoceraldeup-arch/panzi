// src/screens/scan/DateField.tsx
//
// Typing in a use-by date.
//
// Three numeric boxes, not a picker wheel and not a row of "3 days / 1 week"
// chips. The reason a row lands on the review page saying "No date found" is
// almost always that a date *is* printed on the packet and the scanner couldn't
// read it — a folded label, a faded stamp, a lid turned away. The user fixing
// that row is holding the packet and reading "02 09 2026" off it. Relative
// chips cannot express that, and a picker makes them spin three wheels to say
// something they could have typed in six keystrokes.
//
// The chips are still here, underneath, for the case they are actually right
// for: food with no printed date at all, where "about a week" is the honest
// answer and the exact day is invented precision.
//
// Month first, then day, then year — US order, matching the way the date is
// printed on the packets this is transcribing.
//
// Auto-advance between boxes is what makes this feel like typing a date rather
// than filling in a form: two digits and the caret moves on by itself.

import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import Text from '../../components/Text';
import { dateInDays } from '../../utils/freshness';
import { Eyebrow } from './atoms';
import { makeStyles } from '../../theme/makeStyles';
import { useColors } from '../../theme/ThemeProvider';
import { space } from '../../theme/spacing';
import { type } from '../../theme/typography';

// Kept short and few. Long ones ("1 month") were the options least used on a
// packet the user is holding, and every extra chip is another thing to read
// past on the way to the field that actually matters.
const ROUGH_PRESETS: { label: string; days: number }[] = [
  { label: 'Today', days: 0 },
  { label: '3 days', days: 3 },
  { label: 'A week', days: 7 },
  { label: 'A month', days: 30 },
];

type Parts = { day: string; month: string; year: string };

const EMPTY: Parts = { day: '', month: '', year: '' };

function toParts(iso: string | null): Parts {
  if (!iso) return EMPTY;
  const [y, m, d] = iso.split('-');
  return { day: d ?? '', month: m ?? '', year: y ?? '' };
}

/**
 * Parts to an ISO date, or null while they aren't yet a real day.
 *
 * Strict about the calendar — the 31st of February and the 32nd of anything are
 * rejected rather than rounded into a neighbouring month, because a use-by date
 * silently moved by a day is exactly the kind of quiet wrongness this whole
 * feature is built to avoid.
 */
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

type Props = {
  value: string | null;
  /** Fires only with a complete, real date, or with null when cleared. */
  onChange: (iso: string | null) => void;
};

export default function DateField({ value, onChange }: Props) {
  const styles = useStyles();
  const colors = useColors();
  const [parts, setParts] = useState<Parts>(() => toParts(value));
  const dayRef = useRef<TextInput>(null);
  const yearRef = useRef<TextInput>(null);

  // Adopts a date set from elsewhere — a preset chip below, or the ripeness
  // screen overruling the estimate — without fighting the user mid-keystroke.
  useEffect(() => {
    const iso = toIso(parts);
    if (value !== iso) setParts(toParts(value));
    // Deliberately keyed on `value` alone: re-running when `parts` changes would
    // reset the boxes on every digit typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function edit(key: keyof Parts, raw: string, max: number, next?: TextInput | null) {
    const digits = raw.replace(/[^0-9]/g, '').slice(0, max);
    const updated = { ...parts, [key]: digits };
    setParts(updated);

    if (digits.length === max && next) next.focus();

    const iso = toIso(updated);
    // Nothing typed anywhere is a cleared date; a half-typed one is simply not
    // reported yet, so the chip doesn't flicker through wrong dates as the user
    // types the year.
    if (iso) onChange(iso);
    else if (!updated.day && !updated.month && !updated.year) onChange(null);
  }

  const activePreset = ROUGH_PRESETS.find((p) => value && value === dateInDays(p.days));

  return (
    <>
      {/* The field owns the full width. The provenance chip used to sit beside
          it and, at "14 SEPTEMBER · YOU SET THIS", squeezed the boxes until the
          year clipped — it lives up on the label row now, where its length
          costs the input nothing. */}
      <View style={styles.field}>
        <TextInput
          style={styles.box}
          value={parts.month}
            onChangeText={(t) => edit('month', t, 2, dayRef.current)}
          placeholder="MM"
          placeholderTextColor={colors.mutedLight}
          keyboardType="number-pad"
          maxLength={2}
          selectionColor={colors.primaryDark}
          accessibilityLabel="Month"
        />
        <Text style={styles.slash}>/</Text>
        <TextInput
          ref={dayRef}
          style={styles.box}
          value={parts.day}
          onChangeText={(t) => edit('day', t, 2, yearRef.current)}
          placeholder="DD"
          placeholderTextColor={colors.mutedLight}
          keyboardType="number-pad"
          maxLength={2}
          selectionColor={colors.primaryDark}
          accessibilityLabel="Day"
        />
        <Text style={styles.slash}>/</Text>
        <TextInput
          ref={yearRef}
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

      <Eyebrow style={styles.roughLabel}>Or estimate</Eyebrow>
      <View style={styles.presets}>
        {ROUGH_PRESETS.map((preset) => {
          const selected = activePreset?.label === preset.label;
          return (
            <TouchableOpacity
              key={preset.label}
              style={[styles.preset, selected && styles.presetOn]}
              // Tapping the live chip clears the date — the only way back to
              // "no date" once one is set.
              onPress={() => onChange(selected ? null : dateInDays(preset.days))}
              activeOpacity={0.7}
            >
              <Text style={[styles.presetText, selected && styles.presetTextOn]}>
                {preset.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </>
  );
}

const useStyles = makeStyles((colors) => ({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    backgroundColor: colors.surface,
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
    // Four digits at 16pt bold, plus room for the caret. The old 52 clipped
    // the last character of the year.
    minWidth: 62,
  },
  slash: {
    fontWeight: '700',
    fontSize: type.body.fontSize,
    color: colors.chevron,
  },
  roughLabel: {
    marginTop: space.md,
    marginBottom: space.sm,
  },
  presets: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  preset: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: space.md,
    borderRadius: 999,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
  },
  presetOn: {
    backgroundColor: colors.primaryLighter,
    borderColor: colors.primaryLighter,
  },
  presetText: {
    fontWeight: '700',
    fontSize: type.caption.fontSize,
    color: colors.textSecondary,
  },
  presetTextOn: {
    fontWeight: '800',
    color: colors.primaryDark,
  },
}));