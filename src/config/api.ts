// src/config/api.ts
//
// Where the app talks to its own backend, and how it proves who is asking.
//
// Firebase still issues the identity token — the sign-in screens are unchanged
// — but the server that trusts it is now ours. Every authenticated call goes
// through `apiFetch`, which attaches a fresh token and turns a non-2xx reply
// into an ApiError carrying the server's own error code.

import { auth } from './firebaseClient';

// Set in .env as EXPO_PUBLIC_API_URL. Expo inlines EXPO_PUBLIC_* variables at
// build time, so this is a literal by the time it runs on the phone.
//
// In development it must be this computer's LAN address, not localhost: the app
// runs on the phone, where localhost is the phone. Find it with `ipconfig` and
// use the IPv4 address, e.g. http://192.168.1.14:8080
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? '';

/** Carries the server's error code so callers can react to specific failures. */
export class ApiError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

// A scan legitimately takes the better part of a minute, so the request itself
// cannot be given a short deadline. But an unreachable server — laptop asleep,
// wrong IP in .env, phone on mobile data — would then hang for that whole
// minute with the app claiming to be reading. This settles which of the two is
// happening before the slow request starts.
const REACHABILITY_TIMEOUT_MS = 4000;

async function assertReachable(): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REACHABILITY_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_URL}/health`, { signal: controller.signal });
    if (!response.ok) throw new Error(`health returned ${response.status}`);
  } catch {
    throw new ApiError(
      'unreachable',
      `Could not reach the server at ${API_URL} — check it is running and that the phone is on the same network.`
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function apiFetch<T>(path: string, body?: unknown): Promise<T> {
  if (!API_URL) {
    throw new ApiError('no-api-url', 'The app is not pointed at a server yet.');
  }

  await assertReachable();

  const user = auth.currentUser;
  if (!user) {
    throw new ApiError('unauthenticated', 'Sign in again.');
  }

  // Firebase refreshes this automatically when it is close to expiring, so the
  // server never sees a stale token during a long session.
  const token = await user.getIdToken();

  const response = await fetch(`${API_URL}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!response.ok) {
    // A crashed process or a proxy error returns HTML, not JSON, so the parse
    // has to be allowed to fail without hiding the status behind a syntax error.
    let code = 'internal';
    let message = 'Something went wrong.';
    try {
      const payload = await response.json();
      code = payload?.error ?? code;
      message = payload?.message ?? message;
    } catch {
      code = response.status === 401 ? 'unauthenticated' : 'internal';
    }
    throw new ApiError(code, message);
  }

  return (await response.json()) as T;
}
