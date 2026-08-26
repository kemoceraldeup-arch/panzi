// src/screens/scan/ScanPermissionScreen.tsx
//
// State G of the scan handoff — camera permission, asked in Panzi's own screen
// *before* the system dialog, so declining here costs nothing. Typing is
// offered as a real alternative rather than a dead end.
//
// ⚠️ PRIVACY COPY — READ BEFORE EDITING
//
// The design mock reads "Photos are read on your phone and deleted right
// after", and the handoff flags it: "Only claim these if they are true of the
// implementation. If recognition happens server-side, the first line must be
// rewritten before ship."
//
// Recognition is server-side — the capture is sent to a Cloud Function that
// calls the model — so the mock's wording would be false, and false in a
// permission prompt. It is reworded below. If reading ever moves on-device,
// the original line can come back; until then, do not "restore" it to match
// the mock, and make sure the function keeps not storing the image.

import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Text from '../../components/Text';
import Mascot from '../../components/Mascot';
import { fonts, type } from '../../theme/typography';
import { makeStyles } from '../../theme/makeStyles';
import { useColors } from '../../theme/ThemeProvider';
import { space } from '../../theme/spacing';

// The medallion, and the art inside it. The character art is drawn on a solid
// cream backdrop rather than transparency, so it has to be clipped by a round
// container — dropped in bare it renders its own backdrop as a grey box. Same
// approach PulsingMascot takes for the small chat avatar.
const MEDALLION = 168;
const MASCOT_ART = 152;

// How far outside the medallion the viewfinder brackets sit.
const BRACKET_INSET = 14;

const REASSURANCES = [
  'Photos are sent to be read, then discarded — never stored',
  'You approve every item before it’s added',
];

type Props = {
  /** A permanently denied camera can't be re-prompted, only sent to Settings. */
  blocked: boolean;
  onClose: () => void;
  onAllow: () => void;
  onTypeInstead: () => void;
};

export default function ScanPermissionScreen({
  blocked,
  onClose,
  onAllow,
  onTypeInstead,
}: Props) {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.container}>
      {/* The Home wash — two soft radials over cream. Layered as two gradients
          because RN has no multi-background shorthand. */}
      <LinearGradient
        colors={[colors.washGreen, colors.washGreenFade]}
        start={{ x: 1, y: 0 }}
        end={{ x: 0.2, y: 0.55 }}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        colors={[colors.washPeach, colors.washPeachFade]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0.7, y: 0.5 }}
        style={StyleSheet.absoluteFill}
      />

      <View style={[styles.top, { paddingTop: insets.top + 6 }]}>
        <TouchableOpacity style={styles.close} onPress={onClose} hitSlop={HIT_SLOP}>
          <Ionicons name="close" size={19} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      <View style={styles.body}>
        {/* Panzi framed the way the camera frames a shelf. The brackets are the
            viewfinder's own geometry — 34pt arms, 3pt strokes, 14pt radius —
            recoloured for cream, so this screen reads as the front door to the
            scanner rather than a generic permission ask. */}
        <View style={styles.mascotWrap}>
          <View style={styles.medallion}>
            <Mascot size={MASCOT_ART} pose="scan" />
          </View>
          <View style={[styles.corner, styles.cornerTopLeft]} />
          <View style={[styles.corner, styles.cornerTopRight]} />
          <View style={[styles.corner, styles.cornerBottomLeft]} />
          <View style={[styles.corner, styles.cornerBottomRight]} />
        </View>

        <Text style={styles.title}>Let me see your shelves</Text>
        <Text style={styles.blurb}>
          Point the camera at your groceries, a receipt, or a use-by date and I’ll fill the pantry
          in for you.
        </Text>

        <View style={styles.card}>
          {REASSURANCES.map((line) => (
            <View key={line} style={styles.cardRow}>
              <View style={styles.tick}>
                <Ionicons name="checkmark" size={12} color={colors.primaryActive} />
              </View>
              <Text style={styles.cardText}>{line}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={[styles.footer, { paddingBottom: space.xxl2 + insets.bottom }]}>
        <TouchableOpacity style={styles.primary} onPress={onAllow} activeOpacity={0.85}>
          <Text style={styles.primaryText}>{blocked ? 'Open Settings' : 'Allow camera'}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onTypeInstead} hitSlop={HIT_SLOP}>
          <Text style={styles.secondaryText}>I’ll type things in instead</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const HIT_SLOP = { top: 10, bottom: 10, left: 10, right: 10 };

const useStyles = makeStyles((colors) => ({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  top: {
    paddingHorizontal: space.xl,
  },
  close: {
    width: 38,
    height: 38,
    borderRadius: 999,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    minHeight: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xxxl,
  },
  mascotWrap: {
    width: MEDALLION + BRACKET_INSET * 2,
    height: MEDALLION + BRACKET_INSET * 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.xxl2,
  },
  medallion: {
    width: MEDALLION,
    height: MEDALLION,
    borderRadius: 999,
    backgroundColor: colors.primaryLighter,
    borderWidth: 3,
    borderColor: colors.primaryLine,
    alignItems: 'center',
    justifyContent: 'center',
    // The clip. Without it the art's own cream backdrop shows as a rectangle.
    overflow: 'hidden',
  },
  corner: {
    position: 'absolute',
    width: 34,
    height: 34,
    // The camera draws these in translucent cream because it sits on dark
    // video; on this screen's wash that would be invisible.
    borderColor: colors.primaryLight,
  },
  cornerTopLeft: {
    top: 0,
    left: 0,
    borderTopWidth: 3,
    borderLeftWidth: 3,
    borderTopLeftRadius: 14,
  },
  cornerTopRight: {
    top: 0,
    right: 0,
    borderTopWidth: 3,
    borderRightWidth: 3,
    borderTopRightRadius: 14,
  },
  cornerBottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
    borderBottomLeftRadius: 14,
  },
  cornerBottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 3,
    borderRightWidth: 3,
    borderBottomRightRadius: 14,
  },
  title: {
    fontFamily: fonts.display,
    fontWeight: '800',
    fontSize: type.display.fontSize,
    lineHeight: 35,
    color: colors.primaryDarker,
    marginBottom: space.md,
    textAlign: 'center',
  },
  blurb: {
    fontWeight: '400',
    fontSize: type.body.fontSize,
    lineHeight: 23,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: space.xxl2,
  },
  card: {
    width: '100%',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
    borderRadius: 22,
    paddingVertical: space.lg,
    paddingHorizontal: space.lg2,
    gap: space.md,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
  },
  tick: {
    width: 20,
    height: 20,
    borderRadius: 999,
    backgroundColor: colors.primaryLighter,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardText: {
    flex: 1,
    fontWeight: '600',
    fontSize: type.label.fontSize,
    lineHeight: 19,
    color: colors.primaryDarker,
  },
  footer: {
    paddingHorizontal: space.xxl,
    gap: space.md,
    alignItems: 'center',
  },
  primary: {
    width: '100%',
    height: 54,
    borderRadius: 16,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: {
    fontWeight: '800',
    fontSize: type.bodyLarge.fontSize,
    color: colors.onAccent,
  },
  secondaryText: {
    fontWeight: '700',
    fontSize: type.body.fontSize,
    color: colors.primaryDark,
  },
}));