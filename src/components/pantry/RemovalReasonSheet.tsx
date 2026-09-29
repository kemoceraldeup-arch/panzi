// src/components/pantry/RemovalReasonSheet.tsx
//
// What Delete opens on the List screen: why is this leaving the shelves?
//
// One tap, no confirm step after it — picking a reason is already the
// deliberate second action a confirm dialog would have been, so asking "are
// you sure?" on top of it would be a third tap for nothing.
//
// The last row is the way out for a row that should never have been there. A
// misread scan deleted as "Other" would be logged as food that left the
// kitchen, which it never was; this deletes it without writing any history.

import React from 'react';
import { Modal, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Text from '../Text';
import {
  REMOVAL_HINTS,
  REMOVAL_LABELS,
  REMOVAL_REASONS,
  RemovalReason,
  isWaste,
} from '../../services/removals';
import { fonts, type } from '../../theme/typography';
import { makeStyles } from '../../theme/makeStyles';
import { useColors } from '../../theme/ThemeProvider';
import { space } from '../../theme/spacing';

const HIT_SLOP = { top: 12, bottom: 12, left: 12, right: 12 };

export const REASON_ICONS: Record<RemovalReason, keyof typeof Ionicons.glyphMap> = {
  consumed: 'restaurant-outline',
  spoiled: 'warning-outline',
  expired: 'calendar-outline',
  leftover: 'fast-food-outline',
  'over-purchased': 'cart-outline',
  other: 'ellipsis-horizontal',
};

type Props = {
  /** How many items this is for, or 0 when closed. */
  count: number;
  onPick: (reason: RemovalReason) => void;
  /** Deletes without recording anything — added by mistake. */
  onDiscard: () => void;
  onClose: () => void;
};

export default function RemovalReasonSheet({ count, onPick, onDiscard, onClose }: Props) {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={count > 0} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <TouchableOpacity style={styles.backdropTap} activeOpacity={1} onPress={onClose} />

        <View style={[styles.sheet, { paddingBottom: insets.bottom + space.lg }]}>
          <View style={styles.grabber} />

          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Why is it going?</Text>
              <Text style={styles.subtitle}>
                {count === 1 ? 'Removing 1 item' : `Removing ${count} items`} · saved to your history
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={HIT_SLOP} accessibilityLabel="Cancel">
              <Ionicons name="close" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <View style={styles.card}>
            {REMOVAL_REASONS.map((reason, i) => {
              const waste = isWaste(reason);
              return (
                <TouchableOpacity
                  key={reason}
                  style={[styles.row, i > 0 && styles.rowDivided]}
                  onPress={() => onPick(reason)}
                  activeOpacity={0.7}
                >
                  <View style={[styles.icon, waste ? styles.iconWaste : styles.iconEaten]}>
                    <Ionicons
                      name={REASON_ICONS[reason]}
                      size={17}
                      color={waste ? colors.accentDeep : colors.primaryDark}
                    />
                  </View>
                  <View style={styles.rowText}>
                    <Text style={styles.rowLabel}>{REMOVAL_LABELS[reason]}</Text>
                    <Text style={styles.rowHint}>{REMOVAL_HINTS[reason]}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

          <TouchableOpacity style={styles.discard} onPress={onDiscard} hitSlop={HIT_SLOP}>
            <Text style={styles.discardText}>Added by mistake — delete without recording</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(23,23,15,0.35)',
  },
  backdropTap: {
    flex: 1,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: space.xl,
    paddingTop: space.sm2,
  },
  grabber: {
    alignSelf: 'center',
    width: 42,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.backgroundAlt,
    marginBottom: space.md2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    marginBottom: space.md2,
  },
  title: {
    fontFamily: fonts.display,
    fontWeight: '700',
    fontSize: type.title.fontSize,
    color: colors.primaryDarker,
  },
  subtitle: {
    fontWeight: '600',
    fontSize: type.label.fontSize,
    color: colors.textSecondary,
    marginTop: space.xs,
  },
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
    borderRadius: 20,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 56,
    paddingVertical: space.sm2,
    paddingHorizontal: space.lg,
  },
  rowDivided: {
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  icon: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconEaten: {
    backgroundColor: colors.primaryLighter,
  },
  iconWaste: {
    backgroundColor: colors.accentSoft,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowLabel: {
    fontWeight: '700',
    fontSize: type.body.fontSize,
    color: colors.primaryDarker,
  },
  rowHint: {
    fontWeight: '600',
    fontSize: type.caption.fontSize,
    color: colors.textSecondary,
    marginTop: space.half,
  },
  discard: {
    alignSelf: 'center',
    paddingVertical: space.md2,
    marginTop: space.xs,
  },
  discardText: {
    fontWeight: '700',
    fontSize: type.label.fontSize,
    color: colors.textSecondary,
  },
}));
