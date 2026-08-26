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

import React from 'react';
import { Image, StyleSheet, TouchableOpacity, View, ViewStyle } from 'react-native';
import Text from '../../components/Text';
import { ChipTone, ProvenanceChip, ScanBox } from '../../services/scan';
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
}: {
  size?: number;
  tone?: 'good' | 'warn' | 'neutral';
  photo?: Capture | null;
  box?: ScanBox | null;
  ownPhotoUri?: string | null;
  onPressAdd?: () => void;
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
}));