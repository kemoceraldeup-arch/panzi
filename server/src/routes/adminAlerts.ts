import { Router } from 'express';
import { ApiUsage } from '../models';
import { costOf, formatCost } from '../usage';
import { withDb } from './helpers';

export const adminAlertsRouter = Router();
adminAlertsRouter.get('/alerts', withDb(async (_req, res) => {
  const now = Date.now();
  const today = new Date(now - 86400000);
  const rows = await ApiUsage.find({ createdAt: { $gte: new Date(now - 2 * 86400000), $lte: new Date(now) } })
    .select({ createdAt: 1, ok: 1, durationMs: 1, model: 1, inputTokens: 1, outputTokens: 1, cacheReadTokens: 1, cacheWriteTokens: 1 }).lean();
  const current = rows.filter((row: any) => row.createdAt >= today);
  const previous = rows.length - current.length;
  const failed = current.filter((row: any) => row.ok === false).length;
  const slow = current.filter((row: any) => row.durationMs > 10000).length;
  let spend = 0, unpriced = 0;
  for (const row of current as any[]) {
    const cost = costOf(row.model, { inputTokens: row.inputTokens ?? 0, outputTokens: row.outputTokens ?? 0, cacheReadTokens: row.cacheReadTokens ?? 0, cacheWriteTokens: row.cacheWriteTokens ?? 0 });
    if (cost === null || !Number.isFinite(cost)) unpriced++; else spend += cost;
  }
  const alerts: { id: string; title: string; detail: string; href: string; action: string; severity: 'warning' | 'error' }[] = [];
  if (failed >= 3) alerts.push({ id: 'failures', title: 'Repeated AI request failures', detail: `${failed} of ${current.length} recorded requests failed in the last 24 hours.`, href: '/logs?level=ERROR&range=7d&q=api.', action: 'Review failures', severity: 'error' });
  if (slow >= 3) alerts.push({ id: 'slow', title: 'Slow AI responses', detail: `${slow} requests took more than 10 seconds in the last 24 hours.`, href: '/logs?range=7d&q=api.', action: 'Review requests', severity: 'warning' });
  if (previous >= 10 && current.length >= 30 && current.length >= previous * 2) alerts.push({ id: 'usage', title: 'AI usage increased', detail: `${current.length} requests in the last 24 hours, compared with ${previous} in the preceding 24 hours.`, href: '/costs', action: 'View API costs', severity: 'warning' });
  const budget = Number(process.env.ADMIN_DAILY_BUDGET_USD);
  if (Number.isFinite(budget) && budget > 0 && spend >= budget) alerts.push({ id: 'budget', title: 'Daily AI budget reached', detail: `${formatCost(spend)} estimated in the last 24 hours against a ${formatCost(budget)} budget.`, href: '/costs', action: 'View API costs', severity: 'warning' });
  if (unpriced) alerts.push({ id: 'unpriced', title: 'Some requests have no cost estimate', detail: `${unpriced} requests could not be priced and are excluded from spending totals.`, href: '/costs', action: 'Review costs', severity: 'warning' });
  res.json({ alerts, checkedAt: new Date(now).toISOString(), note: current.length ? 'Based on recorded AI requests in the last 24 hours. Alerts clear when the condition no longer applies.' : 'No AI requests recorded in the last 24 hours.' });
}));
