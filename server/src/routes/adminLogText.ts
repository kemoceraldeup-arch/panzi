// server/src/routes/adminLogText.ts
//
// The words System logs shows. The collections behind that screen record
// what a machine needs — a method, a path, a status code, a model id — and a
// person scrolling the log needs a sentence: "Looked at Maria's pantry". This
// file is the translation, kept apart from the query so it can be tested
// without a database.

const RANGE_WORDS: Record<string, string> = {
  '7d': 'last 7 days',
  '30d': 'last 30 days',
  '90d': 'last 90 days',
};

const FEEDBACK_FILTERS: Record<string, string> = {
  open: 'open messages',
  new: 'new messages',
  in_progress: 'messages in progress',
  resolved: 'resolved messages',
  all: 'all messages',
};

/** Pages of the console, by the admin API path that loads them. */
const PAGES: Record<string, string> = {
  '/dashboard': 'Viewed the dashboard',
  '/analytics': 'Viewed food outcomes',
  '/costs': 'Viewed API costs',
  '/logs': 'Viewed system logs',
  '/alerts': 'Checked AI alerts',
  '/feedback': 'Viewed feedback',
  '/review': 'Viewed the review queue',
  '/users': 'Viewed the user list',
  '/foods': 'Viewed the pantry overview',
  '/recipes': 'Viewed recipes',
  '/admins': 'Viewed admin accounts',
  '/config': 'Viewed app configuration',
  '/chats': 'Viewed the chat list',
};

/** "Maria's", or "an account's" when the name is unknown. */
function whose(name: string | null): string {
  if (!name) return "an account's";
  return name.endsWith('s') ? `${name}'` : `${name}'s`;
}

/**
 * One admin request as a sentence. `targetName` is the person the request was
 * about, when it was about one person.
 */
export function describeAdminRequest(method: string, fullPath: string, status: number, targetName: string | null): string {
  const url = new URL(fullPath, 'http://x');
  const path = url.pathname.replace(/^\/api\/admin/, '').replace(/\/+$/, '') || '/';
  const query = url.searchParams;

  let action: string;
  const person = /^\/users\/[^/]+(\/(pantry|activity))?$/.exec(path);
  const review = /^\/review\/(scans|feedback)\/[^/]+$/.exec(path);
  if (person) {
    action = person[2] === 'pantry' ? `Looked at ${whose(targetName)} pantry`
      : person[2] === 'activity' ? `Looked at ${whose(targetName)} activity`
        : targetName ? `Opened ${whose(targetName)} account` : 'Opened an account';
  } else if (review && method !== 'GET') {
    action = review[1] === 'feedback' ? 'Updated a feedback message' : 'Updated a scan review';
  } else if (/^\/chats\/[^/]+$/.test(path)) {
    action = `Read ${whose(targetName)} chat`;
  } else if (PAGES[path] && method === 'GET') {
    action = PAGES[path];
    const extras: string[] = [];
    const range = query.get('range');
    if (range && RANGE_WORDS[range]) extras.push(RANGE_WORDS[range]);
    if (path === '/feedback') extras.push(FEEDBACK_FILTERS[query.get('status') ?? 'open'] ?? 'filtered');
    const page = Number(query.get('page') ?? 1);
    if (page > 1) extras.push(`page ${page}`);
    const q = query.get('q');
    if (q) extras.push(`searched “${q}”`);
    if (extras.length) action += ` (${extras.join(', ')})`;
  } else {
    action = `${method} ${path}`;
  }

  if (status === 401 || status === 403) return `Access denied: ${lowerFirst(action)}`;
  if (status >= 500) return `Failed: ${lowerFirst(action)}`;
  if (status >= 400) return `Rejected: ${lowerFirst(action)}`;
  return action;
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/** What each recorded AI call was for, in the app's own words. */
const AI_FEATURES: Record<string, string> = {
  scan: 'Scanned groceries',
  'scan-measure': 'Measured how full a container is',
  'recipes.featured': "Suggested tonight's recipe",
  'recipes.alternates': 'Suggested other recipes',
  'recipes.browse': 'Suggested recipes to browse',
  chat: 'Answered a chat message',
  intent: 'Understood a chat request',
};

export function describeAiRequest(route: string, ok: boolean): string {
  const feature = AI_FEATURES[route] ?? `Used AI for ${route}`;
  return ok ? feature : `Failed: ${lowerFirst(feature)}`;
}

/** 'claude-opus-5' → 'Claude Opus 5'. Unknown shapes come back unchanged. */
export function modelName(model: string): string {
  const match = /^claude-([a-z]+)-(\d+(?:-\d+)?)/i.exec(model ?? '');
  if (!match) return model || 'Unknown model';
  return `Claude ${match[1].charAt(0).toUpperCase()}${match[1].slice(1)} ${match[2].replace('-', '.')}`;
}

export const DELETION_SOURCES: Record<string, string> = {
  'profile-screen': 'from Profile in the app',
};
