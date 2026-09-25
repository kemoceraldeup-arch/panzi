// One way in and out of the API, mirroring src/config/api.ts in the app: attach
// a fresh Firebase token, turn a non-2xx into an error that carries the
// server's own code so a caller can tell 'forbidden' from 'internal'.

import { auth } from '../lib/firebase';

export const API_URL: string = import.meta.env.VITE_API_URL ?? '';

/** True while the console renders the prototype's data instead of the API. */
export const SAMPLE_MODE: boolean = import.meta.env.DEV && import.meta.env.VITE_SAMPLE_DATA === 'true';

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiFetch<T>(
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<T> {
  if (!API_URL) {
    throw new ApiError('no-api-url', 'VITE_API_URL is not set.');
  }

  const user = auth.currentUser;
  if (!user) {
    throw new ApiError('unauthenticated', 'Sign in again.');
  }

  // Firebase refreshes this on its own as it nears expiry, so a long session
  // never sends the server a stale token.
  const token = await user.getIdToken();
  const body = init?.body;

  const response = await fetch(`${API_URL}${path}`, {
    method: init?.method ?? (body === undefined ? 'GET' : 'POST'),
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!response.ok) {
    // A crashed process or a proxy returns HTML, not JSON, so the parse has to
    // be allowed to fail without burying the status under a syntax error.
    let code = 'internal';
    let message = 'Something went wrong.';
    try {
      const payload = await response.json();
      code = payload?.error ?? code;
      message = payload?.message ?? message;
    } catch {
      code = response.status === 401 ? 'unauthenticated' : 'internal';
      message = `The server returned ${response.status}.`;
    }
    throw new ApiError(code, message);
  }

  return (await response.json()) as T;
}
