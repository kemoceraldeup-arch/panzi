// src/components/profile/PersonalDetailsSheet.tsx
//
// Profile's "Personal details".
//
// Only `name` is editable here. Email lives under "Sign-in & security"
// instead — changing it needs reauthentication, which is a different flow
// with different failure modes, and mixing the two into one form would mean
// one save button covering two very different kinds of risk. There is no
// phone field: nothing in this app collects one, at signup or anywhere else,
// so adding an input for it here would be a field the rest of the app can
// never read back.

import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Text from '../Text';
import { fonts, type } from '../../theme/typography';
import { makeStyles } from '../../theme/makeStyles';
import { useColors } from '../../theme/ThemeProvider';
import { space } from '../../theme/spacing';
import { saveName } from '../../services/profile';

const HIT_SLOP = { top: 12, bottom: 12, left: 12, right: 12 };

type Props = {
  visible: boolean;
  uid: string | null;
  name: string | null;
  email: string | null;
  onClose: () => void;
};

export default function PersonalDetailsSheet({ visible, uid, name, email, onClose }: Props) {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const [draft, setDraft] = useState(name ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seeds the draft from the current name every time the sheet opens,
  // rather than once on mount — the sheet stays alive for the whole screen,
  // so without this a save from a previous open would leave a stale draft
  // sitting behind the next one.
  useEffect(() => {
    if (visible) {
      setDraft(name ?? '');
      setError(null);
    }
  }, [visible, name]);

  const trimmed = draft.trim();
  const changed = trimmed.length > 0 && trimmed !== (name ?? '');

  async function save() {
    if (!uid || !changed || saving) return;
    setSaving(true);
    setError(null);
    try {
      await saveName(uid, trimmed);
      onClose();
    } catch (err: any) {
      setError(err?.message ?? 'Could not save that — try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <TouchableOpacity style={styles.backdropTap} activeOpacity={1} onPress={onClose} />

        <View style={[styles.sheet, { paddingBottom: insets.bottom + space.lg }]}>
          <View style={styles.grabber} />

          <View style={styles.header}>
            <Text style={styles.title}>Personal details</Text>
            <TouchableOpacity onPress={onClose} hitSlop={HIT_SLOP}>
              <Ionicons name="close" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <Text style={styles.eyebrow}>NAME</Text>
          <View style={styles.inputWrap}>
            <TextInput
              style={styles.input}
              value={draft}
              onChangeText={setDraft}
              placeholder="Your name"
              placeholderTextColor={colors.mutedLight}
              autoCapitalize="words"
              maxLength={80}
              editable={!saving}
            />
          </View>

          <Text style={[styles.eyebrow, styles.eyebrowSpaced]}>EMAIL</Text>
          <View style={styles.readOnlyRow}>
            <Text style={styles.readOnlyText} numberOfLines={1}>
              {email ?? 'Guest account'}
            </Text>
            <Text style={styles.readOnlyHint}>Change under Sign-in & security</Text>
          </View>

          {error && <Text style={styles.errorText}>{error}</Text>}

          <TouchableOpacity
            style={[styles.save, !changed && styles.saveOff]}
            onPress={save}
            disabled={!changed || saving}
            activeOpacity={0.85}
          >
            {saving ? (
              <ActivityIndicator color={colors.onAccent} />
            ) : (
              <Text style={styles.saveLabel}>Save</Text>
            )}
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
    backgroundColor: colors.card,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: space.xxl,
    paddingTop: space.md,
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 999,
    backgroundColor: colors.backgroundAlt,
    marginBottom: space.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.lg,
  },
  title: {
    fontFamily: fonts.display,
    fontWeight: '800',
    fontSize: type.title.fontSize,
    color: colors.primaryDarker,
  },
  eyebrow: {
    fontWeight: '800',
    fontSize: type.micro.fontSize,
    letterSpacing: 1.54,
    textTransform: 'uppercase',
    color: colors.tabInactive,
    marginBottom: space.sm2,
  },
  eyebrowSpaced: {
    marginTop: space.lg2,
  },
  inputWrap: {
    height: 52,
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
    paddingHorizontal: space.md2,
    justifyContent: 'center',
  },
  input: {
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: type.body.fontSize,
    color: colors.textPrimary,
    padding: 0,
  },
  readOnlyRow: {
    height: 52,
    borderRadius: 16,
    backgroundColor: colors.cardSunken,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
    paddingHorizontal: space.md2,
    justifyContent: 'center',
    gap: space.xs2,
  },
  readOnlyText: {
    fontWeight: '600',
    fontSize: type.body.fontSize,
    color: colors.textSecondary,
  },
  readOnlyHint: {
    fontWeight: '600',
    fontSize: type.micro.fontSize,
    color: colors.mutedLight,
  },
  errorText: {
    fontWeight: '700',
    fontSize: type.caption.fontSize,
    lineHeight: 17,
    color: colors.rustMuted,
    marginTop: space.md,
  },
  save: {
    height: 50,
    borderRadius: 16,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: space.xl,
  },
  saveOff: {
    backgroundColor: colors.primaryLight,
  },
  saveLabel: {
    fontWeight: '800',
    fontSize: type.subtitle.fontSize,
    color: colors.onAccent,
  },
}));
