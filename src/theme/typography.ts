// src/theme/typography.ts
//
// The design system is two families: Baloo 2 for headings, Nunito for
// everything else.
//
// React Native doesn't synthesise weights for custom fonts the way it does for
// the system font — `fontWeight: '800'` on a family registered as "Nunito"
// either does nothing or fakes a bold, depending on platform. Each weight has
// to be its own registered family name.
//
// Writing `fontFamily: 'Nunito_800ExtraBold'` at every call site would be
// noisy and easy to get wrong, so styles keep writing plain `fontWeight` and
// the <Text> wrapper in components/Text.tsx resolves it through the maps
// below. Styles opt into headings with `fontFamily: fonts.display`.

export const fonts = {
  /** Nunito — body, labels, buttons. The default when no family is set. */
  body: 'Nunito',
  /** Baloo 2 — headings and titles only. */
  display: 'Baloo2',
  /** Quicksand — cook mode only. A screen read from a metre away with oily
   *  hands is its own place, not a heading inside the rest of the app, so it
   *  keeps its own family rather than borrowing Baloo2/Nunito. */
  cook: 'Quicksand',
} as const;

export type FontFamily = (typeof fonts)[keyof typeof fonts];

/**
 * The type scale.
 *
 * Named for the job rather than the number, so a label in one screen is the
 * same size as a label in another without anyone having to remember which
 * number that was. The sizes are the ones the design already leaned on — this
 * pins them rather than inventing a new ladder and dragging every screen onto
 * it.
 *
 * Line heights are set here too. A size without one inherits the platform
 * default, which differs between iOS and Android and is what made some of
 * these blocks sit at different heights on the two.
 */
export const type = {
  /** 11 — eyebrows, tab labels. Always uppercase or heavily tracked. */
  micro: { fontSize: 11, lineHeight: 15 },
  /** 12 — footnotes, captions, the small print under a control. */
  caption: { fontSize: 12, lineHeight: 17 },
  /** 13 — chips, dense labels. The most used size in the app. */
  label: { fontSize: 13, lineHeight: 18 },
  /** 14 — secondary body, row subtitles. */
  bodySmall: { fontSize: 14, lineHeight: 19 },
  /** 15 — body copy and links. */
  body: { fontSize: 15, lineHeight: 21 },
  /** 16 — emphasised body, a row's own title. */
  bodyLarge: { fontSize: 16, lineHeight: 22 },
  /** 17 — buttons and section titles. */
  subtitle: { fontSize: 17, lineHeight: 23 },
  /** 20 — a card's heading. */
  title: { fontSize: 20, lineHeight: 25 },
  /** 24 — a screen's heading. */
  headline: { fontSize: 24, lineHeight: 28 },
  /** 30 — the one big number or name on a page. */
  display: { fontSize: 30, lineHeight: 34 },
} as const;

export type TypeRole = keyof typeof type;

// Only the weights the design actually uses are bundled — each one is a real
// font file shipped in the binary, so unused weights are dead payload.
const NUNITO: Record<number, string> = {
  400: 'Nunito_400Regular',
  600: 'Nunito_600SemiBold',
  700: 'Nunito_700Bold',
  800: 'Nunito_800ExtraBold',
};

const BALOO: Record<number, string> = {
  600: 'Baloo2_600SemiBold',
  700: 'Baloo2_700Bold',
  800: 'Baloo2_800ExtraBold',
};

const QUICKSAND: Record<number, string> = {
  400: 'Quicksand_400Regular',
  500: 'Quicksand_500Medium',
  600: 'Quicksand_600SemiBold',
  700: 'Quicksand_700Bold',
};

const DEFAULT_WEIGHT = 400;

// Named weights RN accepts, mapped to numbers so the nearest-match below has
// something to compare. 'normal'/'bold' are the only two RN guarantees.
const NAMED: Record<string, number> = {
  normal: 400,
  bold: 700,
};

/**
 * Picks the closest bundled weight rather than failing. A style asking for 500
 * (or 900, or a weight only Nunito has) still renders in the right family at
 * the nearest weight we ship, instead of silently falling back to the system
 * font — which would be a visible mismatch rather than a subtle one.
 */
function nearest(available: Record<number, string>, weight: number): string {
  const weights = Object.keys(available).map(Number);
  let best = weights[0];
  for (const w of weights) {
    if (Math.abs(w - weight) < Math.abs(best - weight)) best = w;
  }
  return available[best];
}

export function resolveFontFamily(
  family: string | undefined,
  weight: string | number | undefined
): string {
  const numeric =
    typeof weight === 'number'
      ? weight
      : weight
        ? (NAMED[weight] ?? Number(weight) ?? DEFAULT_WEIGHT)
        : DEFAULT_WEIGHT;

  const table = family === fonts.display ? BALOO : family === fonts.cook ? QUICKSAND : NUNITO;
  return nearest(table, Number.isFinite(numeric) ? numeric : DEFAULT_WEIGHT);
}
