// server/src/removalOutcome.ts
//
// What a pantry removal means for the admin console's waste figures.
//
// The app asks why an item left (models.ts REMOVAL_REASONS); the console only
// asks whether the food was eaten or wasted. "Other" says nothing either way,
// so it stays out of the rate rather than being guessed into one side.

import type { RemovalReason } from './models';

export type RemovalOutcome = 'eaten' | 'wasted' | 'unclassified';

const OUTCOMES: Record<RemovalReason, RemovalOutcome> = {
  consumed: 'eaten',
  spoiled: 'wasted',
  expired: 'wasted',
  other: 'unclassified',
};

export function outcomeOf(reason: string): RemovalOutcome {
  return Object.hasOwn(OUTCOMES, reason) ? OUTCOMES[reason as RemovalReason] : 'unclassified';
}
