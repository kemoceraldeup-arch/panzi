// src/theme/makeStyles.ts
//
// Stylesheets that know which palette they were built for.
//
// The problem this solves: `StyleSheet.create({ card: { backgroundColor:
// colors.card } })` at module scope runs exactly once, when the file is first
// imported, and bakes in whatever the palette said at that moment. Swapping the
// palette afterwards changes nothing — the screen keeps the colours it was born
// with. That is why dark mode cannot be a global variable.
//
// So the block becomes a factory, and each file does:
//
//     const useStyles = makeStyles((c) => ({ card: { backgroundColor: c.card } }));
//
//     function Screen() {
//       const styles = useStyles();
//       ...
//     }
//
// Each palette's version is built once and cached, so flipping the theme costs
// one build per screen and nothing thereafter. Everything else about the file
// stays exactly as it was.

import { useMemo } from 'react';
import { ImageStyle, StyleSheet, TextStyle, ViewStyle } from 'react-native';
import { Palette, Scheme, palettes } from './palettes';
import { useTheme } from './ThemeProvider';

type NamedStyles<T> = { [P in keyof T]: ViewStyle | TextStyle | ImageStyle };

export function makeStyles<T extends NamedStyles<T>>(factory: (colors: Palette) => T) {
  // One entry per scheme, filled on first use. Built lazily rather than eagerly
  // for both schemes, because most sessions never see the other one.
  const cache = new Map<Scheme, T>();

  return function useStyles(): T {
    const { scheme } = useTheme();

    return useMemo(() => {
      const cached = cache.get(scheme);
      if (cached) return cached;

      const built = StyleSheet.create(factory(palettes[scheme]));
      cache.set(scheme, built);
      return built;
    }, [scheme]);
  };
}
