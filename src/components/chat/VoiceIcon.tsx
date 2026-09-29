// src/components/chat/VoiceIcon.tsx
//
// The "talk to Panzi" button's glyph, on Home's ask bar and in the chat's
// composer. A waveform rather than a microphone — it says "speak" rather than
// "audio settings" — pared down to five rounded strokes, symmetrical and
// evenly spaced, so at 20pt it reads as a voice, not as a bar chart.

import React from 'react';
import Svg, { Line } from 'react-native-svg';

/** Half-heights of the five strokes, centre tallest. */
const STROKES = [3, 6, 9, 6, 3];

export default function VoiceIcon({ size = 20, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {STROKES.map((half, i) => {
        const x = 4 + i * 4;
        return (
          <Line
            key={i}
            x1={x}
            x2={x}
            y1={12 - half}
            y2={12 + half}
            stroke={color}
            strokeWidth={2}
            strokeLinecap="round"
          />
        );
      })}
    </Svg>
  );
}
