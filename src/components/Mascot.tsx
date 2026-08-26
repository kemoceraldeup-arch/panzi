// src/components/Mascot.tsx
// Panzi's mascot — real character art, cropped from the brand sheet.
// Swap `pose` to use different official poses as the app grows.

import React from 'react';
import { Image, ImageStyle, StyleProp } from 'react-native';

export type MascotPose = 'hero' | 'scan' | 'face' | 'shelf' | 'peek';

const POSES: Record<MascotPose, any> = {
  hero: require('../../assets/mascot/panzi-hero.png'),
  scan: require('../../assets/mascot/panzi-scan.png'),
  face: require('../../assets/mascot/panzi-face.png'),
  shelf: require('../../assets/mascot/panzi-shelf.png'),
  peek: require('../../assets/mascot/mascot-peek.png'),
};

type MascotProps = {
  size?: number;
  pose?: MascotPose;
  style?: StyleProp<ImageStyle>;
};

export default function Mascot({ size = 120, pose = 'face', style }: MascotProps) {
  return (
    <Image
      source={POSES[pose]}
      style={[{ width: size, height: size }, style]}
      resizeMode="contain"
    />
  );
}