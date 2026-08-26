// src/screens/HomeScreen.tsx

import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Animated,
  Easing,
} from 'react-native';
import Text from '../components/Text';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '../auth/AuthProvider';
import { subscribeToProfile } from '../services/profile';
import { FOOD_CATEGORIES, PantryItem, subscribeToPantryItems } from '../services/pantry';
import { ScanRecord, subscribeToScans } from '../services/scans';
import { formatExpiry, getDaysLeft, USE_SOON_DAYS } from '../utils/freshness';
import { attentionCount, currentAttention } from '../services/notifications';
import { RIPENESS_LABELS, isUrgentStage } from '../utils/ripeness';
import PulsingMascot from '../components/PulsingMascot';
import FloatingChatBubble from '../components/home/FloatingChatBubble';
import { SCAN_BUTTON_LIFT } from '../navigation/TabBar';
import { fonts, type } from '../theme/typography';
import { makeStyles } from '../theme/makeStyles';
import { useColors } from '../theme/ThemeProvider';
import { space } from '../theme/spacing';

// Brings the "See all" link's touch target to the 44pt minimum without giving
// it a box of its own.
const HIT_SLOP = { top: 12, bottom: 12, left: 12, right: 12 };

// What the pantry looks like at a glance.
//
// The three states are the ones the data can actually answer. "Low stock" —
// the obvious fourth — is deliberately absent: quantity is stored as free text
// ("250 g", "1 pack", "2"), so there is no threshold to compare against and no
// honest way to count it. It becomes possible if quantity ever splits into a
// number and a unit with a per-item minimum; until then a red dot claiming
// "4 low stock" would be decoration.
type PantryStatus = {
  total: number;
  expired: number;
  useSoon: number;
  fresh: number;
};

const EMPTY_STATUS: PantryStatus = { total: 0, expired: 0, useSoon: 0, fresh: 0 };

function summarise(items: { expiryDate: string | null }[]): PantryStatus {
  let expired = 0;
  let useSoon = 0;

  for (const item of items) {
    const days = getDaysLeft(item.expiryDate);
    // No date means nothing is known, which is not the same as fresh — but it
    // is not urgent either, so it falls in with the rest.
    if (days === null) continue;
    if (days < 0) expired += 1;
    else if (days <= USE_SOON_DAYS) useSoon += 1;
  }

  return { total: items.length, expired, useSoon, fresh: items.length - expired - useSoon };
}

function getGreetingLabel() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

// Tab switches unmount/remount HomeScreen, which tears the listeners down with
// it and would otherwise reset the name to null and flash "Hey there" every
// time the user comes back to this tab. Caching by uid means only the very
// first load can flash.
const nameCache = new Map<string, string | null>();
const statusCache = new Map<string, PantryStatus>();
const urgentCache = new Map<string, PantryItem[]>();

// How many items the "Eat these first" card names before it stops. Three,
// because the card is a prompt to go and cook, not the inventory — a list long
// enough to scroll is the Pantry tab's job, and this one links straight to it.
const URGENT_PREVIEW = 3;

/**
 * The items that actually need eating, soonest first.
 *
 * Home used to say "3 items to use soon" and make the user go and find out
 * which. The count answers a question nobody asked; the names answer the one
 * they opened the app with.
 */
function pickUrgent(items: PantryItem[]): PantryItem[] {
  return items
    .filter((item) => {
      // Produce the scanner judged past its best is urgent whatever its date
      // says — the fruit is the evidence, and it may never have had a date.
      if (item.ripeness && isUrgentStage(item.ripeness)) return true;
      const days = getDaysLeft(item.expiryDate);
      return days !== null && days <= USE_SOON_DAYS;
    })
    .sort((a, b) => {
      const ad = getDaysLeft(a.expiryDate) ?? 0;
      const bd = getDaysLeft(b.expiryDate) ?? 0;
      return ad - bd;
    })
    .slice(0, URGENT_PREVIEW);
}

/**
 * Why this item is on the list — "eat today", "2 days left", "very ripe".
 *
 * Ripeness wins when there is one, because it is the more useful sentence: it
 * describes the fruit in the bowl rather than a date nobody printed on it.
 */
function urgentReason(item: PantryItem): string {
  if (item.ripeness && isUrgentStage(item.ripeness)) {
    return RIPENESS_LABELS[item.ripeness].toLowerCase();
  }
  const days = getDaysLeft(item.expiryDate);
  if (days !== null && days < 0) return 'past its date';
  if (days === 0) return 'eat today';
  return formatExpiry(item.expiryDate);
}

// The greeting's third line. The design's "3 recipes use what's expiring" is
// about the recipe engine, which doesn't exist yet — so this says the true
// thing the same data supports: what the pantry itself needs eating.
function useSoonLabel(status: PantryStatus): string {
  const urgent = status.expired + status.useSoon;
  if (status.total === 0) return 'Your pantry is empty — scan something in';
  if (urgent === 0) return 'Nothing needs using right now';
  return `${urgent} item${urgent === 1 ? '' : 's'} to use soon`;
}

// How many categories the "What you've got" strip names before collapsing the
// rest into "+N more". Four fits two comfortable rows on a narrow phone; more
// than that and it stops being glanceable, which is the only thing it is for.
const CATEGORY_PREVIEW = 4;

export type CategoryCount = { category: string; count: number };

/**
 * What the pantry holds, biggest group first.
 *
 * Sorted by count rather than the canonical category order because the strip
 * answers "what have I actually got", and a fixed order would show the same
 * four headings forever — hiding twenty snacks behind an empty "Bakery". Ties
 * break on the canonical order so the row doesn't reshuffle at random.
 */
function countCategories(items: PantryItem[]): CategoryCount[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    if (!item.category) continue;
    counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort(
      (a, b) =>
        b.count - a.count ||
        FOOD_CATEGORIES.indexOf(a.category) - FOOD_CATEGORIES.indexOf(b.category)
    );
}

const categoryCache = new Map<string, CategoryCount[]>();

// Only the most recent unfinished scan is offered. A stack of them would turn
// Home into a chore list, and the one the user half-finished ten minutes ago is
// the one they still remember taking.
const UNFINISHED_CACHE = new Map<string, ScanRecord | null>();

type Props = {
  onOpenChat: () => void;
  /** Reopens a past scan that still has rows missing a date. */
  onFinishScan: (scan: ScanRecord) => void;
  /** Opens the pantry already filtered to one category, or all of it. */
  onViewCategory: (category: string | null) => void;
  /** Opens the scanner. Only offered from the first-run state, where it is the
   *  single thing worth doing. */
  /**
   * Opens the notification panel behind the bell, owned by MainTabs.
   *
   * Takes the bell's position on screen so the panel can hang off it rather
   * than guessing at a corner — the header sits under a safe-area inset that
   * differs on every device, and a dropdown a few points adrift of the control
   * that opened it reads as a floating box rather than as that control's menu.
   */
  onOpenNotifications: (anchor: { x: number; y: number; width: number; height: number }) => void;
  onScan: () => void;
  /** Types an item in by hand — the quiet alternative on first run. */
  onAddByHand: () => void;
  /** Sends the user to the inventory — the card's whole reason to exist. */
  onViewPantry: () => void;
  /**
   * Whether Home is the tab currently on screen. Home stays mounted the
   * whole time any tab is open (see MainTabs), so this is the only signal
   * that "the user just arrived back here" still exists to react to — a
   * mount effect would only ever fire once, on first login.
   */
  active: boolean;
};

export default function HomeScreen({
  onOpenChat,
  onFinishScan,
  onViewCategory,
  onOpenNotifications,
  onScan,
  onAddByHand,
  onViewPantry,
  active,
}: Props) {
  const styles = useStyles();
  const colors = useColors();
  const { uid } = useAuth();
  const [name, setName] = useState<string | null>(() => (uid ? nameCache.get(uid) ?? null : null));
  // null until the pantry has been read once — the card stays out rather than
  // claiming "0 items tracked" before anything has loaded.
  // Measured on press rather than on layout: the header scrolls, so where the
  // bell was when it rendered is not where it is when it is tapped.
  const bellRef = useRef<View>(null);

  // What the bell's panel will actually list. Held separately from `status`
  // because the two count different things: the pantry card's "use soon" is a
  // three-day window, while the panel — and the notification — only speak up
  // about today, tomorrow, and the recently expired.
  const [pending, setPending] = useState(0);

  const [status, setStatus] = useState<PantryStatus | null>(
    () => (uid ? statusCache.get(uid) ?? null : null)
  );
  const [urgent, setUrgent] = useState<PantryItem[]>(
    () => (uid ? urgentCache.get(uid) ?? [] : [])
  );
  const [unfinished, setUnfinished] = useState<ScanRecord | null>(
    () => (uid ? UNFINISHED_CACHE.get(uid) ?? null : null)
  );
  const [categories, setCategories] = useState<CategoryCount[]>(
    () => (uid ? categoryCache.get(uid) ?? [] : [])
  );

  // Live rather than fetched once: renaming yourself on the Profile tab has to
  // change the greeting here, and this screen stays mounted the whole time the
  // Pantry tab is open. Same listener the Profile tab uses.
  useEffect(() => {
    if (!uid) return;
    return subscribeToProfile(
      uid,
      (profile) => {
        nameCache.set(uid, profile.name);
        setName(profile.name);
      },
      () => {
        // A dropped listener keeps the last greeting rather than falling back
        // to "Hey there" — the name is decoration, not something to error on.
      }
    );
  }, [uid]);

  // Same pantry subscription the Pantry tab runs, read here for its summary:
  // adding or eating something there has to move this card, the greeting line
  // and the bell's dot without a reload.
  useEffect(() => {
    if (!uid) return;
    return subscribeToPantryItems(
      uid,
      (items) => {
        const next = summarise(items);
        statusCache.set(uid, next);
        setStatus(next);

        const soonest = pickUrgent(items);
        urgentCache.set(uid, soonest);
        setUrgent(soonest);

        const groups = countCategories(items);
        categoryCache.set(uid, groups);
        setCategories(groups);

        setPending(attentionCount(currentAttention(items)));
      },
      () => {
        // Same reasoning as the profile listener: keep the last known count
        // rather than replacing the header with an error.
      }
    );
  }, [uid]);

  // Scans the user added while some rows still had no date. The review page
  // promised those could be fixed later; this is what makes "later" arrive
  // somewhere they actually look, rather than behind the clock icon inside the
  // camera screen.
  useEffect(() => {
    if (!uid) return;
    return subscribeToScans(
      uid,
      (scans) => {
        const next = scans.find((s) => s.unresolvedCount > 0) ?? null;
        UNFINISHED_CACHE.set(uid, next);
        setUnfinished(next);
      },
      () => {
        // Same reasoning as the profile listener: keep the last known count
        // rather than replacing the header with an error.
      }
    );
  }, [uid]);

  return (
    <View style={styles.container}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.greetingSmall}>{getGreetingLabel()}</Text>
            <Text style={styles.greetingBig}>{name ? `Hey, ${name}` : 'Hey there'}</Text>
            {status !== null && (
              <Text style={styles.greetingSubtitle}>{useSoonLabel(status)}</Text>
            )}
          </View>
          <TouchableOpacity
            ref={bellRef}
            style={styles.bellButton}
            onPress={() =>
              bellRef.current?.measureInWindow((x, y, width, height) =>
                onOpenNotifications({ x, y, width, height })
              )
            }
            accessibilityRole="button"
            accessibilityLabel="Notifications"
          >
            <Ionicons name="notifications-outline" size={20} color={colors.primaryDarker} />
            {/* Counts exactly what the panel will list, which is why it is a
                number and not a dot: "3" is worth opening for, and a bare dot
                said the same thing whether one yoghurt or the whole shelf was
                about to go. Capped so a stocked pantry cannot widen it past
                the button it sits on. */}
            {pending > 0 && (
              <View style={styles.bellBadge}>
                <Text style={styles.bellBadgeText}>{pending > 9 ? '9+' : pending}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        {/* ─── First run ───────────────────────────────────────────────
            Every card below this is conditional on having food on the
            shelves, so on day one they all hide at once and Home collapses to
            a greeting and an empty counter. That is the screen a new user
            actually lands on, and it was the weakest in the app: the moment
            someone decides whether to keep it, spent looking at nothing.
            So an empty pantry gets its own screen rather than a hollow
            version of the full one — Panzi at proper size, one thing to do,
            and a plain sentence about what the scanner is for.
            Gated on `status !== null` so the loading frame doesn't flash this
            at a returning user with a full pantry. */}
        {status !== null && status.total === 0 ? (
          <View style={styles.firstRun}>
            <View style={styles.firstRunMascotWrap}>
              <Image
                source={require('../../assets/mascot/panzi-hero.png')}
                style={styles.firstRunMascot}
                resizeMode="contain"
              />
              {/* The source art is cropped flush to its own canvas at the
                  bottom, so at this size the hard edge of the PNG reads as a
                  visible line under the mascot. Fading the last stretch into
                  the screen background hides that cut without touching the
                  asset itself. */}
              <LinearGradient
                colors={[
                  colors.backgroundLightFade,
                  colors.backgroundLightFade,
                  colors.backgroundLight,
                ]}
                locations={[0, 0.35, 1]}
                style={styles.firstRunMascotFade}
                pointerEvents="none"
              />
            </View>
            <Text style={styles.firstRunTitle}>Nothing on your shelves yet</Text>
            <Text style={styles.firstRunBody}>
              Point me at your shopping and I'll write it down — I read the date off the label,
              and I can tell how ripe your fruit is.
            </Text>

            {/* The tab bar's scan button is a wordless circle. On the one screen
                where the user has never scanned anything, the action needs to
                say what it is. */}
            <TouchableOpacity style={styles.firstRunPrimary} onPress={onScan} activeOpacity={0.85}>
              <Ionicons name="scan-outline" size={18} color={colors.onAccent} />
              <Text style={styles.firstRunPrimaryText}>Scan your first item</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={onAddByHand} hitSlop={HIT_SLOP} activeOpacity={0.7}>
              <Text style={styles.firstRunSecondary}>or type one in</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
        {/* Panzi sits in the flow, above the suggestion it's offering to
            replace: ask first, or take what's below. It used to float over the
            list pinned above the scan button, which meant it permanently
            covered a strip of content and the scroll had to reserve a matching
            gap to compensate. In flow it obscures nothing, and it's still on
            screen without scrolling. */}
        <View style={styles.askCard}>
          {/* maxScale is capped by the card's 8pt padding — the ring grows
              size × (maxScale − 1) / 2 beyond the avatar, so 1.4 on 34pt
              reaches 6.8pt and stays inside the rounded corner. Raising one
              without the other puts the pulse back outside the card. */}
          <PulsingMascot size={34} maxScale={1.4} onPress={onOpenChat} />
          <TouchableOpacity style={styles.askInput} onPress={onOpenChat} activeOpacity={0.8}>
            <Text style={styles.askPlaceholder}>Ask Panzi what to cook...</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.askSend} onPress={onOpenChat}>
            <Text style={styles.askSendArrow}>›</Text>
          </TouchableOpacity>
        </View>

        {/* Collecting on the promise the review page made.
            A user is allowed to add a batch with rows still missing a date
            because the footer told them they could fix those later. Until now
            "later" meant remembering to open the camera and tap a clock icon —
            a place nobody goes looking for unfinished work. Absent whenever
            every scan is complete, which is most days. */}
        {unfinished && (
          <TouchableOpacity
            style={styles.unfinishedCard}
            onPress={() => onFinishScan(unfinished)}
            activeOpacity={0.85}
          >
            <View style={styles.unfinishedIcon}>
              <Ionicons name="time-outline" size={18} color={colors.rust} />
            </View>
            <View style={styles.unfinishedBody}>
              <Text style={styles.unfinishedTitle} numberOfLines={1}>
                {unfinished.sceneLabel}
              </Text>
              <Text style={styles.unfinishedMeta} numberOfLines={1}>
                {unfinished.unresolvedCount} of {unfinished.candidates.length}
                {unfinished.unresolvedCount === 1 ? ' still needs' : ' still need'} a date
              </Text>
            </View>
            <Text style={styles.unfinishedAction}>Finish</Text>
          </TouchableOpacity>
        )}

        {/* The point of the whole app, on the first screen. The status card
            below counts what needs eating; this names it, which is the only
            form of that information anyone can act on without tapping
            through. Absent entirely when nothing is urgent — a card that
            appears every day saying "nothing to worry about" is a card people
            learn to skip, and then they skip it on the day it matters. */}
        {urgent.length > 0 && (
          <View style={styles.urgentCard}>
            <View style={styles.urgentHeader}>
              <Text style={styles.urgentTitle}>Eat these first</Text>
              <TouchableOpacity onPress={onViewPantry} hitSlop={HIT_SLOP}>
                <Text style={styles.urgentLink}>See all</Text>
              </TouchableOpacity>
            </View>
            {urgent.map((item, i) => (
              <View key={item.id} style={[styles.urgentRow, i > 0 && styles.urgentRowDivided]}>
                <View style={styles.urgentDot} />
                <Text style={styles.urgentName} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={styles.urgentReason}>{urgentReason(item)}</Text>
              </View>
            ))}
          </View>
        )}

        {/* What the pantry holds, and the way into it. Home's job now that
            recipes have their own tab: answer "what have I got" before the
            user has to go and look. */}
        <TouchableOpacity
          style={styles.statusCard}
          onPress={onViewPantry}
          activeOpacity={0.85}
          disabled={status === null}
        >
          <Text style={styles.statusLabel}>Your pantry</Text>
          <Text style={styles.statusCount}>
            {status === null
              ? 'Loading…'
              : `${status.total} item${status.total === 1 ? '' : 's'} tracked`}
          </Text>

          {!!status && status.total > 0 && (
            <View style={styles.statusRow}>
              <StatusDot color={colors.primary} label="Fresh" count={status.fresh} />
              <StatusDot color={colors.warning} label="Use soon" count={status.useSoon} />
              <StatusDot color={colors.accent} label="Expired" count={status.expired} />
            </View>
          )}

          <View style={styles.statusLink}>
            <Text style={styles.statusLinkText}>
              {status?.total === 0 ? 'Add your first item' : 'View pantry'}
            </Text>
            <Ionicons name="arrow-forward" size={14} color={colors.primaryDark} />
          </View>
        </TouchableOpacity>

        {/* What the pantry actually holds.
            The card above says how *much* — "39 items tracked" — and never says
            *what*, so the question people open the app with ("have I got
            anything for dinner?") still meant tapping through and reading a
            list. This answers it in a glance, and each group opens the pantry
            already filtered to it.
            Unlike the two cards above, this one stays put: it is a standing
            answer rather than an alert, so it has nothing to hide when
            everything is fine. It only goes away when the pantry is empty,
            where there is genuinely nothing to describe. */}
        {categories.length > 0 && (
          <View style={styles.groupsCard}>
            <Text style={styles.groupsLabel}>What you've got</Text>
            <View style={styles.groupsRow}>
              {categories.slice(0, CATEGORY_PREVIEW).map((group) => (
                <TouchableOpacity
                  key={group.category}
                  style={styles.groupChip}
                  onPress={() => onViewCategory(group.category)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.groupName} numberOfLines={1}>
                    {group.category}
                  </Text>
                  <Text style={styles.groupCount}>{group.count}</Text>
                </TouchableOpacity>
              ))}
              {categories.length > CATEGORY_PREVIEW && (
                <TouchableOpacity
                  style={[styles.groupChip, styles.groupChipMore]}
                  onPress={() => onViewCategory(null)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.groupMoreText}>
                    +{categories.length - CATEGORY_PREVIEW} more
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}
          </>
        )}
      </ScrollView>
      {/* Floats over the screen rather than living in the scroll flow, fixed
          bottom-right above the tab bar. Mounted only on an empty pantry —
          the moment status.total leaves 0 this unmounts on its own, no
          separate check needed for "gone once there's food on the shelves".
          MainTabs.tsx unmounts this whole screen on every tab switch, which
          is also what makes the bubble's entrance animation replay each time
          Home becomes the active tab again — a side effect of that existing
          behaviour, not something this component has to orchestrate itself. */}
      {status !== null && status.total === 0 && (
        <FloatingChatBubble onPress={onOpenChat} active={active} />
      )}
    </View>
  );
}

// One state and its count. The dot carries the colour the List screen already
// uses for that urgency, so the two screens agree at a glance.
function StatusDot({ color, label, count }: { color: string; label: string; count: number }) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={styles.statusDotRow}>
      <View style={[styles.statusDot, { backgroundColor: color }]} />
      <Text style={styles.statusDotCount}>{count}</Text>
      <Text style={styles.statusDotLabel}>{label}</Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: {
    flex: 1,
    backgroundColor: colors.backgroundLight,
  },
  content: {
    paddingHorizontal: space.xl,
    paddingTop: space.md,
    // Just the tab bar and the scan button raised out of it. The Panzi card is
    // in the flow now, so there's no floating element to reserve a gap for.
    paddingBottom: SCAN_BUTTON_LIFT + 34 + 24,
    gap: space.xl,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  greetingSmall: {
    fontWeight: '700',
    fontSize: type.label.fontSize,
    color: colors.primary,
    marginBottom: space.half,
  },
  greetingBig: {
    fontWeight: '800',
    fontSize: type.headline.fontSize,
    color: colors.primaryDarker,
  },
  greetingSubtitle: {
    fontWeight: '600',
    fontSize: type.label.fontSize,
    color: colors.textSecondary,
    marginTop: space.xs,
  },
  bellButton: {
    width: 44,
    height: 44,
    borderRadius: 999,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bellBadge: {
    position: 'absolute',
    top: 4,
    right: 2,
    minWidth: 18,
    height: 18,
    borderRadius: 999,
    paddingHorizontal: space.xs,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
    // A ring in the button's own colour, so the badge reads as sitting on the
    // bell rather than merging into the icon behind it.
    borderWidth: 2,
    borderColor: colors.card,
  },
  bellBadgeText: {
    fontWeight: '800',
    fontSize: type.micro.fontSize,
    lineHeight: 14,
    color: colors.onAccent,
  },
  firstRun: {
    alignItems: 'center',
    paddingTop: space.md,
    paddingHorizontal: space.sm,
  },
  firstRunMascotWrap: {
    // Big enough to be the character rather than an icon. This is the one
    // screen with room for it — everywhere else Panzi is a 34pt avatar.
    width: 220,
    height: 220,
    marginBottom: space.lg2,
  },
  firstRunMascot: {
    width: '100%',
    height: '100%',
  },
  firstRunMascotFade: {
    // Bottom-only, tall enough to fully cover the source art's own
    // hard-edged canvas cut — not spread higher into the torso/apron, which
    // stays fully opaque. Three gradient stops (see the LinearGradient call)
    // keep the top of this band transparent and only start blending in the
    // back half, for a softer, more gradual fade than a straight two-stop
    // ramp across the whole height.
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 120,
  },
  firstRunTitle: {
    fontFamily: fonts.display,
    fontWeight: '800',
    fontSize: type.headline.fontSize,
    lineHeight: 29,
    textAlign: 'center',
    color: colors.primaryDarker,
    marginBottom: space.sm2,
  },
  firstRunBody: {
    fontWeight: '600',
    fontSize: type.bodySmall.fontSize,
    lineHeight: 21,
    textAlign: 'center',
    color: colors.textSecondary,
    marginBottom: space.xxl2,
  },
  firstRunPrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm2,
    alignSelf: 'stretch',
    height: 56,
    borderRadius: 18,
    backgroundColor: colors.primary,
    marginBottom: space.md2,
  },
  firstRunPrimaryText: {
    fontWeight: '800',
    fontSize: type.bodyLarge.fontSize,
    color: colors.onAccent,
  },
  firstRunSecondary: {
    fontWeight: '700',
    fontSize: type.bodySmall.fontSize,
    color: colors.textSecondary,
    paddingVertical: space.xs,
  },
  groupsCard: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.borderWarm,
    borderRadius: 22,
    paddingHorizontal: space.lg,
    paddingVertical: space.md2,
  },
  groupsLabel: {
    fontWeight: '800',
    fontSize: type.micro.fontSize,
    letterSpacing: 1.54,
    textTransform: 'uppercase',
    color: colors.tabInactive,
    marginBottom: space.md,
  },
  groupsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  groupChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    // Clears the 44pt minimum without a box big enough to dominate the card.
    minHeight: 44,
    maxWidth: '100%',
    paddingHorizontal: space.md2,
    borderRadius: 999,
    backgroundColor: colors.primaryWash,
    borderWidth: 1,
    borderColor: colors.primaryLine,
  },
  groupChipMore: {
    backgroundColor: colors.card,
    borderColor: colors.backgroundAlt,
  },
  groupName: {
    flexShrink: 1,
    fontWeight: '700',
    fontSize: type.label.fontSize,
    color: colors.primaryDarker,
  },
  groupCount: {
    fontWeight: '800',
    fontSize: type.label.fontSize,
    color: colors.primaryDark,
    flexShrink: 0,
  },
  groupMoreText: {
    fontWeight: '700',
    fontSize: type.label.fontSize,
    color: colors.textSecondary,
  },
  unfinishedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: colors.card,
    // The same amber edge the unfinished rows carry on the review page and in
    // scan history, so the three places that talk about incomplete work agree
    // on what incomplete looks like.
    borderWidth: 1.5,
    borderColor: colors.amberBorder,
    borderRadius: 22,
    paddingVertical: space.md2,
    paddingHorizontal: space.lg,
  },
  unfinishedIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  unfinishedBody: {
    flex: 1,
    minWidth: 0,
  },
  unfinishedTitle: {
    fontWeight: '700',
    fontSize: type.body.fontSize,
    lineHeight: 18,
    color: colors.primaryDarker,
    marginBottom: space.xs,
  },
  unfinishedMeta: {
    fontWeight: '700',
    fontSize: type.caption.fontSize,
    lineHeight: 15,
    color: colors.rust,
  },
  unfinishedAction: {
    fontWeight: '800',
    fontSize: type.bodySmall.fontSize,
    color: colors.primaryDark,
    flexShrink: 0,
  },
  urgentCard: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.warmBorder,
    borderRadius: 22,
    paddingHorizontal: space.lg,
    paddingVertical: space.md2,
  },
  urgentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.sm2,
  },
  urgentTitle: {
    fontFamily: fonts.display,
    fontWeight: '700',
    fontSize: type.subtitle.fontSize,
    color: colors.primaryDarker,
  },
  urgentLink: {
    fontWeight: '700',
    fontSize: type.caption.fontSize,
    color: colors.primaryDark,
  },
  urgentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm2,
    paddingVertical: space.sm2,
  },
  urgentRowDivided: {
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  urgentDot: {
    width: 7,
    height: 7,
    borderRadius: 999,
    backgroundColor: colors.accent,
    flexShrink: 0,
  },
  urgentName: {
    flex: 1,
    minWidth: 0,
    fontWeight: '700',
    fontSize: type.bodySmall.fontSize,
    color: colors.primaryDarker,
  },
  urgentReason: {
    fontWeight: '800',
    fontSize: type.caption.fontSize,
    color: colors.accentDeep,
    flexShrink: 0,
  },
  statusCard: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
    borderRadius: 26,
    paddingVertical: space.xl,
    paddingHorizontal: space.xl,
    gap: space.xs,
  },
  statusLabel: {
    fontWeight: '800',
    fontSize: type.micro.fontSize,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: colors.textSecondary,
  },
  statusCount: {
    fontWeight: '800',
    fontSize: type.headline.fontSize,
    color: colors.primaryDarker,
  },
  statusRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.lg,
    marginTop: space.md2,
  },
  statusDotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs2,
  },
  statusDot: {
    width: 9,
    height: 9,
    borderRadius: 999,
  },
  statusDotCount: {
    fontWeight: '800',
    fontSize: type.bodySmall.fontSize,
    color: colors.primaryDarker,
  },
  statusDotLabel: {
    fontWeight: '600',
    fontSize: type.label.fontSize,
    color: colors.textSecondary,
  },
  statusLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs2,
    marginTop: space.lg2,
  },
  statusLinkText: {
    fontWeight: '800',
    fontSize: type.bodySmall.fontSize,
    color: colors.primaryDark,
  },
  askCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm2,
    // 12 rather than 10 so the mascot's pulse ring clears the rounded corner
    // with a little margin — see the note at the PulsingMascot call site.
    paddingLeft: space.sm,
    paddingRight: space.sm,
    paddingVertical: space.sm,
    // Full-round rather than the 26 the recipe cards use. At 52pt tall the
    // corner radius would nearly meet in the middle anyway, so a pill is the
    // honest shape — and it reads as a slim input bar, not a short card.
    // Flat like the recipe cards: the shadow this carried was there to lift it
    // off content scrolling underneath, which no longer happens in the flow.
    borderRadius: 999,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.backgroundAlt,
  },
  // The card itself is the white surface now, so the field reads as a well
  // inside it rather than a second white box on white.
  askInput: {
    flex: 1,
    height: 36,
    borderRadius: 999,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    paddingHorizontal: space.md2,
  },
  askPlaceholder: {
    fontSize: type.bodySmall.fontSize,
    color: colors.textSecondary,
  },
  askSend: {
    width: 34,
    height: 34,
    borderRadius: 999,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  askSendArrow: {
    fontWeight: '700',
    fontSize: type.subtitle.fontSize,
    color: colors.onAccent,
  },
}));