// src/components/auth/SocialIcons.tsx
//
// Real brand marks for the "or continue with" row on the sign-in and
// create-account screens — the login-2a.html mock used placeholder "G"/"f"
// letterforms and explicitly called out swapping in the official SVGs at
// implementation (see REACT-NATIVE-NOTES.md §6).
//
// Paths are Google's and Meta's own published brand marks, redrawn on a
// 0–48 viewBox so both scale cleanly to any size via the `size` prop.

import React from 'react';
import Svg, { Path } from 'react-native-svg';

type IconProps = {
  size?: number;
};

export function GoogleIcon({ size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Path
        fill="#4285F4"
        d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"
      />
      <Path
        fill="#34A853"
        d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"
      />
      <Path
        fill="#FBBC05"
        d="M11.69 28.18A13.94 13.94 0 0 1 10.9 24c0-1.45.25-2.86.69-4.18v-5.7H4.34A21.93 21.93 0 0 0 2 24c0 3.55.85 6.91 2.34 9.88l7.35-5.7z"
      />
      <Path
        fill="#EA4335"
        d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"
      />
    </Svg>
  );
}

export function FacebookIcon({ size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Path
        fill="#1877F2"
        d="M48 24c0-13.26-10.74-24-24-24S0 10.74 0 24c0 11.98 8.78 21.91 20.25 23.71V30.94h-6.1V24h6.1v-5.29c0-6.02 3.58-9.34 9.06-9.34 2.63 0 5.37.47 5.37.47v5.9h-3.03c-2.98 0-3.91 1.85-3.91 3.75V24h6.66l-1.06 6.94h-5.6v16.77C39.22 45.91 48 35.98 48 24z"
      />
      <Path
        fill="#FFFFFF"
        d="M33.34 30.94 34.4 24h-6.66v-4.51c0-1.9.93-3.75 3.91-3.75h3.03v-5.9s-2.74-.47-5.37-.47c-5.48 0-9.06 3.32-9.06 9.34V24h-6.1v6.94h6.1v16.77a24.2 24.2 0 0 0 7.5 0V30.94h5.6z"
      />
    </Svg>
  );
}
