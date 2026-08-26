// src/components/profile/ReminderSheet.tsx
//
// Where expiry reminders are turned on and when they arrive. Opened from the
// Profile screen's Notifications row and from the bell on Home, which is the
// only other place in the app that has ever claimed to be about notifications.
//
// The system permission is requested here, at the moment the switch is flipped
// — never on launch. iOS shows that prompt once per install and a refusal
// cannot be undone from inside the app, so it is spent on someone who has just
// said yes to the idea rather than on someone four seconds into their first
// session.
//
// Four preset times rather than a clock. A dial would mean a new native
// dependency for a setting almost nobody opens twice, and the chip row is a
// shape this screen already uses for diet and allergies.

import React, { useEffect, useState } from 'react';
import { View, Modal, Switch, TouchableOpacity, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Text from '../Text';
import { fonts, type } from '../../theme/typography';
import { makeStyles } from '../../theme/makeStyles';
import { useColors } from '../../theme/ThemeProvider';
import { space } from '../../theme/spacing';
import { TIME_SLOTS, TimeSlot, hasPermission, requestPermission } from '../../services/notifications';
import { ReminderPrefs } from '../../services/session';

const HIT_SLOP = { top: 12, bottom: 12, left: 12, right: 12 };

type Props = {
  visible: boolean;
  prefs: ReminderPrefs;
  onChange: (prefs: ReminderPrefs) => void;
  /** Fires one immediately so the wording can be checked without waiting on a
   *  clock. Development only — the control is compiled out of a release. */
  onTest: () => void;
  /** Schedules a real one a minute out, which is the only way to exercise
   *  firing, retiring and logging without waiting for a preset hour. */
  onTestSoon: () => void;
  onClose: () => void;
};

export default function ReminderSheet({
  visible,
  prefs,
  onChange,
  onTest,
  onTestSoon,
  onClose,
}: Props) {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();

  // Only ever true when the OS agrees. The stored preference can say "on"
  // while permission has since been revoked in Settings, and a switch that
  // claims to be on while nothing arrives is worse than one that is honestly
  // off.
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    hasPermission().then((granted) => {
      if (!cancelled) setBlocked(prefs.enabled && !granted);
    });
    return () => {
      cancelled = true;
    };
  }, [visible, prefs.enabled]);

  async function toggle(on: boolean) {
    if (!on) {
      onChange({ ...prefs, enabled: false });
      setBlocked(false);
      return;
    }
    const granted = await requestPermission();
    // Refused at the OS level, so the switch stays off — the alternative is a
    // control that says yes while the phone says no.
    setBlocked(!granted);
    onChange({ ...prefs, enabled: granted });
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <TouchableOpacity style={styles.backdropTap} activeOpacity={1} onPress={onClose} />

        <View style={[styles.sheet, { paddingBottom: insets.bottom + space.lg }]}>
          <View style={styles.grabber} />

          <View style={styles.header}>
            <Text style={styles.title}>Reminders</Text>
            <TouchableOpacity onPress={onClose} hitSlop={HIT_SLOP}>
              <Ionicons name="close" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <View style={styles.toggleRow}>
            <View style={styles.toggleText}>
              <Text style={styles.rowTitle}>Tell me before food goes off</Text>
              <Text style={styles.rowSubtitle}>
                One message a day, and only when something actually needs eating.
              </Text>
            </View>
            <Switch
              value={prefs.enabled}
              onValueChange={toggle}
              trackColor={{ true: colors.primary, false: colors.tabInactive }}
              ios_backgroundColor={colors.tabInactive}
              thumbColor={colors.onAccent}
            />
          </View>

          {blocked && (
            <TouchableOpacity
              style={styles.blockedNote}
              onPress={() => Linking.openSettings()}
              activeOpacity={0.8}
            >
              <Ionicons name="alert-circle-outline" size={15} color={colors.rustMuted} />
              <Text style={styles.blockedText}>
                Your phone is blocking notifications for Panzi. Tap to open Settings and allow
                them.
              </Text>
            </TouchableOpacity>
          )}

          {prefs.enabled && (
            <>
              <Text style={styles.eyebrow}>REMIND ME AT</Text>
              <View style={styles.slotRow}>
                {TIME_SLOTS.map((slot) => {
                  const selected = prefs.slot === slot.id;
                  return (
                    <TouchableOpacity
                      key={slot.id}
                      style={[styles.slot, selected && styles.slotOn]}
                      onPress={() => onChange({ ...prefs, slot: slot.id as TimeSlot })}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.slotLabel, selected && styles.slotLabelOn]}>
                        {slot.label}
                      </Text>
                      <Text style={[styles.slotHour, selected && styles.slotHourOn]}>
                        {slot.hour % 12 === 0 ? 12 : slot.hour % 12}:00
                        {slot.hour < 12 ? 'am' : 'pm'}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Text style={styles.footnote}>
                Evening suits most people — there is still time to cook the thing tonight.
              </Text>

              {__DEV__ && (
                <View style={styles.testRow}>
                  <TouchableOpacity
                    style={styles.testButton}
                    onPress={onTest}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="flask-outline" size={15} color={colors.textSecondary} />
                    <Text style={styles.testText}>Send now</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.testButton}
                    onPress={onTestSoon}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="time-outline" size={15} color={colors.textSecondary} />
                    <Text style={styles.testText}>In 1 min</Text>
                  </TouchableOpacity>
                </View>
              )}
            </>
          )}
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
    marginBottom: space.xl,
  },
  title: {
    fontFamily: fonts.display,
    fontWeight: '800',
    fontSize: type.title.fontSize,
    color: colors.primaryDarker,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
  },
  toggleText: {
    flex: 1,
  },
  rowTitle: {
    fontWeight: '800',
    fontSize: type.bodyLarge.fontSize,
    color: colors.primaryDarker,
    marginBottom: space.xs,
  },
  rowSubtitle: {
    fontWeight: '600',
    fontSize: type.label.fontSize,
    lineHeight: 18,
    color: colors.textSecondary,
  },
  blockedNote: {
    flexDirection: 'row',
    gap: space.sm,
    alignItems: 'flex-start',
    backgroundColor: colors.warmCard,
    borderWidth: 1,
    borderColor: colors.warmBorder,
    borderRadius: 14,
    padding: space.md,
    marginTop: space.lg,
  },
  blockedText: {
    flex: 1,
    fontWeight: '600',
    fontSize: type.caption.fontSize,
    lineHeight: 17,
    color: colors.rustMuted,
  },
  eyebrow: {
    fontWeight: '800',
    fontSize: type.micro.fontSize,
    letterSpacing: 1.54,
    textTransform: 'uppercase',
    color: colors.tabInactive,
    marginTop: space.xxl,
    marginBottom: space.md,
  },
  slotRow: {
    flexDirection: 'row',
    gap: space.sm,
  },
  slot: {
    flex: 1,
    alignItems: 'center',
    gap: space.half,
    paddingVertical: space.md,
    paddingHorizontal: space.xs,
    borderRadius: 16,
    backgroundColor: colors.cardSunken,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
  },
  slotOn: {
    backgroundColor: colors.primaryLighter,
    borderColor: colors.primaryDark,
  },
  slotLabel: {
    fontWeight: '800',
    fontSize: type.label.fontSize,
    color: colors.textDark,
  },
  slotLabelOn: {
    color: colors.primaryDarker,
  },
  slotHour: {
    fontWeight: '700',
    fontSize: type.micro.fontSize,
    color: colors.textSecondary,
  },
  slotHourOn: {
    color: colors.primaryDark,
  },
  testRow: {
    flexDirection: 'row',
    gap: space.sm,
    marginTop: space.lg,
  },
  testButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs2,
    paddingVertical: space.md,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.tabInactive,
  },
  testText: {
    fontWeight: '700',
    fontSize: type.label.fontSize,
    color: colors.textSecondary,
  },
  footnote: {
    fontWeight: '600',
    fontSize: type.caption.fontSize,
    lineHeight: 17,
    color: colors.textSecondary,
    marginTop: space.md,
  },
}));
