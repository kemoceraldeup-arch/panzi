// src/screens/scan/DateField.tsx
//
// USE BY / BEST BEFORE — typing in a use-by date, or saying you don't know
// one, with Panzi filling the gap.
//
// Four resolution paths, and there is no state in which the user is shown a
// dead end (Part C1):
//
//   1. A printed date the scan already read — filled automatically, tagged
//      From label, no prompt. (Handled upstream, before this component ever
//      mounts with an unknown date — see recognition.ts.)
//   2. No printed date detected — "I don't know" preselected, the estimate
//      panel already showing. Never a plain "no date found" dead end.
//   3. The user knows the date — the MM/DD/YYYY field is always tappable
//      regardless of path 1 or 2; typing into it deselects "I don't know".
//   4. The user taps "I don't know" — the field clears and dims (stays
//      visible and tappable) and Panzi estimates from food class, package
//      status and storage location.
//
// Phase 2 changes what path 4 shows without touching 1–3: the panel now
// renders an actual calendar date ("Sep 4") rather than a relative duration
// ("≈ 2 years left"), because Phase 2 explicitly lifts Phase 1's "never a
// fabricated precise date" rule for exactly this one case — a date that is
// clearly labelled PANZI USE-BY ESTIMATE, with an attribution line that
// never lets it be mistaken for something read off a package. See
// services/shelfLife.ts for the pure date-math this panel renders, and
// services/foodClass.ts for the classification/rough-chip machinery this
// file still shares with Phase 1 — rough-date chips are untouched by Phase
// 2 and still write a real, tilde-displayed date rather than an estimate.
//
// The estimate itself never touches the network or runs any inference —
// Rule 2 of the spec this was built against is explicit that the card has
// to paint completely before any classification runs.

import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Text from '../../components/Text';
import { dateInDays } from '../../utils/freshness';
import { formatEstimateHeadline } from '../../utils/dateLabel';
import { DateBasis, EstimateInputs } from '../../services/pantry';
import {
  FoodClass,
  StorageBucket,
  bucketForLocation,
  packageStatusChangeNote,
  roughDateChipsFor,
  roughDateIsPrimary,
  storageChangeNote,
} from '../../services/foodClass';
import { estimateUseBy } from '../../services/shelfLife';
import { Eyebrow, HIT_SLOP } from './atoms';
import { makeStyles } from '../../theme/makeStyles';
import { useColors } from '../../theme/ThemeProvider';
import { space } from '../../theme/spacing';
import { type } from '../../theme/typography';

type Parts = { day: string; month: string; year: string };
type PackageStatusValue = 'sealed' | 'opened' | undefined;

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

export type EstimateResult = { date: string; inputs: EstimateInputs };

type Props = {
  value: string | null;
  /** Fires only with a complete, real date, or with null when cleared. */
  onChange: (iso: string | null) => void;
  /** The USE BY control's own "I don't know" radio — see the type's own
   *  doc comment on ScanCandidate for why this is a separate bit from
   *  `value` being null. */
  unknown: boolean;
  onChangeUnknown: (unknown: boolean) => void;
  /** DateBasis alongside expiryDate/unknown — Phase 2's own finer-grained
   *  provenance (printed/manual/rough/estimated). Fired every time this
   *  component changes what kind of date it's holding, so the caller never
   *  has to re-derive basis from value+unknown by hand. */
  basis: DateBasis;
  onChangeBasis: (basis: DateBasis) => void;
  foodClass: FoodClass;
  packageStatus: 'sealed' | 'opened' | undefined;
  openedAt: string | null;
  /** When the item was added to the pantry — the estimate's reference date
   *  for a sealed (or unanswered) item. Falls back to today when absent
   *  (a candidate that hasn't been saved yet has no addedAt of its own). */
  addedAt: string | null;
  storageLocation: string | null;
  /** The live estimate, whenever unknown is true and it recomputes — the
   *  caller persists {estimatedUseBy, estimateInputs} from this rather than
   *  DateField owning any of that state itself. Fires with null the moment
   *  unknown goes false (a promoted-to-real-date item keeps no estimate
   *  lying around behind it). */
  onEstimate: (result: EstimateResult | null) => void;
};

export default function DateField({
  value,
  onChange,
  unknown,
  onChangeUnknown,
  basis,
  onChangeBasis,
  foodClass,
  packageStatus,
  openedAt,
  addedAt,
  storageLocation,
  onEstimate,
}: Props) {
  const styles = useStyles();
  const colors = useColors();
  const [parts, setParts] = useState<Parts>(() => toParts(value));
  const dayRef = useRef<TextInput>(null);
  const yearRef = useRef<TextInput>(null);
  // Part C6/D6's "never change it silently" rule — a storage move (or a
  // sealed/opened flip that lands in a different window) gets a one-line
  // callout the moment it happens, not just a number that quietly ticked
  // over. previousBucketRef starts at the current bucket so mounting never
  // fires a spurious note for a location the item already had.
  const previousBucketRef = useRef<StorageBucket | null>(null);
  const [changeNote, setChangeNote] = useState<string | null>(null);

  // Adopts a date set from elsewhere — a rough-date chip below, or the
  // ripeness screen overruling the estimate — without fighting the user
  // mid-keystroke.
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
    if (iso) {
      // Typing a real date deselects "I don't know" — path 3 of Part C1.
      // The two states can't both hold at once: a filled, tappable field
      // showing a real date is the opposite claim from "I don't know".
      // Promotes to basis:'manual' even if it started 'estimated' — the
      // spec's own "editing and trust" rule (§7): the user typing a real
      // date is a promotion, and the estimate underneath is dropped, not
      // kept around as a fallback.
      onChangeUnknown(false);
      onChangeBasis('manual');
      onChange(iso);
    } else if (!updated.day && !updated.month && !updated.year) {
      onChange(null);
    }
  }

  const bucket = bucketForLocation(storageLocation);
  const referenceDate = packageStatus === 'opened' && openedAt ? openedAt : addedAt ?? dateInDays(0);

  const estimate = unknown ? estimateUseBy(foodClass, bucket, packageStatus, referenceDate) : null;

  // Reports the live estimate up whenever its inputs actually change the
  // result — not on every render, which would fire onEstimate for parent
  // re-renders that have nothing to do with the date itself.
  const estimateKey = estimate ? `${estimate.date}|${estimate.days}|${estimate.confidence}` : null;
  const lastEstimateKeyRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (estimateKey === lastEstimateKeyRef.current) return;
    lastEstimateKeyRef.current = estimateKey;
    if (!estimate) {
      onEstimate(null);
      return;
    }
    onEstimate({
      date: estimate.date,
      inputs: {
        foodClass,
        storedIn: bucket,
        packageStatus,
        from: referenceDate,
        days: estimate.days,
        confidence: estimate.confidence,
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estimateKey]);

  // Two separate effects, one per thing that can trigger the "don't change
  // it silently" note — a STORE IN move and a Sealed<->Opened flip both
  // recompute the same estimate window, but they're independent user
  // actions and each gets its own before/after comparison rather than one
  // effect trying to infer which of two things just changed. Both still use
  // Phase 1's relative-duration comparison (foodClass.ts) purely to decide
  // *whether* the change is big enough to mention — the panel itself now
  // shows a date, but ">50% window change" is still the right threshold for
  // "is this worth a callout", and re-deriving that from two calendar dates
  // would just reimplement the same math with extra steps.
  useEffect(() => {
    const previous = previousBucketRef.current;
    previousBucketRef.current = bucket;
    if (previous === null || previous === bucket) return;
    const est = estimateUseBy(foodClass, bucket, packageStatus, referenceDate);
    setChangeNote(
      storageChangeNoteWithDate(previous, bucket, foodClass, packageStatus, est.date, unknown)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bucket]);

  const previousStatusRef = useRef<PackageStatusValue>(packageStatus);
  useEffect(() => {
    const previous = previousStatusRef.current;
    previousStatusRef.current = packageStatus;
    if (previous === packageStatus) return;
    setChangeNote(packageStatusChangeNote(previous, packageStatus, foodClass, bucket));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packageStatus]);

  const roughChips = roughDateChipsFor(foodClass, packageStatus);
  const chipsArePrimary = roughDateIsPrimary(foodClass);

  const activeChip = roughChips?.find((c) => value && value === dateInDays(c.days));

  function selectUnknown() {
    onChangeUnknown(true);
    onChangeBasis('estimated');
    onChange(null);
  }

  function pickRoughDate(days: number) {
    onChangeUnknown(false);
    onChangeBasis('rough');
    onChange(dateInDays(days));
  }

  const roughChipsRow = roughChips && (
    <View style={styles.presets}>
      {roughChips.map((chip) => {
        const selected = activeChip?.label === chip.label;
        return (
          <TouchableOpacity
            key={chip.label}
            style={[styles.preset, selected && styles.presetOn]}
            onPress={() => (selected ? selectUnknown() : pickRoughDate(chip.days))}
            activeOpacity={0.7}
          >
            <Text style={[styles.presetText, selected && styles.presetTextOn]}>{chip.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  const headline = estimate ? formatEstimateHeadline(estimate.date) : '';

  // Line 2 is contextual and picked by priority — unsafe storage first
  // (the one that matters for food safety), then a recalculation notice
  // (something just changed and the user should know why the date moved),
  // then the low-confidence note. At most one shows: "never more than two
  // lines under the date" per the spec this was rebuilt against. The
  // blank-package-status note used to live here too, but it forward-
  // referenced a control (PACKAGE STATUS) that only appears below this
  // panel — it now lives there instead, as that field's own helper line
  // (see PackageStatusField.tsx), where "left blank" reads next to the
  // thing that's actually blank.
  const secondLine =
    estimate?.unsafeStorageWarning ??
    changeNote ??
    (estimate?.confidence === 'low' ? 'Check it before using.' : null);

  return (
    <View>
      {/* No "Use by <date>" readout of its own here any more — every
          caller of this component already renders a DateChip directly
          above it (see ScanReviewScreen/EditItemSheet), and that chip
          says the same date plus its provenance ("SEP 29 · YOU SET
          THIS") in one line. A second, plainer restatement of the same
          fact right underneath it was pure duplication, not a different
          view of it. */}

      {/* meat-fish puts the rough-date row above the field, as the primary
          affordance — Part C5's own callout. Every other class with chips
          keeps them below, secondary to typing a real date. */}
      {chipsArePrimary && roughChipsRow}

      {/* The field owns the full width and stays tappable and visible even
          while "I don't know" is selected (path 4) — dimmed, not hidden or
          disabled, so tapping into it and typing a real date is still one
          tap away rather than a dead end. */}
      <View style={[styles.field, unknown && styles.fieldDimmed]}>
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

      {/* Radio-style, directly under the field — an empty ring flips to an
          accent-filled one, never a warning colour: this is a legitimate
          answer, not an error state. Body face, normal weight, not
          uppercase, so it doesn't read as another section label. */}
      <TouchableOpacity
        style={styles.unknownRow}
        onPress={() => (unknown ? onChangeUnknown(false) : selectUnknown())}
        activeOpacity={0.7}
        accessibilityRole="radio"
        accessibilityState={{ checked: unknown }}
      >
        <Ionicons
          name={unknown ? 'radio-button-on' : 'radio-button-off'}
          size={20}
          color={unknown ? colors.primaryDark : colors.chevron}
        />
        <Text style={styles.unknownText}>I don&apos;t know</Text>
      </TouchableOpacity>

      {/* PANZI USE-BY ESTIMATE — only while "I don't know" is selected.
          Raised surface, accent-tinted left rule (the one accent element
          this card keeps — see the review this was rebuilt against: "at
          most two accent-weight elements visible per screenful"), a leaf
          glyph inline before the label rather than a second ESTIMATE badge
          repeating what the label already says. The date itself is real
          and precise — Phase 2 lifts Phase 1's "never a calendar date" rule
          for exactly this labelled, attributed case — computed
          synchronously from services/shelfLife.ts, never a network round
          trip, so the panel never has to show a spinner. Two lines under
          the date, never three: the mandatory attribution, then at most
          one contextual line picked by priority (see secondLine above). */}
      {unknown && (
        <View style={styles.estimatePanel}>
          <View style={styles.estimateTitleRow}>
            <Ionicons name="leaf-outline" size={12} color={colors.primaryMid} />
            <Text style={styles.estimateTitle}>PANZI USE-BY ESTIMATE</Text>
          </View>
          <Text style={styles.estimateHeadline}>{headline}</Text>
          <Text style={styles.estimateBody}>Based on the food type and storage method.</Text>
          {secondLine && (
            <Text
              style={
                estimate?.unsafeStorageWarning === secondLine
                  ? styles.estimateWarning
                  : styles.estimateFootnote
              }
            >
              {secondLine}
            </Text>
          )}
        </View>
      )}

      {!chipsArePrimary && roughChips && (
        <>
          <Eyebrow style={styles.roughLabel}>Or pick a rough date</Eyebrow>
          {roughChipsRow}
        </>
      )}
    </View>
  );
}

/** storageChangeNote's own >50%-window comparison, phrased with the new
 *  calendar-date panel's own words ("Moved to the freezer — now Dec 2.")
 *  instead of Phase 1's relative duration. Only renders the line while the
 *  panel that would show it is actually visible (unknown === true) — a
 *  storage move on an item that has since been given a real date has
 *  nothing left to announce. */
function storageChangeNoteWithDate(
  previousBucket: StorageBucket,
  nextBucket: StorageBucket,
  foodClass: FoodClass,
  packageStatus: PackageStatusValue,
  nextDate: string,
  unknown: boolean
): string | null {
  if (!unknown) return null;
  // Reuses foodClass.ts's own >50% threshold to decide *whether* to speak
  // up — see this file's top-of-effect comment for why that's still right
  // even though the panel itself now shows a date rather than a duration.
  const magnitudeNote = storageChangeNote(previousBucket, nextBucket, foodClass, packageStatus);
  if (!magnitudeNote) return null;
  const label = nextBucket === 'freezer' ? 'the freezer' : nextBucket === 'fridge' ? 'the fridge' : 'the cabinet';
  return `Moved to ${label} — now ${formatEstimateHeadline(nextDate)}.`;
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
  // Cleared and dimmed while "I don't know" is selected (path 4) — stays
  // fully visible and tappable, never hidden or disabled, since tapping
  // back into it is the one way back to path 3.
  fieldDimmed: {
    opacity: 0.5,
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
  unknownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 44,
    marginTop: space.sm,
  },
  unknownText: {
    fontWeight: '600',
    fontSize: type.body.fontSize,
    color: colors.textSecondary,
  },
  // Raised one step from the field's own surface — see the theme mapping
  // this was built against ("card surface one step raised from the field
  // surface"). No accent rule on this panel any more — the raised surface
  // alone is enough to set it apart, and the leaf glyph on the label
  // already marks it as an estimate without adding a second accent-weight
  // element next to it.
  estimatePanel: {
    marginTop: space.sm,
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: space.md2,
    gap: space.xs2,
  },
  // Just the leaf and the label, left-aligned — was space-between to make
  // room for a second ESTIMATE badge on the right, which said the same
  // thing the label already does. One marker now, inline before the text
  // it belongs to.
  estimateTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs2,
  },
  estimateTitle: {
    fontWeight: '800',
    fontSize: type.micro.fontSize,
    letterSpacing: 0.6,
    color: colors.mutedBody,
  },
  // The date is the brightest text on this card in dark mode — see the
  // review this was rebuilt against: "the item name should be the
  // brightest element on the card, the estimate date second." primaryDark
  // (not primaryDarker, which is closer to white on dark charcoal) keeps
  // the date legibly the second-brightest thing here, under the item name
  // above it.
  estimateHeadline: {
    fontWeight: '800',
    fontSize: type.bodyLarge.fontSize,
    color: colors.primaryDark,
  },
  // mutedBody, not textSecondary — this file's own body copy is exactly
  // the case the dark-mode-specific token exists for (see palettes.ts):
  // small, sometimes italic runs on a raised card that need more lift in
  // dark mode than the general-purpose secondary-text colour gives them.
  estimateBody: {
    fontWeight: '600',
    fontSize: type.caption.fontSize,
    lineHeight: 17,
    color: colors.mutedBody,
  },
  estimateWarning: {
    fontWeight: '700',
    fontSize: type.caption.fontSize,
    color: colors.accent,
    marginTop: space.xs2,
  },
  estimateFootnote: {
    fontStyle: 'italic',
    fontWeight: '600',
    fontSize: type.micro.fontSize,
    color: colors.mutedBody,
    marginTop: space.xs2,
  },
  roughLabel: {
    marginTop: space.md,
    marginBottom: space.sm,
  },
  presets: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
    marginTop: space.sm,
  },
  // minHeight 44 (was 40) and borderStrong (was backgroundAlt), matching
  // every other unselected pill on this card — see PackageStatusField's
  // own pill/whenChip for the same fix and the same reasoning.
  preset: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: space.md,
    borderRadius: 999,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  presetOn: {
    backgroundColor: colors.primaryLighter,
    borderColor: colors.primaryLighter,
  },
  presetText: {
    fontWeight: '700',
    fontSize: type.caption.fontSize,
    color: colors.mutedBody,
  },
  presetTextOn: {
    fontWeight: '800',
    color: colors.primaryDark,
  },
}));
