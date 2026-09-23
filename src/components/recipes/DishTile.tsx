// src/components/recipes/DishTile.tsx
//
// What a recipe looks like, in three sizes, used by the featured card, the mini
// cards, the detail header and cook mode — one component so a dish is
// recognisably the same object everywhere it appears.
//
// Three ways of drawing it, tried in order:
//
//   photo in assets/dishes/       →  the bundled photograph, with a scrim
//   a generated photo, once found →  same treatment, fetched at runtime
//   neither                       →  the gradient and glyph from dishLooks.ts
//
// The gradient is not a placeholder waiting to be replaced. It is the correct
// answer for every dish outside the named list until (and unless) a generated
// photo for that exact title turns up, and most suggestions will land there.
// All three paths are finished designs — the generated tier just means fewer
// dishes end there than before.
//
// Children render on top either way, which is how the featured card keeps its
// "uses expiring" pill and its why line inside the band.

import React, { useEffect, useState } from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import Text from '../Text';
import { DishLook, dishGlyph, dishGradient } from '../../theme/dishLooks';
import { DishKey, dishPhoto } from '../../theme/dishPhotos';
import { fetchDishPhoto } from '../../services/recipes';

export type TileSize = 'hero' | 'card' | 'mini';

// One in-memory cache per app session, keyed by the same normalised-title
// logic the server hashes on — good enough to stop the same screen re-asking
// for a photo it already has this session; the server's own Supabase check is
// what makes a cold app launch cheap too.
const sessionPhotoCache = new Map<string, string | null>();

function cacheKey(title: string): string {
  return title.trim().toLowerCase();
}

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
  /** Names the dish for the bundled-photo lookup. Absent or unknown means no
   *  bundled photo, which is when `title` gets a chance below. */
  dishKey?: DishKey | string | null;
  /** The dish's own title, used only to ask the server for a generated photo
   *  when there is no bundled one for `dishKey`. Optional so every existing
   *  caller keeps compiling — omitting it just means this tile never tries
   *  the generated tier and goes straight to the gradient, same as before
   *  this prop existed. */
  title?: string | null;
  size?: TileSize;
  radius?: number;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
};

export default function DishTile({
  look,
  dishKey,
  title,
  size = 'card',
  radius = 0,
  style,
  children,
}: Props) {
  const bundledPhoto = dishPhoto(dishKey);
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(() =>
    title ? sessionPhotoCache.get(cacheKey(title)) ?? null : null
  );

  useEffect(() => {
    // The bundled photo always wins when there is one — no reason to ask the
    // server for a dish the app already ships a picture for. Same when there
    // is no title to ask about at all.
    if (bundledPhoto || !title) return;

    const key = cacheKey(title);
    if (sessionPhotoCache.has(key)) {
      setGeneratedUrl(sessionPhotoCache.get(key) ?? null);
      return;
    }

    let cancelled = false;
    fetchDishPhoto(title).then((url) => {
      sessionPhotoCache.set(key, url);
      if (!cancelled) setGeneratedUrl(url);
    });
    // No cleanup beyond the flag: a fetch that resolves after this tile
    // unmounts still populates sessionPhotoCache for whoever asks next.
    return () => {
      cancelled = true;
    };
  }, [bundledPhoto, title]);

  const photo = bundledPhoto ?? (generatedUrl ? { uri: generatedUrl } : null);
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
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyph: {
    // Slightly translucent so text laid over the tile stays the thing being
    // read. The glyph is decoration; the why line is information.
    opacity: 0.92,
  },
});
