// src/components/tour/TourProvider.tsx
//
// Runs the app tour. Controls register themselves with useTourTarget; Home
// says which layout is showing with useTourHome; MainTabs says whether
// anything else is in the way (`blocked`: another tab, the scanner, chat, a
// sheet). When Home is showing, nothing is in the way, and a tour is due for
// this account, the provider waits for the screen to settle, measures every
// registered target, drops steps with nothing on screen to point at, and
// shows the rest one at a time.
//
// A tour is marked seen on Skip or on its last step, never on start: a tour
// the app was killed in the middle of shows again next time.

import React, {
  createContext,
  RefObject,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { InteractionManager, View, useWindowDimensions } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import {
  HomeLayout,
  Rect,
  TOUR_IDS,
  TourId,
  TourStep,
  hasSeenTour,
  markTourSeen,
  toursDue,
  visibleSteps,
} from '../../services/tour';
import { TOURS } from './steps';
import TourOverlay from './TourOverlay';

export type TourHome = {
  layout: HomeLayout;
  /** Brings Home back to the top with the tab bar expanded, so every target
   *  is where the tour expects it. */
  scrollToTop: () => void;
};

type Ctx = {
  register: (id: string, ref: RefObject<View | null>) => () => void;
  reportHome: (state: TourHome | null) => void;
};

const TourContext = createContext<Ctx | null>(null);

// Long enough for a closing sheet's slide-out and a tab switch to finish. The
// tour is a Modal, and on iOS a Modal presenting while another is dismissing
// shows as a blank sheet; targets also have to stop moving before they're
// measured.
const SETTLE_MS = 450;
// measureInWindow never answers for a view that unmounted mid-call.
const MEASURE_TIMEOUT_MS = 500;

function measure(ref: RefObject<View | null>): Promise<Rect | null> {
  return new Promise((resolve) => {
    const node = ref.current;
    if (!node) {
      resolve(null);
      return;
    }
    const timer = setTimeout(() => resolve(null), MEASURE_TIMEOUT_MS);
    (node as View).measureInWindow((x, y, width, height) => {
      clearTimeout(timer);
      resolve({ x, y, width, height });
    });
  });
}

type Run = {
  tours: TourId[];
  steps: TourStep[];
  rects: Record<string, Rect | null>;
  index: number;
};

type Props = {
  /** True while Home isn't the screen in front of the user. */
  blocked: boolean;
  /** Bumped by Help's "Show the app tour again". 0 means never asked. */
  replayNonce: number;
  children: React.ReactNode;
};

export function TourProvider({ blocked, replayNonce, children }: Props) {
  const { uid } = useAuth();
  const screen = useWindowDimensions();
  const targets = useRef(new Map<string, RefObject<View | null>>());
  const [home, setHome] = useState<TourHome | null>(null);
  const [seen, setSeen] = useState<Record<TourId, boolean> | null>(null);
  const [forced, setForced] = useState(false);
  const [run, setRun] = useState<Run | null>(null);
  const blockedRef = useRef(blocked);
  blockedRef.current = blocked;

  // Seen flags for whoever is signed in. Cleared first, so a different
  // account on the same phone is never judged by the last one's flags.
  useEffect(() => {
    setSeen(null);
    setRun(null);
    setForced(false);
    if (!uid) return;
    let alive = true;
    Promise.all(TOUR_IDS.map((tour) => hasSeenTour(uid, tour))).then(([main, followup]) => {
      if (alive) setSeen({ main, followup });
    });
    return () => {
      alive = false;
    };
  }, [uid]);

  useEffect(() => {
    if (replayNonce > 0) setForced(true);
  }, [replayNonce]);

  const finish = useCallback(
    (tours: TourId[]) => {
      setRun(null);
      setSeen((prev) => {
        const next = { ...(prev ?? { main: false, followup: false }) };
        for (const tour of tours) next[tour] = true;
        return next;
      });
      if (uid) for (const tour of tours) void markTourSeen(uid, tour);
    },
    [uid]
  );

  // Stop a running tour if Home is covered, without marking it seen, so it resumes when unblocked.
  useEffect(() => {
    if (blocked && run) setRun(null);
  }, [blocked, run]);

  // Start a tour once everything lines up. Any change to the inputs while it's
  // settling cancels it; the effect then re-runs and decides again.
  useEffect(() => {
    if (!uid || !home || !seen || blocked || run) return;
    const due = toursDue(home.layout, seen, forced);
    if (due.length === 0) return;

    home.scrollToTop();
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const task = InteractionManager.runAfterInteractions(() => {
      timer = setTimeout(async () => {
        if (cancelled || blockedRef.current) return;
        const ids = [...targets.current.keys()];
        const measured = await Promise.all(
          ids.map((id) => measure(targets.current.get(id) as RefObject<View | null>))
        );
        if (cancelled || blockedRef.current) return;
        const rects: Record<string, Rect | null> = {};
        ids.forEach((id, i) => {
          rects[id] = measured[i];
        });
        const steps = visibleSteps(
          due.flatMap((tour) => TOURS[tour]),
          rects,
          screen
        );
        setForced(false);
        if (steps.length === 0) {
          finish(due);
          return;
        }
        setRun({ tours: due, steps, rects, index: 0 });
      }, SETTLE_MS);
    });
    return () => {
      cancelled = true;
      task.cancel();
      if (timer) clearTimeout(timer);
    };
  }, [uid, home, seen, blocked, run, forced, screen, finish]);

  const ctx = useMemo<Ctx>(
    () => ({
      register: (id, ref) => {
        targets.current.set(id, ref);
        return () => {
          if (targets.current.get(id) === ref) targets.current.delete(id);
        };
      },
      reportHome: setHome,
    }),
    []
  );

  const step = run ? run.steps[run.index] : null;

  // A target that unmounted after it was measured (it shouldn't — the tour
  // blocks every tap) is skipped rather than lit at stale coordinates.
  useEffect(() => {
    if (!run || !step?.target || targets.current.has(step.target)) return;
    if (run.index + 1 < run.steps.length) setRun({ ...run, index: run.index + 1 });
    else finish(run.tours);
  }, [run, step, finish]);

  return (
    <TourContext.Provider value={ctx}>
      {children}
      {run && step && (
        <TourOverlay
          step={step}
          rect={step.target ? run.rects[step.target] ?? null : null}
          index={run.index}
          total={run.steps.length}
          onNext={() =>
            run.index + 1 < run.steps.length
              ? setRun({ ...run, index: run.index + 1 })
              : finish(run.tours)
          }
          onSkip={() => finish(run.tours)}
        />
      )}
    </TourContext.Provider>
  );
}

/**
 * Makes a control something the tour can light. Returns a ref to put on the
 * control's own element — no wrapper, so layout (TabBar's onLayout maths
 * included) is untouched. Pass `existing` when the control already has a ref.
 * Outside a TourProvider it does nothing.
 */
export function useTourTarget<T extends View = View>(
  id: string,
  existing?: RefObject<T | null>
): RefObject<T | null> {
  const ctx = useContext(TourContext);
  const own = useRef<T>(null);
  const ref = existing ?? own;
  useEffect(() => ctx?.register(id, ref as RefObject<View | null>), [ctx, id, ref]);
  return ref;
}

/** Home's report of what it's showing: null while it's still loading. Pass a
 *  memoised value; a new object on every render would restart the settle. */
export function useTourHome(state: TourHome | null): void {
  const ctx = useContext(TourContext);
  useEffect(() => {
    ctx?.reportHome(state);
  }, [ctx, state]);
  useEffect(() => () => ctx?.reportHome(null), [ctx]);
}
