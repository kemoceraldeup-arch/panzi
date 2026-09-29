// server/scripts/check-connections.ts
//
// Read-only health check for the three outside services the API depends on.
// Run from server/:  npx tsx scripts/check-connections.ts
//
// Nothing here writes. Each check makes the smallest call that proves the
// credentials in .env are accepted, and prints the reason when they are not.

import 'dotenv/config';
import mongoose from 'mongoose';
import { connectMongo } from '../src/mongo';
import admin, { auth } from '../src/firebase';
import { AVATAR_BUCKET, supabase } from '../src/supabase';

type Result = { name: string; ok: boolean; detail: string };

async function check(name: string, run: () => Promise<string>): Promise<Result> {
  try {
    return { name, ok: true, detail: await run() };
  } catch (err) {
    return { name, ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

async function main() {
  const results = await Promise.all([
    check('MongoDB', async () => {
      const m = await connectMongo();
      const db = m.connection.db!;
      await db.command({ ping: 1 });
      const collections = await db.listCollections({}, { nameOnly: true }).toArray();
      return `database "${db.databaseName}", ${collections.length} collections`;
    }),
    check('Firebase', async () => {
      const page = await auth.listUsers(1);
      return `project "${process.env.FIREBASE_PROJECT_ID}", service account accepted (${page.users.length ? 'users found' : 'no users yet'})`;
    }),
    check('Supabase', async () => {
      const { data, error } = await supabase().storage.listBuckets();
      if (error) throw error;
      const names = data.map((b) => b.name);
      const avatars = names.includes(AVATAR_BUCKET) ? '' : ` (missing "${AVATAR_BUCKET}" bucket)`;
      return `storage buckets: ${names.join(', ') || 'none'}${avatars}`;
    }),
  ]);

  for (const r of results) {
    console.log(`${r.ok ? 'OK  ' : 'FAIL'}  ${r.name.padEnd(9)} ${r.detail}`);
  }

  // Close every handle and let Node exit on its own. Calling process.exit()
  // with sockets still open trips a libuv assertion on Windows.
  await mongoose.disconnect().catch(() => {});
  await admin.app().delete().catch(() => {});
  process.exitCode = results.every((r) => r.ok) ? 0 : 1;
}

main();
