// src/components/home/RemovalChart.tsx
//
// Home's "Where your food went": every item taken off the shelves, counted by
// why. The headline is the one number the chart exists for — how much of what
// left the kitchen was actually eaten — and the bars underneath say where the
// rest went.
//
// Horizontal bars rather than a pie: four reasons, each label in its own
// column, and comparing lengths along a
// shared baseline is the thing people read accurately. Rows stay in a fixed
// order rather than sorting by count, so "Spoiled" is in the same place every
// time the user checks whether it is shrinking.
//
// Two colours, not four: eaten or wasted is the distinction that matters, and
// each row already says its reason in words. Colours are the chart tokens in
// palettes.ts, validated for colour-blind separation in both schemes.

import React from 'react';
import { TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Text from '../Text';
import {
  REMOVAL_LABELS,
  REMOVAL_REASONS,
  RemovalReason,
  isWaste,
} from '../../services/removals';
import { fonts, type } from '../../theme/typography';
import { makeStyles } from '../../theme/makeStyles';
import { useColors } from '../../theme/ThemeProvider';
import { space } from '../../theme/spacing';

type Props = {
  counts: Record<RemovalReason, number>;
  /** Opens Pantry History, where each removal is listed. */
  onViewMore: () => void;
};

export default function RemovalChart({ counts, onViewMore }: Props) {
  const styles = useStyles();
  const colors = useColors();

  const total = REMOVAL_REASONS.reduce((sum, r) => sum + counts[r], 0);
  const eaten = counts.consumed;
  const wasted = total - eaten;
  const max = Math.max(1, ...REMOVAL_REASONS.map((r) => counts[r]));

  if (total === 0) {
    return (
      <View style={styles.card}>
        <Text style={styles.eyebrow}>Where your food went</Text>
        <Text style={styles.emptyText}>
          Nothing taken off the shelves yet. When you use something up or throw it out, you&apos;ll
          see here how much got eaten and how much went to waste.
        </Text>
      </View>
    );
  }

  const eatenPct = Math.round((eaten / total) * 100);

  return (
    <View style={styles.card}>
      <View
        accessible
        accessibilityLabel={
          `Where your food went. ${eatenPct} percent eaten. ` +
          REMOVAL_REASONS.map((r) => `${REMOVAL_LABELS[r]}: ${counts[r]}`).join(', ')
        }
      >
        <Text style={styles.eyebrow}>Where your food went</Text>
        <View style={styles.headlineRow}>
          <Text style={styles.headline}>{eatenPct}%</Text>
          <Text style={styles.headlineLabel}>eaten</Text>
        </View>
        <Text style={styles.summary}>
          {eaten} of {total} removal{total === 1 ? '' : 's'} eaten · {wasted} wasted
        </Text>

        <View style={styles.bars}>
          {REMOVAL_REASONS.map((reason) => {
            const n = counts[reason];
            return (
              <View key={reason} style={styles.barRow}>
                <Text style={styles.barLabel} numberOfLines={1}>
                  {REMOVAL_LABELS[reason]}
                </Text>
                <View style={styles.track}>
                  {n > 0 && (
                    <View
                      style={[
                        styles.bar,
                        {
                          width: `${(n / max) * 100}%`,
                          backgroundColor: isWaste(reason) ? colors.chartWasted : colors.chartEaten,
                        },
                      ]}
                    />
                  )}
                </View>
                <Text style={[styles.barValue, n === 0 && styles.barValueZero]}>{n}</Text>
              </View>
            );
          })}
        </View>

        <View style={styles.legend}>
          <LegendKey color={colors.chartEaten} label="Eaten" />
          <LegendKey color={colors.chartWasted} label="Wasted" />
        </View>
      </View>

      <TouchableOpacity
        style={styles.viewMore}
        onPress={onViewMore}
        hitSlop={HIT_SLOP}
        accessibilityRole="button"
        accessibilityLabel="View more in Pantry history"
      >
        <Text style={styles.viewMoreText}>View More</Text>
        <Ionicons name="chevron-forward" size={14} color={colors.primaryDark} />
      </TouchableOpacity>
    </View>
  );
}

function LegendKey({ color, label }: { color: string; label: string }) {
  const styles = useStyles();
  return (
    <View style={styles.legendKey}>
      <View style={[styles.legendSwatch, { backgroundColor: color }]} />
      <Text style={styles.legendLabel}>{label}</Text>
    </View>
  );
}

const HIT_SLOP = { top: 12, bottom: 12, left: 12, right: 12 };

const LABEL_WIDTH = 104;

const useStyles = makeStyles((colors) => ({
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.borderWarm,
    borderRadius: 22,
    paddingHorizontal: space.lg,
    paddingVertical: space.md2,
  },
  eyebrow: {
    fontWeight: '800',
    fontSize: type.micro.fontSize,
    letterSpacing: 1.54,
    textTransform: 'uppercase',
    color: colors.tabInactive,
    marginBottom: space.sm,
  },
  emptyText: {
    fontWeight: '600',
    fontSize: type.label.fontSize,
    lineHeight: 19,
    color: colors.textSecondary,
  },
  headlineRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: space.xs2,
  },
  headline: {
    fontFamily: fonts.display,
    fontWeight: '800',
    fontSize: type.headline.fontSize,
    color: colors.primaryDarker,
  },
  headlineLabel: {
    fontWeight: '700',
    fontSize: type.bodySmall.fontSize,
    color: colors.textSecondary,
  },
  summary: {
    fontWeight: '600',
    fontSize: type.caption.fontSize,
    color: colors.textSecondary,
    marginTop: space.xs,
  },
  bars: {
    marginTop: space.lg,
    gap: space.sm2,
  },
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm2,
  },
  barLabel: {
    width: LABEL_WIDTH,
    fontWeight: '700',
    fontSize: type.caption.fontSize,
    color: colors.textDark,
  },
  track: {
    flex: 1,
    height: 12,
    justifyContent: 'center',
  },
  // Thin, square at the baseline, rounded only at the data end.
  bar: {
    height: 10,
    minWidth: 4,
    borderTopRightRadius: 4,
    borderBottomRightRadius: 4,
  },
  barValue: {
    minWidth: 22,
    textAlign: 'right',
    fontWeight: '800',
    fontSize: type.caption.fontSize,
    color: colors.primaryDarker,
  },
  barValueZero: {
    color: colors.mutedLight,
  },
  legend: {
    flexDirection: 'row',
    gap: space.lg,
    marginTop: space.md2,
  },
  legendKey: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs2,
  },
  legendSwatch: {
    width: 10,
    height: 10,
    borderRadius: 3,
  },
  legendLabel: {
    fontWeight: '600',
    fontSize: type.caption.fontSize,
    color: colors.textSecondary,
  },
  viewMore: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: space.xs,
    marginTop: space.md,
    paddingVertical: space.sm,
  },
  viewMoreText: {
    fontWeight: '700',
    fontSize: type.label.fontSize,
    color: colors.primaryDark,
  },
}));
