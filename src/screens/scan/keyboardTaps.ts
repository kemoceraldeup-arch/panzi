// src/screens/scan/keyboardTaps.ts
//
// Tapping any control on the review page puts the keyboard away.
//
// The page's ScrollView keeps the keyboard up through taps
// (keyboardShouldPersistTaps="handled") so a button press lands on the first
// try instead of only closing the keyboard — but that also left the keyboard
// covering the card after every pill, stepper and picker tap. The page now
// dismisses it itself, on a tap that is neither a scroll nor inside a text
// field: a text field marks its own touches here, on the way up, before the
// page sees them, so tapping back into a field never bounces the keyboard.

import { GestureResponderEvent, Keyboard } from 'react-native';

// A finger that travels further than this between down and up was scrolling.
const TAP_SLOP = 10;

let touchInField = false;

/** onTouchStart for a text field or the box around one. */
export function markTextFieldTouch() {
  touchInField = true;
}

/** onTouchStart/onTouchEnd for the page — dismisses on a tap outside any
 *  text field. One instance per screen. */
export function keyboardDismissOnTap() {
  let start: { x: number; y: number; inField: boolean } | null = null;
  return {
    onTouchStart(e: GestureResponderEvent) {
      start = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY, inField: touchInField };
      touchInField = false;
    },
    onTouchEnd(e: GestureResponderEvent) {
      const began = start;
      start = null;
      if (!began || began.inField) return;
      const moved = Math.hypot(e.nativeEvent.pageX - began.x, e.nativeEvent.pageY - began.y);
      if (moved <= TAP_SLOP) Keyboard.dismiss();
    },
  };
}
