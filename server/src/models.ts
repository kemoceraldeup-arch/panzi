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
const userSchema = new Schema(
  {
    _id: { type: String, required: true },
    name: { type: String, default: null },
    dietaryPreferences: { type: [String], default: [] },
    allergies: { type: String, default: '' },
    mealPlanOptIn: { type: Boolean, default: false },
    photoURL: { type: String, default: null },
  },
  { timestamps: true, collection: 'users' }
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
