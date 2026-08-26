// src/services/accuracy.ts
//
// How often the scanner was right, measured against what the user did about it.
//
// The review page is already a labelling exercise: Panzi says something, and a
// person holding the actual food either agrees, corrects it, or throws the row
// away. Storing the read as it arrived alongside the read as it was saved turns
// every scan into ground truth, collected as a by-product of work the user
// wanted to do anyway.
//
// ─── The rule this file exists to enforce ────────────────────────────────
//
// Silence is not agreement.
//
// A user who taps "Add all 6" without opening a card has confirmed nothing —
// they have declined to check. Counting those rows as correct reads would
// produce a very high accuracy figure made mostly of people not looking, and
// the number would be worse than useless: it would be confidently wrong in
// exactly the direction that flatters us.
//
// So `untouched` is tracked and then excluded from the rate. The denominator is
// only rows a human actually engaged with — confirmed plus corrected. That
// yields a smaller, slower-growing, defensible number.
//
// Measured per field, never per item. Name recognition and date reading fail
// for unrelated reasons — a folded label versus a faded thermal print — and one
// blended "94% accurate" hides which of the two is actually broken.

import { ScanCandidate } from './scan';
import { RipenessStage } from '../utils/ripeness';

export type FieldVerdict =
  /** The user opened the card and signed the value off unchanged. */
  | 'confirmed'
  /** The user changed it. The scanner was wrong. */
  | 'corrected'
  /** Saved as read, but nobody looked. Carries no evidence either way. */
  | 'untouched'
  /** The field never applied — ripeness on a tin, a date on undated produce. */
  | 'absent';

export type VerdictCounts = {
  confirmed: number;
  corrected: number;
  untouched: number;
  absent: number;
};

export type ScanAccuracy = {
  /** Rows the scan produced, before the user removed any. */
  read: number;
  /** Rows the user deleted outright — the strongest form of "wrong". */
  removed: number;
  /** Rows the user added by hand; excluded from every field verdict below,
   *  since the scanner never claimed anything about them. */
  handAdded: number;
  name: VerdictCounts;
  date: VerdictCounts;
  ripeness: VerdictCounts;
};

const EMPTY_COUNTS: VerdictCounts = { confirmed: 0, corrected: 0, untouched: 0, absent: 0 };

export function emptyAccuracy(): ScanAccuracy {
  return {
    read: 0,
    removed: 0,
    handAdded: 0,
    name: { ...EMPTY_COUNTS },
    date: { ...EMPTY_COUNTS },
    ripeness: { ...EMPTY_COUNTS },
  };
}

/** Case- and space-insensitive: "Mature Cheddar " is not a correction of
 *  "mature cheddar", and counting it as one would understate the scanner. */
function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function verdict(unchanged: boolean, confirmedByUser: boolean): FieldVerdict {
  if (!unchanged) return 'corrected';
  return confirmedByUser ? 'confirmed' : 'untouched';
}

function bump(counts: VerdictCounts, v: FieldVerdict): void {
  counts[v] += 1;
}

/**
 * Compares one scan's original read against what was saved.
 *
 * `final` is matched to `original` by candidate id. A row present in the
 * original and missing from the final was removed by the user; a row present
 * only in the final was typed in by hand and is not the scanner's claim to get
 * right or wrong.
 */
export function scanAccuracy(
  original: ScanCandidate[],
  final: ScanCandidate[]
): ScanAccuracy {
  const out = emptyAccuracy();
  const byId = new Map(final.map((c) => [c.id, c]));
  const originalIds = new Set(original.map((c) => c.id));

  out.read = original.length;
  out.handAdded = final.filter((c) => !originalIds.has(c.id)).length;

  for (const before of original) {
    const after = byId.get(before.id);

    // Removed. Not scored on any individual field — the user's judgement was
    // that the whole row shouldn't exist, which says nothing about whether the
    // date on it was legible.
    if (!after) {
      out.removed += 1;
      continue;
    }

    bump(out.name, verdict(sameName(before.name, after.name), after.userConfirmed));

    // A date the scanner never found is not a wrong date — it is an absent one,
    // and the app said so at the time. Scoring "no date found" as a failure
    // would punish the scanner for the honesty the whole design is built on.
    if (!before.expiryDate) {
      bump(out.date, after.expiryDate ? 'corrected' : 'absent');
    } else {
      bump(
        out.date,
        verdict(before.expiryDate === after.expiryDate, after.userConfirmed)
      );
    }

    if (!before.ripeness) {
      bump(out.ripeness, after.ripeness ? 'corrected' : 'absent');
    } else {
      bump(
        out.ripeness,
        verdict(before.ripeness === after.ripeness, after.userConfirmed)
      );
    }
  }

  return out;
}

function addCounts(a: VerdictCounts, b: VerdictCounts): VerdictCounts {
  return {
    confirmed: a.confirmed + b.confirmed,
    corrected: a.corrected + b.corrected,
    untouched: a.untouched + b.untouched,
    absent: a.absent + b.absent,
  };
}

/** Rolls many scans into one figure — what a claim on a landing page reads. */
export function mergeAccuracy(all: ScanAccuracy[]): ScanAccuracy {
  return all.reduce<ScanAccuracy>(
    (acc, s) => ({
      read: acc.read + s.read,
      removed: acc.removed + s.removed,
      handAdded: acc.handAdded + s.handAdded,
      name: addCounts(acc.name, s.name),
      date: addCounts(acc.date, s.date),
      ripeness: addCounts(acc.ripeness, s.ripeness),
    }),
    emptyAccuracy()
  );
}

/**
 * The defensible rate: of the reads a human actually checked, how many stood.
 *
 * `untouched` and `absent` are both excluded from the denominator, for
 * different reasons — untouched carries no evidence, and absent was never a
 * claim. Returns null rather than 0 or 1 when nothing has been checked yet,
 * because "no data" and "nothing was right" must not render as the same number.
 */
export function checkedRate(counts: VerdictCounts): number | null {
  const checked = counts.confirmed + counts.corrected;
  if (checked === 0) return null;
  return counts.confirmed / checked;
}

/** How much of the sample is evidence at all. A checked rate resting on 4% of
 *  rows is a number to keep internal, whatever it says. */
export function checkedShare(counts: VerdictCounts): number | null {
  const total = counts.confirmed + counts.corrected + counts.untouched;
  if (total === 0) return null;
  return (counts.confirmed + counts.corrected) / total;
}

export function formatRate(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`;
}

/** Named so a debug screen or a log line reads the same as this file's rules. */
export function summarise(a: ScanAccuracy): string {
  const line = (label: string, c: VerdictCounts) =>
    `${label} ${formatRate(checkedRate(c))} of ${c.confirmed + c.corrected} checked`;
  return [
    line('name', a.name),
    line('date', a.date),
    line('ripeness', a.ripeness),
    `${a.removed} removed of ${a.read} read`,
  ].join(' · ');
}

/** Re-exported for consumers building their own per-stage breakdowns. */
export type { RipenessStage };
