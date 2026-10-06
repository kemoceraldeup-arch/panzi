// src/services/__tests__/tour.test.ts
//
// The app tour's memory and arithmetic: who has seen which tour, which tours
// are due on the Home that's showing, which steps can actually be pointed at,
// and where the bubble goes.

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  BUBBLE_GAP,
  SCREEN_MARGIN,
  dimPath,
  hasSeenTour,
  holeFor,
  markTourSeen,
  placeBubble,
  toursDue,
  visibleSteps,
  TourStep,
} from '../tour';
import { TOURS } from '../../components/tour/steps';

beforeEach(() => AsyncStorage.clear());

const screen = { width: 390, height: 844 };
const insets = { top: 47, bottom: 34 };
const unseen = { main: false, followup: false };

describe('seen flags', () => {
  it('starts unseen and remembers per tour', async () => {
    expect(await hasSeenTour('u1', 'main')).toBe(false);
    await markTourSeen('u1', 'main');
    expect(await hasSeenTour('u1', 'main')).toBe(true);
    expect(await hasSeenTour('u1', 'followup')).toBe(false);
  });

  it('is per account', async () => {
    await markTourSeen('u1', 'main');
    expect(await hasSeenTour('u2', 'main')).toBe(false);
  });

  it('treats an unreadable flag as seen, so storage trouble never traps anyone in a tour', async () => {
    jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('disk'));
    expect(await hasSeenTour('u1', 'main')).toBe(true);
  });
});

describe('toursDue', () => {
  it('runs only the main tour on the empty-pantry welcome', () => {
    expect(toursDue('welcome', unseen, false)).toEqual(['main']);
  });

  it('runs both back to back when the full Home is showing to someone new', () => {
    expect(toursDue('full', unseen, false)).toEqual(['main', 'followup']);
  });

  it('runs the follow-up once the full Home first appears after the main tour', () => {
    expect(toursDue('full', { main: true, followup: false }, false)).toEqual(['followup']);
  });

  it('waits for the full Home before the follow-up', () => {
    expect(toursDue('welcome', { main: true, followup: false }, false)).toEqual([]);
  });

  it('runs nothing once both are seen', () => {
    expect(toursDue('full', { main: true, followup: true }, false)).toEqual([]);
  });

  it('replays whatever fits the layout when forced, ignoring seen flags', () => {
    const seen = { main: true, followup: true };
    expect(toursDue('full', seen, true)).toEqual(['main', 'followup']);
    expect(toursDue('welcome', seen, true)).toEqual(['main']);
  });
});

describe('visibleSteps', () => {
  const steps: TourStep[] = [
    { id: 'hello', target: null, title: '', body: '' },
    { id: 'a', target: 'a', title: '', body: '' },
    { id: 'b', target: 'b', title: '', body: '' },
    { id: 'c', target: 'c', title: '', body: '' },
    { id: 'd', target: 'd', title: '', body: '' },
  ];

  it('keeps targetless steps and steps whose target is on screen', () => {
    const rects = {
      a: { x: 10, y: 10, width: 40, height: 40 },
      b: null,
      c: { x: 10, y: 900, width: 40, height: 40 }, // below the fold
      d: { x: 10, y: 10, width: 0, height: 0 }, // collapsed
    };
    expect(visibleSteps(steps, rects, screen).map((s) => s.id)).toEqual(['hello', 'a']);
  });

  it('drops steps whose target never registered', () => {
    expect(visibleSteps(steps, {}, screen).map((s) => s.id)).toEqual(['hello']);
  });

  it('tolerates a rect a pixel past the edge from rounding', () => {
    const rects = { a: { x: -0.5, y: 800, width: 390.5, height: 44.5 } };
    expect(visibleSteps(steps.slice(0, 2), rects, screen).map((s) => s.id)).toEqual(['hello', 'a']);
  });
});

describe('holeFor', () => {
  it('pads the target and rounds a squarish one into a circle', () => {
    const hole = holeFor({ x: 100, y: 700, width: 66, height: 66 });
    expect(hole).toEqual({ x: 92, y: 692, width: 82, height: 82, radius: 41 });
  });

  it('gives a wide target a soft corner instead', () => {
    expect(holeFor({ x: 16, y: 200, width: 358, height: 56 }).radius).toBe(18);
  });
});

describe('dimPath', () => {
  it('is just the screen with no hole', () => {
    expect(dimPath(screen, null)).toBe('M0 0H390V844H0Z');
  });

  it('adds a second closed subpath for the hole', () => {
    const d = dimPath(screen, { x: 10, y: 20, width: 100, height: 50, radius: 10 });
    expect(d.startsWith('M0 0H390V844H0Z')).toBe(true);
    expect(d.match(/Z/g)).toHaveLength(2);
  });
});

describe('placeBubble', () => {
  const bubble = { width: screen.width - SCREEN_MARGIN * 2, height: 150 };

  it('centres the bubble when there is no target', () => {
    expect(placeBubble(null, bubble, screen, insets)).toEqual({ x: SCREEN_MARGIN, y: 347 });
  });

  it('goes below a target near the top (the bell)', () => {
    const hole = { x: 330, y: 60, width: 60, height: 60 };
    expect(placeBubble(hole, bubble, screen, insets)).toEqual({
      x: SCREEN_MARGIN,
      y: 60 + 60 + BUBBLE_GAP,
    });
  });

  it('goes above a target near the bottom (the tab bar)', () => {
    const hole = { x: 154, y: 720, width: 82, height: 82 };
    expect(placeBubble(hole, bubble, screen, insets)).toEqual({
      x: SCREEN_MARGIN,
      y: 720 - BUBBLE_GAP - 150,
    });
  });

  it('stays inside the safe area when neither side fits', () => {
    const tall = { width: bubble.width, height: 600 };
    const hole = { x: 0, y: 300, width: 390, height: 200 };
    const { y } = placeBubble(hole, tall, screen, insets);
    expect(y).toBeGreaterThanOrEqual(insets.top + SCREEN_MARGIN);
    expect(y + tall.height).toBeLessThanOrEqual(screen.height - insets.bottom - SCREEN_MARGIN);
  });
});

describe('TOURS', () => {
  it('has the 7-step main tour and 2-step follow-up from the spec', () => {
    expect(TOURS.main.map((s) => s.target)).toEqual([
      null,
      'tab.scan',
      'tab.pantry',
      'tab.recipes',
      'home.bell',
      'tab.profile',
      'home.firstScan',
    ]);
    expect(TOURS.followup.map((s) => s.target)).toEqual(['home.ask', 'home.pantryCard']);
  });

  it('gives every step a unique id and some copy', () => {
    const all = [...TOURS.main, ...TOURS.followup];
    expect(new Set(all.map((s) => s.id)).size).toBe(all.length);
    for (const step of all) {
      expect(step.title.length).toBeGreaterThan(0);
      expect(step.body.length).toBeGreaterThan(0);
    }
  });
});
