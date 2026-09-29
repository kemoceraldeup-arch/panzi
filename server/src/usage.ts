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

/**
 * Per-million-token prices, USD, keyed by the model id the routes actually
 * send — `gpt-5.6-luna` for scan/recipes/intent, `gpt-5.6-terra` for chat.
 *
 * Empty on purpose. The table this file used to carry was written for a
 * different provider, and carrying those numbers over to these model ids would
 * have produced dollar figures that look authoritative and are simply wrong.
 * An unpriced model reports its cost as null, which the console renders as an
 * em dash — "we do not know", which is true — rather than as free.
 *
 * Fill it by setting MODEL_PRICE_OVERRIDES to `model:input:output` entries,
 * comma separated, from the current published rate card:
 *
 *   MODEL_PRICE_OVERRIDES=gpt-5.6-luna:0.25:2,gpt-5.6-terra:1.25:10
 *
 * Token counts already recorded re-price themselves the moment that variable
 * lands — nothing needs backfilling.
 */
const PRICES: Record<string, { input: number; output: number }> = {};

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

/** `$0.0651`, or an em dash when the model carries no price. */
export function formatCost(value: number | null): string {
  if (value === null) return '—';
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
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
 * Mongo is connected lazily by whichever route ran first; the scan and recipe
 * routes hold no other state and may never have touched it, so a failure here
 * is entirely expected on a server running without MONGODB_URI. It is logged
 * once and dropped.
 */
export function recordUsage(record: UsageRecord): void {
  void ApiUsage.create({ ok: true, ...record, userId: record.userId ?? 'unknown' }).catch(
    (err: unknown) => {
      console.warn('api_usage write failed', {
        route: record.route,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  );
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
