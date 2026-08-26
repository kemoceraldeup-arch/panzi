// src/screens/scan/ScanCameraScreen.tsx
//
// Screen 01 of the item scanner — aiming. The default state of the flow.
//
// One mode. The scanner used to carry four — shelf photo, receipt, use-by date,
// handwritten note — and choosing between them was work the user had to do
// before the app had done any. Now every photo is read for all three things at
// once: what it is, when it goes off, and how ripe it looks.
//
// The camera is a window on a cream page rather than a full-bleed viewfinder.
// That is deliberate: it leaves room above for the two capability cards, which
// tell the user what they are about to get *before* they take the shot. A
// scanner that only explains itself in the results has already disappointed
// anyone who framed the photo wrong.

import React, { useRef, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { CameraView } from 'expo-camera';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Text from '../../components/Text';
import { fonts, type } from '../../theme/typography';
import { HIT_SLOP } from './atoms';
import { makeStyles } from '../../theme/makeStyles';
import { useColors } from '../../theme/ThemeProvider';
import { space } from '../../theme/spacing';

// ─── Lenses ──────────────────────────────────────────────────────────────
//
// Two stops, both physical lenses, both at `zoom: 0`. Nothing here is
// calculated, which is the point: on a lens's own sensor, no zoom *is* that
// lens's focal length, so "0.5x" and "1x" are exact by construction.
//
// The alternative — digital zoom above 1x — was tried and abandoned.
// expo-camera's `zoom` is a 0–1 fraction of a ceiling neither it nor
// AVFoundation will report, so turning it into the multiples the stock Camera
// app prints means measuring that ceiling by eye, per device. The readings
// never settled: on one iPhone 12 Pro the same model fitted 60x, then 6x, then
// 3.56x, and still put "2x" at 6x. Any figure above 1x would be a guess
// wearing a decimal point, wrong on every phone but the one it was fitted to.
//
// Digital zoom also costs what this screen most needs. Past 1x the sensor is
// upscaling pixels it never captured, and a blurred label reads worse than a
// smaller sharp one. Walking closer beats zooming, and the two lenses cover
// what a phone can genuinely do.
//
// A device reports its lens's *localized* name, so an iPhone 12 Pro answers
// "Back Camera" and "Back Ultra Wide Camera", never "builtInWideAngleCamera".
// Both spellings are matched, since passing `selectedLens` a name the device
// doesn't offer is ignored silently.
const LENSES: { label: string; match: (key: string) => boolean }[] = [
  { label: '.5', match: (key) => key.includes('ultrawide') },
  // Checked exactly — every other rear lens's name also starts with "back".
  { label: '1', match: (key) => key === 'backcamera' || key.includes('wideangle') },
];

// Where the screen opens: the wide lens. Most pixels and least distortion,
// which is what reading small print needs.
const DEFAULT_LABEL = '1';

function normalise(name: string): string {
  return name.toLowerCase().replace(/[^a-z]/g, '');
}

/** The two lenses this phone offers, widest first. */
function pickLenses(available: string[]): { id: string; label: string }[] {
  return LENSES.flatMap(({ label, match }) => {
    const id = available.find((name) => match(normalise(name)));
    return id ? [{ id, label }] : [];
  });
}

type Props = {
  /** Opens with the torch already on — what "Retake with torch on" promises
   *  after a shot came back too dark or too blurry to read. */
  initialTorch?: boolean;
  onClose: () => void;
  /** Dimensions come with the shot so the recognition call can resize by the
   *  long edge without reading the file back to measure it. */
  onCapture: (photo: { uri: string; width: number; height: number }) => void;
  /** Reads a photo from the library through the same pipeline as a capture. */
  onAddByHand: () => void;
  onOpenHistory: () => void;
};

export default function ScanCameraScreen({
  initialTorch = false,
  onClose,
  onCapture,
  onAddByHand,
  onOpenHistory,
}: Props) {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const camera = useRef<CameraView>(null);
  const [torch, setTorch] = useState(initialTorch);
  const [capturing, setCapturing] = useState(false);

  // What this phone offers, once it has said so. Empty until then — and on
  // Android, forever — which is why the switcher only appears when there is
  // genuinely a choice to make.
  const [lenses, setLenses] = useState<{ id: string; label: string }[]>([]);
  const [label, setLabel] = useState(DEFAULT_LABEL);

  const lens = lenses.find((option) => option.label === label)?.id;

  async function capture() {
    // Guard rather than debounce: a second shutter press mid-capture would
    // start a competing read and land two batches on the review page.
    if (capturing) return;
    setCapturing(true);
    try {
      const photo = await camera.current?.takePictureAsync({ quality: 0.8 });
      if (photo?.uri) onCapture({ uri: photo.uri, width: photo.width, height: photo.height });
    } finally {
      setCapturing(false);
    }
  }

  /** What the device calls its lenses, once it is ready to say. */
  async function readLenses() {
    try {
      setLenses(pickLenses((await camera.current?.getAvailableLensesAsync()) ?? []));
    } catch {
      // iOS-only call. On Android it throws, which is not an error worth
      // surfacing — it just means there is no choice to make.
      setLenses([]);
    }
  }

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
          <Text style={styles.title}>Scan an item</Text>
          <Text style={styles.subtitle}>One photo. Several at once is fine.</Text>
        </View>
        <TouchableOpacity
          style={styles.headerButton}
          onPress={onOpenHistory}
          hitSlop={HIT_SLOP}
          accessibilityLabel="Past scans"
        >
          <Ionicons name="time-outline" size={19} color={colors.primaryDark} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.headerButton}
          onPress={onClose}
          hitSlop={HIT_SLOP}
          accessibilityLabel="Close the scanner"
        >
          <Ionicons name="close" size={19} color={colors.primaryDark} />
        </TouchableOpacity>
      </View>

      {/* What the scan will actually tell you, said before the shutter rather
          than after. Both reads are named, and the second one names its limit —
          ripeness is for loose fruit, not for a sealed tub. */}
      <View style={styles.capabilities}>
        <View style={styles.capabilityCard}>
          <Text style={styles.capabilityLabel}>Dates</Text>
          <Text style={styles.capabilityBody}>read off the label</Text>
        </View>
        <View style={styles.capabilityCard}>
          <Text style={styles.capabilityLabel}>Ripeness</Text>
          <Text style={styles.capabilityBody}>judged for loose fruit</Text>
        </View>
      </View>

      <View style={styles.viewfinder}>
        <LinearGradient
          colors={colors.cameraDark}
          start={{ x: 0.2, y: 0 }}
          end={{ x: 0.8, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <CameraView
          ref={camera}
          style={StyleSheet.absoluteFill}
          facing="back"
          selectedLens={lens}
          enableTorch={torch}
          onCameraReady={readLenses}
        />

        {/* Corner brackets rather than a full rectangle — they suggest where to
            aim without implying the crop is what gets read. */}
        <View style={styles.frameGuide} pointerEvents="none">
          <View style={[styles.corner, styles.cornerTopLeft]} />
          <View style={[styles.corner, styles.cornerTopRight]} />
          <View style={[styles.corner, styles.cornerBottomLeft]} />
          <View style={[styles.corner, styles.cornerBottomRight]} />
        </View>

        <View style={styles.hintWrap} pointerEvents="none">
          <View style={styles.hint}>
            <Image
              source={require('../../../assets/mascot/panzi-bust.png')}
              style={styles.hintAvatar}
            />
            <Text style={styles.hintText}>Turn any labels toward me</Text>
          </View>
        </View>
      </View>

      {/* Camera settings live on the cream page, under the window, rather than
          floating inside it.
          Translucent chrome over live video is a compromise every time — it has
          to stay legible against a bright worktop and a dark fridge in the same
          session, so it ends up either washed out or heavy enough to fight the
          brackets and the hint pill for the same corners. Down here they get
          the page's own contrast for free, and the viewfinder is left as one
          clean window showing only what the camera sees.
          It also reads as a sentence going down the screen: what I'll read
          (the capability cards) · what I can see (the window) · how I'm seeing
          it (this row) · take it (the shutter). */}
      <View style={styles.cameraControls}>
        <TouchableOpacity
          style={[styles.settingChip, torch && styles.settingChipOn]}
          onPress={() => setTorch((t) => !t)}
          activeOpacity={0.7}
          accessibilityLabel={torch ? 'Turn the torch off' : 'Turn the torch on'}
          accessibilityState={{ selected: torch }}
        >
          <Ionicons
            name={torch ? 'flash' : 'flash-outline'}
            size={16}
            color={torch ? colors.primaryDark : colors.textSecondary}
          />
          <Text style={[styles.settingChipText, torch && styles.settingChipTextOn]}>Torch</Text>
        </TouchableOpacity>

        {/* Only when the phone actually has both — a lone "1×" segment would be
            a control that does nothing. */}
        {lenses.length > 1 && (
          <View style={styles.lensTrack}>
            {lenses.map((option) => {
              const active = option.label === label;
              return (
                <TouchableOpacity
                  key={option.label}
                  style={[styles.lensPill, active && styles.lensPillOn]}
                  onPress={() => setLabel(option.label)}
                  activeOpacity={0.7}
                  accessibilityLabel={`Switch to ${option.label} times zoom`}
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[styles.lensText, active && styles.lensTextOn]}>
                    {option.label}×
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </View>

      {/* Three columns rather than space-between, so the shutter is centred on
          the screen and not on the gap between whatever sits either side of it.
          The side controls are free to be different widths. */}
      <View style={[styles.controls, { paddingBottom: space.md + insets.bottom }]}>
        {/* Empty, and deliberately still here. The shutter is centred by the
            three columns rather than by the gap between its neighbours, so
            dropping this side entirely would slide the shutter off centre. */}
        <View style={styles.controlSide} />

        <TouchableOpacity
          onPress={capture}
          disabled={capturing}
          activeOpacity={0.85}
          accessibilityLabel="Take the photo"
        >
          <View style={[styles.shutter, capturing && styles.shutterBusy]}>
            <LinearGradient
              colors={[colors.primaryBright, colors.primaryMid]}
              start={{ x: 0.2, y: 0 }}
              end={{ x: 0.8, y: 1 }}
              style={styles.shutterFill}
            />
          </View>
        </TouchableOpacity>

        <View style={[styles.controlSide, styles.controlSideRight]}>
          <TouchableOpacity
            style={styles.controlButton}
            onPress={onAddByHand}
            activeOpacity={0.7}
            accessibilityLabel="Type an item in instead"
          >
            <Ionicons name="create-outline" size={16} color={colors.textSecondary} />
            <Text style={styles.controlButtonText}>Type it in</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  wash: {
    ...StyleSheet.absoluteFillObject,
    bottom: undefined,
    height: 320,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm2,
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
    lineHeight: 20,
    color: colors.textSecondary,
  },
  headerButton: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  capabilities: {
    flexDirection: 'row',
    gap: space.sm,
    paddingHorizontal: space.xxl,
    paddingTop: space.lg,
  },
  capabilityCard: {
    flex: 1,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
    borderRadius: 14,
    paddingVertical: space.md,
    paddingHorizontal: space.md,
  },
  capabilityLabel: {
    fontWeight: '800',
    fontSize: type.micro.fontSize,
    lineHeight: 13,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.primaryDark,
    marginBottom: space.xs2,
  },
  capabilityBody: {
    fontWeight: '600',
    fontSize: type.caption.fontSize,
    lineHeight: 16,
    color: colors.textSecondary,
  },
  viewfinder: {
    flex: 1,
    minHeight: 0,
    marginHorizontal: space.xxl,
    marginTop: space.lg,
    borderRadius: 28,
    overflow: 'hidden',
  },
  frameGuide: {
    position: 'absolute',
    top: 22,
    left: 22,
    right: 22,
    bottom: 22,
  },
  corner: {
    position: 'absolute',
    width: 30,
    height: 30,
    borderColor: 'rgba(251,246,235,0.9)',
  },
  cornerTopLeft: {
    top: 0,
    left: 0,
    borderTopWidth: 3,
    borderLeftWidth: 3,
    borderTopLeftRadius: 10,
  },
  cornerTopRight: {
    top: 0,
    right: 0,
    borderTopWidth: 3,
    borderRightWidth: 3,
    borderTopRightRadius: 10,
  },
  cornerBottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
    borderBottomLeftRadius: 10,
  },
  cornerBottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 3,
    borderRightWidth: 3,
    borderBottomRightRadius: 10,
  },
  cameraControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm2,
    paddingHorizontal: space.xxl,
    paddingTop: space.md,
    // Nothing when the phone offers one lens: the torch chip sits alone on the
    // left and the row just gets shorter.
    minHeight: 44,
  },
  settingChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    height: 44,
    paddingHorizontal: space.md2,
    borderRadius: 999,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
  },
  settingChipOn: {
    backgroundColor: colors.primaryLighter,
    borderColor: colors.primaryLighter,
  },
  settingChipText: {
    fontWeight: '700',
    fontSize: type.label.fontSize,
    color: colors.textSecondary,
  },
  settingChipTextOn: {
    fontWeight: '800',
    color: colors.primaryDark,
  },
  lensTrack: {
    flexDirection: 'row',
    gap: space.xs,
    padding: space.xs,
    borderRadius: 999,
    backgroundColor: colors.backgroundAlt,
  },
  lensPill: {
    minWidth: 44,
    height: 36,
    paddingHorizontal: space.sm2,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lensPillOn: {
    backgroundColor: colors.card,
  },
  lensText: {
    fontWeight: '700',
    fontSize: type.label.fontSize,
    color: colors.textSecondary,
  },
  lensTextOn: {
    fontWeight: '800',
    color: colors.primaryDarker,
  },
  hintWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 20,
    alignItems: 'center',
  },
  hint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderRadius: 999,
    backgroundColor: 'rgba(251,246,235,0.92)',
  },
  hintAvatar: {
    width: 20,
    height: 20,
    borderRadius: 999,
  },
  hintText: {
    fontWeight: '700',
    fontSize: type.caption.fontSize,
    lineHeight: 14,
    color: colors.primaryDarker,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.xxl,
    paddingTop: space.xl,
  },
  controlSide: {
    flex: 1,
    justifyContent: 'center',
  },
  controlSideRight: {
    alignItems: 'flex-end',
  },
  controlButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    // Sized by its label instead of squeezed into a 50pt square, which broke
    // "Type it in" across two cramped lines. Height still clears the 44pt
    // minimum, and the three-column row keeps the shutter centred regardless of
    // how wide this ends up.
    height: 50,
    paddingHorizontal: space.lg,
    borderRadius: 16,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
  },
  controlButtonText: {
    fontWeight: '800',
    fontSize: type.label.fontSize,
    lineHeight: 16,
    color: colors.textSecondary,
  },
  shutter: {
    width: 80,
    height: 80,
    borderRadius: 999,
    borderWidth: 5,
    borderColor: colors.surface,
    overflow: 'hidden',
  },
  shutterBusy: {
    opacity: 0.6,
  },
  shutterFill: {
    flex: 1,
    borderRadius: 999,
  },
}));