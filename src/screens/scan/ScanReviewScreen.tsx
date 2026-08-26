// src/screens/scan/ScanReviewScreen.tsx
//
// Screens 03 and 04 of the item scanner — the review page, and the edit card
// that opens inside it.
//
// The page the whole feature turns on. One shot produced a list; nothing is
// saved until the user says so; and the list is sorted by what needs a decision
// rather than by what the camera happened to see first. Items the scanner had
// to guess at sit on top under "Needs a look", each saying in words what is
// wrong with it. Everything it is confident about collapses underneath.
//
// Two decisions here are load-bearing.
//
// The edit card expands *in place* rather than opening a sheet. An item that
// vanishes into a modal and comes back changed loses its context: the point of
// fixing a row is comparing it with the rows around it and with the photo at
// the top. The rest of the page dims instead — present, but clearly not the
// thing being worked on.
//
// And nothing is ever blocked from being added. A missing date does not stop
// the batch; the footnote under the button promises the scan can be finished
// later from history, and services/scans.ts is what makes that true. Requiring
// perfect data before saving would mean a user with six items and one bad
// reading either fixes it now or loses all six.

import React, { useMemo, useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Text from '../../components/Text';
import { fonts, type } from '../../theme/typography';
import { STORAGE_LOCATIONS } from '../../services/pantry';
import {
  ScanCandidate,
  attentionChips,
  describeQuantity,
  provenanceChip,
  splitByAttention,
} from '../../services/scan';
import { suggestFoods, lookupFood, FALLBACK_LOCATION } from '../../data/foodCatalogue';
import { Capture, AttentionChip, DateChip, Eyebrow, HIT_SLOP, ItemThumb } from './atoms';
import DateField from './DateField';
import { offerToScan, pickItemPhoto } from './pickItemPhoto';
import { makeStyles } from '../../theme/makeStyles';
import { useColors } from '../../theme/ThemeProvider';
import { space } from '../../theme/spacing';

// The most the stepper will climb to. Not a limit on what the user can type —
// it is a guard on the plus button, which is a held finger away from absurd.
const MAX_COUNT = 99;

// How many confident rows show before the "Show all" link takes over. The group
// is collapsed because it is the part the user does *not* need to read.
const COLLAPSED_LOOKS_RIGHT = 3;

type Props = {
  candidates: ScanCandidate[];
  photo?: Capture | null;
  /** Which row is expanded, if any. Owned by ScanModal so the freshness screen
   *  and the history reopen can both put the user back on the right card. */
  editingId: string | null;
  saving: boolean;
  /** Text under the primary button when reopened from history rather than
   *  straight off a capture. */
  subtitle?: string;
  primaryLabel?: string;
  onClose: () => void;
  /** Leaves this page the way the user arrived at it — back to the camera for
   *  a row typed in from there, out of the scanner for one added from the
   *  pantry. Only surfaced when there is no photo: with one, the thumbnail is
   *  the way out and Retake is the way back. */
  onBack: () => void;
  onRetake: () => void;
  onEdit: (candidate: ScanCandidate) => void;
  onCollapse: () => void;
  onPatch: (id: string, patch: Partial<ScanCandidate>) => void;
  onConfirmItem: (id: string) => void;
  onRemove: (id: string) => void;
  onOpenFreshness: (candidate: ScanCandidate) => void;
  onAddByHand: () => void;
  /** Reads a photo attached to a hand-added row, replacing that row. */
  onScanAttached: (id: string, photo: Capture) => void;
  onSubmit: () => void;
};

export default function ScanReviewScreen({
  candidates,
  photo,
  editingId,
  saving,
  subtitle,
  primaryLabel,
  onClose,
  onBack,
  onRetake,
  onEdit,
  onCollapse,
  onPatch,
  onConfirmItem,
  onRemove,
  onOpenFreshness,
  onAddByHand,
  onScanAttached,
  onSubmit,
}: Props) {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [showAll, setShowAll] = useState(false);

  const { needsLook, looksRight } = useMemo(() => splitByAttention(candidates), [candidates]);
  const editing = editingId !== null;
  const visibleLooksRight = showAll ? looksRight : looksRight.slice(0, COLLAPSED_LOOKS_RIGHT);

  // A just-opened "Add item" row is a blank form, not a reading the scanner
  // is unsure about — it correctly lands under needsLook (no name, no date),
  // but announcing that before the user has typed anything reads as an
  // accusation rather than a hint. Hidden only for that exact case: the
  // single untouched blank row. Type a letter, or add a second row, and the
  // banner is back — everything downstream still uses needsLook as-is.
  const showNeedsLookBanner = !(
    candidates.length === 1 &&
    needsLook.length === 1 &&
    !candidates[0].editedByUser &&
    candidates[0].name.trim().length === 0
  );

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <LinearGradient
        colors={[colors.washGreen, colors.washGreenFade]}
        start={{ x: 1, y: 0 }}
        end={{ x: 0.1, y: 0.5 }}
        style={styles.wash}
        pointerEvents="none"
      />

      {/* Not dimmed while a card is open, unlike the rows below it. Half
          strength put the two ways off this page and the count of what is on it
          somewhere between readable and switched off — and the open card is
          already picked out by its ring and by every other card fading, so the
          header was paying that cost for an emphasis that was already made. */}
      <View style={styles.header}>
        {photo?.uri ? (
          <TouchableOpacity onPress={onClose} hitSlop={HIT_SLOP} activeOpacity={0.7}>
            <Image source={{ uri: photo.uri }} style={styles.headerThumb} />
          </TouchableOpacity>
        ) : (
          // Nothing was photographed, so there is no thumbnail to show and the
          // slot carries the way out instead — as a link rather than a button.
          // A bordered 54pt tile in the thumbnail's place was the heaviest
          // thing on a page whose whole job is a list, and it read as a solid
          // dark block. This is the same treatment as Retake on the other side
          // of the header, which makes the two ways off this page look like the
          // pair they are.
          <TouchableOpacity
            onPress={onBack}
            hitSlop={HIT_SLOP}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            style={styles.headerBack}
          >
            <Ionicons name="chevron-back" size={17} color={colors.primaryDark} />
            <Text style={styles.headerBackText}>Back</Text>
          </TouchableOpacity>
        )}
        <View style={styles.headerText}>
          <Text style={styles.title}>
            Check {candidates.length} {candidates.length === 1 ? 'item' : 'items'}
          </Text>
          {/* "From one photo" is a lie on a row that was typed in — there is no
              photo behind it, which is exactly why the header shows a Back link
              where the thumbnail would be. */}
          <Text style={styles.subtitle}>
            {subtitle ?? (photo?.uri ? 'From one photo' : 'Typed in')}
          </Text>
        </View>
        <TouchableOpacity onPress={onRetake} hitSlop={HIT_SLOP} activeOpacity={0.7}>
          <Text style={styles.retake}>Retake</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {needsLook.length > 0 && (
          <>
            {showNeedsLookBanner && (
              <Eyebrow tone="warning" style={styles.groupLabel}>
                Needs a look · {needsLook.length}
              </Eyebrow>
            )}
            <View style={styles.group}>
              {needsLook.map((candidate) =>
                candidate.id === editingId ? (
                  <EditCard
                    key={candidate.id}
                    candidate={candidate}
                    photo={photo}
                    onPatch={(patch) => onPatch(candidate.id, patch)}
                    onScanAttached={(shot) => onScanAttached(candidate.id, shot)}
                    onCollapse={onCollapse}
                    onConfirm={() => onConfirmItem(candidate.id)}
                    onRemove={() => onRemove(candidate.id)}
                    onOpenFreshness={() => onOpenFreshness(candidate)}
                  />
                ) : (
                  <AttentionCard
                    key={candidate.id}
                    candidate={candidate}
                    photo={photo}
                    dimmed={editing}
                    onPress={() =>
                      candidate.looseProduce ? onOpenFreshness(candidate) : onEdit(candidate)
                    }
                  />
                )
              )}
            </View>
          </>
        )}

        {looksRight.length > 0 && (
          <>
            <View style={[styles.groupHeader, editing && styles.dimmed]}>
              <Eyebrow>Looks right · {looksRight.length}</Eyebrow>
              {looksRight.length > COLLAPSED_LOOKS_RIGHT && (
                <TouchableOpacity onPress={() => setShowAll((v) => !v)} hitSlop={HIT_SLOP}>
                  <Text style={styles.showAll}>{showAll ? 'Show fewer' : 'Show all'}</Text>
                </TouchableOpacity>
              )}
            </View>
            <View style={styles.group}>
              {visibleLooksRight.map((candidate) =>
                candidate.id === editingId ? (
                  <EditCard
                    key={candidate.id}
                    candidate={candidate}
                    photo={photo}
                    onPatch={(patch) => onPatch(candidate.id, patch)}
                    onScanAttached={(shot) => onScanAttached(candidate.id, shot)}
                    onCollapse={onCollapse}
                    onConfirm={() => onConfirmItem(candidate.id)}
                    onRemove={() => onRemove(candidate.id)}
                    onOpenFreshness={() => onOpenFreshness(candidate)}
                  />
                ) : (
                  <CleanCard
                    key={candidate.id}
                    candidate={candidate}
                    photo={photo}
                    dimmed={editing}
                    onPress={() =>
                      candidate.looseProduce ? onOpenFreshness(candidate) : onEdit(candidate)
                    }
                  />
                )
              )}
            </View>
          </>
        )}

        {/* Hidden, not dimmed, while a card is open. Everything else on the
            page dims because it stays relevant — you can still see the item
            above the one you are fixing. This is an action, and a greyed-out
            action that silently swaps the card you are halfway through editing
            for a new blank one is worse than no action at all. */}
        {!editing && (
          <TouchableOpacity style={styles.addByHand} onPress={onAddByHand} activeOpacity={0.7}>
            <View style={styles.addByHandBox} />
            <Text style={styles.addByHandText}>Add an item by hand</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* No footer at all while a card is open.
          The primary action stands down because finishing the card is the job
          in front of the user, and a live "Add all" beside a half-corrected row
          invites them to save the thing they were fixing. The counter that used
          to sit here — "1 left to check" — was a second way to finish, which
          "Looks right" already does, and better: it also records that the row
          was checked. Two finish buttons where one carries meaning and the
          other doesn't is how the meaningful one gets ignored.
          Backing out lives on the card itself now, next to the name. */}
      {!editing && (
        <View style={[styles.footer, { paddingBottom: space.md + insets.bottom }]}>
          <LinearGradient
            colors={[colors.surfaceFade, colors.surface]}
            style={styles.footerFade}
            pointerEvents="none"
          />
            <TouchableOpacity
              style={[styles.primary, (saving || candidates.length === 0) && styles.primaryOff]}
              onPress={onSubmit}
              disabled={saving || candidates.length === 0}
              activeOpacity={0.85}
            >
              <LinearGradient
                colors={[colors.primaryBright, colors.primaryMid]}
                start={{ x: 0.2, y: 0 }}
                end={{ x: 0.8, y: 1 }}
                style={StyleSheet.absoluteFill}
              />
              <Text style={styles.primaryText}>
                {saving
                  ? 'Adding…'
                  : (primaryLabel ??
                    `Add all ${candidates.length} to pantry`)}
              </Text>
            </TouchableOpacity>
            {/* The promise that lets people add before the data is perfect.
                Kept honest by services/scans.ts, which stores the scan and its
                unresolved rows so history can reopen it. */}
          {needsLook.length > 0 && (
            <Text style={styles.footnote}>
              You can fix {needsLook.length === 1 ? 'the one' : `the ${needsLook.length}`} later
              from history
            </Text>
          )}
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

// ─── Collapsed cards ──────────────────────────────────────────────────────

/**
 * What to call a row on screen.
 *
 * The trailing question mark means "I am not sure this is what I say it is" —
 * so it belongs on a guess the scanner made, and never on a row the user has
 * not typed into yet. A brand-new hand-added item is blank and unsure by
 * construction, which rendered as a lone "?" sitting where its name should be.
 */
function displayName(c: ScanCandidate): string {
  if (!c.name.trim()) return 'New item';
  return c.nameUnsure ? `${c.name}?` : c.name;
}

/** A card with something unresolved. The chips name it, in words. */
function AttentionCard({
  candidate,
  photo,
  dimmed,
  onPress,
}: {
  candidate: ScanCandidate;
  photo?: Capture | null;
  dimmed: boolean;
  onPress: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const chips = attentionChips(candidate);
  const chip = provenanceChip(candidate);

  return (
    <TouchableOpacity
      style={[styles.card, styles.cardAttention, dimmed && styles.dimmedCard]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <View style={styles.cardRow}>
        <ItemThumb
          size={40}
          tone="warn"
          photo={photo}
          box={candidate.box}
          ownPhotoUri={candidate.photoUri}
        />
        <View style={styles.cardBody}>
          <Text style={styles.cardName} numberOfLines={1}>
            {displayName(candidate)}
          </Text>
          <Text style={styles.cardMeta} numberOfLines={1}>
            {candidate.location ?? FALLBACK_LOCATION} · {describeQuantity(candidate)}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={17} color={colors.chevron} />
      </View>
      <View style={styles.chipRow}>
        {chips.map((text) => (
          <AttentionChip key={text}>{text}</AttentionChip>
        ))}
        <DateChip chip={chip} />
      </View>
    </TouchableOpacity>
  );
}

/** A card the scanner is confident about: name, and one provenance chip. */
function CleanCard({
  candidate,
  photo,
  dimmed,
  onPress,
}: {
  candidate: ScanCandidate;
  photo?: Capture | null;
  dimmed: boolean;
  onPress: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <TouchableOpacity
      style={[styles.card, styles.cardClean, dimmed && styles.dimmedCard]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <View style={styles.cardRow}>
        <ItemThumb
          size={34}
          tone={candidate.looseProduce ? 'warn' : 'good'}
          photo={photo}
          box={candidate.box}
          ownPhotoUri={candidate.photoUri}
        />
        <View style={styles.cardBody}>
          <Text style={styles.cardName} numberOfLines={1}>
            {displayName(candidate)}
          </Text>
          <DateChip chip={provenanceChip(candidate)} />
        </View>
        <Ionicons name="chevron-forward" size={17} color={colors.chevron} />
      </View>
    </TouchableOpacity>
  );
}

// ─── The edit card ────────────────────────────────────────────────────────

/**
 * One item, opened in place.
 *
 * Every change is written straight through to the candidate — there is no
 * Cancel and no draft to lose. "Looks right" is a confirmation, not a save: it
 * says the user has looked, which is exactly what moves the card out of "Needs
 * a look".
 */
function EditCard({
  candidate,
  photo,
  onPatch,
  onScanAttached,
  onCollapse,
  onConfirm,
  onRemove,
  onOpenFreshness,
}: {
  candidate: ScanCandidate;
  photo?: Capture | null;
  onPatch: (patch: Partial<ScanCandidate>) => void;
  onScanAttached: (photo: Capture) => void;
  onCollapse: () => void;
  onConfirm: () => void;
  onRemove: () => void;
  onOpenFreshness: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const [locationsOpen, setLocationsOpen] = useState(false);

  // The model's own alternatives first — it was looking at the packet. The food
  // catalogue fills in behind when it offered none.
  const suggestions = useMemo(() => {
    if (candidate.nameAlternatives.length > 0) return candidate.nameAlternatives.slice(0, 3);
    return suggestFoods(candidate.name)
      .map((entry) => entry.name)
      .slice(0, 3);
  }, [candidate.nameAlternatives, candidate.name]);

  function setName(name: string) {
    // Typing a catalogue name adopts its category, the same way the hand-entry
    // form used to — the chips are a shortcut, not the only route.
    const match = lookupFood(name);
    onPatch(match ? { name, category: match.category } : { name });
  }

  function setCount(next: number) {
    // Never below 1 — zero of something isn't a pantry entry, it's a delete,
    // and Remove is the control for that.
    onPatch({ count: Math.min(MAX_COUNT, Math.max(1, next)) });
  }

  async function addPhoto() {
    const picked = await pickItemPhoto();
    if (!picked) return;

    // A picture attached to a row the user hasn't named yet is very often a
    // photo of several things — they reached for the camera instead of the
    // keyboard. Reading it is almost certainly what they wanted, and it is the
    // only way they get real per-item crops and dates out of that photo. Asked,
    // never assumed: a scan they didn't request would spend a model call and
    // throw away the row they were part-way through.
    if (!candidate.name.trim() && (await offerToScan())) {
      onScanAttached(picked);
      return;
    }

    onPatch({ photoUri: picked.uri });
  }

  const chip = provenanceChip(candidate);

  return (
    <View style={styles.editCard}>
      <View style={styles.editHead}>
        {/* The item itself, cropped out of the capture. On a card asking
            "is this a cheddar?" the picture is most of the answer — and when
            there is no capture to crop, this is where a hand-added item gets a
            picture of its own. */}
        <ItemThumb
          size={52}
          tone="neutral"
          photo={photo}
          box={candidate.box}
          ownPhotoUri={candidate.photoUri}
          onPressAdd={addPhoto}
        />
        <View style={styles.cardBody}>
          <Text style={styles.editName} numberOfLines={1}>
            {displayName(candidate)}
          </Text>
          {candidate.nameUnsureReason && (
            <Text style={styles.editWhy}>{candidate.nameUnsureReason}</Text>
          )}
        </View>
        {/* The way out that isn't an answer.
            Without it, a card opened by accident can only be left via "Looks
            right" or "Remove" — so people would tap "Looks right" to escape,
            and every one of those taps is recorded as a verified-correct read.
            That would fill the accuracy data with confirmations nobody meant,
            which is worse than having no accuracy data at all. */}
        <TouchableOpacity
          onPress={onCollapse}
          hitSlop={HIT_SLOP}
          activeOpacity={0.7}
          accessibilityLabel="Close without checking this item"
        >
          <Ionicons name="chevron-up" size={20} color={colors.chevron} />
        </TouchableOpacity>
      </View>

      <Eyebrow style={styles.fieldLabel}>Name</Eyebrow>
      <View style={styles.fieldFocused}>
        <TextInput
          style={styles.fieldInput}
          value={candidate.name}
          onChangeText={setName}
          placeholder="Mature cheddar"
          placeholderTextColor={colors.mutedLight}
          // Only a name the reader was unsure of — never a blank row. A row
          // typed in by hand is unsure by definition, and opening it with the
          // keyboard already up covers the card the user was about to read
          // before they have seen any of it.
          autoFocus={candidate.nameUnsure && candidate.name.trim().length > 0}
          selectionColor={colors.primaryDark}
          returnKeyType="done"
        />
      </View>
      {suggestions.length > 0 && (
        <View style={styles.suggestionRow}>
          {suggestions.map((name) => {
            const selected = name.toLowerCase() === candidate.name.trim().toLowerCase();
            return (
              <TouchableOpacity
                key={name}
                style={[styles.suggestion, selected && styles.suggestionOn]}
                onPress={() => setName(name)}
                activeOpacity={0.7}
              >
                <Text style={[styles.suggestionText, selected && styles.suggestionTextOn]}>
                  {name}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      <View style={styles.fieldLabelRow}>
        <Eyebrow>Use by</Eyebrow>
        <DateChip chip={chip} />
      </View>
      <DateField
        value={candidate.expiryDate}
        onChange={(iso) =>
          // A date the user typed is neither printed nor guessed at, and gets
          // its own provenance rather than borrowing one. Clearing the field
          // clears the provenance with it — a source without a date would put
          // "FROM LABEL" on an empty row.
          onPatch({
            expiryDate: iso,
            dateSource: iso ? 'user' : null,
            editedByUser: true,
          })
        }
      />

      {/* Loose produce keeps its own screen for the ripeness read — the scale,
          the reasoning and the override are too much to inline here. */}
      {candidate.looseProduce && (
        <TouchableOpacity style={styles.freshnessLink} onPress={onOpenFreshness} activeOpacity={0.7}>
          <Ionicons name="leaf-outline" size={15} color={colors.primaryDark} />
          <Text style={styles.freshnessLinkText}>How ripe is it?</Text>
          <Ionicons name="chevron-forward" size={15} color={colors.primaryDark} />
        </TouchableOpacity>
      )}

      <View style={styles.editColumns}>
        <View style={styles.editColumn}>
          <View style={styles.fieldLabelRow}>
            <Eyebrow>How many</Eyebrow>
            {/* The pack size, stated but not editable here. It is read off the
                packaging and almost never wrong; putting it in a stepper is
                what produced a quantity of 70 for a 70 g bag of crisps. */}
            {candidate.size && (
              <Text style={styles.sizeNote}>
                {candidate.size.value} {candidate.size.unit} each
              </Text>
            )}
          </View>
          <View style={styles.stepper}>
            <TouchableOpacity
              style={styles.stepDown}
              onPress={() => setCount(candidate.count - 1)}
              hitSlop={HIT_SLOP}
              activeOpacity={0.7}
              accessibilityLabel="One fewer"
            >
              <Text style={styles.stepDownText}>−</Text>
            </TouchableOpacity>
            {/* Typeable as well as steppable: getting from 1 to 12 is eleven
                taps, and the number is right there on the box. */}
            <TextInput
              style={styles.stepValue}
              value={String(candidate.count)}
              onChangeText={(t) => {
                const digits = t.replace(/[^0-9]/g, '').slice(0, 2);
                // An empty box mid-edit is not a count of zero — it is a box
                // being retyped, so it holds at 1 rather than snapping.
                setCount(digits ? Number(digits) : 1);
              }}
              keyboardType="number-pad"
              selectTextOnFocus
              maxLength={2}
              selectionColor={colors.primaryDark}
              accessibilityLabel="How many"
            />
            <TouchableOpacity
              style={styles.stepUp}
              onPress={() => setCount(candidate.count + 1)}
              hitSlop={HIT_SLOP}
              activeOpacity={0.7}
              accessibilityLabel="One more"
            >
              <Text style={styles.stepUpText}>+</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.editColumn}>
          <Eyebrow style={styles.fieldLabel}>Store in</Eyebrow>
          <TouchableOpacity
            style={styles.field}
            onPress={() => setLocationsOpen((v) => !v)}
            activeOpacity={0.7}
          >
            <Text style={styles.fieldValue} numberOfLines={1}>
              {candidate.location ?? FALLBACK_LOCATION}
            </Text>
            <Ionicons name="chevron-down" size={14} color={colors.chevron} />
          </TouchableOpacity>
        </View>
      </View>
      {locationsOpen && (
        <View style={styles.suggestionRow}>
          {STORAGE_LOCATIONS.map((location) => {
            const selected = candidate.location === location;
            return (
              <TouchableOpacity
                key={location}
                style={[styles.suggestion, selected && styles.suggestionOn]}
                onPress={() => {
                  onPatch({ location });
                  setLocationsOpen(false);
                }}
                activeOpacity={0.7}
              >
                <Text style={[styles.suggestionText, selected && styles.suggestionTextOn]}>
                  {location}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      <View style={styles.editActions}>
        <TouchableOpacity style={styles.confirmButton} onPress={onConfirm} activeOpacity={0.85}>
          <LinearGradient
            colors={[colors.primaryBright, colors.primaryMid]}
            start={{ x: 0.2, y: 0 }}
            end={{ x: 0.8, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <Text style={styles.confirmButtonText}>Looks right</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onRemove} hitSlop={HIT_SLOP} activeOpacity={0.7}>
          <Text style={styles.removeText}>Remove</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  wash: {
    ...StyleSheet.absoluteFillObject,
    bottom: undefined,
    height: 320,
  },
  dimmed: {
    opacity: 0.5,
  },
  dimmedCard: {
    opacity: 0.45,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md2,
    paddingHorizontal: space.xxl,
    paddingTop: space.half,
    paddingBottom: space.lg,
  },
  headerThumb: {
    width: 54,
    height: 54,
    borderRadius: 16,
    backgroundColor: colors.backgroundAlt,
  },
  headerBack: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.half,
    // Pulled back by the icon's own side bearing so the chevron lines up with
    // the title below it rather than sitting a couple of points inside it.
    marginLeft: -3,
  },
  headerBackText: {
    fontWeight: '700',
    fontSize: type.body.fontSize,
    // 4.67:1 on the surface behind it, and the same colour as Retake.
    color: colors.primaryDark,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontFamily: fonts.display,
    fontWeight: '800',
    fontSize: type.headline.fontSize,
    lineHeight: 28,
    color: colors.primaryDarker,
    marginBottom: space.xs,
  },
  subtitle: {
    fontWeight: '600',
    fontSize: type.label.fontSize,
    lineHeight: 16,
    color: colors.textSecondary,
  },
  retake: {
    fontWeight: '700',
    fontSize: type.body.fontSize,
    color: colors.primaryDark,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: space.xxl,
    paddingBottom: space.xxl,
  },
  groupLabel: {
    marginBottom: space.sm2,
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.sm2,
  },
  showAll: {
    fontWeight: '700',
    fontSize: type.caption.fontSize,
    color: colors.primaryDark,
  },
  group: {
    gap: space.sm2,
    marginBottom: space.xl2,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 20,
    padding: space.md2,
  },
  cardAttention: {
    borderWidth: 1.5,
    borderColor: colors.amberBorder,
  },
  cardClean: {
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
    borderRadius: 18,
    paddingVertical: space.md2,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  cardBody: {
    flex: 1,
    minWidth: 0,
  },
  cardName: {
    fontWeight: '700',
    fontSize: type.body.fontSize,
    lineHeight: 18,
    color: colors.primaryDarker,
    marginBottom: space.xs2,
  },
  cardMeta: {
    fontWeight: '600',
    fontSize: type.caption.fontSize,
    lineHeight: 14,
    color: colors.textSecondary,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space.sm,
    marginTop: space.md,
  },
  addByHand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm2,
    paddingVertical: space.xs,
  },
  addByHandBox: {
    width: 19,
    height: 19,
    borderRadius: 6,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.tan,
  },
  addByHandText: {
    fontWeight: '700',
    fontSize: type.bodySmall.fontSize,
    color: colors.textSecondary,
  },

  // ─── Edit card ──────────────────────────────────────────────────────────
  editCard: {
    backgroundColor: colors.card,
    borderWidth: 2,
    borderColor: colors.primaryBright,
    borderRadius: 22,
    padding: space.lg,
    shadowColor: colors.shadow,
    shadowOpacity: 0.22,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 12 },
    elevation: 5,
  },
  editHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginBottom: space.lg,
  },
  editName: {
    fontWeight: '700',
    fontSize: type.bodyLarge.fontSize,
    lineHeight: 19,
    color: colors.primaryDarker,
    marginBottom: space.xs,
  },
  editWhy: {
    fontWeight: '600',
    fontSize: type.caption.fontSize,
    lineHeight: 16,
    color: colors.textSecondary,
  },
  fieldLabel: {
    marginBottom: space.sm,
  },
  fieldLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    // The row above it is a field with a 2pt border, and the chip on the right
    // of this one stands about twice as tall as the label on the left — so
    // with no top margin the chip's border sat a couple of points under the
    // input's and the two read as one stuck-together block. The plain `Name`
    // label above has no such problem, which is why only this row needs it.
    marginTop: space.lg,
    marginBottom: space.sm,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    minHeight: 48,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
    borderRadius: 14,
    paddingVertical: space.md,
    paddingHorizontal: space.md2,
  },
  fieldFocused: {
    minHeight: 48,
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.primaryBright,
    borderRadius: 14,
    paddingVertical: space.md,
    paddingHorizontal: space.md2,
  },
  fieldInput: {
    fontFamily: 'Nunito_700Bold',
    fontSize: type.bodyLarge.fontSize,
    color: colors.primaryDarker,
    padding: space.none,
  },
  fieldValue: {
    flex: 1,
    fontWeight: '700',
    fontSize: type.bodyLarge.fontSize,
    color: colors.primaryDarker,
  },
  suggestionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
    marginTop: space.sm2,
  },
  suggestion: {
    paddingVertical: space.sm2,
    paddingHorizontal: space.md,
    borderRadius: 999,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
  },
  suggestionOn: {
    backgroundColor: colors.primaryLighter,
    borderColor: colors.primaryLighter,
  },
  suggestionText: {
    fontWeight: '700',
    fontSize: type.caption.fontSize,
    color: colors.textSecondary,
  },
  suggestionTextOn: {
    color: colors.primaryDark,
  },
  freshnessLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 44,
    marginTop: space.xs,
  },
  freshnessLinkText: {
    flex: 1,
    fontWeight: '800',
    fontSize: type.label.fontSize,
    color: colors.primaryDark,
  },
  editColumns: {
    flexDirection: 'row',
    gap: space.sm2,
    marginTop: space.md,
  },
  editColumn: {
    flex: 1,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 48,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
    borderRadius: 14,
    paddingVertical: space.sm,
    paddingHorizontal: space.sm2,
  },
  stepDown: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: colors.backgroundAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepDownText: {
    fontWeight: '800',
    fontSize: type.bodyLarge.fontSize,
    color: colors.textSecondary,
  },
  stepValue: {
    flex: 1,
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: type.bodyLarge.fontSize,
    color: colors.primaryDarker,
    textAlign: 'center',
    padding: space.none,
  },
  sizeNote: {
    fontWeight: '700',
    fontSize: type.micro.fontSize,
    color: colors.textSecondary,
  },
  stepUp: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: colors.primaryLighter,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepUpText: {
    fontWeight: '800',
    fontSize: type.bodyLarge.fontSize,
    color: colors.primaryDark,
  },
  editActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm2,
    marginTop: space.md2,
  },
  confirmButton: {
    flex: 1,
    height: 46,
    borderRadius: 14,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmButtonText: {
    fontWeight: '800',
    fontSize: type.body.fontSize,
    color: colors.onAccent,
  },
  removeText: {
    paddingHorizontal: space.md2,
    fontWeight: '700',
    fontSize: type.bodySmall.fontSize,
    color: colors.accent,
  },

  // ─── Footer ─────────────────────────────────────────────────────────────
  footer: {
    paddingHorizontal: space.xxl,
    paddingTop: space.md,
    backgroundColor: colors.surface,
  },
  footerFade: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: -28,
    height: 28,
  },
  primary: {
    height: 56,
    borderRadius: 18,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryOff: {
    opacity: 0.6,
  },
  primaryText: {
    fontWeight: '800',
    fontSize: type.subtitle.fontSize,
    color: colors.onAccent,
  },
  footnote: {
    textAlign: 'center',
    paddingTop: space.md,
    fontWeight: '600',
    fontSize: type.caption.fontSize,
    color: colors.tabInactive,
  },
}));