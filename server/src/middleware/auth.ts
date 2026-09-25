// server/src/middleware/auth.ts
//
// Every request that touches a user's data passes through here. The rule the
// rest of the server depends on: routes read `req.uid` and never a user id sent
// in a body or a query string. A client can write anything it likes into a
// payload; it cannot forge a token signed by Google.

import { NextFunction, Request, Response } from 'express';
import { noteDevice } from '../device';
import { auth } from '../firebase';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      uid?: string;
      isAdmin?: boolean;
    }
  }
}

/**
 * How stale an account check may get on the app's routes.
 *
 * A signed token stays valid for up to an hour whatever happens to the account
 * behind it. Asking Firebase on every request would close that gap completely
 * but costs a round trip per call from every phone, so each uid is re-checked
 * at most this often. A deleted or disabled account is shut out within five
 * minutes instead of within the hour.
 */
const RECHECK_MS = 5 * 60 * 1000;
const lastChecked = new Map<string, number>();

/** Accounts shut out by this process — an account deletion calls revokeNow so
 *  that a request already in flight cannot write to collections the deletion
 *  is emptying. */
const revokedHere = new Set<string>();
export function revokeNow(uid: string): void {
  revokedHere.add(uid);
  lastChecked.delete(uid);
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    res.status(401).json({ error: 'unauthenticated', message: 'Sign in before scanning.' });
    return;
  }

  try {
    let decoded = await auth.verifyIdToken(token);
    if (revokedHere.has(decoded.uid)) throw new Error('revoked');
    if (Date.now() - (lastChecked.get(decoded.uid) ?? 0) > RECHECK_MS) {
      // Throws when the account was disabled, deleted, or its sessions revoked.
      decoded = await auth.verifyIdToken(token, true);
      if (lastChecked.size > 50_000) lastChecked.clear();
      lastChecked.set(decoded.uid, Date.now());
    }
    req.uid = decoded.uid;
    // Admin rights ride on a custom claim rather than a database field, so a
    // compromised Mongo document cannot promote anyone.
    req.isAdmin = decoded.admin === true;
    // Fire-and-forget, throttled, and it never creates a document — see
    // device.ts. This is the only place every authenticated request passes
    // through, which is why it hangs here rather than in each router.
    noteDevice(req.uid, req.headers['user-agent']);
    next();
  } catch {
    // An expired token and a forged one are the same to the caller: sign in
    // again. Saying which it was only helps someone probing the endpoint.
    res.status(401).json({ error: 'unauthenticated', message: 'Sign in again before scanning.' });
  }
}

/**
 * The second gate, and the only one that asks Firebase a second question.
 *
 * requireAuth checks that a token is signed and unexpired. That is the right
 * check for the app's own routes, but it has a gap that matters here: an ID
 * token stays valid for up to an hour after it is issued, no matter what
 * happens to the account behind it. Disable an administrator, or revoke the
 * admin claim, and the token already in their browser keeps opening every
 * pantry in the system until it expires on its own.
 *
 * `verifyIdToken(token, true)` asks Firebase whether the account's refresh
 * tokens have been revoked since — which is exactly what disabling an account
 * does — so a revoked administrator is out on their next request rather than
 * within the hour. It costs a round trip to Google, which is why it is here and
 * not in requireAuth: the app's routes are called by every phone running Panzi,
 * and the console is one person clicking.
 */
export async function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!req.isAdmin) {
    res.status(403).json({ error: 'forbidden', message: 'Admins only.' });
    return;
  }

  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    res.status(403).json({ error: 'forbidden', message: 'Admins only.' });
    return;
  }

  try {
    const decoded = await auth.verifyIdToken(token, true);
    // Re-read rather than trusting what requireAuth put on the request: this is
    // a fresher answer to the same question, and if the claim was stripped in
    // between, this is the call that notices.
    if (decoded.admin !== true) {
      res.status(403).json({ error: 'forbidden', message: 'Admins only.' });
      return;
    }
    next();
  } catch {
    // Revoked, disabled, or Firebase unreachable. The console cannot tell the
    // difference and neither can this: the safe answer to "may this token read
    // every account in the system" is no.
    res.status(403).json({
      error: 'forbidden',
      message: 'That session is no longer valid. Sign in again.',
    });
  }
}
