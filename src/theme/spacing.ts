// src/theme/spacing.ts
//
// The spacing scale. Every padding, margin and gap in the app comes from here,
// so that a gap in one screen means the same thing as the same gap in another.
//
// The steps are a 4pt grid with half-steps between them. A strict 4pt grid
// would have been tidier on paper, but every off-grid value in this codebase
// sat exactly halfway between two steps — the design was hand-tuned on a 2pt
// rhythm, and rounding all of it in one direction would have moved a hundred
// measurements by 2pt each for the sake of the diagram rather than the screen.
//
// So the half-steps are named rather than banned. What is gone is the third
// category: the odd one-offs (5, 7, 9, 11, 13, 15) that were nobody's decision
// and appeared once or twice each.
//
// Prefer the whole steps. Reach for a half-step when a whole one is visibly
// wrong, not to shave a couple of points off a layout that nearly fits.

export const space = {
  none: 0,

  // ── Whole steps — the 4pt grid ──────────────────────────────────────
  /** 4 — hairline separation, the gap inside a chip. */
  xs: 4,
  /** 8 — between related items in a row. */
  sm: 8,
  /** 12 — inside a small control. */
  md: 12,
  /** 16 — inside a card. */
  lg: 16,
  /** 20 — between blocks. */
  xl: 20,
  /** 24 — a screen's side margin, a card's inner padding. */
  xxl: 24,
  /** 32 — between sections. */
  xxxl: 32,
  /** 40 — a deliberate break in the page. */
  huge: 40,

  // ── Half-steps ──────────────────────────────────────────────────────
  //
  // Real steps, not rounding errors: the design leans on them, particularly
  // `md2` (14) and `sm2` (10) inside cards and controls.
  /** 2 */
  half: 2,
  /** 6 */
  xs2: 6,
  /** 10 */
  sm2: 10,
  /** 14 */
  md2: 14,
  /** 18 */
  lg2: 18,
  /** 22 */
  xl2: 22,
  /** 28 */
  xxl2: 28,
} as const;

export type Space = (typeof space)[keyof typeof space];
