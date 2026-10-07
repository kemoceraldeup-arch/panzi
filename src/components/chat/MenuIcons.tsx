// src/components/chat/MenuIcons.tsx
//
// The icons for the chat long-press menu, drawn to match the ChatGPT app's
// own: thin rounded strokes, a pushpin tilted over rather than a map pin, an
// archive box with its lid and slot. Ionicons' nearest equivalents are filled
// or drawn at a different weight, and next to each other in one menu the
// difference showed. Paths are Lucide's (ISC licence), the set those icons
// are drawn in.

import React from 'react';
import Svg, { Line, Path, Rect } from 'react-native-svg';

export type MenuIconName = 'pin' | 'unpin' | 'rename' | 'archive' | 'unarchive' | 'delete';

type Props = { name: MenuIconName; size?: number; color: string };

export default function MenuIcon({ name, size = 22, color }: Props) {
  const stroke = {
    stroke: color,
    strokeWidth: 1.9,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    fill: 'none',
  };

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {name === 'pin' && (
        // Tilted 45°, head up and to the right, like a pin pushed into a board.
        <>
          <Path {...stroke} origin="12, 12" rotation={45} d="M12 17v5" />
          <Path
            {...stroke}
            origin="12, 12"
            rotation={45}
            d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"
          />
        </>
      )}
      {name === 'unpin' && (
        <>
          <Path {...stroke} origin="12, 12" rotation={45} d="M12 17v5" />
          <Path
            {...stroke}
            origin="12, 12"
            rotation={45}
            d="M15 9.34V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H7.89"
          />
          <Path
            {...stroke}
            origin="12, 12"
            rotation={45}
            d="M9 9v1.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h11"
          />
          <Path {...stroke} d="m3 3 18 18" />
        </>
      )}
      {name === 'rename' && (
        <>
          <Path
            {...stroke}
            d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"
          />
          <Path {...stroke} d="m15 5 4 4" />
        </>
      )}
      {name === 'archive' && (
        <>
          <Rect {...stroke} x={2} y={3} width={20} height={5} rx={1} />
          <Path {...stroke} d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
          <Path {...stroke} d="M10 12h4" />
        </>
      )}
      {name === 'unarchive' && (
        <>
          <Rect {...stroke} x={2} y={3} width={20} height={5} rx={1} />
          <Path {...stroke} d="M4 8v11a2 2 0 0 0 2 2h2" />
          <Path {...stroke} d="M20 8v11a2 2 0 0 1-2 2h-2" />
          <Path {...stroke} d="m9 15 3-3 3 3" />
          <Path {...stroke} d="M12 12v9" />
        </>
      )}
      {name === 'delete' && (
        <>
          <Path {...stroke} d="M3 6h18" />
          <Path {...stroke} d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
          <Path {...stroke} d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
          <Line {...stroke} x1={10} x2={10} y1={11} y2={17} />
          <Line {...stroke} x1={14} x2={14} y1={11} y2={17} />
        </>
      )}
    </Svg>
  );
}
