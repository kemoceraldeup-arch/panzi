// src/screens/scan/ScanErrorScreen.tsx
//
// Screens 06 and 07 of the item scanner — the two ways a read comes back with
// nothing.
//
// They are genuinely different failures and get genuinely different screens.
// "Nothing found" means the photo was legible and held no food it could make
// out, so the advice is about what to point the camera at. "Too blurry" means
// the photo itself was the problem, so it shows the user their own shot, out of
// focus, and the advice is about how to take a better one.
//
// Both stay in Panzi's voice — "No food I could make out", not "Error: unable
// to detect items". The scan already failed; sounding like a stack trace about
// it doesn't help anyone hold the phone steadier.

import React from 'react';
import { Image, StyleSheet, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Text from '../../components/Text';
import { fonts, type } from '../../theme/typography';
import { HIT_SLOP } from './atoms';
import { makeStyles } from '../../theme/makeStyles';
import { useColors } from '../../theme/ThemeProvider';
import { space } from '../../theme/spacing';

export type ScanErrorCause = 'dark' | 'blurry' | 'far' | 'unrecognised';

/** How hard the captured photo is blurred when shown back as evidence. Enough
 *  to be obviously the problem, not so much that the user can't tell it is
 *  their own kitchen. */
const EVIDENCE_BLUR = 6;

// Which of the two screens each cause lands on. 'dark' joins 'blurry' because
// both are faults in the photo with the same fix — more light, held steadier —
// and the banner below names the specific one.
const IS_PHOTO_FAULT: Record<ScanErrorCause, boolean> = {
  blurry: true,
  dark: true,
  far: false,
  unrecognised: false,
};

const BANNER: Record<'blurry' | 'dark', string> = {
  blurry:
    'Dates need a sharp shot, and ripeness needs true colour. Brace your elbow and try once more.',
  dark: 'Dates need a sharp shot, and ripeness needs true colour. The torch will fix both.',
};

const FIXES: Record<'far' | 'unrecognised', string[]> = {
  unrecognised: [
    'Turn labels toward the camera',
    'Take fruit out of the bag first',
    'Six items a shot, not twenty',
  ],
  far: [
    'Get a step closer to the shelf',
    'Turn labels toward the camera',
    'Six items a shot, not twenty',
  ],
};

type Props = {
  cause: ScanErrorCause;
  photoUri?: string | null;
  onClose: () => void;
  /** Back to the camera. `withTorch` opens it with the torch already on. */
  onRetry: (withTorch: boolean) => void;
  onTypeInstead: () => void;
};

export default function ScanErrorScreen({
  cause,
  photoUri,
  onClose,
  onRetry,
  onTypeInstead,
}: Props) {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const photoFault = IS_PHOTO_FAULT[cause];

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <LinearGradient
        colors={[colors.washPeach, colors.washPeachFade]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0.9, y: 0.6 }}
        style={styles.wash}
        pointerEvents="none"
      />

      {photoFault ? (
        <PhotoFault cause={cause as 'blurry' | 'dark'} photoUri={photoUri} />
      ) : (
        <NothingFound cause={cause as 'far' | 'unrecognised'} photoUri={photoUri} onClose={onClose} />
      )}

      <View style={[styles.actions, { paddingBottom: space.lg + insets.bottom }]}>
        <TouchableOpacity
          style={styles.primary}
          onPress={() => onRetry(photoFault)}
          activeOpacity={0.85}
        >
          <LinearGradient
            colors={[colors.primaryBright, colors.primaryMid]}
            start={{ x: 0.2, y: 0 }}
            end={{ x: 0.8, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <Text style={styles.primaryText}>
            {photoFault ? 'Retake with torch on' : 'Take another photo'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondary} onPress={onTypeInstead} activeOpacity={0.7}>
          <Text style={styles.secondaryText}>Type it in instead</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

/** Screen 07 — the photo was the problem, and here it is. */
function PhotoFault({
  cause,
  photoUri,
}: {
  cause: 'blurry' | 'dark';
  photoUri?: string | null;
}) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <>
      <View style={styles.header}>
        <Text style={styles.title}>
          {cause === 'dark' ? 'Too dark to read' : 'Too blurry to read'}
        </Text>
      </View>

      <View style={styles.banner}>
        <View style={styles.bannerIcon}>
          <Text style={styles.bannerIconText}>!</Text>
        </View>
        <Text style={styles.bannerText}>{BANNER[cause]}</Text>
      </View>

      {/* The evidence. Telling someone their photo was blurry is an assertion;
          showing it to them is a reason. */}
      <View style={styles.evidence}>
        <LinearGradient colors={colors.captureDark} style={StyleSheet.absoluteFill} />
        {photoUri && (
          <Image
            source={{ uri: photoUri }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
            blurRadius={EVIDENCE_BLUR}
          />
        )}
      </View>
    </>
  );
}

/** Screen 06 — the photo was fine, there was just no food in it. */
function NothingFound({
  cause,
  photoUri,
  onClose,
}: {
  cause: 'far' | 'unrecognised';
  photoUri?: string | null;
  onClose: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <>
      <View style={styles.header}>
        <Text style={styles.title}>Nothing found</Text>
        <TouchableOpacity onPress={onClose} hitSlop={HIT_SLOP} activeOpacity={0.7}>
          <Text style={styles.close}>Close</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.shot}>
        {photoUri ? (
          <Image source={{ uri: photoUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        ) : (
          <Image
            source={require('../../../assets/mascot/panzi-bust.png')}
            style={styles.mascot}
            resizeMode="contain"
          />
        )}
        <View style={styles.shotCaptionWrap}>
          <Text style={styles.shotCaption}>your photo</Text>
        </View>
      </View>

      <View style={styles.advice}>
        <Text style={styles.adviceTitle}>
          {cause === 'far' ? 'Everything was too far off' : 'No food I could make out'}
        </Text>
        <Text style={styles.adviceLead}>Three things usually fix it:</Text>
        <View style={styles.fixes}>
          {FIXES[cause].map((fix, i) => (
            <View key={fix} style={styles.fix}>
              <View style={styles.fixNumber}>
                <Text style={styles.fixNumberText}>{i + 1}</Text>
              </View>
              <Text style={styles.fixText}>{fix}</Text>
            </View>
          ))}
        </View>
      </View>
    </>
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
    height: 300,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.xxl,
    paddingTop: space.half,
  },
  title: {
    fontFamily: fonts.display,
    fontWeight: '800',
    fontSize: type.headline.fontSize,
    lineHeight: 31,
    color: colors.primaryDarker,
  },
  close: {
    fontWeight: '700',
    fontSize: type.body.fontSize,
    color: colors.textSecondary,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginHorizontal: space.xxl,
    marginTop: space.lg,
    backgroundColor: colors.accentSoft,
    borderRadius: 18,
    paddingVertical: space.md2,
    paddingHorizontal: space.lg,
  },
  bannerIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    backgroundColor: colors.peachDeep,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  bannerIconText: {
    fontFamily: fonts.display,
    fontWeight: '800',
    fontSize: type.subtitle.fontSize,
    color: colors.rust,
  },
  bannerText: {
    flex: 1,
    fontWeight: '600',
    fontSize: type.label.fontSize,
    lineHeight: 18,
    color: colors.rustMuted,
  },
  evidence: {
    flex: 1,
    minHeight: 0,
    marginHorizontal: space.xxl,
    marginTop: space.lg2,
    borderRadius: 26,
    overflow: 'hidden',
  },
  shot: {
    height: 210,
    marginHorizontal: space.xxl,
    marginTop: space.xl,
    borderRadius: 26,
    overflow: 'hidden',
    backgroundColor: colors.backgroundAlt,
    borderWidth: 1,
    borderColor: colors.tan,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mascot: {
    width: 104,
    height: 104,
  },
  shotCaptionWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 12,
    alignItems: 'center',
  },
  shotCaption: {
    fontWeight: '700',
    fontSize: type.micro.fontSize,
    color: colors.placeholderInk,
  },
  advice: {
    flex: 1,
    minHeight: 0,
    paddingHorizontal: space.xxl,
    paddingTop: space.xl2,
  },
  adviceTitle: {
    fontFamily: fonts.display,
    fontWeight: '700',
    fontSize: type.title.fontSize,
    lineHeight: 25,
    color: colors.primaryDarker,
    marginBottom: space.sm,
  },
  adviceLead: {
    fontWeight: '600',
    fontSize: type.bodySmall.fontSize,
    lineHeight: 21,
    color: colors.textSecondary,
    marginBottom: space.lg2,
  },
  fixes: {
    gap: space.sm2,
  },
  fix: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
    borderRadius: 16,
    paddingVertical: space.md2,
    paddingHorizontal: space.lg,
  },
  fixNumber: {
    width: 26,
    height: 26,
    borderRadius: 9,
    backgroundColor: colors.primaryLighter,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  fixNumberText: {
    fontWeight: '800',
    fontSize: type.caption.fontSize,
    color: colors.primaryDark,
  },
  fixText: {
    flex: 1,
    fontWeight: '600',
    fontSize: type.label.fontSize,
    lineHeight: 18,
    color: colors.primaryDarker,
  },
  actions: {
    paddingHorizontal: space.xxl,
    paddingTop: space.xl,
    gap: space.sm2,
  },
  primary: {
    height: 54,
    borderRadius: 17,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: {
    fontWeight: '800',
    fontSize: type.bodyLarge.fontSize,
    color: colors.onAccent,
  },
  secondary: {
    height: 54,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: {
    fontWeight: '700',
    fontSize: type.bodyLarge.fontSize,
    color: colors.primaryDarker,
  },
}));