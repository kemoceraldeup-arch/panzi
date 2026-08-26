// src/components/profile/HelpSheet.tsx
//
// Profile's "Help & feedback".
//
// The questions are the ones this app actually provokes, taken from what it
// does rather than from a generic support template: why a date was missed, what
// ESTIMATED means, why a reminder has not arrived. A help screen answering
// questions nobody asked is the same dead end as a row that opens an alert.
//
// Answers stay in Panzi's voice and admit what the app cannot do. "The scanner
// misses dates on curved tins" is more use to someone than "ensure adequate
// lighting", and it is also true.

import React, { useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Text from '../Text';
import { fonts, type } from '../../theme/typography';
import { makeStyles } from '../../theme/makeStyles';
import { useColors } from '../../theme/ThemeProvider';
import { space } from '../../theme/spacing';
import { FEEDBACK_MAX_LENGTH, sendFeedback } from '../../services/feedback';

const HIT_SLOP = { top: 12, bottom: 12, left: 12, right: 12 };

const FAQS: { q: string; a: string }[] = [
  {
    q: "Why didn't it find the date on my item?",
    a: "Because it genuinely could not read it. Curved tins, foil lids, faded ink and dates printed in the crimp of a packet all defeat it. The row still gets added — tap it and type the date in, and Panzi keeps your version rather than guessing over it.",
  },
  {
    q: 'What does ESTIMATED mean on a date?',
    a: "That nothing was printed on the packet, so Panzi guessed from what the item is — loose spinach keeps about five days, a tin keeps months. FROM LABEL means it read a real printed date. YOU SET THIS means you typed it. The three are kept apart on purpose so a guess never wears the badge of a fact.",
  },
  {
    q: 'Why have I not had a reminder?',
    a: "Panzi only sends one when something actually needs eating, so quiet days are normal. If it is always quiet, check that reminders are switched on under Notifications, and that your items have dates on them — an item with no date is invisible to reminders.",
  },
  {
    q: 'Does scanning cost me anything?',
    a: 'No. Scanning and recipe suggestions run on the developer’s account, not yours.',
  },
  {
    q: 'Can I trust the dates for food safety?',
    a: "No, and please do not. Dates are read by a machine that misreads things, and estimates are averages rather than facts about your kitchen. Panzi is a reminder of what you have, not a judgement on whether it is safe. Look at it, smell it, use your own judgement.",
  },
  {
    q: 'Does it work without internet?',
    a: 'Mostly. Your pantry is cached on the phone, so you can read and edit it offline and the changes sync when you are back. Scanning and recipes need a connection, because both are done by a model that does not live on your phone.',
  },
];

type Props = {
  visible: boolean;
  uid: string | null;
  email: string | null;
  appVersion: string;
  onClose: () => void;
};

export default function HelpSheet({ visible, uid, email, appVersion, onClose }: Props) {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [failed, setFailed] = useState(false);

  function close() {
    onClose();
    // Reset after the sheet is gone rather than while it is on screen, so the
    // thank-you is not snatched away as it slides out.
    setTimeout(() => {
      setOpenIndex(null);
      setMessage('');
      setSent(false);
      setFailed(false);
    }, 300);
  }

  async function send() {
    const text = message.trim();
    if (!text || !uid || sending) return;
    setSending(true);
    setFailed(false);
    try {
      await sendFeedback(uid, email, text, appVersion);
      setSent(true);
      setMessage('');
    } catch {
      // Named plainly rather than thrown away. Someone who typed a paragraph
      // deserves to know it did not arrive, and their text is left in the box.
      setFailed(true);
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={close}>
      <View style={styles.backdrop}>
        <TouchableOpacity style={styles.backdropTap} activeOpacity={1} onPress={close} />

        <View style={[styles.sheet, { paddingBottom: insets.bottom + space.lg }]}>
          <View style={styles.grabber} />

          <View style={styles.header}>
            <Text style={styles.title}>Help & feedback</Text>
            <TouchableOpacity onPress={close} hitSlop={HIT_SLOP}>
              <Ionicons name="close" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.eyebrow}>COMMON QUESTIONS</Text>
            <View style={styles.card}>
              {FAQS.map((faq, i) => {
                const open = openIndex === i;
                return (
                  <View key={faq.q} style={i > 0 ? styles.divided : undefined}>
                    <TouchableOpacity
                      style={styles.faqRow}
                      onPress={() => setOpenIndex(open ? null : i)}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityState={{ expanded: open }}
                    >
                      <Text style={styles.faqQuestion}>{faq.q}</Text>
                      <Ionicons
                        name={open ? 'chevron-up' : 'chevron-down'}
                        size={16}
                        color={colors.chevron}
                      />
                    </TouchableOpacity>
                    {open && <Text style={styles.faqAnswer}>{faq.a}</Text>}
                  </View>
                );
              })}
            </View>

            <Text style={[styles.eyebrow, styles.eyebrowSpaced]}>TELL US SOMETHING</Text>

            {sent ? (
              <View style={styles.sentCard}>
                <Ionicons name="checkmark-circle" size={18} color={colors.primaryDark} />
                <Text style={styles.sentText}>
                  Got it — thank you. Every one of these is read.
                </Text>
              </View>
            ) : (
              <>
                <View style={styles.inputWrap}>
                  <TextInput
                    style={styles.input}
                    value={message}
                    onChangeText={setMessage}
                    placeholder="What went wrong, or what would help?"
                    placeholderTextColor={colors.mutedLight}
                    multiline
                    maxLength={FEEDBACK_MAX_LENGTH}
                    textAlignVertical="top"
                    selectionColor={colors.primaryDark}
                  />
                </View>

                {failed && (
                  <Text style={styles.failedText}>
                    That did not send — check your connection and try again. Your message is
                    still here.
                  </Text>
                )}

                <TouchableOpacity
                  style={[styles.send, !message.trim() && styles.sendOff]}
                  onPress={send}
                  disabled={!message.trim() || sending}
                  activeOpacity={0.85}
                >
                  {sending ? (
                    <ActivityIndicator color={colors.onAccent} />
                  ) : (
                    <Text style={styles.sendLabel}>Send</Text>
                  )}
                </TouchableOpacity>

                <Text style={styles.footnote}>
                  Sent with your app version and phone type, so a bug can be placed. Nothing from
                  your pantry is attached.
                </Text>
              </>
            )}
          </ScrollView>
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
    maxHeight: '88%',
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
  scroll: {
    flexGrow: 0,
  },
  scrollContent: {
    paddingBottom: space.sm,
  },
  eyebrow: {
    fontWeight: '800',
    fontSize: type.micro.fontSize,
    letterSpacing: 1.54,
    textTransform: 'uppercase',
    color: colors.tabInactive,
    marginBottom: space.md,
  },
  eyebrowSpaced: {
    marginTop: space.xxl,
  },
  card: {
    backgroundColor: colors.cardSunken,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
    paddingHorizontal: space.lg,
  },
  divided: {
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  faqRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md2,
  },
  faqQuestion: {
    flex: 1,
    fontWeight: '800',
    fontSize: type.label.fontSize,
    lineHeight: 19,
    color: colors.primaryDarker,
  },
  faqAnswer: {
    fontWeight: '600',
    fontSize: type.caption.fontSize,
    lineHeight: 19,
    color: colors.textSecondary,
    paddingBottom: space.md2,
    paddingRight: space.xxl,
  },
  inputWrap: {
    minHeight: 104,
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
    padding: space.md2,
  },
  input: {
    minHeight: 76,
    fontFamily: fonts.body,
    fontWeight: '600',
    fontSize: type.body.fontSize,
    lineHeight: 21,
    color: colors.textPrimary,
  },
  failedText: {
    fontWeight: '700',
    fontSize: type.caption.fontSize,
    lineHeight: 17,
    color: colors.rustMuted,
    marginTop: space.sm2,
  },
  send: {
    height: 50,
    borderRadius: 16,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: space.md,
  },
  sendOff: {
    backgroundColor: colors.primaryLight,
  },
  sendLabel: {
    fontWeight: '800',
    fontSize: type.subtitle.fontSize,
    color: colors.onAccent,
  },
  footnote: {
    fontWeight: '600',
    fontSize: type.caption.fontSize,
    lineHeight: 17,
    color: colors.textSecondary,
    marginTop: space.md,
  },
  sentCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.primaryWash,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.primaryLine,
    padding: space.lg,
  },
  sentText: {
    flex: 1,
    fontWeight: '700',
    fontSize: type.label.fontSize,
    lineHeight: 19,
    color: colors.primaryDark,
  },
}));
