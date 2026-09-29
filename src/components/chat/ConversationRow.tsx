// src/components/chat/ConversationRow.tsx
//
// One history row in the drawer's conversation list. Hold it for the menu —
// Pin, Rename, Archive, Delete (ConversationMenu.tsx) — not swipe: the drawer
// itself already owns a horizontal swipe gesture (open from the edge, close by
// dragging it back), and a second, per-row swipe gesture nested inside that
// fought it for the same horizontal drag rather than reading as two separate
// controls.

import React, { useRef } from 'react';
import { TouchableOpacity, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import Text from '../Text';
import { makeStyles } from '../../theme/makeStyles';
import { useColors } from '../../theme/ThemeProvider';
import { space } from '../../theme/spacing';
import { type } from '../../theme/typography';
import { Conversation } from '../../services/chat';
import { RowAnchor } from './ConversationMenu';
import MenuIcon from './MenuIcons';

/** "3:14 PM" today, "Tuesday" this week, "Jan 4" further back — a history row
 *  needs a sense of *when*, not a precise timestamp nobody reads that closely. */
export function relativeLabel(ms: number): string {
  const date = new Date(ms);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  const daysAgo = Math.floor((now.getTime() - ms) / (24 * 60 * 60 * 1000));
  if (daysAgo < 7) return date.toLocaleDateString([], { weekday: 'long' });
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function ConversationRow({
  conversation,
  active,
  held,
  onPress,
  onLongPress,
}: {
  conversation: Conversation;
  /** The conversation currently open behind the drawer — highlighted so it's
   *  clear which row you're already in, the same as Claude's own sidebar. */
  active?: boolean;
  /** Its menu is open — stays highlighted so it's clear which chat the menu
   *  is about. */
  held?: boolean;
  onPress: () => void;
  /** Handed the row's on-screen position, so the menu can hang off it. */
  onLongPress: (anchor: RowAnchor) => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const rowRef = useRef<View>(null);

  function openMenu() {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    rowRef.current?.measureInWindow((x, y, width, height) => {
      onLongPress({ x, y, width, height });
    });
  }

  return (
    <View ref={rowRef} collapsable={false}>
      <TouchableOpacity
        style={[styles.row, active && styles.rowActive, held && styles.rowHeld]}
        activeOpacity={0.7}
        onPress={onPress}
        onLongPress={openMenu}
        delayLongPress={350}
      >
        {/* No icon per row: the same bubble repeated down the list said
            nothing any row didn't, and made the titles start further in. */}
        <Text style={[styles.rowTitle, active && styles.rowTitleActive]} numberOfLines={1}>
          {conversation.title}
        </Text>
        {conversation.pinned ? (
          <MenuIcon name="pin" size={15} color={colors.primaryDark} />
        ) : (
          <Text style={styles.rowTime}>{relativeLabel(conversation.updatedAt)}</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 44,
    paddingVertical: space.sm2,
    paddingHorizontal: space.md,
    borderRadius: 14,
  },
  // The open chat. A fill rather than a marker, so it reads from across the
  // drawer the same way the selected tab does in the tab bar.
  rowActive: {
    backgroundColor: colors.primaryLighter,
  },
  rowHeld: {
    backgroundColor: colors.backgroundAlt,
  },
  rowTitle: {
    flex: 1,
    fontWeight: '700',
    fontSize: type.body.fontSize,
    color: colors.textPrimary,
  },
  rowTitleActive: {
    fontWeight: '800',
    color: colors.primaryDarker,
  },
  rowTime: {
    fontWeight: '600',
    fontSize: type.caption.fontSize,
    color: colors.textMuted,
  },
}));
