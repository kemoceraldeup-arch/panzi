// src/components/chat/RenameDialog.tsx
//
// Rename from the history menu. A modal of its own rather than Alert.prompt,
// which only exists on iOS.

import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Text from '../Text';
import { makeStyles } from '../../theme/makeStyles';
import { useColors } from '../../theme/ThemeProvider';
import { space } from '../../theme/spacing';
import { fonts, type } from '../../theme/typography';

const MAX_LENGTH = 60;

type Props = {
  /** The current title; null closes the dialog. */
  initialTitle: string | null;
  onSubmit: (title: string) => void;
  onClose: () => void;
};

export default function RenameDialog({ initialTitle, onSubmit, onClose }: Props) {
  const styles = useStyles();
  const colors = useColors();
  const [value, setValue] = useState('');
  const [visible, setVisible] = useState(false);
  const reveal = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (initialTitle === null) return;
    setValue(initialTitle);
    setVisible(true);
    reveal.setValue(0);
    Animated.timing(reveal, {
      toValue: 1,
      duration: 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [initialTitle, reveal]);

  function dismiss(then?: () => void) {
    Animated.timing(reveal, {
      toValue: 0,
      duration: 140,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      setVisible(false);
      onClose();
      then?.();
    });
  }

  const trimmed = value.trim();
  const canSave = trimmed.length > 0 && trimmed !== initialTitle;

  function save() {
    if (!canSave) return;
    dismiss(() => onSubmit(trimmed));
  }

  if (!visible) return null;

  return (
    <Modal visible transparent animationType="none" onRequestClose={() => dismiss()}>
      <Animated.View style={[styles.backdrop, { opacity: reveal }]}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => dismiss()} />
      </Animated.View>
      <KeyboardAvoidingView
        style={styles.center}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        pointerEvents="box-none"
      >
        <Animated.View
          style={[
            styles.card,
            {
              opacity: reveal,
              transform: [{ scale: reveal.interpolate({ inputRange: [0, 1], outputRange: [0.95, 1] }) }],
            },
          ]}
        >
          <Text style={styles.title}>Rename chat</Text>
          <TextInput
            style={styles.input}
            value={value}
            onChangeText={setValue}
            autoFocus
            selectTextOnFocus
            maxLength={MAX_LENGTH}
            returnKeyType="done"
            onSubmitEditing={save}
            placeholder="Chat name"
            placeholderTextColor={colors.mutedLight}
            selectionColor={colors.primaryDark}
          />
          <View style={styles.actions}>
            <TouchableOpacity style={styles.button} onPress={() => dismiss()}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, styles.saveButton, !canSave && styles.saveOff]}
              onPress={save}
              disabled={!canSave}
            >
              <Text style={styles.saveText}>Save</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(23,23,15,0.35)',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xxl,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: colors.card,
    borderRadius: 20,
    padding: space.lg,
    gap: space.md,
    shadowColor: colors.shadow,
    shadowOpacity: 0.25,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 12 },
    elevation: 14,
  },
  title: {
    fontFamily: fonts.display,
    fontWeight: '800',
    fontSize: type.subtitle.fontSize,
    color: colors.primaryDarker,
  },
  input: {
    height: 46,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
    paddingHorizontal: space.md,
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: type.body.fontSize,
    color: colors.textPrimary,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: space.sm,
  },
  button: {
    height: 40,
    paddingHorizontal: space.lg,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelText: {
    fontWeight: '700',
    fontSize: type.body.fontSize,
    color: colors.textSecondary,
  },
  saveButton: {
    backgroundColor: colors.primary,
  },
  saveOff: {
    backgroundColor: colors.primaryLight,
  },
  saveText: {
    fontWeight: '800',
    fontSize: type.body.fontSize,
    color: colors.onAccent,
  },
}));
