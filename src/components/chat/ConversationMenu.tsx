// src/components/chat/ConversationMenu.tsx
//
// What holding a history row opens, modelled on the ChatGPT app's: the screen
// behind frosts over, a preview of the chat floats up so you can see which
// one you're about to act on, and the menu — Pin, Rename, Archive, Delete —
// sits right under it, near the row your finger is on.
//
// Closing animates out before the Modal unmounts, and the choice is handed
// back only once it has, so a Rename dialog or a Delete confirmation never
// appears on top of a menu that is still disappearing.

import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Modal,
  Platform,
  StyleSheet,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Text from '../Text';
import MenuIcon, { MenuIconName } from './MenuIcons';
import ConversationPreview from './ConversationPreview';
import { makeStyles } from '../../theme/makeStyles';
import { useColors, useTheme } from '../../theme/ThemeProvider';
import { space } from '../../theme/spacing';
import { type } from '../../theme/typography';
import { Conversation } from '../../services/chat';

/** Where the held row is on screen, from measureInWindow. */
export type RowAnchor = { x: number; y: number; width: number; height: number };

export type ConversationAction = 'pin' | 'rename' | 'archive' | 'delete';

const ITEM_HEIGHT = 50;
const MENU_PAD = space.sm;
const EDGE = 16;
const GAP = 10;
/** Below this the preview is too short to show anything worth seeing. */
const MIN_PREVIEW = 200;
const MAX_PREVIEW = 440;
/** ChatGPT's own delete red — the app's accent is orange, which next to a
 *  trash can reads as a warning rather than as "this cannot be undone". */
const DESTRUCTIVE = { light: '#E5484D', dark: '#FF6369' };

type Props = {
  /** Null closes the menu. */
  conversation: Conversation | null;
  anchor: RowAnchor | null;
  onSelect: (action: ConversationAction, conversation: Conversation) => void;
  /** The preview was tapped — go to that chat, as the ChatGPT app does. */
  onOpen: (conversation: Conversation) => void;
  onClose: () => void;
};

export default function ConversationMenu({ conversation, anchor, onSelect, onOpen, onClose }: Props) {
  const styles = useStyles();
  const colors = useColors();
  const { scheme } = useTheme();
  const dark = scheme === 'dark';
  const screen = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const reveal = useRef(new Animated.Value(0)).current;
  // Set from the first tap until the fade finishes, so a second tap landing
  // mid-fade can't fire a second action on the same chat.
  const closing = useRef(false);

  // Held separately from the props so the menu keeps rendering the chat it
  // was opened for while it fades out, after the parent has already cleared it.
  const [shown, setShown] = useState<{ conversation: Conversation; anchor: RowAnchor } | null>(null);

  useEffect(() => {
    if (conversation && anchor) {
      setShown({ conversation, anchor });
      closing.current = false;
      reveal.setValue(0);
      Animated.timing(reveal, {
        toValue: 1,
        duration: 240,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    }
  }, [conversation, anchor, reveal]);

  /** `immediate` for a follow-up that doesn't present another Modal or
   *  Alert, and so has nothing to wait for. */
  function dismiss(then?: () => void, immediate = false) {
    if (closing.current) return;
    closing.current = true;
    // Ease-out and short: the menu should be visibly leaving from the frame
    // the finger lifts, not hang for a beat first.
    Animated.timing(reveal, {
      toValue: 0,
      duration: 150,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start(() => {
      setShown(null);
      onClose();
      // iOS won't present a Modal or an Alert while another Modal is still
      // being torn down — the Rename dialog or the Delete confirmation would
      // silently never appear. A beat's wait lets this one finish going.
      if (then) setTimeout(then, Platform.OS === 'ios' && !immediate ? 280 : 0);
    });
  }

  if (!shown) return null;

  const { conversation: chat, anchor: row } = shown;
  const archived = chat.archived;
  const items: { action: ConversationAction; label: string; icon: MenuIconName }[] = [
    // Archived chats can't be pinned — they're out of the list a pin sorts.
    ...(!archived
      ? [
          {
            action: 'pin' as const,
            label: chat.pinned ? 'Unpin' : 'Pin',
            icon: (chat.pinned ? 'unpin' : 'pin') as MenuIconName,
          },
        ]
      : []),
    { action: 'rename', label: 'Rename', icon: 'rename' },
    {
      action: 'archive',
      label: archived ? 'Unarchive' : 'Archive',
      icon: archived ? 'unarchive' : 'archive',
    },
    { action: 'delete', label: 'Delete', icon: 'delete' },
  ];

  // The menu sits just under the held row where it can, pushed down if the
  // row is so high there'd be no room for the preview above it, and up if
  // the row is so low the menu would run off the bottom. The preview fills
  // whatever is left above the menu.
  const menuHeight = items.length * ITEM_HEIGHT + MENU_PAD * 2;
  const menuWidth = Math.min(260, Math.round(screen.width * 0.64));
  const menuTop = Math.min(
    Math.max(row.y + row.height + GAP, insets.top + EDGE + MIN_PREVIEW + GAP),
    screen.height - Math.max(insets.bottom, EDGE) - EDGE - menuHeight
  );
  const previewBottom = menuTop - GAP;
  const previewTop = Math.max(insets.top + EDGE, previewBottom - MAX_PREVIEW);
  const destructive = dark ? DESTRUCTIVE.dark : DESTRUCTIVE.light;

  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={() => dismiss()}
    >
      {/* The frosted backdrop. iOS blurs whatever is behind the Modal; Android
          has nothing it can blur across a Modal boundary, so it gets a
          deeper dim instead, which reads the same way — "this is set aside". */}
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: reveal }]}>
        {Platform.OS === 'ios' && (
          <BlurView
            style={StyleSheet.absoluteFill}
            intensity={dark ? 40 : 30}
            tint={dark ? 'systemThinMaterialDark' : 'systemThinMaterialLight'}
          />
        )}
        <View
          style={[
            StyleSheet.absoluteFill,
            {
              backgroundColor:
                Platform.OS === 'ios'
                  ? dark
                    ? 'rgba(0,0,0,0.25)'
                    : 'rgba(23,23,15,0.08)'
                  : dark
                    ? 'rgba(0,0,0,0.62)'
                    : 'rgba(23,23,15,0.4)',
            },
          ]}
        />
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={() => dismiss()}
          accessibilityLabel="Close menu"
        />
      </Animated.View>

      <Animated.View
        style={[
          styles.preview,
          {
            top: previewTop,
            height: previewBottom - previewTop,
            left: EDGE,
            right: EDGE,
            opacity: reveal,
            transform: [
              { scale: reveal.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) },
            ],
          },
        ]}
      >
        <TouchableOpacity
          style={styles.previewTap}
          activeOpacity={0.85}
          onPress={() => dismiss(() => onOpen(chat), true)}
          accessibilityRole="button"
          accessibilityLabel={`Open ${chat.title}`}
        >
          <ConversationPreview conversationId={chat.id} />
        </TouchableOpacity>
      </Animated.View>

      <Animated.View
        style={[
          styles.menu,
          {
            top: menuTop,
            left: EDGE,
            width: menuWidth,
            opacity: reveal,
            // Grows out of its top-left corner, toward the preview and the
            // row, rather than from its own middle.
            transformOrigin: 'top left',
            transform: [
              { scale: reveal.interpolate({ inputRange: [0, 1], outputRange: [0.86, 1] }) },
            ],
          },
        ]}
      >
        {Platform.OS === 'ios' && (
          <BlurView
            style={StyleSheet.absoluteFill}
            intensity={80}
            tint={dark ? 'systemChromeMaterialDark' : 'systemChromeMaterialLight'}
          />
        )}
        {items.map((item) => {
          const tint = item.action === 'delete' ? destructive : colors.textPrimary;
          return (
            <TouchableOpacity
              key={item.action}
              style={styles.item}
              activeOpacity={0.55}
              onPress={() => dismiss(() => onSelect(item.action, chat))}
              accessibilityRole="menuitem"
            >
              <MenuIcon name={item.icon} size={22} color={tint} />
              <Text style={[styles.itemText, { color: tint }]}>{item.label}</Text>
            </TouchableOpacity>
          );
        })}
      </Animated.View>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  preview: {
    position: 'absolute',
    backgroundColor: colors.backgroundLight,
    borderRadius: 28,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderWarm,
  },
  previewTap: {
    flex: 1,
  },
  menu: {
    position: 'absolute',
    paddingVertical: MENU_PAD,
    borderRadius: 26,
    overflow: 'hidden',
    // On iOS the BlurView supplies the surface and this only tints it; on
    // Android this is the surface.
    backgroundColor: Platform.OS === 'ios' ? 'transparent' : colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderWarm,
    elevation: 16,
  },
  item: {
    height: ITEM_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md2,
    paddingHorizontal: space.lg,
  },
  itemText: {
    fontWeight: '600',
    fontSize: type.bodyLarge.fontSize,
  },
}));
