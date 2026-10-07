import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Pause, Play } from 'lucide-react';

const MOTION_KEY = 'panzi.admin.companion-motion';
const hints: Record<string, { text: string; to: string; label: string }> = {
  '/': { text: 'A little care goes a long way. See what’s in every pantry.', to: '/food', label: 'Explore the pantry' },
  '/food': { text: 'What happened after the pantry? Follow the food story.', to: '/analytics', label: 'See food outcomes' },
  '/recipes': { text: 'Meet the people behind the pantries and saved recipes.', to: '/users', label: 'Explore the community' },
  '/users': { text: 'See the ingredients that bring our community together.', to: '/food', label: 'Explore the pantry' },
  '/feedback': { text: 'Every message is someone telling us how Panzi fits their kitchen.', to: '/users', label: 'Meet the community' },
  '/analytics': { text: 'Every saved ingredient starts with a pantry. Take a look.', to: '/food', label: 'Explore the pantry' },
  '/costs': { text: 'Need more context? System logs show recorded API activity.', to: '/logs', label: 'View system logs' },
  '/logs': { text: 'See how recorded AI usage adds up across the workspace.', to: '/costs', label: 'Explore API costs' },
  '/settings': { text: 'All set? Your workspace’s bigger picture is a click away.', to: '/', label: 'Back to dashboard' },
};

const DIRECTIONS = ['up-left', 'up', 'up-right', 'left', 'center', 'right', 'down-left', 'down', 'down-right'] as const;
type Direction = (typeof DIRECTIONS)[number];
// Only the middle column faces forward. The other frames also turn the head,
// so inserting their "blink" before a front-facing reaction causes a leftward flash.
const REACTION_CELLS = { heart: 1, starEyes: 4, dizzy: 7 } as const;
type Reaction = keyof typeof REACTION_CELLS;

// Clockwise from the right, matching atan2 with y pointing down.
const CLOCKWISE: Direction[] = ['right', 'down-right', 'down', 'down-left', 'left', 'up-left', 'up', 'up-right'];
const SECTOR = (Math.PI * 2) / CLOCKWISE.length;
const HYSTERESIS = 0.12;
const DEAD_ZONE = 50;
const PAYOFFS: Reaction[] = ['heart', 'starEyes'];
const DIZZY_AFTER = 4;
const DIZZY_WINDOW = 1600;
const SQUASH: Keyframe[] = [
  { transform: 'scale(1, 1)', easing: 'ease-in' },
  { transform: 'scale(1.10, 0.86)', offset: 0.18, easing: 'ease-out' },
  { transform: 'scale(0.95, 1.08)', offset: 0.45, easing: 'ease-in-out' },
  { transform: 'scale(1.03, 0.97)', offset: 0.72, easing: 'ease-in-out' },
  { transform: 'scale(1, 1)' },
];

// background-size 300% makes each 3x3 cell a clean 0/50/100% step on both axes.
const cell = (index: number) => ({ backgroundPosition: `${(index % 3) * 50}% ${Math.floor(index / 3) * 50}%` });
const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

/** Panzi sprite sheets driven the page-mascot way (nilbuild/page-mascot, MIT): watches the cursor, reacts when booped. */
export function PanziCompanion({ pathname, active }: { pathname: string; active: boolean }) {
  const button = useRef<HTMLButtonElement>(null);
  const portrait = useRef<HTMLSpanElement>(null);
  const squash = useRef<Animation | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const boops = useRef({ count: 0, at: 0 });
  const [direction, setDirection] = useState<Direction>('center');
  const [reaction, setReaction] = useState<Reaction | null>(null);
  const [greeting, setGreeting] = useState(false);
  const [paused, setPaused] = useState(() => {
    try { return localStorage.getItem(MOTION_KEY) === 'paused'; } catch { return false; }
  });
  const hint = hints[pathname] ?? hints['/'];

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    squash.current?.cancel();
    squash.current = null;
  };

  useEffect(() => {
    setGreeting(false);
    setReaction(null);
    boops.current = { count: 0, at: 0 };
    clearTimers();
    return clearTimers;
  }, [pathname, active, paused]);

  useEffect(() => {
    // Measure the stationary button, never the squashing portrait. Otherwise
    // the same pointer can cross direction boundaries as the artwork animates.
    const element = button.current;
    if (!element || !active || paused) return;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const pointer = window.matchMedia('(hover: hover) and (pointer: fine)');
    let frame = 0;
    let visible = false;
    let sector = -1;
    let x = 0, y = 0;
    const reset = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      sector = -1;
      setDirection('center');
      squash.current?.cancel();
      squash.current = null;
    };
    const update = () => {
      frame = 0;
      const box = element.getBoundingClientRect();
      const dx = x - (box.left + box.width / 2);
      const dy = y - (box.top + box.height / 2);
      if (Math.hypot(dx, dy) < DEAD_ZONE) {
        sector = -1;
        setDirection('center');
        return;
      }
      // Hold the current sector until the pointer is well past its edge.
      const angle = Math.atan2(dy, dx);
      if (sector !== -1 && Math.abs(wrap(angle - sector * SECTOR)) < SECTOR / 2 + HYSTERESIS) return;
      sector = (Math.round(angle / SECTOR) + CLOCKWISE.length) % CLOCKWISE.length;
      setDirection(CLOCKWISE[sector]);
    };
    const move = (event: PointerEvent) => {
      if (!visible || document.hidden || motion.matches || !pointer.matches || event.pointerType !== 'mouse') return;
      x = event.clientX; y = event.clientY;
      if (!frame) frame = requestAnimationFrame(update);
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (!visible) reset();
    });
    observer.observe(element);
    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('blur', reset);
    document.documentElement.addEventListener('pointerleave', reset);
    document.addEventListener('visibilitychange', reset);
    motion.addEventListener('change', reset);
    pointer.addEventListener('change', reset);
    return () => {
      reset(); observer.disconnect();
      window.removeEventListener('pointermove', move);
      window.removeEventListener('blur', reset);
      document.documentElement.removeEventListener('pointerleave', reset);
      document.removeEventListener('visibilitychange', reset);
      motion.removeEventListener('change', reset);
      pointer.removeEventListener('change', reset);
    };
  }, [active, paused]);

  function sayHello() {
    clearTimers();
    const later = (ms: number, next: () => void) => { timers.current.push(setTimeout(next, ms)); };
    setGreeting(true);
    later(2200, () => setGreeting(false));
    if (paused || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setReaction(null);
      return;
    }
    const now = Date.now();
    const b = boops.current;
    b.count = now - b.at < DIZZY_WINDOW ? b.count + 1 : 1;
    b.at = now;
    if (b.count >= DIZZY_AFTER) {
      b.count = 0;
      setReaction('dizzy');
      later(1100, () => setReaction(null));
    } else {
      setReaction(PAYOFFS[(b.count - 1) % PAYOFFS.length]);
      later(560, () => setReaction(null));
    }
    squash.current = portrait.current?.animate(SQUASH, { duration: 420, easing: 'linear' }) ?? null;
  }

  function toggleMotion() {
    const next = !paused;
    setPaused(next);
    try { localStorage.setItem(MOTION_KEY, next ? 'paused' : 'on'); } catch { /* Works without storage. */ }
  }

  return (
    <section className="side-mission mascot-card" aria-label="Panzi companion" data-paused={paused}>
      <div className="mascot-card-top">
        <button ref={button} className="mascot-hello" type="button" onClick={sayHello} aria-label="Say hello to Panzi" title="Say hello to Panzi">
          <span className="mascot-portrait" ref={portrait}>
            <span className="mascot-sheet" style={{ backgroundImage: 'url(/mascot/panzi-directions.webp)', ...cell(DIRECTIONS.indexOf(direction)), opacity: reaction ? 0 : 1 }} />
            {/* Always mounted so the sheet is fetched up front, never on the first click. */}
            <span className="mascot-sheet" style={{ backgroundImage: 'url(/mascot/panzi-reactions.webp)', ...cell(REACTION_CELLS[reaction ?? 'heart']), opacity: reaction ? 1 : 0 }} />
          </span>
        </button>
        <h2 aria-live="polite">{greeting ? 'Hello, pantry pal!' : 'A little help from Panzi'}</h2>
      </div>
      <p>{hint.text}</p>
      <div className="mascot-card-actions">
        <Link className="mascot-shortcut" to={hint.to}>{hint.label}<ArrowUpRight className="i" aria-hidden="true" /></Link>
        <button className="icon-btn mascot-motion" type="button" onClick={toggleMotion} aria-label="Pause mascot motion" aria-pressed={paused} title={paused ? 'Resume mascot motion' : 'Pause mascot motion'}>
          {paused ? <Play className="i" aria-hidden="true" /> : <Pause className="i" aria-hidden="true" />}
        </button>
      </div>
    </section>
  );
}
