// server/src/routes/pantry.ts
//
// What the shelves are made of. Every route here is scoped to req.uid — the id
// this server took out of a verified token — and never to a user id sent in the
// body. That single rule is what stops any signed-in account reading or
// deleting any other account's food.
//
// Note how the writes are shaped: `updateOne({ _id, userId })` rather than
// `findById` then a permission check. A filter that includes the owner cannot
// be forgotten halfway down a function, and a mismatched owner comes back as
// "nothing matched" instead of a document somebody else's client can see.

import { Router } from 'express';
import { PantryItem } from '../models';
import { badRequest, isValidId, withDb } from './helpers';

export const pantryRouter = Router();

// The provenance and picture fields an update is allowed to touch, alongside
// the plain ones. Anything not on this list is dropped rather than written —
// `userId` most of all, which would otherwise let a crafted patch hand an item
// to a different account.
const UPDATABLE = [
  'name',
  'quantity',
  'category',
  'location',
  'expiryDate',
  'photoUri',
  'scanPhoto',
  'box',
  'dateSource',
  'ripeness',
  'ripenessSource',
  'nutrition',
  'packageStatus',
  'openedAt',
  'expiryUnknown',
  'basis',
  'estimatedUseBy',
  'estimateInputs',
] as const;

function pickUpdatable(fields: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const key of UPDATABLE) {
    // `key in fields` rather than a truthiness check: clearing a date means
    // writing null, and a check that skipped falsy values would make a field
    // impossible to unset once it had been set.
    if (key in fields) patch[key] = fields[key] ?? null;
  }
  return patch;
}

/** Mongo's own `_id` becomes `id`, which is what the app has always called it. */
function toItem(doc: any) {
  return {
    id: doc._id,
    name: doc.name,
    quantity: doc.quantity,
    category: doc.category,
    location: doc.location ?? null,
    expiryDate: doc.expiryDate ?? null,
    // The app wants milliseconds. Sending the Date would arrive as an ISO
    // string after JSON, and every caller would have to parse it again.
    addedAt: doc.createdAt ? new Date(doc.createdAt).getTime() : null,
    photoUri: doc.photoUri ?? null,
    scanPhoto: doc.scanPhoto ?? null,
    box: doc.box ?? null,
    dateSource: doc.dateSource ?? null,
    ripeness: doc.ripeness ?? null,
    ripenessSource: doc.ripenessSource ?? null,
    nutrition: doc.nutrition ?? null,
    packageStatus: doc.packageStatus ?? null,
    openedAt: doc.openedAt ?? null,
    expiryUnknown: doc.expiryUnknown ?? false,
    basis: doc.basis ?? null,
    estimatedUseBy: doc.estimatedUseBy ?? null,
    estimateInputs: doc.estimateInputs ?? null,
  };
}

// Soonest-first on one shared timeline — a real date and a Panzi estimate
// sort together (Phase 2 §6: "never sort estimated and real dates into
// separate sections, the user thinks in one timeline"), matching the same
// effectiveDate the client reads through (services/pantry.ts). Undated items
// (basis:'estimated' with no cached estimatedUseBy yet, or nothing at all)
// sort last — Mongo sorts null before any string ascending, which would put
// "no date" at the top, exactly backwards.
pantryRouter.get(
  '/',
  withDb(async (req, res) => {
    const items = await PantryItem.find({ userId: req.uid }).lean();
    const rows = items.map(toItem).sort((a, b) => {
      const aDate = a.expiryDate ?? a.estimatedUseBy;
      const bDate = b.expiryDate ?? b.estimatedUseBy;
      if (!aDate && !bDate) return 0;
      if (!aDate) return 1;
      if (!bDate) return -1;
      return aDate.localeCompare(bDate);
    });
    res.json({ items: rows });
  })
);

/**
 * Writes a whole approved scan at once, and hands back the ids.
 *
 * One bulk write rather than a loop of inserts so a scan can't half-land — a
 * partial batch would leave the pantry in a state the user never approved, with
 * no obvious way to tell which rows made it. The returned ids are what the
 * "N items added · Undo" toast deletes if the user takes it back.
 *
 * Ids arrive from the phone, generated before the request, so the interface can
 * wire up Undo without waiting for this to come back.
 */
pantryRouter.post(
  '/add',
  withDb(async (req, res) => {
    const { items } = (req.body ?? {}) as { items?: any[] };
    if (!Array.isArray(items) || items.length === 0) {
      return badRequest(res, 'No items were sent.');
    }
    if (!items.every((item) => isValidId(item?.id) && typeof item?.name === 'string')) {
      return badRequest(res, 'An item was missing an id or a name.');
    }

    const docs = items.map((item) => ({
      _id: item.id,
      userId: req.uid,
      name: item.name,
      quantity: item.quantity ?? '',
      category: item.category ?? '',
      location: item.location ?? null,
      expiryDate: item.expiryDate ?? null,
      photoUri: item.photoUri ?? null,
      scanPhoto: item.scanPhoto ?? null,
      box: item.box ?? null,
      dateSource: item.dateSource ?? null,
      ripeness: item.ripeness ?? null,
      ripenessSource: item.ripenessSource ?? null,
      nutrition: item.nutrition ?? null,
      packageStatus: item.packageStatus ?? null,
      openedAt: item.openedAt ?? null,
      expiryUnknown: item.expiryUnknown ?? false,
      basis: item.basis ?? null,
      estimatedUseBy: item.estimatedUseBy ?? null,
      estimateInputs: item.estimateInputs ?? null,
    }));

    await PantryItem.insertMany(docs, { ordered: true });
    res.json({ ids: docs.map((d) => d._id) });
  })
);

pantryRouter.post(
  '/update',
  withDb(async (req, res) => {
    const { id, fields } = (req.body ?? {}) as { id?: string; fields?: Record<string, unknown> };
    if (!isValidId(id)) return badRequest(res, 'No item id was sent.');
    if (!fields || typeof fields !== 'object') return badRequest(res, 'No fields were sent.');

    const patch = pickUpdatable(fields);
    if (Object.keys(patch).length === 0) return badRequest(res, 'Nothing to change.');

    await PantryItem.updateOne({ _id: id, userId: req.uid }, { $set: patch });
    res.json({ ok: true });
  })
);

// Takes a list rather than a single id because Undo deletes a whole scan's
// worth at once, and one round trip is the difference between the toast
// disappearing cleanly and the rows vanishing one by one.
pantryRouter.post(
  '/delete',
  withDb(async (req, res) => {
    const { ids } = (req.body ?? {}) as { ids?: string[] };
    if (!Array.isArray(ids) || ids.length === 0) return badRequest(res, 'No ids were sent.');
    if (!ids.every(isValidId)) return badRequest(res, 'An id was not usable.');

    await PantryItem.deleteMany({ _id: { $in: ids }, userId: req.uid });
    res.json({ ok: true });
  })
);

// The whole shelf at once, for "Your data" > Clear pantry. Takes no body —
// unlike /delete, there is no list of ids to check, because the point of this
// route is that the caller does not have to know them.
pantryRouter.post(
  '/clear',
  withDb(async (req, res) => {
    const result = await PantryItem.deleteMany({ userId: req.uid });
    res.json({ ok: true, deleted: result.deletedCount ?? 0 });
  })
);

/**
 * Different fields onto different items, in one write.
 *
 * The backfill that gives already-saved items the pictures their scans have
 * been holding is the only caller, and it is exactly the shape a loop of
 * single updates handles worst: a patch per item, each one different, all of
 * them landing together or the pantry shows half a change. bulkWrite sends them
 * as one command, and each filter still carries the owner.
 */
pantryRouter.post(
  '/patch-many',
  withDb(async (req, res) => {
    const { patches } = (req.body ?? {}) as { patches?: { id?: string; fields?: any }[] };
    if (!Array.isArray(patches) || patches.length === 0) {
      res.json({ ok: true, updated: 0 });
      return;
    }
    if (!patches.every((p) => isValidId(p?.id) && p?.fields && typeof p.fields === 'object')) {
      return badRequest(res, 'A patch was missing an id or fields.');
    }

    const operations = patches
      .map((p) => ({ id: p.id as string, patch: pickUpdatable(p.fields) }))
      .filter(({ patch }) => Object.keys(patch).length > 0)
      .map(({ id, patch }) => ({
        updateOne: { filter: { _id: id, userId: req.uid }, update: { $set: patch } },
      }));

    if (operations.length === 0) {
      res.json({ ok: true, updated: 0 });
      return;
    }

    const result = await PantryItem.bulkWrite(operations);
    res.json({ ok: true, updated: result.modifiedCount ?? 0 });
  })
);

pantryRouter.post(
  '/move',
  withDb(async (req, res) => {
    const { id, location } = (req.body ?? {}) as { id?: string; location?: string };
    if (!isValidId(id)) return badRequest(res, 'No item id was sent.');
    if (typeof location !== 'string') return badRequest(res, 'No location was sent.');

    await PantryItem.updateOne({ _id: id, userId: req.uid }, { $set: { location } });
    res.json({ ok: true });
  })
);

/**
 * Points a whole scan's worth of items at the uploaded capture.
 *
 * One write, because every row of a scan crops out of the same photo and they
 * should all start showing the shared copy on the same frame — a list that
 * swapped over row by row as individual updates landed would flicker.
 */
pantryRouter.post(
  '/scan-photo',
  withDb(async (req, res) => {
    const { ids, scanPhoto } = (req.body ?? {}) as { ids?: string[]; scanPhoto?: any };
    if (!Array.isArray(ids) || ids.length === 0) {
      res.json({ ok: true });
      return;
    }
    if (!ids.every(isValidId)) return badRequest(res, 'An id was not usable.');
    if (!scanPhoto || typeof scanPhoto.uri !== 'string') {
      return badRequest(res, 'No photo was sent.');
    }

    await PantryItem.updateMany({ _id: { $in: ids }, userId: req.uid }, { $set: { scanPhoto } });
    res.json({ ok: true });
  })
);
