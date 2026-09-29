// server/src/middleware/audit.ts
//
// Who looked at what.
//
// Every other router in this server is scoped to req.uid: a request can only
// ever reach its own author's data, so "who read this" has one possible answer
// and writing it down would say nothing. The admin routes are the exception —
// they exist to read across accounts — which makes them the only place in the
// system where an access record is a fact worth keeping.
//
// The actor is the verified uid from the token. Nothing here is taken from the
// request body, for the same reason requireAuth does not: a client can write
// anything into a payload, and an audit trail a client can forge is worse than
// none, because it looks like evidence.

import { NextFunction, Request, Response } from 'express';
import { AdminAudit } from '../models';
import { connectMongo } from '../mongo';

/** Route shapes whose second path segment names the account being inspected. */
const USER_SCOPED = /^\/users\/([^/]+)/;

export function auditAdmin(req: Request, res: Response, next: NextFunction): void {
  const startedAt = Date.now();

  // 'finish' rather than doing this up front, so the record carries the status
  // the caller actually got. An audit line that says a request was made, but not
  // whether it succeeded, cannot answer "did they see it".
  res.once('finish', () => {
    // A route can name the account it touched when the path does not. Reading
    // a chat transcript is the case that needs it: the URL carries a
    // conversation id, but the access being recorded is to a person's words,
    // and a log that cannot say whose is not much of a log.
    const match = USER_SCOPED.exec(req.path);
    const targetUserId =
      typeof res.locals.auditTarget === 'string'
        ? res.locals.auditTarget
        : match
          ? decodeURIComponent(match[1])
          : null;

    // Fire-and-forget, and connected here rather than assumed: a GET that never
    // touched Mongo would otherwise fail this write on a cold process. Failing
    // to record must never turn a served request into an error — the response
    // has already gone out by this point either way.
    void connectMongo()
      .then(() =>
        AdminAudit.create({
          actorId: req.uid ?? 'unknown',
          actorEmail: null,
          method: req.method,
          path: req.originalUrl,
          status: res.statusCode,
          durationMs: Date.now() - startedAt,
          targetUserId,
          // Behind a proxy this is the proxy unless TRUST_PROXY is set — the
          // same caveat the rate limiter carries, and the reason it is stored
          // rather than trusted.
          ip: req.ip ?? null,
        })
      )
      .catch((err: unknown) => {
        console.warn('admin_audit write failed', {
          path: req.originalUrl,
          message: err instanceof Error ? err.message : String(err),
        });
      });
  });

  next();
}
