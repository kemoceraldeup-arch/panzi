// src/screens/DashboardScreen.tsx

import React, { useEffect, useState } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Modal,
} from 'react-native';
import Text from '../components/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../auth/AuthProvider';
import { fetchProfile } from '../services/profile';
import { subscribeToPantryItems, deletePantryItem, PantryItem } from '../services/pantry';
import { getFreshnessBadge } from '../utils/freshness';
import Mascot from '../components/Mascot';
import ScanModal from './scan/ScanModal';
import { makeStyles } from '../theme/makeStyles';
import { useColors } from '../theme/ThemeProvider';
import { space } from '../theme/spacing';
import { type } from '../theme/typography';

// Tab switches unmount/remount DashboardScreen, which would otherwise reset
// the name to null and flash "Your pantry" every time the user comes back
// to this tab. Caching by uid means only the very first load can flash.
const nameCache = new Map<string, string | null>();

export default function DashboardScreen() {
  const styles = useStyles();
  const colors = useColors();
  const { uid } = useAuth();

  const [name, setName] = useState<string | null>(() => (uid ? nameCache.get(uid) ?? null : null));
  const [items, setItems] = useState<PantryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalVisible, setModalVisible] = useState(false);

  useEffect(() => {
    if (!uid) return;
    if (nameCache.has(uid)) return;
    fetchProfile()
      .then((profile) => {
        nameCache.set(uid, profile.name);
        setName(profile.name);
      })
      // A greeting is not worth an error state. The header falls back to
      // "Your pantry", which is what it shows before this resolves anyway, and
      // nothing is cached so the next visit tries again.
      .catch(() => {});
  }, [uid]);

  useEffect(() => {
    if (!uid) return;
    const unsubscribe = subscribeToPantryItems(
      uid,
      (nextItems) => {
        setItems(nextItems);
        setLoading(false);
      },
      (err) => {
        setLoading(false);
        Alert.alert('Could not load your pantry', err.message);
      }
    );
    return unsubscribe;
  }, [uid]);

  function handleDelete(item: PantryItem) {
    Alert.alert('Remove item?', `Remove "${item.name}" from your pantry.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => deletePantryItem(item.id) },
    ]);
  }

  const needsAttention = items.filter((i) => {
    const badge = getFreshnessBadge(i.expiryDate, colors);
    return badge.label !== 'FRESH' && badge.label !== 'NO DATE';
  }).length;

  if (!uid) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.description}>You need to be signed in to see your pantry.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>{name ? `Hi ${name} 👋` : 'Your pantry'}</Text>
          <Text style={styles.subtitle}>
            {items.length === 0
              ? 'Nothing logged yet'
              : `${items.length} item${items.length === 1 ? '' : 's'}${needsAttention > 0 ? ` · ${needsAttention} need${needsAttention === 1 ? 's' : ''} attention` : ''}`}
          </Text>
        </View>
        <Mascot size={44} pose="face" style={{ borderRadius: 999 }} />
      </View>

      {loading ? (
        <View style={styles.centerFill}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : items.length === 0 ? (
        <View style={styles.emptyState}>
          <Mascot size={200} pose="shelf" />
          <Text style={styles.emptyTitle}>Your pantry's empty.</Text>
          <Text style={styles.emptyDescription}>
            Add your first item and Panzi will start keeping track of what you have and when it expires.
          </Text>
          <TouchableOpacity style={styles.primaryButton} onPress={() => setModalVisible(true)}>
            <Text style={styles.primaryButtonText}>Add your first item</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => {
            const badge = getFreshnessBadge(item.expiryDate, colors);
            return (
              <TouchableOpacity
                style={styles.itemRow}
                onLongPress={() => handleDelete(item)}
                activeOpacity={0.7}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemName}>
                    {item.name} · {item.quantity}
                  </Text>
                  <Text style={styles.itemMeta}>{item.category}</Text>
                </View>
                <View style={[styles.badge, { backgroundColor: badge.bg }]}>
                  <Text style={[styles.badgeText, { color: badge.color }]}>{badge.label}</Text>
                </View>
              </TouchableOpacity>
            );
          }}
        />
      )}

      {items.length > 0 && (
        <TouchableOpacity style={styles.fab} onPress={() => setModalVisible(true)}>
          <Text style={styles.fabIcon}>+</Text>
        </TouchableOpacity>
      )}

      {/* NOTE: this screen is no longer routed — MainTabs renders HomeScreen
          and ListScreen instead. It is a candidate for removal.
          The standalone item form it used to open here is gone: the item
          scanner absorbed it, and adding by hand is now the scan flow opened
          onto a review page holding one blank row. */}
      <ScanModal
        visible={modalVisible}
        uid={uid}
        startMode="manual"
        onClose={() => setModalVisible(false)}
        onAdded={() => setModalVisible(false)}
      />
    </SafeAreaView>
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
    paddingHorizontal: space.xxl,
    paddingTop: space.md,
    paddingBottom: space.lg,
  },
  greeting: {
    fontWeight: '800',
    fontSize: type.headline.fontSize,
    color: colors.primaryDarker,
  },
  subtitle: {
    fontWeight: '600',
    fontSize: type.label.fontSize,
    color: colors.textSecondary,
    marginTop: space.xs,
  },
  centerFill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xxxl,
  },
  emptyTitle: {
    fontWeight: '800',
    fontSize: type.headline.fontSize,
    color: colors.primaryDarker,
    marginTop: space.lg,
    marginBottom: space.sm,
    textAlign: 'center',
  },
  emptyDescription: {
    fontSize: type.body.fontSize,
    lineHeight: 22,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: space.xxl,
  },
  primaryButton: {
    height: 56,
    minWidth: 220,
    borderRadius: 18,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xxl,
  },
  primaryButtonText: {
    color: colors.onAccent,
    fontWeight: '800',
    fontSize: type.bodyLarge.fontSize,
  },
  listContent: {
    paddingHorizontal: space.xxl,
    paddingBottom: 100,
    gap: space.md,
  },
  itemRow: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
    borderRadius: 20,
    paddingVertical: space.lg,
    paddingHorizontal: space.lg2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  itemName: {
    fontWeight: '700',
    fontSize: type.bodyLarge.fontSize,
    color: colors.primaryDarker,
    marginBottom: space.xs,
  },
  itemMeta: {
    fontWeight: '600',
    fontSize: type.label.fontSize,
    color: colors.textSecondary,
  },
  badge: {
    paddingVertical: space.xs2,
    paddingHorizontal: space.md,
    borderRadius: 999,
  },
  badgeText: {
    fontWeight: '800',
    fontSize: type.caption.fontSize,
    letterSpacing: 0.5,
  },
  fab: {
    position: 'absolute',
    right: 24,
    bottom: 28,
    width: 58,
    height: 58,
    borderRadius: 999,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.shadow,
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  fabIcon: {
    color: colors.onAccent,
    fontSize: type.display.fontSize,
    fontWeight: '700',
    marginTop: -2,
  },
  description: {
    fontSize: type.body.fontSize,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: space.huge,
  },
}));