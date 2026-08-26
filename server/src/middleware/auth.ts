// server/src/middleware/auth.ts
//
// Every request that touches a user's data passes through here. The rule the
// rest of the server depends on: routes read `req.uid` and never a user id sent
// in a body or a query string. A client can write anything it likes into a
// payload; it cannot forge a token signed by Google.

import { NextFunction, Request, Response } from 'express';
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

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    res.status(401).json({ error: 'unauthenticated', message: 'Sign in before scanning.' });
    return;
  }

  try {
    const decoded = await auth.verifyIdToken(token);
    req.uid = decoded.uid;
    // Admin rights ride on a custom claim rather than a database field, so a
    // compromised Mongo document cannot promote anyone.
    req.isAdmin = decoded.admin === true;
    next();
  } catch {
    // An expired token and a forged one are the same to the caller: sign in
    // again. Saying which it was only helps someone probing the endpoint.
    res.status(401).json({ error: 'unauthenticated', message: 'Sign in again before scanning.' });
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.isAdmin) {
    res.status(403).json({ error: 'forbidden', message: 'Admins only.' });
    return;
  }
  next();
}
