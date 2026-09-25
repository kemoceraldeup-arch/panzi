// The prototype's data, carried over as-is from `Panzi Admin Console.dc.html`.
//
// This is what the console shows until /api/admin/* exists. It is deliberately
// kept in one file rather than sprinkled through the screens: when a real
// endpoint lands, the screen keeps its shape and only the loader in ./index.ts
// changes. Anything here is sample, not a measurement — the screens that have
// no real source at all say so on the page.

import type {
  ActivityRow,
  AdminUser,
  AnalyticsData,
  Category,
  ExpiringRow,
  FoodItem,
  HealthRow,
  LogEntry,
  Outcome,
  PantryLine,
  RangeData,
  RangeKey,
  Recipe,
  ReviewData,
  ChatsResponse,
  ChatTranscript,
} from './types';

export const USERS: AdminUser[] = [
  { id: 'u1', name: 'Maricel Santos', email: 'maricel.santos@gmail.com', items: 42, scans: 128, joined: 'Mar 2, 2026', status: 'Active', last: '2 hours ago', device: 'iPhone 13', av: '#4C8C5A', recipesCooked: 31, recipesRated: 12 },
  { id: 'u2', name: 'Jomar Dela Cruz', email: 'jomar.dc@gmail.com', items: 31, scans: 96, joined: 'Mar 11, 2026', status: 'Active', last: 'Yesterday', device: 'Redmi Note 12', av: '#2C5C39', recipesCooked: 31, recipesRated: 12 },
  { id: 'u3', name: 'Angelica Reyes', email: 'a.reyes@yahoo.com', items: 58, scans: 214, joined: 'Jan 24, 2026', status: 'Active', last: '40 minutes ago', device: 'Samsung A54', av: '#7BA37F', recipesCooked: 31, recipesRated: 12 },
  { id: 'u4', name: 'Renz Bautista', email: 'renzb@gmail.com', items: 12, scans: 22, joined: 'Jun 8, 2026', status: 'Dormant', last: '38 days ago', device: 'iPhone SE', av: '#6C6F7A', recipesCooked: 31, recipesRated: 12 },
  { id: 'u5', name: 'Kristine Villanueva', email: 'kristine.v@gmail.com', items: 47, scans: 173, joined: 'Feb 15, 2026', status: 'Active', last: '5 hours ago', device: 'Pixel 7a', av: '#C0503F', recipesCooked: 31, recipesRated: 12 },
  { id: 'u6', name: 'Paolo Mendoza', email: 'paolo.mendoza@outlook.com', items: 26, scans: 61, joined: 'Apr 3, 2026', status: 'Active', last: '3 days ago', device: 'Vivo Y36', av: '#2C5C39', recipesCooked: 31, recipesRated: 12 },
  { id: 'u7', name: 'Divina Ocampo', email: 'divina.ocampo@gmail.com', items: 63, scans: 240, joined: 'Dec 19, 2025', status: 'Active', last: '1 hour ago', device: 'iPhone 15', av: '#4C8C5A', recipesCooked: 31, recipesRated: 12 },
  { id: 'u8', name: 'Arjay Ramos', email: 'arjay.ramos@gmail.com', items: 9, scans: 14, joined: 'Jul 21, 2026', status: 'Dormant', last: '26 days ago', device: 'Oppo A78', av: '#6C6F7A', recipesCooked: 31, recipesRated: 12 },
  { id: 'u9', name: 'Sheena Gutierrez', email: 'sheena.g@gmail.com', items: 38, scans: 111, joined: 'Feb 28, 2026', status: 'Active', last: 'Yesterday', device: 'Samsung S23', av: '#7BA37F', recipesCooked: 31, recipesRated: 12 },
  { id: 'u10', name: 'Miguel Torres', email: 'mtorres@gmail.com', items: 21, scans: 55, joined: 'May 12, 2026', status: 'Suspended', last: '11 days ago', device: 'Realme C55', av: '#C0503F', recipesCooked: 31, recipesRated: 12 },
  { id: 'u11', name: 'Bea Alvarez', email: 'bea.alvarez@gmail.com', items: 44, scans: 152, joined: 'Mar 30, 2026', status: 'Active', last: '6 hours ago', device: 'iPhone 12', av: '#2C5C39', recipesCooked: 31, recipesRated: 12 },
  { id: 'u12', name: 'Nathaniel Cruz', email: 'nath.cruz@gmail.com', items: 35, scans: 88, joined: 'Apr 27, 2026', status: 'Active', last: '2 days ago', device: 'Infinix Hot 30', av: '#4C8C5A', recipesCooked: 31, recipesRated: 12 },
];

/** One list, reused for every user's slide-over — as in the prototype. */
export const PANTRY: PantryLine[] = [
  { name: 'Bigas (Rice)', qty: '5 kg', exp: 'expires Feb 2027' },
  { name: 'Itlog (Eggs)', qty: '12 pcs', exp: 'expires in 9 days' },
  { name: 'Gatas (Milk)', qty: '1 L', exp: 'expires in 2 days' },
  { name: 'Bawang (Garlic)', qty: '250 g', exp: 'expires in 34 days' },
  { name: 'Sardinas', qty: '4 cans', exp: 'expires Nov 2028' },
];

export const FOODS: FoodItem[] = [
  { id: 'f1', name: 'Bigas (Rice)', cat: 'Grains', shelf: '365 days', dated: 92, sources: { printed: 70, estimated: 12, typed: 10, rough: 0, unknown: 0, none: 8 }, estimates: { rows: 4, low: 0, medium: 50, high: 50 }, pantries: 24, items: 31 },
  { id: 'f2', name: 'Itlog (Eggs)', cat: 'Dairy & Eggs', shelf: '21 days', dated: 88, sources: { printed: 41, estimated: 24, typed: 17, rough: 6, unknown: 3, none: 9 }, estimates: { rows: 7, low: 14, medium: 57, high: 29 }, pantries: 22, items: 28 },
  { id: 'f3', name: 'Manok (Chicken)', cat: 'Meat', shelf: '2 days', dated: 81, sources: { printed: 12, estimated: 38, typed: 25, rough: 6, unknown: 4, none: 15 }, estimates: { rows: 9, low: 22, medium: 56, high: 22 }, pantries: 18, items: 24 },
  { id: 'f4', name: 'Gatas (Milk)', cat: 'Dairy & Eggs', shelf: '7 days', dated: 90, sources: { printed: 64, estimated: 14, typed: 12, rough: 2, unknown: 2, none: 6 }, estimates: { rows: 3, low: 0, medium: 67, high: 33 }, pantries: 15, items: 19 },
  { id: 'f5', name: 'Kamatis (Tomato)', cat: 'Produce', shelf: '7 days', dated: 64, sources: { printed: 3, estimated: 39, typed: 18, rough: 12, unknown: 8, none: 20 }, estimates: { rows: 7, low: 43, medium: 43, high: 14 }, pantries: 14, items: 17 },
  { id: 'f6', name: 'Bawang (Garlic)', cat: 'Produce', shelf: '60 days', dated: 58, sources: { printed: 2, estimated: 33, typed: 19, rough: 14, unknown: 9, none: 23 }, estimates: { rows: 5, low: 40, medium: 60, high: 0 }, pantries: 12, items: 14 },
  { id: 'f7', name: 'Baboy (Pork)', cat: 'Meat', shelf: '3 days', dated: 79, sources: { printed: 9, estimated: 40, typed: 24, rough: 8, unknown: 5, none: 14 }, estimates: { rows: 6, low: 33, medium: 50, high: 17 }, pantries: 11, items: 13 },
  { id: 'f8', name: 'Talong (Eggplant)', cat: 'Produce', shelf: '10 days', dated: 51, sources: { printed: 1, estimated: 30, typed: 16, rough: 15, unknown: 11, none: 27 }, estimates: { rows: 4, low: 50, medium: 50, high: 0 }, pantries: 8, items: 9 },
];

export const RECIPES: Recipe[] = [
  { id: 'chicken adobo', name: 'Chicken Adobo', ing: 8, saves: 142, rated: 96, stars: 4.6, liked: 88, photo: 'adobo', lastAt: '2026-08-21T11:04:00.000Z' },
  { id: 'sinigang na baboy', name: 'Sinigang na Baboy', ing: 11, saves: 118, rated: 74, stars: 4.4, liked: 82, photo: 'sinigang', lastAt: '2026-08-20T19:12:00.000Z' },
  { id: 'tinolang manok', name: 'Tinolang Manok', ing: 9, saves: 97, rated: 61, stars: 4.3, liked: 79, photo: 'tinola', lastAt: '2026-08-19T18:40:00.000Z' },
  { id: 'pancit canton', name: 'Pancit Canton', ing: 12, saves: 88, rated: 54, stars: 4.1, liked: 72, photo: 'pancit_canton', lastAt: '2026-08-18T12:30:00.000Z' },
  { id: 'ginisang munggo', name: 'Ginisang Munggo', ing: 7, saves: 63, rated: 38, stars: 3.9, liked: 66, photo: 'ginisang_munggo', lastAt: '2026-08-16T17:55:00.000Z' },
  { id: 'menudo', name: 'Menudo', ing: 13, saves: 51, rated: 24, stars: 3.7, liked: 58, photo: 'menudo', lastAt: '2026-08-14T20:02:00.000Z' },
  { id: 'kaldereta', name: 'Kaldereta', ing: 14, saves: 44, rated: 12, stars: 3.4, liked: 42, photo: 'kaldereta', lastAt: '2026-08-11T19:26:00.000Z' },
  { id: 'tortang talong', name: 'Tortang Talong', ing: 5, saves: 37, rated: 0, stars: null, liked: null, photo: 'tortang_talong', lastAt: '2026-08-09T13:18:00.000Z' },
];

export const LOGS: LogEntry[] = [
  { id: 'l1', time: '09:41:12', level: 'INFO', event: 'scan.completed', detail: 'user #2841 · 6 items recognized · 1.2s' },
  { id: 'l2', time: '09:39:58', level: 'WARN', event: 'scan.low_confidence', detail: "label 'Talong' at 0.61 · queued for review" },
  { id: 'l3', time: '09:38:04', level: 'INFO', event: 'recipe.accepted', detail: 'user #1190 accepted Tinolang Manok' },
  { id: 'l4', time: '09:36:22', level: 'ERROR', event: 'api.timeout', detail: 'POST /v1/vision/detect · 504 after 30s' },
  { id: 'l4b', time: '09:37:10', level: 'INFO', event: 'account.deleted', detail: 'uid 8f21c0a4 · via profile-screen · data removed, record kept' },
  { id: 'l5', time: '09:35:47', level: 'INFO', event: 'inventory.deducted', detail: 'user #2077 cooked Chicken Adobo · 8 items' },
  { id: 'l6', time: '09:33:10', level: 'INFO', event: 'notification.sent', detail: 'expiry reminder · 412 recipients' },
  { id: 'l7', time: '09:31:55', level: 'WARN', event: 'chatbot.fallback', detail: "no intent matched · 'pwede ba i-freeze ang bagoong'" },
  { id: 'l8', time: '09:30:19', level: 'INFO', event: 'user.registered', detail: 'nath.cruz@gmail.com · Android 14' },
  { id: 'l9', time: '09:28:41', level: 'ERROR', event: 'scan.failed', detail: 'image decode error · 0 bytes payload' },
  { id: 'l10', time: '09:27:03', level: 'INFO', event: 'shoppinglist.generated', detail: 'user #1904 · 11 items across 4 categories' },
  { id: 'l11', time: '09:25:36', level: 'DEBUG', event: 'cache.refresh', detail: 'ingredient index rebuilt in 340ms' },
  { id: 'l12', time: '09:24:12', level: 'INFO', event: 'scan.completed', detail: 'user #1663 · 3 items recognized · 0.9s' },
];

export const LOGS_DATE = 'Aug 11, 2026';

export const RANGES: Record<RangeKey, RangeData> = {
  '7d': {
    label: 'last 7 days',
    stats: [
      { label: 'Active users', value: '1,204', delta: '+3.1%', note: 'vs previous 7 days', up: true },
      { label: 'Items scanned', value: '4,102', delta: '+8.4%', note: '586 per day', up: true },
      { label: 'Chatbot messages', value: '1,486', delta: '+5.2%', note: '88% resolved', up: true },
      { label: 'New signups', value: '46', delta: '+4.5%', note: 'accounts created', up: true },
    ],
    chart: [
      { label: 'Mon', v: 540, m: 12 },
      { label: 'Tue', v: 610, m: 15 },
      { label: 'Wed', v: 588, m: 11 },
      { label: 'Thu', v: 702, m: 18 },
      { label: 'Fri', v: 664, m: 14 },
      { label: 'Sat', v: 512, m: 9 },
      { label: 'Sun', v: 486, m: 10 },
    ],
  },
  '30d': {
    label: 'last 30 days',
    stats: [
      { label: 'Active users', value: '2,847', delta: '+12.4%', note: 'of 3,918 accounts', up: true },
      { label: 'Items scanned', value: '18,392', delta: '+9.8%', note: '613 per day', up: true },
      { label: 'Chatbot messages', value: '6,210', delta: '+14.1%', note: '1,204 conversations', up: true },
      { label: 'New signups', value: '184', delta: '+9.5%', note: 'accounts created', up: true },
    ],
    chart: [
      { label: 'W1', v: 3980, m: 14 },
      { label: 'W2', v: 4420, m: 12 },
      { label: 'W3', v: 4610, m: 16 },
      { label: 'W4', v: 5382, m: 11 },
      { label: 'W5', v: 4104, m: 13 },
    ],
  },
  '90d': {
    label: 'last 90 days',
    stats: [
      { label: 'Active users', value: '3,918', delta: '+21.7%', note: '702 new signups', up: true },
      { label: 'Items scanned', value: '52,470', delta: '+18.2%', note: '583 per day', up: true },
      { label: 'Chatbot messages', value: '17,844', delta: '+22.6%', note: '84% resolved', up: true },
      { label: 'New signups', value: '702', delta: '+18.0%', note: 'accounts created', up: true },
    ],
    chart: [
      { label: 'Jun', v: 15980, m: 16 },
      { label: 'Jul', v: 18092, m: 13 },
      { label: 'Aug', v: 18398, m: 11 },
    ],
  },
};

export const OUTCOMES: Outcome[] = [
  { label: 'Recognized first try', pct: '82%', w: 82, color: 'var(--green-primary)' },
  { label: 'Corrected by user', pct: '11%', w: 11, color: 'var(--green-soft)' },
  { label: 'Added manually', pct: '5%', w: 5, color: 'var(--green-pale)' },
  { label: 'Failed / retried', pct: '2%', w: 2, color: 'var(--clay)' },
];

export const HEALTH: HealthRow[] = [
  { label: 'Scans (24h)', value: '612', color: 'var(--green-deep)' },
  { label: 'Items still missing a date', value: '37', color: 'var(--amber)' },
  { label: 'Chat messages (24h)', value: '208', color: 'var(--green-deep)' },
  { label: 'Feedback (7d)', value: '4', color: 'var(--amber)' },
];

export const ACTIVITY: ActivityRow[] = [
  { id: 'a1', text: 'Divina Ocampo scanned 7 items from a grocery photo', time: '4 minutes ago', color: 'var(--green-primary)' },
  { id: 'a2', text: '12 low-confidence detections queued for review', time: '22 minutes ago', color: 'var(--amber)' },
  { id: 'a3', text: 'Expiry reminders sent to 412 users', time: '1 hour ago', color: 'var(--green-deep)' },
  { id: 'a4', text: 'Kaldereta recipe saved as draft by admin', time: '3 hours ago', color: 'var(--ink-muted)' },
  { id: 'a5', text: 'Vision model panzi-vision v2.4 health check passed', time: '5 hours ago', color: 'var(--green-deep)' },
  { id: 'a6', text: 'Nathaniel Cruz registered a new account', time: 'Yesterday', color: 'var(--green-primary)' },
];

export const EXPIRING: ExpiringRow[] = [
  { id: 'e1', name: 'Gatas (Milk)', cat: 'Dairy & Eggs', count: '184', due: '1 day' },
  { id: 'e2', name: 'Manok (Chicken)', cat: 'Meat', count: '132', due: '1 day' },
  { id: 'e3', name: 'Kamatis (Tomato)', cat: 'Produce', count: '97', due: '2 days' },
  { id: 'e4', name: 'Baboy (Pork)', cat: 'Meat', count: '88', due: '2 days' },
  { id: 'e5', name: 'Talong (Eggplant)', cat: 'Produce', count: '61', due: '3 days' },
];

export const CATEGORIES: Category[] = [
  { label: 'Produce', n: 3 },
  { label: 'Meat', n: 2 },
  { label: 'Dairy & Eggs', n: 2 },
  { label: 'Grains', n: 1 },
];

export const ANALYTICS: AnalyticsData = {
  // Same labels the server sends, so the dashboard and this page read them alike.
  stats: [
    { label: 'Items consumed', value: '8,412', note: 'marked used up or cooked' },
    { label: 'Items discarded', value: '1,096', note: 'explicitly marked thrown away' },
    { label: 'Waste rate', value: '11.5%', note: 'by item, of 9,508 confirmed outcomes' },
    { label: 'Waste by amount', value: '9.8%', note: 'counts "some of it" as half an item' },
    { label: 'Unclassified removals', value: '2,310', note: 'excluded from the waste rate' },
  ],
  removals: 11818,
  chart: [
    { label: 'Mar', saved: 58, wasted: 22 },
    { label: 'Apr', saved: 66, wasted: 20 },
    { label: 'May', saved: 71, wasted: 19 },
    { label: 'Jun', saved: 79, wasted: 15 },
    { label: 'Jul', saved: 86, wasted: 13 },
    { label: 'Aug', saved: 92, wasted: 11 },
  ],
  wasted: [
    { name: 'Kamatis (Tomato)', n: '214', w: 100 },
    { name: 'Gatas (Milk)', n: '186', w: 87 },
    { name: 'Talong (Eggplant)', n: '141', w: 66 },
    { name: 'Manok (Chicken)', n: '118', w: 55 },
    { name: 'Tinapay (Bread)', n: '96', w: 45 },
    { name: 'Saging (Banana)', n: '74', w: 35 },
  ],
};







// ---------------------------------------------------------------------------
// Shareable design preview only (VITE_PUBLIC_PREVIEW). Local sample mode keeps
// these queues empty on purpose; a public preview needs something to look at,
// and every name here is invented.

export const PREVIEW_REVIEW: ReviewData = {
  pagination: { page: 1, pageSize: 20, scans: 3, feedback: 2 },
  scans: [
    { id: 's1', user: 'Angelica Reyes', userId: 'u3', at: '22 minutes ago', scene: 'Market bag', items: 6, unresolved: 2, added: 6,
      undated: ['Talong (Eggplant)'], unsure: [{ name: 'Talong', reason: 'Read at 61% confidence from a crumpled label.', alternatives: ['Ampalaya', 'Upo'] }] },
    { id: 's2', user: 'Paolo Mendoza', userId: 'u6', at: '1 hour ago', scene: 'Kitchen shelf', items: 4, unresolved: 1, added: 3,
      undated: [], unsure: [{ name: 'Sardinas', reason: 'Label partly covered; could be tuna.', alternatives: ['Tuna flakes'] }] },
    { id: 's3', user: 'Bea Alvarez', userId: 'u11', at: '2 hours ago', scene: 'Fridge door', items: 5, unresolved: 1, added: 5,
      undated: ['Gatas (Milk)'], unsure: [],
      review: { status: 'in_progress', note: 'Printed 06/2026 was read with the wrong year.', revision: 1, updatedBy: 'Panzi team', updatedAt: new Date(Date.now() - 3600e3).toISOString() } },
  ],
  feedback: [
    { id: 'f1', user: 'Kristine Villanueva', userId: 'u5', email: 'kristine.v@gmail.com', message: 'Nag-suggest ng leche flan pero ubos na yung gatas ko.', platform: 'Android', appVersion: '1.3.2', at: '3 hours ago' },
    { id: 'f2', user: 'Sheena Gutierrez', userId: 'u9', email: 'sheena.g@gmail.com', message: 'The expiry reminder for my milk came a day late.', platform: 'iOS', appVersion: '1.3.2', at: 'Yesterday',
      review: { status: 'new', note: '', revision: 0, updatedBy: null, updatedAt: null } },
  ],
  note: null,
};

export const PREVIEW_CHATS: ChatsResponse = {
  pagination: { page: 1, pageSize: 25, total: 3, asOf: new Date().toISOString() },
  conversations: [
    { id: 'c1', title: 'Can bagoong be frozen?', user: 'Renz Bautista', userId: 'u4', messages: 2, asked: 1, recipes: 0, at: 'Today, 09:31' },
    { id: 'c2', title: 'Using up eggs', user: 'Maricel Santos', userId: 'u1', messages: 4, asked: 2, recipes: 1, at: 'Today, 08:12' },
    { id: 'c3', title: 'How long leftover rice keeps', user: 'Divina Ocampo', userId: 'u7', messages: 2, asked: 1, recipes: 0, at: 'Yesterday' },
  ],
  note: null,
};

export const PREVIEW_TRANSCRIPTS: Record<string, ChatTranscript> = {
  c1: { id: 'c1', title: 'Can bagoong be frozen?', user: 'Renz Bautista', userId: 'u4', truncated: false, messages: [
    { id: 'm1', role: 'user', text: 'pwede ba i-freeze ang bagoong?', recipeTitle: null, at: '09:31' },
    { id: 'm2', role: 'assistant', text: 'I could not find an answer for freezing. Opened bagoong keeps about 6 months in the fridge.', recipeTitle: null, at: '09:31' },
  ] },
  c2: { id: 'c2', title: 'Using up eggs', user: 'Maricel Santos', userId: 'u1', truncated: false, messages: [
    { id: 'm1', role: 'user', text: 'I have 12 eggs expiring in 9 days, what can I cook?', recipeTitle: null, at: '08:12' },
    { id: 'm2', role: 'assistant', text: '', recipeTitle: 'Tortang talong', at: '08:12' },
    { id: 'm3', role: 'user', text: 'does it use my garlic too?', recipeTitle: null, at: '08:13' },
    { id: 'm4', role: 'assistant', text: 'Yes, two cloves of the garlic in your pantry.', recipeTitle: null, at: '08:13' },
  ] },
  c3: { id: 'c3', title: 'How long leftover rice keeps', user: 'Divina Ocampo', userId: 'u7', truncated: false, messages: [
    { id: 'm1', role: 'user', text: 'how long is leftover rice okay', recipeTitle: null, at: '19:40' },
    { id: 'm2', role: 'assistant', text: 'Up to 4 days in the fridge, sealed. Sinangag is a good way to use it up.', recipeTitle: null, at: '19:40' },
  ] },
};
