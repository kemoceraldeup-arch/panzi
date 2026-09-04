// src/utils/freshness.ts
//
// Turns an expiry date into the same badge style shown on the Freshness
// onboarding page (3 DAYS / USE SOON / FRESH). This is the first piece of
// the "nothing expires in the dark" promise — later, the AI recipe engine
// will use this same urgency signal to decide what to suggest cooking first.

import { Palette } from '../theme/palettes';

export type FreshnessBadge = {
  label: string;
  bg: string;
  color: string;
};

// The List screen's "use soon" group: anything within this many days, plus
// anything already past its date.
export const USE_SOON_DAYS = 3;

// Whole days from today until the date. Negative means already past. null when
// the item carries no date at all.
export function getDaysLeft(expiryDate: string | null): number | null {
  if (!expiryDate) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expiry = new Date(expiryDate);
  return Math.round((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

export function isUseSoon(expiryDate: string | null): boolean {
  const days = getDaysLeft(expiryDate);
  return days !== null && days <= USE_SOON_DAYS;
}

// The meta line's expiry clause. Coarsens as the date gets further out, so a
// tin of tomatoes reads "2 years left" rather than "743 days left".
export function formatExpiry(expiryDate: string | null): string {
  const days = getDaysLeft(expiryDate);
  if (days === null) return 'no date';
  if (days < 0) return 'expired';
  if (days === 0) return 'today';
  if (days === 1) return '1 day left';
  if (days < 14) return `${days} days left`;
  if (days < 60) {
    const weeks = Math.round(days / 7);
    return `${weeks} week${weeks === 1 ? '' : 's'} left`;
  }
  if (days < 365) {
    const months = Math.round(days / 30);
    return `${months} month${months === 1 ? '' : 's'} left`;
  }
  const years = Math.round(days / 365);
  return `${years} year${years === 1 ? '' : 's'} left`;
}

// 'YYYY-MM-DD' for a date N days from today. Built from local date parts
// rather than toISOString(), which converts to UTC first and lands on the
// wrong day for anyone west of Greenwich in the evening.
export function dateInDays(days: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

// "Sep 14" — the absolute date, for the scanner's provenance chips. Distinct
// from formatExpiry above, which is deliberately relative ("3 days left"): the
// list wants urgency, a chip wants the actual day it is claiming.
//
// Month first, matching the MM / DD / YYYY entry field, and abbreviated because
// this sits inside a chip beside words like "FROM LABEL" — "14 SEPTEMBER · YOU
// SET THIS" was wide enough to squeeze the date field it was sitting next to.
export function formatCalendarDate(expiryDate: string | null): string {
  if (!expiryDate) return '';
  // Parsed by hand — `new Date('2026-06-16')` is treated as UTC midnight and
  // renders as the 15th in negative-offset timezones.
  const [y, m, d] = expiryDate.split('-').map(Number);
  if (!y || !m || !d) return '';
  return `${MONTHS_SHORT[m - 1]} ${d}`;
}

const MONTHS_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// "October 1, 2026" — the full, unambiguous date for the scan review card's
// own "Expires" readout, where the field is the only thing on the row and
// has the width to spell the month out. Same hand-parsed split as
// formatCalendarDate above, for the same reason: `new Date('2026-10-01')` is
// UTC midnight and reads as September 30th west of Greenwich.
export function formatFullDate(expiryDate: string | null): string {
  if (!expiryDate) return '';
  const [y, m, d] = expiryDate.split('-').map(Number);
  if (!y || !m || !d) return '';
  return `${MONTHS_FULL[m - 1]} ${d}, ${y}`;
}

export function getFreshnessBadge(
  expiryDate: string | null,
  colors: Palette
): FreshnessBadge {
  if (!expiryDate) {
    return { label: 'NO DATE', bg: colors.backgroundAlt, color: colors.textSecondary };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expiry = new Date(expiryDate);
  const diffDays = Math.round((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return { label: 'EXPIRED', bg: colors.accentSoft, color: colors.accent };
  }
  if (diffDays === 0) {
    return { label: 'TODAY', bg: colors.accentSoft, color: colors.accent };
  }
  if (diffDays <= 3) {
    return { label: `${diffDays} DAY${diffDays === 1 ? '' : 'S'}`, bg: colors.accentSoft, color: colors.accent };
  }
  if (diffDays <= 7) {
    return { label: 'USE SOON', bg: colors.accentMuted, color: colors.warning };
  }
  return { label: 'FRESH', bg: colors.primaryLighter, color: colors.primaryMid };
}