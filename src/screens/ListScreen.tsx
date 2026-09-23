// src/screens/ListScreen.tsx
//
// The List tab — the full pantry inventory, built to the List-screen design
// handoff. Everything the user owns, grouped by food category, with whatever
// needs eating first pulled into a warm "Use soon" card at the top.
//
// Three interaction modes live here:
//   - browse: tap a row to edit every field of it, swipe it left for Move /
//     Delete
//   - selection: long-press a row for multi-select, with an action bar that
//     replaces the tab bar (MainTabs hides it via onSelectionModeChange)
//   - sort/filter: the icon top-right
//
// Selection is a mode over the list, not a screen of its own: the header,
// search, chips, grouping and scroll position all stay exactly where they
// were, so the row you long-pressed is still under your finger. Only the
// header's two round buttons and the bar at the bottom change.
//
// Grouping only applies in the default view: filtering to a single category
// chip, or sorting by anything other than category, collapses the per-category
// cards into one flat list (per the handoff — the section headers would just
// repeat the filter).

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  Pressable,
  Animated,
  PanResponder,
  LayoutChangeEvent,
  Alert,
} from 'react-native';
import Text from '../components/Text';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../auth/AuthProvider';
import {
  subscribeToPantryItems,
  deletePantryItem,
  movePantryItem,
  updatePantryItem,
  NewPantryItem,
  PantryItem,
  FOOD_CATEGORIES,
  STORAGE_LOCATIONS,
  parseQuantity,
  effectiveDate,
} from '../services/pantry';
import EditItemSheet from './EditItemSheet';
import { backfillItemPhotos } from '../services/scans';
import { UserProfile } from '../services/profile';
import { checkItemConflicts, ItemConflict } from '../services/dietCheck';
import ConflictAlertModal from '../components/ConflictAlertModal';
import { formatExpiry, getDaysLeft, isUseSoon } from '../utils/freshness';
import { datePrefix } from '../utils/dateLabel';
import { RIPENESS_LABELS, isUrgentStage } from '../utils/ripeness';
import { SCAN_BUTTON_LIFT, TAB_BAR_CONTENT_HEIGHT } from '../navigation/TabBar';
import { useCollapseOnScroll, resetTabScroll } from '../navigation/scrollCollapse';
import { makeStyles } from '../theme/makeStyles';
import { useColors } from '../theme/ThemeProvider';
import { space } from '../theme/spacing';
import { type } from '../theme/typography';

// "Use soon" shows this many rows before collapsing the rest behind "See all".
const USE_SOON_PREVIEW = 3;

// Each swipe action pane, and the two of them together.
const ACTION_WIDTH = 74;
const ACTIONS_TOTAL = ACTION_WIDTH * 2;

type SortMode =
  | 'category'
  | 'expiry'
  | 'recent'
  | 'oldest'
  | 'qtyAsc'
  | 'qtyDesc';
type ShowFilter = 'all' | 'useSoon';

const SORT_LABELS: Record<SortMode, string> = {
  category: 'Category',
  recent: 'Latest added',
  oldest: 'Oldest added',
  qtyAsc: 'Quantity: Low → High',
  qtyDesc: 'Quantity: High → Low',
  expiry: 'Expiring soon',
};

/**
 * Least quantity first, undated/unparsable quantities last (same "unknown
 * isn't urgent" reasoning the expiry sort already uses) — then by name so
 * equal quantities keep a stable, predictable order rather than whatever
 * order Firestore happened to return.
 */
function compareQuantity(a: PantryItem, b: PantryItem, ascending: boolean): number {
  const av = parseQuantity(a.quantity).value;
  const bv = parseQuantity(b.quantity).value;
  if (av === null && bv === null) return a.name.localeCompare(b.name);
  if (av === null) return 1;
  if (bv === null) return -1;
  return ascending ? av - bv : bv - av;
}

const SHOW_LABELS: Record<ShowFilter, string> = {
  all: 'Everything',
  useSoon: 'Expiring soon',
};

type Props = {
  onAddByHand: () => void;
  /** Opens the camera scanner — the empty state's "Scan item" button. */
  onScan: () => void;
  onSelectionModeChange: (active: boolean) => void;
  /** Ids from the scan that just landed. Held only while its Undo toast is up —
   *  the scan flow deliberately ends here rather than on a success screen, so
   *  the user sees what was added in the place it now lives. */
  justAddedIds?: string[];
  /** Category to open filtered to, from Home's "What you've got" strip.
   *  Only read on mount — this screen unmounts when the tab changes, so
   *  arriving here any other way starts on "All" as before. */
  initialCategory?: string | null;
  /** For the diet/allergy conflict check on rename — see applyEdit. */
  profile: UserProfile;
};

export default function ListScreen({
  onAddByHand,
  onScan,
  onSelectionModeChange,
  justAddedIds,
  initialCategory,
  profile,
}: Props) {
  const styles = useStyles();
  const colors = useColors();
  const { uid } = useAuth();
  // The action bar stands in for the tab bar, so it has to clear the home
  // indicator the same way TabBar does — otherwise the list shifts when
  // selection starts, and the buttons sit under the indicator.
  const insets = useSafeAreaInsets();
  const collapseOnScroll = useCollapseOnScroll();
  // This screen remounts on every category change (see MainTabs' `key` on
  // it), which would otherwise leave the shared collapse reading whatever
  // scroll position the old mount last reported — a category switch that
  // happens mid-scroll would hand the new, freshly-scrolled-to-top list a
  // tab bar that's still collapsed for no reason visible on screen.
  useEffect(() => {
    resetTabScroll();
  }, []);

  const [items, setItems] = useState<PantryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState(initialCategory ?? 'All');
  const [sortMode, setSortMode] = useState<SortMode>('category');
  const [showFilter, setShowFilter] = useState<ShowFilter>('all');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [showAllUseSoon, setShowAllUseSoon] = useState(false);

  // At most one row may be swiped open at a time.
  const [openSwipeId, setOpenSwipeId] = useState<string | null>(null);

  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);

  // Which items a Move is being chosen for — one row from a swipe, or the
  // whole selection from the action bar.
  const [movingIds, setMovingIds] = useState<string[] | null>(null);

  // The row whose edit sheet is open. Held as an id rather than the item, so
  // the sheet keeps showing live values if the listener pushes an update while
  // it is open instead of freezing a copy taken when it was tapped.
  const [editingId, setEditingId] = useState<string | null>(null);

  // A rename that conflicts with the user's diet or allergies, held until they
  // choose Cancel or Add anyway on ConflictAlertModal — see applyEdit.
  const [pendingEdit, setPendingEdit] = useState<{
    id: string;
    changes: Partial<NewPantryItem>;
    conflicts: ItemConflict[];
  } | null>(null);

  // Runs at most once per mount, and only ever writes to items that have no
  // picture at all — see backfillItemPhotos. Guarded by a ref rather than state
  // because the listener below fires again on every write, including this one.
  const backfilled = useRef(false);

  useEffect(() => {
    if (!uid) {
      setLoading(false);
      return;
    }
    return subscribeToPantryItems(
      uid,
      (nextItems) => {
        setItems(nextItems);
        setLoading(false);
        if (!backfilled.current && nextItems.length > 0) {
          backfilled.current = true;
          // Fire and forget. Nothing on screen is waiting for it, and a failure
          // costs a thumbnail rather than an item — telling the user their
          // pantry failed to load because a picture didn't fill in would be a
          // worse outcome than the blank tile they already had.
          backfillItemPhotos(uid, nextItems).catch(() => {});
        }
      },
      (err) => {
        setLoading(false);
        Alert.alert('Could not load your pantry', err.message);
      }
    );
  }, [uid]);

  // Reported straight from the handlers below, never from an effect on
  // `selecting`. An effect is passive — it runs after the commit has painted,
  // so there was a whole frame where this screen had already mounted the
  // action bar while MainTabs still had the tab bar in the tree. Both bars
  // stacked at the bottom, the list was squeezed by both, and it snapped back
  // a frame later: the pop-and-settle on entering and leaving selection.
  // Calling the parent from the same event handler batches its update into
  // this screen's commit, so the two bars swap in a single frame.
  //
  // Held in a ref so the unmount cleanup below can't go stale or re-fire if
  // the prop's identity ever changes.
  const reportSelection = useRef(onSelectionModeChange);
  reportSelection.current = onSelectionModeChange;

  // The tab bar is the parent's to restore, and this screen can be unmounted
  // mid-selection — without this the tab bar would stay hidden for good.
  useEffect(() => () => reportSelection.current(false), []);

  // Chips list every category the user actually has something in — an empty
  // category renders no chip, no header and no card.
  const categories = useMemo(() => {
    const present = Array.from(new Set(items.map((i) => i.category).filter(Boolean)));
    return present.sort((a, b) => {
      const ai = FOOD_CATEGORIES.indexOf(a);
      const bi = FOOD_CATEGORIES.indexOf(b);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      return a.localeCompare(b);
    });
  }, [items]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((item) => {
      if (activeCategory !== 'All' && item.category !== activeCategory) return false;
      if (showFilter === 'useSoon' && !isUseSoon(effectiveDate(item))) return false;
      if (q && !item.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [items, search, activeCategory, showFilter]);

  // Shared row order for every view — Use Soon, category sections, and the
  // flat filtered list all read off this one comparator, so the sort menu
  // means the same thing wherever items are shown. "Category" isn't a row
  // order at all (it only decides whether cards split into sections, below),
  // so it falls back to quantity ascending — feature default: least first.
  const compareRows = useMemo(() => {
    return (a: PantryItem, b: PantryItem) => {
      switch (sortMode) {
        case 'expiry': {
          // No date sorts last — an undated tin isn't urgent, it's just unknown.
          // Real dates and Panzi estimates sort on the same timeline (Phase 2
          // §6) rather than in separate sections.
          const ad = getDaysLeft(effectiveDate(a));
          const bd = getDaysLeft(effectiveDate(b));
          if (ad === null && bd === null) return a.name.localeCompare(b.name);
          if (ad === null) return 1;
          if (bd === null) return -1;
          return ad - bd;
        }
        case 'recent':
          return (b.addedAt ?? 0) - (a.addedAt ?? 0);
        case 'oldest':
          return (a.addedAt ?? 0) - (b.addedAt ?? 0);
        case 'qtyDesc':
          return compareQuantity(a, b, false);
        case 'qtyAsc':
        case 'category':
        default:
          return compareQuantity(a, b, true);
      }
    };
  }, [sortMode]);

  const useSoonItems = useMemo(
    () =>
      visible
        .filter((i) => isUseSoon(effectiveDate(i)))
        .sort(compareRows),
    [visible, compareRows]
  );

  // Category cards only in the default view; otherwise one flat card. Note
  // this doesn't consider `selecting` — entering selection must not re-group
  // the list, or every row moves the moment you long-press one.
  const grouped = activeCategory === 'All' && sortMode === 'category';

  const flatItems = useMemo(() => [...visible].sort(compareRows), [visible, compareRows]);

  const sections = useMemo(() => {
    if (!grouped) return [];
    return categories
      .map((category) => ({
        category,
        rows: visible.filter((i) => i.category === category).sort(compareRows),
      }))
      .filter((s) => s.rows.length > 0);
  }, [grouped, categories, visible, compareRows]);

  function enterSelection(item: PantryItem) {
    setOpenSwipeId(null);
    setSelecting(true);
    setSelected([item.id]);
    reportSelection.current(true);
  }

  function toggleSelected(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function exitSelection() {
    setSelecting(false);
    setSelected([]);
    reportSelection.current(false);
  }

  function selectAll() {
    setSelected(visible.map((i) => i.id));
  }

  async function removeItems(ids: string[], verb: string) {
    try {
      await Promise.all(ids.map((id) => deletePantryItem(id)));
    } catch (err: any) {
      Alert.alert(`Could not ${verb}`, err.message);
    }
  }

  function confirmRemove(ids: string[], mode: 'delete' | 'useUp') {
    const count = ids.length;
    const what = count === 1 ? 'this item' : `${count} items`;
    Alert.alert(
      mode === 'useUp' ? 'Mark as used up?' : 'Delete?',
      mode === 'useUp'
        ? `Take ${what} off your shelves.`
        : `Remove ${what} from your pantry.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: mode === 'useUp' ? 'Use up' : 'Delete',
          style: 'destructive',
          onPress: async () => {
            await removeItems(ids, mode === 'useUp' ? 'use those up' : 'delete those');
            setOpenSwipeId(null);
            exitSelection();
          },
        },
      ]
    );
  }

  async function applyMove(location: string) {
    const ids = movingIds ?? [];
    setMovingIds(null);
    try {
      await Promise.all(ids.map((id) => movePantryItem(id, location)));
    } catch (err: any) {
      Alert.alert('Could not move those', err.message);
    }
    setOpenSwipeId(null);
    exitSelection();
  }

  async function applyEdit(changes: Partial<NewPantryItem>) {
    const id = editingId;
    // Closed first: Firestore applies the write locally before the server sees
    // it, so the row behind the sheet has already changed by the time the sheet
    // is gone. Waiting for the round-trip would leave it sitting open over a
    // list that already agrees with it.
    setEditingId(null);
    if (!id || Object.keys(changes).length === 0) return;

    // Only a rename can introduce a new diet/allergy conflict — every other
    // field on this sheet (quantity, date, location...) can't turn a safe item
    // into an unsafe one. Checked against the new name, not the old, since
    // that's the one about to be saved.
    if (typeof changes.name === 'string') {
      const conflicts = checkItemConflicts(changes.name, profile.dietary, profile.allergies);
      if (conflicts.length > 0) {
        setPendingEdit({ id, changes, conflicts });
        return;
      }
    }

    await saveEdit(id, changes);
  }

  async function saveEdit(id: string, changes: Partial<NewPantryItem>) {
    try {
      await updatePantryItem(id, changes);
    } catch (err: any) {
      Alert.alert('Could not save that', err.message);
    }
  }

  // In the order the scan wrote them, not the pantry's expiry order — the user
  // is looking for the list they just approved, and reshuffling it here would
  // make them check it a second time.
  const justAdded = useMemo(() => {
    if (!justAddedIds?.length) return [];
    const byId = new Map(items.map((i) => [i.id, i]));
    return justAddedIds.map((id) => byId.get(id)).filter((i): i is PantryItem => !!i);
  }, [items, justAddedIds]);

  // Looked up fresh on every render rather than held in state, so an edit
  // landing from the listener (or from another device) is reflected in the open
  // sheet instead of it editing a stale copy. Resolves to undefined if the row
  // is deleted underneath it, which closes the sheet on its own.
  const editingItem = editingId ? (items.find((i) => i.id === editingId) ?? null) : null;

  const totalUseSoon = items.filter((i) => isUseSoon(effectiveDate(i))).length;
  const filtersOn = showFilter !== 'all' || sortMode !== 'category';

  if (!uid) {
    return (
      <View style={[styles.container, styles.centerFill]}>
        <Text style={styles.signedOut}>You need to be signed in to see your pantry.</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={[styles.container, styles.centerFill]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  // Empty state — search, chips and sort are all hidden. Nothing to search yet.
  if (items.length === 0) {
    return (
      <View style={styles.container}>
        <View style={[styles.titleBlock, { paddingTop: insets.top + space.md }]}>
          <Text style={styles.title}>My pantry</Text>
          <Text style={styles.subtitle}>Nothing in here yet</Text>
        </View>

        <View style={styles.emptyBody}>
          <View style={styles.emptyTile}>
            <Ionicons name="bag-handle-outline" size={40} color={colors.primaryDark} />
          </View>
          <Text style={styles.emptyTitle}>Let's fill your shelves</Text>
          <Text style={styles.emptyText}>
            Scan a receipt and Panzi sorts everything into categories for you. Or add a few things
            by hand.
          </Text>
          <TouchableOpacity style={styles.emptyPrimary} onPress={onScan}>
            <Text style={styles.emptyPrimaryText}>Scan item</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.emptySecondary} onPress={onAddByHand}>
            <Text style={styles.emptySecondaryText}>Add item</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const renderRow = (item: PantryItem, warm: boolean, showDivider: boolean) => (
    <ItemRow
      key={item.id}
      item={item}
      warm={warm}
      showDivider={showDivider}
      selecting={selecting}
      selected={selected.includes(item.id)}
      open={openSwipeId === item.id}
      onOpen={() => setOpenSwipeId(item.id)}
      onClose={() => setOpenSwipeId((cur) => (cur === item.id ? null : cur))}
      onLongPress={() => enterSelection(item)}
      onToggle={() => toggleSelected(item.id)}
      onMove={() => setMovingIds([item.id])}
      onDelete={() => confirmRemove([item.id], 'delete')}
      onEdit={() => setEditingId(item.id)}
    />
  );

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          {
            // Spent here rather than by a SafeAreaView above this screen —
            // see FULL_BLEED in navigation/MainTabs — so styles.container's
            // own background runs all the way to the top of the screen
            // instead of stopping at a separate padded strip.
            paddingTop: insets.top + space.md,
            paddingBottom: SCAN_BUTTON_LIFT + TAB_BAR_CONTENT_HEIGHT + Math.max(insets.bottom, 10) + space.lg,
          },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        {...collapseOnScroll}
      >
        {/* The header stays put in selection mode — only the subtitle and the
            two round buttons change, both of which keep the row's height, so
            nothing below moves. */}
        <View style={styles.titleRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>List</Text>
            <Text style={styles.subtitle}>
              {selecting ? (
                `${selected.length} selected`
              ) : (
                <>
                  {items.length} item{items.length === 1 ? '' : 's'}
                  {totalUseSoon > 0 ? ` · ${totalUseSoon} to use soon` : ''}
                </>
              )}
            </Text>
          </View>
          {selecting ? (
            <>
              <TouchableOpacity style={styles.headerTextButton} onPress={selectAll}>
                <Text style={styles.headerTextButtonLabel}>Select all</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.headerButton} onPress={exitSelection}>
                <Ionicons name="close" size={20} color={colors.primaryDark} />
              </TouchableOpacity>
            </>
          ) : (
            <>
              <TouchableOpacity style={styles.headerButton} onPress={onAddByHand}>
                <Ionicons name="add" size={20} color={colors.primaryDark} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.headerButton} onPress={() => setSheetOpen(true)}>
                <Ionicons name="options-outline" size={19} color={colors.primaryDark} />
                {filtersOn && <View style={styles.headerButtonDot} />}
              </TouchableOpacity>
            </>
          )}
        </View>

        <View style={styles.searchWrap}>
          <View style={styles.searchField}>
            <Ionicons name="search-outline" size={15} color={colors.mutedLight} />
            <TextInput
              style={styles.searchInput}
              value={search}
              onChangeText={setSearch}
              placeholder="Search your pantry"
              placeholderTextColor={colors.mutedLight}
              returnKeyType="search"
            />
          </View>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
          style={styles.chipScroller}
        >
          {['All', ...categories].map((chip) => {
            const isActive = activeCategory === chip;
            return (
              <TouchableOpacity
                key={chip}
                style={[styles.chip, isActive && styles.chipActive]}
                onPress={() => setActiveCategory(chip)}
              >
                <Text style={[styles.chipText, isActive && styles.chipTextActive]}>{chip}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {justAdded.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionLabel, styles.sectionLabelFresh]}>JUST ADDED</Text>
              <Text style={styles.sectionCount}>{justAdded.length}</Text>
            </View>
            <View style={styles.justAddedRows}>
              {justAdded.map((item) => (
                <JustAddedRow key={item.id} item={item} onEdit={() => setEditingId(item.id)} />
              ))}
            </View>
          </View>
        )}

        {grouped && useSoonItems.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionLabel, styles.sectionLabelWarm]}>USE SOON</Text>
              <Text style={[styles.sectionCount, styles.sectionCountWarm]}>
                {useSoonItems.length}
              </Text>
            </View>
            <View style={[styles.card, styles.cardWarm]}>
              {(showAllUseSoon ? useSoonItems : useSoonItems.slice(0, USE_SOON_PREVIEW)).map(
                (item, i, arr) =>
                  renderRow(item, true, i < arr.length - 1 || useSoonItems.length > arr.length)
              )}
              {useSoonItems.length > USE_SOON_PREVIEW && (
                <TouchableOpacity
                  style={styles.seeAll}
                  onPress={() => setShowAllUseSoon((v) => !v)}
                >
                  <Text style={styles.seeAllText}>
                    {showAllUseSoon ? 'Show fewer' : `See all ${useSoonItems.length}`}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}

        {grouped ? (
          sections.map((section) => (
            <View key={section.category} style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionLabel}>{section.category.toUpperCase()}</Text>
                <Text style={styles.sectionCount}>{section.rows.length}</Text>
              </View>
              <View style={styles.card}>
                {section.rows.map((item, i) =>
                  renderRow(item, false, i < section.rows.length - 1)
                )}
              </View>
            </View>
          ))
        ) : (
          <View style={styles.section}>
            {flatItems.length > 0 && (
              <View style={styles.card}>
                {flatItems.map((item, i) => renderRow(item, false, i < flatItems.length - 1))}
              </View>
            )}
          </View>
        )}

        {visible.length === 0 && <Text style={styles.noResults}>Nothing matches that.</Text>}
      </ScrollView>

      {selecting && (
        // Replaces the tab bar (MainTabs hides it) rather than sitting over it,
        // matching its safe-area padding so the list doesn't reflow.
        <View style={[styles.actionBarWrap, { paddingBottom: Math.max(insets.bottom, 10) }]}>
          <View style={styles.actionBar}>
            <TouchableOpacity
              style={[styles.actionButton, styles.actionMove]}
              disabled={selected.length === 0}
              onPress={() => setMovingIds(selected)}
            >
              <Text style={[styles.actionText, styles.actionMoveText]}>Move</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionButton, styles.actionUseUp]}
              disabled={selected.length === 0}
              onPress={() => confirmRemove(selected, 'useUp')}
            >
              <Text style={[styles.actionText, styles.actionUseUpText]}>Use up</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionButton, styles.actionDelete]}
              disabled={selected.length === 0}
              onPress={() => confirmRemove(selected, 'delete')}
            >
              <Text style={[styles.actionText, styles.actionDeleteText]}>Delete</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Sort + filter */}
      <Modal
        visible={sheetOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setSheetOpen(false)}
      >
        <Pressable style={styles.menuBackdrop} onPress={() => setSheetOpen(false)}>
          <Pressable style={styles.menu}>
            <Text style={styles.menuHeading}>Sort by</Text>
            {(Object.keys(SORT_LABELS) as SortMode[]).map((mode) => (
              <MenuRow
                key={mode}
                label={SORT_LABELS[mode]}
                active={sortMode === mode}
                onPress={() => setSortMode(mode)}
              />
            ))}
            <View style={styles.menuRule} />
            <Text style={styles.menuHeading}>Show</Text>
            {(Object.keys(SHOW_LABELS) as ShowFilter[]).map((mode) => (
              <MenuRow
                key={mode}
                label={SHOW_LABELS[mode]}
                active={showFilter === mode}
                onPress={() => setShowFilter(mode)}
              />
            ))}
            <TouchableOpacity style={styles.menuDone} onPress={() => setSheetOpen(false)}>
              <Text style={styles.menuDoneText}>Done</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Move — storage location picker */}
      <Modal
        visible={movingIds !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setMovingIds(null)}
      >
        <Pressable style={styles.menuBackdrop} onPress={() => setMovingIds(null)}>
          <Pressable style={[styles.menu, styles.menuCentered]}>
            <Text style={styles.menuHeading}>Move to</Text>
            {STORAGE_LOCATIONS.map((loc) => (
              <MenuRow key={loc} label={loc} active={false} onPress={() => applyMove(loc)} />
            ))}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Edit — every field of one item, opened by tapping its row */}
      <EditItemSheet
        item={editingItem}
        onClose={() => setEditingId(null)}
        onSave={applyEdit}
        onDelete={() => {
          const id = editingId;
          setEditingId(null);
          if (id) confirmRemove([id], 'delete');
        }}
      />

      <ConflictAlertModal
        visible={pendingEdit !== null}
        items={
          pendingEdit
            ? [
                {
                  name: typeof pendingEdit.changes.name === 'string' ? pendingEdit.changes.name : '',
                  conflicts: pendingEdit.conflicts,
                },
              ]
            : []
        }
        onCancel={() => setPendingEdit(null)}
        onAddAnyway={() => {
          const edit = pendingEdit;
          setPendingEdit(null);
          if (edit) void saveEdit(edit.id, edit.changes);
        }}
      />
    </View>
  );
}

function MenuRow({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <TouchableOpacity style={styles.menuItem} onPress={onPress}>
      <Text style={[styles.menuItemText, active && styles.menuItemTextActive]}>{label}</Text>
      {active && <Ionicons name="checkmark" size={16} color={colors.primaryDark} />}
    </TouchableOpacity>
  );
}

/**
 * A row from the scan that just landed.
 *
 * Deliberately not an ItemRow. It carries no swipe actions and no selection —
 * this is a receipt for work the user has just done, and the subtitle says
 * where each date came from ("Fridge · from label", "Counter · very ripe") so
 * the provenance the review page showed survives the trip into the pantry. An
 * estimate that arrived here looking like a printed date would undo the one
 * promise the whole scanner is built on.
 *
 * It does tap through to the edit sheet, though. This block is on screen at the
 * exact moment a wrong year or a misread name is easiest to spot, and sending
 * the user hunting for the same row further down the list to fix it would be
 * perverse.
 */
function JustAddedRow({ item, onEdit }: { item: PantryItem; onEdit: () => void }) {
  const styles = useStyles();
  const date = effectiveDate(item);
  const days = getDaysLeft(date);
  const urgent = item.ripeness ? isUrgentStage(item.ripeness) : days !== null && days <= 3;

  // Kept in step with basis, Phase 2's own finer-grained provenance, rather
  // than re-deriving from dateSource by hand here — this used to be a
  // second, slightly divergent copy of what provenanceChip already decides
  // for the review card; reading basis first closes that gap for the one
  // case (a Panzi estimate) provenanceChip's own dateSource check can't see.
  const source =
    item.basis === 'estimated'
      ? 'estimated by Panzi'
      : item.ripeness
        ? RIPENESS_LABELS[item.ripeness].toLowerCase()
        : item.basis === 'printed'
          ? 'from label'
          : item.basis === 'rough'
            ? 'a rough date'
            : item.basis === 'manual'
              ? 'you set this'
              : item.dateSource === 'label'
                ? 'from label'
                : item.dateSource === 'estimated'
                  ? 'estimated'
                  : item.dateSource === 'user'
                    ? 'you set this'
                    : null;

  return (
    <TouchableOpacity style={styles.justAddedRow} onPress={onEdit} activeOpacity={0.7}>
      <View style={styles.justAddedBody}>
        <Text style={styles.justAddedName} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={styles.justAddedMeta} numberOfLines={1}>
          {[item.location, source].filter(Boolean).join(' · ')}
        </Text>
      </View>
      <View style={[styles.justAddedChip, urgent && styles.justAddedChipUrgent]}>
        <Text style={[styles.justAddedChipText, urgent && styles.justAddedChipTextUrgent]}>
          {formatExpiry(date)}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

// One inventory row: name on top, location/expiry on a quiet line beneath,
// quantity in a fixed pill on the right — quantity gets its own column because
// it's what you scan for while cooking.
//
// Swiping left doesn't slide the row away, it shrinks the content pane and
// reveals Move + Delete at full row height. The name stays visible throughout,
// which doubles as a hint that the row is still there.
//
// Tapping opens the edit sheet. Move and Delete stay on the swipe because they
// are the two things worth doing without opening anything — everything else
// about an item is a field, and fields live in the sheet.
function ItemRow({
  item,
  warm,
  showDivider,
  selecting,
  selected,
  open,
  onOpen,
  onClose,
  onLongPress,
  onToggle,
  onMove,
  onDelete,
  onEdit,
}: {
  item: PantryItem;
  warm: boolean;
  showDivider: boolean;
  selecting: boolean;
  selected: boolean;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onLongPress: () => void;
  onToggle: () => void;
  onMove: () => void;
  onDelete: () => void;
  onEdit: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const date = effectiveDate(item);
  const expiring = isUseSoon(date);
  // "Estimated ·" for a Panzi guess, "Expires ·"/"Best before ·" for a real
  // date — Phase 2 §6's own rule, so a wet-market chicken's guessed date
  // never reads as quietly as certain as a carton's printed one.
  const dateClause = `${datePrefix(item)} · ${formatExpiry(date)}`;
  const meta = item.location ? `${item.location} · ${dateClause}` : dateClause;

  const [rowWidth, setRowWidth] = useState(0);
  const shrink = useRef(new Animated.Value(0)).current;
  // Mirrors `shrink`'s current value. The release handler snaps based on where
  // the row actually sits rather than on gestureState.dx, which isn't reliable
  // once the responder is claimed mid-gesture from the capture phase — reading
  // it there decided "closed" even after a full-width drag.
  const shrinkValue = useRef(0);
  const openRef = useRef(open);
  // When a swipe ends, the platform still delivers a tap to the row underneath.
  // Without this the tap-to-close handler fired immediately after the release
  // opened the row, so it snapped shut every time.
  const releasedAt = useRef(0);

  function handleLayout(e: LayoutChangeEvent) {
    const w = Math.round(e.nativeEvent.layout.width);
    if (w !== rowWidth) setRowWidth(w);
  }

  useEffect(() => {
    openRef.current = open;
    shrinkValue.current = open ? ACTIONS_TOTAL : 0;
    Animated.timing(shrink, {
      toValue: open ? ACTIONS_TOTAL : 0,
      duration: 180,
      // Width isn't a native-drivable property.
      useNativeDriver: false,
    }).start();
  }, [open, shrink]);

  // Keep the callbacks the responder closes over pointing at the latest props.
  const onOpenRef = useRef(onOpen);
  const onCloseRef = useRef(onClose);
  onOpenRef.current = onOpen;
  onCloseRef.current = onClose;

  // Built once — the handlers read live values off refs so the responder
  // doesn't need rebuilding on every render.
  const pan = useRef(
    PanResponder.create({
      // Only claim horizontal drags, so vertical scrolling still works.
      //
      // The Capture variant is the one that matters: the row's TouchableOpacity
      // becomes the responder as soon as a finger lands on it, and once a child
      // holds the responder an ancestor can only take it back during the
      // capture phase. With just the bubbling handler the swipe never starts.
      onMoveShouldSetPanResponderCapture: (_e, g) =>
        Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onMoveShouldSetPanResponder: (_e, g) =>
        Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      // Don't hand the gesture back to the enclosing ScrollView mid-swipe.
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_e, g) => {
        const base = openRef.current ? ACTIONS_TOTAL : 0;
        const next = Math.min(ACTIONS_TOTAL, Math.max(0, base - g.dx));
        shrinkValue.current = next;
        shrink.setValue(next);
      },
      onPanResponderRelease: () => {
        releasedAt.current = Date.now();
        const shouldOpen = shrinkValue.current > ACTIONS_TOTAL / 2;
        shrinkValue.current = shouldOpen ? ACTIONS_TOTAL : 0;
        Animated.timing(shrink, {
          toValue: shouldOpen ? ACTIONS_TOTAL : 0,
          duration: 180,
          useNativeDriver: false,
        }).start();
        if (shouldOpen) onOpenRef.current();
        else onCloseRef.current();
      },
    })
  ).current;

  const body = (
    <>
      <View style={styles.rowMain}>
        <Text style={styles.rowName} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={[styles.rowMeta, expiring && styles.rowMetaExpiring]} numberOfLines={1}>
          {meta}
        </Text>
      </View>
      <View style={[styles.qtyPill, expiring && styles.qtyPillExpiring]}>
        <Text style={[styles.qtyText, expiring && styles.qtyTextExpiring]}>{item.quantity}</Text>
      </View>
    </>
  );

  if (selecting) {
    return (
      <View>
        <TouchableOpacity
          style={[styles.row, styles.rowSelectable, selected && styles.rowSelected]}
          onPress={onToggle}
          activeOpacity={0.8}
        >
          <View style={[styles.checkbox, selected && styles.checkboxOn]}>
            {selected && <Ionicons name="checkmark" size={14} color={colors.onAccent} />}
          </View>
          {body}
        </TouchableOpacity>
        {showDivider && <View style={[styles.divider, warm && styles.dividerWarm]} />}
      </View>
    );
  }

  return (
    <View>
      <View style={styles.swipeRow} onLayout={handleLayout}>
        <Animated.View
          style={[
            styles.swipeContent,
            warm ? styles.swipeContentWarm : null,
            rowWidth > 0
              ? {
                  width: shrink.interpolate({
                    inputRange: [0, ACTIONS_TOTAL],
                    outputRange: [rowWidth, Math.max(rowWidth - ACTIONS_TOTAL, 0)],
                    extrapolate: 'clamp',
                  }),
                }
              : // Before onLayout reports a width, full-width — not flex: 1.
                // Flexing would size this pane to the space left over by the
                // two action panes, i.e. render the row as if already swiped
                // open. That flashed Move/Delete on every mount, which is
                // every time the List tab is switched back to.
                { width: '100%' },
          ]}
          {...pan.panHandlers}
        >
          <TouchableOpacity
            style={styles.row}
            onLongPress={onLongPress}
            onPress={() => {
              if (Date.now() - releasedAt.current < 400) return;
              // A swiped-open row spends its tap closing itself — the actions
              // are showing and the user is dismissing them, not asking to edit.
              if (open) {
                onClose();
                return;
              }
              onEdit();
            }}
            activeOpacity={0.8}
          >
            {body}
          </TouchableOpacity>
        </Animated.View>

        <TouchableOpacity style={styles.moveAction} onPress={onMove}>
          <Ionicons name="file-tray-outline" size={17} color={colors.textSecondary} />
          <Text style={styles.moveActionText}>Move</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.deleteAction} onPress={onDelete}>
          <Ionicons name="trash-outline" size={17} color={colors.onAccent} />
          <Text style={styles.deleteActionText}>Delete</Text>
        </TouchableOpacity>
      </View>
      {showDivider && <View style={[styles.divider, warm && styles.dividerWarm]} />}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: {
    flex: 1,
    backgroundColor: colors.backgroundLight,
  },
  centerFill: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xxxl,
  },
  signedOut: {
    fontSize: type.body.fontSize,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  scrollContent: {
    // The real paddingBottom is computed at render time (see the ScrollView
    // JSX) and overrides this — it needs insets.bottom, which isn't
    // available in a static StyleSheet. Kept here anyway as the fallback
    // any static read of this style object sees, roughly matching the
    // render-time value on a device with no home-indicator inset.
    paddingBottom: SCAN_BUTTON_LIFT + TAB_BAR_CONTENT_HEIGHT + 10 + space.lg,
  },
  titleRow: {
    paddingHorizontal: space.xxl,
    paddingTop: space.xs2,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.sm2,
  },
  titleBlock: {
    paddingHorizontal: space.xxl,
    paddingTop: space.xs2,
  },
  title: {
    fontWeight: '800',
    fontSize: type.display.fontSize,
    lineHeight: 38,
    color: colors.primaryDarker,
  },
  subtitle: {
    fontWeight: '600',
    fontSize: type.label.fontSize,
    color: colors.textSecondary,
    marginTop: space.xs2,
  },
  headerButton: {
    width: 38,
    height: 38,
    borderRadius: 999,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Same 38px height as the round buttons it stands in for during selection,
  // so swapping them doesn't nudge the list.
  headerTextButton: {
    height: 38,
    paddingHorizontal: space.md2,
    borderRadius: 999,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTextButtonLabel: {
    fontWeight: '800',
    fontSize: type.label.fontSize,
    color: colors.primaryDark,
  },
  // Shows when a non-default sort or filter is on, so the icon isn't a black
  // box about whether anything is being hidden.
  headerButtonDot: {
    position: 'absolute',
    top: 6,
    right: 7,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.accent,
  },
  searchWrap: {
    paddingHorizontal: space.xxl,
    paddingTop: space.lg,
  },
  searchField: {
    height: 44,
    borderRadius: 16,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm2,
    paddingHorizontal: space.md2,
  },
  searchInput: {
    flex: 1,
    fontWeight: '600',
    fontSize: type.bodySmall.fontSize,
    color: colors.primaryDarker,
    padding: space.none,
  },
  chipScroller: {
    marginTop: space.md2,
    flexGrow: 0,
  },
  chipRow: {
    paddingHorizontal: space.xxl,
    gap: space.sm,
  },
  chip: {
    paddingVertical: space.sm2,
    paddingHorizontal: space.lg,
    borderRadius: 999,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
  },
  chipActive: {
    backgroundColor: colors.inkFill,
    // Matches the fill. It used to be primaryDarker, which reads as a dark
    // green edge in light mode but inverts to a near-white ring in dark.
    borderColor: colors.inkFill,
  },
  chipText: {
    fontWeight: '700',
    fontSize: type.label.fontSize,
    color: colors.textDark,
  },
  chipTextActive: {
    fontWeight: '800',
    // On a saturated fill, so it does NOT follow the theme — see onAccent.
    color: colors.onAccent,
  },
  section: {
    paddingHorizontal: space.xxl,
    paddingTop: space.xl2,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: space.sm2,
  },
  sectionLabel: {
    fontWeight: '800',
    fontSize: type.micro.fontSize,
    letterSpacing: 1.54,
    color: colors.tabInactive,
  },
  sectionLabelWarm: {
    color: colors.accentDeep,
  },
  sectionCount: {
    fontWeight: '700',
    fontSize: type.micro.fontSize,
    color: colors.mutedLight,
  },
  sectionCountWarm: {
    color: colors.accentDeep,
    opacity: 0.7,
  },
  sectionLabelFresh: {
    color: colors.primaryDark,
  },
  justAddedRows: {
    gap: space.sm2,
  },
  justAddedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: colors.card,
    // The green edge is what marks the batch out from everything that was
    // already on the shelves, and it goes away with the Undo toast.
    borderWidth: 1.5,
    borderColor: colors.primaryBright,
    borderRadius: 18,
    paddingVertical: space.md2,
    paddingHorizontal: space.md2,
  },
  justAddedBody: {
    flex: 1,
    minWidth: 0,
  },
  justAddedName: {
    fontWeight: '700',
    fontSize: type.bodySmall.fontSize,
    lineHeight: 18,
    color: colors.primaryDarker,
    marginBottom: space.xs,
  },
  justAddedMeta: {
    fontWeight: '600',
    fontSize: type.caption.fontSize,
    lineHeight: 14,
    color: colors.textSecondary,
  },
  justAddedChip: {
    paddingVertical: space.xs2,
    paddingHorizontal: space.sm2,
    borderRadius: 8,
    backgroundColor: colors.primaryLighter,
    flexShrink: 0,
  },
  justAddedChipUrgent: {
    backgroundColor: colors.accentSoft,
  },
  justAddedChipText: {
    fontWeight: '800',
    fontSize: type.micro.fontSize,
    lineHeight: 13,
    color: colors.primaryDark,
  },
  justAddedChipTextUrgent: {
    color: colors.rust,
  },
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
    borderRadius: 20,
    overflow: 'hidden',
  },
  cardWarm: {
    backgroundColor: colors.warmCard,
    borderColor: colors.warmBorder,
  },
  swipeRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    overflow: 'hidden',
  },
  swipeContent: {
    backgroundColor: colors.card,
  },
  swipeContentWarm: {
    backgroundColor: colors.warmCard,
  },
  moveAction: {
    width: ACTION_WIDTH,
    backgroundColor: colors.backgroundAlt,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs2,
  },
  moveActionText: {
    fontWeight: '800',
    fontSize: type.micro.fontSize,
    color: colors.textSecondary,
  },
  deleteAction: {
    width: ACTION_WIDTH,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs2,
  },
  deleteActionText: {
    fontWeight: '800',
    fontSize: type.micro.fontSize,
    color: colors.onAccent,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md2,
    paddingHorizontal: space.lg,
  },
  rowSelectable: {
    gap: space.md2,
  },
  rowSelected: {
    backgroundColor: colors.primaryWash,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: colors.checkboxRing,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: {
    backgroundColor: colors.primaryDark,
    borderColor: colors.primaryDark,
  },
  rowMain: {
    flex: 1,
    minWidth: 0,
  },
  rowName: {
    fontWeight: '700',
    fontSize: type.body.fontSize,
    color: colors.primaryDarker,
    marginBottom: space.xs2,
  },
  rowMeta: {
    fontWeight: '600',
    fontSize: type.caption.fontSize,
    color: colors.textSecondary,
  },
  rowMetaExpiring: {
    fontWeight: '700',
    color: colors.accentDeep,
  },
  qtyPill: {
    paddingVertical: space.xs2,
    paddingHorizontal: space.sm2,
    borderRadius: 999,
    backgroundColor: colors.backgroundAlt,
  },
  qtyPillExpiring: {
    backgroundColor: colors.accentSoft,
  },
  qtyText: {
    fontWeight: '800',
    fontSize: type.caption.fontSize,
    color: colors.textDark,
  },
  qtyTextExpiring: {
    color: colors.accentDeep,
  },
  // Stops short of the left edge so the rows read as one card, not a table.
  divider: {
    height: 1,
    marginLeft: space.lg,
    backgroundColor: colors.divider,
  },
  dividerWarm: {
    backgroundColor: colors.warmDivider,
  },
  seeAll: {
    paddingVertical: space.md2,
    paddingHorizontal: space.lg,
  },
  seeAllText: {
    fontWeight: '800',
    fontSize: type.label.fontSize,
    color: colors.accentDeep,
  },
  noResults: {
    paddingHorizontal: space.xxl,
    paddingTop: space.xl2,
    fontWeight: '700',
    fontSize: type.label.fontSize,
    color: colors.tabInactive,
    textAlign: 'center',
  },
  actionBarWrap: {
    paddingHorizontal: space.md2,
  },
  actionBar: {
    flexDirection: 'row',
    gap: space.sm2,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.borderWarm,
    borderRadius: 26,
    padding: space.md,
    shadowColor: colors.shadow,
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  actionButton: {
    flex: 1,
    height: 46,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionMove: {
    backgroundColor: colors.backgroundAlt,
  },
  actionUseUp: {
    backgroundColor: colors.primaryLighter,
  },
  actionDelete: {
    backgroundColor: colors.accentSoft,
  },
  actionText: {
    fontWeight: '800',
    fontSize: type.bodySmall.fontSize,
  },
  actionMoveText: {
    color: colors.textDark,
  },
  actionUseUpText: {
    color: colors.primaryActive,
  },
  actionDeleteText: {
    color: colors.accentDeep,
  },
  menuBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(35,74,27,0.25)',
    alignItems: 'flex-end',
    justifyContent: 'flex-start',
    paddingTop: 110,
    paddingHorizontal: space.xxl,
  },
  menu: {
    minWidth: 210,
    backgroundColor: colors.card,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.borderWarm,
    paddingVertical: space.sm,
    shadowColor: colors.shadow,
    shadowOpacity: 0.2,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  menuCentered: {
    alignSelf: 'center',
    marginTop: 80,
  },
  menuHeading: {
    fontWeight: '800',
    fontSize: type.micro.fontSize,
    letterSpacing: 1.2,
    color: colors.tabInactive,
    paddingHorizontal: space.lg,
    paddingTop: space.xs2,
    paddingBottom: space.xs,
  },
  menuRule: {
    height: 1,
    backgroundColor: colors.divider,
    marginVertical: space.xs2,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
  },
  menuItemText: {
    fontWeight: '700',
    fontSize: type.bodySmall.fontSize,
    color: colors.textDark,
  },
  menuItemTextActive: {
    color: colors.primaryDark,
    fontWeight: '800',
  },
  menuDone: {
    marginTop: space.xs,
    marginHorizontal: space.md,
    marginBottom: space.xs,
    height: 42,
    borderRadius: 14,
    backgroundColor: colors.primaryLighter,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuDoneText: {
    fontWeight: '800',
    fontSize: type.bodySmall.fontSize,
    color: colors.primaryActive,
  },
  emptyBody: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xxxl,
    paddingBottom: 90,
  },
  emptyTile: {
    width: 96,
    height: 96,
    borderRadius: 32,
    backgroundColor: colors.primaryLighter,
    borderWidth: 1,
    borderColor: colors.primaryLine,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.xl2,
  },
  emptyTitle: {
    fontWeight: '800',
    fontSize: type.headline.fontSize,
    lineHeight: 29,
    color: colors.primaryDarker,
    marginBottom: space.sm2,
    textAlign: 'center',
  },
  emptyText: {
    fontWeight: '600',
    fontSize: type.bodySmall.fontSize,
    lineHeight: 21,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: space.xxl2,
  },
  emptyPrimary: {
    width: '100%',
    height: 52,
    borderRadius: 18,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.md,
  },
  emptyPrimaryText: {
    fontWeight: '800',
    fontSize: type.bodyLarge.fontSize,
    color: colors.onAccent,
  },
  emptySecondary: {
    width: '100%',
    height: 52,
    borderRadius: 18,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptySecondaryText: {
    fontWeight: '800',
    fontSize: type.bodyLarge.fontSize,
    color: colors.primaryDark,
  },
}));