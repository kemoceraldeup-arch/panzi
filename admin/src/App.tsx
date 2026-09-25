import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { flushSync } from 'react-dom';
import { BrowserRouter, HashRouter, Navigate, NavLink, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { LogOut, Menu, Moon, PanelLeftClose, PanelLeftOpen, Search, Sun } from 'lucide-react';
import { MotionConfig } from 'framer-motion';
import { SAMPLE_MODE } from './api/client';
import { getReview } from './api';
import { navigation, settingsItem } from './components/navigation';
import { useTheme } from './lib/useTheme';
import { NotAdmin, SignIn } from './components/SignIn';
import { reducedMotion, TipLayer, ToastProvider } from './components/pz';
import { AuthProvider, useAuth } from './lib/auth';
import { Analytics } from './screens/Analytics';
import { Chatbot } from './screens/Chatbot';
import { Costs } from './screens/Costs';
import { Dashboard } from './screens/Dashboard';
import { FoodDatabase } from './screens/FoodDatabase';
import { Logs } from './screens/Logs';
import { Recipes } from './screens/Recipes';
import { Review } from './screens/Review';
import { Settings } from './screens/Settings';
import { Users } from './screens/Users';

// A way to look at the console before anyone holds an admin claim, without
// leaving a hole in a deployed build: `import.meta.env.DEV` is false in
// anything `vite build` produces, so this cannot be switched on in production
// no matter what the .env of the machine doing the build says.
const AUTH_BYPASS =
  import.meta.env.DEV && SAMPLE_MODE && import.meta.env.VITE_SKIP_AUTH === 'true';

const ALL_PAGES = [...navigation.flatMap((group) => group.items), settingsItem];

// A shareable preview build (see README): sample data, no sign-in, and routes
// kept in the #hash so the page works from any static host without rewrites.
const PUBLIC_PREVIEW = import.meta.env.VITE_PUBLIC_PREVIEW === 'true';
const Router = PUBLIC_PREVIEW ? HashRouter : BrowserRouter;

const SIDEBAR_KEY = 'panzi.admin.sidebar';
// Below this width the sidebar is a slide-in drawer (see panzi.css), so the
// same button closes the drawer instead of shrinking it to a rail.
const NARROW = '(max-width: 860px)';

function useCollapsed() {
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(SIDEBAR_KEY) === 'collapsed'; } catch { return false; }
  });
  const toggle = useCallback(() => {
    setCollapsed((was) => {
      try { localStorage.setItem(SIDEBAR_KEY, was ? 'open' : 'collapsed'); } catch { /* Still toggles when storage is blocked. */ }
      return !was;
    });
  }, []);
  return { collapsed, toggle };
}

function useNarrow() {
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW).matches);
  useEffect(() => {
    const media = window.matchMedia(NARROW);
    const update = () => setNarrow(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return narrow;
}

function Brand({ collapsed, narrow, onToggle }: { collapsed: boolean; narrow: boolean; onToggle: () => void }) {
  const label = narrow ? 'Close navigation' : collapsed ? 'Expand sidebar' : 'Collapse sidebar';
  const showOpen = collapsed && !narrow;
  return (
    <div className="brand-row">
      <NavLink className="brand" to="/" aria-label="Panzi dashboard">
        <img src="/panzi-logo.png" alt="" width={26} height={26} />
        <span className="label">Panzi</span>
      </NavLink>
      <button className="icon-btn side-toggle" type="button" onClick={onToggle} aria-label={label}
        aria-controls="side" aria-expanded={narrow || !collapsed} data-tip={narrow ? undefined : `${label} (Ctrl+B)`}>
        {/* Keyed so the new icon mounts and plays its turn-in animation. */}
        <span className="swap" key={showOpen ? 'open' : 'close'}>
          {showOpen ? <PanelLeftOpen className="i" aria-hidden="true" /> : <PanelLeftClose className="i" aria-hidden="true" />}
        </span>
      </button>
    </div>
  );
}

function Shell() {
  const { theme, toggleTheme } = useTheme();
  const { signOut } = useAuth();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [openReports, setOpenReports] = useState<number | null>(null);
  const { collapsed, toggle: toggleCollapsed } = useCollapsed();
  const narrow = useNarrow();
  const rail = collapsed && !narrow;
  const onSideToggle = narrow ? () => setMenuOpen(false) : toggleCollapsed;
  const page = ALL_PAGES.find((item) => item.to === location.pathname) ?? ALL_PAGES[0];

  useEffect(() => { document.title = `${page.label} - Panzi admin`; }, [page.label]);
  useEffect(() => { setMenuOpen(false); window.scrollTo(0, 0); document.getElementById('page')?.focus({ preventScroll: true }); }, [location.pathname]);

  // The badge on Needs review: open scan issues plus open feedback. Refreshed on
  // every page change so a decision saved on the review page shows up here.
  useEffect(() => {
    let cancelled = false;
    getReview('open', 1).then((data) => {
      if (cancelled) return;
      const count = (data.pagination?.scans ?? data.scans.length) + (data.pagination?.feedback ?? data.feedback.length);
      setOpenReports(count);
    }).catch(() => { if (!cancelled) setOpenReports(null); });
    return () => { cancelled = true; };
  }, [location.pathname]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setPaletteOpen(true); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'b' && !window.matchMedia(NARROW).matches) { event.preventDefault(); toggleCollapsed(); }
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [toggleCollapsed]);

  // Theme switch: the new theme wipes in as a circle from the button (View
  // Transitions). Reduced motion, or a browser without the API, gets a short
  // color crossfade instead.
  function switchTheme(event: MouseEvent<HTMLButtonElement>) {
    const root = document.documentElement;
    const apply = () => flushSync(toggleTheme);
    if (reducedMotion() || !document.startViewTransition) {
      root.classList.add('theme-fade');
      apply();
      window.setTimeout(() => root.classList.remove('theme-fade'), 400);
      return;
    }
    const box = event.currentTarget.getBoundingClientRect();
    const x = event.clientX || box.left + box.width / 2, y = event.clientY || box.top + box.height / 2;
    const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    document.startViewTransition(apply).ready.then(() => {
      root.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 560, easing: 'cubic-bezier(.32, .08, .24, 1)', pseudoElement: '::view-transition-new(root)' },
      );
    }).catch(() => {});
  }

  const link = (item: (typeof ALL_PAGES)[number]) => {
    const Icon = item.icon;
    return (
      <li key={item.to}>
        <NavLink className="nav-link" to={item.to} end aria-label={rail ? item.label : undefined} data-tip={rail ? item.label : undefined}>
          <Icon className="i" aria-hidden="true" /><span className="label">{item.label}</span>
          {item.to === '/review' && openReports !== null && openReports > 0 && (
            <span className="badge" aria-label={`${openReports} open`}>{openReports}</span>
          )}
        </NavLink>
      </li>
    );
  };

  return (
    <div className="pz" data-theme={theme}>
      <ToastProvider>
        <a href="#page" className="skip" onClick={(e) => { e.preventDefault(); document.getElementById('page')?.focus(); }}>Skip to content</a>
        <div className={`pz-shell${rail ? ' collapsed' : ''}`}>
          <aside className={`side${menuOpen ? ' on' : ''}`} id="side" aria-label="Main navigation">
            <Brand collapsed={collapsed} narrow={narrow} onToggle={onSideToggle} />
            <nav id="nav">
              {navigation.map((group) => (
                <div className="nav-group" key={group.label}>
                  <h2>{group.label}</h2>
                  <ul>{group.items.map(link)}</ul>
                </div>
              ))}
            </nav>
            <div className="side-foot">
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>{link(settingsItem)}</ul>
              <div className="me">
                <span className="avatar" style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }} data-tip={rail ? 'Signed in as Admin' : undefined}>A</span>
                <span className="who"><b>Admin</b><small>{AUTH_BYPASS ? 'Local preview' : 'Signed in'}</small></span>
                {!AUTH_BYPASS && <button className="icon-btn" type="button" onClick={() => void signOut()} aria-label="Sign out" title="Sign out"><LogOut className="i" aria-hidden="true" /></button>}
              </div>
            </div>
          </aside>
          <div className="pz-main" inert={menuOpen}>
            <header className="top">
              <button className="icon-btn menu-btn" type="button" onClick={() => setMenuOpen(true)} aria-label="Open navigation" aria-controls="side" aria-expanded={menuOpen}>
                <Menu className="i" aria-hidden="true" />
              </button>
              <div className="search-global">
                <Search className="i" aria-hidden="true" />
                <input type="search" placeholder="Go to a page" aria-label="Search pages" readOnly onClick={() => setPaletteOpen(true)} onKeyDown={(e) => { if (e.key === 'Enter') setPaletteOpen(true); }} />
                <kbd>Ctrl K</kbd>
              </div>
              <div className="top-right">
                {SAMPLE_MODE && <span className="sample-note">Sample data</span>}
                <button className="icon-btn" type="button" onClick={switchTheme} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>
                  {theme === 'dark' ? <Sun className="i" aria-hidden="true" /> : <Moon className="i" aria-hidden="true" />}
                </button>
              </div>
            </header>
            {AUTH_BYPASS && <div className="preview-bar">{PUBLIC_PREVIEW
              ? 'Design preview with sample data. The people and numbers are made up, and nothing here can be saved.'
              : 'Local preview with sample data. Sign-in is skipped in development only.'}</div>}
            <main className="page" id="page" tabIndex={-1}><Outlet /></main>
          </div>
        </div>
        {paletteOpen && <Palette onClose={() => setPaletteOpen(false)} />}
        <TipLayer />
      </ToastProvider>
    </div>
  );
}

function Palette({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const hits = useMemo(() => ALL_PAGES.filter((item) => item.label.toLowerCase().includes(query.toLowerCase())), [query]);
  useEffect(() => { input.current?.focus(); }, []);
  const go = useCallback((to: string) => { onClose(); navigate(to); }, [navigate, onClose]);
  return (
    <div className="palette" role="dialog" aria-modal="true" aria-label="Go to a page" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="palette-box">
        <input ref={input} value={query} placeholder="Go to a page" aria-label="Page name" autoComplete="off"
          onChange={(e) => { setQuery(e.target.value); setActive(0); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, hits.length - 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
            if (e.key === 'Enter' && hits[active]) go(hits[active].to);
            if (e.key === 'Escape') onClose();
          }} />
        <ul role="listbox">
          {hits.length === 0 && <li className="empty" style={{ padding: 18 }}>No page matches that name</li>}
          {hits.map((item, i) => {
            const Icon = item.icon;
            return (
              <li key={item.to} role="option" aria-selected={i === active}>
                <a href={item.to} className={i === active ? 'active' : ''} onClick={(e) => { e.preventDefault(); go(item.to); }}>
                  <Icon className="i" aria-hidden="true" />{item.label}<small>Page</small>
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function Gate() {
  const { user, isAdmin, loading } = useAuth();
  if (AUTH_BYPASS) return <Shell />;
  if (loading) {
    return (
      <div className="gate">
        <div className="state" role="status">Checking your session…</div>
      </div>
    );
  }
  if (!user) return <SignIn />;
  if (!isAdmin) return <NotAdmin />;
  return <Shell />;
}

export function App() {
  return (
    <MotionConfig reducedMotion="user">
      <AuthProvider>
        <Router>
          <Routes>
            <Route element={<Gate />}>
              <Route index element={<Dashboard />} />
              <Route path="users" element={<Users />} />
              <Route path="food" element={<FoodDatabase />} />
              <Route path="recipes" element={<Recipes />} />
              <Route path="review" element={<Review />} />
              <Route path="chatbot" element={<Chatbot />} />
              <Route path="analytics" element={<Analytics />} />
              <Route path="costs" element={<Costs />} />
              <Route path="logs" element={<Logs />} />
              <Route path="settings" element={<Settings />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </Router>
      </AuthProvider>
    </MotionConfig>
  );
}
