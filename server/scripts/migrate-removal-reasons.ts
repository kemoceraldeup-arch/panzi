// server/scripts/migrate-removal-reasons.ts
//
// One-time: converts pantry_removals rows that use the retired reasons
// 'leftover' and 'over-purchased' (see src/removalMigration.ts).
//
// Run it from server/:
//   npx tsx scripts/migrate-removal-reasons.ts           # counts only
//   npx tsx scripts/migrate-removal-reasons.ts --apply   # converts
//
// Run the dry run first and show the counts before applying.

import 'dotenv/config';
import mongoose from 'mongoose';
import { connectMongo } from '../src/mongo';
import { PantryRemoval } from '../src/models';
import { convertOldReasons, type ReasonRows } from '../src/removalMigration';

const apply = process.argv.includes('--apply');

async function main(): Promise<void> {
  await connectMongo();
  const result = await convertOldReasons(PantryRemoval.collection as unknown as ReasonRows, apply);
  for (const { reason, count } of result) {
    console.log(`${apply ? 'Converted' : 'Would convert'} ${count} row${count === 1 ? '' : 's'} with reason "${reason}".`);
  }
  if (!apply) console.log('Nothing was changed. Run again with --apply to convert.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect().catch(() => {}));
