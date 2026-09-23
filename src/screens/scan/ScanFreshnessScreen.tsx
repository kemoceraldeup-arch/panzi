// src/screens/scan/ScanFreshnessScreen.tsx
//
// Screen 05 of the item scanner — how ripe a piece of loose produce looks.
//
// This screen exists because loose fruit never carries a printed date, and the
// alternative to judging it is an empty field the user has to fill in from
// memory. So the scanner looks at the fruit and says what it sees.
//
// Which makes this the one screen where the app is furthest out on a limb, and
// the design answers that in three ways, all of which are load-bearing:
//
//   1. The verdict is a position on a scale, not a number. Four stages the user
//      can check against the fruit in their hand.
//   2. It shows its working. Two observations naming what was actually visible,
//      and a third row, in a different colour, saying outright that this is a
//      guess and not a printed date. That row is not decoration — it is the
//      thing that stops an estimate being read as fact.
//   3. The user can overrule it in one tap, and their pick wins.

import React from 'react';
import { Image, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Text from '../../components/Text';
import { fonts, type } from '../../theme/typography';
import { ScanCandidate } from '../../services/scan';
import {
  RIPENESS_LABELS,
  RIPENESS_STAGES,
  RipenessStage,
  isUrgentStage,
  produceTip,
  ripenessAdvice,
} from '../../utils/ripeness';
import { getDaysLeft } from '../../utils/freshness';
import { Capture, HIT_SLOP, ItemThumb } from './atoms';
import { makeStyles } from '../../theme/makeStyles';
import { useColors } from '../../theme/ThemeProvider';
import { space } from '../../theme/spacing';

// The hero crop is square and sized to the design's 158pt band, so the fruit
// fills it rather than floating in a letterboxed strip.
const CROP_SIZE = 158;

type Props = {
  candidate: ScanCandidate;
  photo?: Capture | null;
  onBack: () => void;
  onPickStage: (stage: RipenessStage) => void;
};

export default function ScanFreshnessScreen({
  candidate,
  photo,
  onBack,
  onPickStage,
}: Props) {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const stage = candidate.ripeness;
  const days = getDaysLeft(candidate.expiryDate) ?? 0;
  const tip = produceTip(candidate.name);
  const userSet = candidate.ripenessSource === 'user';

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
        <TouchableOpacity
          style={styles.backButton}
          onPress={onBack}
          hitSlop={HIT_SLOP}
          accessibilityLabel="Back to the review page"
        >
          <Ionicons name="chevron-back" size={20} color={colors.primaryDarker} />
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>
          {candidate.name}
        </Text>
        <TouchableOpacity onPress={onBack} hitSlop={HIT_SLOP} activeOpacity={0.7}>
          <Text style={styles.save}>Save</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: space.xxl + insets.bottom }]}
        showsVerticalScrollIndicator={false}
      >
        {/* The fruit itself, cropped from the capture. This screen asks the user
            to check a judgement about how something looks, so showing them what
            was looked at is the whole basis of the question. Falls back to the
            full shot when there is no box to crop to. */}
        <View style={styles.crop}>
          {candidate.box && photo?.width ? (
            <ItemThumb size={CROP_SIZE} tone="neutral" photo={photo} box={candidate.box} />
          ) : photo?.uri ? (
            <Image source={{ uri: photo.uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          ) : (
            <Text style={styles.cropCaption}>crop from your photo</Text>
          )}
        </View>

        {stage ? (
          <View style={styles.verdict}>
            <View style={styles.verdictHead}>
              <Text style={styles.verdictTitle}>{RIPENESS_LABELS[stage]}</Text>
              <Text style={[styles.verdictAdvice, isUrgentStage(stage) && styles.verdictUrgent]}>
                {ripenessAdvice(stage, days)}
              </Text>
            </View>

            <View style={styles.scaleRow}>
              {RIPENESS_STAGES.map((s) => (
                <View
                  key={s}
                  style={[styles.scaleSegment, s === stage && styles.scaleSegmentOn]}
                />
              ))}
            </View>
            <View style={styles.scaleRow}>
              {RIPENESS_STAGES.map((s) => (
                <Text
                  key={s}
                  style={[styles.scaleLabel, s === stage && styles.scaleLabelOn]}
                  numberOfLines={1}
                >
                  {RIPENESS_LABELS[s]}
                </Text>
              ))}
            </View>
          </View>
        ) : (
          <View style={styles.verdict}>
            <Text style={styles.verdictTitle}>Not judged</Text>
            <Text style={styles.blockedBody}>
              {candidate.ripenessBlocked ?? "I couldn't get a clear look at this one."}
            </Text>
            <Text style={styles.blockedBody}>Set it yourself below and I'll use that.</Text>
          </View>
        )}

        {stage && !userSet && candidate.ripenessNotes.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>How I judged it</Text>
            <View style={styles.notes}>
              {candidate.ripenessNotes.map((note, i) => (
                <View key={note} style={[styles.noteRow, i > 0 && styles.noteRowDivided]}>
                  <View style={styles.noteDot} />
                  <Text style={styles.noteText}>{note}</Text>
                </View>
              ))}
              {/* The caveat row. Different dot, muted text, and it never gets
                  dropped for brevity — everything above it is the app's opinion
                  about someone else's fruit. */}
              <View style={[styles.noteRow, styles.noteRowDivided]}>
                <View style={[styles.noteDot, styles.noteDotCaveat]} />
                <Text style={[styles.noteText, styles.noteTextCaveat]}>
                  A guess, not a printed date — correct me if it's off
                </Text>
              </View>
            </View>
          </>
        )}

        {userSet && (
          <View style={styles.userSet}>
            <Ionicons name="checkmark-circle" size={16} color={colors.primaryDark} />
            <Text style={styles.userSetText}>You set this one yourself.</Text>
          </View>
        )}

        <Text style={styles.sectionLabel}>{userSet ? 'Change it' : 'Not right? Set it yourself'}</Text>
        <View style={styles.stageRow}>
          {RIPENESS_STAGES.map((s) => {
            const selected = s === stage;
            return (
              <TouchableOpacity
                key={s}
                style={[styles.stageChip, selected && styles.stageChipOn]}
                onPress={() => onPickStage(s)}
                activeOpacity={0.7}
              >
                <Text style={[styles.stageChipText, selected && styles.stageChipTextOn]}>
                  {RIPENESS_LABELS[s]}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {tip && (
          <View style={styles.tip}>
            <Text style={styles.tipTitle}>{tip.title}</Text>
            <Text style={styles.tipBody}>{tip.body}</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  wash: {
    ...StyleSheet.absoluteFill,
    bottom: undefined,
    height: 320,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md2,
    paddingHorizontal: space.xxl,
    paddingTop: space.half,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 13,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    minWidth: 0,
    fontFamily: fonts.display,
    fontWeight: '800',
    fontSize: type.headline.fontSize,
    lineHeight: 28,
    color: colors.primaryDarker,
  },
  save: {
    fontWeight: '800',
    fontSize: type.body.fontSize,
    color: colors.primaryDark,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: space.xxl,
    paddingTop: space.lg2,
  },
  crop: {
    height: 158,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: colors.backgroundAlt,
    borderWidth: 1,
    borderColor: colors.tan,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: space.sm2,
    marginBottom: space.xl,
  },
  cropCaption: {
    fontWeight: '700',
    fontSize: type.micro.fontSize,
    color: colors.placeholderInk,
  },
  verdict: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
    borderRadius: 24,
    padding: space.lg2,
    marginBottom: space.xl,
  },
  verdictHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: space.md,
    marginBottom: space.lg,
  },
  verdictTitle: {
    fontFamily: fonts.display,
    fontWeight: '800',
    fontSize: type.headline.fontSize,
    lineHeight: 30,
    color: colors.primaryDarker,
  },
  verdictAdvice: {
    fontWeight: '700',
    fontSize: type.label.fontSize,
    color: colors.primaryDark,
  },
  verdictUrgent: {
    color: colors.rust,
  },
  blockedBody: {
    fontWeight: '600',
    fontSize: type.label.fontSize,
    lineHeight: 19,
    color: colors.textSecondary,
    marginTop: space.xs2,
  },
  scaleRow: {
    flexDirection: 'row',
    gap: space.xs2,
    marginBottom: space.sm2,
  },
  scaleSegment: {
    flex: 1,
    height: 9,
    borderRadius: 999,
    backgroundColor: colors.backgroundAlt,
  },
  scaleSegmentOn: {
    backgroundColor: colors.primaryMid,
  },
  scaleLabel: {
    flex: 1,
    fontWeight: '700',
    fontSize: type.micro.fontSize,
    lineHeight: 14,
    color: colors.mutedLight,
  },
  scaleLabelOn: {
    fontWeight: '800',
    color: colors.primaryDark,
  },
  sectionLabel: {
    fontWeight: '800',
    fontSize: type.micro.fontSize,
    lineHeight: 13,
    letterSpacing: 1.54,
    textTransform: 'uppercase',
    color: colors.tabInactive,
    marginBottom: space.sm2,
  },
  notes: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
    borderRadius: 20,
    overflow: 'hidden',
    marginBottom: space.xl,
  },
  noteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md2,
    paddingHorizontal: space.lg,
  },
  noteRowDivided: {
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  noteDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: colors.primary,
    flexShrink: 0,
  },
  noteDotCaveat: {
    backgroundColor: colors.tan,
  },
  noteText: {
    flex: 1,
    fontWeight: '600',
    fontSize: type.label.fontSize,
    lineHeight: 18,
    color: colors.primaryDarker,
  },
  noteTextCaveat: {
    color: colors.textSecondary,
  },
  userSet: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginBottom: space.xl,
  },
  userSetText: {
    fontWeight: '700',
    fontSize: type.label.fontSize,
    color: colors.primaryDark,
  },
  stageRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
    marginBottom: space.xl,
  },
  stageChip: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: space.md2,
    borderRadius: 999,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
  },
  stageChipOn: {
    backgroundColor: colors.primaryLighter,
    borderColor: colors.primaryLighter,
  },
  stageChipText: {
    fontWeight: '700',
    fontSize: type.label.fontSize,
    color: colors.textSecondary,
  },
  stageChipTextOn: {
    fontWeight: '800',
    color: colors.primaryDark,
  },
  tip: {
    backgroundColor: colors.primaryLighter,
    borderRadius: 20,
    paddingVertical: space.lg,
    paddingHorizontal: space.lg,
  },
  tipTitle: {
    fontWeight: '800',
    fontSize: type.label.fontSize,
    color: colors.primaryDark,
    marginBottom: space.xs2,
  },
  tipBody: {
    fontWeight: '600',
    fontSize: type.label.fontSize,
    lineHeight: 18,
    color: colors.primaryDark,
    opacity: 0.85,
  },
}));