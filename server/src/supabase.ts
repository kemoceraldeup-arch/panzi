// server/src/supabase.ts
//
// Where user-uploaded pictures live now that Firebase Storage is out of the
// stack. Supabase gives a bucket on the free tier; Firebase's would have meant
// putting the project back on Blaze for the sake of a few kilobytes of avatar.
//
// The service role key is the whole reason uploads go through this server
// rather than straight from the phone. It bypasses row-level security, so it
// can only ever live somewhere the user cannot read — and it means the path a
// file lands at is chosen here, from the verified token's uid, instead of being
// asserted by the client.
//
// The client is built on first use rather than at boot. A developer running the
// scanner has no reason to hold Supabase credentials, and failing at startup
// would make this feature's configuration everyone's problem.

import { createClient, SupabaseClient } from '@supabase/supabase-js';

/** Public read, so an avatar URL can be handed straight to an <Image>. */
export const AVATAR_BUCKET = 'avatars';

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (client) return client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not set — see server/.env.example'
    );
  }

  // No session to persist and no token to refresh: this client is authenticated
  // by the service role key on every call, and the process is long-lived.
  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}
