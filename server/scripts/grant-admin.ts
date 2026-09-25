// server/scripts/grant-admin.ts
//
// Grants (or revokes) the `admin` custom claim that gates /api/admin/*.
//
// Run it from server/:
//   npx tsx scripts/grant-admin.ts someone@example.com
//   npx tsx scripts/grant-admin.ts someone@example.com --revoke
//
// Needs GOOGLE_APPLICATION_CREDENTIALS in server/.env pointing at a Firebase
// service account key. Verifying a token needs only the project id, but writing
// a claim is a privileged call and needs the key — which is also why this is a
// script run by hand rather than a route: an endpoint that can promote accounts
// is an endpoint worth attacking, and nothing in the console needs one.
//
// The claim reaches a signed-in browser on the next token refresh, so whoever
// was granted it has to sign out and in again, or press Recheck in the console.

import 'dotenv/config';
import admin from 'firebase-admin';

const [identifier, ...flags] = process.argv.slice(2);
const revoke = flags.includes('--revoke');

if (!identifier) {
  console.error('Usage: npx tsx scripts/grant-admin.ts <email-or-uid> [--revoke]');
  process.exit(1);
}

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error(
    'GOOGLE_APPLICATION_CREDENTIALS is not set in server/.env.\n' +
      'Firebase console > Project settings > Service accounts > Generate new private key,\n' +
      'save it as server/serviceAccount.json, then point that variable at it.'
  );
  process.exit(1);
}

const projectId = process.env.FIREBASE_PROJECT_ID;
if (!projectId) {
  console.error('FIREBASE_PROJECT_ID is not set in server/.env.');
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId });

async function main(): Promise<void> {
  const user = identifier.includes('@')
    ? await admin.auth().getUserByEmail(identifier)
    : await admin.auth().getUser(identifier);

  // Claims are replaced wholesale, not merged. Spreading what is already there
  // keeps this from quietly deleting a claim someone else added.
  const claims = { ...(user.customClaims ?? {}) };
  if (revoke) delete claims.admin;
  else claims.admin = true;

  await admin.auth().setCustomUserClaims(user.uid, claims);

  console.log(
    `${revoke ? 'Revoked' : 'Granted'} admin for ${user.email ?? user.uid} (uid ${user.uid}).`
  );
  console.log('They must sign out and in again — the claim rides in the ID token.');
}

main().catch((err: any) => {
  if (err?.code === 'auth/user-not-found') {
    console.error(`No Firebase account matches "${identifier}". They must sign in once first.`);
  } else {
    console.error(err?.message ?? err);
  }
  process.exit(1);
});
