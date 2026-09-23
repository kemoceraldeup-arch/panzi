// src/components/home/FloatingChatBubble.tsx
//
// The empty-pantry Home screen's only door into chat: a single floating unit
// fixed bottom-right, just above the tab bar — a white "Ask Panzi" label to
// the left of a circular mascot avatar, the two laid out as one row so the
// label never drifts somewhere the avatar isn't.
//
// The label has no separate tail shape. Its bottom-right corner is squared
// off (16 16 6 16) while the other three stay fully rounded, which reads as
// the bubble pointing at the avatar beside it without a triangle that can
// drift out of alignment as the row reflows.
//
// Fixed rather than draggable — an earlier version let this be dragged
// anywhere on screen, but a label that has to stay visually attached to the
// avatar needs the row to actually stay put.
//
// Rendered only while the pantry is empty, inside HomeScreen — which now
// stays mounted for as long as any tab is open (MainTabs keeps every tab's
// screen alive and only shows/hides the active one, so images don't reset on
// every switch). That means this component no longer remounts on its own
// when the user leaves and returns to Home, so the entrance animation is
// replayed explicitly off the `active` prop instead of off mount.

import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Image, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Text from '../Text';
import { TAB_BAR_CONTENT_HEIGHT } from '../../navigation/TabBar';
import { makeStyles } from '../../theme/makeStyles';
import { useColors } from '../../theme/ThemeProvider';
import { space } from '../../theme/spacing';
import { type } from '../../theme/typography';

const AVATAR_SIZE = 46;
const MARGIN = 20;
// Clears the floating tab bar: its own content height plus the device's
// bottom safe-area inset (added at render time) plus a hairline gap above it.
// Lower than that gap strictly requires, so the bubble sits in the open space
// just above the tab bar rather than crowding "or type one in" above it.
const TAB_BAR_CLEARANCE = 14;

// Pulse: a slow, small breathe rather than a bounce — "notice me" without
// "look away from whatever else is on screen".
const PULSE_SCALE = 1.08;
const PULSE_MS = 1100;

// Entrance: fade + a short slide in from the corner + a scale settle, run
// together rather than in sequence — a natural pop reads as one motion, not
// three consecutive ones. It holds briefly, then fades back out the same way
// — a reminder that appears and steps aside, not a label that's always there
// competing with the rest of the screen. Replays every time `active` flips
// back to true — see the note on the Props type below.
const ENTRANCE_DELAY_MS = 450;
const ENTRANCE_DURATION_MS = 380;
const ENTRANCE_SLIDE_FROM = 14;
const ENTRANCE_HOLD_MS = 1800;
const EXIT_DURATION_MS = 320;

type Props = {
  onPress: () => void;
  /**
   * Whether Home is the tab currently on screen. This component stays
   * mounted while it's rendered at all (see the note above), so this is what
   * triggers a fresh entrance animation each time the user comes back to
   * Home — a plain mount effect would only ever fire once.
   */
  active: boolean;
};

export default function FloatingChatBubble({ onPress, active }: Props) {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const pulse = useRef(new Animated.Value(0)).current;
  const entrance = useRef(new Animated.Value(0)).current;
  const wasActive = useRef(false);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: PULSE_MS,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: PULSE_MS,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  useEffect(() => {
    const justArrived = active && !wasActive.current;
    wasActive.current = active;
    if (!justArrived) return;

    entrance.setValue(0);
    const timer = setTimeout(() => {
      Animated.sequence([
        Animated.timing(entrance, {
          toValue: 1,
          duration: ENTRANCE_DURATION_MS,
          easing: Easing.out(Easing.back(1.4)),
          useNativeDriver: true,
        }),
        Animated.delay(ENTRANCE_HOLD_MS),
        Animated.timing(entrance, {
          toValue: 0,
          duration: EXIT_DURATION_MS,
          easing: Easing.in(Easing.ease),
          useNativeDriver: true,
        }),
      ]).start();
    }, ENTRANCE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [active, entrance]);

  const avatarScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, PULSE_SCALE] });
  const entranceOpacity = entrance;
  const entranceTranslateX = entrance.interpolate({
    inputRange: [0, 1],
    outputRange: [ENTRANCE_SLIDE_FROM, 0],
  });
  const entranceScale = entrance.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] });

  return (
    <View
      style={[
        styles.wrap,
        { bottom: insets.bottom + TAB_BAR_CONTENT_HEIGHT + TAB_BAR_CLEARANCE, right: MARGIN },
      ]}
      pointerEvents="box-none"
    >
      <TouchableOpacity
        style={styles.touchable}
        onPress={onPress}
        activeOpacity={0.85}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        {/* Only the label pops in — the avatar is on screen immediately and
            just breathes via `pulse`, so the two don't read as one entrance. */}
        <Animated.View
          style={[
            styles.label,
            {
              opacity: entranceOpacity,
              transform: [{ translateX: entranceTranslateX }, { scale: entranceScale }],
            },
          ]}
        >
          <Text style={styles.labelText}>Ask Panzi</Text>
        </Animated.View>

        <Animated.View style={[styles.avatar, { transform: [{ scale: avatarScale }] }]}>
          <Image
            source={require('../../../assets/mascot/panzi-face.png')}
            style={styles.avatarImage}
            resizeMode="cover"
          />
        </Animated.View>
      </TouchableOpacity>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  wrap: {
    position: 'absolute',
    // Above page content, below the tab bar (elevation 8) and any modal.
    zIndex: 5,
    elevation: 5,
  },
  touchable: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm2,
    // Clears the 44pt minimum hit target even though the visible label is
    // shorter than that.
    minHeight: 44,
  },
  label: {
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderBottomLeftRadius: 16,
    // The squared corner is the only "tail" — it points at the avatar beside
    // it without a separate triangle shape to keep aligned.
    borderBottomRightRadius: 6,
    paddingHorizontal: 11,
    paddingVertical: space.xs,
    shadowColor: colors.shadow,
    shadowOpacity: 0.13,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 5 },
    elevation: 4,
  },
  labelText: {
    fontWeight: '700',
    fontSize: type.bodySmall.fontSize - 1,
    color: colors.primary,
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    backgroundColor: colors.card,
    borderWidth: 3,
    borderColor: colors.white,
    overflow: 'hidden',
    shadowColor: colors.shadow,
    shadowOpacity: 0.16,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 5 },
    elevation: 6,
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
}));
