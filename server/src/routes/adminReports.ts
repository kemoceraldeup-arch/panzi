// server/src/routes/adminReports.ts
//
// The two admin screens that read the collections added for them: the event
// stream and the waste analytics. Split from admin.ts because that file is the
// console's CRUD surface and this is reporting over data nothing else touches.
//
// Mounted inside adminRouter, so it inherits the same gates: requireAuth,
// requireAdmin, the rate limit and the audit record.

import { Router } from 'express';
import { browseOptions, dateWindow, literalSearch, PAGE_SIZE, pageMetadata } from './adminBrowse';
import { adminReviewRouter, reviewPage, reviewState, REVIEW_FILTERS, REVIEW_PAGE_SIZE, type ReviewFilter } from './adminReview';
import {
  ApiUsage,
  ChatConversation,
  ChatMessage,
  ItemDisposition,
  PantryItem,
  Scan,
  User,
} from '../models';
import { costOf, formatCost } from '../usage';
import { badRequest, isValidId, relativeTime, withDb } from './helpers';

export const adminReportsRouter = Router();
adminReportsRouter.use(adminReviewRouter);

const DAY_MS = 24 * 60 * 60 * 1000;

/** Windows, matching the console's segmented control. */
const RANGES = {
  '7d': { days: 7, buckets: 7 },
  '30d': { days: 30, buckets: 5 },
  '90d': { days: 90, buckets: 3 },
};

type RangeKey = keyof typeof RANGES;

function rangeFrom(value: unknown): (typeof RANGES)[RangeKey] {
  return RANGES[(value === '7d' || value === '30d' || value === '90d' ? value : '30d') as RangeKey];
}

// ------------------------------------------------------------------- /logs

/**
 * The event stream, from the three collections that actually record one.
 *
 * The design drew this screen against a logging system that does not exist —
 * server events go to stdout and are gone the moment the process restarts. What
 * does survive is every model call (api_usage), every admin read
 * (admin_audit), and every account erasure (deletion_audit_log): the money
 * spent, the access made, and the accounts asked to be forgotten. All three
 * are worth watching, and none is invented.
 *
 * The deletion rows are here rather than on a compliance screen of their own
 * because they are the one record that outlives everything else about a
 * person — the whole point of that collection is to survive the erasure it
 * describes — and a row nobody ever scrolls past is a row nobody checks. It
 * holds no personal data beyond the uid: not a name, not an email, because
 * keeping those would undo the deletion it is evidence of.
 *
 * Mongo merges and filters all three collections before paging. A fixed cutoff
 * and stable sort prevent incoming records from shifting already-open pages.
 */
adminReportsRouter.get(
  '/logs',
  withDb(async (req, res) => {
    const options = browseOptions(req.query);
    const level = req.query.level ?? 'All';
    if (!options || !['All', 'INFO', 'WARN', 'ERROR', 'DEBUG'].includes(String(level))) return badRequest(res, 'Choose valid log filters.');
    const window = dateWindow(options);
    const result = await ApiUsage.aggregate([
      { $match: { createdAt: window } },
      { $addFields: {
        source: 'usage',
        level: { $cond: [{ $eq: ['$ok', false] }, 'ERROR', { $cond: [{ $gt: ['$durationMs', 10000] }, 'WARN', 'INFO'] }] },
        searchText: { $concat: ['api.', { $ifNull: ['$route', ''] }, ' ', { $ifNull: ['$model', ''] }, ' ', { $ifNull: ['$userId', ''] }] },
      } },
      { $unionWith: { coll: 'admin_audit', pipeline: [
        { $match: { createdAt: window } },
        { $addFields: {
          source: 'audit',
          level: { $cond: [{ $gte: ['$status', 500] }, 'ERROR', { $cond: [{ $gte: ['$status', 400] }, 'WARN', 'INFO'] }] },
          searchText: { $concat: [
            { $cond: [{ $in: ['$status', [401, 403]] }, 'admin.denied', { $cond: [{ $eq: ['$method', 'GET'] }, 'admin.read', 'admin.write'] }] },
            ' ', { $ifNull: ['$path', ''] }, ' ', { $ifNull: ['$actorId', ''] }, ' ', { $ifNull: ['$targetUserId', ''] },
          ] },
        } },
      ] } },
      { $unionWith: { coll: 'deletion_audit_log', pipeline: [
        { $match: { createdAt: window } },
        { $addFields: {
          source: 'deletion',
          // Never an error: a person exercising erasure is the system working.
          level: 'INFO',
          searchText: { $concat: ['account.deleted ', { $ifNull: ['$uid', ''] }, ' ', { $ifNull: ['$requestedVia', ''] }] },
        } },
      ] } },
      ...(level === 'All' ? [] : [{ $match: { level } }]),
      ...(options.q ? [{ $match: { searchText: { $regex: literalSearch(options.q), $options: 'i' } } }] : []),
      { $sort: { createdAt: -1, source: 1, _id: -1 } },
      { $facet: { total: [{ $count: 'count' }], rows: [{ $skip: (options.page - 1) * PAGE_SIZE }, { $limit: PAGE_SIZE }] } },
    ]);
    const pageRows: any[] = result[0]?.rows ?? [];
    const usage = pageRows.filter(row => row.source === 'usage');
    const audit = pageRows.filter(row => row.source === 'audit');
    const deletions = pageRows.filter(row => row.source === 'deletion');

    const events: { id: string; at: Date; level: string; event: string; detail: string }[] = [];

    for (const row of usage as any[]) {
      const tokens = {
        inputTokens: row.inputTokens ?? 0,
        cacheReadTokens: row.cacheReadTokens ?? 0,
        cacheWriteTokens: row.cacheWriteTokens ?? 0,
        outputTokens: row.outputTokens ?? 0,
      };
      const total =
        tokens.inputTokens +
        tokens.cacheReadTokens +
        tokens.cacheWriteTokens +
        tokens.outputTokens;

      events.push({
        id: `${row.source}:${row._id}`,
        at: row.createdAt,
        // A call slower than ten seconds is worth spotting without reading the
        // numbers. Everything else is routine.
        level: row.ok === false ? 'ERROR' : row.durationMs > 10000 ? 'WARN' : 'INFO',
        event: `api.${row.route}`,
        detail: [
          `${total.toLocaleString()} tokens`,
          formatCost(costOf(row.model, tokens)),
          `${(row.durationMs / 1000).toFixed(1)}s`,
          row.model,
          `user ${row.userId}`,
        ].join(' · '),
      });
    }

    for (const row of audit as any[]) {
      events.push({
        id: `${row.source}:${row._id}`,
        at: row.createdAt,
        level: row.status >= 500 ? 'ERROR' : row.status >= 400 ? 'WARN' : 'INFO',
        // Named for what the row actually is. Everything used to read
        // 'admin.read', which was wrong for a suspension and — now that denied
        // requests are recorded too — wrong in the one case worth spotting from
        // across the screen.
        event:
          row.status === 401 || row.status === 403
            ? 'admin.denied'
            : row.method === 'GET'
              ? 'admin.read'
              : 'admin.write',
        detail: [
          `${row.method} ${row.path}`,
          `actor ${row.actorId}`,
          String(row.status),
          `${row.durationMs}ms`,
          row.targetUserId ? `user ${String(row.targetUserId).slice(0, 8)}` : null,
        ]
          .filter(Boolean)
          .join(' · '),
      });
    }

    for (const row of deletions as any[]) {
      // `requestedAt` is when the person asked; `createdAt` is when the row was
      // written. They are normally the same second, and the asking is the fact
      // that matters, so it is the one shown.
      events.push({
        id: `${row.source}:${row._id}`,
        at: row.requestedAt ?? row.createdAt,
        level: 'INFO',
        event: 'account.deleted',
        detail: [
          `uid ${String(row.uid).slice(0, 8)}`,
          `via ${row.requestedVia ?? 'unknown'}`,
          // Said plainly, because it is the reason this row is allowed to
          // outlive the account it names.
          'data removed, record kept',
        ].join(' · '),
      });
    }

    const logs = events
      .filter((event) => event.at)
      .sort((a, b) => pageRows.findIndex(row => `${row.source}:${row._id}` === a.id) - pageRows.findIndex(row => `${row.source}:${row._id}` === b.id))
      .map((event) => ({
        id: event.id,
        time: new Date(event.at).toISOString(),
        level: event.level,
        event: event.event,
        detail: event.detail,
      }));

    res.json({
      logs,
      pagination: pageMetadata(options, result[0]?.total[0]?.count ?? 0),
      date: new Date().toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }),
      note:
        logs.length === 0
          ? 'No recorded events match these filters.'
          : null,
    });
  })
);

// -------------------------------------------------------------- /analytics

/**
 * Where food goes, from item_dispositions.
 *
 * The design's waste rate needed something that could tell "eaten" apart from
 * "thrown out". Removal is a hard delete, so nothing could — until the delete
 * route started recording what left and whether it was already past its date.
 *
 * Only explicit consumption/discard actions enter the waste rate. Expiry dates
 * cannot tell whether food was eaten or thrown away. Legacy removals and undone
 * additions remain unclassified; no historical outcomes are invented.
 */
adminReportsRouter.get(
  '/analytics',
  withDb(async (req, res) => {
    const range = rangeFrom(req.query.range);
    const from = new Date(Date.now() - range.days * DAY_MS);

    const [rows, accuracy, locations] = await Promise.all([
      ItemDisposition.find({ createdAt: { $gte: from } })
        .select({ name: 1, reason: 1, pastExpiry: 1, portion: 1, createdAt: 1 })
        .lean() as Promise<any[]>,
      scannerAccuracy(from),
      whereFoodLives(),
    ]);

    const saved = rows.filter(
      (row) => row.reason === 'consumed'
    );
    const wasted = rows.filter(
      (row) => row.reason === 'expired' || row.reason === 'discarded'
    );
    const withReason = saved.length + wasted.length;

    const rate = withReason === 0 ? 0 : Math.round((wasted.length / withReason) * 1000) / 10;

    // The same outcomes weighed by how much of each item was thrown out: a
    // discarded row carries its portion (0.5 for "some of it"), and the rest of
    // that item counts as eaten. Rows from before portions existed weigh 1.
    const share = (row: any) => (typeof row.portion === 'number' && row.portion > 0 && row.portion <= 1 ? row.portion : 1);
    const wastedAmount = wasted.reduce((sum, row) => sum + share(row), 0);
    const amountRate = withReason === 0 ? 0 : Math.round((wastedAmount / withReason) * 1000) / 10;

    // Buckets across the window, oldest first.
    const size = (range.days / range.buckets) * DAY_MS;
    const start = Date.now() - range.days * DAY_MS;
    const buckets = Array.from({ length: range.buckets }, (_, i) => ({
      from: start + i * size,
      saved: 0,
      wasted: 0,
    }));
    const bump = (row: any, field: 'saved' | 'wasted') => {
      const index = Math.min(
        buckets.length - 1,
        Math.floor((new Date(row.createdAt).getTime() - start) / size)
      );
      if (index >= 0) buckets[index][field] += 1;
    };
    saved.forEach((row) => bump(row, 'saved'));
    wasted.forEach((row) => bump(row, 'wasted'));

    // Bars are a share of the busiest bucket, so a quiet month and a busy one
    // both read rather than one of them rendering as a stub.
    const peak = Math.max(1, ...buckets.map((bucket) => bucket.saved + bucket.wasted));

    const byName = new Map<string, number>();
    for (const row of wasted) {
      byName.set(row.name, (byName.get(row.name) ?? 0) + 1);
    }
    const top = [...byName.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
    const topPeak = Math.max(1, ...top.map(([, n]) => n));

    res.json({
      stats: [
        {
          label: 'Items consumed',
          value: saved.length.toLocaleString(),
          note: 'marked used up or cooked',
        },
        {
          label: 'Items discarded',
          value: wasted.length.toLocaleString(),
          note: 'explicitly marked thrown away',
        },
        {
          label: 'Waste rate',
          value: withReason === 0 ? '—' : `${rate}%`,
          note: `by item, of ${withReason.toLocaleString()} confirmed outcomes`,
        },
        {
          label: 'Waste by amount',
          value: withReason === 0 ? '—' : `${amountRate}%`,
          note: 'counts "some of it" as half an item',
        },
        {
          label: 'Unclassified removals',
          value: (rows.length - withReason).toLocaleString(),
          note: 'excluded from the waste rate',
        },
      ],
      chart: buckets.map((bucket) => ({
        label: new Date(bucket.from).toLocaleDateString('en-US', {
          month: 'short',
          day: range.buckets > 3 ? 'numeric' : undefined,
        }),
        saved: bucket.saved,
        wasted: bucket.wasted,
        savedPct: (bucket.saved / peak) * 100,
        wastedPct: (bucket.wasted / peak) * 100,
      })),
      wasted: top.map(([name, n]) => ({
        name,
        n: String(n),
        w: Math.round((n / topPeak) * 100),
      })),
      accuracy,
      locations,
      // How many removals this whole half of the screen rests on. Sent as a
      // number rather than left for the console to infer from four zeroes: a
      // flat chart and an empty list look like a broken screen, and the
      // difference between "nothing was wasted" and "nothing has been recorded"
      // is the entire meaning of what is being shown.
      removals: rows.length,
      note:
        rows.length === 0
          ? 'No removals recorded yet. This fills the first time someone deletes a pantry item.'
          : rows.length > withReason
            ? `${rows.length - withReason} removal(s) have no confirmed outcome: plain deletes, Clear pantry, and older records. These are excluded from consumed, discarded, and waste-rate figures. Undoing a scan is not counted at all.`
            : 'Outcomes come from explicit app actions. Each recorded pantry entry counts once, regardless of its quantity.',
    });
  })
);

// ----------------------------------------------------------------- /review

adminReportsRouter.get(
  '/review',
  withDb(async (req, res) => {
    const options = browseOptions(req.query);
    if (!options) return badRequest(res, 'Choose a valid review date range.');
    const status = req.query.status ?? 'open';
    const page = Number(req.query.page ?? 1);
    if (typeof status !== 'string' || !REVIEW_FILTERS.includes(status as ReviewFilter) || !Number.isSafeInteger(page) || page < 1 || page > 100000) {
      return badRequest(res, 'Choose a valid review filter and page.');
    }
    const [scanPage, feedbackPage] = await Promise.all([
      reviewPage('scans', status as ReviewFilter, page, dateWindow(options)),
      reviewPage('feedback', status as ReviewFilter, page, dateWindow(options)),
    ]);
    const scanRows = scanPage.rows;
    const feedbackRows = feedbackPage.rows;

    const uids = new Set<string>([
      ...scanRows.map((row: any) => String(row.userId)),
      ...feedbackRows.map((row: any) => String(row.userId)),
    ]);
    const named = await User.find({ _id: { $in: [...uids] } })
      .select({ name: 1 })
      .lean();
    const nameById = new Map(named.map((row: any) => [String(row._id), row.name]));
    const nameOf = (uid: string) => nameById.get(uid) || `Account ${String(uid).slice(0, 6)}`;

    const scans = scanRows.map((row: any) => {
      const candidates: any[] = Array.isArray(row.candidates) ? row.candidates : [];

      // Two different failures, and they want different answers. A missing date
      // is a gap the user has to fill in by hand; an unsure name is the scanner
      // saying it guessed, and it carries the alternatives it was choosing
      // between — which is the thing worth reading here.
      const undated = candidates.filter((item) => !item?.expiryDate);
      const unsure = candidates.filter((item) => item?.nameUnsure);

      return {
        id: String(row._id),
        user: nameOf(String(row.userId)),
        userId: String(row.userId),
        at: relativeTime(row.createdAt),
        review: reviewState(row.review),
        scene: row.sceneLabel || 'Scan',
        items: candidates.length,
        unresolved: row.unresolvedCount ?? 0,
        added: Array.isArray(row.addedItemIds) ? row.addedItemIds.length : 0,
        undated: undated.map((item) => String(item.name ?? 'Unnamed')),
        unsure: unsure.map((item) => ({
          name: String(item.name ?? 'Unnamed'),
          reason: item.nameUnsureReason ? String(item.nameUnsureReason) : null,
          alternatives: Array.isArray(item.nameAlternatives)
            ? item.nameAlternatives.map(String).slice(0, 4)
            : [],
        })),
      };
    });

    const feedback = feedbackRows.map((row: any) => ({
      id: String(row._id),
      user: nameOf(String(row.userId)),
      userId: String(row.userId),
      // Stored beside the uid precisely so a reply is possible. Most accounts
      // are anonymous, so most of these are null and that is the honest answer.
      email: row.email || null,
      review: reviewState(row.review),
      message: String(row.message ?? ''),
      platform: row.platform || '—',
      appVersion: row.appVersion || '—',
      at: relativeTime(row.createdAt),
    }));

    res.json({
      scans,
      feedback,
      pagination: { page, asOf: options.asOf.toISOString(), pageSize: REVIEW_PAGE_SIZE, scans: scanPage.total, feedback: feedbackPage.total },
      note:
        scans.length === 0 && feedback.length === 0
          ? 'No review items match this filter. Try another status or refresh after new app activity.'
          : null,
    });
  })
);

// ------------------------------------------------------------------ /chats

/** Conversations per page, and messages per transcript. */
const TRANSCRIPT_LIMIT = 200;

/**
 * The chatbot, which nothing in the console could see.
 *
 * The dashboard has counted chat messages since it was built. This is the first
 * thing that lets anyone read one, and that is worth being deliberate about:
 * these are private conversations between a person and the app, and opening one
 * is the most invasive thing this console does.
 *
 * So the list carries no message text at all — only who, when, and how long.
 * Reading an actual transcript is a second, separate request, which means it is
 * a separate line in the audit log naming the account whose words were read.
 */
adminReportsRouter.get(
  '/chats',
  withDb(async (req, res) => {
    const options = browseOptions(req.query);
    if (!options) return badRequest(res, 'Choose valid conversation filters.');
    const names = options.q ? await User.find({ name: { $regex: literalSearch(options.q), $options: 'i' } }).select({ _id: 1 }).lean() : [];
    const filter = { updatedAt: dateWindow(options), ...(options.q ? { $or: [{ title: { $regex: literalSearch(options.q), $options: 'i' } }, { userId: { $in: names.map((row: any) => row._id) } }, { userId: { $regex: literalSearch(options.q), $options: 'i' } }] } : {}) };
    const [conversations, total] = await Promise.all([
      ChatConversation.find(filter).sort({ updatedAt: -1, _id: -1 }).skip((options.page - 1) * PAGE_SIZE).limit(PAGE_SIZE).lean(),
      ChatConversation.countDocuments(filter),
    ]);

    const ids = conversations.map((row: any) => String(row._id));

    const [counts, lastTurns] = await Promise.all([
      ChatMessage.aggregate([
        { $match: { conversationId: { $in: ids } } },
        {
          $group: {
            _id: '$conversationId',
            n: { $sum: 1 },
            asked: { $sum: { $cond: [{ $eq: ['$role', 'user'] }, 1, 0] } },
            recipes: { $sum: { $cond: [{ $ne: ['$recipe', null] }, 1, 0] } },
          },
        },
      ]),
      ChatMessage.aggregate([
        { $match: { conversationId: { $in: ids } } },
        { $sort: { createdAt: -1 } },
        { $group: { _id: '$conversationId', at: { $first: '$createdAt' } } },
      ]),
    ]);

    const countById = new Map(counts.map((row: any) => [row._id, row]));
    const lastById = new Map(lastTurns.map((row: any) => [row._id, row.at]));

    const uids = new Set(conversations.map((row: any) => String(row.userId)));
    const named = await User.find({ _id: { $in: [...uids] } })
      .select({ name: 1 })
      .lean();
    const nameById = new Map(named.map((row: any) => [String(row._id), row.name]));

    res.json({
      pagination: pageMetadata(options, total),
      conversations: conversations.map((row: any) => {
        const id = String(row._id);
        const stats: any = countById.get(id) ?? { n: 0, asked: 0, recipes: 0 };
        return {
          id,
          // The title the app set from the first message, and the only text on
          // this screen before someone deliberately opens a conversation.
          title: row.title || 'Untitled',
          user: nameById.get(String(row.userId)) || `Account ${String(row.userId).slice(0, 6)}`,
          userId: String(row.userId),
          messages: stats.n,
          asked: stats.asked,
          recipes: stats.recipes,
          at: relativeTime(lastById.get(id) ?? row.updatedAt),
        };
      }),
      note:
        conversations.length === 0
          ? 'No conversations match these filters. Try a wider date range or another search.'
          : null,
    });
  })
);

adminReportsRouter.get(
  '/chats/:id',
  withDb(async (req, res) => {
    const raw = req.params.id;
    const conversationId = typeof raw === 'string' ? raw.trim() : '';
    if (!isValidId(conversationId)) {
      badRequest(res, 'That is not a conversation id.');
      return;
    }

    const conversation: any = await ChatConversation.findById(conversationId).lean();
    if (!conversation) {
      res.status(404).json({ error: 'not-found', message: 'No such conversation.' });
      return;
    }

    // Named for the audit record: reading someone's chat is an access to that
    // person's data, and the log should say whose. The middleware picks this up
    // on finish — see middleware/audit.ts.
    res.locals.auditTarget = String(conversation.userId);

    const messages = await ChatMessage.find({ conversationId })
      .sort({ createdAt: 1 })
      .limit(TRANSCRIPT_LIMIT)
      .lean();

    const owner: any = await User.findById(conversation.userId).select({ name: 1 }).lean();

    res.json({
      id: conversationId,
      title: conversation.title || 'Untitled',
      user: owner?.name || `Account ${String(conversation.userId).slice(0, 6)}`,
      userId: String(conversation.userId),
      messages: messages.map((row: any) => ({
        id: String(row._id),
        role: row.role,
        // An assistant turn is either text or a recipe, never both. A recipe
        // reply arrives with an empty content string, and rendering that as a
        // blank bubble would read as the chatbot having failed to answer.
        text: String(row.content ?? ''),
        recipeTitle: row.recipe?.title ? String(row.recipe.title) : null,
        at: relativeTime(row.createdAt),
      })),
      truncated: messages.length === TRANSCRIPT_LIMIT,
    });
  })
);

// ------------------------------------------------- accuracy and location

/**
 * How well the scanner actually does, from scans.accuracy.
 *
 * This is the figure the design asked for and the console has been saying it
 * did not have. It does: the app tallies, per scan, how many items it read,
 * how many were added by hand afterwards, and for each of name, date and
 * ripeness whether the user confirmed what the scanner said, corrected it, or
 * left it untouched.
 *
 * "Corrected" is the honest denominator for accuracy — it is a user actively
 * disagreeing with a read, which is a stronger signal than any confidence score
 * the model could report about itself. "Untouched" is not agreement: it is
 * someone who never looked, so it is counted and shown separately rather than
 * folded in as a success.
 *
 * Per ingredient is not possible, and it is worth being clear about why: these
 * are per-scan tallies with no item names in them, so there is no way to say
 * that this figure belongs to pork and that one to milk. The number is
 * system-wide or it is nothing.
 */
async function scannerAccuracy(from: Date) {
  const [totals] = await Scan.aggregate([
    { $match: { createdAt: { $gte: from }, accuracy: { $ne: null } } },
    {
      $group: {
        _id: null,
        scans: { $sum: 1 },
        read: { $sum: '$accuracy.read' },
        handAdded: { $sum: '$accuracy.handAdded' },
        removed: { $sum: '$accuracy.removed' },
        nameConfirmed: { $sum: '$accuracy.name.confirmed' },
        nameCorrected: { $sum: '$accuracy.name.corrected' },
        nameUntouched: { $sum: '$accuracy.name.untouched' },
        dateConfirmed: { $sum: '$accuracy.date.confirmed' },
        dateCorrected: { $sum: '$accuracy.date.corrected' },
        dateUntouched: { $sum: '$accuracy.date.untouched' },
        dateAbsent: { $sum: '$accuracy.date.absent' },
      },
    },
  ]);

  const t = totals ?? {};
  const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

  const read = num(t.read);
  const handAdded = num(t.handAdded);

  // Every ratio below divides by a count that can be zero on a young database,
  // so each one returns null rather than NaN or a confident 0%.
  const share = (part: number, whole: number) =>
    whole === 0 ? null : Math.round((part / whole) * 1000) / 10;

  const nameSeen = num(t.nameConfirmed) + num(t.nameCorrected) + num(t.nameUntouched);
  const dateSeen = num(t.dateConfirmed) + num(t.dateCorrected) + num(t.dateUntouched);

  return {
    scans: num(t.scans),
    read,
    handAdded,
    removed: num(t.removed),
    // What share of everything that ended up in a pantry the scanner found at
    // all. A low number here means people are typing, not scanning.
    readShare: share(read, read + handAdded),
    name: {
      confirmed: num(t.nameConfirmed),
      corrected: num(t.nameCorrected),
      untouched: num(t.nameUntouched),
      correctedPct: share(num(t.nameCorrected), nameSeen),
    },
    date: {
      confirmed: num(t.dateConfirmed),
      corrected: num(t.dateCorrected),
      untouched: num(t.dateUntouched),
      absent: num(t.dateAbsent),
      correctedPct: share(num(t.dateCorrected), dateSeen),
      // The scanner returning nothing at all, as a share of what it read.
      absentPct: share(num(t.dateAbsent), read),
    },
    note:
      read === 0
        ? 'No scan in this window read anything — every item was added by hand, so there is nothing to be accurate about yet.'
        : null,
  };
}

/** Where people keep things. Not time-scoped: this is the pantry as it stands. */
async function whereFoodLives() {
  const rows = await PantryItem.aggregate([
    { $group: { _id: { $ifNull: ['$location', 'Unsorted'] }, n: { $sum: 1 } } },
    { $sort: { n: -1 } },
  ]);

  const total = rows.reduce((sum: number, row: any) => sum + row.n, 0);
  return rows.map((row: any) => ({
    label: String(row._id || 'Unsorted'),
    n: row.n,
    pct: total === 0 ? 0 : Math.round((row.n / total) * 100),
  }));
}
