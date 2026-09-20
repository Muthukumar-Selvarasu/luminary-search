import { env, secrets } from '../env.js';
import {
  getCachedSearch,
  setCachedSearch,
  type SearchResultItem
} from './searchCache.js';

export interface WebSearchHit extends SearchResultItem {
  rawContent?: string;
}

export interface WebSearchOutput {
  results: WebSearchHit[];
  cached: boolean;
}

const TIME_SENSITIVE = /\b(today|tonight|latest|breaking|this (week|month|year)|live|current)\b|\b(20(2[4-9]|[3-9]\d))\b/i;

export function isTimeSensitiveQuery(query: string): boolean {
  return TIME_SENSITIVE.test(query);
}

export async function webSearch(query: string): Promise<WebSearchOutput> {
  const provider = env.searchProvider;
  const skipCache = isTimeSensitiveQuery(query);

  if (!skipCache) {
    const cached = await getCachedSearch(query, provider);
    if (cached) {
      return { results: cached, cached: true };
    }
  }

  let results: WebSearchHit[] = [];

  if (provider === 'tavily') {
    if (!secrets.tavily) {
      throw new Error('TAVILY_API_KEY is not set in environment');
    }

    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: secrets.tavily,
        query,
        search_depth: 'basic',
        max_results: 3,
        include_raw_content: false
      }),
      signal: AbortSignal.timeout(15000)
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Tavily search failed (${res.status}): ${errText}`);
    }

    const data = (await res.json()) as {
      results?: Array<{ title?: string; url?: string; content?: string; raw_content?: string | null }>;
    };

    results = (data.results ?? [])
      .filter((r) => r.url)
      .map((r) => ({
        title: r.title || 'Untitled',
        url: r.url || '',
        snippet: r.content || '',
        rawContent: r.raw_content ? String(r.raw_content).trim() : undefined
      }));
  } else if (provider === 'serpapi') {
    if (!secrets.serpapi) {
      throw new Error('SERPAPI_API_KEY is not set in environment');
    }

    const url = new URL('https://serpapi.com/search.json');
    url.searchParams.set('q', query);
    url.searchParams.set('api_key', secrets.serpapi);
    url.searchParams.set('engine', 'google');

    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`SerpAPI search failed (${res.status}): ${errText}`);
    }

    const data = (await res.json()) as {
      organic_results?: Array<{ title?: string; link?: string; snippet?: string }>;
    };

    results = (data.organic_results ?? [])
      .filter((r) => r.link)
      .map((r) => ({
        title: r.title || 'Untitled',
        url: r.link || '',
        snippet: r.snippet || ''
      }));
  } else {
    throw new Error(`Unsupported search provider: ${provider}`);
  }

  if (!skipCache) {
    await setCachedSearch(
      query,
      provider,
      results.map(({ title, url, snippet }) => ({ title, url, snippet }))
    );
  }

  return { results, cached: false };
}
