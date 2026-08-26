// src/components/Text.tsx
//
// Drop-in replacement for React Native's <Text> that resolves the design
// system's fonts. Screens import this instead of Text from 'react-native' and
// otherwise change nothing: existing `fontWeight: '800'` styles keep working,
// and now render in Nunito ExtraBold rather than the system font.
//
// `fontWeight` is deliberately stripped after resolving. Leaving it on top of
// an already-bold family makes Android apply a synthetic bold over a real one,
// which renders noticeably heavier and slightly wider than the design.
//
// Text scaling is honoured but capped. A user who has turned system text up is
// telling us something and must be listened to — but this app is full of fixed
// height rows, chips and a tab bar, and at the 200%+ the OS allows, those stop
// containing their own labels. 1.3 is the point where every screen still holds
// together, and it is applied here rather than per screen so nothing can be
// added later that forgets to.

import React from 'react';
import { Text as RNText, StyleSheet, TextProps } from 'react-native';
import { resolveFontFamily } from '../theme/typography';
import { useColors } from '../theme/ThemeProvider';

const MAX_FONT_SCALE = 1.3;

export default function Text({ style, ...rest }: TextProps) {
  const colors = useColors();

  // Flatten first: style can be an array, and a later entry's fontWeight has
  // to win over an earlier one exactly as it would in RN.
  const flat = StyleSheet.flatten(style) ?? {};
  const { fontFamily, fontWeight, ...restStyle } = flat;

  return (
    <RNText
      maxFontSizeMultiplier={MAX_FONT_SCALE}
      // The theme's ink goes FIRST so any explicit `color` in the caller's style
      // still wins. This is the safety net for dark mode: React Native's own
      // default is black, so a Text with no colour of its own was invisible on
      // charcoal. Rather than hunt every such element across 36 screens, the
      // fallback itself follows the theme. In light mode this changes pure #000
      // to the palette's near-black, which is the more correct value anyway.
      style={[
        { color: colors.textPrimary },
        restStyle,
        { fontFamily: resolveFontFamily(fontFamily, fontWeight) },
      ]}
      {...rest}
    />
  );
}
