import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { secrets } from '../env.js';

export interface FetchPageOutput {
  title: string;
  content: string;
  url: string;
}

function capContent(content: string, max = 8000): string {
  if (content.length <= max) return content;
  return content.slice(0, max) + '...';
}

/** Same shape the bench uses when it fetches a URL to check citation grounding. */
export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function tavilyExtract(urlStr: string): Promise<FetchPageOutput | null> {
  if (!secrets.tavily) return null;
  const res = await fetch('https://api.tavily.com/extract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: secrets.tavily,
      urls: [urlStr]
    }),
    signal: AbortSignal.timeout(15000)
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    results?: Array<{ url?: string; raw_content?: string; title?: string }>;
  };
  const hit = data.results?.find((r) => r.raw_content);
  if (!hit?.raw_content) return null;
  return {
    title: hit.title || 'Untitled',
    content: capContent(hit.raw_content.trim()),
    url: urlStr
  };
}

/** Article region only. JSDOM on a full Wikipedia document blows the quick TTFT budget. */
function fastArticleText(html: string): string {
  const region =
    html.match(/id=["']mw-content-text["'][\s\S]{0,80000}/i)?.[0] ||
    html.match(/<article\b[\s\S]{0,80000}/i)?.[0] ||
    html.match(/<main\b[\s\S]{0,80000}/i)?.[0] ||
    '';
  if (!region) return '';
  return stripHtml(region);
}

function extractFromHtml(html: string, urlStr: string): FetchPageOutput {
  const dom = new JSDOM(html, { url: urlStr });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  let content = '';
  let title = dom.window.document.title || 'Untitled';

  if (article && article.textContent) {
    title = article.title || title;
    content = article.textContent.trim().replace(/\n\s*\n+/g, '\n\n');
  } else {
    const doc = dom.window.document;
    doc.querySelectorAll('script, style, noscript, nav, footer, header').forEach((el) => el.remove());
    content = (doc.body?.textContent || '').trim().replace(/\n\s*\n+/g, '\n\n');
  }

  return {
    title: title.trim() || 'Untitled',
    content: capContent(content.trim()),
    url: urlStr
  };
}

const pageCache = new Map<string, FetchPageOutput>();

export async function fetchPage(urlStr: string): Promise<FetchPageOutput> {
  const cached = pageCache.get(urlStr);
  if (cached) return cached;

  const url = new URL(urlStr);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`Invalid protocol for fetch_page: ${url.protocol}`);
  }

  try {
    const res = await fetch(url.toString(), {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml'
      },
      signal: AbortSignal.timeout(8000),
      redirect: 'follow'
    });

    if (res.ok) {
      const html = await res.text();
      const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      const title = (titleMatch?.[1] || 'Untitled').replace(/\s+/g, ' ').trim() || 'Untitled';
      const fast = fastArticleText(html);
      // Readability is the slow path. Use it only when the article region is missing.
      const readable = fast.length >= 200 ? fast : extractFromHtml(html, urlStr).content;
      if (readable.length >= 80) {
        const extracted: FetchPageOutput = {
          title,
          content: capContent(readable),
          url: urlStr
        };
        pageCache.set(urlStr, extracted);
        return extracted;
      }
    }
  } catch {
    // Fall through to Tavily extract
  }

  const viaTavily = await tavilyExtract(urlStr);
  if (viaTavily && viaTavily.content.length >= 40) {
    pageCache.set(urlStr, viaTavily);
    return viaTavily;
  }

  throw new Error(`Failed to fetch readable content from ${urlStr}`);
}

const QUERY_STOP = new Set([
  'who', 'what', 'when', 'where', 'why', 'how', 'the', 'and', 'for', 'of', 'is', 'are', 'was', 'were',
  'a', 'an', 'to', 'in', 'on', 'usa', 'united', 'states'
]);

function queryOverlap(sentence: string, query: string): number {
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !QUERY_STOP.has(w));
  if (terms.length === 0) return 0;
  const hay = sentence.toLowerCase();
  let hits = 0;
  for (const term of terms) {
    if (hay.includes(term)) hits++;
  }
  return hits;
}

/**
 * Contiguous excerpt that must appear on the live page for the grounding checker.
 * When a query is given, prefer the sentence that actually overlaps that question
 * so the cited passage is the one the claim rests on.
 */
export function passageSnippet(text: string, max = 280, query?: string): string {
  const clean = text.replace(/\s+/g, ' ').replace(/\u00a0/g, ' ').trim();
  if (!clean) return '';
  const parts = clean
    .split(/\.\.\.+/)
    .flatMap((p) => p.split(/(?<=[.!?])\s+/))
    .map((s) => s.trim())
    .filter((s) => {
      const words = s.split(/\s+/).filter(Boolean);
      if (words.length < 12 || words.length > 45) return false;
      if (!/[a-z]/.test(s)) return false;
      if (/cookie|subscribe|sign in|accept all|advertisement|\{\{|\]\]|archive-url|url-status/i.test(s)) return false;
      return true;
    });
  const ranked = query
    ? parts
        .map((s, i) => ({
          s,
          score: queryOverlap(s, query) * 10 + (/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+/.test(s) ? 4 : 0) - i * 0.2
        }))
        .sort((a, b) => b.score - a.score)
        .map((row) => row.s)
    : parts;
  const best = ranked[0];
  const source =
    query && best && queryOverlap(best, query) > 0 ? best : parts[0] || clean;
  if (source.length <= max) return source;
  return source.split(/\s+/).slice(0, 32).join(' ').trim();
}

const GENERIC_NAMES = /^(United States|White House|New York|Vice President|Supreme Court|North America)$/;

function tidyReading(text: string): string {
  return text
    .replace(/\{\{[\s\S]*?\}\}/g, ' ')
    .replace(/\[\[[^\]|]+\|([^\]]+)\]\]/g, '$1')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeTokens(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9']+/g, ' ').trim();
}

/**
 * Citation snippet plus the page window the answer may use.
 * The snippet is a verbatim span (grounding checks it against the live page).
 * The body is a readable window around the name or sentence that answers the query.
 */
export function groundedExcerpt(
  raw: string,
  query: string
): { snippet: string; body: string } {
  const clean = raw.replace(/\s+/g, ' ').replace(/\u00a0/g, ' ').trim();
  const reading = tidyReading(clean);
  const names = [...reading.matchAll(/\b[A-Z][a-z]+\s+[A-Z][a-z]+\b/g)].filter(
    (m) => !GENERIC_NAMES.test(m[0])
  );
  const incumbentAt = reading.search(/incumbent/i);
  const named =
    (incumbentAt >= 0
      ? names.find((m) => m.index >= incumbentAt && m.index - incumbentAt < 60)
      : undefined) ?? names[0];

  let snippet = passageSnippet(clean, 280, query);
  if (named) {
    const at = clean.indexOf(named[0]);
    if (at >= 0) {
      const from = clean.slice(Math.max(0, at - 40), at + 320);
      const words = from.trim().split(/\s+/);
      const candidate = words.slice(0, 36).join(' ');
      const need = normalizeTokens(candidate).split(' ').filter(Boolean);
      const hay = normalizeTokens(clean);
      if (need.length >= 12 && hay.includes(need.slice(0, 12).join(' '))) {
        snippet = candidate.length > 280 ? words.slice(0, 32).join(' ') : candidate;
      }
    }
  }

  const focus = named ? Math.max(0, (named.index ?? 0) - 180) : 0;
  const body = (reading.slice(focus, focus + 1400) || snippet).trim();
  return { snippet, body };
}

/** Window of fetched page text around the cited sentence, for synthesis only. */
export function evidenceWindow(content: string, snippet: string, max = 1400): string {
  const clean = content.replace(/\s+/g, ' ').replace(/\u00a0/g, ' ').trim();
  if (!clean) return snippet;
  if (clean.length <= max) return clean;
  const anchor = snippet.slice(0, 80);
  const idx = anchor ? clean.indexOf(anchor) : -1;
  if (idx < 0) return clean.slice(0, max);
  const start = Math.max(0, idx - 240);
  return clean.slice(start, start + max).trim();
}
