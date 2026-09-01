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
  ItemQuantity,
  Measure,
  MEASURES,
  MEASURE_EXAMPLES,
  MEASURE_LABELS,
  defaultQuantity,
  formatAmount,
  minFor,
  quickAmounts,
  step,
  summaryLine,
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

/**
 * The "How many" control — measure pill, stepper, quick-amount grid, and the
 * splittable ghost pill and summary line beneath it.
 *
 * One component for both places quantity is edited (the scan review card and
 * EditItemSheet) so the four measures behave identically wherever they show
 * up. `unit` is the item's own unit noun for pieces/pack ("egg", "loaf",
 * "bag") — pass '' when there isn't one and the control falls back to a bare
 * count / "pack".
 */
export function MeasureControl({
  quantity,
  unit,
  onChange,
  onPickMeasure,
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
}) {
  const styles = useStyles();
  const colors = useColors();
  const [panelOpen, setPanelOpen] = useState(false);
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState('');

  function pickMeasure(measure: Measure) {
    setPanelOpen(false);
    if (measure === quantity.measure) return;
    const next = defaultQuantity(measure);
    onChange(next);
    onPickMeasure?.(next);
  }

  function nudge(direction: 1 | -1) {
    onChange(step(quantity, direction));
  }

  function commitTyped(text: string) {
    const n = Number(text.replace(/[^0-9.]/g, ''));
    setTyping(false);
    if (!Number.isFinite(n) || n <= 0) return;
    onChange({ ...quantity, amount: Math.max(minFor(quantity.measure, quantity.splittable), n) });
  }

  const displayValue = formatAmount(quantity, unit);

  return (
    <View>
      <View style={styles.measureLabelRow}>
        <Eyebrow>How many</Eyebrow>
        <TouchableOpacity
          style={styles.measurePill}
          onPress={() => setPanelOpen((v) => !v)}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={`Measure: ${MEASURE_LABELS[quantity.measure]}`}
        >
          <Text style={styles.measurePillText}>{MEASURE_LABELS[quantity.measure]}</Text>
          <Ionicons
            name={panelOpen ? 'chevron-up' : 'chevron-down'}
            size={11}
            color={colors.primaryDark}
          />
        </TouchableOpacity>
      </View>

      {panelOpen && (
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

      <View style={styles.stepper}>
        <TouchableOpacity
          style={styles.stepDown}
          onPress={() => nudge(-1)}
          hitSlop={HIT_SLOP}
          activeOpacity={0.7}
          accessibilityLabel="Less"
        >
          <Text style={styles.stepDownText}>−</Text>
        </TouchableOpacity>
        {typing ? (
          <>
            <TextInput
              style={styles.stepValue}
              value={draft}
              onChangeText={setDraft}
              onBlur={() => commitTyped(draft)}
              onSubmitEditing={() => commitTyped(draft)}
              keyboardType="decimal-pad"
              returnKeyType="done"
              selectTextOnFocus
              autoFocus
              selectionColor={colors.primaryDark}
              accessibilityLabel="How many"
            />
            {/* decimal-pad has no Done key on iOS — onSubmitEditing never
                fires, and onBlur only commits once the user thinks to tap
                elsewhere. This is the one always-visible way to confirm a
                typed value, not a fallback for the other two. */}
            <TouchableOpacity
              style={styles.stepConfirm}
              onPress={() => commitTyped(draft)}
              hitSlop={HIT_SLOP}
              activeOpacity={0.7}
              accessibilityLabel="Confirm amount"
            >
              <Ionicons name="checkmark" size={20} color={colors.onAccent} />
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity
            style={styles.stepValueWrap}
            onPress={() => {
              setDraft(String(quantity.amount));
              setTyping(true);
            }}
            activeOpacity={0.7}
          >
            <Text style={styles.stepValueText}>{displayValue}</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={styles.stepUp}
          onPress={() => nudge(1)}
          hitSlop={HIT_SLOP}
          activeOpacity={0.7}
          accessibilityLabel="More"
        >
          <Text style={styles.stepUpText}>+</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.quickGrid}>
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
                  onPress={() => onChange({ ...quantity, amount: preset.amount })}
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
    // Only matters while typing, when a fourth item (the confirm key)
    // joins − / value / +  — space-between alone put ✓ and + edge to edge
    // with no breathing room between two adjacent tap targets.
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
  stepUp: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.primaryLighter,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // primaryDark measured 4.39:1 on primaryLighter in light mode — under the
  // 4.5 floor. primaryDarker clears both themes (8.85 / 10.6).
  stepUpText: {
    fontWeight: '800',
    fontSize: type.bodyLarge.fontSize,
    color: colors.primaryDarker,
  },
  // Deliberately distinct from stepUp's green tint — this replaces the
  // whole value while typing, a different weight of action than nudging it
  // by one step, and inkFill/onAccent is the same saturated-fill pairing
  // used for a confirm action elsewhere (see quickPillOn).
  stepConfirm: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.inkFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  measureLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    marginBottom: space.sm,
  },
  // Mirrors the "No date found" dashed treatment (chipFill.missing above),
  // in green rather than tan — this is a setting the user can change, not a
  // fact the app is reporting, so it gets the same "not quite settled" cue
  // that dashed border already means everywhere else on this screen.
  measurePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs2,
    paddingVertical: space.xs2,
    paddingHorizontal: space.sm2,
    borderRadius: 999,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.primaryLight,
    minHeight: 26,
  },
  measurePillText: {
    fontWeight: '800',
    fontSize: 10.5,
    lineHeight: 13,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
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
    marginTop: space.sm2,
  },
  quickRow: {
    flexDirection: 'row',
    gap: space.sm2,
  },
  quickPill: {
    // Equal thirds of the row, every row — flex:1 on a fixed 3-item row
    // divides evenly regardless of label length, so no single pill (the
    // old wrap layout's last-in-row problem) ends up stretched alone.
    flex: 1,
    paddingVertical: space.sm2,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
    alignItems: 'center',
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