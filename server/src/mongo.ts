// server/src/mongo.ts
//
// The connection to MongoDB Atlas, and the one place that knows how to open it.
//
// Connecting lazily rather than at boot is the same decision supabase.ts makes,
// for the same reason: a developer running only the scanner has no cluster and
// no connection string, and failing at startup would make the pantry routes'
// configuration everyone's problem. The scan and recipe routes hold no state
// and never touch this file.
//
// Mongoose buffers commands issued before the socket is ready, so the first
// request to arrive during a cold start waits rather than failing — but only
// for `bufferTimeoutMS`. Past that it throws, which is the behaviour we want:
// a request that hangs forever is worse than one that reports a dead database.

import mongoose from 'mongoose';

let connecting: Promise<typeof mongoose> | null = null;

/**
 * Opens the connection on first use and hands back the same promise after that.
 *
 * Every route that reads or writes user data awaits this first. Calling it
 * repeatedly is free — the promise is memoised, and Mongoose keeps one pool for
 * the life of the process.
 */
export async function connectMongo(): Promise<typeof mongoose> {
  if (connecting) return connecting;

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is not set — copy .env.example to .env and fill it in');
  }

  // Mongoose 7 dropped the loose-query default. Strict mode means a typo in a
  // filter key raises instead of silently matching every document, which is the
  // difference between "no results" and "this user just read someone else's
  // pantry".
  mongoose.set('strictQuery', true);

  // How long a command issued before the socket is ready will wait. It is a
  // global setting rather than a connect option — Mongoose buffers on the model,
  // not on the connection.
  mongoose.set('bufferTimeoutMS', 15000);

  connecting = mongoose
    .connect(uri, {
      // Atlas free tier can take a few seconds to wake. Ten is long enough for
      // that and short enough that a wrong connection string is obvious.
      serverSelectionTimeoutMS: 10000,
    })
    .then((m) => {
      console.log('MongoDB connected');
      return m;
    })
    .catch((err) => {
      // Cleared so the next request retries rather than being handed a rejected
      // promise forever. A cluster that was asleep, or a laptop that had no
      // network for a moment, should not poison the process.
      connecting = null;
      throw err;
    });

  return connecting;
}

export default mongoose;
