// src/components/profile/DataSheet.tsx
//
// Profile's "Your data" — export, clear pantry, delete account. Grouped
// together, in that order, because that is the order of how much they cost to
// undo: export costs nothing, clearing the pantry costs everything in it, and
// deleting the account costs the account.
//
// Export and Delete both use File + Sharing rather than any custom transport
// — the only way to hand a generated file to the user in Expo without a
// server round trip to somewhere else, and both are Expo's own packages.

import React, { useState } from 'react';
import { ActivityIndicator, Alert, Modal, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import Text from '../Text';
import { fonts, type } from '../../theme/typography';
import { makeStyles } from '../../theme/makeStyles';
import { useColors } from '../../theme/ThemeProvider';
import { space } from '../../theme/spacing';
import { clearPantry } from '../../services/pantry';
import { deleteAccount, exportUserData } from '../../services/profile';

const HIT_SLOP = { top: 12, bottom: 12, left: 12, right: 12 };

type Props = {
  visible: boolean;
  onClose: () => void;
  /** Runs after a successful delete — Profile hands this to the same
   *  onSignOut it already passes to the sign-out row, so both paths land the
   *  app on the same auth screen. */
  onAccountDeleted: () => void;
};

type Busy = 'export' | 'clear' | 'delete' | null;

export default function DataSheet({ visible, onClose, onAccountDeleted }: Props) {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleExport() {
    if (busy) return;
    setBusy('export');
    setError(null);
    try {
      const data = await exportUserData();
      const file = new File(Paths.cache, 'panzi-export.json');
      file.create({ overwrite: true });
      file.write(JSON.stringify(data, null, 2));

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, {
          mimeType: 'application/json',
          dialogTitle: 'Your Panzi data',
        });
      } else {
        // No share sheet on this device (some Android configurations) — the
        // file still exists, but there is nothing this screen can do to hand
        // it over, so say that plainly instead of silently doing nothing.
        setError('Sharing is not available on this device — could not hand over the file.');
      }
    } catch (err: any) {
      setError(err?.message ?? 'Could not export your data — try again.');
    } finally {
      setBusy(null);
    }
  }

  function confirmClearPantry() {
    Alert.alert(
      'Clear your pantry?',
      'Every item on your shelves is removed for good. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Clear pantry', style: 'destructive', onPress: runClearPantry },
      ]
    );
  }

  async function runClearPantry() {
    setBusy('clear');
    setError(null);
    try {
      await clearPantry();
    } catch (err: any) {
      setError(err?.message ?? 'Could not clear your pantry — try again.');
    } finally {
      setBusy(null);
    }
  }

  function confirmDelete() {
    Alert.alert(
      'Delete your account?',
      'Your pantry, scans, saved recipes, chats and profile are erased for good, and you are ' +
        'signed out everywhere. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete account', style: 'destructive', onPress: runDelete },
      ]
    );
  }

  async function runDelete() {
    setBusy('delete');
    setError(null);
    try {
      await deleteAccount();
      onAccountDeleted();
    } catch (err: any) {
      setError(err?.message ?? 'Could not delete your account — try again.');
      setBusy(null);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <TouchableOpacity style={styles.backdropTap} activeOpacity={1} onPress={onClose} />

        <View style={[styles.sheet, { paddingBottom: insets.bottom + space.lg }]}>
          <View style={styles.grabber} />

          <View style={styles.header}>
            <Text style={styles.title}>Your data</Text>
            <TouchableOpacity onPress={onClose} hitSlop={HIT_SLOP}>
              <Ionicons name="close" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <View style={styles.rowCard}>
            <DataRow
              icon="download-outline"
              title="Export your data"
              subtitle="Everything Panzi has on your account, as one file"
              busy={busy === 'export'}
              disabled={busy !== null}
              onPress={handleExport}
            />
            <View style={styles.divider} />
            <DataRow
              icon="trash-outline"
              title="Clear pantry"
              subtitle="Removes every item on your shelves"
              destructive
              busy={busy === 'clear'}
              disabled={busy !== null}
              onPress={confirmClearPantry}
            />
          </View>

          <View style={[styles.rowCard, styles.dangerCard]}>
            <DataRow
              icon="close-circle-outline"
              title="Delete account"
              subtitle="Erases your data for good and signs you out everywhere"
              destructive
              busy={busy === 'delete'}
              disabled={busy !== null}
              onPress={confirmDelete}
            />
          </View>

          {error && <Text style={styles.errorText}>{error}</Text>}
        </View>
      </View>
    </Modal>
  );
}

function DataRow({
  icon,
  title,
  subtitle,
  destructive,
  busy,
  disabled,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  subtitle: string;
  destructive?: boolean;
  busy: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const tint = destructive ? colors.rustMuted : colors.primaryDark;

  return (
    <TouchableOpacity
      style={styles.row}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.7}
    >
      <View style={[styles.rowIcon, destructive && styles.rowIconDanger]}>
        <Ionicons name={icon} size={17} color={tint} />
      </View>
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, destructive && { color: tint }]}>{title}</Text>
        <Text style={styles.rowSubtitle} numberOfLines={2}>
          {subtitle}
        </Text>
      </View>
      {busy && <ActivityIndicator size="small" color={tint} />}
    </TouchableOpacity>
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
  rowCard: {
    borderRadius: 20,
    backgroundColor: colors.cardSunken,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
    overflow: 'hidden',
    marginBottom: space.lg,
  },
  dangerCard: {
    borderColor: colors.warmBorder,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.lg,
    paddingHorizontal: space.lg,
  },
  rowIcon: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: colors.primaryLighter,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowIconDanger: {
    backgroundColor: colors.warmCard,
  },
  rowText: {
    flex: 1,
  },
  rowTitle: {
    fontWeight: '700',
    fontSize: type.body.fontSize,
    color: colors.primaryDarker,
  },
  rowSubtitle: {
    fontWeight: '600',
    fontSize: type.label.fontSize,
    lineHeight: 17,
    color: colors.textSecondary,
    marginTop: space.xs2,
  },
  divider: {
    height: 1,
    marginLeft: space.lg,
    backgroundColor: colors.divider,
  },
  errorText: {
    fontWeight: '700',
    fontSize: type.caption.fontSize,
    lineHeight: 17,
    color: colors.rustMuted,
    marginTop: space.sm,
  },
}));
