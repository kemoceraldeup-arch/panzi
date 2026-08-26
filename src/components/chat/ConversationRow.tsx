// src/components/chat/ConversationRow.tsx
//
// One history row in the drawer's conversation list. Long-press to delete,
// not swipe — the drawer itself already owns a horizontal swipe gesture (open
// from the edge, close by dragging it back), and a second, per-row swipe
// gesture nested inside that fought it for the same horizontal drag rather
// than reading as two separate controls.

import React from 'react';
import { TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Text from '../Text';
import { makeStyles } from '../../theme/makeStyles';
import { useColors } from '../../theme/ThemeProvider';
import { space } from '../../theme/spacing';
import { type } from '../../theme/typography';
import { Conversation } from '../../services/chat';

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
  onPress,
  onDelete,
}: {
  conversation: Conversation;
  /** The conversation currently open behind the drawer — highlighted so it's
   *  clear which row you're already in, the same as Claude's own sidebar. */
  active?: boolean;
  onPress: () => void;
  onDelete: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();

  return (
    <TouchableOpacity
      style={[styles.row, active && styles.rowActive]}
      activeOpacity={0.7}
      onPress={onPress}
      onLongPress={onDelete}
    >
      <View style={styles.rowIcon}>
        <Ionicons name="chatbubble-outline" size={16} color={colors.primaryDark} />
      </View>
      <Text style={styles.rowTitle} numberOfLines={1}>
        {conversation.title}
      </Text>
      <Text style={styles.rowTime}>{relativeLabel(conversation.updatedAt)}</Text>
    </TouchableOpacity>
  );
}

const useStyles = makeStyles((colors) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
    paddingHorizontal: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  rowActive: {
    backgroundColor: colors.primaryLighter,
  },
  rowIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryLighter,
  },
  rowTitle: {
    flex: 1,
    fontWeight: '700',
    fontSize: type.body.fontSize,
    color: colors.textPrimary,
  },
  rowTime: {
    fontWeight: '600',
    fontSize: type.caption.fontSize,
    color: colors.textMuted,
  },
}));
