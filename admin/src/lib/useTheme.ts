import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark';
const KEY = 'panzi.admin.theme';
function savedTheme(): Theme | null {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch { return null; }
}
function systemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function useTheme() {
  const [preference, setPreference] = useState<Theme | null>(savedTheme);
  const [system, setSystem] = useState<Theme>(systemTheme);
  const theme = preference ?? system;

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setSystem(systemTheme());
    const sync = (event: StorageEvent) => { if (event.key === KEY || event.key === null) setPreference(savedTheme()); };
    media.addEventListener('change', update);
    window.addEventListener('storage', sync);
    return () => { media.removeEventListener('change', update); window.removeEventListener('storage', sync); };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.adminTheme = theme;
    return () => { delete document.documentElement.dataset.adminTheme; };
  }, [theme]);

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setPreference(next);
    try { localStorage.setItem(KEY, next); } catch { /* The toggle still works when storage is blocked. */ }
  }
  return { theme, toggleTheme };
}
