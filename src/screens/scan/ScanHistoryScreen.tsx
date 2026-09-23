// src/screens/scan/ScanHistoryScreen.tsx
//
// Screen 09 of the item scanner — past scans.
//
// This list is where the review page's promise gets kept. The user is allowed
// to add a batch with two rows still unresolved because the footer told them
// they could fix those later; this is later. A scan with unfinished data gets
// the same amber border its cards had and a full-width button straight into
// finishing it, so nothing with a missing date is ever stranded.
//
// Reached from the clock on the aiming screen.

import React from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Text from '../../components/Text';
import { fonts, type } from '../../theme/typography';
import { ScanRecord } from '../../services/scans';
import { HIT_SLOP } from './atoms';
import { makeStyles } from '../../theme/makeStyles';
import { useColors } from '../../theme/ThemeProvider';
import { space } from '../../theme/spacing';

// How many item names a clean scan lists before it collapses into "+N".
const CHIP_LIMIT = 3;

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * "Today 09:41", "Tuesday 18:30", "12 Aug 17:05".
 *
 * Named days for the last week because that is how someone actually refers to
 * a scan they half-finished — "the freezer one from Tuesday" — and a date only
 * once the day name would be ambiguous.
 */
function formatWhen(ms: number | null): string {
  if (!ms) return 'Just now';
  const then = new Date(ms);
  const time = `${String(then.getHours()).padStart(2, '0')}:${String(then.getMinutes()).padStart(2, '0')}`;

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const daysAgo = Math.floor((startOfToday.getTime() - then.getTime()) / DAY_MS) + 1;

  if (then.getTime() >= startOfToday.getTime()) return `Today ${time}`;
  if (daysAgo === 1) return `Yesterday ${time}`;
  if (daysAgo < 7) return `${WEEKDAYS[then.getDay()]} ${time}`;
  return `${then.getDate()} ${then.toLocaleString('en-GB', { month: 'short' })} ${time}`;
}

type Props = {
  scans: ScanRecord[];
  loading: boolean;
  onClose: () => void;
  onOpen: (scan: ScanRecord) => void;
};

export default function ScanHistoryScreen({ scans, loading, onClose, onOpen }: Props) {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();

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
        <View style={styles.headerText}>
          <Text style={styles.title}>Past scans</Text>
          <Text style={styles.subtitle}>Reopen any one to fix it</Text>
        </View>
        <TouchableOpacity onPress={onClose} hitSlop={HIT_SLOP} activeOpacity={0.7}>
          <Text style={styles.close}>Close</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: space.xxl + insets.bottom }]}
        showsVerticalScrollIndicator={false}
      >
        {loading && scans.length === 0 && (
          <ActivityIndicator style={styles.loading} color={colors.primaryMid} />
        )}

        {!loading && scans.length === 0 && (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No scans yet</Text>
            <Text style={styles.emptyBody}>
              Once you add a photo of your shopping, it shows up here so you can come back and
              finish anything I got wrong.
            </Text>
          </View>
        )}

        {scans.map((scan) => (
          <ScanCard key={scan.id} scan={scan} onPress={() => onOpen(scan)} />
        ))}
      </ScrollView>
    </View>
  );
}

function ScanCard({ scan, onPress }: { scan: ScanRecord; onPress: () => void }) {
  const styles = useStyles();
  const colors = useColors();
  const unfinished = scan.unresolvedCount > 0;
  const names = scan.candidates.slice(0, CHIP_LIMIT).map((c) => c.name);
  const extra = scan.candidates.length - names.length;

  return (
    <TouchableOpacity
      style={[styles.card, unfinished && styles.cardUnfinished]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <View style={styles.cardRow}>
        {scan.photoUri ? (
          <Image source={{ uri: scan.photoUri }} style={styles.thumb} />
        ) : (
          <View style={[styles.thumb, styles.thumbEmpty]} />
        )}
        <View style={styles.cardBody}>
          <Text style={styles.cardTitle} numberOfLines={1}>
            {scan.sceneLabel}
          </Text>
          <Text
            style={[styles.cardMeta, unfinished && styles.cardMetaUnfinished]}
            numberOfLines={1}
          >
            {unfinished
              ? `${formatWhen(scan.createdAt)} · ${scan.unresolvedCount} of ${scan.candidates.length} still need a date`
              : `${formatWhen(scan.createdAt)} · ${scan.candidates.length} items · all clean`}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={17} color={colors.chevron} />
      </View>

      {unfinished ? (
        <View style={styles.finish}>
          <Text style={styles.finishText}>
            Finish {scan.unresolvedCount === 1 ? 'this one' : `these ${scan.unresolvedCount}`}
          </Text>
        </View>
      ) : (
        names.length > 0 && (
          <View style={styles.chips}>
            {names.map((name) => (
              <View key={name} style={styles.chip}>
                <Text style={styles.chipText} numberOfLines={1}>
                  {name}
                </Text>
              </View>
            ))}
            {extra > 0 && (
              <View style={styles.chip}>
                <Text style={[styles.chipText, styles.chipTextMuted]}>+{extra}</Text>
              </View>
            )}
          </View>
        )
      )}
    </TouchableOpacity>
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
    justifyContent: 'space-between',
    gap: space.md,
    paddingHorizontal: space.xxl,
    paddingTop: space.half,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontFamily: fonts.display,
    fontWeight: '800',
    fontSize: type.headline.fontSize,
    lineHeight: 31,
    color: colors.primaryDarker,
    marginBottom: space.xs2,
  },
  subtitle: {
    fontWeight: '600',
    fontSize: type.bodySmall.fontSize,
    lineHeight: 17,
    color: colors.textSecondary,
  },
  close: {
    fontWeight: '700',
    fontSize: type.body.fontSize,
    color: colors.textSecondary,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: space.xxl,
    paddingTop: space.lg2,
    gap: space.md,
  },
  loading: {
    marginTop: space.huge,
  },
  empty: {
    marginTop: space.xxxl,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
    borderRadius: 22,
    padding: space.xl,
  },
  emptyTitle: {
    fontFamily: fonts.display,
    fontWeight: '700',
    fontSize: type.title.fontSize,
    lineHeight: 25,
    color: colors.primaryDarker,
    marginBottom: space.sm,
  },
  emptyBody: {
    fontWeight: '600',
    fontSize: type.label.fontSize,
    lineHeight: 19,
    color: colors.textSecondary,
  },
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
    borderRadius: 22,
    padding: space.md2,
  },
  cardUnfinished: {
    borderWidth: 1.5,
    borderColor: colors.amberBorder,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  thumb: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: colors.backgroundAlt,
    flexShrink: 0,
  },
  thumbEmpty: {
    borderWidth: 1,
    borderColor: colors.tan,
  },
  cardBody: {
    flex: 1,
    minWidth: 0,
  },
  cardTitle: {
    fontWeight: '700',
    fontSize: type.body.fontSize,
    lineHeight: 18,
    color: colors.primaryDarker,
    marginBottom: space.xs,
  },
  cardMeta: {
    fontWeight: '600',
    fontSize: type.caption.fontSize,
    lineHeight: 15,
    color: colors.textSecondary,
  },
  cardMetaUnfinished: {
    fontWeight: '700',
    color: colors.rust,
  },
  finish: {
    height: 44,
    borderRadius: 14,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: space.md,
  },
  finishText: {
    fontWeight: '800',
    fontSize: type.bodySmall.fontSize,
    color: colors.rust,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.xs2,
    marginTop: space.md,
  },
  chip: {
    maxWidth: '48%',
    paddingVertical: space.xs2,
    paddingHorizontal: space.sm2,
    borderRadius: 999,
    backgroundColor: colors.creamCard,
  },
  chipText: {
    fontWeight: '700',
    fontSize: type.micro.fontSize,
    lineHeight: 13,
    color: colors.textSecondary,
  },
  chipTextMuted: {
    color: colors.tabInactive,
  },
}));