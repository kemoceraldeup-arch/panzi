// src/navigation/TabBar.tsx
//
// Hand-rolled tab bar (no react-navigation yet) — simple enough for 5 fixed
// tabs. If the app grows more screens/deep linking later, this is the
// natural point to swap in @react-navigation/bottom-tabs.
//
// Built to the List-screen design handoff: the bar is a rounded white card
// inset from the screen edges with the background showing around it, not a
// full-bleed strip welded to the bottom. The scan button is raised out of the
// bar's top edge and sits in a cutout ring the colour of the background.

import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, View, TouchableOpacity } from 'react-native';
import Text from '../components/Text';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { makeStyles } from '../theme/makeStyles';
import { useColors } from '../theme/ThemeProvider';
import { space } from '../theme/spacing';
import { type } from '../theme/typography';

// 'home' is the landing screen; 'pantry' is the inventory. They were named
// 'pantry' and 'list' when the pantry *was* the landing screen — renamed once
// recipes moved out and Home became a summary of what the pantry holds.
export type TabKey = 'home' | 'recipes' | 'scan' | 'pantry' | 'profile';

// How far the scan button is lifted above the bar. Exported because the
// screens above have to keep their own floating content clear of it.
export const SCAN_BUTTON_LIFT = 38;

// The bar's own content height — tab icon + label + the bar's vertical
// padding — excluding the safe-area inset added at render time. Exported so
// floating content above it (the empty-state "Ask Panzi" bubble) can clear
// the bar without hardcoding a guess at its height.
export const TAB_BAR_CONTENT_HEIGHT = 72;

// Long enough to be a glide rather than a jump, short enough that the bar has
// arrived before the incoming screen finishes settling. Matches the two 130ms
// halves the tab transition runs on, so the pill and the screen are one motion
// with one duration rather than two animations that happen to overlap.
const PILL_DURATION = 260;
// Decelerating, not eased at both ends: the pill leaves the moment the finger
// lands and slows into place, which reads as the tap having pushed it.
const PILL_EASING = Easing.out(Easing.cubic);

const TABS: {
  key: TabKey;
  label: string;
  iconOutline: keyof typeof Ionicons.glyphMap;
  iconFilled: keyof typeof Ionicons.glyphMap;
}[] = [
  { key: 'home', label: 'Home', iconOutline: 'home-outline', iconFilled: 'home' },
  { key: 'recipes', label: 'Recipes', iconOutline: 'restaurant-outline', iconFilled: 'restaurant' },
  { key: 'scan', label: 'Scan', iconOutline: 'scan-outline', iconFilled: 'scan-outline' },
  // The inventory keeps the tray icon it had under its old name — it is the
  // same screen, and the icon is what people will have learned.
  { key: 'pantry', label: 'Pantry', iconOutline: 'file-tray-stacked-outline', iconFilled: 'file-tray-stacked' },
  { key: 'profile', label: 'Profile', iconOutline: 'person-outline', iconFilled: 'person' },
];

type Props = {
  active: TabKey;
  onChange: (tab: TabKey) => void;
};

/** Where each destination tab sits inside the row, filled in by onLayout. */
type Slot = { x: number; width: number; height: number };

export default function TabBar({ active, onChange }: Props) {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();

  // The active pill is one view that moves, rather than a background on
  // whichever tab is current. A background can only appear and disappear; a
  // single view can travel, and travelling is what says the two tabs are
  // places in a row rather than unrelated buttons.
  const [slots, setSlots] = useState<Record<string, Slot>>({});
  const slide = useRef(new Animated.Value(0)).current;
  // Whether the pill has ever been placed. The first placement is a jump to
  // where it belongs, not a glide from the left edge — and it happens again
  // every time the bar remounts, which it does whenever the Pantry tab enters
  // and leaves its selection mode.
  const placed = useRef(false);

  const activeSlot = slots[active];

  // Placed on the same render that first learns where the tab is, not in an
  // effect afterwards. An effect runs after that render has painted, so the
  // pill would show for one frame at the left edge of the bar and then jump —
  // barely visible when the app opens on Home, which is at x 0, and an obvious
  // flick when the bar remounts on any other tab. Setting an Animated.Value is
  // not a state write, so doing it here is safe and idempotent.
  if (activeSlot && !placed.current) {
    placed.current = true;
    slide.setValue(activeSlot.x);
  }

  useEffect(() => {
    if (!activeSlot) return;
    Animated.timing(slide, {
      toValue: activeSlot.x,
      duration: PILL_DURATION,
      easing: PILL_EASING,
      useNativeDriver: true,
    }).start();
  }, [activeSlot, slide]);

  function measure(key: TabKey) {
    return (event: { nativeEvent: { layout: { x: number; width: number; height: number } } }) => {
      const { x, width, height } = event.nativeEvent.layout;
      setSlots((current) => {
        const previous = current[key];
        // Layout fires on every re-render of the row. Rewriting identical
        // numbers would hand `activeSlot` a new object each time and restart
        // the animation from wherever it had got to.
        if (previous && previous.x === x && previous.width === width && previous.height === height) {
          return current;
        }
        return { ...current, [key]: { x, width, height } };
      });
    };
  }

  return (
    // Safe-area padding goes on the wrapper, not the bar — putting it on the
    // bar would stretch the white card down into the home-indicator strip and
    // undo the floating look.
    <View style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, 10) }]}>
      <View style={styles.bar}>
        {/* The tabs sit in their own box inside the bar's padding. The pill is
            positioned against that box, so the x each tab reports and the x the
            pill is placed at are measured from the same origin — against the
            padded bar they would differ by the padding and the border, and the
            pill would sit slightly left of every tab. */}
        <View style={styles.row}>
          {/* Behind the tabs, so the icons and labels stay on top of it. */}
          {activeSlot && (
            <Animated.View
              pointerEvents="none"
              style={[
                styles.pill,
                {
                  width: activeSlot.width,
                  height: activeSlot.height,
                  transform: [{ translateX: slide }],
                },
              ]}
            />
          )}
          {TABS.map((tab) => {
            // The raised button covers this slot's icon, so it carries the label
            // alone, bottom-aligned to sit level with the other labels.
            if (tab.key === 'scan') {
              return (
                <TouchableOpacity
                  key={tab.key}
                  style={styles.scanSlot}
                  onPress={() => onChange(tab.key)}
                >
                  <Text style={styles.scanLabel}>{tab.label}</Text>
                </TouchableOpacity>
              );
            }

            const isActive = active === tab.key;

            return (
              <TouchableOpacity
                key={tab.key}
                style={styles.tab}
                onLayout={measure(tab.key)}
                onPress={() => onChange(tab.key)}
              >
                <Ionicons
                  name={isActive ? tab.iconFilled : tab.iconOutline}
                  size={19}
                  color={isActive ? colors.primaryActive : colors.tabInactive}
                />
                <Text style={[styles.label, isActive && styles.labelActive]}>{tab.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* Rendered after the bar so it stacks on top of it. Centred by a
          full-width row rather than `left: '50%'` + a negative margin —
          percentage offsets resolve against different boxes across platforms
          and the button landed off-centre on device. box-none lets touches
          through the strip to the bar underneath. */}
      <View style={styles.scanButtonRow} pointerEvents="box-none">
        <TouchableOpacity
          style={styles.scanButton}
          onPress={() => onChange('scan')}
          activeOpacity={0.9}
        >
          <LinearGradient
            colors={[colors.primaryBright, colors.primaryMid]}
            // Matches the design's 160deg gradient: mostly top-to-bottom with
            // a slight lean to the right.
            start={{ x: 0.33, y: 0.03 }}
            end={{ x: 0.67, y: 0.97 }}
            style={styles.scanGradient}
          >
            <Ionicons name="scan-outline" size={26} color={colors.onAccent} />
          </LinearGradient>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  wrap: {
    position: 'relative',
    paddingHorizontal: space.md2,
  },
  bar: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.borderWarm,
    borderRadius: 30,
    paddingVertical: space.sm2,
    paddingHorizontal: space.md2,
    shadowColor: colors.shadow,
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pill: {
    position: 'absolute',
    left: 0,
    borderRadius: 18,
    backgroundColor: colors.primaryLighter,
  },
  tab: {
    width: 58,
    alignItems: 'center',
    gap: space.xs2,
    paddingVertical: space.xs2,
    borderRadius: 18,
  },
  label: {
    fontWeight: '800',
    fontSize: type.micro.fontSize,
    letterSpacing: 0.22,
    color: colors.tabInactive,
  },
  labelActive: {
    color: colors.primaryActive,
  },
  scanSlot: {
    width: 58,
    height: 44,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingVertical: space.xs2,
  },
  scanLabel: {
    fontWeight: '800',
    fontSize: type.micro.fontSize,
    letterSpacing: 0.22,
    color: colors.primaryDark,
  },
  scanButtonRow: {
    position: 'absolute',
    top: -SCAN_BUTTON_LIFT,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  scanButton: {
    width: 66,
    height: 66,
    borderRadius: 24,
    // The ring is a border in the background colour, so the button reads as
    // punched through the bar rather than sitting on it. It has to match what
    // is actually behind the bar (MainTabs' container), not the design file's
    // own background, or the ring shows up as a visible band.
    borderWidth: 5,
    borderColor: colors.backgroundLight,
    overflow: 'hidden',
    shadowColor: colors.shadow,
    shadowOpacity: 0.45,
    shadowRadius: 11,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  scanGradient: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
