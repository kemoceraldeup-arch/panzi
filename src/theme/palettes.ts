// src/theme/palettes.ts
//
// The two palettes, key for key.
//
// Panzi is a warm cream-and-green app, so its dark mode is a warm charcoal
// rather than the usual blue-grey or pure black. A cold dark mode would make
// the mascot, the peach accents and the whole "kitchen at home" feeling look
// borrowed from somewhere else. The browns underneath are the same hue family
// as the cream — it reads as the lights being turned down, not as a different
// app.
//
// Every key exists in both palettes. That is what lets a screen keep saying
// `colors.card` and get the right answer either way, and it is enforced by the
// `Palette` type below: adding a token to one and forgetting the other is a
// compile error, not a screen that renders black on black at midnight.
//
// ── On the three tokens that split ──────────────────────────────────────
//
// The old palette used `white` for two unrelated jobs: the fill of a card, and
// the colour of text sitting on a green button. Those pull in opposite
// directions the moment the lights go out — the card has to darken, and the
// button label must stay white or it vanishes into the green. Same story for
// `primaryDarker`, which was both the body-text colour and the fill of the
// featured card. So:
//
//   card     — a raised surface. White in light, lifted charcoal in dark.
//   onAccent — text and icons on a saturated fill. White in both.
//   inkFill  — a deliberately dark block (toast, active chip, featured card).
//
// Their old spellings still exist so nothing broke mid-migration, but new code
// should reach for these.

export type Scheme = 'light' | 'dark';

const light = {
  // ── Surfaces ────────────────────────────────────────────────────────
  background: '#F3E9D4', // main app background (warm cream)
  backgroundLight: '#FFF8E8', // card / panel background
  backgroundAlt: '#EDE6D6', // secondary panel background, hairline borders
  surface: '#FBF6EB', // input fields, elevated surfaces
  card: '#FFFFFF', // a raised card
  cardSunken: '#FBF6EB', // a well inside a card

  // ── Brand green ─────────────────────────────────────────────────────
  primary: '#6CBF3F',
  primaryDark: '#3E7D2A',
  primaryDarker: '#234A1B',
  primaryLight: '#A8DC7B',
  primaryLighter: '#E6F4D8',
  primaryWash: '#F4FAEC',
  primaryLine: '#DCEBC8',
  primarySoft: '#F1F4E8',
  primaryMid: '#4FA83A',
  primaryBright: '#7FD457',
  primaryActive: '#2F6B22',
  primaryPressed: '#5CAE33',

  // ── Accent ──────────────────────────────────────────────────────────
  accent: '#E2662C',
  accentDeep: '#C2571F',
  accentSoft: '#FBE5D6',
  accentMuted: '#FCF0D2',
  warmCard: '#FFF4EA',
  warmBorder: '#F3D9C2',
  warmDivider: '#F3E1D0',

  // ── Ink ─────────────────────────────────────────────────────────────
  textPrimary: '#17170F',
  textDark: '#4A5140',
  textSecondary: '#6A7263',
  textMuted: '#A3AC94',
  mutedLight: '#A9AE9C',
  divider: '#F1EBDE',
  tan: '#E4CFA3',
  tabInactive: '#8A9180',
  checkboxRing: '#D9D2C0',
  chevron: '#C3BCA9',
  borderWarm: '#EFE7D6',
  borderStrong: '#DCD3BC',
  textDisabled: '#C3BCA8',

  /** Text and icons on a saturated fill. White in BOTH schemes — this is the
   *  one that must not follow the theme. */
  onAccent: '#FFFFFF',
  /** A deliberately dark block: the toast, an active chip, the featured card. */
  inkFill: '#234A1B',
  /** Literal white, for the rare place that genuinely means the colour. */
  white: '#FFFFFF',

  // ── Status ──────────────────────────────────────────────────────────
  warning: '#E5A100',
  error: '#ff8a80',

  // ── Scan flow ───────────────────────────────────────────────────────
  //
  // The camera screens already sit on real video and were always dark, so most
  // of this is identical in both schemes. Changing it would mean designing
  // "dark mode for a screen that is a photograph".
  greenTagText: '#1B3D14',
  onCamera: 'rgba(251,246,235,0.14)',
  onCameraPressed: 'rgba(251,246,235,0.24)',
  cameraScrim: 'rgba(23,23,15,0.55)',
  textOnCamera: '#E4E9DC',
  photoRoll: '#3A4234',
  cameraDark: ['#2C3327', '#1B2018', '#12150F'] as [string, string, string],
  captureDark: ['#242A20', '#15180F'] as [string, string],

  amber: '#F0C752',
  amberText: '#A6761A',
  amberCard: '#FFFBF2',
  orangeCard: '#FFF7F2',
  washGreen: '#EBF5DC',
  washPeach: '#FBEAD6',

  // ── Fade-outs ───────────────────────────────────────────────────────
  //
  // The transparent end of a gradient that fades to nothing, and it MUST be the
  // same RGB as the opaque end.
  //
  // These were hardcoded as the light palette's cream at alpha 0, which looks
  // right until the page goes dark. React Native interpolates the red, green
  // and blue channels alongside the alpha, so a gradient from a dark colour to
  // *transparent cream* passes through half-opaque cream on the way — painting a
  // muddy grey haze across the whole screen instead of fading out. Matching the
  // RGB keeps the fade inside one hue, and only the alpha moves.
  washGreenFade: 'rgba(235,245,220,0)',
  washPeachFade: 'rgba(251,234,214,0)',
  backgroundLightFade: 'rgba(255,248,232,0)',
  surfaceFade: 'rgba(251,246,235,0)',

  creamCard: '#F7F3E4',
  amberBorder: '#F0C784',
  peachDeep: '#F6D2B6',
  rust: '#C7551F',
  rustMuted: '#A0532A',
  greenBright: '#9FE47A',
  placeholderInk: '#8A7A57',

  /**
   * The colour a raised surface casts.
   *
   * Was `primaryDarker` at every call site — fine while that token meant "very
   * dark green", but it inverts to a near-white in dark mode, which turns every
   * shadow in the app into a glow. A shadow is the absence of light and does
   * not follow the palette's ink; it only ever gets darker.
   */
  shadow: '#234A1B',

  // ── Profile hero ────────────────────────────────────────────────────
  //
  // Flat, not a gradient. The gradient ran mint into cream, and its last stop
  // was neutral enough to read as grey once the surroundings went dark — a
  // green card that turns grey at the bottom looks like a rendering fault
  // rather than a design. One colour holds its identity in both schemes.
  //
  // These were hardcoded hexes in the screen before, which is why this one card
  // stayed mint when everything around it went dark: a stylesheet token can be
  // swapped, a literal in a JSX prop cannot.
  heroFill: '#EDF6E1',
  avatarFill: '#D8EFC0',

  /** A translucent lift over a tinted surface — a pill on the hero card. White
   *  in light, where the surface is pale; barely-there white in dark, where a
   *  75% white pill would be the brightest thing on the screen. */
  overlayStrong: 'rgba(255,255,255,0.75)',
  /** The same idea, weaker — the onboarding scan rows. */
  overlaySoft: 'rgba(255,255,255,0.55)',

  /** Which way the status-bar glyphs go. */
  statusBar: 'dark-content' as 'dark-content' | 'light-content',

  /**
   * Body/helper copy — "Based on the food type…", "For packaged foods…" —
   * as distinct from `textSecondary`, which also carries smaller,
   * denser roles (chip text, captions) that don't want to move independently
   * of this one. Same value as `textSecondary` in light mode, where the
   * two already clear contrast comfortably; the dark value is genuinely
   * lighter than `textSecondary`, not the same value inverted, per the
   * dark-mode-legibility rule this token exists for.
   */
  mutedBody: '#6A7263',

  /**
   * The stepper's `+` key, dark mode only in spirit — light mode already
   * uses `primaryLighter` for this and it works there. In dark mode
   * `primaryLighter` sits almost exactly on top of `surface`/`card` (both
   * near-black), so the key reads as an empty hole next to `−`. This is a
   * separate, brighter green fill so the key is legible as its own
   * tappable shape rather than only by its glyph. Same value as
   * `primaryLighter` in light mode — nothing changes there.
   */
  plusKeySurface: '#E6F4D8',
};

export type Palette = typeof light;

const dark: Palette = {
  // ── Surfaces ────────────────────────────────────────────────────────
  //
  // Browns, not greys. Each step up is a real lift so a card reads as raised
  // without needing a border to prove it — a stack of near-identical greys is
  // what makes most dark modes feel flat.
  background: '#161411', // the page
  backgroundLight: '#1E1B17', // panels that were the lighter cream
  backgroundAlt: '#332E27', // hairline borders, secondary panels
  surface: '#252119', // inputs and wells
  // Was #24211C — within a point of `surface` on every channel, so a card
  // sitting on the page (or on a screen using `surface` as its own
  // background, like the scan review card) had nothing but its border to
  // prove it was raised at all. Lifted a real step above `surface` (+6%
  // luminance) so the card reads as elevated on its own; the border can
  // now drop to a hairline instead of doing all the work.
  card: '#2E2921', // a raised card
  cardSunken: '#1B1814', // a well inside a card — darker, not lighter

  // ── Brand green ─────────────────────────────────────────────────────
  //
  // Lifted about one step. The light-mode green is tuned for cream behind it;
  // on charcoal the same value reads muddy, and the darkest greens disappear
  // entirely. The near-black greens invert into pale washes, because their job
  // is contrast against the page and the page has moved.
  // NOT lifted, deliberately, and this is the one place the usual "brighten
  // everything on dark" advice is wrong. `primary` is a button FILL with white
  // text on it, and lifting it to #7FD457 dropped that label to 1.83:1 —
  // unreadable. At this value white sits at 3.0:1 and the green is still 6.1:1
  // against the page, so it reads as a solid button either way. Measured in
  // scratch/contrast, not guessed.
  primary: '#4FA83A',
  primaryDark: '#A8DC7B', // was a dark heading colour — now the light one
  primaryDarker: '#E8F3DC', // was body text on cream — now body text on charcoal
  primaryLight: '#5CAE33',
  primaryLighter: '#2A3A20', // soft green chip fill
  primaryWash: '#1F2A18',
  primaryLine: '#3A4F2C',
  primarySoft: '#20281B',
  primaryMid: '#7FD457',
  primaryBright: '#9FE47A',
  primaryActive: '#8FE065', // active tab — must read as brighter, not darker
  primaryPressed: '#458F33',

  // ── Accent ──────────────────────────────────────────────────────────
  // Same reasoning as `primary`: this is a fill under white text, and the
  // lifted #F0854A left it at 2.57:1. Unchanged from light, which passes at
  // 3.4:1 and is still 5.4:1 against the page.
  accent: '#E2662C',
  accentDeep: '#F0A277', // text on charcoal, never a fill — lifted on purpose
  accentSoft: '#3A2418',
  accentMuted: '#332618',
  warmCard: '#2B2018',
  warmBorder: '#453026',
  warmDivider: '#3A2A20',

  // ── Ink ─────────────────────────────────────────────────────────────
  //
  // Warm off-whites rather than pure white. #FFF on a warm dark is glary and
  // makes the browns look dirty by comparison.
  textPrimary: '#F2EDE0',
  textDark: '#D6D0C0',
  textSecondary: '#A39C8C',
  textMuted: '#7C7669',
  mutedLight: '#7C7669',
  divider: '#302B24', // 1.14:1 against `card` — any closer and it vanishes
  tan: '#6B5A3D',
  tabInactive: '#8A8375',
  checkboxRing: '#443E35',
  chevron: '#5C564B',
  borderWarm: '#2C2822',
  borderStrong: '#443E35',
  textDisabled: '#5C564B',

  // White on green stays white whatever the scheme — the fill underneath did
  // not change.
  onAccent: '#FFFFFF',
  // In dark mode the "dark block" has to go the other way to stand out from a
  // dark page, so it lifts instead of deepening.
  inkFill: '#3A4F2C',
  white: '#FFFFFF',

  // ── Status ──────────────────────────────────────────────────────────
  warning: '#F0C752',
  error: '#ff8a80',

  // ── Scan flow ───────────────────────────────────────────────────────
  // Unchanged: these sit on a live camera, which is not a themeable surface.
  greenTagText: '#1B3D14',
  onCamera: 'rgba(251,246,235,0.14)',
  onCameraPressed: 'rgba(251,246,235,0.24)',
  cameraScrim: 'rgba(23,23,15,0.55)',
  textOnCamera: '#E4E9DC',
  photoRoll: '#3A4234',
  cameraDark: ['#2C3327', '#1B2018', '#12150F'] as [string, string, string],
  captureDark: ['#242A20', '#15180F'] as [string, string],

  amber: '#F0C752',
  amberText: '#F0C752',
  amberCard: '#2A2418',
  orangeCard: '#2A1F18',
  // Was #1F2A18 — saturated enough, and close enough to the page's own
  // near-black, that a screen already carrying a lot of accent green (the
  // scan review header) read as muddy rather than tinted. Desaturated
  // toward the neutral background/backgroundLight hue family and dropped
  // well below the card surface's own luminance, so it reads as a faint
  // wash behind the header rather than competing with the card for
  // attention.
  washGreen: '#1A1D15',
  washPeach: '#2B2018',

  // Each one is its opaque partner above at alpha 0 — #1A1D15 is rgb(26,29,21),
  // and so on. Keep them in step by hand if those values ever change.
  washGreenFade: 'rgba(26,29,21,0)',
  washPeachFade: 'rgba(43,32,24,0)',
  backgroundLightFade: 'rgba(30,27,23,0)',
  surfaceFade: 'rgba(37,33,25,0)',

  creamCard: '#252119',
  amberBorder: '#5A4526',
  peachDeep: '#4A3324',
  rust: '#F0A277',
  rustMuted: '#D9A184',
  greenBright: '#9FE47A',
  placeholderInk: '#9A8C6E',

  // Pure black. On a dark page a shadow does most of its work as a soft edge
  // rather than a cast, so nothing at the call sites needs strengthening.
  shadow: '#000000',

  // Deep green-charcoal: 1.29:1 against the page, so it reads as a raised panel
  // without becoming the brightest thing on screen, and it keeps the green
  // identity the light version has. Measured, not eyeballed.
  heroFill: '#28331F',
  avatarFill: '#3F5730',

  // A whisper of white rather than a sheet of it. At the light values these
  // pills were near-white blocks on a dark green card, carrying pale green text
  // that would have been unreadable against them.
  overlayStrong: 'rgba(255,255,255,0.10)',
  overlaySoft: 'rgba(255,255,255,0.07)',

  statusBar: 'light-content',

  // Genuinely lighter than `textSecondary` (A39C8C), not that value
  // inverted — dark-mode body copy sitting on a card needs more lift than
  // the light-mode pairing does, since small/italic runs read dimmer at
  // the same measured contrast than a bold label does. 7.4:1 on the new
  // `card` token, well clear of the 4.5 floor.
  mutedBody: '#C0B9A9',

  // A real fill, not a near-miss of `surface`/`card` — the stepper `+`
  // key needs to read as a distinct tappable shape next to `−`, which
  // `primaryLighter` (2A3A20) cannot do this close to the card's own
  // brightness. 2.8:1 fill-distinctness against the stepper shell's
  // `surface` background, with the existing primaryDarker glyph still at
  // 5:1+ on top of it.
  plusKeySurface: '#4F6E3A',
};

export const palettes: Record<Scheme, Palette> = { light, dark };
