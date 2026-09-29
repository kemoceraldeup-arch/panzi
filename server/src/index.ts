// server/src/index.ts
//
// The Panzi API. One backend serving two clients: the Expo app and, later, the
// admin panel. It replaces both halves of the old Firebase backend — Firestore
// for data and Cloud Functions for the scanner — leaving Firebase responsible
// only for logins.

import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { auditAdmin } from './middleware/audit';
import { requireAdmin, requireAuth } from './middleware/auth';
import { adminRouter } from './routes/admin';
import { chatRouter } from './routes/chat';
import { dishPhotoRouter } from './routes/dishPhoto';
import { feedbackRouter } from './routes/feedback';
import { nutritionRouter } from './routes/nutrition';
import { pantryRouter } from './routes/pantry';
import { profileRouter } from './routes/profile';
import { recipeRatingsRouter } from './routes/recipeRatings';
import { recipesRouter } from './routes/recipes';
import { savedRecipesRouter } from './routes/savedRecipes';
import { scanRouter } from './routes/scan';
import { scansRouter } from './routes/scans';
import { verifyEmailRouter } from './routes/verifyEmail';

const app = express();

// Behind a hosting platform (Render, Railway, Fly) every request arrives from
// the proxy, so req.ip is the proxy's address unless Express is told to read
// X-Forwarded-For. Without this the rate limiter below sees one client and
// throttles everybody together the moment one person is busy.
//
// It is opt-in rather than always-on because trusting that header when nothing
// strips it lets a caller spoof an address and walk straight past the limiter.
// Set TRUST_PROXY=1 when, and only when, something in front is rewriting it.
if (process.env.TRUST_PROXY) {
  app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1);
}

// Response headers that cost nothing and close whole categories of attack:
// nosniff, Referrer-Policy, HSTS, and X-Frame-Options / frame-ancestors, which
// is what stops the admin console being framed by a hostile page and clicked
// through by someone who thinks they are pressing something else.
app.use(
  helmet({
    // This process serves JSON and nothing else — no HTML, no scripts — so a
    // Content-Security-Policy here would only constrain documents that do not
    // exist. The console's own CSP belongs on whatever serves its bundle.
    contentSecurityPolicy: false,
    // Default is same-origin, which would block the admin console reading these
    // responses from its own origin. CORS below is what decides who may call.
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

// Body size, per route rather than once for everything.
//
// A resized shelf photo arrives as roughly 5MB of base64 and a profile picture
// as up to 1MB, so those two need a raised ceiling — MAX_BASE64_LENGTH in each
// of those files is the real cap, this is only the outer guard. Everything else
// in this API is short JSON.
//
// The reason it is not one global 10mb: body parsing happens before
// authentication, so a single global ceiling lets an unauthenticated caller
// make this process read and buffer ten megabytes at any URL, over and over,
// before requireAuth ever gets to say no. These two lines have to come first —
// express.json marks a request as parsed, so whichever parser sees it first is
// the one whose limit applies.
app.use('/api/scan', express.json({ limit: '10mb' }));
app.use('/api/profile', express.json({ limit: '2mb' }));
// Voice input: up to 8 MB of audio (chat.ts MAX_AUDIO_BYTES), which base64
// grows by a third.
app.use('/api/chat/transcribe', express.json({ limit: '12mb' }));
app.use(express.json({ limit: '256kb' }));

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
app.use('/api/nutrition', requireAuth, nutritionRouter);
app.use('/api/dish-photo', requireAuth, dishPhotoRouter);

// The collections that moved off Firestore. Each one connects to Mongo lazily
// on its first request, so a developer running only the scanner still needs no
// cluster and no connection string.
app.use('/api/pantry', requireAuth, pantryRouter);
app.use('/api/saved-recipes', requireAuth, savedRecipesRouter);
app.use('/api/recipe-ratings', requireAuth, recipeRatingsRouter);
app.use('/api/scans', requireAuth, scansRouter);
app.use('/api/feedback', requireAuth, feedbackRouter);
app.use('/api/chat', requireAuth, chatRouter);
app.use('/api/verify-email', requireAuth, verifyEmailRouter);

// The admin console. Two middlewares rather than one: requireAuth establishes
// who is asking, requireAdmin decides whether they may read across accounts.
// Every other router above is scoped to req.uid and needs no second check —
// these routes are the only ones in the system that deliberately are not, which
// is why the gate is mounted here and not left to the individual handlers.
//
// Rate limited as well, and only here. Firebase throttles failed *sign-ins*,
// but nothing throttled the API itself: one valid admin token could read every
// pantry in the system as fast as the network allowed. A person clicking around
// the console generates a handful of requests a minute, so this ceiling is
// invisible in normal use and immediately in the way of a script.
//
// Deliberately not applied to the app's own routes. Those are polled by every
// phone running Panzi, and a limit tuned for one admin at a desk would start
// dropping real users' requests.
const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: 'rate-limited',
    message: 'Too many requests. Wait a few minutes and try again.',
  },
});

// auditAdmin sits between the two gates, and the order is the point.
//
// After requireAuth, because an unauthenticated probe is noise — anyone can
// point a scanner at a URL, and recording those would bury the thing the log
// exists for.
//
// Before requireAdmin, because a request that gets past requireAuth and then
// fails requireAdmin is the opposite of noise: that is a real account, holding
// a real token, being told no at the admin door. It is the single most worth
// keeping line this log can hold, and while the audit ran after requireAdmin it
// was the one thing that left no trace at all.
app.use('/api/admin', adminLimiter, requireAuth, auditAdmin, requireAdmin, adminRouter);

// Anything thrown by a route, by the body parser, or by the CORS check lands
// here rather than crashing the process or hanging the request.
//
// Three of these are not really errors on our side, and answering all of them
// with 500 tells the caller to retry something that will never work. A body
// over the limit is a 413 and says so; a rejected origin is a 403; malformed
// JSON is a 400.
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err?.type === 'entity.too.large') {
    res.status(413).json({ error: 'too-large', message: 'That request body is too large.' });
    return;
  }
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'bad-request', message: 'That was not valid JSON.' });
    return;
  }
  if (typeof err?.message === 'string' && err.message.startsWith('Origin not allowed')) {
    // Logged, not returned: echoing the origin back confirms to whoever sent it
    // exactly what the check saw.
    console.warn('CORS rejected', { message: err.message });
    res.status(403).json({ error: 'forbidden', message: 'This origin is not allowed.' });
    return;
  }
  console.error('Unhandled error', { message: err?.message });
  res.status(500).json({ error: 'internal', message: 'Something went wrong.' });
});

const port = Number(process.env.PORT ?? 8080);

// Bound to 0.0.0.0 rather than localhost so a phone on the same wifi can reach
// it during development. On localhost the server is invisible to every device
// except this computer.
app.listen(port, '0.0.0.0', () => {
  console.log(`Panzi API listening on http://0.0.0.0:${port}`);
});
