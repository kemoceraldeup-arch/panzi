import { useEffect, useRef } from 'react';

// Preserve the API's formatting (including money, percentages and K/M values).
// Placeholders such as "Not priced" and "No data" are never converted to zero.
function numberParts(value: string | number) {
  const text = typeof value === 'number' ? value.toLocaleString('en-US', { maximumFractionDigits: 10 }) : value;
  const match = text.match(/^([^\d+-]*)([+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)([^\d]*)$/);
  if (!match) return { text, numeric: null };
  const [, prefix, digits, suffix] = match;
  const amount = Number(digits.replaceAll(',', ''));
  if (!Number.isFinite(amount)) return { text, numeric: null };
  const scale = { k: 1e3, m: 1e6, b: 1e9 }[suffix.trim().toLowerCase()] ?? 1;
  const precision = digits.split('.')[1]?.length ?? 0;
  const formatter = new Intl.NumberFormat('en-US', {
    useGrouping: digits.includes(',') || typeof value === 'number',
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  });
  return {
    text,
    numeric: amount * scale,
    format: (current: number) => `${prefix}${digits.startsWith('+') && current >= 0 ? '+' : ''}${formatter.format(current / scale)}${suffix}`,
  };
}

/** Count on first appearance; smoothly retarget from the displayed value on updates. */
export function AnimatedNumber({ value }: { value: string | number }) {
  const target = numberParts(value);
  const initial = useRef(target.numeric === null ? target.text : target.format!(0));
  const element = useRef<HTMLSpanElement>(null);
  const current = useRef<number | null>(null);

  useEffect(() => {
    const node = element.current;
    if (!node) return;
    const next = numberParts(value);
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    let observer: IntersectionObserver | undefined;
    const finish = () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      current.current = next.numeric;
      node.textContent = next.text;
    };
    if (next.numeric === null || motion.matches || current.current === next.numeric) {
      finish();
      return;
    }
    const from = current.current ?? 0;
    const to = next.numeric;
    let started = false;
    const start = () => {
      if (started) return;
      started = true;
      const beginning = performance.now();
      const tick = (now: number) => {
        const progress = Math.min((now - beginning) / 1100, 1);
        current.current = from + (to - from) * (1 - (1 - progress) ** 3);
        node.textContent = progress === 1 ? next.text : next.format!(current.current);
        if (progress < 1) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    };
    if ('IntersectionObserver' in window) {
      observer = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) { observer?.disconnect(); start(); }
      });
      observer.observe(node);
    } else start();
    const onMotionChange = () => { if (motion.matches) finish(); };
    motion.addEventListener('change', onMotionChange);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      motion.removeEventListener('change', onMotionChange);
    };
  }, [value]);

  return <><span className="sr-only">{target.text}</span><span className="animated-number" ref={element} aria-hidden="true">{initial.current}</span></>;
}
