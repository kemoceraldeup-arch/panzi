// src/components/profile/PrivacySheet.tsx
//
// Profile's "Privacy & terms".
//
// Written from what the code actually does rather than from a template: the
// three services named below are the three the app really talks to, and the
// retention rules describe what really happens to a row when it is deleted.
// A privacy notice that describes a different app is worse than none, because
// it is a promise nobody kept.
//
// The food-safety paragraph is the one that matters most here and is deliberately
// blunt. Dates are read by a model that misreads things, and estimates are
// averages. An app that puts a date beside food has to say plainly that it is
// not the authority on whether that food is safe.
//
// NOT lawyer-reviewed. Accurate as a description of behaviour; have someone
// check it before the app goes to a store.

import React from 'react';
import { Modal, ScrollView, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Text from '../Text';
import { fonts, type } from '../../theme/typography';
import { makeStyles } from '../../theme/makeStyles';
import { useColors } from '../../theme/ThemeProvider';
import { space } from '../../theme/spacing';

const HIT_SLOP = { top: 12, bottom: 12, left: 12, right: 12 };

/** Shown at the top so the reader knows how current it is. */
const UPDATED = 'August 2026';

type Section = { heading: string; body: string[] };

// Each line below is a field and a single stated purpose for it — not a list
// of what's collected followed separately by a list of where things go. A
// purpose-limitation notice that only says "we store X with Y" never actually
// commits to using X for nothing else, so every line here names the one thing
// that field is for.
const PRIVACY: Section[] = [
  {
    heading: 'What Panzi keeps, and why',
    body: [
      'Your email — to sign you in, and to reach you if something needs your attention (a security alert, a reply to feedback). Never for marketing.',
      'Your name — shown back to you in the app, and nowhere else.',
      'Your diet and allergy chips — used only to filter and flag the recipes Panzi suggests you. Never shared with anyone but the recipe model itself, and only as an ingredient filter, never linked back to your name or email when it is sent.',
      'Your pantry — every item, its date, where you keep it, and any photo — kept only so the app can show you your own shelves and warn you before something goes off. Not analysed for anything beyond that.',
      'Your profile photo, if you set one — shown back to you and nowhere else.',
    ],
  },
  {
    heading: 'Where it is stored',
    body: [
      'Your account, pantry, chats and saved recipes live in our own database (MongoDB Atlas), not a Firebase or Google product — Firebase is only what checks your password when you sign in.',
      'Your profile photo is stored with Supabase.',
    ],
  },
  {
    heading: 'What leaves the app, and only for that one reason',
    body: [
      'A scan photo goes to OpenAI once, to be read into text, and nothing about you rides along with it — no name, email or account id. OpenAI’s own policy is what governs how long they hold it; that is their commitment, not something this app can enforce.',
      'A recipe request sends your pantry list, and your diet and allergy chips, to OpenAI — the chips are what let it filter suggestions for you, so they go every time you ask. No name, email or account id goes with it.',
      'A chat message is sent to OpenAI to work out what you are asking for, and — if it needs your pantry to answer — the same pantry, diet and allergy information above. Again, never your name, email or account id.',
      'An ingredient name is sent to FatSecret only to look up its calories and macros — nothing about you personally is attached to that lookup.',
      'A live-trend chat question is sent to Serper as a plain search, with nothing from your account attached to it.',
    ],
  },
  {
    heading: 'What Panzi does not do',
    body: [
      'It does not sell your information, and there are no advertisers in it.',
      'There is no analytics or tracking built into the app.',
      'It does not read anything on your phone beyond the photos you choose and the camera while a scan is open.',
      'Nothing collected for one of the reasons above is reused for a different one without telling you here first.',
    ],
  },
  {
    heading: 'Getting rid of it',
    body: [
      'Deleting an item removes it, and its photo, for good.',
      'Signing out leaves your data where it is so it is waiting when you come back.',
      'Your data screen, under Account, can clear your pantry on its own, or delete your account outright — which erases your pantry, scans, saved recipes, chats and profile permanently, right away, not on a delay and not pending a manual review.',
    ],
  },
  {
    heading: 'Who is accountable for this',
    body: [
      'The team building Panzi is responsible for what this page says and for what the app actually does with your data — if the two ever disagree, that is our mistake to fix, not yours to work around.',
      'Every account deletion is logged — who, and when — separately from the account itself, specifically so a deletion can be checked afterwards rather than taken on trust.',
      'Something here wrong, out of date, or not matching what the app does in practice is a bug. Report it through Help & feedback and expect it corrected, not defended.',
    ],
  },
];

const TERMS: Section[] = [
  {
    heading: 'Panzi is not a food-safety authority',
    body: [
      'Dates are read off packaging by a machine, and it gets them wrong. Where nothing is printed, Panzi estimates from what the item is — an average, not a fact about your kitchen.',
      'Treat everything here as a reminder of what you have, never as permission to eat something. Look at it, smell it, and use your own judgement. If you are unsure, throw it out.',
    ],
  },
  {
    heading: 'Recipes',
    body: [
      'Suggestions are generated, and they can be wrong about ingredients, timings and what suits a diet. Panzi filters for the diets and allergies you set, but a filter that runs on a machine-read ingredient list is not a guarantee. If an allergy is serious, check the recipe yourself.',
    ],
  },
  {
    heading: 'The app itself',
    body: [
      'Panzi is provided as it is, without a promise that it will always work or always be available.',
      'Use it for your own kitchen. Do not try to break it, overload it, or use it to store anything that is not food.',
    ],
  },
];

type Props = {
  visible: boolean;
  onClose: () => void;
};

export default function PrivacySheet({ visible, onClose }: Props) {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <TouchableOpacity style={styles.backdropTap} activeOpacity={1} onPress={onClose} />

        <View style={[styles.sheet, { paddingBottom: insets.bottom + space.lg }]}>
          <View style={styles.grabber} />

          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={styles.title}>Privacy & terms</Text>
              <Text style={styles.updated}>Updated {UPDATED}</Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={HIT_SLOP}>
              <Ionicons name="close" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* First, before any of the privacy detail. It is the one thing on
                this screen somebody could come to harm by not reading. */}
            <View style={styles.warning}>
              <Ionicons name="alert-circle-outline" size={18} color={colors.rustMuted} />
              <Text style={styles.warningText}>
                Panzi guesses and misreads. Never rely on it to decide whether food is safe to
                eat.
              </Text>
            </View>

            <Text style={styles.eyebrow}>PRIVACY</Text>
            {PRIVACY.map((section) => (
              <Block key={section.heading} section={section} />
            ))}

            <Text style={[styles.eyebrow, styles.eyebrowSpaced]}>TERMS</Text>
            {TERMS.map((section) => (
              <Block key={section.heading} section={section} />
            ))}

            <Text style={styles.footnote}>
              Questions about any of this go through Help & feedback.
            </Text>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function Block({ section }: { section: Section }) {
  const styles = useStyles();
  return (
    <View style={styles.block}>
      <Text style={styles.blockHeading}>{section.heading}</Text>
      {section.body.map((line) => (
        <View key={line} style={styles.line}>
          <View style={styles.bullet} />
          <Text style={styles.lineText}>{line}</Text>
        </View>
      ))}
    </View>
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
  headerText: {
    flex: 1,
  },
  title: {
    fontFamily: fonts.display,
    fontWeight: '800',
    fontSize: type.title.fontSize,
    color: colors.primaryDarker,
  },
  updated: {
    fontWeight: '700',
    fontSize: type.micro.fontSize,
    color: colors.textSecondary,
    marginTop: space.half,
  },
  scroll: {
    flexGrow: 0,
  },
  scrollContent: {
    paddingBottom: space.sm,
  },
  warning: {
    flexDirection: 'row',
    gap: space.sm,
    alignItems: 'flex-start',
    backgroundColor: colors.warmCard,
    borderWidth: 1,
    borderColor: colors.warmBorder,
    borderRadius: 16,
    padding: space.md2,
    marginBottom: space.xxl,
  },
  warningText: {
    flex: 1,
    fontWeight: '700',
    fontSize: type.label.fontSize,
    lineHeight: 19,
    color: colors.rustMuted,
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
  block: {
    marginBottom: space.xl,
  },
  blockHeading: {
    fontWeight: '800',
    fontSize: type.bodyLarge.fontSize,
    color: colors.primaryDarker,
    marginBottom: space.sm,
  },
  line: {
    flexDirection: 'row',
    gap: space.sm2,
    marginTop: space.sm,
  },
  bullet: {
    width: 5,
    height: 5,
    borderRadius: 999,
    backgroundColor: colors.primaryLight,
    marginTop: space.sm,
  },
  lineText: {
    flex: 1,
    fontWeight: '600',
    fontSize: type.caption.fontSize,
    lineHeight: 19,
    color: colors.textSecondary,
  },
  footnote: {
    fontWeight: '600',
    fontSize: type.caption.fontSize,
    lineHeight: 17,
    color: colors.mutedLight,
    marginTop: space.md,
  },
}));
