// src/theme/colors.ts
//
// DEPRECATED — do not import this.
//
// This used to be the palette, a single static object every screen read at
// module load. That is exactly what made dark mode impossible: `StyleSheet
// .create` ran once with these values baked in, so swapping them later changed
// nothing on screen.
//
// The palettes now live in ./palettes.ts and are reached through:
//
//   const useStyles = makeStyles((colors) => ({ ... }));   // stylesheets
//   const colors = useColors();                            // JSX, icon tints
//
// It is kept only as a signpost. Importing the light palette directly would
// compile and look correct in the light theme, then quietly stay cream at
// midnight — the failure mode this whole file existed to cause.

export { palettes } from './palettes';
export type { Palette, Scheme } from './palettes';
