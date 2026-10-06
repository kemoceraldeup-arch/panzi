// src/services/tour.ts
//
// The first-run app tour's memory and arithmetic — everything about it that
// can be decided without a screen. Which tours this account has seen on this
// phone, which are due on the Home that's showing, which steps have something
// on screen to point at, and where the hole and the bubble go.
//
// Seen flags follow services/firstRun.ts: per account, on this phone, and an
// unreadable flag counts as seen — a storage hiccup should cost a new user the
// tour, never put a returning user through it on every launch.

import AsyncStorage from '@react-native-async-storage/async-storage';

export type TourId = 'main' | 'followup';
export const TOUR_IDS: TourId[] = ['main', 'followup'];

/** Home's two faces: the empty-pantry welcome, or the full set of cards. */
export type HomeLayout = 'welcome' | 'full';

export type Rect = { x: number; y: number; width: number; height: number };
export type Size = { width: number; height: number };
export type Hole = Rect & { radius: number };

export type TourStep = {
  id: string;
  /** The registered target to spotlight, or null for a centred bubble. */
  target: string | null;
  title: string;
  body: string;
};

/** Gap between the bubble and the screen edge, and the bubble's side margin. */
export const SCREEN_MARGIN = 16;
/** Gap between the hole and the bubble. */
export const BUBBLE_GAP = 14;
/** How far the hole reaches past the target on every side. */
export const HOLE_PADDING = 8;

const key = (uid: string, tour: TourId) => `panzi.tour.${tour}.${uid}`;

export async function hasSeenTour(uid: string, tour: TourId): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(key(uid, tour))) === '1';
  } catch {
    return true;
  }
}

export async function markTourSeen(uid: string, tour: TourId): Promise<void> {
  try {
    await AsyncStorage.setItem(key(uid, tour), '1');
  } catch {
    // Best effort; an unsaved flag means the tour shows once more.
  }
}

/**
 * The tours to run now, in order. The follow-up points at Ask Panzi and the
 * pantry card, which only exist on the full Home, so it waits for that.
 * `forced` is a replay from Help: everything the layout can show, seen or not.
 */
export function toursDue(
  layout: HomeLayout,
  seen: Record<TourId, boolean>,
  forced: boolean
): TourId[] {
  if (forced) return layout === 'full' ? ['main', 'followup'] : ['main'];
  const due: TourId[] = [];
  if (!seen.main) due.push('main');
  if (layout === 'full' && !seen.followup) due.push('followup');
  return due;
}

// A measured rect can land a fraction of a point past the edge from rounding.
const EDGE_TOLERANCE = 1;

function onScreen(rect: Rect | null | undefined, screen: Size): rect is Rect {
  if (!rect || rect.width <= 0 || rect.height <= 0) return false;
  return (
    rect.x >= -EDGE_TOLERANCE &&
    rect.y >= -EDGE_TOLERANCE &&
    rect.x + rect.width <= screen.width + EDGE_TOLERANCE &&
    rect.y + rect.height <= screen.height + EDGE_TOLERANCE
  );
}

/**
 * The steps that can actually be shown. A step whose target isn't mounted,
 * has no size, or sits off screen is dropped rather than spotlighting
 * nothing — so "Scan your first item" quietly disappears for someone who
 * already has food, and the counter only counts what is shown.
 * `bottomLimits` is a per-target lowest bottom edge (y + height, window
 * coordinates): a target with one must end at or above it, so a Home card
 * sitting under the tab bar doesn't pass for visible.
 */
export function visibleSteps(
  steps: TourStep[],
  rects: Record<string, Rect | null>,
  screen: Size,
  bottomLimits: Record<string, number> = {}
): TourStep[] {
  return steps.filter((step) => {
    if (step.target === null) return true;
    const rect = rects[step.target];
    if (!onScreen(rect, screen)) return false;
    const limit = bottomLimits[step.target];
    return limit === undefined || rect.y + rect.height <= limit + EDGE_TOLERANCE;
  });
}

/** The cut-out around a target: padded, a circle for round-ish buttons (the
 *  scan button, the bell), a soft rounded rectangle for anything wide. */
export function holeFor(target: Rect): Hole {
  const width = target.width + HOLE_PADDING * 2;
  const height = target.height + HOLE_PADDING * 2;
  const squarish = Math.abs(width - height) < 12;
  return {
    x: target.x - HOLE_PADDING,
    y: target.y - HOLE_PADDING,
    width,
    height,
    radius: squarish ? Math.min(width, height) / 2 : 18,
  };
}

/**
 * SVG path data for the dim layer: the whole screen, plus the hole as a
 * second subpath. Drawn with fillRule="evenodd", the hole is left unfilled.
 */
export function dimPath(screen: Size, hole: Hole | null): string {
  const outer = `M0 0H${screen.width}V${screen.height}H0Z`;
  if (!hole) return outer;
  const { x, y, width: w, height: h } = hole;
  const r = Math.min(hole.radius, w / 2, h / 2);
  return (
    outer +
    `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}` +
    `V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}` +
    `H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}` +
    `V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`
  );
}

/**
 * Where the bubble's top-left corner goes. Below the hole when it fits,
 * above it when it doesn't (the tab bar), centred when there's no hole, and
 * never outside the safe area.
 */
export function placeBubble(
  hole: Rect | null,
  bubble: Size,
  screen: Size,
  insets: { top: number; bottom: number }
): { x: number; y: number } {
  const x = Math.round((screen.width - bubble.width) / 2);
  const minY = insets.top + SCREEN_MARGIN;
  const maxY = screen.height - insets.bottom - SCREEN_MARGIN - bubble.height;
  const clamp = (y: number) => Math.min(Math.max(y, minY), Math.max(minY, maxY));

  if (!hole) return { x, y: Math.round(clamp((screen.height - bubble.height) / 2)) };

  const below = hole.y + hole.height + BUBBLE_GAP;
  if (below <= maxY) return { x, y: Math.round(below) };
  const above = hole.y - BUBBLE_GAP - bubble.height;
  if (above >= minY) return { x, y: Math.round(above) };
  return { x, y: Math.round(clamp(below)) };
}
