// src/screens/PantryHistoryScreen.tsx
//
// Pantry history, opened from Profile or from View More under Home's chart: everything that has left the shelves, newest
// first, grouped by day. Each row says what it was, how much went, when it went and
// why — the same records Home's "Where your food went" chart counts.
//
// Read-only on purpose. The history is what happened; editing a reason after
// the fact would let the chart say whatever the user wished had happened.

import React, { useMemo, useState } from 'react';
import { Modal, ScrollView, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  SafeAreaProvider,
  initialWindowMetrics,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import Text from '../components/Text';
import { REASON_ICONS } from '../components/pantry/RemovalReasonSheet';
import {
  REMOVAL_LABELS,
  REMOVAL_REASONS,
  RemovalHistory,
  RemovalReason,
  RemovalRecord,
  isWaste,
  reasonLabel,
} from '../services/removals';
import { fonts, type } from '../theme/typography';
import { makeStyles } from '../theme/makeStyles';
import { useColors } from '../theme/ThemeProvider';
import { space } from '../theme/spacing';

const HIT_SLOP = { top: 12, bottom: 12, left: 12, right: 12 };

type Filter = 'all' | RemovalReason;

type Props = {
  visible: boolean;
  /** null until loaded. */
  history: RemovalHistory | null;
  onClose: () => void;
};

export default function PantryHistoryScreen({ visible, history, onClose }: Props) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <Body history={history} onClose={onClose} />
      </SafeAreaProvider>
    </Modal>
  );
}

function dayLabel(ms: number): string {
  const date = new Date(ms);
  const today = new Date();
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((startOf(today) - startOf(date)) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' }),
  });
}

function timeLabel(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** Consecutive records by calendar day. Input is already newest-first. */
function groupByDay(records: RemovalRecord[]): { day: string; rows: RemovalRecord[] }[] {
  const groups: { day: string; rows: RemovalRecord[] }[] = [];
  for (const record of records) {
    const day = dayLabel(record.removedAt);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.rows.push(record);
    else groups.push({ day, rows: [record] });
  }
  return groups;
}

function Body({ history, onClose }: Omit<Props, 'visible'>) {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState<Filter>('all');

  const records = history?.records ?? [];
  const total = history ? REMOVAL_REASONS.reduce((sum, r) => sum + history.counts[r], 0) : 0;

  const groups = useMemo(
    () => groupByDay(filter === 'all' ? records : records.filter((r) => r.reason === filter)),
    [records, filter]
  );

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + space.sm }]}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Pantry history</Text>
          <Text style={styles.subtitle}>
            {history === null
              ? 'Loading…'
              : total === 0
                ? 'Nothing removed yet'
                : `${total} removal${total === 1 ? '' : 's'}`}
          </Text>
        </View>
        <TouchableOpacity
          style={styles.closeButton}
          onPress={onClose}
          hitSlop={HIT_SLOP}
          accessibilityLabel="Close"
        >
          <Ionicons name="close" size={20} color={colors.primaryDarker} />
        </TouchableOpacity>
      </View>

      {total > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipScroller}
          contentContainerStyle={styles.chipRow}
        >
          {(['all', ...REMOVAL_REASONS] as Filter[]).map((f) => {
            const active = filter === f;
            const count = f === 'all' ? total : history!.counts[f];
            return (
              <TouchableOpacity
                key={f}
                style={[styles.chip, active && styles.chipActive]}
                onPress={() => setFilter(f)}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>
                  {f === 'all' ? 'All' : REMOVAL_LABELS[f]} {count}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: space.xxl2 + insets.bottom }]}
        showsVerticalScrollIndicator={false}
      >
        {history !== null && total === 0 && (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>Nothing here yet</Text>
            <Text style={styles.emptyBody}>
              When you delete or use up something in your pantry, it&apos;s kept here with the
              reason — so you can see what gets eaten and what gets thrown away.
            </Text>
          </View>
        )}

        {total > 0 && groups.length === 0 && (
          <Text style={styles.noMatch}>Nothing removed for that reason.</Text>
        )}

        {groups.map((group) => (
          <View key={group.day} style={styles.section}>
            <Text style={styles.sectionLabel}>{group.day.toUpperCase()}</Text>
            <View style={styles.card}>
              {group.rows.map((record, i) => (
                <HistoryRow key={record.id} record={record} divided={i > 0} />
              ))}
            </View>
          </View>
        ))}

        {/* The list is capped server-side; the counts above are not. */}
        {records.length > 0 && records.length < total && filter === 'all' && (
          <Text style={styles.noMatch}>Showing the latest {records.length}.</Text>
        )}
      </ScrollView>
    </View>
  );
}

function HistoryRow({ record, divided }: { record: RemovalRecord; divided: boolean }) {
  const styles = useStyles();
  const colors = useColors();
  const waste = isWaste(record.reason);
  // The pill only ever holds the reason. What someone typed for Other gets its
  // own line under the name: squeezed into the pill after a "·" it read as a
  // cut-off word ("Other · Ps") rather than as the user's own words.
  const note = record.reason === 'other' ? record.note : null;
  const meta = [record.quantity.trim(), timeLabel(record.removedAt)].filter(Boolean).join(' · ');

  return (
    <View
      style={[styles.row, divided && styles.rowDivided]}
      accessible
      accessibilityLabel={`${record.name}, ${meta}, ${reasonLabel(record)}`}
    >
      <View style={styles.rowText}>
        <Text style={styles.rowName} numberOfLines={1}>
          {record.name}
        </Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {meta}
        </Text>
        {note && (
          <Text style={styles.rowNote} numberOfLines={2}>
            Why: {note}
          </Text>
        )}
      </View>
      <View style={[styles.reason, waste ? styles.reasonWaste : styles.reasonEaten]}>
        <Ionicons
          name={REASON_ICONS[record.reason]}
          size={12}
          color={waste ? colors.accentDeep : colors.primaryDark}
        />
        <Text
          style={[styles.reasonText, waste ? styles.reasonTextWaste : styles.reasonTextEaten]}
          numberOfLines={1}
        >
          {REMOVAL_LABELS[record.reason]}
        </Text>
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: {
    flex: 1,
    backgroundColor: colors.backgroundLight,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.xl,
    paddingBottom: space.md,
  },
  title: {
    fontFamily: fonts.display,
    fontWeight: '800',
    fontSize: type.headline.fontSize,
    color: colors.primaryDarker,
  },
  subtitle: {
    fontWeight: '600',
    fontSize: type.label.fontSize,
    color: colors.textSecondary,
    marginTop: space.xs,
  },
  closeButton: {
    width: 38,
    height: 38,
    borderRadius: 13,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipScroller: {
    flexGrow: 0,
    marginBottom: space.xs,
  },
  chipRow: {
    paddingHorizontal: space.xl,
    gap: space.sm,
  },
  chip: {
    paddingVertical: space.sm2,
    paddingHorizontal: space.lg,
    borderRadius: 999,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
  },
  chipActive: {
    backgroundColor: colors.inkFill,
    borderColor: colors.inkFill,
  },
  chipText: {
    fontWeight: '700',
    fontSize: type.label.fontSize,
    color: colors.textDark,
  },
  chipTextActive: {
    fontWeight: '800',
    color: colors.onAccent,
  },
  content: {
    paddingHorizontal: space.xl,
  },
  section: {
    paddingTop: space.lg,
  },
  sectionLabel: {
    fontWeight: '800',
    fontSize: type.micro.fontSize,
    letterSpacing: 1.54,
    color: colors.tabInactive,
    marginBottom: space.sm2,
  },
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
    borderRadius: 20,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md2,
    paddingHorizontal: space.lg,
  },
  rowDivided: {
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowName: {
    fontWeight: '700',
    fontSize: type.body.fontSize,
    color: colors.primaryDarker,
    marginBottom: space.xs2,
  },
  rowMeta: {
    fontWeight: '600',
    fontSize: type.caption.fontSize,
    color: colors.textSecondary,
  },
  rowNote: {
    fontWeight: '600',
    fontSize: type.caption.fontSize,
    lineHeight: 17,
    color: colors.textSecondary,
    marginTop: space.xs2,
  },
  reason: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingVertical: space.xs2,
    paddingHorizontal: space.sm2,
    borderRadius: 999,
    flexShrink: 0,
    maxWidth: '50%',
  },
  reasonEaten: {
    backgroundColor: colors.primaryLighter,
  },
  reasonWaste: {
    backgroundColor: colors.accentSoft,
  },
  reasonText: {
    flexShrink: 1,
    fontWeight: '800',
    fontSize: type.caption.fontSize,
  },
  reasonTextEaten: {
    color: colors.primaryDark,
  },
  reasonTextWaste: {
    color: colors.accentDeep,
  },
  noMatch: {
    paddingTop: space.xl,
    textAlign: 'center',
    fontWeight: '700',
    fontSize: type.label.fontSize,
    color: colors.tabInactive,
  },
  emptyCard: {
    marginTop: space.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
    borderRadius: 22,
    padding: space.xl,
  },
  emptyTitle: {
    fontFamily: fonts.display,
    fontWeight: '700',
    fontSize: type.subtitle.fontSize,
    color: colors.primaryDarker,
    marginBottom: space.xs2,
  },
  emptyBody: {
    fontWeight: '600',
    fontSize: type.label.fontSize,
    lineHeight: 19,
    color: colors.textSecondary,
  },
}));
