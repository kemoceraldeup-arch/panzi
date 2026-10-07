// server/src/routes/verifyEmail.ts
//
// Sign-up email verification, by code rather than Firebase's own link.
//
// A link opens in whatever mail client the phone has, which then has to bounce
// back into this app — on a device with no matching universal link/deep-link
// setup that is a dead end, and even when it works it leaves the app for a
// screen it does not control. A code stays inside the sign-up flow the whole
// time: the phone that asked for it is the phone that types it back in.
//
// Both routes sit behind requireAuth. That is safe (not circular) because the
// client already has a Firebase ID token by the time either is called —
// createUserWithEmailAndPassword signs the new account in immediately, before
// the app ever shows the code-entry screen — and it is what stops one
// account requesting a code and a different one redeeming it.

import { Router } from 'express';
import admin from '../firebase';
import { EmailVerification } from '../models';
import { sendVerificationEmail } from '../mail';
import { badRequest, withDb } from './helpers';

export const verifyEmailRouter = Router();

const CODE_LENGTH = 6;
const CODE_TTL_MS = 10 * 60 * 1000;
// One resend per this long — the send button is otherwise as fast as a
// double-tap, and each tap is a real email plus a write, not a free retry.
const RESEND_COOLDOWN_MS = 30 * 1000;
// 5 wrong tries locks the account out from requesting or redeeming a code
// for this long — long enough to make brute-forcing a 6-digit code
// pointless, short enough that a real user who fat-fingered it twice isn't
// locked out of their own signup for the day.
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 5 * 60 * 1000;

type Purpose = 'signup' | 'login';

/**
 * Which code a request is about. 'signup' proves a new account's address
 * once; 'login' is asked for on every email sign-in, verified account or not.
 * They are separate records so a login code can never be redeemed as a
 * sign-up one or the other way round, and a pending sign-up code isn't
 * clobbered by a login.
 */
function purposeOf(body: unknown): Purpose {
  return (body as { purpose?: unknown } | null)?.purpose === 'login' ? 'login' : 'signup';
}

function recordId(uid: string, purpose: Purpose): string {
  return purpose === 'login' ? `login:${uid}` : uid;
}

function generateCode(): string {
  // Zero-padded so every code is exactly CODE_LENGTH digits — Math.random
  // alone would occasionally hand back "042913" as 42913.
  const max = 10 ** CODE_LENGTH;
  return String(Math.floor(Math.random() * max)).padStart(CODE_LENGTH, '0');
}

/** The TTL index's own field — always the later of the two real deadlines a
 *  row can be waiting on. See the schema's own comment for why this can't
 *  just be `expiresAt`. */
function reapAtFor(codeExpiresAt: Date, lockedUntil: Date | null): Date {
  if (!lockedUntil) return codeExpiresAt;
  return lockedUntil > codeExpiresAt ? lockedUntil : codeExpiresAt;
}

/**
 * Sends (or resends) the code for the signed-in account's own email — never
 * an email address from the body, so this can only ever mail the inbox the
 * Firebase account itself is registered to.
 */
verifyEmailRouter.post(
  '/send',
  withDb(async (req, res) => {
    const uid = req.uid!;
    const purpose = purposeOf(req.body);
    const id = recordId(uid, purpose);
    const user = await admin.auth().getUser(uid);
    const email = user.email;
    if (!email) {
      badRequest(res, 'This account has no email to verify.');
      return;
    }
    // Only a sign-up code has nothing left to do for a verified account — a
    // login code is asked for on every sign-in regardless.
    if (purpose === 'signup' && user.emailVerified) {
      res.json({ ok: true, alreadyVerified: true });
      return;
    }

    const existing = await EmailVerification.findById(id);

    // A live lockout blocks a fresh code too — otherwise "request a new
    // code" would be exactly how someone routes around the attempt limit
    // that was just enforced.
    const lockedUntil: Date | null = existing?.get('lockedUntil') ?? null;
    if (lockedUntil && lockedUntil.getTime() > Date.now()) {
      res.status(423).json({
        error: 'locked',
        message: 'Too many wrong tries — verification is paused for a bit.',
        lockedUntilMs: lockedUntil.getTime(),
      });
      return;
    }

    if (existing && Date.now() - existing.get('updatedAt').getTime() < RESEND_COOLDOWN_MS) {
      const waitMs = RESEND_COOLDOWN_MS - (Date.now() - existing.get('updatedAt').getTime());
      res.status(429).json({
        error: 'too-soon',
        message: `Wait ${Math.ceil(waitMs / 1000)}s before requesting another code.`,
      });
      return;
    }

    const code = generateCode();
    const expiresAt = new Date(Date.now() + CODE_TTL_MS);
    await EmailVerification.findByIdAndUpdate(
      id,
      {
        _id: id,
        email,
        code,
        attempts: 0,
        expiresAt,
        lockedUntil: null,
        reapAt: reapAtFor(expiresAt, null),
      },
      { upsert: true }
    );

    try {
      await sendVerificationEmail(email, code, purpose);
    } catch (err: any) {
      // The code never left, so it must not stand: dropping the record
      // undoes the resend cooldown it would otherwise start, and the user can
      // try again straight away instead of waiting on an email that is never
      // coming.
      console.error('Verification email failed', { uid, purpose, message: err?.message });
      await EmailVerification.findByIdAndDelete(id);
      res.status(502).json({
        error: 'send-failed',
        message: `We couldn't send the code to ${email}. Check your connection and try again.`,
      });
      return;
    }
    res.json({ ok: true, email });
  })
);

/** Checks a typed code against the one on file and, on a match, marks the
 *  Firebase account verified — the one privileged write this route makes. */
verifyEmailRouter.post(
  '/confirm',
  withDb(async (req, res) => {
    const uid = req.uid!;
    const purpose = purposeOf(req.body);
    const { code } = (req.body ?? {}) as { code?: string };

    if (typeof code !== 'string' || !/^\d{6}$/.test(code)) {
      badRequest(res, 'Enter the 6-digit code.');
      return;
    }

    const record = await EmailVerification.findById(recordId(uid, purpose));
    if (!record) {
      res.status(410).json({ error: 'expired', message: 'That code has expired — send a new one.' });
      return;
    }

    const lockedUntil: Date | null = record.get('lockedUntil');
    if (lockedUntil) {
      if (lockedUntil.getTime() > Date.now()) {
        res.status(423).json({
          error: 'locked',
          message: 'Too many wrong tries — verification is paused for a bit.',
          lockedUntilMs: lockedUntil.getTime(),
        });
        return;
      }
      // The lockout itself has elapsed, but nobody has asked for a fresh
      // code since — this attempt is against a code the user could not
      // have received a working retry for during the lockout, so it is
      // treated the same as an expired one rather than silently unlocked
      // back into the same 5 attempts.
      await record.deleteOne();
      res.status(410).json({ error: 'expired', message: 'That code has expired — send a new one.' });
      return;
    }

    if (record.get('expiresAt').getTime() < Date.now()) {
      await record.deleteOne();
      res.status(410).json({ error: 'expired', message: 'That code has expired — send a new one.' });
      return;
    }

    if (record.get('code') !== code) {
      const attempts = record.get('attempts') + 1;
      const attemptsLeft = MAX_ATTEMPTS - attempts;

      if (attemptsLeft <= 0) {
        const until = new Date(Date.now() + LOCKOUT_MS);
        record.set('attempts', attempts);
        record.set('lockedUntil', until);
        record.set('reapAt', reapAtFor(record.get('expiresAt'), until));
        await record.save();
        res.status(423).json({
          error: 'locked',
          message: 'Too many wrong tries — verification is paused for a bit.',
          lockedUntilMs: until.getTime(),
        });
        return;
      }

      record.set('attempts', attempts);
      await record.save();
      res.status(400).json({
        error: 'wrong-code',
        message: `That code isn't right — ${attemptsLeft} ${attemptsLeft === 1 ? 'try' : 'tries'} left.`,
        attemptsLeft,
      });
      return;
    }

    // Either code proves the inbox belongs to this account.
    await admin.auth().updateUser(uid, { emailVerified: true });
    await record.deleteOne();
    res.json({ ok: true });
  })
);
