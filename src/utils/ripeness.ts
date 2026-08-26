// src/utils/ripeness.ts
//
// The ripeness scale, and the one place a stage turns into days.
//
// Ripeness is the scanner's answer for food that never carries a printed date:
// loose fruit and veg. The four stages are ordered and the app shows them as a
// four-segment scale, so they are a scale here too — an array, not a set of
// unrelated strings.
//
// Everything a stage implies about time lives in DEFAULT_SHELF_LIFE_DAYS. When
// the model gives its own shelfLifeDays estimate that number wins, because it
// looked at the actual fruit; this table is the fallback for when the user
// overrules the stage by hand and there is no new estimate to go with it.

export type RipenessStage = 'green' | 'just_ripe' | 'very_ripe' | 'past_best';

/** In order, unripe to spoiled. The four segments of the scale, left to right. */
export const RIPENESS_STAGES: RipenessStage[] = [
  'green',
  'just_ripe',
  'very_ripe',
  'past_best',
];

export const RIPENESS_LABELS: Record<RipenessStage, string> = {
  green: 'Green',
  just_ripe: 'Just ripe',
  very_ripe: 'Very ripe',
  past_best: 'Past best',
};

// Days left implied by each stage, used when the user picks a stage themselves
// and there is no model estimate to attach. Deliberately short: erring toward
// "eat it sooner" wastes nothing, and erring the other way is how food rots
// behind a reassuring badge.
export const DEFAULT_SHELF_LIFE_DAYS: Record<RipenessStage, number> = {
  green: 6,
  just_ripe: 2,
  very_ripe: 0,
  past_best: 0,
};

/** True for the two stages the app treats as urgent — peach everywhere. */
export function isUrgentStage(stage: RipenessStage): boolean {
  return stage === 'very_ripe' || stage === 'past_best';
}

export function isRipenessStage(value: unknown): value is RipenessStage {
  return RIPENESS_STAGES.includes(value as RipenessStage);
}

/**
 * The line beside the verdict on the freshness screen — "eat within 2 days".
 *
 * Phrased as an instruction rather than a measurement because that is what the
 * user actually needs from it, and because "0 days left" is a worse way of
 * saying "eat this today".
 */
export function ripenessAdvice(stage: RipenessStage, days: number): string {
  if (stage === 'past_best') return 'past its best';
  if (days <= 0) return 'eat today';
  if (days === 1) return 'eat within a day';
  return `eat within ${days} days`;
}

/** The short form used on chips: "JUST RIPE · 2 DAYS", "VERY RIPE · EAT TODAY". */
export function ripenessChipText(stage: RipenessStage, days: number): string {
  const label = RIPENESS_UPPER[stage];
  if (stage === 'past_best') return `${label} · USE NOW`;
  if (days <= 0) return `${label} · EAT TODAY`;
  if (days === 1) return `${label} · 1 DAY`;
  return `${label} · ${days} DAYS`;
}

// ─── Storage advice ───────────────────────────────────────────────────────
//
// One tip per kind of produce, shown on the freshness screen under the
// judgement. Matched on the name because that is all we have, and returning
// null for anything unrecognised is deliberate: a card of generic advice
// ("store in a cool dry place") on every screen would train the user to skip
// the one place a real tip could buy them a few days.

export type ProduceTip = { title: string; body: string };

const TIPS: { match: RegExp; tip: ProduceTip }[] = [
  {
    match: /banana/i,
    tip: {
      title: 'Keep them apart',
      body: 'Bananas ripen everything near them. Off the fruit bowl buys you a couple of days.',
    },
  },
  {
    match: /avocado/i,
    tip: {
      title: 'Slow them down',
      body: 'Once they give to a squeeze, the fridge holds them there for two or three days.',
    },
  },
  {
    match: /tomato/i,
    tip: {
      title: 'Not the fridge',
      body: 'Cold flattens the flavour. Stem side down on the counter, out of direct sun.',
    },
  },
  {
    match: /berr|strawberr|raspberr|blueberr/i,
    tip: {
      title: 'Wash them later',
      body: 'Water on the skins is what turns a punnet mouldy. Rinse only what you are about to eat.',
    },
  },
  {
    match: /apple|pear/i,
    tip: {
      title: 'Give them room',
      body: 'They give off the same gas bananas do. In the crisper, on their own, they keep for weeks.',
    },
  },
  {
    match: /lettuce|spinach|salad|herb|coriander|basil|parsley/i,
    tip: {
      title: 'Keep the leaves dry',
      body: 'A dry cloth in the bag takes up the damp that turns leaves to slime.',
    },
  },
  {
    match: /potato|onion/i,
    tip: {
      title: 'Dark and separate',
      body: 'Light turns potatoes green, and onions nearby make them sprout. Different cupboards.',
    },
  },
];

export function produceTip(name: string): ProduceTip | null {
  return TIPS.find(({ match }) => match.test(name))?.tip ?? null;
}

const RIPENESS_UPPER: Record<RipenessStage, string> = {
  green: 'GREEN',
  just_ripe: 'JUST RIPE',
  very_ripe: 'VERY RIPE',
  past_best: 'PAST BEST',
};
