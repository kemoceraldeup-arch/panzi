// src/utils/datePart.ts
//
// Keystroke rules for the MM / DD boxes of a typed date. Both date inputs —
// the use-by field and the "When was it opened?" picker — run every change
// through this, so a month can never read 13 and a day never 32 in either.
//
// A value that would go out of range is refused outright (the box keeps what
// it had) rather than clamped: turning a typed "45" into "31" would put a
// date on the item the user never entered.

export type DatePartKey = 'month' | 'day' | 'year';

const MAX: Record<Exclude<DatePartKey, 'year'>, number> = { month: 12, day: 31 };

/**
 * The box's new text for a change from `previous` to `raw`, and whether the
 * box is finished and focus should move on.
 *
 * A first digit that can't start a two-digit value — 2–9 for a month, 4–9
 * for a day — is already the whole answer, so it's written with its leading
 * zero ("5" → "05") and the box is done. Without that, typing "5" for May
 * would sit waiting for a second digit that could only push it past 12.
 */
export function nextDatePart(
  key: DatePartKey,
  raw: string,
  previous: string,
): { value: string; complete: boolean } {
  const width = key === 'year' ? 4 : 2;
  const digits = raw.replace(/[^0-9]/g, '').slice(0, width);
  if (key === 'year') return { value: digits, complete: digits.length === width };

  const max = MAX[key];
  if (digits.length === 0) return { value: '', complete: false };

  if (digits.length === 1) {
    const n = Number(digits);
    // Only the first digit's ceiling matters here: 1 for months (10–12),
    // 3 for days (30–31).
    if (n > Math.floor(max / 10)) return { value: `0${digits}`, complete: true };
    return { value: digits, complete: false };
  }

  const n = Number(digits);
  if (n < 1 || n > max) return { value: previous, complete: false };
  return { value: digits, complete: true };
}
