// src/components/onboarding/OnboardingCards.tsx

import React from 'react';
import { View, StyleSheet, Switch } from 'react-native';
import Text from '../Text';
import Mascot from '../Mascot';
import { makeStyles } from '../../theme/makeStyles';
import { Palette } from '../../theme/palettes';
import { useColors } from '../../theme/ThemeProvider';
import { space } from '../../theme/spacing';
import { type } from '../../theme/typography';

// ---------- 02 · Scan ----------
export function ScanCard() {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={styles.scanCard}>
      <View style={styles.scanRowSolid}>
        <Text style={styles.scanItemName}>Canned tomato sauce</Text>
        <Text style={styles.scanItemCount}>×2</Text>
      </View>
      <View style={styles.scanRowSolid}>
        <Text style={styles.scanItemName}>Jasmine rice · 2 kg</Text>
        <Text style={styles.scanItemCount}>×1</Text>
      </View>
      <View style={styles.scanRowDashed}>
        <Text style={styles.scanItemName}>Eggs</Text>
        <Text style={styles.scanItemUnsure}>Count?</Text>
      </View>
      <View style={styles.scanFooterRow}>
        <View style={styles.scanDot} />
        <Text style={styles.scanFooterText}>12 items found · 1 needs a look</Text>
      </View>
    </View>
  );
}

// ---------- 03 · Freshness ----------
type FreshnessItem = {
  name: string;
  meta: string;
  badge: string;
  badgeBg: string;
  badgeColor: string;
};
// A function of the palette, not a constant: the badge colours have to follow
// the theme, and a module-level array froze them at import.
const freshnessItems = (colors: Palette): FreshnessItem[] => [
  { name: 'Fresh milk · 1 L', meta: 'Fridge · added 4 days ago', badge: '3 DAYS', badgeBg: colors.accentSoft, badgeColor: colors.accent },
  { name: 'Spinach · 200 g', meta: 'Crisper · shelf life estimated', badge: 'USE SOON', badgeBg: colors.accentMuted, badgeColor: colors.warning },
  { name: 'Jasmine rice · 2 kg', meta: 'Grains shelf · sealed', badge: 'FRESH', badgeBg: colors.primaryLighter, badgeColor: colors.primaryMid },
];

export function FreshnessCard() {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={{ gap: space.md }}>
      {freshnessItems(colors).map((item) => (
        <View key={item.name} style={styles.freshnessRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.freshnessName}>{item.name}</Text>
            <Text style={styles.freshnessMeta}>{item.meta}</Text>
          </View>
          <View style={[styles.badge, { backgroundColor: item.badgeBg }]}>
            <Text style={[styles.badgeText, { color: item.badgeColor }]}>{item.badge}</Text>
          </View>
        </View>
      ))}

      <View style={styles.tipBanner}>
        <Mascot size={44} pose="face" style={{ borderRadius: 999 }} />
        <Text style={styles.tipText}>Use the milk tonight and nothing goes in the bin.</Text>
      </View>
    </View>
  );
}

// ---------- 04 · Recipes ----------
const recipeChips = ['Rice', 'Tomato sauce', 'Spinach', 'Garlic'];

export function RecipeCard() {
  const styles = useStyles();
  const colors = useColors();
  const [deduct, setDeduct] = React.useState(true);
  return (
    <View style={{ gap: space.md2 }}>
      <View style={styles.recipeCard}>
        <View style={styles.recipeHeaderRow}>
          <Text style={styles.recipeEyebrow}>TONIGHT</Text>
          <View style={[styles.badge, { backgroundColor: colors.primaryLighter }]}>
            <Text style={[styles.badgeText, { color: colors.primaryMid }]}>8 of 9 on hand</Text>
          </View>
        </View>
        <Text style={styles.recipeTitle}>Tomato rice with spinach</Text>
        <Text style={styles.recipeSubtitle}>25 min · uses your milk and spinach</Text>
        <View style={styles.chipRow}>
          {recipeChips.map((chip) => (
            <View key={chip} style={styles.chip}>
              <Text style={styles.chipText}>{chip}</Text>
            </View>
          ))}
          <View style={styles.chipDashed}>
            <Text style={styles.chipDashedText}>Parmesan — not on your shelves</Text>
          </View>
        </View>
      </View>

      <View style={styles.toggleRow}>
        <Text style={styles.toggleLabel}>Deduct ingredients after cooking</Text>
        <Switch
          value={deduct}
          onValueChange={setDeduct}
          trackColor={{ true: colors.primary, false: colors.backgroundAlt }}
          thumbColor={colors.onAccent}
        />
      </View>
    </View>
  );
}

// ---------- 05 · Chat ----------
type ChatMessage = { from: 'user' | 'panzi'; text: string };
const chatMessages: ChatMessage[] = [
  { from: 'user', text: 'What can I cook with what I have?' },
  { from: 'panzi', text: "You've got rice, tomato sauce and spinach. That's dinner — 25 minutes." },
  { from: 'user', text: 'How long does opened sauce keep?' },
  { from: 'panzi', text: "Five days in the fridge, lid on. I'll remind you on day four." },
];

export function ChatCard() {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={{ gap: space.md }}>
      {chatMessages.map((m, i) =>
        m.from === 'user' ? (
          <View key={i} style={styles.userBubble}>
            <Text style={styles.userBubbleText}>{m.text}</Text>
          </View>
        ) : (
          <View key={i} style={styles.panziBubbleRow}>
            <Mascot size={36} pose="face" style={{ borderRadius: 999 }} />
            <View style={styles.panziBubble}>
              <Text style={styles.panziBubbleText}>{m.text}</Text>
            </View>
          </View>
        )
      )}

      <View style={styles.chatInputRow}>
        <View style={styles.chatInput}>
          <Text style={styles.chatInputPlaceholder}>Ask Panzi anything</Text>
        </View>
        <View style={styles.chatSendButton}>
          <Text style={styles.chatSendArrow}>›</Text>
        </View>
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  // Scan
  scanCard: {
    borderRadius: 26,
    backgroundColor: colors.tan,
    padding: space.lg2,
    gap: space.md,
  },
  scanRowSolid: {
    borderWidth: 2,
    borderColor: colors.primary,
    borderRadius: 14,
    backgroundColor: colors.overlaySoft,
    paddingVertical: space.md,
    paddingHorizontal: space.md2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  scanRowDashed: {
    borderWidth: 2,
    borderColor: colors.accent,
    borderStyle: 'dashed',
    borderRadius: 14,
    backgroundColor: colors.overlaySoft,
    paddingVertical: space.md,
    paddingHorizontal: space.md2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  scanItemName: {
    fontWeight: '700',
    fontSize: type.body.fontSize,
    color: colors.primaryDarker,
  },
  scanItemCount: {
    fontWeight: '800',
    fontSize: type.caption.fontSize,
    letterSpacing: 0.5,
    color: colors.primaryDark,
  },
  scanItemUnsure: {
    fontWeight: '800',
    fontSize: type.caption.fontSize,
    letterSpacing: 0.5,
    color: colors.accent,
  },
  scanFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginTop: space.xs,
  },
  scanDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
  scanFooterText: {
    fontWeight: '600',
    fontSize: type.label.fontSize,
    color: colors.primaryDark,
  },

  // Freshness
  freshnessRow: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
    borderRadius: 20,
    paddingVertical: space.lg,
    paddingHorizontal: space.lg2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  freshnessName: {
    fontWeight: '700',
    fontSize: type.subtitle.fontSize,
    color: colors.primaryDarker,
    marginBottom: space.xs,
  },
  freshnessMeta: {
    fontWeight: '600',
    fontSize: type.label.fontSize,
    color: colors.textSecondary,
  },
  badge: {
    paddingVertical: space.xs2,
    paddingHorizontal: space.md,
    borderRadius: 999,
  },
  badgeText: {
    fontWeight: '800',
    fontSize: type.caption.fontSize,
    letterSpacing: 0.5,
  },
  tipBanner: {
    backgroundColor: colors.primaryLighter,
    borderRadius: 20,
    padding: space.md2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  tipText: {
    flex: 1,
    fontWeight: '600',
    fontSize: type.body.fontSize,
    lineHeight: 20,
    color: colors.primaryDarker,
  },

  // Recipe
  recipeCard: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
    borderRadius: 26,
    padding: space.xl,
  },
  recipeHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.md2,
  },
  recipeEyebrow: {
    fontWeight: '800',
    fontSize: type.caption.fontSize,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.primary,
  },
  recipeTitle: {
    fontWeight: '700',
    fontSize: type.headline.fontSize,
    color: colors.primaryDarker,
    marginBottom: space.xs2,
  },
  recipeSubtitle: {
    fontWeight: '600',
    fontSize: type.label.fontSize,
    color: colors.textSecondary,
    marginBottom: space.lg,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  chip: {
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderRadius: 999,
    backgroundColor: colors.primaryLighter,
  },
  chipText: {
    fontWeight: '600',
    fontSize: type.label.fontSize,
    color: colors.primaryDark,
  },
  chipDashed: {
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.tan,
    borderStyle: 'dashed',
  },
  chipDashedText: {
    fontWeight: '600',
    fontSize: type.label.fontSize,
    color: colors.textSecondary,
  },
  toggleRow: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
    borderRadius: 20,
    paddingVertical: space.md2,
    paddingHorizontal: space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  toggleLabel: {
    flex: 1,
    fontWeight: '600',
    fontSize: type.label.fontSize,
    color: colors.textSecondary,
  },

  // Chat
  userBubble: {
    alignSelf: 'flex-end',
    maxWidth: '78%',
    // inkFill, not primaryDark. primaryDark is a heading INK colour — dark
    // green in light, pale green in dark — so as a bubble fill it flipped the
    // bubble from dark-with-light-text to light-with-dark-text between schemes.
    // An ink fill stays an ink fill.
    backgroundColor: colors.inkFill,
    borderRadius: 22,
    borderBottomRightRadius: 6,
    paddingVertical: space.md2,
    paddingHorizontal: space.lg2,
  },
  userBubbleText: {
    color: colors.onAccent,
    fontSize: type.body.fontSize,
    lineHeight: 21,
  },
  panziBubbleRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.sm2,
    maxWidth: '88%',
  },
  panziBubble: {
    flexShrink: 1,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
    borderRadius: 22,
    borderBottomLeftRadius: 6,
    paddingVertical: space.md2,
    paddingHorizontal: space.lg2,
  },
  panziBubbleText: {
    fontWeight: '600',
    fontSize: type.body.fontSize,
    lineHeight: 21,
    color: colors.primaryDarker,
  },
  chatInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm2,
    marginTop: space.xs,
  },
  chatInput: {
    flex: 1,
    height: 48,
    borderRadius: 16,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
    justifyContent: 'center',
    paddingHorizontal: space.lg2,
  },
  chatInputPlaceholder: {
    fontSize: type.body.fontSize,
    color: colors.textSecondary,
  },
  chatSendButton: {
    width: 48,
    height: 48,
    borderRadius: 999,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatSendArrow: {
    fontWeight: '700',
    fontSize: type.title.fontSize,
    color: colors.onAccent,
  },
}));