/**
 * The swirling loader, from 21st.dev.
 *
 * Ported rather than pasted, for the same reason the sidebar was: the source is
 * written for a shadcn project — `"use client"`, Tailwind utility classes, an
 * `@/components/ui` import alias — and this console is plain React with plain
 * CSS and design tokens. None of those three exist here, and adding Tailwind so
 * that one SVG can say `size-16 text-primary` would be a large change to
 * everything for the benefit of one file.
 *
 * What survives is the part that matters: the two keyframe animations. The
 * circle spins while its dash array stretches and contracts against it, which
 * is what makes the arc appear to chase itself rather than just rotate. They
 * live in global.css beside every other animation in this project instead of in
 * an inline <style> tag, so the rules exist once rather than once per mounted
 * spinner.
 *
 * Colour comes from `currentColor`, so a caller sets it by setting `color` —
 * the same way the lucide icons in the rail take theirs.
 */
export function Swirling({
  size = 44,
  color = 'var(--green-primary)',
  duration = '1.5s',
  className,
}: {
  size?: number;
  color?: string;
  /** Feeds the `--duration` custom property the two animations are timed off. */
  duration?: string;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 800 800"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      width={size}
      height={size}
      role="img"
      aria-label="Loading"
      style={{ color, ['--duration' as string]: duration }}
    >
      <circle
        className="swirl-circle"
        cx="400"
        cy="400"
        r="200"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="50"
      />
    </svg>
  );
}
