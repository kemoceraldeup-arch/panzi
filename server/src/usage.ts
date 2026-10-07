// server/src/usage.ts
//
// What each model call cost, written down.
//
// Every model call in this server already computed these numbers and threw them
// away into stdout — see the "Scan complete" and "Chat reply" console lines.
// HANDOFF.md lists "API cost per scan" as an admin feature, and this is the
// whole of what was missing: somewhere to put them.
//
// Two rules run through this file.
//
// First, recording never fails a request. A scan that worked must not turn into
// a 500 because the usage collection was unreachable — the user's food is the
// point, the accounting is not. Every write here is fire-and-forget and
// swallows its own errors.
//
// Second, tokens are stored and dollars are derived. Prices change; a stored
// cost silently becomes a lie the next time they do, while a stored token count
// stays true forever and can be re-priced.

import { ApiUsage } from './models';
import { connectMongo } from './mongo';

/**
 * Per-million-token prices, USD, keyed by the model id the routes actually
 * send — `gpt-5.6-luna` for scan/recipes/intent, `gpt-5.6-terra` for chat and
 * the fill-level pass, `gpt-image-1` for generated dish photos.
 *
 * OpenAI's standard (non-batch, short-context) rates as of 2026-10-07, after
 * the 2026-07-30 price cut. Long-context requests bill higher; this app's
 * prompts are short, so those rates are left out.
 *
 * Prices change. Override any of them without a code change by setting
 * MODEL_PRICE_OVERRIDES to `model:input:output` entries, comma separated:
 *
 *   MODEL_PRICE_OVERRIDES=gpt-5.6-luna:0.25:2,gpt-5.6-terra:1.25:10
 *
 * Token counts already recorded re-price themselves the moment a price
 * changes — nothing needs backfilling. A model missing from both reports its
 * cost as null, which the console shows as "Not priced" rather than as free.
 */
const PRICES: Record<string, { input: number; output: number }> = {
  'gpt-5.6-luna': { input: 0.2, output: 1.2 },
  'gpt-5.6-terra': { input: 2, output: 12 },
  // Text prompt in, image tokens out. A 1024px medium photo is a few thousand
  // output tokens, roughly $0.04 (about ₱2.60) each.
  'gpt-image-1': { input: 5, output: 40 },
};

/**
 * Pesos per US dollar, for display only. OpenAI bills in dollars, so every
 * figure is computed in dollars and converted on the way out. Set PHP_PER_USD
 * in .env to follow the current rate; the default is the mid-market rate on
 * 2026-10-07.
 */
const DEFAULT_PHP_PER_USD = 62.75;

export function phpPerUsd(): number {
  const rate = Number(process.env.PHP_PER_USD);
  return Number.isFinite(rate) && rate > 0 ? rate : DEFAULT_PHP_PER_USD;
}

/**
 * A cached prompt token bills at a fraction of a fresh one. OpenAI's automatic
 * prompt caching charges no separate write fee — the discount is on the read —
 * so there is one multiplier here where the Anthropic-shaped version of this
 * file needed two.
 */
const CACHE_READ_MULTIPLIER = 0.1;

function priceFor(model: string): { input: number; output: number } | null {
  const override = process.env.MODEL_PRICE_OVERRIDES;
  if (override) {
    for (const entry of override.split(',')) {
      const [name, input, output] = entry.split(':').map((part) => part.trim());
      if (name === model && input && output) {
        return { input: Number(input), output: Number(output) };
      }
    }
  }
  return PRICES[model] ?? null;
}

export interface TokenCounts {
  /** The uncached remainder of the prompt, never the whole of it. */
  inputTokens: number;
  cacheReadTokens: number;
  /** Kept for the stored shape's sake; no provider in use bills a cache write. */
  cacheWriteTokens: number;
  outputTokens: number;
}

/**
 * USD for one call, or null when the model's price is unknown.
 *
 * Null rather than zero on purpose: an unpriced model is "we do not know what
 * this cost", and folding it in as free would quietly understate every total
 * that contains it.
 */
export function costOf(model: string, tokens: TokenCounts): number | null {
  const price = priceFor(model);
  if (!price) return null;

  const perToken = price.input / 1_000_000;
  return (
    tokens.inputTokens * perToken +
    tokens.cacheWriteTokens * perToken +
    tokens.cacheReadTokens * perToken * CACHE_READ_MULTIPLIER +
    (tokens.outputTokens * price.output) / 1_000_000
  );
}

/**
 * A dollar cost shown in pesos — `₱4.09`, `₱0.0125` for a fraction of a
 * centavo, `₱1,250.00` — or an em dash when the model carries no price.
 */
export function formatCost(valueUsd: number | null): string {
  if (valueUsd === null) return '—';
  const php = valueUsd * phpPerUsd();
  if (php > 0 && php < 0.01) return `₱${php.toFixed(4)}`;
  return `₱${php.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * What one scan costs on average. The fill-level pass ('scan-measure') is a
 * second call made for some scans, so its spend is added in but its calls are
 * not — the divisor is scans, not requests. Null before the first scan.
 */
export function perScanCost(byRoute: Map<string, { calls: number; cost: number }>): number | null {
  const scan = byRoute.get('scan');
  if (!scan || scan.calls === 0) return null;
  return (scan.cost + (byRoute.get('scan-measure')?.cost ?? 0)) / scan.calls;
}

export interface UsageRecord extends TokenCounts {
  /**
   * `req.uid` is optional in the Express types even though requireAuth has
   * already guaranteed it on every route that spends money. Accepting undefined
   * here keeps non-null assertions out of the app's own route files; a row that
   * somehow arrives without one is still a real cost and is filed under
   * 'unknown' rather than dropped.
   */
  userId: string | undefined;
  /** The route that spent it: 'scan', 'recipes', 'chat', 'intent'. */
  route: string;
  model: string;
  durationMs: number;
  ok?: boolean;
}

/**
 * Write one usage row. Never throws, never awaited by a route.
 *
 * Mongo is connected lazily by whichever route ran first, and the scan and
 * recipe routes never connect it themselves. Writing without connecting first
 * left the row waiting on a connection nothing had opened, and it was dropped
 * when that wait timed out — which is how the cost page stayed empty. So this
 * connects first. A failure (no MONGODB_URI, cluster asleep) is still logged
 * and dropped.
 */
export function recordUsage(record: UsageRecord): void {
  void connectMongo()
    .then(() => ApiUsage.create({ ok: true, ...record, userId: record.userId ?? 'unknown' }))
    .catch((err: unknown) => {
      console.warn('api_usage write failed', {
        route: record.route,
        message: err instanceof Error ? err.message : String(err),
      });
    });
}

/**
 * Pulls the counts out of an image generation's `usage` block, which names
 * its fields differently from a chat completion (input_tokens/output_tokens).
 */
export function imageTokensFrom(usage: {
  input_tokens?: number | null;
  output_tokens?: number | null;
} | null | undefined): TokenCounts {
  return {
    inputTokens: usage?.input_tokens ?? 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: usage?.output_tokens ?? 0,
  };
}

/** Recipe calls are recorded per step ('recipes.featured', 'recipes.alternates',
 *  …). The Per recipe figure wants them together. */
export function recipeRoutes<T extends { calls: number; cost: number }>(
  byRoute: Map<string, T>
): { calls: number; cost: number } | null {
  let calls = 0;
  let cost = 0;
  for (const [route, entry] of byRoute) {
    if (route === 'recipes' || route.startsWith('recipes.')) {
      calls += entry.calls;
      cost += entry.cost;
    }
  }
  return calls ? { calls, cost } : null;
}

/**
 * Pulls the counts out of an OpenAI chat completion's `usage` block.
 *
 * `prompt_tokens` there is the WHOLE prompt, cached part included, which is the
 * opposite of what this collection stores — api_usage keeps the uncached
 * remainder so that the three input figures add up to the prompt rather than
 * double-counting it. Hence the subtraction, clamped at zero in case a response
 * ever reports more cached tokens than prompt tokens.
 */
export function tokensFrom(usage: {
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  prompt_tokens_details?: { cached_tokens?: number | null } | null;
} | null | undefined): TokenCounts {
  const prompt = usage?.prompt_tokens ?? 0;
  const cached = usage?.prompt_tokens_details?.cached_tokens ?? 0;
  return {
    inputTokens: Math.max(0, prompt - cached),
    cacheReadTokens: cached,
    cacheWriteTokens: 0,
    outputTokens: usage?.completion_tokens ?? 0,
  };
}
