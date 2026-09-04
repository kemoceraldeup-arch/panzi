// src/screens/scan/PackageStatusField.tsx
//
// PACKAGE STATUS — Sealed / Opened, optional, on every item.
//
// The one control on this card explicitly styled to look skippable: no
// accent fill until picked, a muted "(Optional)" right on the label, and no
// preselected answer. That's deliberate, not an oversight — this used to be
// a boolean-shaped "Opened?" gated behind "only if the row has no photo",
// which meant a scanned item with a real name like "Jufran Banana Catsup
// 320g" never got asked at all. Running that gate is itself a classifier on
// the render path (does this look like it needs asking?), which the spec
// this file was built against explicitly rules out — so the control now
// renders unconditionally and explains itself instead of hiding.
//
// Tri-state, not boolean. sealed/opened/undefined, where undefined means
// "the user hasn't answered" — a real, distinct state, not the same thing
// as "sealed". A boolean can't hold that distinction, and it's the entire
// reason this field is allowed to be optional: the estimate treats an
// unanswered question as sealed and says so in words (see
// PackageStatusHelperLine below), rather than silently asserting an answer
// nobody gave.

import React, { useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Text from '../../components/Text';
import { Eyebrow, HIT_SLOP } from './atoms';
import { makeStyles } from '../../theme/makeStyles';
import { useColors } from '../../theme/ThemeProvider';
import { space } from '../../theme/spacing';
import { type } from '../../theme/typography';

export type PackageStatus = 'sealed' | 'opened';

// Four fixed points, not a free date picker as the primary path — "this
// morning" and "three months ago" are the two ends of the range that
// actually change the estimate meaningfully, and the four chips plus "Pick
// date" cover the rest without turning a one-tap answer into a wheel spin
// by default.
const OPENED_PRESETS: { label: string; daysAgo: number }[] = [
  { label: 'Today', daysAgo: 0 },
  { label: '3 days ago', daysAgo: 3 },
  { label: '1 week ago', daysAgo: 7 },
];

function isoDaysAgo(daysAgo: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

type Props = {
  status: PackageStatus | undefined;
  openedAt: string | null;
  onChangeStatus: (status: PackageStatus | undefined) => void;
  onChangeOpenedAt: (iso: string) => void;
  /** Opens the platform date picker for "Pick date" — past dates only.
   *  Owned by the caller since it needs a modal/native picker this file
   *  doesn't want to take a dependency on directly. Resolves to an ISO
   *  date, or null if the user backed out without picking one. */
  onPickDate: () => Promise<string | null>;
};

export default function PackageStatusField({
  status,
  openedAt,
  onChangeStatus,
  onChangeOpenedAt,
  onPickDate,
}: Props) {
  const styles = useStyles();
  const colors = useColors();
  const [noteOpen, setNoteOpen] = useState(false);

  function pick(next: PackageStatus) {
    // Tapping the already-selected pill clears it back to undefined — the
    // one interaction most likely to be got wrong per the spec this was
    // built against, called out by name. Without it there is no way back
    // to "unanswered" once either pill has been tapped once.
    onChangeStatus(status === next ? undefined : next);
    if (next === 'opened' && status !== 'opened') {
      // Defaults to Today the moment Opened is picked, so the WHEN WAS IT
      // OPENED? row never blocks on its own — same "sane default, nothing
      // new can gate submission" rule the rest of this card follows.
      onChangeOpenedAt(isoDaysAgo(0));
    }
  }

  async function pickDate() {
    const iso = await onPickDate();
    if (iso) onChangeOpenedAt(iso);
  }

  return (
    <View>
      <View style={styles.labelRow}>
        <Eyebrow>Package status</Eyebrow>
        <Text style={styles.optional}>(Optional)</Text>
        <TouchableOpacity
          onPress={() => setNoteOpen((v) => !v)}
          hitSlop={HIT_SLOP}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="What is package status for?"
        >
          <Ionicons name="information-circle-outline" size={16} color={colors.mutedBody} />
        </TouchableOpacity>
      </View>
      {/* Was a static "For packaged foods and condiments" line always
          shown here, plus the ⓘ note below saying the same thing at more
          length — two pieces of chrome for one fact. The short line now
          only appears here when it has something more specific to say
          (the field is unanswered, so the estimate is treating it as
          sealed); its generic version moved into the ⓘ note itself as
          that note's own opening line, since that note already says it
          more fully. */}
      {status === undefined && (
        <Text style={styles.helper}>Package status left blank — estimated as sealed.</Text>
      )}

      {noteOpen && (
        <View style={styles.note}>
          <Text style={styles.noteText}>
            For packaged foods and condiments. Use this for sauces, condiments, milk, juice, canned
            goods, and similar items.
          </Text>
          <Text style={styles.noteText}>
            You can ignore it for fresh foods like chicken, meat, fruit, and vegetables.
          </Text>
        </View>
      )}

      <View style={styles.pillRow}>
        {(['sealed', 'opened'] as const).map((option) => {
          const selected = status === option;
          return (
            <TouchableOpacity
              key={option}
              style={[styles.pill, selected && styles.pillOn]}
              onPress={() => pick(option)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityState={{ selected }}
            >
              <Text style={[styles.pillText, selected && styles.pillTextOn]}>
                {option === 'sealed' ? 'Sealed' : 'Opened'}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {status === 'opened' && (
        <>
          <Eyebrow style={styles.whenLabel}>When was it opened?</Eyebrow>
          {/* One fixed row of four equal chips — flex:1 each, rather than a
              wrapping row that could break unpredictably across widths. The
              same "exact grid, no orphan cell" reasoning MeasureControl's
              own quick-amount rows use. */}
          <View style={styles.whenGrid}>
            {OPENED_PRESETS.map((preset) => {
              const iso = isoDaysAgo(preset.daysAgo);
              const selected = openedAt === iso;
              return (
                <TouchableOpacity
                  key={preset.label}
                  style={[styles.whenChip, selected && styles.whenChipOn]}
                  onPress={() => onChangeOpenedAt(iso)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.whenChipText, selected && styles.whenChipTextOn]} numberOfLines={1}>
                    {preset.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity
              style={[
                styles.whenChip,
                openedAt !== null && !OPENED_PRESETS.some((p) => isoDaysAgo(p.daysAgo) === openedAt) && styles.whenChipOn,
              ]}
              onPress={pickDate}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.whenChipText,
                  openedAt !== null &&
                    !OPENED_PRESETS.some((p) => isoDaysAgo(p.daysAgo) === openedAt) &&
                    styles.whenChipTextOn,
                ]}
                numberOfLines={1}
              >
                Pick date
              </Text>
            </TouchableOpacity>
          </View>
        </>
      )}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  // Same 24px top spacing every section label on this card uses (see
  // ScanReviewScreen's fieldLabelRow/categoryLabel/howManyFull) — Part A4's
  // fix for OPENED? sitting flush against the block above it applies here
  // too, now that this label follows DateField's own panel/chips.
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs2,
    marginTop: space.xxl,
  },
  // Italic, muted — deliberately lighter than a required field's own label,
  // so PACKAGE STATUS reads as skippable at a glance rather than required.
  optional: {
    fontStyle: 'italic',
    fontWeight: '600',
    fontSize: type.micro.fontSize,
    color: colors.mutedBody,
  },
  helper: {
    fontStyle: 'italic',
    fontWeight: '600',
    fontSize: type.caption.fontSize,
    color: colors.mutedBody,
    marginTop: space.xs2,
    marginBottom: space.sm2,
  },
  note: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: space.md2,
    gap: space.xs2,
    marginBottom: space.sm,
  },
  noteText: {
    fontWeight: '600',
    fontSize: type.caption.fontSize,
    lineHeight: 18,
    color: colors.mutedBody,
  },
  pillRow: {
    flexDirection: 'row',
    gap: space.sm2,
    marginTop: space.sm2,
  },
  // Neutral, unfilled by default — matches the spec's own "styling is
  // deliberately lighter than required fields" instruction: this must never
  // read as already-answered on first paint. borderStrong rather than
  // backgroundAlt: in dark mode backgroundAlt sits close enough to
  // `surface`'s own fill that an unselected pill had no visible boundary
  // at all (see the review this was rebuilt against: "unselected pills
  // vanish into the card"). Height matches the quick-amount chips
  // (MeasureControl's own quickPill) so pills read as one family of
  // control across the card rather than two different sizes.
  pill: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  pillOn: {
    backgroundColor: colors.primaryLighter,
    borderColor: colors.primaryLighter,
  },
  pillText: {
    fontWeight: '700',
    fontSize: type.bodySmall.fontSize,
    color: colors.mutedBody,
  },
  pillTextOn: {
    color: colors.primaryDark,
  },
  whenLabel: {
    marginTop: space.md2,
    marginBottom: space.sm2,
  },
  // A single fixed row of four, each flex:1 — never a wrapping approximation,
  // which is exactly the defect Part A2 calls out for the quick-amount grid
  // and would misfire here the same way with four unevenly-long labels.
  whenGrid: {
    flexDirection: 'row',
    gap: space.sm,
  },
  whenChip: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xs,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  whenChipOn: {
    backgroundColor: colors.primaryLighter,
    borderColor: colors.primaryLighter,
  },
  whenChipText: {
    fontWeight: '700',
    fontSize: type.micro.fontSize,
    color: colors.mutedBody,
  },
  whenChipTextOn: {
    fontWeight: '800',
    color: colors.primaryDark,
  },
}));
