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

import React, { useMemo, useRef, useState } from 'react';
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
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DateField from './scan/DateField';
import { DateChip, Eyebrow, MeasureControl, HIT_SLOP } from './scan/atoms';
import { provenanceChip } from '../services/scan';
import { classifyFood } from '../services/foodClass';
import { DisplayUnit, formatQuantityString, parseQuantityString } from '../services/quantity';
import { isFractionalUnit, lookupFood } from '../data/foodCatalogue';
import {
  FOOD_CATEGORIES,
  STORAGE_LOCATIONS,
  NewPantryItem,
  Nutrition,
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
  nutrition: Nutrition | null;
  // Phase 2 — unlike packageStatus/openedAt (this sheet has no control for
  // either), basis/estimatedUseBy/estimateInputs round-trip here: an item
  // reopened from the list that was left as an estimate has to stay one
  // (or be promoted to a real date) rather than silently losing the
  // distinction the moment someone opens the sheet to fix its name.
  basis: PantryItem['basis'];
  estimatedUseBy: PantryItem['estimatedUseBy'];
  estimateInputs: PantryItem['estimateInputs'];
};

const FALLBACK_LOCATION = 'Cabinet';

// Everything the chip row can select directly. A location outside this set —
// empty, or something typed in for Other — is what tells the form to show the
// free-text field and read the Other chip as selected.
const FIXED_LOCATIONS = new Set<string>(STORAGE_LOCATIONS.filter((l) => l !== 'Other'));

// Matches the server's own cap on a pantry item name, and the identical
// constant in screens/scan/ScanReviewScreen.tsx — the two name fields in the
// app have to agree on what a valid name is.
const NAME_MAX_LENGTH = 60;

function toDraft(item: PantryItem): Draft {
  return {
    name: item.name,
    quantity: item.quantity,
    category: item.category,
    location: item.location ?? FALLBACK_LOCATION,
    expiryDate: item.expiryDate,
    dateSource: item.dateSource,
    photoUri: item.photoUri,
    nutrition: item.nutrition,
    // An item saved before Phase 2 has no basis of its own. A real date with
    // no label is closest to 'manual', since it came from a person typing it
    // in the old sheet. No date AND an actual stored estimate is a genuine
    // pre-Phase-2 estimate that just never got tagged — 'estimated' is
    // earned here too. No date and no estimate either is the untouched
    // case (see ScanCandidate.expiryUnknown's own comment) — left
    // undefined rather than defaulted to 'estimated', so reopening an item
    // nobody ever gave a date decision to doesn't pre-select "I don't know"
    // out from under them.
    basis: item.basis ?? (item.expiryDate ? 'manual' : item.estimatedUseBy ? 'estimated' : undefined),
    estimatedUseBy: item.estimatedUseBy ?? null,
    estimateInputs: item.estimateInputs ?? null,
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
  const scrollRef = useRef<ScrollView>(null);
  const quantityFieldRef = useRef<View>(null);
  // Not persisted directly — expiryUnknown is DateField's own radio state,
  // re-derived here from whether the item is actually carrying an estimate
  // (basis) rather than a boolean of its own on PantryItem. Initialized
  // from the item so reopening an estimated item lands on the estimate
  // panel already showing, not silently reset to "knows a date" on every
  // open. This sheet has no packageStatus/openedAt control of its own
  // (that pair is scan-candidate-only, resolved before an item is saved,
  // per the scan review card's own USE BY control) — "I don't know" here
  // estimates from category + location alone, same as an item with no
  // known package status ever would.
  const [expiryUnknown, setExpiryUnknown] = useState(() => draft.basis === 'estimated');

  function patch(next: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...next }));
  }

  // Same fix as ScanReviewScreen's EditCard: bring the Quantity control
  // above the keyboard the moment its amount field is tapped, rather than
  // leaving it to whatever the surrounding layout does on its own.
  function handleAmountFocus() {
    const field = quantityFieldRef.current;
    const scroller = scrollRef.current;
    if (!field || !scroller) return;
    field.measureLayout(
      // @ts-expect-error — measureLayout wants a host component instance,
      // which ScrollView is at runtime despite its type only exposing
      // scrollTo/scrollToEnd.
      scroller,
      (_x: number, y: number) => {
        scroller.scrollTo({ y: Math.max(0, y - space.xl), animated: true });
      },
      () => {}
    );
  }

  // Live drag-to-dismiss: the sheet's own vertical offset, tracking the
  // finger 1:1 while dragging, rather than the plain fixed-duration slide
  // the bare Modal animation gave — that played the same close animation
  // regardless of touch, which is why a swipe read as "not responding"
  // rather than "following". Scoped to the grabber + header only (see
  // dragHandle below), not the whole sheet: the form body is a ScrollView,
  // and a drag gesture covering it too would have to arbitrate against the
  // ScrollView's own pan on every touch, which is a lot of extra failure
  // surface for a sheet whose header already gives a dedicated, discoverable
  // drag target — the same place users already expect to grab it from.
  const translateY = useSharedValue(0);
  const closing = useRef(false);

  function requestClose() {
    // onClose unmounts this component (its parent keys on item.id / renders
    // null once item is null) — guarded so a fast double-fire from both the
    // gesture's onEnd and a subsequent tap can't call it twice.
    if (closing.current) return;
    closing.current = true;
    onClose();
  }

  const dragHandle = Gesture.Pan()
    // Needs 8px of vertical movement before it takes over — small enough to
    // feel immediate once a real drag starts, large enough that a plain tap
    // on Cancel or Save (which sit in this same drag zone) still reaches
    // its own TouchableOpacity instead of being swallowed as a micro-drag.
    .activeOffsetY([-8, 8])
    // A mostly-horizontal touch (brushing a header button on the way past)
    // isn't a vertical drag — bail out rather than fight it.
    .failOffsetX([-20, 20])
    .onChange((e) => {
      // Dragging up past the resting position would peel the sheet off the
      // top of its own content, which looks like a glitch rather than a
      // gesture doing anything — clamp to "closed or lower", never negative.
      translateY.value = Math.max(0, translateY.value + e.changeY);
    })
    .onEnd((e) => {
      const shouldClose = translateY.value > 120 || e.velocityY > 800;
      if (shouldClose) {
        translateY.value = withTiming(600, { duration: 220 }, () => {
          runOnJS(requestClose)();
        });
      } else {
        translateY.value = withSpring(0, { damping: 28, stiffness: 300 });
      }
    });

  const sheetAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  // The chip reads off the draft, not the saved item, so retyping a date
  // switches it to "you set this" while the sheet is still open — the same
  // feedback the review card gives.
  const chip = provenanceChip({
    expiryDate: draft.expiryDate,
    dateSource: draft.dateSource,
    ripeness: item.ripeness,
    estimatedUseBy: draft.estimatedUseBy,
  });

  // Only what changed. Sending the whole draft would rewrite fields the user
  // never touched, and on an item added before locations or provenance existed
  // that turns absent fields into asserted ones.
  const changes = useMemo<Partial<NewPantryItem>>(() => {
    const out: Partial<NewPantryItem> = {};
    const name = draft.name.trim();
    const quantity = draft.quantity.trim();
    const location = draft.location.trim();
    if (name !== item.name) out.name = name;
    if (quantity !== item.quantity) out.quantity = quantity;
    if (draft.category !== item.category) out.category = draft.category;
    if (location !== (item.location ?? FALLBACK_LOCATION)) out.location = location;
    if (draft.expiryDate !== item.expiryDate) {
      out.expiryDate = draft.expiryDate;
      out.dateSource = draft.dateSource;
    }
    if (
      draft.basis !==
        (item.basis ?? (item.expiryDate ? 'manual' : item.estimatedUseBy ? 'estimated' : undefined)) ||
      draft.estimatedUseBy !== (item.estimatedUseBy ?? null)
    ) {
      out.basis = draft.basis;
      out.estimatedUseBy = draft.estimatedUseBy;
      out.estimateInputs = draft.estimateInputs;
    }
    // A picture the user attaches here belongs to the item, and takes
    // precedence over any crop of the scan it came from — so the crop is left
    // exactly where it is rather than being cleared. ItemThumb already prefers
    // one over the other; deleting the fallback would only cost the item its
    // picture if this one is later removed.
    if (draft.photoUri !== item.photoUri) out.photoUri = draft.photoUri;
    // Comparing foodId rather than the whole object: two lookups of the same
    // match wouldn't be identical objects even with equal fields, and that
    // would mark the sheet dirty for a field the user never touched.
    if ((draft.nutrition?.foodId ?? null) !== (item.nutrition?.foodId ?? null)) {
      out.nutrition = draft.nutrition;
    }
    return out;
  }, [draft, item]);

  const nameEmpty = draft.name.trim().length === 0;
  const locationEmpty = draft.location.trim().length === 0;
  const dirty = Object.keys(changes).length > 0;

  // Re-derived from the string on every edit rather than held as its own
  // piece of state — PantryItem.quantity is a plain opaque string with no
  // measure of its own (see services/quantity.ts's parseQuantityString for
  // the recovery rules, and its formatQuantityString for the inverse this
  // sheet writes back through). An item saved before this feature existed,
  // or whose quantity doesn't parse, falls back to {pieces, amount:1,
  // splittable:false} here and self-heals the next time it's edited.
  //
  // displayUnit is layered on separately (displayUnitOverride below) rather
  // than trusted to survive this round trip: formatQuantityString picks g/kg
  // (or mL/L) purely from the amount's own magnitude and has no field for
  // "which unit the person was actually looking at", so a plain parse ->
  // format -> parse cycle would silently snap kg back to g on every
  // keystroke elsewhere in the sheet — exactly the bug this whole control
  // exists to fix, just reappearing one layer up.
  const [displayUnitOverride, setDisplayUnitOverride] = useState<DisplayUnit | null>(null);
  const quantity = useMemo(() => {
    const parsed = parseQuantityString(draft.quantity);
    return displayUnitOverride ? { ...parsed, displayUnit: displayUnitOverride } : parsed;
  }, [draft.quantity, displayUnitOverride]);
  const catalogueMatch = useMemo(() => lookupFood(draft.name), [draft.name]);
  // The catalogue's own unit noun for a pieces/pack item ("loaf", "jar")
  // when the name matches one — nothing to offer for a name it doesn't
  // recognise, same as ScanReviewScreen's candidate.unit for a hand-typed row.
  const unit = catalogueMatch && !isFractionalUnit(catalogueMatch.unit) ? catalogueMatch.unit : '';

  return (
    <View style={styles.backdrop}>
      {/* Tapping outside closes. Any edits are dropped — Save is the only thing
          that writes, which is what makes the sheet safe to open just to look. */}
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.sheetWrap}
      >
        <Animated.View
          style={[styles.sheet, sheetAnimatedStyle, { paddingBottom: space.lg + insetBottom }]}
        >
          {/* The drag target: grabber + header together, so both the visual
              handle and the row it sits in respond to a swipe, not just the
              4px bar itself — a hitbox that thin would miss most real
              thumbs. */}
          <GestureDetector gesture={dragHandle}>
            <View>
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
                  // Nothing to write, or nothing to call it — either way Save
                  // would be a lie, so it greys out rather than silently
                  // doing nothing.
                  disabled={!dirty || nameEmpty || locationEmpty}
                >
                  <Text style={[styles.save, (!dirty || nameEmpty || locationEmpty) && styles.saveOff]}>
                    Save
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </GestureDetector>

          <ScrollView
            ref={scrollRef}
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            keyboardShouldPersistTaps="handled"
          >
            <Eyebrow style={styles.fieldLabel}>Name</Eyebrow>
            <TextInput
              style={styles.input}
              value={draft.name}
              onChangeText={(name) => patch({ name })}
              placeholder="What is it?"
              placeholderTextColor={colors.mutedLight}
              selectionColor={colors.primaryDark}
              autoCapitalize="sentences"
              // The server's own cap on a pantry item name — the same limit
              // the scan review card's Name field enforces, so renaming an
              // item here can't accept something adding it never would.
              maxLength={NAME_MAX_LENGTH}
            />
            {nameEmpty && <Text style={styles.error}>An item needs a name.</Text>}

            <View style={styles.fieldLabelRow}>
              <Eyebrow>Use by / Best before</Eyebrow>
              {/* Same reasoning as the scan review card: while "I don't
                  know" is selected with no real date, the estimate panel
                  below already shows this exact date once — the chip would
                  only be repeating it right above itself. */}
              {!(expiryUnknown && !draft.expiryDate) && <DateChip chip={chip} />}
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
              unknown={expiryUnknown}
              onChangeUnknown={setExpiryUnknown}
              basis={draft.basis}
              onChangeBasis={(basis) =>
                patch(
                  basis === 'estimated'
                    ? { basis }
                    : { basis, estimatedUseBy: null, estimateInputs: null }
                )
              }
              foodClass={classifyFood(draft.category)}
              itemName={draft.name}
              packageStatus={undefined}
              openedAt={null}
              addedAt={item.addedAt ? new Date(item.addedAt).toISOString().slice(0, 10) : null}
              storageLocation={draft.location}
              onEstimate={(result) =>
                patch({
                  estimatedUseBy: result?.date ?? null,
                  estimateInputs: result?.inputs ?? null,
                })
              }
            />

            <View ref={quantityFieldRef} style={styles.fieldLabel}>
              <MeasureControl
                quantity={quantity}
                unit={unit}
                onChange={(next) => {
                  // The persisted string has no room for "which unit was
                  // this displayed in" (see quantity's own useMemo above) —
                  // captured here, on every change, so a plain kg<->g toggle
                  // sticks across the next render instead of reverting to
                  // whichever unit the raw amount's magnitude implies.
                  setDisplayUnitOverride(next.displayUnit ?? null);
                  patch({ quantity: formatQuantityString(next, unit) });
                }}
                onFocusInput={handleAmountFocus}
              />
            </View>

            <Eyebrow style={styles.fieldLabel}>Store in</Eyebrow>
            <View style={styles.chipRow}>
              {STORAGE_LOCATIONS.map((location) => {
                // A saved custom location ("Pantry cart") is not itself one of
                // the fixed chips, but it came from picking Other — so Other is
                // what should read as selected, not nothing.
                const selected =
                  location === 'Other'
                    ? !FIXED_LOCATIONS.has(draft.location)
                    : draft.location === location;
                return (
                  <Chip
                    key={location}
                    label={location}
                    selected={selected}
                    onPress={() => patch({ location: location === 'Other' ? '' : location })}
                  />
                );
              })}
            </View>
            {!FIXED_LOCATIONS.has(draft.location) && (
              <TextInput
                style={[styles.input, styles.otherLocationInput]}
                value={draft.location}
                onChangeText={(location) => patch({ location })}
                placeholder="Where do you keep it?"
                placeholderTextColor={colors.mutedLight}
                selectionColor={colors.primaryDark}
                autoCapitalize="sentences"
              />
            )}

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
        </Animated.View>
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
  otherLocationInput: {
    marginTop: space.sm,
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