// server/src/index.ts
//
// The Panzi API. One backend serving two clients: the Expo app and, later, the
// admin panel. It replaces both halves of the old Firebase backend — Firestore
// for data and Cloud Functions for the scanner — leaving Firebase responsible
// only for logins.

import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import { requireAuth } from './middleware/auth';
import { chatRouter } from './routes/chat';
import { feedbackRouter } from './routes/feedback';
import { pantryRouter } from './routes/pantry';
import { profileRouter } from './routes/profile';
import { recipesRouter } from './routes/recipes';
import { savedRecipesRouter } from './routes/savedRecipes';
import { scanRouter } from './routes/scan';
import { scansRouter } from './routes/scans';

const app = express();

// A resized shelf photo arrives as roughly 5MB of base64. Express defaults to
// 100kb, which rejects every scan with a confusing error, so this has to be
// raised deliberately. MAX_BASE64_LENGTH in routes/scan.ts is the real cap;
// this is only the outer guard.
app.use(express.json({ limit: '10mb' }));

// The Expo app is not a browser and ignores CORS entirely. This exists for the
// admin panel, which is a browser and does not.
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // No origin header means a non-browser caller — curl, the Expo app, a
      // health check. Those are authenticated by token, not by origin.
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error(`Origin not allowed: ${origin}`));
    },
  })
);

// Unauthenticated on purpose: hosting platforms ping this to decide whether the
// instance is alive, and it reveals nothing.
app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.use('/api/scan', requireAuth, scanRouter);
app.use('/api/recipes', requireAuth, recipesRouter);
app.use('/api/profile', requireAuth, profileRouter);

// The collections that moved off Firestore. Each one connects to Mongo lazily
// on its first request, so a developer running only the scanner still needs no
// cluster and no connection string.
app.use('/api/pantry', requireAuth, pantryRouter);
app.use('/api/saved-recipes', requireAuth, savedRecipesRouter);
app.use('/api/scans', requireAuth, scansRouter);
app.use('/api/feedback', requireAuth, feedbackRouter);
app.use('/api/chat', requireAuth, chatRouter);

// Anything thrown by a route or by the CORS check lands here rather than
// crashing the process or hanging the request.
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error', { message: err.message });
  res.status(500).json({ error: 'internal', message: 'Something went wrong.' });
});

const port = Number(process.env.PORT ?? 8080);

// Bound to 0.0.0.0 rather than localhost so a phone on the same wifi can reach
// it during development. On localhost the server is invisible to every device
// except this computer.
app.listen(port, '0.0.0.0', () => {
  console.log(`Panzi API listening on http://0.0.0.0:${port}`);
});
