// Shared pieces of the workspace: page header, panels, controls, states, the
// side drawer, and the charts. Everything renders inside `.pz`, where the
// design tokens live (see styles/panzi.css).

import {
  createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState,
  type ReactNode,
} from 'react';
import { AlertCircle, Info, Search as SearchIcon, TriangleAlert, X, CircleCheck, CircleMinus, CircleX } from 'lucide-react';
import { useDialogFocus } from '../lib/useDialogFocus';

export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ── Layout ─────────────────────────────────── */

export function PageHead({ title, text, tools, updatedAt }: {
  title: string; text?: ReactNode; tools?: ReactNode; updatedAt?: number | null;
}) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {text && <p>{text}</p>}
        {updatedAt && <div className="updated">Updated at {new Date(updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>}
      </div>
      {tools && <div className="tools">{tools}</div>}
    </div>
  );
}

export function Panel({ title, aside, children, className = '' }: {
  title: ReactNode; aside?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-head"><h2>{title}</h2>{aside && <span className="aside">{aside}</span>}</div>
      {children}
    </section>
  );
}

export function Segmented<T extends string>({ label, options, value, onChange }: {
  label: string; options: readonly { value: T; label: string }[]; value: T; onChange: (value: T) => void;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button key={option.value} type="button" aria-pressed={option.value === value} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

export const RANGE_OPTIONS = [
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
] as const;

export function SearchField({ value, onChange, placeholder, label }: {
  value: string; onChange: (value: string) => void; placeholder: string; label: string;
}) {
  return (
    <label className="field-wrap">
      <span className="sr-only">{label}</span>
      <SearchIcon className="i input-icon" aria-hidden="true" />
      <input className="field-input" type="search" value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

export function Pager({ page, pageSize, total, count, busy, onChange, noun }: {
  page: number; pageSize: number; total: number; count: number; busy: boolean; onChange: (page: number) => void; noun: string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const first = count ? (page - 1) * pageSize + 1 : 0;
  return (
    <div className="pager">
      <span>{count ? `${first}–${first + count - 1} of ${total.toLocaleString()} ${noun}` : `No ${noun}`}</span>
      <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button className="btn small" type="button" disabled={busy || page <= 1} onClick={() => onChange(page - 1)}>Previous</button>
        <span>Page {page} of {pages}</span>
        <button className="btn small" type="button" disabled={busy || page >= pages} onClick={() => onChange(page + 1)}>Next</button>
      </span>
    </div>
  );
}

/* ── Status and states ──────────────────────── */

export type Tone = 'good' | 'warn' | 'bad' | 'muted';
const TONE_ICON = { good: CircleCheck, warn: TriangleAlert, bad: CircleX, muted: CircleMinus };

export function Status({ tone, children }: { tone: Tone; children: ReactNode }) {
  const Icon = TONE_ICON[tone];
  return <span className={`status ${tone}`}><Icon className="i" aria-hidden="true" />{children}</span>;
}

/** The server still paints some rows with the old palette's variables; this
 *  turns them into a tone so meaning never rides on color alone. */
export function toneFromColor(color: string): Tone {
  if (/clay/.test(color)) return 'bad';
  if (/amber/.test(color)) return 'warn';
  if (/muted|track/.test(color)) return 'muted';
  return 'good';
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  return <div className="state" role="status"><span className="spinner" aria-hidden="true" />{label}</div>;
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="state error" role="alert">
      <AlertCircle className="i" aria-hidden="true" />
      <b>Couldn’t load this page</b>
      <span>{message}</span>
      {onRetry && <button className="btn" type="button" onClick={onRetry}>Try again</button>}
    </div>
  );
}

export function Notice({ title, children, tone = 'info' }: { title?: string; children: ReactNode; tone?: 'info' | 'warn' }) {
  const Icon = tone === 'warn' ? TriangleAlert : Info;
  return (
    <div className={`notice ${tone === 'warn' ? 'warn' : ''}`} role="note">
      <Icon className="i" aria-hidden="true" />
      <div>{title && <b>{title}</b>}{children}</div>
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="empty"><b>{title}</b>{children}</div>;
}

/* ── Toast ──────────────────────────────────── */

const ToastContext = createContext<(text: string) => void>(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [text, setText] = useState('');
  const [on, setOn] = useState(false);
  const timer = useRef(0);
  const show = useCallback((next: string) => {
    setText(next); setOn(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOn(false), 2600);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className={`toast${on ? ' on' : ''}`} role="status" aria-live="polite"><Info className="i" aria-hidden="true" />{text}</div>
    </ToastContext.Provider>
  );
}

/* ── Drawer ─────────────────────────────────── */

/** A side panel that slides in from the right and back out on close. */
export function Drawer({ title, subtitle, leading, onClose, children }: {
  title: string; subtitle?: ReactNode; leading?: ReactNode; onClose: () => void; children: ReactNode;
}) {
  const [shown, setShown] = useState(false);
  const [closing, setClosing] = useState(false);
  const panel = useRef<HTMLDivElement | null>(null);
  const requestClose = useCallback(() => {
    setClosing(true);
    window.setTimeout(onClose, reducedMotion() ? 0 : 280);
  }, [onClose]);
  const focusRef = useDialogFocus(requestClose);
  useLayoutEffect(() => {
    panel.current?.getBoundingClientRect(); // commit the off-screen start so the slide runs
    setShown(true);
  }, []);
  const state = closing ? ' closing' : shown ? ' on' : '';
  return (
    <>
      <div className={`scrim${state}`} onClick={requestClose} />
      <div
        ref={(node) => { panel.current = node; focusRef.current = node; }}
        className={`drawer${state}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}
      >
        <div className="drawer-head">
          {leading}
          <div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
          <button className="icon-btn" type="button" onClick={requestClose} aria-label="Close"><X className="i" aria-hidden="true" /></button>
        </div>
        <div className="drawer-body">{children}</div>
      </div>
    </>
  );
}

/* ── Charts ─────────────────────────────────── */
// Drawn at the width they are given, so labels keep their size on any screen.
// Bars rise once when a chart first mounts; resizing redraws without replaying.

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

function niceStep(raw: number) {
  if (raw <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? p * 10;
}
const compact = (v: number) => (v >= 10000 ? `${+(v / 1000).toFixed(1)}K` : v.toLocaleString());
function roundTop(x: number, y: number, w: number, h: number, r: number) {
  if (h <= 0) return '';
  r = Math.min(r, h, w / 2);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

export interface Column { label: string; value: number; tip: string }

export function ColumnChart({ rows, height = 220, label }: { rows: Column[]; height?: number; label: string }) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const pad = { t: 18, b: 26, l: 44, r: 8 };
  const max = Math.max(1, ...rows.map((r) => r.value));
  const step = niceStep(max / 3), top = Math.ceil(max / step) * step;
  const y = (v: number) => pad.t + (height - pad.t - pad.b) * (1 - v / top);
  const band = rows.length ? (W - pad.l - pad.r) / rows.length : 0, bw = Math.min(24, band * 0.5);
  const ticks: number[] = []; for (let v = 0; v <= top; v += step) ticks.push(v);
  const peak = rows.reduce((a, r, i) => (r.value > rows[a].value ? i : a), 0);
  return (
    <div className="chart grow" ref={ref}>
      {W > 0 && (
        <svg width={W} height={height} viewBox={`0 0 ${W} ${height}`} role="img" aria-label={`${label}: ${rows.map((r) => r.tip.replace(/\n/g, ' ')).join('; ')}`}>
          <g className="grid">{ticks.map((v) => <line key={v} x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} />)}</g>
          <g className="axis">{ticks.map((v) => <text key={v} x={pad.l - 8} y={y(v) + 4} textAnchor="end">{compact(v)}</text>)}</g>
          {rows.map((r, i) => {
            const cx = pad.l + band * i + band / 2, yy = y(r.value);
            return (
              <g key={r.label}>
                <rect className="hit" x={pad.l + band * i} y={pad.t} width={band} height={height - pad.t - pad.b} tabIndex={0} data-tip={r.tip} />
                <g className="col" style={{ ['--i' as string]: i }}><path className="mark" d={roundTop(cx - bw / 2, yy, bw, y(0) - yy, 4)} fill="var(--ink-2)" /></g>
                {(i === peak || i === rows.length - 1) && r.value > 0 && <text className="val" x={cx} y={yy - 6} textAnchor="middle">{compact(r.value)}</text>}
                <text className="axis" x={cx} y={height - 8} textAnchor="middle">{r.label}</text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

export interface Stack { label: string; used: number; wasted: number }

export function StackedChart({ rows, height = 240 }: { rows: Stack[]; height?: number }) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const pad = { t: 20, b: 26, l: 44, r: 8 };
  const max = Math.max(1, ...rows.map((r) => r.used + r.wasted));
  const step = niceStep(max / 4), top = Math.ceil(max / step) * step;
  const y = (v: number) => pad.t + (height - pad.t - pad.b) * (1 - v / top);
  const band = rows.length ? (W - pad.l - pad.r) / rows.length : 0, bw = Math.min(24, band * 0.5);
  const ticks: number[] = []; for (let v = 0; v <= top; v += step) ticks.push(v);
  return (
    <div className="chart grow" ref={ref}>
      {W > 0 && (
        <svg width={W} height={height} viewBox={`0 0 ${W} ${height}`} role="img"
          aria-label={rows.map((r) => `${r.label}: ${r.used} used up, ${r.wasted} thrown out`).join('; ')}>
          <g className="grid">{ticks.map((v) => <line key={v} x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} />)}</g>
          <g className="axis">{ticks.map((v) => <text key={v} x={pad.l - 8} y={y(v) + 4} textAnchor="end">{v.toLocaleString()}</text>)}</g>
          {rows.map((r, i) => {
            const cx = pad.l + band * i + band / 2, x = cx - bw / 2, yU = y(r.used), yW = y(r.used + r.wasted);
            const total = r.used + r.wasted;
            const rate = total ? ((r.wasted / total) * 100).toFixed(1) : '0';
            return (
              <g key={r.label}>
                <rect className="hit" x={pad.l + band * i} y={pad.t} width={band} height={height - pad.t - pad.b} tabIndex={0}
                  data-tip={`${r.label}\nUsed up ${r.used.toLocaleString()}\nThrown out ${r.wasted.toLocaleString()}\nWaste rate ${rate}%`} />
                <g className="col" style={{ ['--i' as string]: i }}>
                  {r.used > 0 && <rect x={x} y={yU} width={bw} height={y(0) - yU} fill="var(--used)" />}
                  {r.wasted > 0 && <path d={roundTop(x, yW, bw, yU - yW - (r.used > 0 ? 2 : 0), 4)} fill="var(--wasted)" />}
                </g>
                <text className="axis" x={cx} y={height - 8} textAnchor="middle">{r.label}</text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

export function TrendLine({ rows, caption }: { rows: { label: string; value: number }[]; caption: string }) {
  const W = 340, H = 108, pad = { t: 12, b: 6, l: 4, r: 44 };
  if (rows.length < 2) return null;
  const max = Math.max(1, ...rows.map((r) => r.value)) * 1.05;
  const x = (i: number) => pad.l + ((W - pad.l - pad.r) * i) / (rows.length - 1);
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const pts = rows.map((r, i) => [x(i), y(r.value)] as const);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
  const last = pts[pts.length - 1];
  return (
    <div className="trend chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${caption}: ${rows.map((r) => `${r.label} ${r.value}%`).join(', ')}`}>
        <path d={`${line}L${last[0]},${y(0)}L${pts[0][0]},${y(0)}Z`} fill="var(--wasted)" opacity=".1" />
        <path d={line} fill="none" stroke="var(--wasted)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {pts.map((p, i) => <circle key={rows[i].label + i} className="hit" cx={p[0]} cy={p[1]} r="12" tabIndex={0} data-tip={`${rows[i].label}\nWaste rate ${rows[i].value}%`} />)}
        <circle cx={last[0]} cy={last[1]} r="4" fill="var(--wasted)" stroke="var(--panel)" strokeWidth="2" />
        <text className="val" x={last[0] + 9} y={last[1] + 4}>{rows[rows.length - 1].value}%</text>
      </svg>
      <div className="trend-cap"><span>{rows[0].label}</span><span>{caption}</span><span style={{ paddingRight: 44 }}>{rows[rows.length - 1].label}</span></div>
    </div>
  );
}

/** Hover and keyboard tooltips for any element carrying `data-tip`. */
export function TipLayer() {
  const tip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function show(el: Element, x: number, y: number) {
      const node = tip.current; if (!node) return;
      node.textContent = el.getAttribute('data-tip');
      node.classList.add('on');
      const r = node.getBoundingClientRect();
      node.style.left = `${Math.min(window.innerWidth - r.width - 8, Math.max(8, x - r.width / 2))}px`;
      node.style.top = `${Math.max(8, y - r.height - 12)}px`;
    }
    const hide = () => tip.current?.classList.remove('on');
    const move = (e: PointerEvent) => { const el = (e.target as Element).closest?.('[data-tip]'); if (el) show(el, e.clientX, e.clientY); else hide(); };
    const focus = (e: FocusEvent) => { const el = (e.target as Element).closest?.('[data-tip]'); if (el) { const b = el.getBoundingClientRect(); show(el, b.left + b.width / 2, b.top); } else hide(); };
    document.addEventListener('pointermove', move);
    document.addEventListener('focusin', focus);
    return () => { document.removeEventListener('pointermove', move); document.removeEventListener('focusin', focus); };
  }, []);
  return <div className="tip" ref={tip} role="tooltip" style={{ whiteSpace: 'pre-line' }} />;
}
