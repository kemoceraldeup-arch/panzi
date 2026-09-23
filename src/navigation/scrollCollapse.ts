// src/navigation/scrollCollapse.ts
//
// Drives the tab bar's Instagram-style collapse from whichever tab's own
// ScrollView the user happens to be dragging. One TabBar is shared across
// every tab (see MainTabs), but each tab owns its own ScrollView — so this
// is a single module-level Animated.Value, not per-screen state, and every
// screen's onScroll writes into the same value TabBar reads. Scrolling on
// Pantry and switching to Home should not reset the bar back to expanded;
// the bar's size is a property of "how far down the current screen is
// scrolled", not of which tab is active.
//
// Direction, not raw offset, is what the bar answers to — Instagram's own
// bar shrinks while a finger is actively dragging content up and grows back
// the moment it reverses, regardless of how far down the page already is.
// Reading raw scrollY instead would mean a long page stays permanently
// collapsed even at a dead stop, and a short page could never collapse at
// all — neither of which is the feel being copied here.

import { useCallback, useRef } from 'react';
import { Animated, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';

/** 0 = fully expanded, 1 = fully collapsed. Shared by every screen and by
 *  TabBar, so a scroll started on one tab and a switch to another leaves the
 *  bar exactly as collapsed as it already was. */
export const collapseProgress = new Animated.Value(0);

// A pull-to-refresh overscroll (negative offset) or the rubber-band past the
// bottom must never register as "scrolling down" — both would otherwise
// collapse or expand the bar off a drag that never actually moved the list.
const MIN_OFFSET = 0;
// Below this many points of vertical movement, a frame's delta is noise
// (a tiny sensor jitter, a light touch that barely moved) rather than an
// intentional scroll — without a floor here the bar flickers by fractions
// of a pixel on an almost-still list instead of holding steady.
const DIRECTION_THRESHOLD = 2;
// How many points of scroll it takes to go from fully expanded to fully
// collapsed — a deliberate, not-instant distance, so the shrink reads as
// following the finger rather than snapping at the first pixel of motion.
const COLLAPSE_DISTANCE = 90;

let lastOffsetY = 0;
// Mirrors collapseProgress's own number outside the Animated graph — kept by
// hand rather than read back off the Animated.Value (whose current value
// isn't something the public API exposes) so the baseline below is always
// exactly what was last written.
let currentProgress = 0;
// Where progress stood when the current drag direction began — collapse and
// expand each ride their own baseline so reversing direction starts
// unwinding from exactly the amount already collapsed, not from zero.
let progressAtDirectionStart = 0;
let offsetAtDirectionStart = 0;
let currentDirection: 1 | -1 | 0 = 0;

// Every tab screen stays mounted (see TabLayer), so a fling on the tab
// you're leaving keeps decelerating — and keeps firing onScroll — for a
// short while after you've already switched away from it. Without this,
// one of those late momentum events lands right after resetTabScroll()
// (MainTabs' goTo) and immediately re-collapses the bar the reset just
// expanded, which is why the bug this guards against only showed up
// sometimes: it depended entirely on whether a fling was still decelerating
// at the exact moment the tab switched. Comfortably longer than an
// iOS/Android scroll deceleration curve typically takes to settle, short
// enough that scrolling the newly-active tab a moment later is unaffected.
const SCROLL_LOCKOUT_MS = 400;
let ignoreScrollUntil = 0;

/** Bound directly to a ScrollView's onScroll (with scrollEventThrottle) —
 *  see useCollapseOnScroll below for the hook every tab screen actually
 *  uses. Exported on its own for anything that already owns a scroll
 *  handler and just needs to fold this in. */
export function handleTabScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
  // A screen switched away from can still be decelerating from a fling —
  // see SCROLL_LOCKOUT_MS above. lastOffsetY is deliberately not updated
  // here: the next event after the lockout lifts should compute its delta
  // against 0 (where resetTabScroll left it), not against a stale offset
  // from the tab that's no longer showing.
  if (Date.now() < ignoreScrollUntil) return;

  const y = Math.max(MIN_OFFSET, event.nativeEvent.contentOffset.y);
  const delta = y - lastOffsetY;
  lastOffsetY = y;

  // Pinned at the very top, full stop, regardless of how much upward travel
  // the 90pt COLLAPSE_DISTANCE would otherwise have wanted — a short list
  // (or one already near its top when the drag started) can hit y=0 after
  // less than 90pt of scrolling up, which would otherwise strand the bar
  // partway collapsed with nothing left to scroll to unwind it further.
  // Instagram's own bar is always fully expanded at the top of the page;
  // this is that guarantee rather than a side effect of the distance math.
  if (y <= MIN_OFFSET) {
    currentDirection = 0;
    offsetAtDirectionStart = 0;
    progressAtDirectionStart = 0;
    if (currentProgress !== 0) {
      currentProgress = 0;
      collapseProgress.setValue(0);
    }
    return;
  }

  if (Math.abs(delta) < DIRECTION_THRESHOLD) return;
  const direction: 1 | -1 = delta > 0 ? 1 : -1;

  if (direction !== currentDirection) {
    currentDirection = direction;
    offsetAtDirectionStart = y;
    progressAtDirectionStart = currentProgress;
  }

  const travelled = y - offsetAtDirectionStart;
  const delta01 = travelled / COLLAPSE_DISTANCE;
  const next = Math.min(1, Math.max(0, progressAtDirectionStart + delta01));
  currentProgress = next;
  collapseProgress.setValue(next);
}

/** Resets the shared collapse state back to fully expanded — used when a
 *  list that drives the bar is about to go away entirely (e.g. Pantry's key
 *  remount on a category change, or MainTabs' goTo on every tab switch), so
 *  the bar doesn't inherit a collapsed reading from a scroll position the
 *  new screen never actually reached. Also arms the lockout above, since a
 *  tab switch is exactly the moment a fling on the tab being left behind is
 *  most likely to still be decelerating. */
export function resetTabScroll() {
  lastOffsetY = 0;
  offsetAtDirectionStart = 0;
  progressAtDirectionStart = 0;
  currentDirection = 0;
  currentProgress = 0;
  ignoreScrollUntil = Date.now() + SCROLL_LOCKOUT_MS;
  Animated.timing(collapseProgress, {
    toValue: 0,
    duration: 220,
    useNativeDriver: false,
  }).start();
}

/** What every tab screen actually wires into its own ScrollView:
 *  `{ onScroll, scrollEventThrottle }`, spread straight onto the component.
 *  A stable identity across re-renders, since handleTabScroll itself never
 *  changes — this only exists so call sites don't each redeclare the same
 *  two props by hand. */
export function useCollapseOnScroll() {
  const props = useRef({ onScroll: handleTabScroll, scrollEventThrottle: 16 }).current;
  return props;
}

/** For a screen with several stacked scroll surfaces (a horizontal chip row
 *  alongside the main vertical list) — never wire this onto the horizontal
 *  one, only the vertical surface the tab bar should actually answer to. */
export const useCollapseOnScrollCallback = () => useCallback(handleTabScroll, []);
