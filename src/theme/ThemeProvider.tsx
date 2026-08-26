// src/theme/ThemeProvider.tsx
//
// Which palette the app is wearing, and who decides.
//
// Three preferences, not two: 'system' is the default and the one most users
// will never change, because a phone already knows whether it is night. The
// other two are for people who want the app to disagree with their phone, which
// is a real preference and worth honouring.
//
// The choice is stored on the device rather than in Firestore. It is about this
// phone — a bright tablet in the kitchen and a phone in bed can reasonably want
// different answers — and it has to be readable before anything renders, which
// a network round trip cannot promise.

import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View, useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Palette, Scheme, palettes } from './palettes';

export type ThemePreference = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'panzi.appearance';

// How long the dissolve takes when the palette flips. Long enough to read as a
// deliberate transition, short enough that it never stands between a tap and
// the result of it.
const FADE_MS = 300;

type ThemeValue = {
  /** What the app is actually wearing right now. */
  scheme: Scheme;
  /** What the user asked for, which may be 'system'. */
  preference: ThemePreference;
  /**
   * What the OS reported, verbatim — including `null` for "it didn't say".
   *
   * Kept separate from `scheme` so the Appearance row can be honest. `scheme`
   * has to resolve to something paintable and falls back to light, but a screen
   * that then tells the user "your phone is set to light" is stating a guess as
   * a fact. When this is null the right thing to say is nothing.
   */
  systemScheme: Scheme | null;
  setPreference: (next: ThemePreference) => void;
  colors: Palette;
};

const ThemeContext = createContext<ThemeValue>({
  scheme: 'light',
  preference: 'system',
  systemScheme: null,
  setPreference: () => {},
  colors: palettes.light,
});

function isPreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system';
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // What the phone says. Updates on its own when the OS flips at sunset, so
  // 'system' keeps up without the app doing anything.
  const system = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>('system');

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (!cancelled && isPreference(raw)) setPreferenceState(raw);
      })
      // A failed read leaves it on 'system', which is the default anyway —
      // there is nothing here worth surfacing an error for.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<ThemeValue>(() => {
    // `useColorScheme()` is typed 'light' | 'dark' | null. Null means the
    // platform has not reported one — which is also what you get when the app
    // has declared itself light-only, since the OS then has nothing to report.
    const systemScheme: Scheme | null =
      system === 'dark' ? 'dark' : system === 'light' ? 'light' : null;

    const scheme: Scheme =
      preference === 'system' ? systemScheme ?? 'light' : preference;

    return {
      scheme,
      preference,
      systemScheme,
      colors: palettes[scheme],
      setPreference: (next) => {
        // State first so the tap feels instant; the write is bookkeeping and
        // its failure costs one setting on next launch, not this one.
        setPreferenceState(next);
        void AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
      },
    };
  }, [preference, system]);

  return (
    <ThemeContext.Provider value={value}>
      <View style={styles.root}>
        {children}
        <SchemeDissolve scheme={value.scheme} />
      </View>
    </ThemeContext.Provider>
  );
}

/**
 * Softens the palette flip.
 *
 * Every stylesheet in the app rebuilds on the same frame the scheme changes, so
 * without this the screen hard-cuts from cream to charcoal — accurate, and
 * jarring enough to read as a glitch. So the instant the scheme changes, a
 * sheet in the *outgoing* background colour covers the screen and fades away,
 * revealing the new theme underneath. The cut still happens; it happens behind
 * a curtain.
 *
 * Lives here rather than in a screen because there is one flip and it has to
 * cover everything at once. Native modals sit in their own layer above this
 * view, so a theme change with one open cuts rather than dissolves — nothing on
 * this screen offers that, and covering it would mean a second overlay inside
 * every modal.
 */
function SchemeDissolve({ scheme }: { scheme: Scheme }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const previous = useRef(scheme);
  // The colour to cover with. Null when nothing is animating, which is also
  // what keeps the sheet unmounted for the entire life of a normal session.
  const [from, setFrom] = useState<string | null>(null);

  useEffect(() => {
    if (previous.current === scheme) return;

    // Read the OLD palette before overwriting the ref — that is the colour the
    // user is currently looking at, and the one that has to fade out.
    setFrom(palettes[previous.current].backgroundLight);
    previous.current = scheme;

    opacity.setValue(1);
    Animated.timing(opacity, {
      toValue: 0,
      duration: FADE_MS,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start(({ finished }) => {
      // Unmounted on completion so nothing is left over the app. Skipped when
      // interrupted, because a second flip is already mid-flight and owns it.
      if (finished) setFrom(null);
    });
  }, [scheme, opacity]);

  if (!from) return null;

  return (
    <Animated.View
      // Never swallows a tap, even mid-fade — the sheet is decoration, and the
      // button underneath it was just pressed.
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { backgroundColor: from, opacity }]}
    />
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});

export function useTheme(): ThemeValue {
  return useContext(ThemeContext);
}

/** The palette, for colours read straight into JSX — icon tints, gradient
 *  stops, anything that isn't a StyleSheet entry. */
export function useColors(): Palette {
  return useContext(ThemeContext).colors;
}
