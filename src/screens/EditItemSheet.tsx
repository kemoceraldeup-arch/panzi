// src/screens/EditItemSheet.tsx
//
// Editing an item that is already on the shelves.
//
// The scanner's review page is the only place an item could be corrected until
// now, and it closes for good once the scan is approved. That left every later
// correction — a date typed with the wrong year, a name the model got close but
// not right, a jar that moved from the counter to the fridge — with nowhere to
// go except delete and re-add, which loses the item's provenance and its place
// in the list.
//
// So this is deliberately the same set of fields as the review card, in the
// same order, drawn with the same DateField and the same provenance chip. An
// item should not look or behave like a different kind of thing depending on
// which side of "approve" it is on.
//
// A sheet rather than an expand-in-place card (which is what the review page
// does): rows here sit inside grouped category cards and a "use soon" card the
// user scrolled to, and growing one row mid-list would push everything else
// out from under their thumb.

import React, { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Text from '../components/Text';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DateField from './scan/DateField';
import { pickItemPhoto } from './scan/pickItemPhoto';
import { DateChip, Eyebrow, HIT_SLOP, ItemThumb } from './scan/atoms';
import { provenanceChip } from '../services/scan';
import {
  FOOD_CATEGORIES,
  STORAGE_LOCATIONS,
  NewPantryItem,
  PantryItem,
} from '../services/pantry';
import { makeStyles } from '../theme/makeStyles';
import { useColors } from '../theme/ThemeProvider';
import { space } from '../theme/spacing';
import { type } from '../theme/typography';

/** The editable subset. Everything else on the item is carried through untouched. */
type Draft = {
  name: string;
  quantity: string;
  category: string;
  location: string;
  expiryDate: string | null;
  dateSource: PantryItem['dateSource'];
  photoUri: string | null;
};

const FALLBACK_LOCATION = 'Cupboard';

function toDraft(item: PantryItem): Draft {
  return {
    name: item.name,
    quantity: item.quantity,
    category: item.category,
    location: item.location ?? FALLBACK_LOCATION,
    expiryDate: item.expiryDate,
    dateSource: item.dateSource,
    photoUri: item.photoUri,
  };
}

type Props = {
  /** The item being edited, or null when the sheet is closed. */
  item: PantryItem | null;
  onClose: () => void;
  /** Only the fields that actually changed, so nothing else is rewritten. */
  onSave: (changes: Partial<NewPantryItem>) => void;
  onDelete: () => void;
};

export default function EditItemSheet({ item, onClose, onSave, onDelete }: Props) {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();

  if (!item) return null;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      {/* Keyed remount rather than an effect syncing props into state: opening a
          different row has to start from that row's values, and a sheet that
          sometimes opened holding the previous item's half-typed name would be
          worse than no editing at all. */}
      <EditSheetBody
        key={item.id}
        item={item}
        insetBottom={insets.bottom}
        onClose={onClose}
        onSave={onSave}
        onDelete={onDelete}
      />
    </Modal>
  );
}

function EditSheetBody({
  item,
  insetBottom,
  onClose,
  onSave,
  onDelete,
}: {
  item: PantryItem;
  insetBottom: number;
  onClose: () => void;
  onSave: (changes: Partial<NewPantryItem>) => void;
  onDelete: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const [draft, setDraft] = useState<Draft>(() => toDraft(item));

  function patch(next: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...next }));
  }

  // The chip reads off the draft, not the saved item, so retyping a date
  // switches it to "you set this" while the sheet is still open — the same
  // feedback the review card gives.
  const chip = provenanceChip({
    expiryDate: draft.expiryDate,
    dateSource: draft.dateSource,
    ripeness: item.ripeness,
  });

  // Only what changed. Sending the whole draft would rewrite fields the user
  // never touched, and on an item added before locations or provenance existed
  // that turns absent fields into asserted ones.
  const changes = useMemo<Partial<NewPantryItem>>(() => {
    const out: Partial<NewPantryItem> = {};
    const name = draft.name.trim();
    const quantity = draft.quantity.trim();
    if (name !== item.name) out.name = name;
    if (quantity !== item.quantity) out.quantity = quantity;
    if (draft.category !== item.category) out.category = draft.category;
    if (draft.location !== (item.location ?? FALLBACK_LOCATION)) out.location = draft.location;
    if (draft.expiryDate !== item.expiryDate) {
      out.expiryDate = draft.expiryDate;
      out.dateSource = draft.dateSource;
    }
    // A picture the user attaches here belongs to the item, and takes
    // precedence over any crop of the scan it came from — so the crop is left
    // exactly where it is rather than being cleared. ItemThumb already prefers
    // one over the other; deleting the fallback would only cost the item its
    // picture if this one is later removed.
    if (draft.photoUri !== item.photoUri) out.photoUri = draft.photoUri;
    return out;
  }, [draft, item]);

  const nameEmpty = draft.name.trim().length === 0;
  const dirty = Object.keys(changes).length > 0;

  return (
    <View style={styles.backdrop}>
      {/* Tapping outside closes. Any edits are dropped — Save is the only thing
          that writes, which is what makes the sheet safe to open just to look. */}
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.sheetWrap}
      >
        <View style={[styles.sheet, { paddingBottom: space.lg + insetBottom }]}>
          <View style={styles.grabber} />

          <View style={styles.header}>
            <TouchableOpacity onPress={onClose} hitSlop={HIT_SLOP} activeOpacity={0.7}>
              <Text style={styles.cancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.heading}>Edit item</Text>
            <TouchableOpacity
              onPress={() => onSave(changes)}
              hitSlop={HIT_SLOP}
              activeOpacity={0.7}
              // Nothing to write, or nothing to call it — either way Save would
              // be a lie, so it greys out rather than silently doing nothing.
              disabled={!dirty || nameEmpty}
            >
              <Text style={[styles.save, (!dirty || nameEmpty) && styles.saveOff]}>Save</Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            keyboardShouldPersistTaps="handled"
          >
            <Eyebrow style={styles.fieldLabel}>Name</Eyebrow>
            <View style={styles.nameRow}>
              {/* Tappable: hand-added items have no capture to crop, and this is
                  the only place they can be given a picture after the fact. */}
              <ItemThumb
                size={48}
                photo={item.scanPhoto}
                box={item.box}
                ownPhotoUri={draft.photoUri}
                onPressAdd={async () => {
                  const picked = await pickItemPhoto();
                  if (picked) patch({ photoUri: picked.uri });
                }}
              />
              <TextInput
                style={[styles.input, styles.nameInput]}
                value={draft.name}
                onChangeText={(name) => patch({ name })}
                placeholder="What is it?"
                placeholderTextColor={colors.mutedLight}
                selectionColor={colors.primaryDark}
                autoCapitalize="sentences"
              />
            </View>
            {nameEmpty && <Text style={styles.error}>An item needs a name.</Text>}

            <View style={styles.fieldLabelRow}>
              <Eyebrow>Use by</Eyebrow>
              <DateChip chip={chip} />
            </View>
            <DateField
              value={draft.expiryDate}
              onChange={(iso) =>
                // Same rule as the review card: a date the user typed is neither
                // printed nor guessed at and gets its own provenance, and
                // clearing the field clears the provenance with it so a source
                // can never outlive the date it described.
                patch({ expiryDate: iso, dateSource: iso ? 'user' : null })
              }
            />

            <Eyebrow style={styles.fieldLabel}>How many</Eyebrow>
            <TextInput
              style={styles.input}
              value={draft.quantity}
              onChangeText={(quantity) => patch({ quantity })}
              placeholder="1"
              placeholderTextColor={colors.mutedLight}
              selectionColor={colors.primaryDark}
            />

            <Eyebrow style={styles.fieldLabel}>Store in</Eyebrow>
            <View style={styles.chipRow}>
              {STORAGE_LOCATIONS.map((location) => (
                <Chip
                  key={location}
                  label={location}
                  selected={draft.location === location}
                  onPress={() => patch({ location })}
                />
              ))}
            </View>

            <Eyebrow style={styles.fieldLabel}>Category</Eyebrow>
            <View style={styles.chipRow}>
              {FOOD_CATEGORIES.map((category) => (
                <Chip
                  key={category}
                  label={category}
                  selected={draft.category === category}
                  onPress={() => patch({ category })}
                />
              ))}
            </View>

            <TouchableOpacity style={styles.delete} onPress={onDelete} activeOpacity={0.7}>
              <Ionicons name="trash-outline" size={16} color={colors.accent} />
              <Text style={styles.deleteText}>Delete this item</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <TouchableOpacity
      style={[styles.chip, selected && styles.chipOn]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text style={[styles.chipText, selected && styles.chipTextOn]}>{label}</Text>
    </TouchableOpacity>
  );
}

const useStyles = makeStyles((colors) => ({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end',
  },
  sheetWrap: {
    // Capped so the sheet never becomes a full-screen page — the list staying
    // visible behind it is what says "this is one row, not a new screen".
    maxHeight: '88%',
  },
  sheet: {
    backgroundColor: colors.backgroundLight,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: space.xl,
    paddingTop: space.sm2,
  },
  grabber: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.backgroundAlt,
    marginBottom: space.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.xs,
  },
  heading: {
    fontWeight: '800',
    fontSize: type.bodyLarge.fontSize,
    color: colors.primaryDarker,
  },
  cancel: {
    fontWeight: '700',
    fontSize: type.body.fontSize,
    color: colors.textSecondary,
  },
  save: {
    fontWeight: '800',
    fontSize: type.body.fontSize,
    color: colors.primaryDark,
  },
  saveOff: {
    color: colors.mutedLight,
  },
  body: {
    marginTop: space.sm,
  },
  bodyContent: {
    paddingBottom: space.sm,
  },
  fieldLabel: {
    marginTop: space.lg,
    marginBottom: space.sm,
  },
  fieldLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm2,
    marginTop: space.lg,
    marginBottom: space.sm,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  nameInput: {
    flex: 1,
    minWidth: 0,
  },
  input: {
    fontFamily: 'Nunito_700Bold',
    fontSize: type.bodyLarge.fontSize,
    color: colors.primaryDarker,
    minHeight: 48,
    paddingHorizontal: space.md2,
    paddingVertical: space.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
    borderRadius: 14,
  },
  error: {
    marginTop: space.xs2,
    fontWeight: '700',
    fontSize: type.caption.fontSize,
    color: colors.accent,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  chip: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: space.md,
    borderRadius: 999,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
  },
  chipOn: {
    backgroundColor: colors.primaryLighter,
    borderColor: colors.primaryLighter,
  },
  chipText: {
    fontWeight: '700',
    fontSize: type.caption.fontSize,
    color: colors.textSecondary,
  },
  chipTextOn: {
    fontWeight: '800',
    color: colors.primaryDark,
  },
  delete: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    marginTop: space.xxl2,
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: colors.accentSoft,
  },
  deleteText: {
    fontWeight: '800',
    fontSize: type.bodySmall.fontSize,
    color: colors.accent,
  },
}));