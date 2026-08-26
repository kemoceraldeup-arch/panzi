// server/src/routes/feedback.ts
//
// What "Send feedback" writes.
//
// A collection rather than an email or a support address: the app already has
// an authenticated user and this server already has a database, so this costs
// no new service and publishes no inbox for anyone to find. Read it in Atlas.
//
// One thing was lost in the move off Firestore, and it is worth naming. A
// Firestore write queued while offline was held on the device and sent when the
// phone came back; an HTTP request just fails. Somebody typing a report on a
// bus now gets an error instead of a silent success — which is the honest
// outcome, but it means the app has to say so rather than pretending.

import { Router } from 'express';
import { Feedback } from '../models';
import { badRequest, withDb } from './helpers';

export const feedbackRouter = Router();

/** Long enough for a real report, short enough not to be a document. */
const FEEDBACK_MAX_LENGTH = 1000;

feedbackRouter.post(
  '/',
  withDb(async (req, res) => {
    const { email, message, appVersion, platform } = (req.body ?? {}) as {
      email?: string | null;
      message?: string;
      appVersion?: string;
      platform?: string;
    };

    if (typeof message !== 'string' || !message.trim()) {
      return badRequest(res, 'The message was empty.');
    }

    await Feedback.create({
      userId: req.uid,
      // Stored alongside the uid so a reply is possible without looking the
      // account up, and because the uid alone says nothing to a human reading
      // these.
      email: typeof email === 'string' ? email : null,
      // Truncated here as well as on the phone. The client's limit is a
      // courtesy to the person typing; this one is what actually bounds the
      // document.
      message: message.trim().slice(0, FEEDBACK_MAX_LENGTH),
      appVersion: typeof appVersion === 'string' ? appVersion : '',
      platform: typeof platform === 'string' ? platform : '',
    });

    res.json({ ok: true });
  })
);
