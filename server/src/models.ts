// server/src/models.ts
//
// Every collection the app stores, in one file, because the shapes only make
// sense next to each other — a scan's `addedItemIds` point at pantry items, and
// a pantry item's provenance fields were written by a scan.
//
// Two decisions run through all of them.
//
// First, `_id` is a String everywhere rather than an ObjectId. The app needs to
// know an id before the write lands: the scan modal wires up "N items added ·
// Undo" the moment a batch is approved, and a scan record is updated in place
// by an id the client generated when it first saved. Letting the server mint
// ids would mean waiting for a round trip before the interface could respond.
//
// Second, `userId` is on every document and indexed, and it is always filled
// from the verified token rather than the request body. A collection without
// that field would have no way to answer "whose is this?", and a `userId` taken
// from a payload would answer it with whatever the caller claimed.

import mongoose, { Schema } from 'mongoose';

/** A rectangle inside a capture, as fractions of each axis. */
const boxSchema = new Schema(
  {
    x: { type: Number, required: true },
    y: { type: Number, required: true },
    width: { type: Number, required: true },
    height: { type: Number, required: true },
  },
  { _id: false }
);

/** A photo an item can be cropped out of. Dimensions are part of it — the box
 *  is per-axis, so cropping without distorting needs the real aspect ratio. */
const photoSchema = new Schema(
  {
    uri: { type: String, required: true },
    width: { type: Number, required: true },
    height: { type: Number, required: true },
  },
  { _id: false }
);

/** Per-serving macros looked up from FatSecret at scan time. `matchedName` and
 *  `foodId` are kept alongside the numbers so a user who overrides a bad match
 *  can be shown what was actually matched, and so a future re-lookup (picking
 *  a different match) has the id to search from rather than guessing again
 *  off the item's own name. Absent (null) rather than zeroed when no match was
 *  found or the item was added by hand — a zero is a real answer ("0 calories")
 *  and must never be confused with "we don't know". */
const nutritionSchema = new Schema(
  {
    foodId: { type: String, required: true },
    matchedName: { type: String, required: true },
    servingDescription: { type: String, default: null },
    calories: { type: Number, required: true },
    proteinG: { type: Number, required: true },
    carbsG: { type: Number, required: true },
    fatG: { type: Number, required: true },
  },
  { _id: false }
);

/** What produced a Panzi use-by estimate — Phase 2's own record, kept
 *  alongside `estimatedUseBy` so the attribution line and any recomputation
 *  don't have to re-derive foodClass from a category that may since have
 *  changed. */
const estimateInputsSchema = new Schema(
  {
    foodClass: { type: String, required: true },
    storedIn: { type: String, required: true },
    packageStatus: { type: String, enum: ['sealed', 'opened', null], default: null },
    from: { type: String, required: true },
    days: { type: Number, required: true },
    confidence: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
  },
  { _id: false }
);

// ---------------------------------------------------------------------------
// users
// ---------------------------------------------------------------------------

// `_id` is the Firebase uid. There is no separate user id in this system, and
// giving the document one would create two answers to the same question.
//
// `allergies` stays a single comma-separated string rather than an array,
// because that is what the survey's free-text field writes and what
// services/profile.ts already splits on read. Changing it here would mean
// changing it in two clients for no gain.
//
// `allergies` and `dietaryPreferences` are health-adjacent (an allergy list
// exists to prevent a physical reaction) and are handled accordingly: no
// route ever logs a request body wholesale (see routes/helpers.ts's withDb,
// which logs only `err.message`), so a thrown error can't leak them into the
// server's own logs the way a naive catch-all would. There is deliberately no
// field-level encryption — every route that reads or writes these fields
// already requires the owning uid's verified token (see middleware/auth.ts),
// which is the access control that actually matters for a single-tenant
// document keyed by its owner. What "delete account" does with this data
// specifically is the '/delete' route below: not disabled-and-kept, removed.
const userSchema = new Schema(
  {
    _id: { type: String, required: true },
    name: { type: String, default: null },
    dietaryPreferences: { type: [String], default: [] },
    allergies: { type: String, default: '' },
    mealPlanOptIn: { type: Boolean, default: false },
    photoURL: { type: String, default: null },
    // The platform this account last called the API from — 'iOS', 'Android',
    // 'Expo Go' or 'Web' — noted from the User-Agent by device.ts. Coarse on
    // purpose: a full user-agent string is a fingerprint, and the only question
    // the admin console asks of it is which app someone is using.
    lastPlatform: { type: String, default: null },
    lastPlatformAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'users' }
);

// ---------------------------------------------------------------------------
// deletion_audit_log
// ---------------------------------------------------------------------------

// The one record a "right to erasure" is not allowed to erase along with
// everything else — otherwise a disputed deletion ("I never asked for this")
// would have nothing to check it against. Deliberately its own collection
// rather than a field on `users`: the whole point is that this row outlives
// the User document profileRouter's '/delete' removes it alongside. Holds
// nothing about the person beyond the uid and when/how they asked.
const deletionAuditLogSchema = new Schema(
  {
    uid: { type: String, required: true, index: true },
    requestedAt: { type: Date, required: true },
    requestedVia: { type: String, required: true },
  },
  { timestamps: true, collection: 'deletion_audit_log' }
);

// ---------------------------------------------------------------------------
// pantry_items
// ---------------------------------------------------------------------------

// The provenance fields — dateSource, ripeness, ripenessSource — default to
// null rather than being absent. The scanner is allowed to estimate a date for
// loose fruit that has none printed on it, and the deal that makes that
// acceptable is that an estimate stays visibly an estimate forever. A missing
// field and a null one read the same to the app, but only null survives a
// partial update without the schema quietly dropping it.
const pantryItemSchema = new Schema(
  {
    _id: { type: String, required: true },
    userId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    quantity: { type: String, default: '' },
    category: { type: String, default: '' },
    location: { type: String, default: null },
    expiryDate: { type: String, default: null }, // 'YYYY-MM-DD'
    photoUri: { type: String, default: null },
    scanPhoto: { type: photoSchema, default: null },
    box: { type: boxSchema, default: null },
    dateSource: { type: String, enum: ['label', 'estimated', 'user', null], default: null },
    ripeness: { type: String, default: null },
    ripenessSource: { type: String, enum: ['estimated', 'user', null], default: null },
    nutrition: { type: nutritionSchema, default: null },
    packageStatus: { type: String, enum: ['sealed', 'opened', null], default: null },
    openedAt: { type: String, default: null }, // 'YYYY-MM-DD'
    expiryUnknown: { type: Boolean, default: false },
    // Phase 2 — the Panzi use-by estimate. `basis` distinguishes a rough-date
    // chip pick from a typed/printed date without overloading dateSource,
    // which older code (provenanceChip and friends) still reads as-is.
    basis: { type: String, enum: ['printed', 'manual', 'rough', 'estimated', null], default: null },
    estimatedUseBy: { type: String, default: null }, // 'YYYY-MM-DD'
    estimateInputs: { type: estimateInputsSchema, default: null },
  },
  { timestamps: true, collection: 'pantry_items' }
);

// The list is drawn soonest-expiring first and always filtered to one user.
// Firestore needed a composite index for that and we sorted client-side to
// avoid the setup step; Mongo will build this from the schema on connect, so
// the sort moves back to the database where it belongs.
pantryItemSchema.index({ userId: 1, expiryDate: 1 });

// ---------------------------------------------------------------------------
// saved_recipes
// ---------------------------------------------------------------------------

// The recipe is stored whole rather than as a reference. A saved dish that
// quietly changed because tonight's pantry is different would be a strange
// thing to hand someone who asked to keep it — so `recipe` is Mixed, holding
// the object exactly as it was suggested.
//
// `_id` is derived from the uid and a slug of the title, so saving the same
// dish twice overwrites rather than duplicating, and unsaving needs no lookup.
const savedRecipeSchema = new Schema(
  {
    _id: { type: String, required: true },
    userId: { type: String, required: true, index: true },
    key: { type: String, required: true },
    savedAtMs: { type: Number, required: true },
    recipe: { type: Schema.Types.Mixed, required: true },
  },
  { timestamps: true, collection: 'saved_recipes' }
);

savedRecipeSchema.index({ userId: 1, savedAtMs: -1 });

// ---------------------------------------------------------------------------
// scans
// ---------------------------------------------------------------------------

// `original` and `candidates` are Mixed for the same reason `recipe` is: they
// are the model's reads and the user's corrections, already JSON-shaped, and
// typing them here would mean maintaining the scanner's output shape in a
// second place that can silently fall behind it.
//
// `unresolvedCount` and `accuracy` are denormalised on purpose. The history
// list renders "3 of 6 still need a date" without walking every candidate of
// every scan, and rolling accuracy up across scans shouldn't mean re-diffing
// every candidate list.
const scanSchema = new Schema(
  {
    _id: { type: String, required: true },
    userId: { type: String, required: true, index: true },
    sceneLabel: { type: String, default: 'Scan' },
    photoUri: { type: String, default: null },
    photoWidth: { type: Number, default: null },
    photoHeight: { type: Number, default: null },
    original: { type: Schema.Types.Mixed, default: [] },
    candidates: { type: Schema.Types.Mixed, default: [] },
    addedItemIds: { type: [String], default: [] },
    unresolvedCount: { type: Number, default: 0 },
    accuracy: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: true, collection: 'scans' }
);

// History is fetched newest-first and capped. Without this index that sort is
// an in-memory pass over every scan the user has ever taken.
scanSchema.index({ userId: 1, createdAt: -1 });

// ---------------------------------------------------------------------------
// email_verifications
// ---------------------------------------------------------------------------

// One row per account waiting to prove its inbox, `_id` the Firebase uid — a
// second code request overwrites the first rather than accumulating rows,
// since only the most recently sent code should ever be valid. `attempts`
// caps guessing — five wrong tries locks the account out for a stretch (see
// `lockedUntil`) rather than letting an unlimited number of six-digit-space
// guesses run against one email address forever.
//
// `lockedUntil` is its own field rather than folded into `expiresAt`,
// because the two mean different things: `expiresAt` is when the CODE stops
// being redeemable, `lockedUntil` is when the ACCOUNT is allowed to ask for
// a new one again. `reapAt` is the TTL index's own field — always set to
// whichever of the two is later — so a locked-out row survives at least
// until its lockout has actually elapsed even on the rare request pattern
// where the lockout would otherwise outlive the code's own expiry, while an
// abandoned row (nobody ever comes back) still eventually cleans itself up
// rather than needing a background sweep.
const emailVerificationSchema = new Schema(
  {
    _id: { type: String, required: true }, // Firebase uid
    email: { type: String, required: true },
    code: { type: String, required: true },
    attempts: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true },
    lockedUntil: { type: Date, default: null },
    reapAt: { type: Date, required: true },
  },
  { timestamps: true, collection: 'email_verifications' }
);

emailVerificationSchema.index({ reapAt: 1 }, { expireAfterSeconds: 0 });

// ---------------------------------------------------------------------------
// feedback
// ---------------------------------------------------------------------------

// Read by a human, never by the app. The email is stored beside the uid so a
// reply is possible without looking the account up — a uid alone says nothing
// to whoever is reading these.
const feedbackSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    email: { type: String, default: null },
    message: { type: String, required: true },
    appVersion: { type: String, default: '' },
    platform: { type: String, default: '' },
  },
  { timestamps: true, collection: 'feedback' }
);

// ---------------------------------------------------------------------------
// recipe_ratings
// ---------------------------------------------------------------------------

// One row per (user, dish) — rating the same dish again overwrites rather
// than accumulating, the same "no stable recipe id, so the title is the
// identity" reasoning saved_recipes already uses. `_id` is built client-side
// from the uid and a slug of the title (see recipeRatingKey in
// src/services/recipeRatings.ts) for the same reason: the app needs the id
// before the write lands, and a second rating of a dish already rated should
// replace it, not duplicate it.
const recipeRatingSchema = new Schema(
  {
    _id: { type: String, required: true },
    userId: { type: String, required: true, index: true },
    title: { type: String, required: true },
    // recipeKey from the app: title plus a fingerprint of the ingredient names,
    // so two different dishes sharing a title are rated apart. Null on ratings
    // made before it existed, which fall back to the title.
    key: { type: String, default: null },
    stars: { type: Number, required: true, min: 1, max: 5 },
  },
  { timestamps: true, collection: 'recipe_ratings' }
);

// ---------------------------------------------------------------------------
// chat_conversations / chat_messages
// ---------------------------------------------------------------------------

// A conversation is its own document, separate from its messages, the same
// split as a chat app's sidebar and its transcript. `title` is set once, from
// the first message, and never rewritten — a conversation renaming itself as
// the topic drifts would be a stranger label to see in a history list than one
// that is simply about how it started.
const chatConversationSchema = new Schema(
  {
    _id: { type: String, required: true },
    userId: { type: String, required: true, index: true },
    title: { type: String, required: true },
    // Set once the user renames it themselves, so the first message no longer
    // gets to title it — a name someone typed on purpose outranks the default.
    titleLocked: { type: Boolean, default: false },
    pinned: { type: Boolean, default: false },
    // Kept, just out of the main list — the drawer shows these in their own
    // collapsed section, where they can be brought back.
    archived: { type: Boolean, default: false },
  },
  { timestamps: true, collection: 'chat_conversations' }
);

// History is listed most-recently-active first.
chatConversationSchema.index({ userId: 1, updatedAt: -1 });

// One document per message rather than one per conversation, even though a
// conversation is now its own document too. A conversation still only grows by
// appending, and "load the last 50 of this one" is a plain indexed query
// rather than a slice of an ever-growing array that would eventually hit
// Mongo's 16MB document ceiling.
const chatMessageSchema = new Schema(
  {
    _id: { type: String, required: true },
    userId: { type: String, required: true, index: true },
    conversationId: { type: String, required: true, index: true },
    role: { type: String, enum: ['user', 'assistant'], required: true },
    // Empty string on a recipe reply — the two are mutually exclusive, an
    // assistant turn is one or the other, and Mongo has no way to require
    // "exactly one of two fields" so the client is what enforces that reading.
    content: { type: String, default: '' },
    // Mixed, the same reasoning as scans.candidates and saved_recipes.recipe:
    // this is the model's structured output, already JSON-shaped, and typing
    // it here would mean keeping the recipe schema in step in two places.
    recipe: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: true, collection: 'chat_messages' }
);

// History is read oldest-first for display but fetched newest-first and
// capped, the same shape as scans — scoped to one conversation, since that is
// now the unit a screen ever asks for.
chatMessageSchema.index({ conversationId: 1, createdAt: -1 });


// ---------------------------------------------------------------------------
// api_usage
// ---------------------------------------------------------------------------

// One document per model call. These numbers were already being computed —
// every model call logged its usage to stdout and dropped it — and HANDOFF.md
// asks for API cost per scan as an admin feature. Writing them down is the
// whole difference between that question being answerable and not.
//
// Tokens are stored raw and cost is derived at read time. Prices change; a
// stored dollar figure would silently become a lie, while a stored token count
// stays true forever.
//
// `inputTokens` is the *uncached remainder* only, the same split the Anthropic
// response reports — the true prompt size is the three input figures added
// together. Reading inputTokens alone makes caching look like it shrank the
// prompt rather than repriced it.
const apiUsageSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    route: { type: String, required: true, index: true },
    model: { type: String, required: true },
    inputTokens: { type: Number, default: 0 },
    cacheReadTokens: { type: Number, default: 0 },
    cacheWriteTokens: { type: Number, default: 0 },
    outputTokens: { type: Number, default: 0 },
    durationMs: { type: Number, default: 0 },
    ok: { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'api_usage' }
);

// Every read is "spend over a window", newest first.
apiUsageSchema.index({ createdAt: -1 });

// Retention, enforced by Mongo rather than by remembering.
//
// This collection grows by one row per model call and is never edited, so
// without a ceiling it is the only thing in this database that grows without
// bound. A year is chosen so that "what did this cost us last spring" is still
// answerable; beyond that the rows are storage, not information.
//
// A TTL index deletes. That is the point of it, and it is worth saying plainly:
// api_usage rows older than a year will disappear on their own.
apiUsageSchema.index({ createdAt: 1 }, { expireAfterSeconds: 365 * 24 * 60 * 60 });

// ---------------------------------------------------------------------------
// admin_audit
// ---------------------------------------------------------------------------

// Who looked at what. The admin routes are the only ones in this system that
// deliberately read across accounts, so they are the only ones where "an
// administrator opened this person's pantry" is a fact worth keeping. Without
// it the console is a room with no lock on the outside and no record of who
// went in.
//
// The actor is the verified uid from the token, never anything the client sent.
const adminAuditSchema = new Schema(
  {
    actorId: { type: String, required: true, index: true },
    actorEmail: { type: String, default: null },
    method: { type: String, required: true },
    path: { type: String, required: true },
    status: { type: Number, default: 0 },
    durationMs: { type: Number, default: 0 },
    // Present only when a route is scoped to one account, so "which user was
    // this admin looking at" is answerable without parsing the path.
    targetUserId: { type: String, default: null, index: true },
    ip: { type: String, default: null },
  },
  { timestamps: true, collection: 'admin_audit' }
);

adminAuditSchema.index({ createdAt: -1 });

// Six months, and shorter than api_usage on purpose. An access log is a record
// of what an administrator read about identifiable people; keeping it forever
// makes it a bigger liability every day, and nobody investigates a page view
// from two years ago. Same warning as above: this deletes.
adminAuditSchema.index({ createdAt: 1 }, { expireAfterSeconds: 180 * 24 * 60 * 60 });

// ---------------------------------------------------------------------------
// item_dispositions
// ---------------------------------------------------------------------------

// What happened to a pantry item when it left the pantry.
//
// A `disposition` field on pantry_items would answer nothing, because removal
// is a hard delete — the document that would carry the field is the document
// that goes away. So the event is recorded here instead, and it is the only
// thing that can ever tell "eaten" apart from "thrown out". Until this existed
// the Analytics screen had no honest source and said so on the page.
//
// Explicit app actions send consumed/discarded; plain deletion and older clients
// default to removed. Expiry is retained as context, never substituted for a
// confirmed outcome. Legacy expired records still represent discarded food.
const itemDispositionSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    itemId: { type: String, required: true },
    name: { type: String, required: true },
    category: { type: String, default: '' },
    reason: {
      type: String,
      enum: ['consumed', 'discarded', 'expired', 'removed'],
      default: 'removed',
      index: true,
    },
    expiryDate: { type: String, default: null },
    pastExpiry: { type: Boolean, default: false },
    // The share of the item that was thrown out, 0-1, for 'discarded' rows
    // ("some of it" is 0.5). The rest of a discarded item counts as eaten.
    // Absent on rows written before it existed, which read as 1.
    portion: { type: Number, default: 1, min: 0, max: 1 },
    // The item's quantity text as it stood ("5 kg", "12 pcs"). Kept for
    // context and export; units differ too much between foods to add up.
    quantity: { type: String, default: '' },
  },
  { timestamps: true, collection: 'item_dispositions' }
);

itemDispositionSchema.index({ createdAt: -1 });

// ---------------------------------------------------------------------------
// admin_reviews
// ---------------------------------------------------------------------------

// The console's own triage state for a scan or a feedback message: who is
// looking at it, and what they wrote down. Kept separate from app records on
// purpose — internal notes must never reach mobile clients, and the only way
// to guarantee that is for them not to live on a document the app reads.
const adminReviewSchema = new Schema({
  _id: { type: String, required: true },
  kind: { type: String, enum: ['scans', 'feedback'], required: true },
  targetId: { type: String, required: true },
  status: { type: String, enum: ['new', 'in_progress', 'resolved'], required: true },
  note: { type: String, default: '', maxlength: 2000 },
  revision: { type: Number, required: true },
  updatedBy: { type: String, required: true },
}, { timestamps: true, collection: 'admin_reviews' });

// `mongoose.models.X ?? model(...)` rather than a bare `model(...)`: tsx watch
// re-executes this file on every save, and registering the same model twice
// throws OverwriteModelError, which reads as a crash rather than a reload.
export const User = mongoose.models.User ?? mongoose.model('User', userSchema);
export const PantryItem =
  mongoose.models.PantryItem ?? mongoose.model('PantryItem', pantryItemSchema);
export const SavedRecipe =
  mongoose.models.SavedRecipe ?? mongoose.model('SavedRecipe', savedRecipeSchema);
export const Scan = mongoose.models.Scan ?? mongoose.model('Scan', scanSchema);
export const Feedback = mongoose.models.Feedback ?? mongoose.model('Feedback', feedbackSchema);
export const ChatConversation =
  mongoose.models.ChatConversation ?? mongoose.model('ChatConversation', chatConversationSchema);
export const ChatMessage =
  mongoose.models.ChatMessage ?? mongoose.model('ChatMessage', chatMessageSchema);
export const EmailVerification =
  mongoose.models.EmailVerification ?? mongoose.model('EmailVerification', emailVerificationSchema);
export const DeletionAuditLog =
  mongoose.models.DeletionAuditLog ?? mongoose.model('DeletionAuditLog', deletionAuditLogSchema);
export const RecipeRating =
  mongoose.models.RecipeRating ?? mongoose.model('RecipeRating', recipeRatingSchema);
export const ApiUsage = mongoose.models.ApiUsage ?? mongoose.model('ApiUsage', apiUsageSchema);
export const AdminAudit =
  mongoose.models.AdminAudit ?? mongoose.model('AdminAudit', adminAuditSchema);
export const ItemDisposition =
  mongoose.models.ItemDisposition ?? mongoose.model('ItemDisposition', itemDispositionSchema);
export const AdminReview =
  mongoose.models.AdminReview ?? mongoose.model('AdminReview', adminReviewSchema);
