import { Router } from 'express';
import { AdminReview, Feedback, Scan } from '../models';
import { badRequest, isValidId, withDb } from './helpers';

export const adminReviewRouter = Router();
export const REVIEW_PAGE_SIZE = 20;
export const REVIEW_FILTERS = ['open', 'new', 'in_progress', 'resolved', 'all'] as const;
export type ReviewFilter = typeof REVIEW_FILTERS[number];

export function reviewState(row: any) {
  return {
    status: row?.status ?? 'new', note: row?.note ?? '', revision: row?.revision ?? 0,
    updatedBy: row?.updatedBy ?? null,
    updatedAt: row?.updatedAt ? new Date(row.updatedAt).toISOString() : null,
  };
}

/** Filter before pagination so handled records never hide older pending work. */
export async function reviewPage(kind: 'scans' | 'feedback', status: ReviewFilter, page: number, window?: { $lte: Date; $gte?: Date }) {
  const source = kind === 'scans' ? Scan : Feedback;
  const result = await source.aggregate([
    ...(window ? [{ $match: { createdAt: window } }] : []),
    { $addFields: { reviewKey: { $concat: [kind + ':', { $toString: '$_id' }] } } },
    { $lookup: { from: 'admin_reviews', localField: 'reviewKey', foreignField: '_id', as: 'reviews' } },
    { $addFields: { review: { $arrayElemAt: ['$reviews', 0] } } },
    { $addFields: { reviewStatus: { $ifNull: ['$review.status', 'new'] } } },
    // Keep previously reviewed scans available even after a user fixes the scan.
    ...(kind === 'scans' ? [{ $match: { $or: [{ unresolvedCount: { $gt: 0 } }, { review: { $exists: true } }] } }] : []),
    ...(status === 'all' ? [] : [{ $match: { reviewStatus: status === 'open' ? { $in: ['new', 'in_progress'] } : status } }]),
    { $sort: { createdAt: -1, _id: -1 } },
    { $facet: { total: [{ $count: 'count' }], rows: [{ $skip: (page - 1) * REVIEW_PAGE_SIZE }, { $limit: REVIEW_PAGE_SIZE }] } },
  ]);
  return { rows: result[0]?.rows ?? [], total: result[0]?.total[0]?.count ?? 0 };
}

adminReviewRouter.patch('/review/:kind/:id', withDb(async (req, res) => {
  const { kind, id } = req.params;
  const { status, note, revision } = req.body ?? {};
  if ((kind !== 'scans' && kind !== 'feedback') || !isValidId(id)) return badRequest(res, 'Choose a valid review item.');
  if (!['new', 'in_progress', 'resolved'].includes(status) || typeof note !== 'string' || note.length > 2000 || !Number.isSafeInteger(revision) || revision < 0) {
    return badRequest(res, 'Choose a status and keep internal notes within 2,000 characters.');
  }
  // Feedback uses Mongo ObjectIds; scans use client-generated string IDs.
  if (kind === 'feedback' && !/^[a-f\d]{24}$/i.test(id)) return badRequest(res, 'Choose a valid feedback item.');
  const source = kind === 'scans' ? Scan : Feedback;
  const target: any = await source.findById(id).select({ userId: 1, unresolvedCount: 1 }).lean();
  if (!target) { res.status(404).json({ error: 'not-found', message: 'This review item no longer exists.' }); return; }
  const key = `${kind}:${kind === 'feedback' ? id.toLowerCase() : id}`;
  if (kind === 'scans' && !(target.unresolvedCount > 0) && !(await AdminReview.exists({ _id: key }))) {
    res.status(404).json({ error: 'not-found', message: 'This scan no longer needs review.' }); return;
  }
  res.locals.auditTarget = String(target.userId);
  try {
    const saved = await AdminReview.findOneAndUpdate(
      { _id: key, revision },
      { $set: { kind, targetId: id, status, note: note.trim(), updatedBy: req.uid }, $inc: { revision: 1 } },
      { upsert: revision === 0, returnDocument: 'after', runValidators: true, setDefaultsOnInsert: false },
    ).lean();
    if (saved) { res.json({ review: reviewState(saved) }); return; }
  } catch (error: any) {
    // A concurrent first save collides with the unique _id instead of losing a note.
    if (error?.code !== 11000) throw error;
  }
  res.status(409).json({ error: 'review-conflict', message: 'Another administrator updated this item. Load their changes before saving again.' });
}));
