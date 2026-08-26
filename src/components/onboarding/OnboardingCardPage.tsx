// src/components/onboarding/OnboardingCardPage.tsx
//
// Verified against real device screenshots: the card+title+description block
// sits at a fixed offset from the top (right under Skip) on every page — it
// is NOT vertically centered as a group. Centering left a large dead gap
// between the description and the dots on pages with less content (Scan,
// Recipes). The empty space below belongs at the bottom, not distributed
// around the content.
//
// The preview cards (Scan/Freshness/Recipes/Chat) are different heights by
// nature of their content, which made pages feel inconsistent even with a
// fixed top offset — Recipes (shortest) left much more trailing space than
// Chat (tallest). CARD_MIN_HEIGHT reserves the same vertical footprint for
// every card so the title/description always start at the same place.

import React from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import Text from '../Text';
import { makeStyles } from '../../theme/makeStyles';
import { useColors } from '../../theme/ThemeProvider';
import { space } from '../../theme/spacing';
import { type } from '../../theme/typography';

type Props = {
  eyebrow?: string;
  title: string;
  description: string;
  children: React.ReactNode; // the preview card content
};

const TEXT_GAP = 32; // fixed space between the card and the title block, on every page
const CARD_MIN_HEIGHT = 320; // reserves the same footprint as the tallest card (Chat)

export default function OnboardingCardPage({ eyebrow, title, description, children }: Props) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <ScrollView
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={[styles.cardSlot, { marginBottom: TEXT_GAP }]}>{children}</View>

      <View>
        {!!eyebrow && <Text style={styles.eyebrow}>{eyebrow}</Text>}
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.description}>{description}</Text>
      </View>
    </ScrollView>
  );
}

const useStyles = makeStyles((colors) => ({
  content: {
    flexGrow: 1,
    paddingHorizontal: space.xxl,
    paddingTop: space.xxl,
    paddingBottom: space.xxl,
  },
  cardSlot: {
    minHeight: CARD_MIN_HEIGHT,
    justifyContent: 'center',
  },
  eyebrow: {
    fontWeight: '800',
    fontSize: type.caption.fontSize,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.primary,
    marginBottom: space.md,
  },
  title: {
    fontWeight: '800',
    fontSize: type.headline.fontSize,
    lineHeight: 32,
    color: colors.primaryDarker,
    marginBottom: space.sm2,
  },
  description: {
    fontSize: type.body.fontSize,
    lineHeight: 23,
    color: colors.textSecondary,
  },
}));