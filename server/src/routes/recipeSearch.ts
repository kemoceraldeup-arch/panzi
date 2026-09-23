// server/src/routes/recipeSearch.ts
//
// Live web search for "what's trending right now" questions — the one kind of
// recipe question a model's own training data can never answer honestly,
// because a viral TikTok recipe from this month didn't exist the last time
// any model was trained. chat.ts calls this only when panziIntent classifies
// a message as trending_recipe; every ordinary recipe question still answers
// from the model alone, the same as before.
//
// Provider is Serper (serper.dev, Google results via a simple REST API),
// reached with a bare fetch() — the same convention routes/nutrition.ts
// already uses for FatSecret, so no new HTTP dependency. The provider is
// deliberately behind one function so swapping it later (Brave, Tavily,
// SerpAPI, Bing, whatever) means rewriting this file only — nothing in
// chat.ts knows or cares which search API answered it.

const SERPER_ENDPOINT = 'https://google.serper.dev/search';
// There is no value in asking for more than a handful of results to hand to
// the model as source material.
const RESULT_COUNT = 6;

export type SearchResult = {
  title: string;
  snippet: string;
  url: string;
};

export type SearchOutcome = { results: SearchResult[] } | { unavailable: true };

/**
 * Live search for a trending/viral food topic. Never fabricates a result:
 * with no API key configured, or on any request failure, this returns
 * `{ unavailable: true }` rather than anything that could be mistaken for a
 * real search result — chat.ts is expected to tell the user plainly that
 * live trend information isn't available right now rather than let the model
 * guess at what's "trending" from stale training data.
 */
export async function searchTrendingRecipes(topic: string): Promise<SearchOutcome> {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) return { unavailable: true };

  const year = new Date().getFullYear();
  const query = `trending viral recipe ${topic} ${year}`;

  let response: Response;
  try {
    response = await fetch(SERPER_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': apiKey,
      },
      body: JSON.stringify({ q: query, num: RESULT_COUNT }),
    });
  } catch (err: any) {
    console.error('Trending recipe search failed to reach Serper', { message: err?.message });
    return { unavailable: true };
  }

  if (!response.ok) {
    console.error('Trending recipe search returned an error status', { status: response.status });
    return { unavailable: true };
  }

  let body: any;
  try {
    body = await response.json();
  } catch (err: any) {
    console.error('Trending recipe search response was not valid JSON', { message: err?.message });
    return { unavailable: true };
  }

  const rawResults = Array.isArray(body?.organic) ? body.organic : [];
  const results: SearchResult[] = rawResults
    .map((entry: any) => ({
      title: typeof entry?.title === 'string' ? entry.title.trim() : '',
      snippet: typeof entry?.snippet === 'string' ? entry.snippet.trim() : '',
      url: typeof entry?.link === 'string' ? entry.link.trim() : '',
    }))
    .filter((entry: SearchResult) => entry.title.length > 0 && entry.url.length > 0)
    .slice(0, RESULT_COUNT);

  if (results.length === 0) return { unavailable: true };

  return { results };
}
