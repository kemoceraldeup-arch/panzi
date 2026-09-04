// src/screens/scan/atoms.tsx
//
// The small pieces five scan screens all draw, kept in one file so they can't
// drift apart.
//
// The provenance chip is the important one. It appears on the review page, the
// edit card, the freshness screen and the pantry landing, and its whole job is
// that a printed date and a guess never look alike. If each screen drew its own
// version, one of them would eventually give an estimate a solid green pill and
// quietly turn a guess into a fact.

import React, { useState } from 'react';
import { Image, StyleSheet, TextInput, TouchableOpacity, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Text from '../../components/Text';
import { ChipTone, ProvenanceChip, ScanBox } from '../../services/scan';
import {
  DisplayUnit,
  ItemQuantity,
  Measure,
  MEASURE_EXAMPLES,
  MEASURE_LABELS,
  MEASURES,
  VOLUME_UNITS_LIST,
  WEIGHT_UNITS_LIST,
  defaultQuantity,
  displayAmount,
  displayUnitFor,
  formatAmount,
  maxFor,
  minFor,
  presetUnit,
  quickAmounts,
  step,
  summaryLine,
  toBaseAmount,
} from '../../services/quantity';
import { makeStyles } from '../../theme/makeStyles';
import { Palette } from '../../theme/palettes';
import { useColors } from '../../theme/ThemeProvider';
import { space } from '../../theme/spacing';
import { type } from '../../theme/typography';

/** The capture a crop is taken from. Pixel dimensions are needed to crop
 *  without distorting — the box is in fractions of each axis separately. */
export type Capture = { uri: string; width: number; height: number };

/** All-caps section label — "NEEDS A LOOK · 2", "LOOKS RIGHT · 4". */
export function Eyebrow({
  children,
  tone = 'muted',
  style,
}: {
  children: React.ReactNode;
  tone?: 'muted' | 'warning' | 'good';
  style?: ViewStyle;
}) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={style}>
      <Text
        style={[
          styles.eyebrow,
          tone === 'warning' && { color: colors.rust },
          tone === 'good' && { color: colors.primaryDark },
        ]}
      >
        {children}
      </Text>
    </View>
  );
}

// Built per palette rather than declared once. As a plain record these were
// evaluated at import and would have kept their light-mode fills forever.
const chipFill = (colors: Palette): Record<ChipTone, ViewStyle> => ({
  // The filled tones carry a transparent border of the same width as the
  // dashed ones. Without it the border on `estimated` and `missing` ate a point
  // of padding on each side, so the two kinds of chip were different sizes
  // around the same length of text — and the bordered ones, which are the ones
  // whose text nearly touches an edge you can see, were the tighter pair.
  label: { backgroundColor: colors.primaryLighter, borderWidth: 1, borderColor: 'transparent' },
  urgent: { backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: 'transparent' },
  // Dashed, always. The border is the signal — a cream fill alone would read as
  // a quieter fact rather than a different kind of claim.
  estimated: {
    backgroundColor: colors.creamCard,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.tan,
  },
  missing: {
    backgroundColor: colors.creamCard,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.tan,
  },
});

const chipInk = (colors: Palette): Record<ChipTone, string> => ({
  label: colors.primaryDark,
  urgent: colors.rust,
  estimated: colors.textSecondary,
  missing: colors.textSecondary,
});

export function DateChip({ chip }: { chip: ProvenanceChip }) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={[styles.chip, chipFill(colors)[chip.tone]]}>
      <Text style={[styles.chipText, { color: chipInk(colors)[chip.tone] }]} numberOfLines={1}>
        {chip.text}
      </Text>
    </View>
  );
}

/** A plain-words chip naming what the scanner couldn't settle. */
export function AttentionChip({ children }: { children: React.ReactNode }) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={styles.attentionChip}>
      <Text style={styles.attentionChipText}>{children}</Text>
    </View>
  );
}

/**
 * An item's own square of the photo.
 *
 * The model already says where each item sits in the frame, as fractions of the
 * capture's width and height, and that rectangle is what drew the detection
 * boxes during the read. Reusing it here is what turns every card's thumbnail
 * from a coloured tile into the actual thing on the shelf — so a row saying
 * "Cheddar?" can be checked against the packet without reopening the photo.
 *
 * The crop is square and undistorted: it takes the longer side of the box in
 * *pixels*, centres on the box, and scales the whole image so that square fills
 * the tile. Scaling each axis to its own fraction would be simpler and would
 * stretch every non-square item into a smear.
 *
 * Falls back to a plain tile whenever there is nothing to crop — no photo, no
 * box, or a capture whose dimensions we never recorded (a scan reopened from
 * history, which stores the file URI but not its size).
 */
export function ItemThumb({
  size = 34,
  tone = 'good',
  photo,
  box,
  /** This item's own picture, which wins over any crop. */
  ownPhotoUri,
  /** When given, the tile becomes a button for adding or replacing a picture. */
  onPressAdd,
  /** Renders nothing at all rather than a plain empty tile when there is no
   *  photo and no onPressAdd — for a row that will never have one (typed in
   *  by hand), not for a loading skeleton, which wants the space held. */
  hideIfEmpty,
}: {
  size?: number;
  tone?: 'good' | 'warn' | 'neutral';
  photo?: Capture | null;
  box?: ScanBox | null;
  ownPhotoUri?: string | null;
  onPressAdd?: () => void;
  hideIfEmpty?: boolean;
}) {
  const styles = useStyles();
  const colors = useColors();
  const fill =
    tone === 'warn'
      ? colors.accentSoft
      : tone === 'neutral'
        ? colors.background
        : colors.primaryLighter;

  const tile: ViewStyle = {
    width: size,
    height: size,
    borderRadius: size * 0.32,
    backgroundColor: fill,
    flexShrink: 0,
    overflow: 'hidden',
  };

  // An item's own picture is already framed square by the picker, so it just
  // fills the tile.
  if (ownPhotoUri) {
    const image = <Image source={{ uri: ownPhotoUri }} style={StyleSheet.absoluteFill} />;
    return onPressAdd ? (
      <TouchableOpacity style={tile} onPress={onPressAdd} activeOpacity={0.8}>
        {image}
      </TouchableOpacity>
    ) : (
      <View style={tile}>{image}</View>
    );
  }

  if (!photo?.uri || !photo.width || !photo.height || !box) {
    // Nothing to show. When a picture can be added, say so rather than leaving
    // a blank square the user has no reason to touch.
    if (onPressAdd) {
      return (
        <TouchableOpacity
          style={[tile, styles.addPhotoTile, { borderRadius: size * 0.32 }]}
          onPress={onPressAdd}
          activeOpacity={0.7}
          accessibilityLabel="Add a picture of this item"
        >
          <Text style={styles.addPhotoPlus}>+</Text>
          {size >= 48 && <Text style={styles.addPhotoLabel}>Photo</Text>}
        </TouchableOpacity>
      );
    }
    // Two different kinds of "nothing to show": a loading skeleton wants the
    // tile-shaped hole kept (it's standing in for a crop that hasn't arrived
    // yet), but a row that will never have a photo — typed in by hand — reads
    // better with nothing there at all than an empty, unexplained square.
    if (hideIfEmpty) return null;
    return <View style={tile} />;
  }

  const side = Math.max(box.width * photo.width, box.height * photo.height);
  // A little air around the item — a box cropped exactly to its own edges reads
  // as a fragment rather than a picture of a thing.
  const scale = size / (side * 1.25);
  const centreX = (box.x + box.width / 2) * photo.width;
  const centreY = (box.y + box.height / 2) * photo.height;

  const crop = (
    <Image
      source={{ uri: photo.uri }}
      style={{
        position: 'absolute',
        width: photo.width * scale,
        height: photo.height * scale,
        left: size / 2 - centreX * scale,
        top: size / 2 - centreY * scale,
      }}
    />
  );

  // Tappable wherever a picture can be set, so the tile behaves the same on
  // every card whether it currently holds a crop, an own photo or nothing.
  return onPressAdd ? (
    <TouchableOpacity
      style={tile}
      onPress={onPressAdd}
      activeOpacity={0.8}
      accessibilityLabel="Replace the picture of this item"
    >
      {crop}
    </TouchableOpacity>
  ) : (
    <View style={tile}>{crop}</View>
  );
}

export const HIT_SLOP = { top: 10, bottom: 10, left: 10, right: 10 };

/** Splits an array into fixed-size rows — [1,2,3,4,5,6] at 3 becomes
 *  [[1,2,3],[4,5,6]]. Used to lay the quick-amount grid out as real rows of
 *  three rather than approximating a grid with wrapping percentage widths. */
function chunk<T>(items: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
}

// No real amount needs more than this many digits before the decimal point
// — maxFor's largest ceiling is 500,000 (500 kg/L in base units), six
// digits — so seven is already generous headroom, not a tight limit someone
// typing a normal amount would ever brush against. What it does stop is a
// runaway string of digits (from a stuck key, a paste, or a duplicated
// onChangeText firing) turning into something Number() renders as
// scientific notation once it's simply too long to be a real quantity.
const MAX_AMOUNT_DIGITS = 7;

/**
 * Keeps what a person can actually type in this field to something that
 * could plausibly be a real amount — digits and at most one decimal point,
 * capped in length — filtered on every keystroke rather than only at
 * commit. Committing alone was not enough: Number() on an unbounded string
 * of digits happily returns a valid, finite number in the 1e+36 range, which
 * then sails straight through commitTyped's floor/ceiling clamp (that clamp
 * bounds the *value*, not how many digits produced it) and back out through
 * displayAmount as "9.666164664646464e+36 kg" — a real bug this app hit.
 * Filtering the keystrokes themselves is what stops the string from ever
 * reaching that size in the first place.
 */
function sanitizeDecimalInput(text: string): string {
  // Only one decimal point survives — a second one is dropped rather than
  // rejected outright, so "1.2.3" typed quickly becomes "1.23" instead of
  // silently refusing every keystroke after the first period.
  const firstDot = text.indexOf('.');
  const withoutExtraDots =
    firstDot === -1
      ? text.replace(/[^0-9]/g, '')
      : text.slice(0, firstDot + 1).replace(/[^0-9]/g, '') +
        '.' +
        text.slice(firstDot + 1).replace(/[^0-9]/g, '');
  return withoutExtraDots.slice(0, MAX_AMOUNT_DIGITS + 1); // +1 allows for the decimal point itself.
}

/**
 * The "How many" control — the measure pill and its panel, amount-with-unit
 * input, and the secondary quick-amount grid and summary line beneath it.
 *
 * One component for both places quantity is edited (the scan review card and
 * EditItemSheet) so the four measures behave identically wherever they show
 * up. `unit` is the item's own unit noun for pieces/pack ("egg", "loaf",
 * "bag") — pass '' when there isn't one and the control falls back to a bare
 * count / "pack".
 *
 * The measure pill sits on the label row itself, right-aligned — see
 * ScanReviewScreen's HOW MANY label and MeasureControl's own
 * howManyLabelRow below. Tapping it opens a 2x2 panel in normal flow
 * directly beneath: the four measures side by side, each with a two-word
 * example, rather than a nested two-level menu.
 */
export function MeasureControl({
  quantity,
  unit,
  onChange,
  onPickMeasure,
  onFocusInput,
}: {
  quantity: ItemQuantity;
  unit: string;
  onChange: (next: ItemQuantity) => void;
  /** Fired only when the user picks a *different* measure from the panel —
   *  never on an ordinary amount step or type-in. Separate from onChange so
   *  a caller that remembers this choice per product (see
   *  services/quantity.ts's saveMeasurePref) only writes on an actual
   *  correction, not on every tap of the stepper. Optional: EditItemSheet
   *  has nowhere to persist a per-product memory from a plain string draft,
   *  so it only wires onChange. */
  onPickMeasure?: (next: ItemQuantity) => void;
  /** Fired the moment the amount field gains focus, before the keyboard has
   *  finished animating in — the caller's job is to scroll this control
   *  into view above it. Optional: a screen with nothing to scroll (this
   *  control already fills it) can leave it out. */
  onFocusInput?: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const [typePanelOpen, setTypePanelOpen] = useState(false);
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState('');

  const isSplit = quantity.measure === 'weight' || quantity.measure === 'volume';
  const unitList = quantity.measure === 'weight' ? WEIGHT_UNITS_LIST : VOLUME_UNITS_LIST;
  const currentUnit = isSplit ? displayUnitFor(quantity) : null;

  /** Selecting a measure from the panel: closes the panel, sets the measure,
   *  and resets amount to that measure's own default (pieces 1 · pack 1 ·
   *  weight 500 g · volume 500 mL) — never carries the old measure's amount
   *  across, since "500" meant something different as grams a moment ago. */
  function pickMeasure(measure: Measure) {
    setTypePanelOpen(false);
    if (measure === quantity.measure) return;
    const nextQuantity = defaultQuantity(measure);
    onChange(nextQuantity);
    onPickMeasure?.(nextQuantity);
    // A field mid-edit when the measure changes underneath it must not keep
    // showing what was typed for the old measure — draft was seeded from
    // the old quantity's own formatting (e.g. "1 piece" for pieces), and
    // left in place it renders that exact wrong string next to a brand new
    // measure it no longer describes at all. Closing the field is simpler
    // and safer than trying to re-seed a draft for a value that just reset.
    setTyping(false);
  }

  function pickUnit(nextUnit: DisplayUnit) {
    if (nextUnit === currentUnit) return;
    // Switching kg<->g or L<->mL never touches the stored base-unit amount —
    // only which unit the same underlying grams/millilitres are read through.
    onChange({ ...quantity, displayUnit: nextUnit });
  }

  function nudge(direction: 1 | -1) {
    onChange(step(quantity, direction));
  }

  /**
   * Turns whatever the person typed into the stored base-unit amount.
   *
   * The critical line is the last one: a weight/volume value is typed in the
   * unit currently on screen — "4.5" while the field reads "L" — and must be
   * converted through toBaseAmount before it overwrites `amount`, or 4.5
   * would be written in as 4.5 millilitres instead of 4500. This is the
   * fix for the bug where editing "4.5 L" silently exposed "4500": the old
   * code wrote whatever was typed straight into the base-unit `amount` with
   * no conversion in either direction.
   */
  function commitTyped(text: string) {
    const n = Number(sanitizeDecimalInput(text));
    setTyping(false);
    // Number('') is 0, and a blank or all-punctuation field ("", ".", "-")
    // must not silently commit as a valid amount — it just cancels back to
    // whatever the field already held.
    if (!Number.isFinite(n) || n <= 0) return;
    const floor = minFor(quantity.measure, quantity.splittable);
    const ceiling = maxFor(quantity.measure);
    if (!isSplit) {
      onChange({ ...quantity, amount: Math.min(ceiling, Math.max(floor, n)) });
      return;
    }
    const baseAmount = toBaseAmount(n, currentUnit!);
    onChange({ ...quantity, amount: Math.min(ceiling, Math.max(floor, baseAmount)) });
  }

  // What the field shows while NOT being edited — formatAmount's full,
  // friendly label ("4.5 L", "1 piece", "1¼ bags") is exactly right here,
  // unit noun and all.
  const displayText = formatAmount(quantity, unit);

  // What actually goes in the field the moment it becomes editable — a bare
  // number a decimal-pad can type into, never displayText above. Two
  // different bugs came from skipping this split: seeding the draft from
  // formatAmount's pieces/pack output put non-numeric text ("1 piece", a
  // fraction glyph like "1¼") into a field a decimal-pad cannot type and
  // sanitizeDecimalInput immediately strips down to nothing usable, and
  // reusing that same formatted string for weight/volume repeated the unit
  // twice — once inside the string ("4.5 L") and again in its own separate
  // pill beside it.
  const editableAmount = isSplit
    ? trimTrailingZeros(displayAmount(quantity))
    : trimTrailingZeros(quantity.amount);

  return (
    <View>
      {/* HOW MANY label row: the label on the left, the measure pill on the
          right — baseline-aligned so the pill's own line-height doesn't
          drag the row taller than the label needs, and space-between so the
          pill can never be pushed into the label at any label length (the
          bug this replaced: the two used to share a narrower row and
          overlapped). Full card width, so nothing downstream of this row
          has to fit beside it either. */}
      <View style={styles.howManyLabelRow}>
        <Eyebrow>How many</Eyebrow>
        <TouchableOpacity
          style={styles.measurePill}
          onPress={() => setTypePanelOpen((v) => !v)}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={`Measure: ${MEASURE_LABELS[quantity.measure]}`}
        >
          <Text style={styles.measurePillText}>{MEASURE_LABELS[quantity.measure].toUpperCase()}</Text>
          <Ionicons
            name={typePanelOpen ? 'chevron-up' : 'chevron-down'}
            size={12}
            color={colors.mutedBody}
          />
        </TouchableOpacity>
      </View>

      {/* The panel opens in normal flow — the card grows to fit it, nothing
          overlays or clips. 2x2 grid of the four measures, each with its
          own two-word example, so picking one is a single tap from
          anywhere the pill can be reached. */}
      {typePanelOpen && (
        <View style={styles.measurePanel}>
          {MEASURES.map((measure) => {
            const selected = measure === quantity.measure;
            return (
              <TouchableOpacity
                key={measure}
                style={[styles.measureOption, selected && styles.measureOptionOn]}
                onPress={() => pickMeasure(measure)}
                activeOpacity={0.7}
              >
                <Text style={styles.measureOptionName}>{MEASURE_LABELS[measure]}</Text>
                <Text style={[styles.measureOptionExample, selected && styles.measureOptionExampleOn]}>
                  {MEASURE_EXAMPLES[measure]}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {/* − [ amount ] [ unit ▾ ] + — the unit sits directly beside the
          number it belongs to, inside the same visual row, rather than
          announced separately above or below it. For pieces/pack there is
          no second unit to choose (a "piece" is not sold in two sizes), so
          the unit pill is simply absent and the value fills that space. */}
      <View style={styles.stepper}>
        {/* − steps off while typing — nudging a value mid-edit, with a
            keyboard already open and a draft string not yet committed,
            would fight the person's own keystrokes rather than help them. */}
        {!typing && (
          <TouchableOpacity
            style={styles.stepDown}
            onPress={() => nudge(-1)}
            hitSlop={HIT_SLOP}
            activeOpacity={0.7}
            accessibilityLabel="Less"
          >
            <Text style={styles.stepDownText}>−</Text>
          </TouchableOpacity>
        )}
        {typing ? (
          <TextInput
            style={styles.stepValue}
            value={draft}
            onChangeText={(text) => setDraft(sanitizeDecimalInput(text))}
            onFocus={onFocusInput}
            onBlur={() => commitTyped(draft)}
            keyboardType="decimal-pad"
            maxLength={MAX_AMOUNT_DIGITS + 1}
            selectTextOnFocus
            autoFocus
            selectionColor={colors.primaryDark}
            accessibilityLabel="How much do you have"
            // Explicit, not just relying on the iOS default: this row is
            // already tight with the unit pill and Done button beside it,
            // and a native clear-button glyph competing for that same
            // right edge is one more thing crowding a row three controls
            // deep already.
            clearButtonMode="never"
            // No returnKeyType/onSubmitEditing here on purpose. decimal-pad
            // has no return key of its own, and setting returnKeyType is
            // exactly what makes iOS synthesize its own floating grey
            // "Done" pill above the keyboard to carry it — a second,
            // unstyled "Done" competing with the one already in this row
            // (see doneButton below). Leaving the prop off leaves iOS
            // nothing to render a bar for.
          />
        ) : (
          <TouchableOpacity
            style={styles.stepValueWrap}
            onPress={() => {
              // Seeded from editableAmount — a bare number — never from
              // displayText's formatted label ("1 piece", "4.5 L") and
              // never from quantity.amount's raw base-unit figure. See
              // editableAmount's own doc comment above and commitTyped's
              // below for the two bugs this split fixes.
              setDraft(String(editableAmount));
              setTyping(true);
              onFocusInput?.();
            }}
            activeOpacity={0.7}
          >
            <Text style={styles.stepValueText}>{displayText}</Text>
          </TouchableOpacity>
        )}
        {/* Stays visible while typing, unlike − and + — with those two
            hidden there is room for it, and hiding it left a typed amount
            with no unit in sight at all: someone typing "500" had no way to
            tell, or change, whether that meant 500 mL or 500 L. */}
        {isSplit && (
          <UnitPicker
            unit={currentUnit!}
            options={unitList}
            onPick={pickUnit}
          />
        )}
        {typing ? (
          // A plain in-row "Done" rather than an InputAccessoryView: that
          // native iOS keyboard-toolbar component turned out unreliable
          // inside Expo Go specifically (present in a bare dev build,
          // silently absent in Expo Go — the environment this was actually
          // tested in), which left typing with no visible way to confirm at
          // all. This has no such platform dependency — it is a normal
          // button that works identically everywhere the rest of this
          // control does. − and + stepping aside while typing (see above)
          // is what leaves room for this without the row growing a fifth
          // slot alongside the unit pill, which stays put.
          <TouchableOpacity
            style={styles.doneButton}
            onPress={() => commitTyped(draft)}
            hitSlop={HIT_SLOP}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Done"
          >
            <Text style={styles.doneButtonText}>Done</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.stepUp}
            onPress={() => nudge(1)}
            hitSlop={HIT_SLOP}
            activeOpacity={0.7}
            accessibilityLabel="More"
          >
            <Text style={styles.stepUpText}>+</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Secondary to the input above it — smaller pills, no label of their
          own — so the row people actually type into reads as the primary
          control and this reads as a shortcut for it, not a second
          competing input. Deleted the "Quick amounts" caption that used to
          sit here: it was the one label on this card in sentence case
          rather than the uppercase+tracked eyebrow style, and the chips
          are self-evident sitting directly under the stepper without one. */}
      <View style={[styles.quickGrid, styles.quickGridSpacing]}>
        {/* Built as exact rows of three rather than a wrapping flex row with
            percentage widths — RN has no CSS grid, and a wrap-based
            approximation is exactly what let the pieces/pack sets (six
            entries) render as three rows of two with dead space instead of
            two rows of three. Each row is its own flex row of three equal
            flex:1 pills, so every column is always the same width and the
            last pill in a row never stretches to fill it alone. */}
        {chunk(quickAmounts(quantity.measure, unit), 3).map((row, i) => (
          <View key={i} style={styles.quickRow}>
            {row.map((preset) => {
              const selected = preset.amount === quantity.amount;
              return (
                <TouchableOpacity
                  key={preset.amount}
                  style={[styles.quickPill, selected && styles.quickPillOn]}
                  onPress={() => {
                    // A preset names its own unit ("1.5 kg") — picking it
                    // must leave the field reading that same unit, not
                    // whatever displayUnit happened to be showing before
                    // (see requirement: tapping "1.5 kg" shows [1.5][kg],
                    // never [1500] under a stale "g" label).
                    const nextUnit = presetUnit(quantity.measure, preset.amount);
                    onChange({
                      ...quantity,
                      amount: preset.amount,
                      ...(nextUnit ? { displayUnit: nextUnit } : {}),
                    });
                  }}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[styles.quickPillText, selected && styles.quickPillTextOn]}
                    numberOfLines={1}
                  >
                    {preset.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ))}
      </View>

      {quantity.measure === 'pieces' && quantity.splittable && (
        <TouchableOpacity
          style={styles.halfPill}
          onPress={() => onChange({ ...quantity, amount: quantity.amount + 0.5 })}
          activeOpacity={0.7}
        >
          <Text style={styles.halfPillText}>
            + half a {unit || 'piece'}
          </Text>
        </TouchableOpacity>
      )}

      <Text style={styles.summaryLine}>{summaryLine(quantity, unit)}</Text>
    </View>
  );
}

/** At most two decimals, no trailing zeros, no unit suffix — "1.5", never
 *  "1.50" or "1.5 kg". Mirrors quantity.ts's own private trimDecimals; kept
 *  as a separate copy here because that one is not exported and this file's
 *  one call site needs a bare number beside its own separate unit pill. */
function trimTrailingZeros(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/** The small unit toggle beside the amount — "L ▾" / "kg ▾" — that expands
 *  into the other unit for this quantity type. Always exactly two options
 *  (g/kg, mL/L), so this opens as a simple two-row drop rather than
 *  reusing the type picker's wider panel styling. */
function UnitPicker({
  unit,
  options,
  onPick,
}: {
  unit: DisplayUnit;
  options: DisplayUnit[];
  onPick: (unit: DisplayUnit) => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const [open, setOpen] = useState(false);

  return (
    <View style={styles.unitPickerWrap}>
      <TouchableOpacity
        style={styles.unitPill}
        onPress={() => setOpen((v) => !v)}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={`Unit: ${unit}`}
      >
        <Text style={styles.unitPillText}>{unit}</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={11} color={colors.primaryDark} />
      </TouchableOpacity>
      {open && (
        <View style={styles.unitDropdown}>
          {options.map((option) => (
            <TouchableOpacity
              key={option}
              style={[styles.unitOption, option === unit && styles.unitOptionOn]}
              onPress={() => {
                setOpen(false);
                onPick(option);
              }}
              activeOpacity={0.7}
            >
              <Text style={[styles.unitOptionText, option === unit && styles.unitOptionTextOn]}>
                {option}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

/** One macro figure — "312" over "Calories", or "18g" over "Protein". Used
 *  by both the scan review card and the pantry edit sheet, so the two never
 *  drift into showing the same numbers with a different look. */
export function MacroPill({
  label,
  value,
  unit,
}: {
  label: string;
  value: number;
  unit?: string;
}) {
  const styles = useStyles();
  return (
    <View style={styles.macroPill}>
      <Text style={styles.macroValue}>
        {value}
        {unit ?? ''}
      </Text>
      <Text style={styles.macroLabel}>{label}</Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  eyebrow: {
    fontWeight: '800',
    fontSize: type.micro.fontSize,
    lineHeight: 13,
    letterSpacing: 1.54,
    textTransform: 'uppercase',
    color: colors.tabInactive,
  },
  chip: {
    alignSelf: 'flex-start',
    paddingVertical: space.xs2,
    // Wider than it is tall, because the text inside is uppercase and tracked:
    // capitals have no descenders to fill the vertical space and the tracking
    // pushes the last letter towards the edge, so even padding reads as tight
    // at the sides and loose above.
    paddingHorizontal: space.sm2,
    borderRadius: 8,
  },
  chipText: {
    fontWeight: '800',
    fontSize: type.micro.fontSize,
    lineHeight: 14,
    textTransform: 'uppercase',
    // Uppercase at 11px sets far too tight without it. Less than the 1.54 an
    // eyebrow gets — that one is a standalone label with the whole width to
    // spread into, where this has a border a few points away on either side.
    letterSpacing: 0.6,
  },
  addPhotoTile: {
    backgroundColor: colors.backgroundAlt,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.tan,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addPhotoPlus: {
    fontWeight: '800',
    fontSize: type.subtitle.fontSize,
    lineHeight: 21,
    color: colors.placeholderInk,
  },
  addPhotoLabel: {
    fontWeight: '700',
    fontSize: type.micro.fontSize,
    lineHeight: 14,
    color: colors.placeholderInk,
  },
  attentionChip: {
    paddingVertical: space.xs2,
    paddingHorizontal: space.sm2,
    borderRadius: 9,
    backgroundColor: colors.accentSoft,
  },
  attentionChipText: {
    fontWeight: '800',
    fontSize: type.micro.fontSize,
    lineHeight: 13,
    color: colors.rust,
  },
  macroPill: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: space.sm2,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
  },
  macroValue: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: type.bodyLarge.fontSize,
    color: colors.primaryDarker,
  },
  macroLabel: {
    fontWeight: '700',
    fontSize: type.micro.fontSize,
    color: colors.textSecondary,
    marginTop: 2,
  },
  // ─── MeasureControl ───────────────────────────────────────────────────
  // Shell/keys match ScanReviewScreen's own stepper/stepDown/stepUp exactly
  // (same height, radius, surface colour, key sizes and glyph colours) so
  // this reads as the same control wherever it's used — the pill container,
  // dark-ish neutral minus, green-tinted plus.
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    // Weight/volume add a fourth item (the unit pill) between the value and
    // + — space-between alone put that pill and + edge to edge with no
    // breathing room between two adjacent tap targets.
    gap: space.xs2,
    minHeight: 48,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
    borderRadius: 14,
    paddingVertical: space.sm,
    paddingHorizontal: space.sm2,
  },
  stepDown: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.backgroundAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // textSecondary measured 4.02:1 on backgroundAlt in light mode — under the
  // 4.5 floor. textDark clears both themes (6.64 / 8.74) and keeps the − key
  // reading as neutral rather than accented, distinct from + below.
  stepDownText: {
    fontWeight: '800',
    fontSize: type.bodyLarge.fontSize,
    color: colors.textDark,
  },
  // Was primaryLighter — in dark mode that sits within a point of the card/
  // surface behind it (see palettes.ts's own note on plusKeySurface), so
  // the key read as an empty hole next to −. plusKeySurface is the same
  // value as primaryLighter in light mode (nothing changes there) and a
  // genuinely distinct, brighter fill in dark mode.
  stepUp: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.plusKeySurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // primaryDark measured 4.39:1 on primaryLighter in light mode — under the
  // 4.5 floor. primaryDarker clears both themes (8.85 / 10.6), and still
  // clears the dark-mode plusKeySurface fill (5:1+).
  stepUpText: {
    fontWeight: '800',
    fontSize: type.bodyLarge.fontSize,
    color: colors.primaryDarker,
  },
  // Fills − 's slot while typing (see the !typing guard around stepDown
  // above) — same size and shell as the other three keys in this row so it
  // reads as one of them, not a visitor from a different control. inkFill
  // fill (not the plain surface stepDown/stepUp use) is what marks it as
  // the row's one affirmative action while a value is being typed in.
  doneButton: {
    height: 44,
    paddingHorizontal: space.md2,
    borderRadius: 12,
    backgroundColor: colors.inkFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneButtonText: {
    fontWeight: '800',
    fontSize: type.bodySmall.fontSize,
    color: colors.onAccent,
  },
  // HOW MANY's own label row — the label on the left, the measure pill on
  // the right. baseline so the pill's own (taller) line doesn't stretch the
  // label's line-height, space-between so the pill is pinned to the far
  // edge and can never be pushed into the label at any label length — the
  // defect this replaced was exactly that overlap, caused by the two
  // sharing a row too narrow for both.
  howManyLabelRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: space.sm,
    marginBottom: space.sm2,
  },
  // Was a dashed accent border — reserved for a fact the app isn't sure
  // of (see the old NO DATE FOUND chip this borrowed its shape from), which
  // reads as an error or an unresolved state. A measure the user can
  // change but hasn't flagged as wrong is neither, so it's now a plain
  // solid hairline pill in muted text — the same "tap to change" affordance
  // as Category or Store in below it, not a warning. Dashed is now reserved
  // for nothing on this card.
  measurePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs2,
    paddingVertical: space.xs2,
    paddingHorizontal: space.sm2,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
    minHeight: 26,
  },
  measurePillText: {
    fontWeight: '800',
    fontSize: 10.5,
    lineHeight: 13,
    letterSpacing: 0.8,
    color: colors.mutedBody,
  },
  // The number-beside-unit row's own unit toggle — "L ▾", "kg ▾" — a plain
  // pill rather than the dashed "not quite settled" treatment measurePill
  // used to carry, because a unit sitting directly beside the value it
  // belongs to reads as part of the input, not as a separate pending choice.
  unitPickerWrap: {
    position: 'relative',
  },
  unitPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs2,
    height: 44,
    paddingHorizontal: space.md,
    borderRadius: 12,
    backgroundColor: colors.primaryLighter,
  },
  unitPillText: {
    fontWeight: '800',
    fontSize: type.bodySmall.fontSize,
    color: colors.primaryDarker,
  },
  unitDropdown: {
    position: 'absolute',
    top: 48,
    right: 0,
    zIndex: 10,
    minWidth: 64,
    borderRadius: 12,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
    paddingVertical: space.xs2,
    // Lifts the dropdown above whatever sits below it (the quick-amount
    // grid) so its two rows are legible rather than blending into the
    // pills underneath.
    shadowColor: colors.shadow,
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  unitOption: {
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
  },
  unitOptionOn: {
    backgroundColor: colors.primaryLighter,
  },
  unitOptionText: {
    fontWeight: '700',
    fontSize: type.bodySmall.fontSize,
    color: colors.textSecondary,
  },
  unitOptionTextOn: {
    fontWeight: '800',
    color: colors.primaryDark,
  },
  measurePanel: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm2,
    marginBottom: space.sm2,
  },
  measureOption: {
    // 2-up grid via percentage width rather than CSS grid (not available in
    // RN) — the gap above eats into it, so each tile is a hair under half.
    width: '47%',
    paddingVertical: space.sm2,
    paddingHorizontal: space.md,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
  },
  measureOptionOn: {
    backgroundColor: colors.primaryLighter,
    borderColor: colors.primaryLighter,
  },
  measureOptionName: {
    fontWeight: '800',
    fontSize: type.bodySmall.fontSize,
    color: colors.primaryDarker,
    marginBottom: space.xs2,
  },
  // No selected override for the name — it was primaryDark, which reads
  // 4.39:1 on primaryLighter in light mode (under the 4.5 floor); the
  // unselected primaryDarker it already inherits clears 8.85:1 (light) and
  // 10.6:1 (dark), so selected just keeps it rather than swapping to a
  // weaker pairing for no visual gain.
  measureOptionExample: {
    fontWeight: '600',
    fontSize: type.micro.fontSize,
    color: colors.textSecondary,
  },
  // textSecondary reads 4.36:1 (light) / 4.46:1 (dark) on primaryLighter —
  // both just under the 4.5 floor — so the selected tile needs a genuine
  // override rather than inheriting it. primaryDarker is the only token in
  // this pairing measured to clear 4.5 in both themes (8.85 / 10.6), so
  // selected borrows it from the name line rather than keeping its own
  // lighter weight.
  measureOptionExampleOn: {
    color: colors.primaryDarker,
  },
  stepValueWrap: {
    flex: 1,
    alignItems: 'center',
  },
  stepValueText: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: type.bodyLarge.fontSize,
    color: colors.primaryDarker,
    textAlign: 'center',
  },
  stepValue: {
    flex: 1,
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: type.bodyLarge.fontSize,
    color: colors.primaryDarker,
    textAlign: 'center',
    padding: space.none,
  },
  // The quick-amount grid — a stack of exact 3-item rows (see chunk() and
  // quickRow below), not a wrapping flex row approximating one with
  // percentage widths. That approximation is what let a 6-entry set render
  // as 3 rows of 2 with dead space on the right instead of 2 clean rows of 3.
  quickGrid: {
    gap: space.sm2,
  },
  // Stands in for the deleted "Quick amounts" caption's own top margin —
  // enough air to read as its own row under the stepper without a label
  // to do that separating for it.
  quickGridSpacing: {
    marginTop: space.md2,
  },
  quickRow: {
    flexDirection: 'row',
    gap: space.sm2,
  },
  quickPill: {
    // Equal thirds of the row, every row — flex:1 on a fixed 3-item row
    // divides evenly regardless of label length, so no single pill (the
    // old wrap layout's last-in-row problem) ends up stretched alone.
    // minHeight 44, matching PACKAGE STATUS's Sealed/Opened pills and
    // WHEN WAS IT OPENED?'s chips — was a plain paddingVertical with no
    // floor, which rendered visibly shorter than those two and read as a
    // different size of control on the same card. borderStrong rather
    // than backgroundAlt for the same reason those two use it: in dark
    // mode backgroundAlt sits too close to `surface`'s own fill to read
    // as a boundary at all.
    flex: 1,
    minHeight: 44,
    paddingVertical: space.sm2,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // inkFill/onAccent, not primaryBright/primaryDarker — primaryBright is a
  // bright accent surface never meant to carry text on top of it, and
  // measured at 1.32:1 in dark mode (primaryBright fill vs primaryDarker
  // text), far under the 4.5 floor. inkFill+onAccent is the pairing the rest
  // of the app already uses for a selected/active fill (see ListScreen's
  // chipActive/chipTextActive) and clears 8.99:1+ in both themes.
  quickPillOn: {
    backgroundColor: colors.inkFill,
    borderColor: colors.inkFill,
  },
  quickPillText: {
    fontWeight: '700',
    fontSize: type.caption.fontSize,
    color: colors.textDark,
  },
  quickPillTextOn: {
    fontWeight: '800',
    // On a saturated fill, so it does NOT follow the theme — same reasoning
    // as onAccent everywhere else it's used (see ListScreen.tsx).
    color: colors.onAccent,
  },
  halfPill: {
    alignSelf: 'flex-start',
    marginTop: space.sm2,
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: space.md,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.backgroundAlt,
  },
  halfPillText: {
    fontWeight: '700',
    fontSize: type.caption.fontSize,
    color: colors.primaryDark,
  },
  summaryLine: {
    marginTop: space.sm2,
    fontWeight: '600',
    fontSize: 12.5,
    lineHeight: 17,
    color: colors.textSecondary,
  },
}));