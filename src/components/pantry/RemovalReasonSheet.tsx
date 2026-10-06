// src/components/pantry/RemovalReasonSheet.tsx
//
// What Delete and Use up open on the List screen.
//
// Step 1, "How much?", goes item by item: a stepper in the item's own measure
// that starts at all of it, with an All shortcut. An item with no number to
// count, or no more than one step of it, only offers All. Use up stops here and
// saves as Consumed — the Next button on the last item is the deliberate
// action, so there is no confirm after it.
//
// Step 2, "Why is it going?", is one pick for everything in this removal.
// Three reasons save on tap; Other opens a short note and its own Save. The
// last row is the way out for a row that should never have been there: it
// deletes without writing any history, because a misread scan logged as
// "Other" would count food that never left the kitchen.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Text from '../Text';
import { MeasureControl } from '../../screens/scan/atoms';
import { PantryItem } from '../../services/pantry';
import { DisplayUnit, displayUnitFor } from '../../services/quantity';
import { RemovalLine, removableAmount, splitRemoval } from '../../services/removalAmount';
import {
  NOTE_MAX,
  REMOVAL_HINTS,
  REMOVAL_LABELS,
  REMOVAL_REASONS,
  RemovalReason,
  isWaste,
  otherNote,
} from '../../services/removals';
import { fonts, type } from '../../theme/typography';
import { makeStyles } from '../../theme/makeStyles';
import { useColors } from '../../theme/ThemeProvider';
import { space } from '../../theme/spacing';

const HIT_SLOP = { top: 12, bottom: 12, left: 12, right: 12 };

export const REASON_ICONS: Record<RemovalReason, keyof typeof Ionicons.glyphMap> = {
  consumed: 'restaurant-outline',
  spoiled: 'warning-outline',
  expired: 'calendar-outline',
  // Not three dots: beside a label those read as text that was cut off.
  other: 'chatbubble-outline',
};

type Take = number | 'all';

type Props = {
  /** The items being removed, or [] when closed. */
  items: PantryItem[];
  /** 'useUp' asks only how much and saves as Consumed. */
  mode: 'remove' | 'useUp';
  onSave: (lines: RemovalLine[], reason: RemovalReason, note: string | null) => void;
  /** Deletes without recording anything — added by mistake. */
  onDiscard: () => void;
  onClose: () => void;
};

export default function RemovalReasonSheet({ items, mode, onSave, onDiscard, onClose }: Props) {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();

  // 0..items.length-1 is "How much?" for that item; items.length is "Why?".
  const [index, setIndex] = useState(0);
  const [takes, setTakes] = useState<Record<string, Take>>({});
  // The kg/g or L/mL each weight and volume item is being read in; the take
  // itself stays in base units.
  const [units, setUnits] = useState<Record<string, DisplayUnit>>({});
  const [otherOpen, setOtherOpen] = useState(false);
  const [note, setNote] = useState('');
  // What Other would save — null until something is typed, which keeps Save off.
  const typedNote = otherNote(note);
  // Set by the first save so a double tap cannot send the removal twice.
  const submitting = useRef(false);

  // A fresh removal starts from the first item, all of everything.
  const key = items.map((i) => i.id).join(',');
  useEffect(() => {
    setIndex(0);
    setTakes({});
    setUnits({});
    submitting.current = false;
    setOtherOpen(false);
    setNote('');
  }, [key]);

  const count = items.length;
  const onReasonStep = index >= count;
  const item = onReasonStep ? null : items[index];
  const removable = useMemo(() => (item ? removableAmount(item.quantity) : null), [item]);
  const take: Take = item ? (takes[item.id] ?? 'all') : 'all';

  function lines(): RemovalLine[] {
    return items.map((i) => splitRemoval(i.id, i.quantity, takes[i.id] ?? 'all'));
  }

  function setTake(next: Take) {
    if (!item) return;
    setTakes((prev) => ({ ...prev, [item.id]: next }));
  }

  function save(reason: RemovalReason, noteText: string | null) {
    if (submitting.current) return;
    submitting.current = true;
    onSave(lines(), reason, noteText);
  }

  function next() {
    if (index === count - 1 && mode === 'useUp') {
      save('consumed', null);
      return;
    }
    setIndex(index + 1);
  }

  function pick(reason: RemovalReason) {
    if (reason === 'other') {
      setOtherOpen(true);
      return;
    }
    save(reason, null);
  }

  const title = onReasonStep ? 'Why is it going?' : 'How much?';
  const subtitle = onReasonStep
    ? `${count === 1 ? '1 item' : `${count} items`} · saved to your history`
    : `${item!.name}${count > 1 ? ` · ${index + 1} of ${count}` : ''}`;
  const nextLabel = index === count - 1 && mode === 'useUp' ? 'Use up' : 'Next';

  return (
    <Modal visible={count > 0} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <TouchableOpacity style={styles.backdropTap} activeOpacity={1} onPress={onClose} />

        <View style={[styles.sheet, { paddingBottom: insets.bottom + space.lg }]}>
          <View style={styles.grabber} />

          <View style={styles.header}>
            {index > 0 && (
              <TouchableOpacity
                onPress={() => {
                  setOtherOpen(false);
                  setIndex(index - 1);
                }}
                hitSlop={HIT_SLOP}
                accessibilityLabel="Back"
              >
                <Ionicons name="chevron-back" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{title}</Text>
              <Text style={styles.subtitle} numberOfLines={1}>
                {subtitle}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={HIT_SLOP} accessibilityLabel="Cancel">
              <Ionicons name="close" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {!onReasonStep && item && (
            <>
              <View style={styles.card}>
                <View style={styles.amountBody}>
                  {removable ? (
                    <MeasureControl
                      key={item.id}
                      quantity={{
                        ...removable.full,
                        amount: take === 'all' ? removable.full.amount : take,
                        ...(removable.full.measure === 'weight' || removable.full.measure === 'volume'
                          ? { displayUnit: units[item.id] ?? displayUnitFor(removable.full) }
                          : {}),
                      }}
                      unit={removable.unit}
                      max={removable.full.amount}
                      fixedMeasure
                      applyWhileTyping
                      label="How much"
                      onChange={(q) => {
                        if (q.displayUnit) {
                          setUnits((prev) => ({ ...prev, [item.id]: q.displayUnit! }));
                        }
                        setTake(q.amount >= removable.full.amount ? 'all' : q.amount);
                      }}
                    />
                  ) : (
                    <Text style={styles.allOnly}>
                      {item.quantity.trim() ? `All of it (${item.quantity.trim()})` : 'All of it'}
                    </Text>
                  )}
                  {removable && (
                    <TouchableOpacity
                      style={[styles.allChip, take === 'all' && styles.allChipOn]}
                      onPress={() => setTake('all')}
                      accessibilityRole="button"
                      accessibilityState={{ selected: take === 'all' }}
                    >
                      <Text style={[styles.allChipText, take === 'all' && styles.allChipTextOn]}>
                        All ({item.quantity.trim()})
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
              <TouchableOpacity style={styles.primary} onPress={next} accessibilityRole="button">
                <Text style={styles.primaryText}>{nextLabel}</Text>
              </TouchableOpacity>
            </>
          )}

          {onReasonStep && (
            <>
              <View style={styles.card}>
                {REMOVAL_REASONS.map((reason, i) => {
                  const waste = isWaste(reason);
                  const selected = reason === 'other' && otherOpen;
                  return (
                    <TouchableOpacity
                      key={reason}
                      style={[styles.row, i > 0 && styles.rowDivided, selected && styles.rowSelected]}
                      onPress={() => pick(reason)}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                    >
                      <View style={[styles.icon, waste ? styles.iconWaste : styles.iconEaten]}>
                        <Ionicons
                          name={REASON_ICONS[reason]}
                          size={17}
                          color={waste ? colors.accentDeep : colors.primaryDark}
                        />
                      </View>
                      <View style={styles.rowText}>
                        <Text style={styles.rowLabel}>{REMOVAL_LABELS[reason]}</Text>
                        <Text style={styles.rowHint}>{REMOVAL_HINTS[reason]}</Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {otherOpen && (
                <View style={styles.noteBlock}>
                  <TextInput
                    style={styles.noteInput}
                    value={note}
                    onChangeText={setNote}
                    placeholder="What happened? e.g. Gave to neighbour"
                    placeholderTextColor={colors.textSecondary}
                    maxLength={NOTE_MAX}
                    autoFocus
                    returnKeyType="done"
                    onSubmitEditing={() => {
                      if (typedNote) save('other', typedNote);
                    }}
                    accessibilityLabel="Reason for removing"
                  />
                  {/* "Other" alone says nothing about where the food went, so
                      it needs the user's own words before it can be saved. */}
                  {!typedNote && (
                    <Text style={styles.noteHint}>Type a reason to save it as Other.</Text>
                  )}
                  <TouchableOpacity
                    style={[styles.primary, !typedNote && styles.primaryDisabled]}
                    onPress={() => {
                      if (typedNote) save('other', typedNote);
                    }}
                    disabled={!typedNote}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: !typedNote }}
                  >
                    <Text style={styles.primaryText}>Save</Text>
                  </TouchableOpacity>
                </View>
              )}

              <TouchableOpacity style={styles.discard} onPress={onDiscard}
                hitSlop={HIT_SLOP}
                accessibilityRole="button"
              >
                <Text style={styles.discardText}>Added by mistake — delete without recording</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
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
    backgroundColor: colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: space.xl,
    paddingTop: space.sm2,
  },
  grabber: {
    alignSelf: 'center',
    width: 42,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.backgroundAlt,
    marginBottom: space.md2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    marginBottom: space.md2,
  },
  title: {
    fontFamily: fonts.display,
    fontWeight: '700',
    fontSize: type.title.fontSize,
    color: colors.primaryDarker,
  },
  subtitle: {
    fontWeight: '600',
    fontSize: type.label.fontSize,
    color: colors.textSecondary,
    marginTop: space.xs,
  },
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
    borderRadius: 20,
    overflow: 'hidden',
  },
  amountBody: {
    padding: space.lg,
    gap: space.md,
  },
  allOnly: {
    fontWeight: '700',
    fontSize: type.body.fontSize,
    color: colors.primaryDarker,
  },
  allChip: {
    alignSelf: 'flex-start',
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
  },
  allChipOn: {
    backgroundColor: colors.primaryLighter,
    borderColor: colors.primaryLighter,
  },
  allChipText: {
    fontWeight: '700',
    fontSize: type.label.fontSize,
    color: colors.textSecondary,
  },
  allChipTextOn: {
    color: colors.primaryDark,
  },
  primary: {
    marginTop: space.md2,
    minHeight: 50,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryDark,
  },
  primaryText: {
    fontWeight: '800',
    fontSize: type.body.fontSize,
    color: colors.surface,
  },
  primaryDisabled: {
    opacity: 0.4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 56,
    paddingVertical: space.sm2,
    paddingHorizontal: space.lg,
  },
  rowDivided: {
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  rowSelected: {
    backgroundColor: colors.backgroundAlt,
  },
  icon: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconEaten: {
    backgroundColor: colors.primaryLighter,
  },
  iconWaste: {
    backgroundColor: colors.accentSoft,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowLabel: {
    fontWeight: '700',
    fontSize: type.body.fontSize,
    color: colors.primaryDarker,
  },
  rowHint: {
    fontWeight: '600',
    fontSize: type.caption.fontSize,
    color: colors.textSecondary,
    marginTop: space.half,
  },
  noteBlock: {
    marginTop: space.md2,
  },
  noteInput: {
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
    backgroundColor: colors.card,
    paddingHorizontal: space.lg,
    fontSize: type.body.fontSize,
    color: colors.primaryDarker,
  },
  noteHint: {
    fontWeight: '600',
    fontSize: type.caption.fontSize,
    color: colors.textSecondary,
    marginTop: space.sm,
  },
  discard: {
    alignSelf: 'center',
    paddingVertical: space.md2,
    marginTop: space.xs,
  },
  discardText: {
    fontWeight: '700',
    fontSize: type.label.fontSize,
    color: colors.textSecondary,
  },
}));
