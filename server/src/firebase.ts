// server/src/firebase.ts
//
// Firebase stays in the stack for one job: it owns identity. The phone signs in
// with the Firebase SDK exactly as it always has, and this server verifies the
// token that sign-in produces. Nothing else about Firebase survives the move to
// Mongo — no Firestore, no Cloud Functions, no billing plan.

import admin from 'firebase-admin';

const projectId = process.env.FIREBASE_PROJECT_ID;

if (!projectId) {
  throw new Error('FIREBASE_PROJECT_ID is not set — copy .env.example to .env');
}

// Verifying an ID token only needs the project id: the signature is checked
// against Google's public keys, which are fetched over the open internet. A
// service account is required only for privileged calls such as granting the
// admin custom claim, so it stays optional until the admin panel exists.
const credential = process.env.GOOGLE_APPLICATION_CREDENTIALS
  ? admin.credential.applicationDefault()
  : undefined;

admin.initializeApp(credential ? { credential, projectId } : { projectId });

export const auth = admin.auth();
export default admin;
