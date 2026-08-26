// src/screens/AllSetScreen.tsx

import React from 'react';
import { View, StyleSheet, TouchableOpacity, useWindowDimensions } from 'react-native';
import Text from '../components/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import MascotVideo from '../components/MascotVideo';
import { makeStyles } from '../theme/makeStyles';
import { useColors } from '../theme/ThemeProvider';
import { space } from '../theme/spacing';
import { type } from '../theme/typography';

type Props = {
  onScanFirstShelf: () => void;
  onGoToDashboard: () => void;
};

const pills = ['SCAN', 'TRACK', 'COOK'];

export default function AllSetScreen({ onScanFirstShelf, onGoToDashboard }: Props) {
  const styles = useStyles();
  const colors = useColors();
  const { width } = useWindowDimensions();
  // The source video is a 9:16 portrait frame with the character occupying
  // only the middle band width-wise — sizing a square box by width (like
  // before) left ~45% of the box as dead vertical padding above/below the
  // mascot, so the character never looked as big as the box suggested.
  // This is a max size, not a fixed one: heroWrap is the only flexible
  // element in the column (body/footer size to their own content), so on
  // shorter screens or with longer wrapped text the video shrinks to fit
  // rather than pushing the footer buttons off-screen.
  const mascotMaxWidth = Math.min(width * 0.92, 400);
  const mascotMaxHeight = mascotMaxWidth * (1280 / 720);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.heroWrap}>
        <MascotVideo
          clip="jumpV2"
          style={{
            width: '100%',
            height: '100%',
            maxWidth: mascotMaxWidth,
            maxHeight: mascotMaxHeight,
            aspectRatio: 720 / 1280,
          }}
          contentFit="contain"
        />
      </View>

      <View style={styles.body}>
        <Text style={styles.title}>You're all set.</Text>
        <Text style={styles.description}>
          Your pantry is empty for about thirty more seconds. Scan your first shelf and I'll take it from there.
        </Text>

        <View style={[styles.pillRow, styles.pillRowCentered]}>
          {pills.map((label) => (
            <View key={label} style={styles.pill}>
              <Text style={styles.pillText}>{label}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.footer}>
        <TouchableOpacity style={styles.primaryButton} onPress={onScanFirstShelf}>
          <Text style={styles.primaryButtonText}>Scan my first shelf</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.textButton} onPress={onGoToDashboard}>
          <Text style={styles.textButtonText}>Take me to the dashboard</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((colors) => ({
  container: {
    flex: 1,
    backgroundColor: colors.backgroundLight,
  },
  heroWrap: {
    flex: 1,
    minHeight: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flexShrink: 0,
    paddingHorizontal: space.xxxl,
    alignItems: 'center',
  },
  title: {
    fontWeight: '800',
    fontSize: type.headline.fontSize,
    color: colors.primaryDarker,
    marginBottom: space.sm2,
    textAlign: 'center',
  },
  description: {
    fontSize: type.body.fontSize,
    lineHeight: 23,
    color: colors.textSecondary,
    marginBottom: space.xl,
    textAlign: 'center',
  },
  pillRow: {
    flexDirection: 'row',
    gap: space.sm2,
  },
  pillRowCentered: {
    justifyContent: 'center',
  },
  pill: {
    paddingVertical: space.sm,
    paddingHorizontal: space.md2,
    borderRadius: 999,
    backgroundColor: colors.primaryLighter,
  },
  pillText: {
    fontWeight: '800',
    fontSize: type.caption.fontSize,
    letterSpacing: 1,
    color: colors.primaryDark,
  },
  footer: {
    flexShrink: 0,
    paddingHorizontal: space.xxl,
    paddingTop: space.xxl2,
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
  textButton: {
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textButtonText: {
    color: colors.primaryDark,
    fontWeight: '700',
    fontSize: type.body.fontSize,
  },
}));