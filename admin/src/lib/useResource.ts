// One loader hook for every screen, so loading and failure look the same
// everywhere. The prototype had neither state; a console that renders an empty
// card when the API is down is worse than one that says the API is down.

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * How long a load may take before it is worth telling anyone about, and how
 * long the telling then lasts.
 *
 * Against a local API most of these finish in under a tenth of a second. A
 * spinner shown for that long is not a spinner — it is a flicker, and a
 * rotation is not perceptible in it, so it reads as a static ring that
 * appeared and vanished.
 *
 * So: nothing is shown for the first 140ms, and if the wait does cross that
 * line the loader stays up long enough to be recognised as one. The pair
 * matters — the delay alone would still allow a 10ms flash for a request that
 * finished at 150ms.
 */
const SPINNER_DELAY_MS = 140;
const SPINNER_MIN_VISIBLE_MS = 420;

export interface Resource<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
  updatedAt: number | null;
}

export function useResource<T>(load: () => Promise<T>, deps: unknown[]): Resource<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  // A screen can be left before its request lands — switching range twice in a
  // row is enough. Without this the slower reply wins and the screen shows the
  // range that is no longer selected.
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    const startedAt = Date.now();

    setLoading(true);
    setError(null);

    // Clearing `loading` is the one thing that is not immediate. A request that
    // beat SPINNER_DELAY_MS drops it now, because nothing was ever shown; one
    // that did not holds it until the loader has been up long enough to read as
    // a loader rather than a flash.
    const settle = () => {
      if (cancelled) return;
      const elapsed = Date.now() - startedAt;
      if (elapsed < SPINNER_DELAY_MS) {
        setLoading(false);
        return;
      }
      const remaining = SPINNER_DELAY_MS + SPINNER_MIN_VISIBLE_MS - elapsed;
      if (remaining <= 0) {
        setLoading(false);
        return;
      }
      timer = window.setTimeout(() => {
        if (!cancelled) setLoading(false);
      }, remaining);
    };

    loadRef
      .current()
      .then((value) => {
        if (!cancelled) { setData(value); setUpdatedAt(Date.now()); }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(settle);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return { data, error, loading, reload, updatedAt };
}
