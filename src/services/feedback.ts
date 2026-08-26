// src/services/feedback.ts
//
// What "Send feedback" writes.
//
// A route on our own server rather than an email or a published support
// address: the app already has an authenticated user and the server already has
// a database, so this costs no new service and no inbox for anyone to find.
// Read it in Atlas.
//
// One thing changed in the move off Firestore and the screen has to know about
// it. A queued Firestore write survived being offline — it was held on the
// device and sent when the phone came back, which was the right behaviour for a
// message somebody typed on a bus. An HTTP request just fails. The send is now
// something to await and report on rather than fire and forget.

import { Platform } from 'react-native';
import { apiFetch } from '../config/api';

/** Long enough for a real report, short enough not to be a document. */
export const FEEDBACK_MAX_LENGTH = 1000;

export async function sendFeedback(
  uid: string,
  email: string | null,
  message: string,
  appVersion: string
): Promise<void> {
  await apiFetch('/api/feedback', {
    // Sent alongside the token's uid so a reply is possible without looking the
    // account up, and because the uid alone says nothing to a human reading
    // these.
    email,
    message: message.trim().slice(0, FEEDBACK_MAX_LENGTH),
    appVersion,
    platform: `${Platform.OS} ${Platform.Version}`,
  });
}
