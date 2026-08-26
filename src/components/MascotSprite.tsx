// src/components/MascotSprite.tsx
// Panzi's "jump" animation as a true-alpha sprite sheet, for platforms/spots
// where a transparent background matters more than video (e.g. the "You're
// all set" page). PNG alpha has no codec/platform restrictions, unlike
// video — this renders identically on iOS, Android, and web.
//
// The sheet is baked at the component's native display size (280x498) so
// frame-swapping only pans a texture, it never rescales one at runtime — an
// earlier version baked the sheet much larger and scaled it down live, which
// visibly stuttered on device (re-scaling ~9MB of image data 12x/sec).
// Panning is driven by Animated + useNativeDriver so each tick is a GPU
// transform update, not a React re-render/layout pass.

import React, { useEffect, useRef } from 'react';
import { Animated, StyleProp, View, ViewStyle } from 'react-native';

const SHEET = require('../../assets/mascot/panzi-jump-sprite.png');

const COLUMNS = 8;
const ROWS = 5;
const FRAME_COUNT = COLUMNS * ROWS; // 40
const FRAME_WIDTH = 280;
const FRAME_HEIGHT = 498;
const SHEET_WIDTH = FRAME_WIDTH * COLUMNS;
const SHEET_HEIGHT = FRAME_HEIGHT * ROWS;
const FPS = 10;

type MascotSpriteProps = {
  size?: number; // renders at size x (size * FRAME_HEIGHT/FRAME_WIDTH)
  style?: StyleProp<ViewStyle>;
};

export default function MascotSprite({ size = FRAME_WIDTH, style }: MascotSpriteProps) {
  const frame = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let current = 0;
    const id = setInterval(() => {
      current = (current + 1) % FRAME_COUNT;
      frame.setValue(current);
    }, 1000 / FPS);
    return () => clearInterval(id);
  }, [frame]);

  const scale = size / FRAME_WIDTH;

  const frameInput = Array.from({ length: FRAME_COUNT }, (_, i) => i);
  const translateX = frame.interpolate({
    inputRange: frameInput,
    outputRange: frameInput.map((i) => -(i % COLUMNS) * FRAME_WIDTH * scale),
  });
  const translateY = frame.interpolate({
    inputRange: frameInput,
    outputRange: frameInput.map((i) => -Math.floor(i / COLUMNS) * FRAME_HEIGHT * scale),
  });

  return (
    <View
      style={[
        { width: size, height: size * (FRAME_HEIGHT / FRAME_WIDTH), overflow: 'hidden' },
        style,
      ]}
    >
      <Animated.Image
        source={SHEET}
        style={{
          width: SHEET_WIDTH * scale,
          height: SHEET_HEIGHT * scale,
          transform: [{ translateX }, { translateY }],
        }}
        resizeMode="stretch"
      />
    </View>
  );
}
