// src/components/home/NotificationInbox.tsx
//
// What the bell on Home opens.
//
// It hangs off the bell rather than rising from the bottom of the screen. A
// bottom sheet is the right shape for a task you have chosen to go and do; this
// is a glance at what a particular control has been up to, and it should read
// as that control's own panel — which means starting at the bell, pointing at
// it, and being dismissable by tapping anywhere else.
//
// Two halves, and they answer different questions. The top is what the pantry
// needs doing about *now* — recomputed from the items on every open, so it can
// never be the stale copy of a message sent yesterday. The bottom is what was
// actually sent, which is the thing a bell usually means and the only way to
// check the reminders are working without waiting for one.
//
// Settings are not here at all. A bell says what happened; Profile's
// Notifications row is where it gets configured, and putting a second door to
// the same place inside a panel this size only made it taller.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  Modal,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Text from '../Text';
import { fonts, type } from '../../theme/typography';
import { makeStyles } from '../../theme/makeStyles';
import { useColors } from '../../theme/ThemeProvider';
import { space } from '../../theme/spacing';
import {
  Attention,
  LogEntry,
  attentionCount,
  clearNotificationLog,
  currentAttention,
  dismissLogEntry,
  getNotificationLog,
  getPlan,
} from '../../services/notifications';
import { PantryItem } from '../../services/pantry';

const HIT_SLOP = { top: 12, bottom: 12, left: 12, right: 12 };

/** Where on screen the bell is, measured at the moment it was tapped. */
export type Anchor = { x: number; y: number; width: number; height: number };

type Props = {
  visible: boolean;
  /** Null until the bell has been pressed once. */
  anchor: Anchor | null;
  /** Whose history this is. The log is stored per account. */
  uid: string | null;
  items: PantryItem[];
  onClose: () => void;
};

/** Screen margin the panel keeps from either edge. */
const EDGE = 16;
const MAX_WIDTH = 296;
/** Kept short on purpose: this is a glance, and a panel that fills the screen
 *  is a screen. Anything past this scrolls inside it. */
const MAX_HEIGHT = 340;
/** The gap between the bell and the top of the panel, where the caret sits. */
const CARET = 8;

/** "Yesterday · 6:00pm" — a date is only worth spelling out past this week. */
function whenLabel(at: number): string {
  const then = new Date(at);
  const time = then
    .toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    .toLowerCase();

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const days = Math.round((startOfToday.getTime() - then.getTime()) / 86_400_000);

  if (days <= 0) return `Today · ${time}`;
  if (days === 1) return `Yesterday · ${time}`;
  if (days < 7) return `${then.toLocaleDateString(undefined, { weekday: 'long' })} · ${time}`;
  return `${then.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} · ${time}`;
}

/** "in 4 min", "today at 6:00pm", "Thursday at 6:00pm". */
function nextLabel(at: number): string {
  const minutes = Math.round((at - Date.now()) / 60_000);
  if (minutes < 60) return `in ${Math.max(1, minutes)} min`;

  const then = new Date(at);
  const time = then
    .toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    .toLowerCase();

  const startOfTomorrow = new Date();
  startOfTomorrow.setHours(0, 0, 0, 0);
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);

  if (at < startOfTomorrow.getTime()) return `today at ${time}`;
  if (at < startOfTomorrow.getTime() + 86_400_000) return `tomorrow at ${time}`;
  return `${then.toLocaleDateString(undefined, { weekday: 'long' })} at ${time}`;
}

export default function NotificationInbox({ visible, anchor, uid, items, onClose }: Props) {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const screen = Dimensions.get('window');

  // Grows out of the bell: a short drop and a fade, fast enough to feel
  // attached to the tap rather than animated at the user.
  const reveal = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) {
      reveal.setValue(0);
      return;
    }
    Animated.timing(reveal, {
      toValue: 1,
      duration: 160,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [visible, reveal]);

  const [log, setLog] = useState<LogEntry[]>([]);
  // The soonest reminder still ahead. Without it there is no way to tell a
  // working schedule with nothing due from a schedule that never got armed —
  // both look like an empty panel.
  const [next, setNext] = useState<LogEntry | null>(null);
  const [attention, setAttention] = useState<Attention>({ gone: [], today: [], tomorrow: [] });

  const refresh = useCallback(() => {
    getNotificationLog(uid).then(setLog);
    getPlan(uid).then((plan) => setNext(plan[0] ?? null));
  }, [uid]);

  // Recomputed on open rather than held in state, because the pantry can have
  // moved on since the last time this was looked at.
  useEffect(() => {
    if (!visible) return;
    setAttention(currentAttention(items));
    refresh();
  }, [visible, items, refresh]);

  async function dismiss(at: number) {
    // Dropped from the list immediately; the write follows. A delete that waits
    // on storage feels like a tap that missed.
    setLog((current) => current.filter((entry) => entry.at !== at));
    await dismissLogEntry(uid, at);
  }

  async function clearAll() {
    setLog([]);
    await clearNotificationLog(uid);
  }

  const needsAttention = attentionCount(attention) > 0;

  // Right-aligned to the bell, clamped so a panel wider than the space left of
  // it still keeps its margin from the screen edge.
  const width = Math.min(MAX_WIDTH, screen.width - EDGE * 2);
  const right = anchor
    ? Math.max(EDGE, Math.min(screen.width - (anchor.x + anchor.width), screen.width - width - EDGE))
    : EDGE;
  const top = anchor ? anchor.y + anchor.height + CARET : insets.top + 56;
  // Never past the bottom of the screen, whatever the log has grown to.
  const maxHeight = Math.min(MAX_HEIGHT, screen.height - top - Math.max(insets.bottom, EDGE) - EDGE);
  // The caret points at the middle of the bell. `right` here means distance
  // from the caret's OWN right edge to the panel's right edge — the panel's
  // right edge sits `right` from the screen's right edge, so the bell's
  // midpoint's own distance from the screen's right edge
  // (screen.width - (anchor.x + anchor.width / 2)) minus that same `right`
  // offset is exactly how far the caret needs to sit from the panel's right
  // edge. The previous formula measured from the panel's LEFT edge instead
  // while being applied as a right-anchored position, which only looked
  // right when the panel happened to sit near-centered under the bell and
  // drifted off target otherwise — this version is anchor-relative,
  // independent of panel width.
  const caretHalfWidth = 6;
  const caretRight = anchor
    ? Math.min(
        width - space.md - caretHalfWidth * 2,
        Math.max(
          space.md,
          screen.width - (anchor.x + anchor.width / 2) - right - caretHalfWidth
        )
      )
    : space.xl;

  return (
    <Modal visible={visible} animationType="none" transparent onRequestClose={onClose}>
      {/* Tapping anywhere off the panel closes it, which is what makes this a
          menu rather than a screen. */}
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />

      <Animated.View
        style={[
          styles.panel,
          {
            top,
            right,
            width,
            maxHeight,
            opacity: reveal,
            transform: [
              { translateY: reveal.interpolate({ inputRange: [0, 1], outputRange: [-10, 0] }) },
            ],
          },
        ]}
      >
        <View style={[styles.caret, { right: caretRight }]} />

        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.title}>Notifications</Text>
            <Text style={styles.nextLine} numberOfLines={1}>
              {next ? `Next ${nextLabel(next.at)}` : 'No reminder scheduled'}
            </Text>
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={HIT_SLOP}>
            <Ionicons name="close" size={18} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>

    <ScrollView
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
    >
        <Text style={styles.eyebrow}>NEEDS EATING</Text>

        {needsAttention ? (
          <View style={styles.card}>
            {attention.gone.map((item, i) => (
              <AttentionRow
                key={`gone-${item.name}`}
                first={i === 0}
                tone="gone"
                name={item.name}
                detail={
                  item.estimate
                    ? `may be past its best — added ${item.days === 1 ? 'yesterday' : `${item.days} days ago`}`
                    : item.days === 1
                      ? 'went off yesterday'
                      : `went off ${item.days} days ago`
                }
              />
            ))}
            {attention.today.map((item, i) => (
              <AttentionRow
                key={`today-${item.name}`}
                first={i === 0 && attention.gone.length === 0}
                tone="today"
                name={item.name}
                detail={item.estimate ? 'Panzi suggests using this today' : 'goes off today'}
              />
            ))}
            {attention.tomorrow.map((item, i) => (
              <AttentionRow
                key={`tomorrow-${item.name}`}
                first={
                  i === 0 && attention.gone.length === 0 && attention.today.length === 0
                }
                tone="tomorrow"
                name={item.name}
                detail={item.estimate ? 'Panzi suggests using this by tomorrow' : 'goes off tomorrow'}
              />
            ))}
          </View>
        ) : (
          <View style={styles.emptyCard}>
            <Ionicons name="checkmark-circle-outline" size={18} color={colors.primaryDark} />
            <Text style={styles.emptyText}>Nothing is close to going off.</Text>
          </View>
        )}

        <View style={styles.recentHeader}>
          <Text style={styles.eyebrow}>RECENT</Text>
          {log.length > 0 && (
            <TouchableOpacity onPress={clearAll} hitSlop={HIT_SLOP}>
              <Text style={styles.clearAll}>Clear all</Text>
            </TouchableOpacity>
          )}
        </View>

        {log.length === 0 ? (
          <Text style={styles.noneYet}>
            Nothing sent yet. Reminders appear here once one has gone out.
          </Text>
        ) : (
          <View style={styles.card}>
            {log.map((entry, i) => (
              <View key={entry.at} style={[styles.logRow, i > 0 && styles.divided]}>
                <View style={styles.logBody}>
                  <Text style={styles.logTitle} numberOfLines={2}>
                    {entry.title}
                  </Text>
                  {!!entry.body && (
                    <Text style={styles.logDetail} numberOfLines={2}>
                      {entry.body}
                    </Text>
                  )}
                  <Text style={styles.logWhen}>{whenLabel(entry.at)}</Text>
                </View>
                <TouchableOpacity
                  onPress={() => dismiss(entry.at)}
                  hitSlop={HIT_SLOP}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${entry.title}`}
                >
                  <Ionicons name="close" size={16} color={colors.chevron} />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}
        </ScrollView>
      </Animated.View>
    </Modal>
  );
}

/** One thing that needs eating. The dot carries the same urgency colours the
 *  Pantry and Home already use, so the three screens agree at a glance. */
function AttentionRow({
  first,
  tone,
  name,
  detail,
}: {
  first: boolean;
  tone: 'gone' | 'today' | 'tomorrow';
  name: string;
  detail: string;
}) {
  const styles = useStyles();
  const colors = useColors();
  const dot =
    tone === 'gone' ? colors.accent : tone === 'today' ? colors.warning : colors.primary;

  return (
    <View style={[styles.attentionRow, !first && styles.divided]}>
      <View style={[styles.dot, { backgroundColor: dot }]} />
      <Text style={styles.attentionName} numberOfLines={1}>
        {name}
      </Text>
      <Text style={styles.attentionDetail}>{detail}</Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  // Barely there. A dropdown is a menu, not a screen: dimming the page behind
  // it the way a sheet does would make a glance feel like a departure.
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(23,23,15,0.12)',
  },
  panel: {
    position: 'absolute',
    backgroundColor: colors.card,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.borderWarm,
    paddingHorizontal: space.md2,
    paddingTop: space.md2,
    paddingBottom: space.sm,
    shadowColor: colors.shadow,
    shadowOpacity: 0.3,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  },
  // A rotated square with two of its borders showing, which is the only way to
  // get a bordered triangle out of a View.
  caret: {
    position: 'absolute',
    top: -6,
    width: 12,
    height: 12,
    backgroundColor: colors.card,
    borderLeftWidth: 1,
    borderTopWidth: 1,
    borderColor: colors.borderWarm,
    transform: [{ rotate: '45deg' }],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.md,
  },
  headerText: {
    flex: 1,
  },
  nextLine: {
    fontWeight: '700',
    fontSize: type.micro.fontSize,
    color: colors.textSecondary,
    marginTop: space.half,
  },
  title: {
    fontFamily: fonts.display,
    fontWeight: '800',
    // Two steps down from the sheet this used to be. The panel is narrow and
    // hangs off a 44pt control, so a screen-sized heading overpowered it.
    fontSize: type.bodyLarge.fontSize,
    color: colors.primaryDarker,
  },
  scrollContent: {
    paddingBottom: space.sm,
  },
  eyebrow: {
    fontWeight: '800',
    fontSize: type.micro.fontSize,
    letterSpacing: 1.54,
    textTransform: 'uppercase',
    color: colors.tabInactive,
    marginBottom: space.sm,
  },
  card: {
    backgroundColor: colors.cardSunken,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
    paddingHorizontal: space.md,
  },
  divided: {
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  attentionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.sm2,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 999,
  },
  attentionName: {
    flex: 1,
    fontWeight: '800',
    fontSize: type.bodySmall.fontSize,
    color: colors.primaryDarker,
  },
  attentionDetail: {
    fontWeight: '700',
    fontSize: type.micro.fontSize,
    color: colors.textSecondary,
  },
  emptyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.primaryWash,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.primaryLine,
    padding: space.md,
  },
  emptyText: {
    fontWeight: '700',
    fontSize: type.caption.fontSize,
    color: colors.primaryDark,
  },
  recentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: space.lg,
  },
  clearAll: {
    fontWeight: '700',
    fontSize: type.caption.fontSize,
    color: colors.primaryDark,
    marginBottom: space.sm,
  },
  noneYet: {
    fontWeight: '600',
    fontSize: type.caption.fontSize,
    lineHeight: 17,
    color: colors.textSecondary,
  },
  logRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    paddingVertical: space.sm2,
  },
  logBody: {
    flex: 1,
  },
  logTitle: {
    fontWeight: '800',
    fontSize: type.caption.fontSize,
    lineHeight: 17,
    color: colors.primaryDarker,
  },
  logDetail: {
    fontWeight: '600',
    fontSize: type.micro.fontSize,
    lineHeight: 15,
    color: colors.textSecondary,
    marginTop: space.half,
  },
  logWhen: {
    fontWeight: '700',
    fontSize: type.micro.fontSize,
    color: colors.mutedLight,
    marginTop: space.xs,
  },
}));
