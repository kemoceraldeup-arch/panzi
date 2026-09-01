// src/screens/ChatFlow.tsx
//
// Tapping "Ask Panzi" goes straight into a new conversation — no list to click
// through first. History and "New chat" live in HistoryDrawer, reachable from
// inside the conversation via the hamburger icon, the same shape as Claude's
// own sidebar rather than a separate screen you navigate back out of.
//
// This is the seam MainTabs.tsx talks to: one `visible` flag and onClose, the
// same shape every other flow-level modal in that file already has.

import React, { useEffect, useState } from 'react';
import { Modal } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import ChatScreen from './ChatScreen';
import HistoryDrawer from './HistoryDrawer';
import { PantryItem } from '../services/pantry';
import { Recipe } from '../services/recipes';

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
  // id is null until the user actually sends a first message — opening the
  // flow itself no longer asks the server for anything. Tapping "Ask Panzi",
  // looking, and closing without typing used to still create a "New chat"
  // row in History every time; not calling the server at all until there is
  // a real message to send is what actually rules that out; unlike the
  // in-session-reuse approach this replaces, it also covers the app being
  // backgrounded or killed with nothing sent — there is no server row to
  // ever have been abandoned.
  const [open, setOpen] = useState<{ id: string | null; title: string } | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Whether the currently open conversation has no messages yet — reported
  // by ChatScreen. Gates HistoryDrawer's "New chat" button so it can't spawn
  // a second empty conversation while the current one is already unused.
  const [currentIsEmpty, setCurrentIsEmpty] = useState(true);

  // Opens straight into an (as yet unsaved) conversation the moment the flow
  // opens, rather than a list to pick "New chat" from first. This is a
  // purely local placeholder — see the note on `open` above — so there is no
  // server round trip, no loading state, and nothing to fail here.
  useEffect(() => {
    if (!visible || open) return;
    setOpen({ id: null, title: 'New chat' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  function close() {
    onClose();
    // Reset after the modal is gone rather than while it's still visible, so
    // the next open starts fresh instead of flashing the old one first.
    // Nothing to remember across the close: an unsent draft conversation had
    // no server id to begin with, and one with real messages already has its
    // own row in History if the user wants it back via the drawer.
    setTimeout(() => {
      setOpen(null);
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
          {open && (
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
                onConversationStarted={(conversation) =>
                  setOpen({ id: conversation.id, title: conversation.title })
                }
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
          )}
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </Modal>
  );
}
