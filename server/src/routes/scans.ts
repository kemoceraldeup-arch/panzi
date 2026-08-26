// server/src/routes/scans.ts
//
// Scan history: one document per scan the user actually added.
//
// This collection exists to keep a promise the review page makes out loud —
// "You can fix the two later from history". Without somewhere to put an
// unfinished scan, that line is a lie, and the whole reason the user is allowed
// to add items before every field is settled disappears with it.
//
// A record is written when a batch lands and updated in place when the user
// reopens it to finish the missing dates. It holds the candidates as they stood
// at save time, not the pantry rows they became: the point of reopening a scan
// is to see the photo and the reads together again.

import { Router } from 'express';
import { Scan } from '../models';
import { badRequest, isValidId, withDb } from './helpers';

export const scansRouter = Router();

// History is a place to finish recent work, not an archive. Past this many the
// oldest scans are simply not fetched — their pantry items are unaffected, and
// nobody scrolls three weeks back to correct a banana.
const HISTORY_LIMIT = 30;

function toRecord(doc: any) {
  return {
    id: doc._id,
    sceneLabel: doc.sceneLabel || 'Scan',
    photoUri: doc.photoUri ?? null,
    photoWidth: doc.photoWidth ?? null,
    photoHeight: doc.photoHeight ?? null,
    createdAt: doc.createdAt ? new Date(doc.createdAt).getTime() : null,
    original: Array.isArray(doc.original) ? doc.original : [],
    candidates: Array.isArray(doc.candidates) ? doc.candidates : [],
    addedItemIds: Array.isArray(doc.addedItemIds) ? doc.addedItemIds : [],
    unresolvedCount: typeof doc.unresolvedCount === 'number' ? doc.unresolvedCount : 0,
    accuracy: doc.accuracy ?? null,
  };
}

scansRouter.get(
  '/',
  withDb(async (req, res) => {
    const rows = await Scan.find({ userId: req.uid })
      .sort({ createdAt: -1 })
      .limit(HISTORY_LIMIT)
      .lean();
    res.json({ scans: rows.map(toRecord) });
  })
);

/**
 * Records a scan that has just landed in the pantry.
 *
 * The id is generated on the phone before the write so the modal can hold onto
 * it and update the same document when the user comes back to finish the
 * unresolved rows — and so a failed write leaves a known id rather than an
 * orphan.
 *
 * `unresolvedCount` and `accuracy` are computed on the phone and stored as
 * sent. Both are diffs of the model's original read against the user's
 * corrections, and the rules for that live in the app's services/accuracy.ts;
 * duplicating them here would mean two implementations that can disagree about
 * how accurate the scanner is.
 */
scansRouter.post(
  '/save',
  withDb(async (req, res) => {
    const body = (req.body ?? {}) as any;
    if (!isValidId(body.id)) return badRequest(res, 'No scan id was sent.');

    await Scan.updateOne(
      { _id: body.id, userId: req.uid },
      {
        $set: {
          userId: req.uid,
          sceneLabel: typeof body.sceneLabel === 'string' ? body.sceneLabel : 'Scan',
          photoUri: body.photoUri ?? null,
          photoWidth: body.photoWidth ?? null,
          photoHeight: body.photoHeight ?? null,
          original: Array.isArray(body.original) ? body.original : [],
          candidates: Array.isArray(body.candidates) ? body.candidates : [],
          addedItemIds: Array.isArray(body.addedItemIds) ? body.addedItemIds : [],
          unresolvedCount: typeof body.unresolvedCount === 'number' ? body.unresolvedCount : 0,
          accuracy: body.accuracy ?? null,
        },
      },
      { upsert: true }
    );
    res.json({ ok: true });
  })
);

/**
 * Writes back the corrections made after the scan was added.
 *
 * Deliberately does not touch the timestamps: finishing off Tuesday's freezer
 * scan on Friday shouldn't shuffle it to the top of the list as though it were
 * new work. The user is looking for it where they left it. That is what
 * `timestamps: false` below is for — without it Mongoose would refresh
 * `updatedAt`, which is harmless, but `createdAt` is what the list sorts on and
 * an upsert here could recreate it.
 */
scansRouter.post(
  '/update',
  withDb(async (req, res) => {
    const { id, candidates, unresolvedCount, accuracy } = (req.body ?? {}) as any;
    if (!isValidId(id)) return badRequest(res, 'No scan id was sent.');
    if (!Array.isArray(candidates)) return badRequest(res, 'No candidates were sent.');

    await Scan.updateOne(
      { _id: id, userId: req.uid },
      {
        $set: {
          candidates,
          unresolvedCount: typeof unresolvedCount === 'number' ? unresolvedCount : 0,
          accuracy: accuracy ?? null,
        },
      },
      { timestamps: false }
    );
    res.json({ ok: true });
  })
);

/** Repoints a scan record at the uploaded copy of its capture, so reopening it
 *  from another device shows the photo rather than a placeholder. */
scansRouter.post(
  '/photo',
  withDb(async (req, res) => {
    const { id, photo } = (req.body ?? {}) as { id?: string; photo?: any };
    if (!isValidId(id)) return badRequest(res, 'No scan id was sent.');
    if (!photo || typeof photo.uri !== 'string') return badRequest(res, 'No photo was sent.');

    await Scan.updateOne(
      { _id: id, userId: req.uid },
      {
        $set: {
          photoUri: photo.uri,
          photoWidth: photo.width ?? null,
          photoHeight: photo.height ?? null,
        },
      },
      { timestamps: false }
    );
    res.json({ ok: true });
  })
);
