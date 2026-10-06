// src/components/tour/TourOverlay.tsx
//
// One step of the app tour on screen: the app dimmed, a hole cut where the
// control being explained sits, and a bubble saying what it does.
//
// A Modal, so it sits above everything — the tab bar included — without
// TourProvider having to know how MainTabs stacks its layers. The whole
// surface swallows taps: only the bubble's own buttons move the tour, and the
// lit control can't be pressed through the hole, so the camera can't open
// halfway through step 3. Android's back button skips the tour.

import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Text from '../Text';
import { makeStyles } from '../../theme/makeStyles';
import { space } from '../../theme/spacing';
import { fonts, type } from '../../theme/typography';
import { Rect, SCREEN_MARGIN, TourStep, dimPath, holeFor, placeBubble } from '../../services/tour';

// Dark in both themes on purpose: the point is to push the app back so the
// lit control and the bubble are all that read.
const SCRIM = 'rgba(0, 0, 0, 0.72)';

type Props = {
  step: TourStep;
  /** The target's window rect, or null for a centred bubble. */
  rect: Rect | null;
  index: number;
  total: number;
  onNext: () => void;
  onSkip: () => void;
};

export default function TourOverlay({ step, rect, index, total, onNext, onSkip }: Props) {
  const styles = useStyles();
  const screen = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // The bubble's height depends on its copy, so it's measured, then placed.
  // Tagged with the step it was measured for: a new step starts unmeasured, so
  // the bubble stays hidden until it's measured rather than showing for a
  // frame at the previous step's height, where a taller one could cover the hole.
  const [measured, setMeasured] = useState<{ id: string; height: number } | null>(null);
  const bubbleHeight = measured && measured.id === step.id ? measured.height : null;

  const bubbleWidth = screen.width - SCREEN_MARGIN * 2;
  const hole = rect ? holeFor(rect) : null;
  const position =
    bubbleHeight === null
      ? null
      : placeBubble(hole, { width: bubbleWidth, height: bubbleHeight }, screen, insets);
  const last = index === total - 1;

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onSkip}>
      <Pressable style={StyleSheet.absoluteFill} accessible={false}>
        <Svg width={screen.width} height={screen.height} style={StyleSheet.absoluteFill}>
          <Path d={dimPath(screen, hole)} fill={SCRIM} fillRule="evenodd" />
        </Svg>

        {hole && (
          <View
            pointerEvents="none"
            style={[
              styles.ring,
              {
                left: hole.x,
                top: hole.y,
                width: hole.width,
                height: hole.height,
                borderRadius: hole.radius,
              },
            ]}
          />
        )}

        <View
          key={step.id}
          onLayout={(e) => setMeasured({ id: step.id, height: e.nativeEvent.layout.height })}
          style={[
            styles.bubble,
            {
              width: bubbleWidth,
              left: position?.x ?? SCREEN_MARGIN,
              top: position?.y ?? 0,
              opacity: position ? 1 : 0,
            },
          ]}
        >
          <Text style={styles.counter}>
            {index + 1} of {total}
          </Text>
          <Text style={styles.title}>{step.title}</Text>
          <Text style={styles.body}>{step.body}</Text>

          <View style={styles.actions}>
            {!last && (
              <TouchableOpacity onPress={onSkip} hitSlop={8} accessibilityRole="button">
                <Text style={styles.skip}>Skip tour</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.next}
              onPress={onNext}
              activeOpacity={0.85}
              accessibilityRole="button"
            >
              <Text style={styles.nextText}>{last ? 'Got it' : 'Next'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Pressable>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  ring: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: colors.primaryBright,
  },
  bubble: {
    position: 'absolute',
    backgroundColor: colors.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
    padding: space.lg,
  },
  counter: {
    fontWeight: '800',
    fontSize: type.micro.fontSize,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: colors.primaryDark,
  },
  title: {
    marginTop: space.xs,
    fontFamily: fonts.display,
    fontSize: type.subtitle.fontSize,
    lineHeight: type.subtitle.lineHeight,
    color: colors.primaryDarker,
  },
  body: {
    marginTop: space.xs,
    fontSize: type.body.fontSize,
    lineHeight: type.body.lineHeight,
    color: colors.textSecondary,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: space.lg,
    marginTop: space.md,
  },
  skip: {
    fontWeight: '700',
    fontSize: type.label.fontSize,
    color: colors.textSecondary,
  },
  next: {
    backgroundColor: colors.primary,
    borderRadius: 999,
    paddingVertical: space.sm2,
    paddingHorizontal: space.xl,
  },
  nextText: {
    fontWeight: '800',
    fontSize: type.label.fontSize,
    color: colors.onAccent,
  },
}));
