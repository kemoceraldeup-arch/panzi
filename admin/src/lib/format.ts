// The small derivations the prototype did inline in renderVals(): initials,
// chip colours, bar colours. Here rather than in the screens so that "Active is
// green" is decided once.

import type { LogLevel, UserStatus } from '../api/types';

export interface ChipColors {
  bg: string;
  fg: string;
}

/** First letter of each of the first two words, as in the prototype. */
export function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export function statusChip(status: UserStatus): ChipColors {
  if (status === 'Active') return { bg: 'var(--green-chip-bg)', fg: 'var(--green-deep)' };
  if (status === 'Dormant') return { bg: 'var(--chip-neutral)', fg: 'var(--ink-muted)' };
  return { bg: 'var(--clay-chip-bg)', fg: 'var(--clay)' };
}

export function levelChip(level: LogLevel): ChipColors {
  if (level === 'ERROR') return { bg: 'var(--clay-chip-bg)', fg: 'var(--clay)' };
  if (level === 'WARN') return { bg: 'var(--amber-chip-bg)', fg: 'var(--amber-text)' };
  if (level === 'DEBUG') return { bg: 'var(--chip-neutral)', fg: 'var(--ink-muted)' };
  return { bg: 'var(--green-chip-bg)', fg: 'var(--green-deep)' };
}

/** Anything due tomorrow is urgent; the rest is a warning. */
export function dueChip(due: string): ChipColors {
  return due.startsWith('1 ')
    ? { bg: 'var(--clay-chip-bg)', fg: 'var(--clay)' }
    : { bg: 'var(--amber-chip-bg)', fg: 'var(--amber-text)' };
}

export function accuracyColor(acc: number): string {
  if (acc >= 95) return 'var(--green-deep)';
  if (acc >= 90) return 'var(--green-primary)';
  return 'var(--amber)';
}

/**
 * The chip on a dish card, from its ratings rather than from a publishing
 * state nothing ever set. A dish most people liked reads as the positive
 * colour; an unrated one is neutral, because no rating is not a bad rating.
 */
export function recipeChip(stars: number | null): ChipColors {
  if (stars === null) return { bg: 'var(--chip-neutral)', fg: 'var(--ink-muted)' };
  return stars >= 4
    ? { bg: 'var(--green-chip-bg)', fg: 'var(--green-deep)' }
    : { bg: 'var(--chip-neutral)', fg: 'var(--ink-muted)' };
}

/** Case-insensitive substring match — the only search the prototype does. */
export function matches(query: string, ...fields: string[]): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return fields.some((field) => field.toLowerCase().includes(q));
}
