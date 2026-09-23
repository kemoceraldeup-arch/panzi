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
//
// Instagram-style scroll collapse: on scroll-down the pill shrinks (both
// width and height) and every text label hides, leaving a short row of the
// same 5 icons, evenly spaced; on scroll-up it reverses back to the full
// labelled bar. Same icons, same order, same active-tab pill, same Scan
// button (still green, still visible — it drops down to sit level with the
// other 4 icons instead of disappearing) throughout; nothing is redesigned
// or replaced.
//
// Two earlier passes at the width/height shrink used `transform: scaleX/
// scaleY` on the whole bar — the one style property native-animated can run
// as a genuine Animated.Value — but a GPU-scaled bitmap of already-rendered
// text reads as faintly blurry next to the crisp, unscaled text everywhere
// else in the app, and shrinking scaleX squeezes the *gaps* between icons at
// the same rate as everything else, which read as the 5 items being crowded
// together rather than the container getting smaller around them.
//
// So none of this scales anything. Every shrinking value is real layout
// (padding, in plain pixels) applied via ordinary React state, not a
// transform — icons stay pixel-crisp at every point in the animation because
// they are never rasterized-then-scaled, only ever laid out at their own
// true size. The row's tabs (fixed at width: 58) never resize either; the
// bar's own paddingHorizontal is what grows to narrow the pill, which — with
// the row's justifyContent: 'space-between' — only eats into the space
// BETWEEN the fixed-width tabs, never the tabs' own content, so the icons
// stay comfortably spaced rather than squeezed. Labels hide via opacity +
// maxHeight collapsing to 0 (also plain numbers, also real layout — see
// `t`/`lerp` below), not by unmounting, so the row's own height eases down
// smoothly rather than jumping the instant a label disappears.

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
import { collapseProgress } from './scrollCollapse';

// 'home' is the landing screen; 'pantry' is the inventory. They were named
// 'pantry' and 'list' when the pantry *was* the landing screen — renamed once
// recipes moved out and Home became a summary of what the pantry holds.
export type TabKey = 'home' | 'recipes' | 'scan' | 'pantry' | 'profile';

// How far the scan button is lifted above the bar AT FULL EXPANSION.
// Exported because the screens above have to keep their own floating
// content clear of it — they only ever need to clear the largest it gets.
export const SCAN_BUTTON_LIFT = 38;

// Extra gap added below the bar, on top of the safe-area inset, so it sits
// clearly above the home indicator/bottom edge rather than flush against
// it — a small, deliberate lift, not a redesign of the bar's own height.
// Declared here (rather than down with the other collapse-animation
// constants) and folded into TAB_BAR_CONTENT_HEIGHT below because every
// screen's own bottom scroll padding is computed from that export — if this
// lift weren't included in it, raising the bar would leave scrolled content
// stopping BAR_LIFT short of actually clearing it.
const BAR_LIFT = space.lg2; // 18

// The bar's own content height — tab icon + label + the bar's vertical
// padding, plus BAR_LIFT — excluding the safe-area inset added at render
// time. Exported so floating content above it (the empty-state "Ask Panzi"
// bubble) and every screen's own bottom scroll padding can clear the bar
// without hardcoding a guess at its height or its lift. This is the bar's
// EXPANDED height — the tallest it ever is — since floating content only
// ever needs to clear the largest possible bar, not whichever size it
// happens to be mid-scroll.
export const TAB_BAR_CONTENT_HEIGHT = 72 + BAR_LIFT;

// Long enough to be a glide rather than a jump, short enough that the bar has
// arrived before the incoming screen finishes settling. Matches the two 130ms
// halves the tab transition runs on, so the pill and the screen are one motion
// with one duration rather than two animations that happen to overlap.
const PILL_DURATION = 260;
// Decelerating, not eased at both ends: the pill leaves the moment the finger
// lands and slows into place, which reads as the tap having pushed it.
const PILL_EASING = Easing.out(Easing.cubic);

// Real layout values `t` (collapseProgress, 0..1) interpolates between —
// plain numbers, not Animated interpolations, and not a scale transform.
//
// Width: the bar itself has no explicit width — as a flex child it always
// stretches to fill whatever room `wrap` leaves it, so the bar's own
// paddingHorizontal can never change its OUTER footprint, only how the
// fixed-width row of tabs sits inside a box that stays exactly as wide as
// before. What actually narrows the pill is `wrap`'s own horizontal
// padding (the gap between the pill and the screen edge) growing — that
// shrinks the room the bar is stretched to fill.
// Wider than the bar's own inner padding on purpose — this is the gap
// between the floating pill and the screen edge, not anything inside it, so
// widening it is what makes the whole bar read as narrower/floating rather
// than a full-bleed strip. The collapsed value keeps the same ~28pt-total
// narrowing on top of this new baseline that it always applied on top of
// the old one, so the collapse animation's own feel is unchanged — only
// where it starts from is wider.
const WRAP_PADDING_H_EXPANDED = space.xxl; // 24
const WRAP_PADDING_H_COLLAPSED = WRAP_PADDING_H_EXPANDED + 14; // same ~28pt total narrowing as before
// Height: reached by shrinking the bar's own vertical padding AND the
// labels collapsing to nothing (LABEL_MAX_HEIGHT/LABEL_GAP below) — real
// padding/maxHeight, so the icons themselves stay exactly their own true
// size the whole time; only the space around and below them changes.
const BAR_PADDING_V_EXPANDED = space.sm2; // 10
const BAR_PADDING_V_COLLAPSED = 6;
// The label's own height allowance and the gap above it — both shrink to 0
// so a hidden label stops taking up row space rather than leaving a dead
// gap under the icon. Not unmounted: an unmounted label would make the row
// jump straight to its short-row height instead of easing there.
const LABEL_MAX_HEIGHT_EXPANDED = 16;
const LABEL_GAP_EXPANDED = space.xs2; // 6 — the `tab` style's icon-to-label gap this is layered on top of

// The raised button's own fixed layout box (unaffected by scanButtonScale —
// `transform: scale` shrinks what's drawn, not the box RN lays other things
// out against) and the size it visually shrinks to at full collapse, used
// below to work out exactly how far it needs to travel to land level with
// the other 4 icons rather than just settling a little.
const SCAN_BUTTON_BOX = 66;
const SCAN_BUTTON_VISUAL_SIZE_COLLAPSED = SCAN_BUTTON_BOX * 0.55;
// The other tabs' own icon centre-line, measured from the bar's top edge,
// at full collapse: the collapsed vertical padding plus half an icon. Valid
// with labels hidden too — an icon-only tab's own content is just the icon,
// so this doesn't need a separate "label gone" case.
const OTHER_ICON_SIZE = 19;
const ICON_CENTER_FROM_BAR_TOP_COLLAPSED = BAR_PADDING_V_COLLAPSED + OTHER_ICON_SIZE / 2;

// The active pill's fixed height/width, restoring the pre-floating look
// (back then the pill was simply `activeSlot.height`, a constant, because
// there was no collapse animation to ride). Built from the same numbers
// `tab` itself lays out with — icon + label gap + label + the tab's own
// vertical padding on both sides — rather than a guessed constant, so it
// still matches the tab's real expanded content exactly. Deliberately not
// read off onLayout: a measured height moves with the row (see the comment
// where this is used, below), and the whole point here is a size nothing
// about the row's own flex/height/alignItems can compress.
const PILL_HEIGHT =
  OTHER_ICON_SIZE + LABEL_GAP_EXPANDED + LABEL_MAX_HEIGHT_EXPANDED + space.xs2 * 2;

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

  // RN's native-animated layer only ever treats a fixed allowlist of style
  // properties (colors, borderRadius, opacity, transform, zIndex, a couple
  // of iOS shadow props) as animatable, regardless of useNativeDriver.
  // Padding is not on that list, so `t` is plain numeric React state — one
  // shared listener on collapseProgress — and both padding values below are
  // ordinary numbers recomputed from it each render, applied to a plain
  // View. Nothing here is a transform, which is the whole point: no
  // scaling, so nothing gets blurry, and nothing but the padding itself
  // moves.
  //
  // The listener itself only ever writes a ref — never setState directly.
  // scrollEventThrottle: 16 means collapseProgress can update up to ~60
  // times a second, and on a screen whose own scroll/render work already
  // fills most of a 16ms frame (Profile's gradients + long settings list,
  // in particular), a setState per event queues up re-renders faster than
  // the JS thread can flush them — each one arrives late, on top of
  // whatever the screen itself is doing that frame, which is what read as
  // the bar's collapse stuttering there specifically rather than app-wide.
  // Reading the ref inside a single pending requestAnimationFrame instead
  // means at most one TabBar re-render is ever in flight: extra listener
  // firings before that frame just overwrite the ref, and the callback
  // always commits whatever is freshest right before the frame actually
  // paints, so a busy JS thread thins out how often the bar updates rather
  // than letting a backlog of stale commits pile up and drop frames.
  const [t, setT] = useState(0);
  const tRef = useRef(0);
  const latestRef = useRef(0);
  const frameRef = useRef<number | null>(null);
  useEffect(() => {
    const id = collapseProgress.addListener(({ value }) => {
      const clamped = Math.min(1, Math.max(0, value));
      // Rounded to a coarse step (1/48 ≈ 2%) rather than passed straight
      // through — every downstream number here is a handful of pixels at
      // most, so anything finer than this is invisible on screen.
      const rounded = Math.round(clamped * 48) / 48;
      latestRef.current = rounded;
      if (frameRef.current !== null) return;
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        if (latestRef.current === tRef.current) return;
        tRef.current = latestRef.current;
        setT(latestRef.current);
      });
    });
    return () => {
      collapseProgress.removeListener(id);
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, []);
  const lerp = (from: number, to: number) => from + (to - from) * t;

  const wrapPaddingH = lerp(WRAP_PADDING_H_EXPANDED, WRAP_PADDING_H_COLLAPSED);
  const barPaddingV = lerp(BAR_PADDING_V_EXPANDED, BAR_PADDING_V_COLLAPSED);
  // Labels shrink toward (not unmounted at) zero height — see the constants'
  // own comment on why not unmounting matters. Plain numbers, same reason
  // padding is: maxHeight isn't on the native-animated allowlist either.
  const labelMaxHeight = lerp(LABEL_MAX_HEIGHT_EXPANDED, 0);
  const labelGap = lerp(LABEL_GAP_EXPANDED, 0);
  // Fixed — deliberately NOT derived from activeSlot.height or the `t`
  // collapse interpolation. It used to ride the same padding/label shrink
  // every tab does, which on the way to a fully-collapsed icon-only row
  // also flattened the pill itself down toward PILL_HEIGHT's floor of 1px —
  // a thin green line instead of a rounded highlight. The pill's job is to
  // frame the icon, not to mirror the row's own height, so it stays this
  // one constant size (same for every tab, since it's no longer read off
  // each tab's individually-measured box) through every point of the
  // scroll-collapse animation, and is centered in the row by `top` below
  // rather than by matching the row's current height.
  // The raised button travels all the way down to sit level with the other
  // 4 icons by full collapse, not just settle a little — `scanButtonRow`'s
  // `top: -scanLift` is measured against the button's own fixed 66pt layout
  // box (scale doesn't change what RN lays other things out against, only
  // what's drawn inside it), so this works out the exact lift that puts the
  // shrunk button's VISUAL centre (SCAN_BUTTON_VISUAL_SIZE_COLLAPSED tall,
  // sitting in the middle of that 66pt box) on the same line as the other
  // tabs' own icon centres at full collapse.
  const scanLiftCollapsed =
    SCAN_BUTTON_BOX / 2 - (SCAN_BUTTON_BOX - SCAN_BUTTON_VISUAL_SIZE_COLLAPSED) / 2 - ICON_CENTER_FROM_BAR_TOP_COLLAPSED;
  const scanLift = lerp(SCAN_BUTTON_LIFT, scanLiftCollapsed);
  // The button shrinks toward the other icons' rough scale but stays fully
  // visible and green throughout — no fade-out this time (see the file
  // header): with labels gone, the collapsed row is icon-only end to end,
  // so the real button dropping into that row already reads as one of the
  // 5 items rather than needing a substitute glyph the way it did when it
  // used to fade away next to 4 still-labelled tabs.
  const scanButtonScale = collapseProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [1, SCAN_BUTTON_VISUAL_SIZE_COLLAPSED / SCAN_BUTTON_BOX],
  });
  // opacity IS on the native-animated allowlist, so this alone stays a true
  // Animated interpolation rather than plain-number state, unlike
  // labelMaxHeight/labelGap above.
  const labelOpacity = collapseProgress.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });

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
    // undo the floating look. Untouched by the collapse on purpose: the
    // safe-area inset is a property of the device, not of scroll position,
    // and shrinking it along with the bar would let the bar's own corner
    // creep into the home-indicator strip at full collapse. Horizontal
    // padding DOES move (wrapPaddingH) — see the note on
    // WRAP_PADDING_H_COLLAPSED above for why this, not the bar's own
    // padding, is what actually narrows the pill.
    //
    // BAR_LIFT is added on top of the safe-area inset itself (not maxed
    // with it) so there's a visible gap between the bar and the home
    // indicator/bottom edge even on devices with a tall inset — clearing
    // the inset alone leaves the bar sitting flush against it, which reads
    // as docked rather than floating.
    <View
      pointerEvents="box-none"
      style={[
        styles.wrap,
        {
          paddingBottom: Math.max(insets.bottom, 10) + BAR_LIFT,
          paddingHorizontal: wrapPaddingH,
        },
      ]}
    >
      <View style={[styles.bar, { paddingVertical: barPaddingV }]}>
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
                  transform: [{ translateX: slide }],
                },
              ]}
            />
          )}
          {TABS.map((tab) => {
            // The raised button (below, in its own absolutely-positioned
            // row) covers this slot's icon at every point in the animation
            // — expanded it sits well above and this slot is label-only;
            // collapsed it has dropped down into alignment and this slot's
            // own label has hidden, so there is nothing else to show here at
            // all. Rendered only for its (invisible, labelless) touch target
            // and to keep this slot occupying the same place in the row as
            // the other 4, same as before.
            if (tab.key === 'scan') {
              return (
                <TouchableOpacity
                  key={tab.key}
                  style={styles.scanSlot}
                  onPress={() => onChange(tab.key)}
                >
                  <Animated.View
                    style={{ opacity: labelOpacity, maxHeight: labelMaxHeight, marginTop: labelGap }}
                  >
                    <Text style={styles.scanLabel}>{tab.label}</Text>
                  </Animated.View>
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
                {/* Shrinks to fully hidden (opacity 0, height 0) rather than
                    unmounting — an unmounted label would make onLayout's
                    measured tab height jump straight to its collapsed size
                    instead of easing there. The icon above is untouched: it
                    never resizes or moves, only the label underneath it
                    does. */}
                <Animated.View
                  style={{ opacity: labelOpacity, maxHeight: labelMaxHeight, marginTop: labelGap }}
                >
                  <Text style={[styles.label, isActive && styles.labelActive]}>{tab.label}</Text>
                </Animated.View>
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
      <View style={[styles.scanButtonRow, { top: -scanLift }]} pointerEvents="box-none">
        {/* Stays green and fully visible/interactive throughout — only its
            SIZE (scanButtonScale) and vertical position (scanLift, on the
            row above) animate, dropping it from its raised, full-size
            position down to sit level with — and roughly the same visual
            weight as — the other 4 icons at full collapse. Never faded or
            hidden, per "do not remove the Scan icon." */}
        <Animated.View style={{ transform: [{ scale: scanButtonScale }] }}>
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
        </Animated.View>
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  // Absolutely positioned over the screen's content rather than a normal
  // flex sibling of it (which is what this was before) — as a flex sibling,
  // `content` was shortened by exactly this box's height, so the bar sat in
  // its own reserved lane at the bottom rather than floating over the page.
  // That also meant nothing was ever visible "through" or "past" it: the
  // lane's cream background belonged to this box, not to the screen
  // scrolling underneath. `left`/`right`/`bottom` are 0 here — the actual
  // floating inset (from the screen edge, and above the safe area) is
  // wrapPaddingH/paddingBottom below, same numbers as before, just applied
  // to a box that now overlaps the page instead of pushing it up. No
  // `backgroundColor` here (and never was) — only `bar` below paints white,
  // so the cream page background stays visible in the gap on every side of
  // it and underneath it.
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    // No static paddingHorizontal — driven inline (wrapPaddingH) so the
    // room the bar stretches to fill shrinks on collapse; see the render
    // function above for why this, not the bar's own padding, is what
    // narrows the pill's outer footprint.
  },
  bar: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.borderWarm,
    borderRadius: 30,
    paddingHorizontal: space.md2,
    // No static paddingVertical — driven inline (barPaddingV) so the pill
    // can compact in height; see the render function above. Real layout,
    // not a transform, so nothing it contains is ever rasterized-then-
    // scaled — text and icons stay crisp at every point in the animation.
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
    // Fixed height + a `top: '50%'`/negative-marginTop centering pair,
    // rather than relying on `row`'s alignItems: 'center' — an absolutely
    // positioned view is taken out of flex layout, so alignItems never
    // actually sized or centered it in the first place, but pairing this
    // fixed height with an explicit centering offset means no future change
    // to row/bar height, alignItems, or the collapse padding can compress or
    // mis-centre it either. Same height for every tab, since it no longer
    // comes from each tab's own measured (and collapsible) box.
    top: '50%',
    height: PILL_HEIGHT,
    marginTop: -PILL_HEIGHT / 2,
    borderRadius: 18,
    backgroundColor: colors.primaryLighter,
  },
  tab: {
    // Fixed, never resized by the collapse — this is what keeps the 5 items
    // themselves from ever being squeezed; only the bar's own
    // paddingHorizontal (the space around this fixed-width row) moves. No
    // static `gap` — the icon-to-label spacing is entirely the label's own
    // animated marginTop (labelGap, in the render function), so it can
    // shrink to 0 alongside the label instead of leaving a fixed gap behind
    // once the label itself has hidden.
    width: 58,
    alignItems: 'center',
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
    // Same reasoning as `tab` above — no static gap, and no icon either:
    // the raised button (rendered separately, absolutely positioned) is
    // the only visual this slot ever needs; see the render function.
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
    // No static `top` — driven inline (scanLift) so the button's raised
    // height above the bar shrinks in step with the bar's own vertical
    // padding, rather than staying pinned at its full-height offset while
    // the bar shrinks away beneath it.
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  scanButton: {
    // This is the button's own fixed layout box, not its rendered size —
    // scanButtonScale (an Animated.View wrapper around this, in the render
    // function) is what actually shrinks it visually on collapse. Kept
    // fixed here rather than animated directly because a wrapping
    // transform is what SCAN_BUTTON_BOX's own math depends on staying
    // constant; see the note there.
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
