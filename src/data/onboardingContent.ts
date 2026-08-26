// src/data/onboardingContent.ts

export type OnboardingPage = {
  key: string;
  eyebrow: string;
  title: string;
  description: string;
};

export const onboardingPages: OnboardingPage[] = [
  {
    key: 'welcome',
    eyebrow: 'Meet Panzi',
    title: 'Your pantry, sorted.',
    description:
      "Snap a photo of your shelf. Panzi logs what's there, keeps an eye on the dates, and tells you what to cook.",
  },
  {
    key: 'scan',
    eyebrow: '',
    title: 'Snap it. Panzi sorts it.',
    description:
      'Point your camera at a shelf or a grocery haul. Panzi reads the labels, counts what it sees, and files everything away. Tap anything it got wrong.',
  },
  {
    key: 'freshness',
    eyebrow: '',
    title: 'Nothing expires in the dark.',
    description:
      "Panzi tracks every printed date and estimates shelf life for the things that don't carry one. You get the nudge while the food is still good.",
  },
  {
    key: 'recipes',
    eyebrow: '',
    title: 'Cook what you already have.',
    description:
      "Panzi builds recipes from what's on your shelves, starting with whatever expires first — then deducts the ingredients once you've cooked.",
  },
  {
    key: 'chat',
    eyebrow: '',
    title: 'Ask Panzi anything.',
    description:
      "Storage questions, substitutions, what's still safe to eat. Panzi answers with your actual shelves in mind, not a generic recipe blog.",
  },
];