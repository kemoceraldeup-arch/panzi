// src/components/recipes/DishTile.tsx
//
// What a recipe looks like, in three sizes, used by the featured card, the mini
// cards, the detail header and cook mode — one component so a dish is
// recognisably the same object everywhere it appears.
//
// Two ways of drawing it, and which one you get depends only on whether a photo
// exists for this dish yet:
//
//   photo in assets/dishes/  →  the photograph, with a scrim under the text
//   nothing there            →  the gradient and glyph from dishLooks.ts
//
// The gradient is not a placeholder waiting to be replaced. It is the correct
// answer for every dish outside the named list, and most suggestions will land
// there. Both paths are finished designs.
//
// Children render on top either way, which is how the featured card keeps its
// "uses expiring" pill and its why line inside the band.

import React from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import Text from '../Text';
import { DishLook, dishGlyph, dishGradient } from '../../theme/dishLooks';
import { DishKey, dishPhoto } from '../../theme/dishPhotos';

export type TileSize = 'hero' | 'card' | 'mini';

const HEIGHTS: Record<TileSize, number> = {
  hero: 150,
  card: 132,
  mini: 74,
};

const GLYPHS: Record<TileSize, number> = {
  hero: 62,
  card: 52,
  mini: 32,
};

type Props = {
  look: DishLook | string | null | undefined;
  /** Names the dish for the photo lookup. Absent or unknown means the gradient,
   *  which is why every caller does not have to have one. */
  dishKey?: DishKey | string | null;
  size?: TileSize;
  radius?: number;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
};

export default function DishTile({
  look,
  dishKey,
  size = 'card',
  radius = 0,
  style,
  children,
}: Props) {
  const photo = dishPhoto(dishKey);
  const frame = [{ minHeight: HEIGHTS[size], borderRadius: radius }, styles.tile, style];

  if (photo) {
    return (
      <View style={frame}>
        <Image source={photo} style={StyleSheet.absoluteFill} contentFit="cover" />
        {/* Photographs are unpredictable — a pale bowl of lugaw and a dark
            kaldereta both end up under the same white text. The scrim darkens
            only the lower half, where the text sits, so the food above it is
            not muddied. */}
        <LinearGradient
          colors={['transparent', 'rgba(23,23,15,0.72)']}
          locations={[0.35, 1]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        {children}
      </View>
    );
  }

  return (
    <LinearGradient
      colors={[...dishGradient(look)]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={frame}
    >
      {/* Behind the children rather than beside them, so a pill or a line of
          text can overlap it without pushing the picture around. */}
      <View style={styles.glyphLayer} pointerEvents="none">
        <Text style={[styles.glyph, { fontSize: GLYPHS[size] }]}>{dishGlyph(look)}</Text>
      </View>
      {children}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  tile: {
    overflow: 'hidden',
  },
  glyphLayer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyph: {
    // Slightly translucent so text laid over the tile stays the thing being
    // read. The glyph is decoration; the why line is information.
    opacity: 0.92,
  },
});
