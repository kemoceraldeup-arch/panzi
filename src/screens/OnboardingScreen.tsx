// src/screens/OnboardingScreen.tsx

import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  Animated,
  ScrollView,
  TouchableOpacity,
  useWindowDimensions,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import Text from '../components/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import MascotVideo from '../components/MascotVideo';
import { onboardingPages } from '../data/onboardingContent';
import OnboardingCardPage from '../components/onboarding/OnboardingCardPage';
import {
  ScanCard,
  FreshnessCard,
  RecipeCard,
  ChatCard,
} from '../components/onboarding/OnboardingCards';
import { makeStyles } from '../theme/makeStyles';
import { useColors } from '../theme/ThemeProvider';
import { space } from '../theme/spacing';
import { type } from '../theme/typography';

// How far the welcome mascot's video is inset from each side of its box. See
// styles.welcomeVideo — this is the knob for how large the mascot renders.
const WELCOME_VIDEO_INSET = '6%';

// Preview card shown per page (welcome page has none — it shows the hero mascot instead).
const CARD_BY_KEY: Record<string, React.ComponentType | null> = {
  welcome: null,
  scan: ScanCard,
  freshness: FreshnessCard,
  recipes: RecipeCard,
  chat: ChatCard,
};

type Props = {
  onDone: () => void; // called when the user reaches Account (login)
};

export default function OnboardingScreen({ onDone }: Props) {
  const styles = useStyles();
  const colors = useColors();
  const { width } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);
  const [scrollerHeight, setScrollerHeight] = useState(0);
  // Native-driven — feeds opacity/translateY on the page transitions, both
  // native-drivable properties.
  const scrollX = useRef(new Animated.Value(0)).current;
  // JS-driven — feeds the dots' width/backgroundColor. Those properties
  // aren't native-drivable, and reading them off a natively-driven value
  // throws "Style property ... is not supported by native animated module"
  // and renders garbage interpolated colors.
  const scrollXJS = useRef(new Animated.Value(0)).current;
  const [index, setIndex] = useState(0);
  // Mirrors `index` so the scroll listener can tell whether the page actually
  // changed without re-creating the listener on every render.
  const indexRef = useRef(0);
  const bubbleScale = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(bubbleScale, {
      toValue: 1,
      delay: 900,
      friction: 6,
      tension: 60,
      useNativeDriver: true,
    }).start();
  }, [bubbleScale]);

  const isFirst = index === 0;
  const isMiddle = index > 0 && index < onboardingPages.length - 1;
  const isLast = index === onboardingPages.length - 1;

  function updateIndex(i: number) {
    if (i === indexRef.current || i < 0 || i >= onboardingPages.length) return;
    indexRef.current = i;
    setIndex(i);
  }

  function goToIndex(i: number) {
    scrollRef.current?.scrollTo({ x: i * width, animated: true });
    updateIndex(i);
  }

  // The index has to follow the finger, not the settle. Updating it only in
  // onMomentumScrollEnd made the footer wait out the whole paging deceleration
  // before swapping — swiping back to the welcome page left "Get started"
  // missing for the length of the snap animation.
  const trackScrollXJS = useRef(
    Animated.event([{ nativeEvent: { contentOffset: { x: scrollXJS } } }], {
      useNativeDriver: false,
    })
  ).current;

  function handleScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    trackScrollXJS(e);
    if (width > 0) updateIndex(Math.round(e.nativeEvent.contentOffset.x / width));
  }

  function handleMomentumEnd(e: NativeSyntheticEvent<NativeScrollEvent>) {
    updateIndex(Math.round(e.nativeEvent.contentOffset.x / width));
  }

  // Footer/header chrome cross-fades with the swipe on the native driver, so it
  // tracks the gesture with no JS round-trip. The handoff overlaps slightly
  // around the halfway point to avoid a blank frame mid-swap.
  const fadeOut = width * 0.55;
  const fadeIn = width * 0.45;
  const lastStart = (onboardingPages.length - 2) * width;

  const firstFooterOpacity = scrollX.interpolate({
    inputRange: [0, fadeOut],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });
  // Leading edge starts at fadeOut, not fadeIn: the welcome page's two buttons
  // fill the whole footer box, and the bottom chrome sits over where the lower
  // one is, so they must not be visible at the same time.
  const middleFooterOpacity = scrollX.interpolate({
    inputRange: [fadeOut, width, lastStart, lastStart + fadeOut],
    outputRange: [0, 1, 1, 0],
    extrapolate: 'clamp',
  });
  const lastFooterOpacity = scrollX.interpolate({
    inputRange: [lastStart + fadeIn, lastStart + width],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  // Driven off the JS value because the dots' own width/color are JS-driven —
  // keeping the whole group on one driver avoids mixing them on one node.
  const chromeOpacity = scrollXJS.interpolate({
    inputRange: [fadeOut, width],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  // Skip has nothing left to skip TO once the last page is reached — fades
  // out over the same approach the footer's own last-page swap uses, so the
  // two disappear/appear in the same rhythm rather than Skip cutting off
  // abruptly mid-transition.
  const skipOpacity = scrollXJS.interpolate({
    inputRange: [fadeOut, width, lastStart, lastStart + fadeOut],
    outputRange: [0, 1, 1, 0],
    extrapolate: 'clamp',
  });

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* Skip button — shown on every page except the first and the last:
          the first has nothing to skip past yet, and the last has nothing
          left to skip TO — "Create my pantry" is already the way off it. */}
      <View style={styles.skipRow}>
        <Animated.View style={{ opacity: skipOpacity }} pointerEvents={isFirst || isLast ? 'none' : 'auto'}>
          <TouchableOpacity onPress={onDone}>
            <Text style={styles.skipText}>Skip</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>

      <Animated.ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        // Locked to the welcome page until "Get started" is tapped — a swipe
        // shouldn't be a second, undocumented way past a page whose whole
        // point is that button. scrollEnabled only blocks the user's own
        // touch-drag; goToIndex's own scrollTo() call still moves the
        // scroller programmatically regardless of this, which is what lets
        // "Get started" itself advance off this same page.
        scrollEnabled={!isFirst}
        showsHorizontalScrollIndicator={false}
        onLayout={(e) => setScrollerHeight(e.nativeEvent.layout.height)}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { x: scrollX } } }],
          { useNativeDriver: true, listener: handleScroll }
        )}
        scrollEventThrottle={16}
        onMomentumScrollEnd={handleMomentumEnd}
      >
        {onboardingPages.map((page, i) => {
          const Card = CARD_BY_KEY[page.key];
          const inputRange = [(i - 1) * width, i * width, (i + 1) * width];
          const opacity = scrollX.interpolate({
            inputRange,
            outputRange: [0, 1, 0],
            extrapolate: 'clamp',
          });
          const translateY = scrollX.interpolate({
            inputRange,
            outputRange: [14, 0, 14],
            extrapolate: 'clamp',
          });

          return (
            <View key={page.key} style={{ width, height: scrollerHeight || undefined }}>
              <Animated.View style={{ flex: 1, opacity, transform: [{ translateY }] }}>
                {page.key === 'welcome' ? (
                  <View style={styles.welcomeContent}>
                    <View style={styles.welcomeVideoWrap}>
                      {/* Plays once and holds; replays each time the user
                          swipes back to this page. */}
                      <MascotVideo
                        clip="wave"
                        style={styles.welcomeVideo}
                        contentFit="cover"
                        active={isFirst}
                      />
                      <LinearGradient
                        colors={[colors.backgroundLightFade, colors.backgroundLight]}
                        style={styles.welcomeFade}
                      />
                      <Animated.Image
                        source={require('../../assets/mascot/panzi-bubble.png')}
                        style={[
                          styles.welcomeBubble,
                          { transform: [{ scale: bubbleScale }] },
                        ]}
                        resizeMode="contain"
                      />
                    </View>
                    <View style={styles.welcomeCopy}>
                      {!!page.eyebrow && <Text style={styles.eyebrow}>{page.eyebrow}</Text>}
                      <Text style={styles.title}>{page.title}</Text>
                      <Text style={styles.description}>{page.description}</Text>
                    </View>
                  </View>
                ) : (
                  <OnboardingCardPage
                    eyebrow={page.eyebrow}
                    title={page.title}
                    description={page.description}
                  >
                    {Card && <Card />}
                  </OnboardingCardPage>
                )}
              </Animated.View>
            </View>
          );
        })}
      </Animated.ScrollView>

      {/* Footer — differs per page, matching the design. All three variants stay
          mounted and stacked, cross-fading with the swipe: the footer's height
          is fixed so the scroller above it never resizes between pages, and
          only the visible layer takes touches. */}
      <View style={styles.footer}>
        <Animated.View
          style={[styles.footerLayer, { opacity: firstFooterOpacity }]}
          pointerEvents={isFirst ? 'auto' : 'none'}
        >
          <TouchableOpacity style={styles.primaryButton} onPress={() => goToIndex(1)}>
            <Text style={styles.primaryButtonText}>Get started</Text>
          </TouchableOpacity>
        </Animated.View>

        <Animated.View
          style={[styles.footerLayer, { opacity: lastFooterOpacity }]}
          pointerEvents={isLast ? 'auto' : 'none'}
        >
          <TouchableOpacity style={styles.primaryButton} onPress={onDone}>
            <Text style={styles.primaryButtonText}>Create my pantry</Text>
          </TouchableOpacity>
        </Animated.View>

        {/* Dots stacked directly on top of the SWIPE hint, as one group pinned
            to the bottom of the reserved footer space. They're one unit rather
            than two separately positioned rows, so the pair can't drift apart
            as the footer variants swap. */}
        <View style={styles.bottomChrome} pointerEvents="box-none">
          {/* Kept mounted and faded rather than unmounted, so the row's height
              never changes and nothing around it gets re-laid-out mid-swipe.
              Width and color track scrollX continuously so the indicator glides
              with the swipe instead of snapping only once a page settles. */}
          <Animated.View style={[styles.dotsRow, { opacity: chromeOpacity }]}>
            {onboardingPages.map((_, i) => {
              const inputRange = [(i - 1) * width, i * width, (i + 1) * width];
              const dotWidth = scrollXJS.interpolate({
                inputRange,
                outputRange: [6, 22, 6],
                extrapolate: 'clamp',
              });
              const dotColor = scrollXJS.interpolate({
                inputRange,
                outputRange: [colors.tan, colors.primaryDark, colors.tan],
                extrapolate: 'clamp',
              });
              return (
                <Animated.View
                  key={i}
                  style={[styles.dot, { width: dotWidth, backgroundColor: dotColor }]}
                />
              );
            })}
          </Animated.View>

          <Animated.View
            style={{ opacity: middleFooterOpacity }}
            pointerEvents={isMiddle ? 'auto' : 'none'}
          >
            <TouchableOpacity style={styles.swipeHint} onPress={() => goToIndex(index + 1)}>
              <Text style={styles.swipeHintText}>SWIPE</Text>
              <Text style={styles.swipeHintArrow}>›</Text>
            </TouchableOpacity>
          </Animated.View>
        </View>
      </View>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((colors) => ({
  container: {
    flex: 1,
    backgroundColor: colors.backgroundLight,
  },
  skipRow: {
    height: 44,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingHorizontal: space.xxl,
  },
  skipText: {
    fontWeight: '700',
    fontSize: type.body.fontSize,
    color: colors.textSecondary,
  },
  welcomeContent: {
    flex: 1,
  },
  welcomeVideoWrap: {
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
    backgroundColor: colors.backgroundLight,
  },
  // The wave clip is a tall 9:16 frame in a box that's much wider than that,
  // so `cover` scales it up to match the box width and crops the top and
  // bottom away — which is what made the mascot read as oversized. Insetting
  // it horizontally scales the mascot back down; the clip still overflows the
  // box vertically, so `cover` has no gap to expose at the edges. Raise the
  // inset to shrink the mascot further.
  welcomeVideo: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: WELCOME_VIDEO_INSET,
    right: WELCOME_VIDEO_INSET,
  },
  welcomeFade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 120,
  },
  welcomeBubble: {
    position: 'absolute',
    left: 16,
    top: 16,
    width: 138,
    height: 138,
  },
  welcomeCopy: {
    flexGrow: 0,
    paddingHorizontal: space.xxxl,
    paddingTop: space.xs,
  },
  eyebrow: {
    fontWeight: '800',
    fontSize: type.caption.fontSize,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.primary,
    marginBottom: space.xs,
  },
  title: {
    fontWeight: '800',
    fontSize: type.display.fontSize,
    lineHeight: 38,
    color: colors.primaryDarker,
    marginBottom: space.md,
  },
  description: {
    fontSize: type.body.fontSize,
    lineHeight: 23,
    color: colors.textSecondary,
  },
  // Pinned to the bottom of the footer box, so on the middle pages the dots and
  // the SWIPE hint sit down by the screen edge instead of floating at the top
  // of the space the two-button layout reserves.
  bottomChrome: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 16,
    alignItems: 'center',
    gap: space.md,
  },
  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: space.sm,
  },
  dot: {
    height: 6,
    borderRadius: 3,
  },
  // Height is pinned to the tallest variant (56 button + 14 gap + 44 text
  // button) so swapping footers never changes the layout of the pages above.
  footer: {
    height: 20 + 56 + 14 + 44 + 16,
  },
  footerLayer: {
    ...StyleSheet.absoluteFillObject,
    paddingHorizontal: space.xxl,
    paddingTop: space.xl,
    paddingBottom: space.lg,
    gap: space.md2,
  },
  primaryButton: {
    height: 56,
    borderRadius: 18,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    color: colors.onAccent,
    fontWeight: '800',
    fontSize: type.subtitle.fontSize,
  },
  swipeHint: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    height: 24,
  },
  swipeHintText: {
    fontWeight: '800',
    fontSize: type.caption.fontSize,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.textSecondary,
  },
  swipeHintArrow: {
    fontWeight: '700',
    fontSize: type.body.fontSize,
    color: colors.textSecondary,
  },
}));