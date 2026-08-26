// server/src/routes/helpers.ts
//
// The two things every data route does before and after its own work: make sure
// the database is up, and make sure a thrown error becomes a sentence rather
// than a stack trace on the phone.
//
// Without the wrapper, an async handler that rejects does not reach Express's
// error middleware at all — Express 5 forwards rejected promises, but only from
// handlers it recognises as returning one, and a route that throws before its
// first await is not one of them. The request would hang until the client's own
// timeout, which reads as a dead server rather than a failed query.

import { Request, Response } from 'express';
import { connectMongo } from '../mongo';

type Handler = (req: Request, res: Response) => Promise<void>;

/**
 * Wraps a data route: connects, runs, and turns anything thrown into a 500 with
 * an error code the app can branch on.
 *
 * The message sent back is deliberately generic. A Mongo error string can name
 * collections, fields, and occasionally the connection string, none of which
 * belongs in a client that anyone can read.
 */
export function withDb(handler: Handler) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      await connectMongo();
      await handler(req, res);
    } catch (err: any) {
      console.error('Data route failed', {
        path: req.originalUrl,
        uid: req.uid,
        message: err?.message,
      });
      if (!res.headersSent) {
        res.status(500).json({ error: 'internal', message: 'Something went wrong.' });
      }
    }
  };
}

/** 400 with a sentence, for a body that could not have come from our own app. */
export function badRequest(res: Response, message: string): void {
  res.status(400).json({ error: 'bad-request', message });
}

/**
 * A client-supplied id, checked before it reaches a query.
 *
 * Ids are generated on the phone so the interface can respond before a write
 * lands, which means they arrive from outside and cannot be trusted on sight.
 * Bounding the length and character set keeps a hostile string out of a filter
 * and stops a document being written under a key nothing can ever look up.
 */
export function isValidId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128;
}
