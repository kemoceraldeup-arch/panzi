// src/screens/ChatFlow.tsx
//
// Tapping "Ask Panzi" goes straight into a new conversation — no list to click
// through first. History and "New chat" live in HistoryDrawer, reachable from
// inside the conversation via the hamburger icon, the same shape as Claude's
// own sidebar rather than a separate screen you navigate back out of.
//
// This is the seam MainTabs.tsx talks to: one `visible` flag and onClose, the
// same shape every other flow-level modal in that file already has.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, TouchableOpacity, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import Text from '../components/Text';
import ChatScreen from './ChatScreen';
import HistoryDrawer from './HistoryDrawer';
import { ChatError, createConversation } from '../services/chat';
import { PantryItem } from '../services/pantry';
import { Recipe } from '../services/recipes';
import { makeStyles } from '../theme/makeStyles';
import { useColors } from '../theme/ThemeProvider';
import { space } from '../theme/spacing';
import { type } from '../theme/typography';

type Props = {
  visible: boolean;
  /** The live pantry, so a recipe card's ingredient checklist reflects what's
   *  actually on the shelf right now — see the note on withLiveIngredients in
   *  services/recipes.ts for why the stored message can't be trusted for this. */
  items: PantryItem[];
  onOpenRecipe: (recipe: Recipe) => void;
  onStartCooking: (recipe: Recipe) => void;
  onClose: () => void;
};

export default function ChatFlow({ visible, items, onOpenRecipe, onStartCooking, onClose }: Props) {
  const styles = useStyles();
  const colors = useColors();

  const [open, setOpen] = useState<{ id: string; title: string } | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Whether the currently open conversation has no messages yet — reported by
  // ChatScreen. Gates HistoryDrawer's "New chat" button so it can't spawn a
  // second empty conversation while the current one is already unused, and
  // gates the reopen effect below the same way.
  const [currentIsEmpty, setCurrentIsEmpty] = useState(true);

  // Remembered across a close so reopening can reuse an untouched
  // conversation instead of asking the server for a new one every time —
  // see the reopen effect below. Only ever holds a conversation that was
  // empty when last seen; the moment ChatScreen reports it has a message,
  // this is cleared, so a real conversation is never silently resumed and
  // added to by a later "Ask Panzi" tap.
  const reusable = useRef<{ id: string; title: string } | null>(null);

  const startConversation = useCallback(() => {
    setStarting(true);
    setStartError(null);
    createConversation()
      .then((conversation) => setOpen({ id: conversation.id, title: conversation.title }))
      .catch((err) =>
        setStartError(err instanceof ChatError ? err.message : "Couldn't start a new chat.")
      )
      .finally(() => setStarting(false));
  }, []);

  // Opens straight into a conversation the moment the flow opens, rather
  // than a list to pick "New chat" from first — the whole point of this
  // change. Reuses the last conversation if closing left it untouched
  // (tap "Ask Panzi", look, close without typing anything — that shouldn't
  // leave a trail of empty conversations in history every time), and only
  // asks the server for a genuinely new one when there's nothing reusable.
  useEffect(() => {
    if (!visible || open || starting) return;
    if (reusable.current) {
      setOpen(reusable.current);
      return;
    }
    startConversation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  function close() {
    onClose();
    // Reset after the modal is gone rather than while it's still visible, so
    // the next open starts a genuinely new conversation instead of flashing
    // the old one first. The conversation itself is kept in `reusable` (only
    // when it's still empty) so the reopen effect above can pick it back up
    // instead of creating a fresh one.
    reusable.current = open && currentIsEmpty ? open : null;
    setTimeout(() => {
      setOpen(null);
      setStartError(null);
      setDrawerOpen(false);
    }, 300);
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={close}>
      {/* RN's Modal renders its content in its own native view hierarchy,
          outside the app's normal tree — the GestureHandlerRootView wrapping
          App.tsx doesn't reach in here, so HistoryDrawer's swipe gesture needs
          its own root view, nested right inside this Modal. */}
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider initialMetrics={initialWindowMetrics}>
          {open ? (
            <>
              <ChatScreen
                conversationId={open.id}
                title={open.title}
                items={items}
                onOpenRecipe={onOpenRecipe}
                onStartCooking={onStartCooking}
                onOpenHistory={() => setDrawerOpen(true)}
                onClose={close}
                onEmptyChange={setCurrentIsEmpty}
              />
              <HistoryDrawer
                visible={drawerOpen}
                activeConversationId={open.id}
                currentIsEmpty={currentIsEmpty}
                onOpen={() => setDrawerOpen(true)}
                onOpenConversation={(conversation) => {
                  setOpen({ id: conversation.id, title: conversation.title });
                  setDrawerOpen(false);
                }}
                onNewChat={(conversation) => {
                  setOpen({ id: conversation.id, title: conversation.title });
                  setDrawerOpen(false);
                }}
                onClose={() => setDrawerOpen(false)}
              />
            </>
          ) : (
            // The one moment ChatScreen has nothing to render an error state
            // over — no conversation exists yet for it to be a screen of.
            <View style={styles.loading}>
              {starting ? (
                <ActivityIndicator color={colors.primary} />
              ) : startError ? (
                <>
                  <Text style={styles.errorText}>{startError}</Text>
                  <TouchableOpacity style={styles.retryButton} onPress={startConversation}>
                    <Text style={styles.retryButtonText}>Try again</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={close}>
                    <Text style={styles.cancelText}>Cancel</Text>
                  </TouchableOpacity>
                </>
              ) : null}
            </View>
          )}
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.md,
    paddingHorizontal: space.xxl,
    backgroundColor: colors.backgroundLight,
  },
  errorText: {
    textAlign: 'center',
    fontWeight: '600',
    fontSize: type.body.fontSize,
    lineHeight: 21,
    color: colors.textSecondary,
  },
  retryButton: {
    height: 44,
    paddingHorizontal: space.xxl,
    borderRadius: 14,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryButtonText: {
    fontWeight: '800',
    fontSize: type.body.fontSize,
    color: colors.onAccent,
  },
  cancelText: {
    fontWeight: '700',
    fontSize: type.caption.fontSize,
    color: colors.textSecondary,
  },
}));
