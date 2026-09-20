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
      const stripped = stripHtml(html);
      const readable = stripped.length >= 80 ? stripped : extractFromHtml(html, urlStr).content;
      if (readable.length >= 80) {
        const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        const extracted: FetchPageOutput = {
          title: (titleMatch?.[1] || 'Untitled').replace(/\s+/g, ' ').trim() || 'Untitled',
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

/** Contiguous excerpt that must appear on the live page for the grounding checker. */
export function passageSnippet(text: string, max = 280): string {
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
      if (/cookie|subscribe|sign in|accept all|advertisement/i.test(s)) return false;
      return true;
    });
  const source = parts[1] || parts[0] || clean;
  if (source.length <= max) return source;
  return source.split(/\s+/).slice(0, 32).join(' ').trim();
}
