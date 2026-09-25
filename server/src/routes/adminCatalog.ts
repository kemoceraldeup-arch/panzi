// server/src/routes/adminCatalog.ts
//
// Two screens that are derived rather than stored: the ingredient catalog and
// what the Anthropic key is being spent on.
//
// Mounted inside adminRouter, so it inherits the same gates: requireAuth,
// requireAdmin, the rate limit and the audit record.

import { Router } from 'express';
import { ApiUsage, PantryItem, RecipeRating, SavedRecipe } from '../models';
import { provenanceBucket } from './admin';
import { costOf, formatCost } from '../usage';
import { withDb } from './helpers';

export const adminCatalogRouter = Router();

const DAY_MS = 24 * 60 * 60 * 1000;

const RANGES = {
  '7d': { days: 7, buckets: 7 },
  '30d': { days: 30, buckets: 5 },
  '90d': { days: 90, buckets: 3 },
};

type RangeKey = keyof typeof RANGES;

function rangeFrom(value: unknown): (typeof RANGES)[RangeKey] {
  return RANGES[(value === '7d' || value === '30d' || value === '90d' ? value : '30d') as RangeKey];
}

// ------------------------------------------------------------------ /foods

/**
 * The ingredient catalog, derived rather than curated.
 *
 * The design assumed a catalog table with a shelf life and a recognition
 * accuracy per ingredient. Neither exists: the scanner is open-vocabulary, so
 * there is no class list, and no confidence score is stored anywhere.
 *
 * The pantry itself already knows most of what that screen wanted, though.
 * Group pantry_items by name and you have how many households hold a thing,
 * what date they gave it, and where that date came from — all measured.
 *
 * `dated` replaces the design's "detection accuracy". It is the share of an
 * ingredient's rows carrying a date to act on — printed, typed, or Panzi's own
 * estimate — and the split behind it says which. That is the honest version of
 * the same question — how well does the system handle this food — and unlike
 * an accuracy figure, it is true.
 *
 * `estimates` is the Phase 2 half of it: when Panzi is the one supplying the
 * date, how sure was it? A food where every date is a low-confidence guess is
 * a food whose shelf-life table needs work, and that is not visible from the
 * dated percentage alone.
 */
adminCatalogRouter.get(
  '/foods',
  withDb(async (_req, res) => {
    const rows = (await PantryItem.find({})
      .select({
        name: 1,
        category: 1,
        expiryDate: 1,
        dateSource: 1,
        basis: 1,
        estimatedUseBy: 1,
        estimateInputs: 1,
        expiryUnknown: 1,
        userId: 1,
        createdAt: 1,
      })
      .lean()) as any[];

    interface Bucket {
      name: string;
      users: Set<string>;
      items: number;
      categories: Map<string, number>;
      shelfDays: number[];
      sources: {
        printed: number;
        estimated: number;
        typed: number;
        rough: number;
        unknown: number;
        none: number;
      };
      /** Only over the rows Panzi dated itself — a confidence on anything else
       *  would be reporting how sure we are about a date we did not choose. */
      confidence: { low: number; medium: number; high: number };
    }

    const buckets = new Map<string, Bucket>();

    for (const row of rows) {
      // Keyed case-insensitively: "Chicken breast" and "chicken breast" are one
      // ingredient to a person, and the app lets people type either.
      const key = String(row.name ?? '')
        .trim()
        .toLowerCase();
      if (!key) continue;

      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = {
          name: String(row.name).trim(),
          users: new Set(),
          items: 0,
          categories: new Map(),
          shelfDays: [],
          sources: { printed: 0, estimated: 0, typed: 0, rough: 0, unknown: 0, none: 0 },
          confidence: { low: 0, medium: 0, high: 0 },
        };
        buckets.set(key, bucket);
      }

      bucket.items += 1;
      if (row.userId) bucket.users.add(String(row.userId));

      const category = String(row.category ?? '').trim();
      if (category) {
        bucket.categories.set(category, (bucket.categories.get(category) ?? 0) + 1);
      }

      // One mapping for both vocabularies, shared with the dashboard's own
      // provenance card so the two screens cannot disagree about what a row is.
      bucket.sources[provenanceBucket(row.basis, row.dateSource, row.expiryUnknown)] += 1;

      const confidence = row.estimateInputs?.confidence as 'low' | 'medium' | 'high' | undefined;
      if (confidence === 'low' || confidence === 'medium' || confidence === 'high') {
        bucket.confidence[confidence] += 1;
      }

      // Shelf life as observed: how long this item had left when it was added.
      // Not a property of the food in the abstract, which is why the column says
      // "typical" — it is a median of what people actually recorded.
      //
      // A Panzi estimate counts, on the same one timeline the app sorts by.
      // Excluding them would make this column quietly stop moving for exactly
      // the foods that never carry a printed date — loose produce — which are
      // the ones it is most worth knowing about.
      const dueDate = row.expiryDate ?? row.estimatedUseBy ?? null;
      if (dueDate && row.createdAt) {
        const days = Math.round(
          (new Date(`${dueDate}T00:00:00`).getTime() - new Date(row.createdAt).getTime()) / DAY_MS
        );
        if (Number.isFinite(days) && days >= 0 && days < 3650) bucket.shelfDays.push(days);
      }
    }

    const median = (values: number[]): number | null => {
      if (values.length === 0) return null;
      const sorted = [...values].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
    };

    const foods = [...buckets.entries()]
      .map(([key, bucket]) => {
        const topCategory =
          [...bucket.categories.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Uncategorised';
        const days = median(bucket.shelfDays);
        const pct = (n: number) => (bucket.items === 0 ? 0 : Math.round((n / bucket.items) * 100));

        // "Dated" means "has a date to act on". An item whose owner told us the
        // date is unknown does not, and neither does one nobody has dated yet:
        // both are counted out, and the split below keeps them apart.
        const undated = bucket.sources.none + bucket.sources.unknown;
        const estimatedRows = bucket.confidence.low + bucket.confidence.medium + bucket.confidence.high;
        const confPct = (n: number) =>
          estimatedRows === 0 ? 0 : Math.round((n / estimatedRows) * 100);

        return {
          id: key,
          name: bucket.name,
          cat: topCategory,
          shelf: days === null ? '—' : `${days} day${days === 1 ? '' : 's'}`,
          dated: pct(bucket.items - undated),
          sources: {
            printed: pct(bucket.sources.printed),
            estimated: pct(bucket.sources.estimated),
            typed: pct(bucket.sources.typed),
            rough: pct(bucket.sources.rough),
            unknown: pct(bucket.sources.unknown),
            none: pct(bucket.sources.none),
          },
          // Null rather than a row of zeroes when Panzi has never dated this
          // food: 0% low-confidence would read as "always sure", which is the
          // opposite of "never asked".
          estimates:
            estimatedRows === 0
              ? null
              : {
                  rows: estimatedRows,
                  low: confPct(bucket.confidence.low),
                  medium: confPct(bucket.confidence.medium),
                  high: confPct(bucket.confidence.high),
                },
          pantries: bucket.users.size,
          items: bucket.items,
        };
      })
      .sort((a, b) => b.pantries - a.pantries || b.items - a.items);

    // Categories as the pantry actually uses them, not a fixed list.
    const categories = new Map<string, number>();
    for (const food of foods) {
      categories.set(food.cat, (categories.get(food.cat) ?? 0) + 1);
    }

    res.json({
      foods,
      categories: [...categories.entries()]
        .map(([label, n]) => ({ label, n }))
        .sort((a, b) => b.n - a.n),
      totalItems: rows.length,
      note:
        foods.length === 0
          ? 'No pantry items yet. This screen is built from what people actually store.'
          : null,
    });
  })
);

// ---------------------------------------------------------------- /recipes

/**
 * The dishes, as the people using Panzi have actually treated them.
 *
 * There is no recipe catalog to read. Every dish is written by the model on
 * the night it is suggested, which is why the design's "Published / Draft" and
 * its acceptance rate had nothing behind them — this screen shipped on sample
 * data for exactly that reason. Two collections since gave it something real:
 * saved_recipes is what people kept, and recipe_ratings is what they said
 * after cooking it (the stars on cook mode's complete sheet).
 *
 * Identity is the app's recipe key: the title plus a fingerprint of the
 * ingredient names (src/utils/recipeKey.ts), the same key a save and a rating
 * are stored under. Two different dishes that share a title are therefore two
 * rows here, labelled as versions. Saves and ratings made before the key existed
 * carry only a title, and fall back to it.
 */
adminCatalogRouter.get(
  '/recipes',
  withDb(async (_req, res) => {
    const [saved, ratings] = await Promise.all([
      SavedRecipe.find({}).select({ key: 1, recipe: 1, savedAtMs: 1, userId: 1 }).lean(),
      RecipeRating.find({}).select({ title: 1, key: 1, stars: 1, userId: 1, updatedAt: 1 }).lean(),
    ]);

    interface Dish {
      name: string;
      savers: Set<string>;
      /** Ingredient counts across saved copies — the model writes a slightly
       *  different list each time, so the card shows the median rather than
       *  whichever copy happened to be read last. */
      ingredientCounts: number[];
      dishKeys: Map<string, number>;
      stars: number[];
      raters: Set<string>;
      lastActivity: number;
    }

    const dishes = new Map<string, Dish>();

    const bucketFor = (title: string, recipeKey?: unknown): Dish | null => {
      if (!title.trim()) return null;
      const key = typeof recipeKey === 'string' && recipeKey.includes('~') ? recipeKey : title.trim().toLowerCase();
      let dish = dishes.get(key);
      if (!dish) {
        dish = {
          name: title.trim(),
          savers: new Set(),
          ingredientCounts: [],
          dishKeys: new Map(),
          stars: [],
          raters: new Set(),
          lastActivity: 0,
        };
        dishes.set(key, dish);
      }
      return dish;
    };

    for (const row of saved as any[]) {
      const title = typeof row.recipe?.title === 'string' ? row.recipe.title : '';
      const dish = bucketFor(title, row.key);
      if (!dish) continue;

      if (row.userId) dish.savers.add(String(row.userId));
      if (Array.isArray(row.recipe?.ingredients)) {
        dish.ingredientCounts.push(row.recipe.ingredients.length);
      }
      // 'other' is the app's own "no photo for this one" value, not a dish —
      // counting it would let it win the vote and hide a real key.
      const dishKey = typeof row.recipe?.dishKey === 'string' ? row.recipe.dishKey : '';
      if (dishKey && dishKey !== 'other') {
        dish.dishKeys.set(dishKey, (dish.dishKeys.get(dishKey) ?? 0) + 1);
      }
      if (typeof row.savedAtMs === 'number') {
        dish.lastActivity = Math.max(dish.lastActivity, row.savedAtMs);
      }
    }

    for (const row of ratings as any[]) {
      const dish = bucketFor(typeof row.title === 'string' ? row.title : '', row.key);
      if (!dish) continue;
      if (typeof row.stars === 'number') dish.stars.push(row.stars);
      if (row.userId) dish.raters.add(String(row.userId));
      const at = row.updatedAt ? new Date(row.updatedAt).getTime() : 0;
      if (Number.isFinite(at)) dish.lastActivity = Math.max(dish.lastActivity, at);
    }

    const median = (values: number[]): number | null => {
      if (values.length === 0) return null;
      const sorted = [...values].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
    };

    const rows = [...dishes.entries()]
      .map(([key, dish]) => {
        const topKey = [...dish.dishKeys.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
        const rated = dish.stars.length;
        return {
          id: key,
          name: dish.name,
          ing: median(dish.ingredientCounts) ?? 0,
          saves: dish.savers.size,
          // A rating is only ever given on cook mode's complete sheet, so a
          // rated dish is a cooked dish. That is the whole of what this number
          // claims: not how often it was cooked, but by how many people it was
          // cooked and then rated.
          rated,
          // Null rather than 0 where nobody has rated it — zero stars is a real
          // verdict and this is the absence of one.
          stars: rated === 0 ? null : Math.round((dish.stars.reduce((a, b) => a + b, 0) / rated) * 10) / 10,
          /** Ratings of 4 or 5, as a share of ratings. */
          liked: rated === 0 ? null : Math.round((dish.stars.filter((n) => n >= 4).length / rated) * 100),
          photo: topKey,
          lastAt: dish.lastActivity === 0 ? null : new Date(dish.lastActivity).toISOString(),
        };
      })
      .sort((a, b) => b.rated - a.rated || b.saves - a.saves || a.name.localeCompare(b.name));

    // Label dishes that share a title, most-used first, so the console never
    // shows two identical-looking rows with no way to tell them apart.
    const byTitle = new Map<string, typeof rows>();
    for (const row of rows) {
      const title = row.name.trim().toLowerCase();
      byTitle.set(title, [...(byTitle.get(title) ?? []), row]);
    }
    const labelled = rows.map((row) => {
      const group = byTitle.get(row.name.trim().toLowerCase()) ?? [];
      return group.length > 1 ? { ...row, version: `Version ${group.indexOf(row) + 1} of ${group.length}` } : row;
    });

    res.json({
      recipes: labelled,
      note:
        rows.length === 0
          ? 'No dish has been saved or rated yet. This screen is built from what people kept and what they said after cooking.'
          : null,
    });
  })
);

// ------------------------------------------------------------------ /costs

/**
 * What the Anthropic key is being spent on.
 *
 * HANDOFF.md asks for API cost per scan and warns that every scan and every
 * recipe bills against a real key with no free tier. api_usage holds the
 * tokens; this prices them and groups them the three ways whoever owns the key
 * actually asks: over time, by what spent it, and by whom.
 */
adminCatalogRouter.get(
  '/costs',
  withDb(async (req, res) => {
    const range = rangeFrom(req.query.range);
    const from = new Date(Date.now() - range.days * DAY_MS);

    const rows = (await ApiUsage.find({ createdAt: { $gte: from } }).lean()) as any[];

    const tokensOf = (row: any) => ({
      inputTokens: row.inputTokens ?? 0,
      cacheReadTokens: row.cacheReadTokens ?? 0,
      cacheWriteTokens: row.cacheWriteTokens ?? 0,
      outputTokens: row.outputTokens ?? 0,
    });
    const totalTokens = (row: any) => {
      const t = tokensOf(row);
      return t.inputTokens + t.cacheReadTokens + t.cacheWriteTokens + t.outputTokens;
    };

    let spend = 0;
    let unpriced = 0;
    for (const row of rows) {
      const cost = costOf(row.model, tokensOf(row));
      if (cost === null) unpriced += 1;
      else spend += cost;
    }

    const byRoute = new Map<string, { calls: number; cost: number; tokens: number; ms: number }>();
    for (const row of rows) {
      const entry = byRoute.get(row.route) ?? { calls: 0, cost: 0, tokens: 0, ms: 0 };
      entry.calls += 1;
      entry.cost += costOf(row.model, tokensOf(row)) ?? 0;
      entry.tokens += totalTokens(row);
      entry.ms += row.durationMs ?? 0;
      byRoute.set(row.route, entry);
    }

    const byUser = new Map<string, { calls: number; cost: number }>();
    for (const row of rows) {
      const entry = byUser.get(row.userId) ?? { calls: 0, cost: 0 };
      entry.calls += 1;
      entry.cost += costOf(row.model, tokensOf(row)) ?? 0;
      byUser.set(row.userId, entry);
    }

    // Spend per bucket across the window, oldest first.
    const size = (range.days / range.buckets) * DAY_MS;
    const start = Date.now() - range.days * DAY_MS;
    const buckets = Array.from({ length: range.buckets }, (_, i) => ({
      from: start + i * size,
      cost: 0,
    }));
    for (const row of rows) {
      const index = Math.min(
        buckets.length - 1,
        Math.floor((new Date(row.createdAt).getTime() - start) / size)
      );
      if (index >= 0) buckets[index].cost += costOf(row.model, tokensOf(row)) ?? 0;
    }
    const peak = Math.max(1e-9, ...buckets.map((bucket) => bucket.cost));

    const scanRoute = byRoute.get('scan');
    const recipeRoute = byRoute.get('recipes');

    const allTokens = rows.reduce((sum, row) => sum + totalTokens(row), 0);
    const cacheTokens = rows.reduce((sum, row) => sum + (row.cacheReadTokens ?? 0), 0);

    res.json({
      stats: [
        {
          label: 'Total spend',
          value: formatCost(spend),
          note: `${rows.length.toLocaleString()} calls`,
        },
        {
          label: 'Per scan',
          value: scanRoute ? formatCost(scanRoute.cost / scanRoute.calls) : '—',
          note: scanRoute ? `${scanRoute.calls.toLocaleString()} scans` : 'no scans yet',
        },
        {
          label: 'Per recipe',
          value: recipeRoute ? formatCost(recipeRoute.cost / recipeRoute.calls) : '—',
          note: recipeRoute ? `${recipeRoute.calls.toLocaleString()} generations` : 'none yet',
        },
        {
          // A cache read bills at a tenth of an input token. Zero here on a
          // system that should be caching means the prompt is being paid for at
          // full rate on every single call.
          label: 'Served from cache',
          value: allTokens === 0 ? '—' : `${Math.round((cacheTokens / allTokens) * 100)}%`,
          note: 'of all tokens, billed at a tenth',
        },
      ],
      chart: buckets.map((bucket) => ({
        label: new Date(bucket.from).toLocaleDateString('en-US', {
          month: 'short',
          day: range.buckets > 3 ? 'numeric' : undefined,
        }),
        value: formatCost(bucket.cost),
        pct: Math.round((bucket.cost / peak) * 100),
      })),
      routes: [...byRoute.entries()]
        .map(([route, entry]) => ({
          route,
          calls: entry.calls,
          cost: formatCost(entry.cost),
          tokens: entry.tokens.toLocaleString(),
          avgMs: Math.round(entry.ms / entry.calls),
          pct: spend === 0 ? 0 : Math.round((entry.cost / spend) * 100),
        }))
        .sort((a, b) => b.pct - a.pct),
      users: [...byUser.entries()]
        .map(([userId, entry]) => ({
          userId,
          calls: entry.calls,
          cost: formatCost(entry.cost),
        }))
        .sort((a, b) => b.calls - a.calls)
        .slice(0, 8),
      note:
        rows.length === 0
          ? 'No model calls recorded yet. This fills the next time someone scans, cooks or chats.'
          : unpriced > 0
            ? `${unpriced} call(s) ran on a model with no price in usage.ts and are excluded from these totals.`
            : null,
    });
  })
);
