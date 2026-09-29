// src/screens/ArchivedChatsScreen.tsx
//
// Where archived chats live — opened from the "Archived chats" row at the
// foot of the history drawer, the same place the ChatGPT app keeps its own.
// Archiving takes a chat out of the everyday list without losing it: it is
// still saved on the account, it still opens and reads the same, and it can
// be brought back with one tap on the row's restore button or from the same
// long-press menu the drawer uses.

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaProvider, initialWindowMetrics, useSafeAreaInsets } from 'react-native-safe-area-context';
import Text from '../components/Text';
import ConversationRow from '../components/chat/ConversationRow';
import ConversationMenu, { ConversationAction, RowAnchor } from '../components/chat/ConversationMenu';
import MenuIcon from '../components/chat/MenuIcons';
import RenameDialog from '../components/chat/RenameDialog';
import { forgetPreview } from '../components/chat/ConversationPreview';
import { fonts, type } from '../theme/typography';
import { makeStyles } from '../theme/makeStyles';
import { useColors } from '../theme/ThemeProvider';
import { space } from '../theme/spacing';
import {
  ChatError,
  Conversation,
  deleteConversation,
  fetchConversations,
  updateConversation,
} from '../services/chat';

const HIT_SLOP = { top: 12, bottom: 12, left: 12, right: 12 };

type Props = {
  visible: boolean;
  onOpenConversation: (conversation: Conversation) => void;
  /** A chat left the archive (restored or deleted) — the drawer reloads so a
   *  restored one shows up back in its list. */
  onChanged: () => void;
  /** The open chat was deleted from here. */
  onConversationRemoved: (id: string) => void;
  onClose: () => void;
};

export default function ArchivedChatsScreen(props: Props) {
  // Its own provider: a Modal's content is laid out in a fresh native root,
  // and the insets need to describe that root, not the drawer's.
  return (
    <Modal
      visible={props.visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={props.onClose}
    >
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <ArchivedChats {...props} />
      </SafeAreaProvider>
    </Modal>
  );
}

function ArchivedChats({ visible, onOpenConversation, onChanged, onConversationRemoved, onClose }: Props) {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ conversation: Conversation; anchor: RowAnchor } | null>(null);
  const [renaming, setRenaming] = useState<Conversation | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchConversations({ archived: true })
      .then(setConversations)
      .catch((err) =>
        setError(err instanceof ChatError ? err.message : 'Could not load your archived chats.')
      )
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (visible) load();
  }, [visible, load]);

  async function restore(conversation: Conversation) {
    const previous = conversations;
    setConversations((prev) => prev.filter((c) => c.id !== conversation.id));
    try {
      await updateConversation(conversation.id, { archived: false });
      onChanged();
    } catch (err) {
      setConversations(previous);
      Alert.alert('That didn’t restore', err instanceof ChatError ? err.message : 'Try again.');
    }
  }

  async function rename(conversation: Conversation, title: string) {
    const previous = conversations;
    setConversations((prev) => prev.map((c) => (c.id === conversation.id ? { ...c, title } : c)));
    try {
      await updateConversation(conversation.id, { title });
    } catch (err) {
      setConversations(previous);
      Alert.alert('That didn’t save', err instanceof ChatError ? err.message : 'Try again.');
    }
  }

  function confirmDelete(conversation: Conversation) {
    Alert.alert('Delete this chat?', `"${conversation.title}" will be gone for good.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const previous = conversations;
          setConversations((prev) => prev.filter((c) => c.id !== conversation.id));
          forgetPreview(conversation.id);
          onConversationRemoved(conversation.id);
          try {
            await deleteConversation(conversation.id);
          } catch {
            setConversations(previous);
            Alert.alert('That didn’t delete', 'Check your connection and try again.');
          }
        },
      },
    ]);
  }

  function handleAction(action: ConversationAction, conversation: Conversation) {
    if (action === 'archive') restore(conversation);
    else if (action === 'rename') setRenaming(conversation);
    else if (action === 'delete') confirmDelete(conversation);
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onClose} hitSlop={HIT_SLOP} style={styles.headerButton}>
          <Ionicons name="chevron-back" size={24} color={colors.textSecondary} />
        </TouchableOpacity>
        <Text style={styles.title}>Archived chats</Text>
        <View style={styles.headerButton} />
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : error ? (
        <View style={styles.centered}>
          <Text style={styles.emptyText}>{error}</Text>
          <TouchableOpacity onPress={load} style={styles.retryButton}>
            <Text style={styles.retryText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={conversations}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + space.lg }]}
          ListHeaderComponent={
            conversations.length > 0 ? (
              <Text style={styles.hint}>
                Hold a chat for more options. Archived chats stay saved to your account.
              </Text>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <View style={styles.emptyIcon}>
                <MenuIcon name="archive" size={28} color={colors.primaryDark} />
              </View>
              <Text style={styles.emptyTitle}>No archived chats</Text>
              <Text style={styles.emptyText}>
                Hold a chat in your history and choose Archive to tuck it away here without
                deleting it.
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.rowWrap}>
              <View style={styles.rowFlex}>
                <ConversationRow
                  conversation={item}
                  held={menu?.conversation.id === item.id}
                  onPress={() => onOpenConversation(item)}
                  onLongPress={(anchor) => setMenu({ conversation: item, anchor })}
                />
              </View>
              <TouchableOpacity
                style={styles.restore}
                onPress={() => restore(item)}
                hitSlop={HIT_SLOP}
                accessibilityRole="button"
                accessibilityLabel={`Unarchive ${item.title}`}
              >
                <MenuIcon name="unarchive" size={20} color={colors.primaryDark} />
              </TouchableOpacity>
            </View>
          )}
        />
      )}

      <ConversationMenu
        conversation={menu?.conversation ?? null}
        anchor={menu?.anchor ?? null}
        onSelect={handleAction}
        onOpen={onOpenConversation}
        onClose={() => setMenu(null)}
      />
      <RenameDialog
        initialTitle={renaming?.title ?? null}
        onSubmit={(title) => renaming && rename(renaming, title)}
        onClose={() => setRenaming(null)}
      />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: {
    flex: 1,
    backgroundColor: colors.backgroundLight,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  headerButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    textAlign: 'center',
    fontFamily: fonts.display,
    fontWeight: '800',
    fontSize: type.subtitle.fontSize,
    color: colors.primaryDarker,
  },
  list: {
    flexGrow: 1,
    paddingHorizontal: space.lg,
  },
  hint: {
    fontWeight: '600',
    fontSize: type.caption.fontSize,
    color: colors.textSecondary,
    paddingVertical: space.md,
  },
  rowWrap: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rowFlex: {
    flex: 1,
  },
  restore: {
    width: 40,
    height: 40,
    marginLeft: space.xs,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryLighter,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.md,
    paddingHorizontal: space.xxl,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm2,
    paddingHorizontal: space.xl,
  },
  emptyIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryLighter,
    marginBottom: space.xs,
  },
  emptyTitle: {
    fontFamily: fonts.display,
    fontWeight: '800',
    fontSize: type.bodyLarge.fontSize,
    color: colors.primaryDarker,
  },
  emptyText: {
    textAlign: 'center',
    fontWeight: '600',
    fontSize: type.caption.fontSize,
    lineHeight: 18,
    color: colors.textSecondary,
  },
  retryButton: {
    height: 36,
    paddingHorizontal: space.lg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryText: {
    fontWeight: '700',
    fontSize: type.caption.fontSize,
    color: colors.textSecondary,
  },
}));
