// src/screens/scan/ScanReadingScreen.tsx
//
// Screen 02 of the item scanner — reading in progress.
//
// The frozen shot sits under a green sweep, boxes land on what was found, and
// the rows fill in underneath with the provenance chip each item ended up with.
//
// One honesty rule governs this screen, and it is the same one the rest of the
// scanner follows. Recognition is a single round trip: nothing is known until
// the answer lands, so nothing is *shown* until then either. The bar eases
// toward a ceiling short of the end while it waits — saying "still working",
// never "nearly done" — the count pill stays absent rather than climbing
// through invented numbers, and the rows below are skeletons.
//
// What happens on arrival is an entrance, not a simulation: the real rows are
// dealt out one at a time by ScanModal so the user can read them as they land
// rather than being handed six at once. Every row that appears is a row the
// scanner actually has.

import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Image, Animated, Easing, TouchableOpacity } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Text from '../../components/Text';
import { fonts, type } from '../../theme/typography';
import { ScanCandidate, provenanceChip } from '../../services/scan';
import { Capture, DateChip, HIT_SLOP, ItemThumb } from './atoms';
import { makeStyles } from '../../theme/makeStyles';
import { useColors } from '../../theme/ThemeProvider';
import { space } from '../../theme/spacing';

// A recognised region on the frozen capture. Fractions of the frame rather
// than points, so the same data survives any preview size.
export type ScanRegion = {
  id: string;
  /** All 0–1, relative to the capture. */
  rect: { x: number; y: number; width: number; height: number };
  label?: string;
  status: 'confirmed' | 'candidate';
};

const SWEEP_DURATION = 1100;

// The progress prop arrives in steps. Easing each step over slightly longer
// than the interval that produces it makes the bar read as one continuous
// movement rather than a series of jumps — the gap is what keeps it moving
// while it waits for the next value.
const PROGRESS_EASE_MS = 320;

// A box that appeared instantly would look like a UI element drawn over the
// photo. Landing it makes it read as something the scanner found.
const REGION_LAND_MS = 260;

const STILL_HEIGHT = 236;

// How many placeholder rows stand in before the answer lands. Two, because the
// number is unknown at that point and a taller stack of skeletons would be a
// claim about how much was found.
const SKELETON_COUNT = 2;

type Props = {
  photo: Capture | null;
  regions: ScanRegion[];
  /** How many items the read found. Null until the answer lands. */
  foundCount: number | null;
  /** The rows dealt out so far — a prefix of the finished list. */
  revealed: ScanCandidate[];
  /** 0–1. Never sits still — an unmoving bar reads as a hang. */
  progress: number;
  onCancel: () => void;
};

export default function ScanReadingScreen({
  photo,
  regions,
  foundCount,
  revealed,
  progress,
  onCancel,
}: Props) {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const sweep = useRef(new Animated.Value(0)).current;
  const fill = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(sweep, {
        toValue: 1,
        duration: SWEEP_DURATION,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [sweep]);

  useEffect(() => {
    Animated.timing(fill, {
      toValue: progress,
      duration: PROGRESS_EASE_MS,
      easing: Easing.out(Easing.quad),
      // Width is a layout property, so this one can't run on the UI thread.
      useNativeDriver: false,
    }).start();
  }, [fill, progress]);

  const fillWidth = fill.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });

  const stillWaiting = foundCount === null ? SKELETON_COUNT : foundCount - revealed.length;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <LinearGradient
        colors={[colors.washGreen, colors.washGreenFade]}
        start={{ x: 1, y: 0 }}
        end={{ x: 0.1, y: 0.5 }}
        style={styles.wash}
        pointerEvents="none"
      />

      <View style={styles.header}>
        <Text style={styles.title}>Reading it</Text>
        <TouchableOpacity onPress={onCancel} hitSlop={HIT_SLOP} activeOpacity={0.7}>
          <Text style={styles.cancel}>Cancel</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.still}>
        <LinearGradient colors={colors.captureDark} style={StyleSheet.absoluteFill} />
        {photo?.uri && (
          <Image source={{ uri: photo.uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        )}
        {/* The capture dims so the boxes and sweep read against it — the photo
            has done its job, the recognition is the subject now. */}
        <View style={styles.dim} />

        {regions.map((region, index) => (
          <RegionBox key={region.id} region={region} index={index} />
        ))}

        <Animated.View
          style={[
            styles.sweep,
            {
              transform: [
                {
                  translateY: sweep.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, STILL_HEIGHT],
                  }),
                },
              ],
            },
          ]}
        >
          <LinearGradient
            colors={['rgba(159,228,122,0)', 'rgba(159,228,122,0.3)', 'rgba(159,228,122,0)']}
            style={styles.sweepBand}
          />
          <View style={styles.sweepLine} />
        </Animated.View>

        {/* Only once there is a real number to show. A count that ticked upward
            during the call would be the one piece of theatre this screen
            refuses. */}
        {foundCount !== null && (
          <View style={styles.countPill}>
            <Text style={styles.countPillText}>
              {foundCount} {foundCount === 1 ? 'thing' : 'things'} in frame
            </Text>
          </View>
        )}
      </View>

      <View style={styles.body}>
        <Text style={styles.bodyTitle}>Reading dates and ripeness</Text>

        <View style={styles.progressTrack}>
          <Animated.View style={[styles.progressFill, { width: fillWidth }]}>
            <LinearGradient
              colors={[colors.primaryBright, colors.primaryMid]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
        </View>

        <View style={styles.rows}>
          {revealed.map((candidate) => (
            <View key={candidate.id} style={styles.row}>
              <ItemThumb
                size={32}
                tone={candidate.looseProduce ? 'warn' : 'good'}
                photo={photo}
                box={candidate.box}
              />
              <View style={styles.rowBody}>
                <Text style={styles.rowName} numberOfLines={1}>
                  {candidate.name}
                </Text>
                <DateChip chip={provenanceChip(candidate)} />
              </View>
            </View>
          ))}

          {/* Fading out down the stack, so the list reads as still filling
              rather than as rows that failed to load. */}
          {Array.from({ length: Math.max(0, stillWaiting) }).map((_, i) => (
            <View key={`skeleton-${i}`} style={[styles.row, { opacity: i === 0 ? 0.6 : 0.35 }]}>
              <ItemThumb size={32} tone="neutral" />
              <View style={styles.rowBody}>
                <View style={[styles.bone, { width: '58%', height: 11 }]} />
                <View style={[styles.bone, { width: '34%', height: 9, marginTop: space.xs2 }]} />
              </View>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

/** One detection box, landing rather than appearing. */
function RegionBox({ region, index }: { region: ScanRegion; index: number }) {
  const styles = useStyles();
  const colors = useColors();
  const enter = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(enter, {
      toValue: 1,
      duration: REGION_LAND_MS,
      delay: index * 70,
      easing: Easing.out(Easing.back(1.4)),
      useNativeDriver: true,
    }).start();
  }, [enter, index]);

  return (
    <Animated.View
      style={[
        styles.region,
        {
          left: `${region.rect.x * 100}%`,
          top: `${region.rect.y * 100}%`,
          width: `${region.rect.width * 100}%`,
          height: `${region.rect.height * 100}%`,
          opacity: enter,
          transform: [{ scale: enter.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) }],
        },
      ]}
    />
  );
}

const useStyles = makeStyles((colors) => ({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  wash: {
    ...StyleSheet.absoluteFillObject,
    bottom: undefined,
    height: 320,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.xxl,
    paddingTop: space.half,
  },
  title: {
    fontFamily: fonts.display,
    fontWeight: '800',
    fontSize: type.headline.fontSize,
    lineHeight: 31,
    color: colors.primaryDarker,
  },
  cancel: {
    fontWeight: '700',
    fontSize: type.body.fontSize,
    color: colors.textSecondary,
  },
  still: {
    height: STILL_HEIGHT,
    marginHorizontal: space.xxl,
    marginTop: space.lg,
    borderRadius: 26,
    overflow: 'hidden',
  },
  dim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(22,31,17,0.35)',
  },
  sweep: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: -44,
  },
  sweepBand: {
    height: 44,
  },
  sweepLine: {
    height: 2,
    backgroundColor: colors.greenBright,
  },
  region: {
    position: 'absolute',
    borderWidth: 2.5,
    borderColor: colors.greenBright,
    borderRadius: 12,
  },
  countPill: {
    position: 'absolute',
    top: 14,
    left: 14,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderRadius: 999,
    backgroundColor: 'rgba(251,246,235,0.92)',
  },
  countPillText: {
    fontWeight: '800',
    fontSize: type.micro.fontSize,
    lineHeight: 13,
    color: colors.primaryDarker,
  },
  body: {
    flex: 1,
    minHeight: 0,
    paddingHorizontal: space.xxl,
    paddingTop: space.xl,
  },
  bodyTitle: {
    fontFamily: fonts.display,
    fontWeight: '700',
    fontSize: type.subtitle.fontSize,
    lineHeight: 20,
    color: colors.primaryDarker,
    marginBottom: space.sm2,
  },
  progressTrack: {
    height: 8,
    borderRadius: 999,
    backgroundColor: colors.backgroundAlt,
    overflow: 'hidden',
    marginBottom: space.xl,
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
    overflow: 'hidden',
  },
  rows: {
    gap: space.sm2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
    borderRadius: 18,
    paddingVertical: space.md,
    paddingHorizontal: space.md2,
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
  },
  rowName: {
    fontWeight: '700',
    fontSize: type.bodySmall.fontSize,
    lineHeight: 18,
    color: colors.primaryDarker,
    marginBottom: space.xs2,
  },
  bone: {
    borderRadius: 6,
    backgroundColor: colors.divider,
  },
}));