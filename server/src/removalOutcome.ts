// server/src/removalOutcome.ts
//
// What a pantry removal means for the admin console's waste figures.
//
// The app asks why an item left (models.ts REMOVAL_REASONS); the console only
// asks whether the food was eaten or wasted. Leftovers were cooked and eaten;
// over-purchased food was bought and not used. "Other" says nothing either way,
// so it stays out of the rate rather than being guessed into one side.

import type { REMOVAL_REASONS } from './models';

export type RemovalOutcome = 'eaten' | 'wasted' | 'unclassified';

const OUTCOMES: Record<(typeof REMOVAL_REASONS)[number], RemovalOutcome> = {
  consumed: 'eaten',
  leftover: 'eaten',
  spoiled: 'wasted',
  expired: 'wasted',
  'over-purchased': 'wasted',
  other: 'unclassified',
};

export function outcomeOf(reason: string): RemovalOutcome {
  return Object.hasOwn(OUTCOMES, reason) ? OUTCOMES[reason as keyof typeof OUTCOMES] : 'unclassified';
}
