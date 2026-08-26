// src/theme/dishLooks.ts
//
// The picture system for recipes.
//
// There are no photographs here, on purpose. Generating one per suggestion
// costs more than the recipe and takes longer than the rest of the call; a
// stock library needs licensing and, worse, returns confidently wrong food —
// searching "adobo" gives you Mexican chillies and "sinigang" gives you a
// generic bowl of soup. A wrong photo is worse than no photo, because the user
// believes it.
//
// So the model names what *kind* of dish it is and the app draws that: a brand
// gradient with a glyph on it. It cannot be wrong about a dish it never claimed
// to photograph.
//
// The glyphs are emoji because they need no asset pipeline and render at any
// size. When there is commissioned illustration to replace them, this file is
// the only one that changes — nothing else knows how a dish is drawn.

// No palette import, on purpose.
//
// These gradients are artwork standing in for a photograph, not chrome — the
// same reasoning that leaves the camera screens out of theming. They carry
// white text over a scrim, so they have to stay saturated in both schemes; if
// they followed the theme, the dark palette's paler greens would invert the
// gradient's direction and the text on top would need a different scrim per
// mode. A dish tile that looks the same at midnight is the intended behaviour.
//
// The values are the light palette's, frozen here deliberately.

export type DishLook =
  | 'rice'
  | 'noodles'
  | 'soup'
  | 'stew'
  | 'grilled'
  | 'fried'
  | 'seafood'
  | 'chicken'
  | 'vegetables'
  | 'bread'
  | 'merienda'
  | 'dessert'
  | 'drink'
  | 'other';

export const DISH_LOOKS: DishLook[] = [
  'rice',
  'noodles',
  'soup',
  'stew',
  'grilled',
  'fried',
  'seafood',
  'chicken',
  'vegetables',
  'bread',
  'merienda',
  'dessert',
  'drink',
  'other',
];

// Five gradients across fourteen families, not fourteen gradients. Three cards
// sit on screen together and have to read as one designed set rather than a
// colour chart — repetition is what makes that happen.
type Gradient = readonly [string, string];

const GREEN: Gradient = ['#6CBF3F', '#3E7D2A'];
const DEEP_GREEN: Gradient = ['#4FA83A', '#2F6B22'];
const WARM: Gradient = ['#E2662C', '#C2571F'];
const AMBER: Gradient = ['#E5A100', '#C2571F'];
const SOFT: Gradient = ['#E4CFA3', '#E2662C'];

type Look = {
  glyph: string;
  gradient: Gradient;
};

const LOOKS: Record<DishLook, Look> = {
  rice: { glyph: '🍚', gradient: DEEP_GREEN },
  noodles: { glyph: '🍜', gradient: DEEP_GREEN },
  soup: { glyph: '🍲', gradient: GREEN },
  vegetables: { glyph: '🥬', gradient: GREEN },
  stew: { glyph: '🥘', gradient: WARM },
  grilled: { glyph: '🍢', gradient: WARM },
  chicken: { glyph: '🍗', gradient: WARM },
  fried: { glyph: '🍳', gradient: AMBER },
  seafood: { glyph: '🐟', gradient: AMBER },
  bread: { glyph: '🥖', gradient: AMBER },
  merienda: { glyph: '🍡', gradient: SOFT },
  dessert: { glyph: '🍮', gradient: SOFT },
  drink: { glyph: '☕', gradient: SOFT },
  other: { glyph: '🍽️', gradient: SOFT },
};

/**
 * Read a dish family off whatever the model (or an old cached suggestion)
 * supplied, falling back to a neutral one.
 *
 * Same defensiveness as `readDateSource` in services/pantry.ts, and for the
 * same reason: suggestions cached before this field existed will come back
 * without it, and a card is not worth crashing a screen over.
 */
export function lookFor(value: unknown): DishLook {
  return DISH_LOOKS.includes(value as DishLook) ? (value as DishLook) : 'other';
}

export function dishGlyph(look: unknown): string {
  return LOOKS[lookFor(look)].glyph;
}

export function dishGradient(look: unknown): Gradient {
  return LOOKS[lookFor(look)].gradient;
}
