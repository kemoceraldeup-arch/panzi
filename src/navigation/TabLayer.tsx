// src/navigation/TabLayer.tsx
//
// One stacked layer inside MainTabs' tab body. Unlike AppTransition, this
// never unmounts its children — it only animates opacity/position and, once
// a hide has finished fading out, drops to `display: none` so it stops
// taking touches and paint time while parked. Staying mounted is the whole
// point: an <Image> that unmounts mid-decode (or right after) repaints from
// nothing on the way back in, which is what made Home's mascot flash blank
// on every tab switch. This keeps the same screen instance — and its already
// -decoded images — alive under the hood the entire time.

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet } from 'react-native';

type Props = {
  active: boolean;
  /** -1, 0 or 1 — which way this layer should slide in from when it becomes active. */
  direction: number;
  halfDuration?: number;
  slideDistance?: number;
  children: React.ReactNode;
};

const EASING = Easing.inOut(Easing.ease);

export default function TabLayer({
  active,
  direction,
  halfDuration = 130,
  slideDistance = 40,
  children,
}: Props) {
  const opacity = useRef(new Animated.Value(active ? 1 : 0)).current;
  const translateX = useRef(new Animated.Value(0)).current;
  // Kept out of the animated values so a layer that has never been active
  // (and so never dropped below `display: flex`) does not flash visible at
  // opacity 0 before its first animation starts.
  const [visible, setVisible] = useState(active);
  const wasActive = useRef(active);

  // Read at the moment a transition starts, so a direction update that
  // arrives after this layer has already begun animating cannot re-aim it
  // mid-flight.
  const directionRef = useRef(direction);
  directionRef.current = direction;

  useLayoutEffect(() => {
    if (active === wasActive.current) return;
    wasActive.current = active;

    if (active) {
      setVisible(true);
      const way = directionRef.current;
      translateX.setValue(way === 0 ? 0 : way * slideDistance);
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: halfDuration,
          easing: EASING,
          useNativeDriver: true,
        }),
        Animated.timing(translateX, {
          toValue: 0,
          duration: halfDuration,
          easing: EASING,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      const way = directionRef.current;
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 0,
          duration: halfDuration,
          easing: EASING,
          useNativeDriver: true,
        }),
        Animated.timing(translateX, {
          toValue: way === 0 ? 0 : -way * slideDistance,
          duration: halfDuration,
          easing: EASING,
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        // A newer switch back to `active` interrupts this and owns visibility
        // from here; only the animation that actually reached zero should
        // drop the layer out of the layout.
        if (finished) setVisible(false);
      });
    }
  }, [active, halfDuration, slideDistance, opacity, translateX]);

  return (
    <Animated.View
      pointerEvents={active ? 'auto' : 'none'}
      style={[
        StyleSheet.absoluteFill,
        { opacity, transform: [{ translateX }] },
        !visible && styles.parked,
      ]}
    >
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  parked: {
    display: 'none',
  },
});
