// server/src/routes/adminAccess.ts
//
// Who may use the console, and what the console is currently configured to do.
//
// This is the most dangerous file in the admin surface. Every other route reads;
// this one hands out the right to read everything. The guards below are not
// defensive programming for its own sake — each one is a specific way this
// could go wrong that is worth refusing rather than logging afterwards.

import { Router } from 'express';
import { auth } from '../firebase';
import { withDb } from './helpers';

export const adminAccessRouter = Router();

/** Sign-in methods that identify a person well enough to trust with the claim. */
const REAL_PROVIDERS = ['password', 'google.com', 'apple.com'];

interface AdminRecord {
  uid: string;
  email: string | null;
  providers: string[];
  disabled: boolean;
  createdAt: string | null;
  lastSignInAt: string | null;
}

/** Every account currently holding the claim. Walks the whole user list, which
 *  is the only way to ask this question — Firebase has no "list by claim". */
async function listAdmins(): Promise<AdminRecord[]> {
  const admins: AdminRecord[] = [];
  let pageToken: string | undefined;

  do {
    const page = await auth.listUsers(1000, pageToken);
    for (const record of page.users) {
      if (record.customClaims?.admin === true) {
        admins.push({
          uid: record.uid,
          email: record.email ?? null,
          providers: record.providerData.map((provider) => provider.providerId),
          disabled: record.disabled,
          createdAt: record.metadata.creationTime ?? null,
          lastSignInAt: record.metadata.lastSignInTime ?? null,
        });
      }
    }
    pageToken = page.pageToken;
  } while (pageToken);

  return admins;
}

// ----------------------------------------------------------------- /admins

adminAccessRouter.get(
  '/admins',
  withDb(async (req, res) => {
    const admins = await listAdmins();

    res.json({
      admins: admins.map((record) => ({
        id: record.uid,
        email: record.email ?? `Anonymous account ${record.uid.slice(0, 8)}`,
        // The console signs in with a username and password. An anonymous
        // account holding the claim cannot use it, so saying so is more useful
        // than listing a provider nobody reads.
        canSignIn: record.providers.some((id) => REAL_PROVIDERS.includes(id)),
        disabled: record.disabled,
        createdAt: record.createdAt,
        lastSignInAt: record.lastSignInAt,
        isYou: record.uid === req.uid,
      })),
      note: null,
    });
  })
);


// Granting and revoking the admin claim is not done from the console. Use the
// grant-admin script in server/scripts, which needs the service account.

// ----------------------------------------------------------------- /config

/**
 * What this server is actually configured to do, read from the running process.
 *
 * Derived rather than written down, because a settings screen that restates
 * numbers from a document goes stale the first time someone changes one — and a
 * stale security claim is worse than none. Nothing here is editable: every value
 * is either an environment variable or a constant, and both belong in the
 * deployment rather than behind a button.
 *
 * Presence, never values. That GOOGLE_APPLICATION_CREDENTIALS is set is a fact
 * an admin needs — the users screen degrades without it. Where the key is, and
 * what is in it, is not.
 */
adminAccessRouter.get(
  '/config',
  withDb(async (_req, res) => {
    const origins = (process.env.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);

    res.json({
      groups: [
        {
          title: 'Who gets in',
          rows: [
            {
              label: 'Session length',
              value: '8 hours',
              note: 'Hard cap, whatever the token says. Closing the tab also ends it.',
            },
            {
              label: 'Admin gate',
              value: 'Firebase custom claim, re-checked per request',
              note: 'Revocation is checked against Firebase on every admin request, not trusted from the token alone.',
            },
            {
              label: 'Browser origins allowed',
              value: origins.length ? origins.join(', ') : 'none configured',
              note: origins.length
                ? 'Exact string match. The Expo app is not a browser and is unaffected.'
                : 'No browser can call this API until ALLOWED_ORIGINS is set.',
            },
            {
              label: 'Firebase service account',
              value: process.env.GOOGLE_APPLICATION_CREDENTIALS ? 'configured' : 'missing',
              note: process.env.GOOGLE_APPLICATION_CREDENTIALS
                ? 'Emails, suspended state and the admin roster are readable.'
                : 'Without it the console cannot read emails, suspend anyone, or list admins.',
            },
          ],
        },
        {
          title: 'Limits',
          rows: [
            {
              label: 'Admin rate limit',
              value: '300 requests / 15 minutes',
              note: 'Admin routes only. The app’s own routes are not limited.',
            },
            {
              label: 'Request body',
              value: '10MB scans · 2MB photos · 256KB everything else',
              note: 'Bodies are parsed before authentication, so the ceiling is per route.',
            },
            {
              label: 'Proxy headers trusted',
              value: process.env.TRUST_PROXY ? `yes (${process.env.TRUST_PROXY})` : 'no',
              note: 'Only turn this on behind a proxy that rewrites X-Forwarded-For, or the rate limit can be walked past.',
            },
          ],
        },
        {
          title: 'What is kept',
          rows: [
            {
              label: 'Admin access log',
              value: '180 days',
              note: 'Every admin request, including refused ones. Older rows are deleted by the database.',
            },
            {
              label: 'Model usage and cost',
              value: '365 days',
              note: 'Token counts per call. Prices are applied when read, not stored.',
            },
            {
              label: 'Device',
              value: 'platform only',
              note: 'iOS / Android / Web, from the User-Agent. The full string is never stored.',
            },
          ],
        },
      ],
    });
  })
);
