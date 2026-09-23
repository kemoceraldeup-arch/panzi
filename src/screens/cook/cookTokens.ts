// src/screens/cook/cookTokens.ts
//
// Cook mode's own literal palette, in both schemes. The light values are the
// design's exact spec; the dark values follow the same warm-charcoal
// treatment as theme/palettes.ts's `dark` (browns, not greys) rather than
// inventing a second dark-mode language for this one screen.

import { Scheme } from '../../theme/palettes';

export type CookTokens = {
  page: string;
  surface: string;
  ink: string;
  ink2: string;
  label: string;
  bodyMuted: string;
  accent: string;
  accentHover: string;
  accentDeep: string;
  track: string;
  hairline: string;
  scrim: string;
  onAccent: string;
  heroFallback: string;
  shadowColor: string;
  /** The step-count chip sitting over the hero photo — translucent so the
   *  photo shows through at the edges. */
  stepChipFill: string;
};

const light: CookTokens = {
  page: '#FDF4E3',
  surface: '#FFFFFF',
  ink: '#1E4620',
  ink2: '#2F5A2C',
  label: '#8A9A86',
  bodyMuted: '#7A8A76',
  accent: '#62C554',
  accentHover: '#57B94A',
  accentDeep: '#2F7A2B',
  track: 'rgba(31,70,32,.12)',
  hairline: 'rgba(31,70,32,.08)',
  scrim: 'rgba(30,70,32,.42)',
  onAccent: '#FBF7EC',
  heroFallback: '#EFE7D4',
  shadowColor: '#1F4620',
  stepChipFill: 'rgba(253,244,227,.92)',
};

const dark: CookTokens = {
  page: '#181410',
  surface: '#2A2418',
  ink: '#EAF3E4',
  ink2: '#C8DCC0',
  label: '#8FA187',
  bodyMuted: '#A8B39E',
  accent: '#4FA83A',
  accentHover: '#5CAE33',
  accentDeep: '#8FE065',
  track: 'rgba(232,243,220,.14)',
  hairline: 'rgba(232,243,220,.10)',
  scrim: 'rgba(10,14,8,.6)',
  onAccent: '#FFFFFF',
  heroFallback: '#332C20',
  shadowColor: '#000000',
  stepChipFill: 'rgba(22,20,16,.72)',
};

export const cookTokens: Record<Scheme, CookTokens> = { light, dark };
