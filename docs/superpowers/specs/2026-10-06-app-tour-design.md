# App tour: first-run spotlight guide

**Date:** 2026-10-06
**Status:** Approved design, awaiting implementation plan

## Goal

A new user is shown around Panzi the way GCash and GoTyme do it: the real
screen dims, one button at a time is lit through a cut-out, and a speech
bubble says what that button does. It shows once, on first arrival at Home,
and can be replayed from Help.

Success: a first-time user finishes (or skips) the tour knowing where to
scan, where their food is listed, where recipes and reminders are, and that
they can ask Panzi what to cook — without the tour ever pointing at
something that isn't on screen.

## Scope

In: one tour over Home and the tab bar, a two-step follow-up for Home's full
layout, replay from Help.

Out (possible later work): tours inside the Pantry, Recipes or scanner
screens; per-screen first-time tips; tapping the highlighted button to
advance.

## What the user sees

### Main tour — first arrival on Home (7 steps)

| # | Target id | Spotlight on | Title | Body |
|---|---|---|---|---|
| 1 | — | nothing (full dim, centred bubble) | Welcome to Panzi! | Let me show you around — it takes 30 seconds. |
| 2 | `tab.scan` | Scan button, tab bar centre | Scan your food | Point your camera at groceries — I read the name and expiry date for you. |
| 3 | `tab.pantry` | Pantry tab | Your pantry | Everything you've added, sorted by what to use first. |
| 4 | `tab.recipes` | Recipes tab | Recipes | Dishes you can cook, ticked against what's in your pantry. |
| 5 | `home.bell` | Notification bell | Reminders | I'll tell you here when something is about to expire. |
| 6 | `tab.profile` | Profile tab | Profile | Your diet, allergies, settings and help. |
| 7 | `home.firstScan` | "Scan your first item" (empty-pantry welcome only) | Let's start! | Scan your first item — or tap "or type one in" to add it by hand. |

### Follow-up — first time Home shows its full layout (2 steps)

| # | Target id | Spotlight on | Title | Body |
|---|---|---|---|---|
| 1 | `home.ask` | Ask Panzi bar | Ask Panzi | Ask what to cook — type or use the mic. I'll use what's in your pantry. |
| 2 | `home.pantryCard` | "Your pantry" card | Your pantry at a glance | How many items are fresh, to use soon, or expired. Tap to see them all. |

### Behaviour

- The bubble shows the step counter ("2 of 7"), **Next**, and **Skip tour**.
  The last step's button reads **Got it**.
- Tapping the dimmed area does nothing; only the bubble's buttons move the
  tour. The highlighted control is not tappable during the tour, so the tour
  can't be derailed by, say, the camera opening mid-way.
- Each tour is shown once per account on this phone. Skipping counts as
  seen.
- The step counter counts only the steps actually shown (see "Steps whose
  target is missing" below).
- Replay: a "Show the app tour again" row in Profile → Help & feedback. It
  closes the sheet, switches to the Home tab, and runs the main tour, then
  the follow-up if Home's full layout is showing.

## Architecture

Built in-house. No new dependency: the cut-out uses `react-native-svg`,
already installed, so it keeps working in Expo Go. A third-party coachmark
library was rejected for theming limits, maintenance lag behind React Native
0.86, and known mis-measurement inside custom tab bars and scroll views.

### Units

| File | Purpose |
|---|---|
| `src/components/tour/steps.ts` | The two tours as data: `{ id, target?, title, body }[]`, exported as `MAIN_TOUR` and `FOLLOWUP_TOUR`. Copy changes touch only this file. |
| `src/components/tour/TourProvider.tsx` | Context plus two hooks. `useTourTarget(id, existingRef?)` returns a ref to put on a control's own element and registers it while mounted. It's a hook, not a wrapper component, because a wrapping `View` would break TabBar's `onLayout`-based active pill. `useTourHome(state)` is Home's report of which layout is showing. The provider holds the active tour and step, handles Next/Skip/finish, marks tours seen, and renders `TourOverlay` (a transparent `Modal`) above all app content including the tab bar. |
| `src/components/tour/TourOverlay.tsx` | Presentational. Full-screen touch-blocking layer; an SVG with a dim fill and a rounded-rect hole (target rect + padding); the bubble placed below the hole if it fits, otherwise above, clamped inside the safe area; fade between steps. |
| `src/services/tour.ts` | Pure and storage logic: `hasSeenTour(uid, tour)`, `markTourSeen(uid, tour)` (replay is the provider's `forced` flag, set by `replayNonce`, not a storage reset); `visibleSteps(steps, rects, screen, bottomLimits?)`, where `bottomLimits` is an optional per-target lowest bottom edge; `placeBubble(targetRect, bubbleSize, screen, insets)`. |

### Wiring

- `MainTabs.tsx` wraps its content (tabs and tab bar) in `TourProvider`.
- `TabBar.tsx` registers the Scan, Pantry, Recipes and Profile buttons via
  `useTourTarget` (a ref on the existing element).
- `HomeScreen.tsx` registers the bell, "Scan your first item", Ask Panzi and
  the pantry card via `useTourTarget` (a ref on the existing element), and
  reports its layout with `useTourHome`.
- `HelpSheet.tsx` gains the replay row and an `onReplayTour` prop.
  `ProfileScreen.tsx` (where HelpSheet is mounted) closes the sheet and calls
  its own `onReplayTour` prop. `MainTabs.tsx` supplies that prop: it switches
  to the Home tab and, once Home is active, calls `start(['main',
  'followup'])`, ignoring seen flags for that run.

### When a tour starts

Home calls `start` once all of these hold:

1. The pantry has loaded and the first-run answer is known (Home already
   tracks both for the welcome screen), so the layout on screen is final.
2. Nothing modal is open — scanner, chat, notification panel, or any sheet.
   Users who chose "Scan my first shelf" at the end of onboarding go straight
   to the camera; the tour waits until they are back on Home.
3. The account hasn't seen that tour on this phone.

If Home's layout changes while a tour is running (welcome to full or back),
the run stops without being marked seen and restarts on the settled layout.

The main tour is due first. The follow-up is due only after the main tour is
seen and when Home is showing its full layout. If both are due at once (for
example, a reinstall on an account that already has food), they run back to
back as one sequence.

### Steps whose target is missing

When a step's `target` isn't registered (not mounted) or measures as
zero-size or off-screen, that step is dropped. `visibleSteps` makes this
decision at the moment the tour starts, so the counter is right from step 1.
The `home.*` targets other than the bell (first scan, Ask Panzi, pantry
card) must also end above the tab bar and raised Scan button, or the step is
dropped. A target that disappears mid-tour (it shouldn't, since the tour blocks
input) skips to the next step rather than spotlighting stale coordinates.

### Measuring

Before a tour starts, Home scrolls to the top and re-expands the tab bar
(`resetTabScroll`). After a fixed 450 ms settle
(enough for the tab switch, the tab bar re-expanding and a closing sheet's
slide-out), every registered target is measured once with
`measureInWindow`. The app is portrait-only, and the tour blocks scrolling
and taps, so those rects hold for the whole tour.

### Persistence

AsyncStorage keys `panzi.tour.main.<uid>` and `panzi.tour.followup.<uid>`,
value `'1'`. The same pattern and failure handling as `services/firstRun.ts`:
if storage can't be read, treat the tour as seen, so a storage error never
traps a returning user in a tour. Writes are best effort.

## Error handling

- Storage read failure → tour treated as seen (not shown).
- No visible steps after filtering → nothing shows, and the tour is marked
  seen.
- Target measures as zero-size or off-screen → step skipped.
- The app is backgrounded mid-tour → the tour stays where it was. If the app
  is killed mid-tour, the tour is not marked seen, so it shows again next
  time.

## Testing

Unit (`src/services/__tests__/tour.test.ts`, Jest):

- seen flags are per account and per tour; a storage error reads as seen;
- `visibleSteps` drops steps whose target is missing and keeps targetless
  steps;
- `placeBubble` puts the bubble below when it fits, above when it doesn't,
  and never outside the safe area, including for targets at the very bottom
  (the tab bar) and very top (the bell).

Manual, on the phone over the existing QR flow:

- a fresh account sees the 7-step tour on the empty-pantry Home;
- after the first item is added, Home shows the 2-step follow-up once;
- Skip marks the tour seen; replay from Help runs it again;
- "Scan my first shelf" opens the camera first, and the tour follows on
  return to Home.
