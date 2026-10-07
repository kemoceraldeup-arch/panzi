// src/components/tour/steps.ts
//
// What the app tour says, step by step. Copy changes belong here and nowhere
// else. `target` names a control registered with useTourTarget; null is a
// centred bubble with nothing lit. A step whose target isn't on screen when
// the tour starts is skipped (see visibleSteps in services/tour.ts).

import { TourId, TourStep } from '../../services/tour';

export const TOURS: Record<TourId, TourStep[]> = {
  // First arrival on Home.
  main: [
    {
      id: 'welcome',
      target: null,
      title: 'Welcome to Panzi!',
      body: 'Let me show you around — it takes 30 seconds.',
    },
    {
      id: 'scan',
      target: 'tab.scan',
      title: 'Scan your food',
      body: 'Point your camera at groceries — I read the name and expiry date for you.',
    },
    {
      id: 'pantry',
      target: 'tab.pantry',
      title: 'Your pantry',
      body: "Everything you've added, sorted by what to use first.",
    },
    {
      id: 'recipes',
      target: 'tab.recipes',
      title: 'Recipes',
      body: "Dishes you can cook, ticked against what's in your pantry.",
    },
    {
      id: 'bell',
      target: 'home.bell',
      title: 'Reminders',
      body: "I'll tell you here when something is about to expire.",
    },
    {
      id: 'profile',
      target: 'tab.profile',
      title: 'Profile',
      body: 'Your diet, allergies, settings and help.',
    },
    {
      id: 'first-scan',
      target: 'home.firstScan',
      title: "Let's start!",
      body: 'Scan your first item — or tap "or type one in" to add it by hand.',
    },
  ],
  // The first time Home shows its full set of cards.
  followup: [
    {
      id: 'ask',
      target: 'home.ask',
      title: 'Ask Panzi',
      body: "Ask what to cook — type or use the mic. I'll use what's in your pantry.",
    },
    {
      id: 'pantry-card',
      target: 'home.pantryCard',
      title: 'Your pantry at a glance',
      body: 'How many items are fresh, to use soon, or expired. Tap to see them all.',
    },
  ],
};
