// src/screens/scan/DateWheelSheet.tsx
//
// The expiration date picker: three spinning wheels — month, day, year — in a
// sheet that slides up from the bottom, the way the iOS alarm clock sets a
// time. Built here rather than taken from the platform so it looks the same on
// Android and iOS and wears the app's own colours and type.
//
// The wheels can only ever land on a real date. Months are the twelve months;
// the day wheel is as long as the chosen month actually is (30, 31, or 28/29
// for February) and pulls a day back in range when the month or year changes
// under it. The year is deliberately wide open — an expiration date can be
// long past or years away, and neither is wrong.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Text from '../../components/Text';
import { makeStyles } from '../../theme/makeStyles';
import { useColors } from '../../theme/ThemeProvider';
import { space } from '../../theme/spacing';
import { fonts, type } from '../../theme/typography';

const ITEM_HEIGHT = 44;
/** Rows visible at once — the chosen one plus two either side. */
const VISIBLE_ROWS = 5;
const WHEEL_HEIGHT = ITEM_HEIGHT * VISIBLE_ROWS;
const PAD_ROWS = (VISIBLE_ROWS - 1) / 2;

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Wide on purpose: an expiration date isn't validated by year. Ten years back
// covers anything still sitting in a cupboard; fifty forward covers anything
// that will ever be printed on a tin.
const YEARS_BACK = 10;
const YEARS_FORWARD = 50;

export function daysInMonth(month: number, year: number): number {
  // Day 0 of the next month is the last day of this one.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function toIso(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}

function parseIso(iso: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

function todayParts() {
  const now = new Date();
  return { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() };
}

/** "Wednesday, September 23, 2028" — the chosen date read back in words. */
export function formatLongDate(iso: string): string {
  const p = parseIso(iso);
  if (!p) return iso;
  const date = new Date(p.y, p.m - 1, p.d);
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

// ─── One wheel ────────────────────────────────────────────────────────────

type WheelProps = {
  items: string[];
  selectedIndex: number;
  onChange: (index: number) => void;
  /** Screen-reader name for the wheel — "Month", "Day", "Year". */
  label: string;
  flex: number;
};

// The fewest milliseconds between two ticks. A fast spin passes dozens of rows
// a second, and a native haptic call for every one of them queued up behind
// the scroll and made it stutter; one tick per ~frame-and-a-half still reads
// as one per row to a finger.
const TICK_MIN_MS = 45;

/**
 * One drum of the picker.
 *
 * Memoised, and its rows memoised on the item list alone: the sheet
 * re-renders every time any wheel comes to rest, and rebuilding each row's
 * three animated interpolations on every one of those re-renders — about a
 * hundred rows across the three wheels, re-attached to the native driver each
 * time — is what made the picker lag when a wheel stopped.
 */
const Wheel = React.memo(function Wheel({ items, selectedIndex, onChange, label, flex }: WheelProps) {
  const styles = useStyles();
  const scrollRef = useRef<ScrollView>(null);
  const scrollY = useRef(new Animated.Value(selectedIndex * ITEM_HEIGHT)).current;
  // Where the wheel last came to rest, so an outside change (the day wheel
  // being pulled back from 31 to 30) can tell a real move from an echo.
  const settledIndex = useRef(selectedIndex);
  // The row currently under the band while spinning — drives the tick.
  const tickIndex = useRef(selectedIndex);
  const lastTickAt = useRef(0);
  const endDragTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Read through a ref so the memoised rows below never go stale on it.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const lengthRef = useRef(items.length);
  lengthRef.current = items.length;

  // Follow the selection when it's changed from outside the wheel.
  useEffect(() => {
    if (selectedIndex === settledIndex.current) return;
    settledIndex.current = selectedIndex;
    tickIndex.current = selectedIndex;
    scrollRef.current?.scrollTo({ y: selectedIndex * ITEM_HEIGHT, animated: true });
  }, [selectedIndex]);

  useEffect(
    () => () => {
      if (endDragTimer.current) clearTimeout(endDragTimer.current);
    },
    [],
  );

  function clampIndex(i: number): number {
    return Math.max(0, Math.min(lengthRef.current - 1, i));
  }

  function choose(index: number) {
    if (index !== settledIndex.current) {
      settledIndex.current = index;
      onChangeRef.current(index);
    }
  }

  function settle(y: number) {
    const index = clampIndex(Math.round(y / ITEM_HEIGHT));
    // Lands exactly on the row even if the scroll stopped a hair off it.
    if (Math.abs(y - index * ITEM_HEIGHT) > 0.5) {
      scrollRef.current?.scrollTo({ y: index * ITEM_HEIGHT, animated: true });
    }
    choose(index);
  }

  // Built once per wheel — a new Animated.event every render re-binds the
  // native scroll listener.
  const onScroll = useMemo(
    () =>
      Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
        useNativeDriver: true,
        listener: (e: NativeSyntheticEvent<NativeScrollEvent>) => {
          // A light tick as rows pass under the band — the feel of the iOS
          // wheel, and a cue for exactly where it will stop.
          const index = clampIndex(Math.round(e.nativeEvent.contentOffset.y / ITEM_HEIGHT));
          if (index === tickIndex.current) return;
          tickIndex.current = index;
          const now = Date.now();
          if (now - lastTickAt.current < TICK_MIN_MS) return;
          lastTickAt.current = now;
          void Haptics.selectionAsync().catch(() => {});
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scrollY],
  );

  const rows = useMemo(
    () =>
      items.map((item, i) => {
        const center = i * ITEM_HEIGHT;
        const range = [
          center - 3 * ITEM_HEIGHT,
          center - 2 * ITEM_HEIGHT,
          center - ITEM_HEIGHT,
          center,
          center + ITEM_HEIGHT,
          center + 2 * ITEM_HEIGHT,
          center + 3 * ITEM_HEIGHT,
        ];
        const opacity = scrollY.interpolate({
          inputRange: range,
          outputRange: [0.1, 0.25, 0.5, 1, 0.5, 0.25, 0.1],
          extrapolate: 'clamp',
        });
        const scale = scrollY.interpolate({
          inputRange: range,
          outputRange: [0.8, 0.86, 0.93, 1, 0.93, 0.86, 0.8],
          extrapolate: 'clamp',
        });
        // Rows tip away from the viewer above and below the band — the
        // drum shape that makes it read as a wheel rather than a list.
        const rotateX = scrollY.interpolate({
          inputRange: range,
          outputRange: ['-60deg', '-40deg', '-20deg', '0deg', '20deg', '40deg', '60deg'],
          extrapolate: 'clamp',
        });
        return (
          <Pressable
            key={item}
            style={styles.row}
            // A tap picks the row outright. Relying on the scroll to report
            // where it stopped missed taps on Android, where a programmatic
            // scroll never reports a momentum end.
            onPress={() => {
              scrollRef.current?.scrollTo({ y: center, animated: true });
              tickIndex.current = i;
              choose(i);
            }}
          >
            <Animated.Text
              style={[styles.rowText, { opacity, transform: [{ perspective: 600 }, { rotateX }, { scale }] }]}
              numberOfLines={1}
            >
              {item}
            </Animated.Text>
          </Pressable>
        );
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, scrollY, styles],
  );

  return (
    <View style={{ flex, height: WHEEL_HEIGHT }}>
      <Animated.ScrollView
        ref={scrollRef}
        accessibilityLabel={`${label}: ${items[selectedIndex] ?? ''}`}
        showsVerticalScrollIndicator={false}
        snapToInterval={ITEM_HEIGHT}
        decelerationRate="fast"
        contentOffset={{ x: 0, y: selectedIndex * ITEM_HEIGHT }}
        onLayout={() => scrollRef.current?.scrollTo({ y: settledIndex.current * ITEM_HEIGHT, animated: false })}
        contentContainerStyle={{ paddingVertical: PAD_ROWS * ITEM_HEIGHT }}
        scrollEventThrottle={16}
        onScroll={onScroll}
        onScrollEndDrag={(e) => {
          // A drag released without a flick never gets a momentum end, so it
          // settles here — unless momentum starts, which cancels this.
          const y = e.nativeEvent.contentOffset.y;
          if (endDragTimer.current) clearTimeout(endDragTimer.current);
          endDragTimer.current = setTimeout(() => settle(y), 80);
        }}
        onMomentumScrollBegin={() => {
          if (endDragTimer.current) clearTimeout(endDragTimer.current);
        }}
        onMomentumScrollEnd={(e) => settle(e.nativeEvent.contentOffset.y)}
      >
        {rows}
      </Animated.ScrollView>
    </View>
  );
});

// ─── The sheet ────────────────────────────────────────────────────────────

type Props = {
  visible: boolean;
  /** The date the wheels open on — the current value, an estimate, or null
   *  for today. */
  initial: string | null;
  /** Whether there is a date to clear — shows "Clear date" when there is. */
  canClear: boolean;
  onCancel: () => void;
  onConfirm: (iso: string) => void;
  onClear: () => void;
};

export default function DateWheelSheet({ visible, initial, canClear, onCancel, onConfirm, onClear }: Props) {
  const styles = useStyles();

  // The sheet rises into place rather than popping in.
  const rise = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!visible) return;
    rise.setValue(0);
    Animated.spring(rise, { toValue: 1, useNativeDriver: true, damping: 20, stiffness: 180, mass: 0.8 }).start();
  }, [visible, rise]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel} statusBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} accessibilityLabel="Close date picker" />
        {/* Mounted fresh on every open, so the wheels start on today's value
            in the very first frame. Syncing state after opening used to draw
            the last-picked date first and then visibly spin to the new one. */}
        {visible && (
          <SheetBody
            initial={initial}
            canClear={canClear}
            rise={rise}
            onCancel={onCancel}
            onConfirm={onConfirm}
            onClear={onClear}
          />
        )}
      </View>
    </Modal>
  );
}

function SheetBody({
  initial,
  canClear,
  rise,
  onCancel,
  onConfirm,
  onClear,
}: Omit<Props, 'visible'> & { rise: Animated.Value }) {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const start = useMemo(() => (initial && parseIso(initial)) || todayParts(), [initial]);
  const [month, setMonth] = useState(start.m);
  const [day, setDay] = useState(() => Math.min(start.d, daysInMonth(start.m, start.y)));
  const [year, setYear] = useState(start.y);

  // Fixed for the life of the sheet, so the year wheel's rows are built once
  // rather than every time the year changes.
  const years = useMemo(() => {
    const thisYear = new Date().getFullYear();
    const first = Math.min(thisYear - YEARS_BACK, start.y);
    const last = Math.max(thisYear + YEARS_FORWARD, start.y);
    return Array.from({ length: last - first + 1 }, (_, i) => first + i);
  }, [start.y]);
  const yearLabels = useMemo(() => years.map(String), [years]);

  const dayCount = daysInMonth(month, year);
  const days = useMemo(() => Array.from({ length: dayCount }, (_, i) => String(i + 1)), [dayCount]);

  // February 30th can't be chosen: when the month or year shortens under the
  // chosen day, the day comes back to the month's last one.
  useEffect(() => {
    if (day > dayCount) setDay(dayCount);
  }, [day, dayCount]);

  // Stable identities, so a wheel coming to rest re-renders only the preview
  // and the wheel whose selection actually changed.
  const onMonth = useCallback((i: number) => setMonth(i + 1), []);
  const onDay = useCallback((i: number) => setDay(i + 1), []);
  const onYear = useCallback((i: number) => setYear(years[i]), [years]);

  const safeDay = Math.min(day, dayCount);
  const iso = toIso(year, month, safeDay);
  const today = todayParts();
  const isPast = iso < toIso(today.y, today.m, today.d);

  return (
    <Animated.View
      style={[
        styles.sheet,
        { paddingBottom: insets.bottom + space.lg },
        { transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [420, 0] }) }] },
      ]}
    >
      <View style={styles.handle} />
      <Text style={styles.eyebrow}>USE BY / BEST BEFORE</Text>
      <Text style={styles.preview} numberOfLines={1} adjustsFontSizeToFit>
        {formatLongDate(iso)}
      </Text>
      <Text style={[styles.previewNote, isPast && styles.previewNotePast]}>
        {isPast ? 'This date has already passed' : ' '}
      </Text>

      <View style={styles.columnLabels}>
        <Text style={[styles.columnLabel, { flex: 1.6 }]}>MONTH</Text>
        <Text style={[styles.columnLabel, { flex: 0.8 }]}>DAY</Text>
        <Text style={[styles.columnLabel, { flex: 1 }]}>YEAR</Text>
      </View>

      <View style={styles.wheels}>
        {/* The band the chosen row sits in — drawn behind the wheels. */}
        <View pointerEvents="none" style={styles.band} />
        <Wheel label="Month" flex={1.6} items={MONTHS} selectedIndex={month - 1} onChange={onMonth} />
        <Wheel label="Day" flex={0.8} items={days} selectedIndex={safeDay - 1} onChange={onDay} />
        <Wheel
          label="Year"
          flex={1}
          items={yearLabels}
          selectedIndex={Math.max(0, years.indexOf(year))}
          onChange={onYear}
        />
        {/* Rows fade out toward the top and bottom edges. */}
        <LinearGradient
          pointerEvents="none"
          colors={[colors.card, colors.card + '00']}
          style={[styles.fade, styles.fadeTop]}
        />
        <LinearGradient
          pointerEvents="none"
          colors={[colors.card + '00', colors.card]}
          style={[styles.fade, styles.fadeBottom]}
        />
      </View>

      <View style={styles.actions}>
        <TouchableOpacity style={styles.secondary} onPress={onCancel} activeOpacity={0.8}>
          <Text style={styles.secondaryText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.primary} onPress={() => onConfirm(iso)} activeOpacity={0.85}>
          <Text style={styles.primaryText}>Set date</Text>
        </TouchableOpacity>
      </View>
      {canClear && (
        <TouchableOpacity onPress={onClear} style={styles.clear} activeOpacity={0.7}>
          <Text style={styles.clearText}>Clear date</Text>
        </TouchableOpacity>
      )}
    </Animated.View>
  );
}

const useStyles = makeStyles((colors) => ({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: space.sm,
    paddingHorizontal: space.lg,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.divider,
    marginBottom: space.md,
  },
  eyebrow: {
    fontWeight: '800',
    fontSize: type.micro.fontSize,
    letterSpacing: 1.54,
    color: colors.textMuted,
    textAlign: 'center',
  },
  preview: {
    fontFamily: fonts.display,
    fontWeight: '800',
    fontSize: 22,
    color: colors.textPrimary,
    textAlign: 'center',
    marginTop: space.xs2,
  },
  previewNote: {
    fontSize: type.bodySmall.fontSize,
    fontWeight: '700',
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 2,
  },
  previewNotePast: {
    color: colors.rust,
  },
  columnLabels: {
    flexDirection: 'row',
    marginTop: space.md,
    paddingHorizontal: space.xs2,
  },
  columnLabel: {
    fontWeight: '800',
    fontSize: type.micro.fontSize,
    letterSpacing: 1.2,
    color: colors.textMuted,
    textAlign: 'center',
  },
  wheels: {
    flexDirection: 'row',
    height: WHEEL_HEIGHT,
    marginTop: space.xs2,
  },
  band: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: PAD_ROWS * ITEM_HEIGHT,
    height: ITEM_HEIGHT,
    borderRadius: 14,
    backgroundColor: colors.primaryLighter,
    borderWidth: 1.5,
    borderColor: colors.primaryLine,
  },
  row: {
    height: ITEM_HEIGHT,
    justifyContent: 'center',
    paddingHorizontal: space.sm,
  },
  rowText: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 20,
    color: colors.textPrimary,
  },
  fade: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: ITEM_HEIGHT * 1.6,
  },
  fadeTop: {
    top: 0,
  },
  fadeBottom: {
    bottom: 0,
  },
  actions: {
    flexDirection: 'row',
    gap: space.md,
    marginTop: space.lg,
  },
  secondary: {
    flex: 1,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  secondaryText: {
    fontWeight: '800',
    fontSize: type.body.fontSize,
    color: colors.textPrimary,
  },
  primary: {
    flex: 1.4,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.inkFill,
  },
  primaryText: {
    fontWeight: '800',
    fontSize: type.body.fontSize,
    color: colors.white,
  },
  clear: {
    alignSelf: 'center',
    paddingVertical: space.md,
  },
  clearText: {
    fontWeight: '700',
    fontSize: type.bodySmall.fontSize,
    color: colors.textSecondary,
    textDecorationLine: 'underline',
  },
}));
