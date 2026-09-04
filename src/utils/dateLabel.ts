// src/utils/dateLabel.ts
//
// Phase 2's "one shared formatter" — the single place that turns
// {expiryDate, estimatedUseBy, basis} into the words and prefix a screen
// actually shows. Before this file there were four independent answers to
// "what does this date mean" scattered across provenanceChip
// (services/scan.ts), getFreshnessBadge/formatExpiry (utils/freshness.ts),
// and a hand-rolled dateSource->words chain inside ListScreen's
// JustAddedRow — this consolidates the three that are still live (the
// fourth, DashboardScreen's getFreshnessBadge call, is dead code: that
// screen isn't wired into navigation) so a real date and an estimate can
// never accidentally share a label again.
//
// The one rule everything here exists to enforce: an estimated date must
// never be presented as if it came from a manufacturer. No shared label, no
// shared icon, no shared row style — a reviewer should be able to tell the
// two apart from across the room.

import { effectiveDate, isEstimate, DateBasis } from '../services/pantry';
import { getDaysLeft, formatExpiry, formatCalendarDate } from './freshness';

export type DatedThing = {
  expiryDate: string | null;
  estimatedUseBy?: string | null;
  basis?: DateBasis;
};

/** "Estimated" or "Expires" / "Best before" — the one-word prefix every
 *  list row and detail line puts before its date clause. Phase 2 §6:
 *  pantry rows read "Estimated · Sep 4" for an estimate, "Expires · Sep 10"
 *  for a fact. 'rough' items are still a real stored date (a chip pick like
 *  "~3 days ago"), so they get "Estimated" too — the tilde treatment in the
 *  attribution/chip layer is what actually shows the reader it was a rough
 *  pick rather than a printed one, this prefix only has to pick a side. */
export function datePrefix(item: DatedThing): 'Estimated' | 'Expires' {
  return isEstimate(item) ? 'Estimated' : 'Expires';
}

/** The full meta clause a list row shows — "Estimated · 3 days left" /
 *  "Expires · today". Always relative, reusing freshness.ts's own
 *  coarsening rather than a second copy of it. */
export function dateMetaLine(item: DatedThing): string {
  const date = effectiveDate(item);
  return `${datePrefix(item)} · ${formatExpiry(date)}`;
}

const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * "Sep 4" for a date inside the next 11 months, "Sep 4, 2027" beyond that —
 * the PANZI USE-BY ESTIMATE panel's own date rule (Phase 2 §3). Deliberately
 * never MM/DD/YYYY — that format is reserved for the typed-date input field,
 * and using it here would make an estimate look like something the user (or
 * the package) entered.
 */
export function formatEstimateDate(iso: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return '';

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(y, m - 1, d);
  const elevenMonthsOut = new Date(today);
  elevenMonthsOut.setMonth(elevenMonthsOut.getMonth() + 11);

  const withYear = target.getTime() > elevenMonthsOut.getTime();
  return withYear ? `${MONTHS_SHORT[m - 1]} ${d}, ${y}` : `${MONTHS_SHORT[m - 1]} ${d}`;
}

/**
 * The estimate panel's headline value — "Use today" when the computed date
 * has already landed on or before today (§5b rule 4: never a past date),
 * the formatted date otherwise.
 */
export function formatEstimateHeadline(iso: string | null): string {
  if (!iso) return '';
  const days = getDaysLeft(iso);
  if (days !== null && days <= 0) return 'Use today';
  return formatEstimateDate(iso);
}

/** "~Mar 14" — a rough-date chip's resolved date, always tilde-prefixed so
 *  it never reads as printed or typed (Phase 1 C5's own rule, carried
 *  forward under the new basis model). */
export function formatRoughDate(iso: string | null): string {
  if (!iso) return '';
  return `~${formatCalendarDate(iso)}`;
}

/**
 * The item-detail attribution line (Phase 2 §6): "From the product
 * package" / "Entered by you" for a fact, "Based on: fresh meat, fridge,
 * added Sep 2." for an estimate — the one line naming the inputs, not just
 * the generic "Based on the food type and storage method." the card itself
 * shows while choosing. `foodClassLabel`/`storedInLabel` are passed in
 * rather than re-derived here, since the caller already has them (and a
 * stale category shouldn't silently reclassify a saved estimate's own
 * explanation of itself).
 */
export function attributionLine(
  item: DatedThing,
  detail?: { foodClassLabel: string; storedInLabel: string; from: string }
): string {
  if (item.basis === 'printed') return 'From the product package';
  if (item.basis === 'manual') return 'Entered by you';
  if (item.basis === 'rough') return 'A rough date you picked';
  if (detail) {
    return `Based on: ${detail.foodClassLabel.toLowerCase()}, ${detail.storedInLabel.toLowerCase()}, added ${formatCalendarDate(detail.from)}.`;
  }
  return 'Based on the food type and storage method.';
}

/**
 * The one-item notification clause (Phase 2 §6) — "goes off today" for a
 * real date, "may need using today" for an estimate, never "expires" on an
 * estimate. `when` is 'today' | 'tomorrow', matching composeDigest's own
 * two singular cases; composeDigest still owns the sentence shape, this
 * just supplies the verb clause so the fact/estimate distinction can't be
 * dropped by a future edit to that file's templates.
 */
export function notificationClause(item: DatedThing, when: 'today' | 'tomorrow'): string {
  return isEstimate(item) ? `may need using ${when}` : `goes off ${when}`;
}
