// src/screens/cook/CookStepScreen.tsx
//
// One instruction at a time, read from a metre away with oily hands — the
// step-by-step half of cook mode. The other half is CookCompleteSheet, shown
// on top of this screen once the last step's Finish is pressed; this screen
// stays mounted underneath it exactly as specified, rather than unmounting
// itself in favour of a "finished" screen the way the previous cook mode did.
//
// This is a fixed, literal design — its own type scale, its own font
// (Quicksand, registered as `fonts.cook` in theme/typography.ts) — not a
// reskin of the app's Baloo2/Nunito system. Its palette follows the app's own
// light/dark scheme (see cookTokens below) rather than staying cream at
// midnight while every other screen goes dark.
//
// Nothing here counts up or down or ticks on a clock. "56 min" (or whatever a
// real recipe's own figure comes out to) is a label CookCompleteSheet prints
// once and never revisits.

import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  ImageSourcePropType,
  Pressable,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useKeepAwake } from 'expo-keep-awake';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Text from '../../components/Text';
import { fonts } from '../../theme/typography';
import { useTheme } from '../../theme/ThemeProvider';
import CookCompleteSheet, { CookCompleteStat } from './CookCompleteSheet';
import { cookTokens, CookTokens } from './cookTokens';

export type CookStep = {
  phase: string;
  instruction: string;
  ingredients: string[];
  photo: ImageSourcePropType | null;
};

export type CookStepScreenProps = {
  recipeName: string;
  steps: CookStep[];
  /** The three Complete-sheet stat tiles, in display order — e.g.
   *  [{value:'5',unit:undefined,label:'STEPS'}, {value:'56',unit:'min',label:'COOK TIME'}, {value:'4',unit:undefined,label:'SERVINGS'}].
   *  Passed through rather than derived here, since "cook time" and
   *  "servings" mean different things for different recipes and this screen
   *  has no business guessing at either. */
  stats: [CookCompleteStat, CookCompleteStat, CookCompleteStat];
  /** Shown on the complete sheet under the title — e.g. "Adobo done!". */
  completeTitle: string;
  /** The sheet's body line — e.g. "Let it rest 5 minutes, then spoon the
   *  sauce over rice.". */
  completeBody: string;
  onClose: () => void;
  onRate: (stars: number) => void;
};

const HIT_SLOP = { top: 10, bottom: 10, left: 10, right: 10 };
const PROGRESS_COLOR_DURATION = 200;

export default function CookStepScreen({
  recipeName,
  steps,
  stats,
  completeTitle,
  completeBody,
  onClose,
  onRate,
}: CookStepScreenProps) {
  useKeepAwake();
  const insets = useSafeAreaInsets();
  const { scheme } = useTheme();
  const tokens = cookTokens[scheme];
  const styles = React.useMemo(() => makeStyles(tokens), [tokens]);
  const [stepIndex, setStepIndex] = useState(0);
  const [completed, setCompleted] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const nextButtonRef = useRef<View>(null);

  // Same contentFit="cover", fills-the-box treatment DishTile uses for the
  // recipe card/detail photo, so the same dish photo reads as the same
  // picture in both places rather than looking newly cropped or zoomed here.
  // 268 is the spec's fixed hero height at this width.
  const heroHeight = 268;

  const total = steps.length;
  const step = steps[stepIndex];
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === total - 1;

  // "Step 3 of 5, Reduce" — announced every time the visible step changes,
  // including via Back, so a screen-reader user gets the same information a
  // sighted user reads off the hero's step chip.
  useEffect(() => {
    AccessibilityInfo.announceForAccessibility?.(
      `Step ${stepIndex + 1} of ${total}, ${step.phase}`
    );
    scrollRef.current?.scrollTo({ y: 0, animated: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIndex]);

  function handleNext() {
    if (isLast) {
      setCompleted(true);
      return;
    }
    setStepIndex((i) => Math.min(total - 1, i + 1));
  }

  function handleBack() {
    setStepIndex((i) => Math.max(0, i - 1));
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.columnCap}>
      <View style={styles.column}>
        <Hero
          step={step}
          stepIndex={stepIndex}
          total={total}
          recipeName={recipeName}
          height={heroHeight}
          onClose={onClose}
          tokens={tokens}
          styles={styles}
        />

        <Progress current={stepIndex} total={total} tokens={tokens} styles={styles} />

        <ScrollView
          ref={scrollRef}
          style={styles.body}
          contentContainerStyle={styles.bodyContent}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.instruction}>{step.instruction}</Text>

          {step.ingredients.length > 0 && (
            <>
              <Text style={styles.ingredientsLabel}>IN THIS STEP</Text>
              <View style={styles.chipRow}>
                {step.ingredients.map((ingredient) => (
                  <View key={ingredient} style={styles.chip}>
                    <Text style={styles.chipText}>{ingredient}</Text>
                  </View>
                ))}
              </View>
            </>
          )}
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.backButton, isFirst && styles.backButtonDisabled]}
            onPress={handleBack}
            disabled={isFirst}
            hitSlop={HIT_SLOP}
            accessibilityRole="button"
            accessibilityLabel="Previous step"
            accessibilityState={{ disabled: isFirst }}
          >
            <Ionicons name="chevron-back" size={18} color={tokens.ink} />
          </TouchableOpacity>

          <PressableNext
            forwardRef={nextButtonRef}
            onPress={handleNext}
            label={isLast ? 'Finish' : 'Next'}
            styles={styles}
          />
        </View>
      </View>
      </View>

      <CookCompleteSheet
        visible={completed}
        title={completeTitle}
        body={completeBody}
        stats={stats}
        onRate={(stars) => {
          // Submitting a rating ends the cook the same way "Back to recipe"
          // does — there is nothing left to do inside cook mode once a star
          // is picked, so this leaves rather than resetting back to step 1
          // and leaving the sheet's stats view showing underneath.
          onRate(stars);
          onClose();
        }}
        onBackToRecipe={onClose}
      />
    </View>
  );
}

function Hero({
  step,
  stepIndex,
  total,
  recipeName,
  height,
  onClose,
  tokens,
  styles,
}: {
  step: CookStep;
  stepIndex: number;
  total: number;
  recipeName: string;
  height: number;
  onClose: () => void;
  tokens: CookTokens;
  styles: CookStyles;
}) {
  return (
    <View style={[styles.hero, { height }]}>
      {/* Fallback for the no-photo case — same gradient/glyph-less flat fill
          DishTile falls back to, painted underneath so there is never a bare
          gap if step.photo is null. */}
      <View style={[StyleSheet.absoluteFill, styles.heroFallback]} />
      {step.photo && (
        // Same treatment as DishTile's own photo tile: contentFit="cover"
        // filling the whole box, so a dish's photo is framed identically
        // here and on the recipe card/detail screen instead of being shrunk
        // into a smaller letterboxed rectangle.
        <Image source={step.photo} style={StyleSheet.absoluteFill} contentFit="cover" />
      )}

      <LinearGradient
        colors={['transparent', 'rgba(23,23,15,0.72)']}
        locations={[0.55, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      <View style={styles.heroTopRow}>
        <TouchableOpacity
          style={styles.closeButton}
          onPress={onClose}
          hitSlop={HIT_SLOP}
          accessibilityRole="button"
          accessibilityLabel="Close cook mode"
        >
          <Ionicons name="close" size={17} color={tokens.ink} />
        </TouchableOpacity>

        <View style={styles.stepChip}>
          <Text style={styles.stepChipText}>
            Step {stepIndex + 1} of {total}
          </Text>
        </View>
      </View>

      <View style={styles.heroBottomOverlay}>
        <Text style={styles.heroRecipeName} numberOfLines={1}>
          {recipeName}
        </Text>
        <Text style={styles.heroPhase} numberOfLines={1}>
          {step.phase}
        </Text>
      </View>
    </View>
  );
}

function Progress({
  current,
  total,
  tokens,
  styles,
}: {
  current: number;
  total: number;
  tokens: CookTokens;
  styles: CookStyles;
}) {
  return (
    <View
      style={styles.progressRow}
      accessibilityRole="progressbar"
      // React Native's accessibilityValue is the RN-side equivalent of
      // aria-valuenow/min/max — there is no literal aria-* prop on native
      // views, so this is the closest same-meaning mapping the platform has.
      accessibilityValue={{ min: 1, max: total, now: current + 1 }}
      accessibilityLabel="Recipe progress"
    >
      {Array.from({ length: total }).map((_, i) => (
        <ProgressSegment key={i} filled={i <= current} tokens={tokens} styles={styles} />
      ))}
    </View>
  );
}

function ProgressSegment({
  filled,
  tokens,
  styles,
}: {
  filled: boolean;
  tokens: CookTokens;
  styles: CookStyles;
}) {
  const anim = useRef(new Animated.Value(filled ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: filled ? 1 : 0,
      duration: PROGRESS_COLOR_DURATION,
      useNativeDriver: false, // backgroundColor cannot use the native driver
    }).start();
  }, [filled, anim]);

  const backgroundColor = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [tokens.track, tokens.accent],
  });

  return <Animated.View style={[styles.progressSegment, { backgroundColor }]} />;
}

function PressableNext({
  onPress,
  label,
  forwardRef,
  styles,
}: {
  onPress: () => void;
  label: string;
  forwardRef: React.RefObject<View | null>;
  styles: CookStyles;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const [hovered, setHovered] = useState(false);

  function pressIn() {
    Animated.timing(scale, { toValue: 0.97, duration: 120, useNativeDriver: true }).start();
  }
  function pressOut() {
    Animated.timing(scale, { toValue: 1, duration: 120, useNativeDriver: true }).start();
  }

  return (
    <Animated.View style={[styles.nextButtonWrap, { transform: [{ scale }] }]}>
      <Pressable
        ref={forwardRef as any}
        style={[styles.nextButton, hovered && styles.nextButtonHovered]}
        onPress={onPress}
        onPressIn={pressIn}
        onPressOut={pressOut}
        // No-ops on iOS/Android — Pressable's hover callbacks only ever fire
        // on web, which is exactly where the spec's hover state applies.
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
        accessibilityRole="button"
      >
        <Text style={styles.nextText}>{label}</Text>
      </Pressable>
    </Animated.View>
  );
}

// Reference frame is 390×844; everything below is expressed in those pixels
// and simply stretches with the flex column around it, per the fluid/
// safe-area-aware brief — there is no scale factor applied, since the values
// given (268px hero, 66×56 back button, 56-tall Next…) are themselves already
// meant to hold across 320–430px widths. columnCap is the one exception: on a
// wide viewport (tablet, web) the content column stops growing past 560 and
// centers, rather than a 268px hero stretching edge-to-edge on a 1200px window.
// The hero's height is itself a second exception — see heroHeight above,
// where it is computed rather than pinned at the spec's 268px, so the
// close-to-square bundled dish photos aren't cropped as tightly as a fixed
// 268px against a full phone width would cover-fit them to.
//
// Built per-scheme rather than as a static StyleSheet, since every colour
// here comes from `tokens` (see cookTokens.ts) and has to follow the app's
// light/dark switch instead of staying fixed to the light spec.
function makeStyles(tokens: CookTokens) {
  // RN's shadowColor and shadowOpacity are separate channels that multiply
  // together — an rgba() shadowColor's own alpha would stack with
  // shadowOpacity rather than express it, so each shadow here is the spec's
  // rgba() split into an opaque shadowColor and its alpha moved into
  // shadowOpacity.
  const SHADOW_CONTROL = {
    shadowColor: tokens.shadowColor,
    shadowOpacity: 0.16,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  };

  const SHADOW_CHIP = {
    shadowColor: tokens.shadowColor,
    shadowOpacity: 0.1,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  };

  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: tokens.page,
    },
    columnCap: {
      flex: 1,
      width: '100%',
      maxWidth: 560,
      alignSelf: 'center',
    },
    column: {
      flex: 1,
    },
    hero: {
      flex: 0,
      marginTop: 8,
      marginHorizontal: 12,
      marginBottom: 0,
      borderRadius: 26,
      overflow: 'hidden',
      backgroundColor: tokens.heroFallback,
    },
    heroFallback: {
      backgroundColor: tokens.heroFallback,
    },
    heroTopRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      padding: 14,
    },
    closeButton: {
      width: 42,
      height: 42,
      borderRadius: 14,
      backgroundColor: tokens.surface,
      alignItems: 'center',
      justifyContent: 'center',
      ...SHADOW_CONTROL,
    },
    stepChip: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 999,
      backgroundColor: tokens.stepChipFill,
    },
    stepChipText: {
      fontFamily: fonts.cook,
      fontSize: 12,
      fontWeight: '700',
      color: tokens.ink,
    },
    heroBottomOverlay: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      padding: 18,
    },
    heroRecipeName: {
      fontFamily: fonts.cook,
      fontSize: 20,
      fontWeight: '700',
      color: '#FFFFFF',
    },
    heroPhase: {
      fontFamily: fonts.cook,
      fontSize: 13,
      fontWeight: '500',
      color: 'rgba(255,255,255,.82)',
      marginTop: 2,
    },
    progressRow: {
      flexDirection: 'row',
      paddingHorizontal: 20,
      paddingTop: 16,
      gap: 6,
    },
    progressSegment: {
      flex: 1,
      height: 6,
      borderRadius: 999,
    },
    body: {
      flex: 1,
    },
    bodyContent: {
      paddingHorizontal: 20,
      paddingTop: 22,
      paddingBottom: 24,
    },
    instruction: {
      fontFamily: fonts.cook,
      fontSize: 26,
      lineHeight: 26 * 1.28,
      fontWeight: '600',
      color: tokens.ink,
    },
    ingredientsLabel: {
      fontFamily: fonts.cook,
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 0.1 * 11,
      color: tokens.label,
      marginTop: 22,
    },
    chipRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginTop: 10,
    },
    chip: {
      paddingHorizontal: 13,
      paddingVertical: 9,
      borderRadius: 14,
      backgroundColor: tokens.surface,
      ...SHADOW_CHIP,
    },
    chipText: {
      fontFamily: fonts.cook,
      fontSize: 13,
      fontWeight: '600',
      color: tokens.ink2,
    },
    footer: {
      flex: 0,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      borderTopWidth: 1,
      borderTopColor: tokens.hairline,
      paddingHorizontal: 20,
      paddingTop: 14,
      paddingBottom: 28,
    },
    backButton: {
      width: 66,
      height: 56,
      borderRadius: 18,
      backgroundColor: tokens.surface,
      alignItems: 'center',
      justifyContent: 'center',
      ...SHADOW_CONTROL,
    },
    backButtonDisabled: {
      opacity: 0.45,
    },
    nextButtonWrap: {
      flex: 1,
    },
    nextButton: {
      height: 56,
      borderRadius: 999,
      backgroundColor: tokens.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    nextButtonHovered: {
      backgroundColor: tokens.accentHover,
    },
    nextText: {
      fontFamily: fonts.cook,
      fontSize: 17,
      fontWeight: '700',
      color: tokens.onAccent,
    },
  });
}

type CookStyles = ReturnType<typeof makeStyles>;
