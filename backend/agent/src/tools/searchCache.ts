import { createHash } from 'node:crypto';
import { db } from '../db.js';
import { env } from '../env.js';

export interface SearchResultItem {
  title: string;
  url: string;
  snippet: string;
}

export interface CachedSearch {
  key: string;
  query: string;
  provider: string;
  results: SearchResultItem[];
  createdAt: Date;
  expiresAt: Date;
}

// In-process LRU cache (tier 1)
class MemoryLRU<K, V> {
  private cache = new Map<K, V>();
  constructor(private maxEntries = 500) {}

  get(key: K): V | undefined {
    const val = this.cache.get(key);
    if (val !== undefined) {
      // refresh order
      this.cache.delete(key);
      this.cache.set(key, val);
    }
    return val;
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxEntries) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }
}

const memoryLru = new MemoryLRU<string, SearchResultItem[]>(500);

export function normalizeQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function computeSearchCacheKey(query: string, provider: string): string {
  const norm = normalizeQuery(query);
  return createHash('sha256').update(`${norm}:${provider}`).digest('hex');
}

export async function getCachedSearch(query: string, provider: string): Promise<SearchResultItem[] | null> {
  const key = computeSearchCacheKey(query, provider);

  // Tier 1: In-memory LRU
  const memHit = memoryLru.get(key);
  if (memHit) {
    return memHit;
  }

  // Tier 2: MongoDB searchCache collection
  try {
    const database = await db();
    const doc = await database.collection<CachedSearch>('searchCache').findOne({
      key,
      expiresAt: { $gt: new Date() }
    });
    if (doc?.results) {
      memoryLru.set(key, doc.results);
      return doc.results;
    }
  } catch {
    // If DB is unreachable, fail safe to provider
  }

  return null;
}

export async function setCachedSearch(query: string, provider: string, results: SearchResultItem[]): Promise<void> {
  const key = computeSearchCacheKey(query, provider);

  // Set Tier 1
  memoryLru.set(key, results);

  // Set Tier 2
  try {
    const database = await db();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + env.searchCacheTtlSeconds * 1000);
    await database.collection<CachedSearch>('searchCache').updateOne(
      { key },
      {
        $set: {
          key,
          query: normalizeQuery(query),
          provider,
          results,
          createdAt: now,
          expiresAt
        }
      },
      { upsert: true }
    );
  } catch {
    // Ignore cache persistence errors
  }
}
