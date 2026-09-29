export const PAGE_SIZE = 25;
export interface BrowseOptions { page: number; q: string; range: string; asOf: Date; from?: Date }

export function browseOptions(query: Record<string, unknown>): BrowseOptions | null {
  const page = Number(query.page ?? 1);
  const q = query.q ?? '';
  const range = query.range ?? 'all';
  const asOf = query.before === undefined ? new Date() : typeof query.before === 'string' ? new Date(query.before) : new Date(NaN);
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000 || typeof q !== 'string' || q.length > 120 || !['all', '7d', '30d', '90d'].includes(String(range)) || typeof range !== 'string' || !Number.isFinite(asOf.getTime()) || asOf.getTime() > Date.now() + 60000) return null;
  return { page, q: q.trim(), range, asOf, ...(range === 'all' ? {} : { from: new Date(asOf.getTime() - Number(range.slice(0, -1)) * 86400000) }) };
}
export function dateWindow(options: BrowseOptions) {
  return { $lte: options.asOf, ...(options.from ? { $gte: options.from } : {}) };
}
export function literalSearch(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
export function pageMetadata(options: BrowseOptions, total: number) {
  return { page: options.page, pageSize: PAGE_SIZE, total, asOf: options.asOf.toISOString() };
}
