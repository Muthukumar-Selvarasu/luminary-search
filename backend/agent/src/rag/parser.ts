import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { Locator } from '@lumina/contract';

export interface ParsedChunk {
  text: string;
  locator: Locator;
  ord: number;
}

export interface ParseResult {
  chunks: ParsedChunk[];
  pages?: number;
}

function chunkText(text: string, locator: Locator, startOrd: number, maxChunkChars = 1000, overlapChars = 150): ParsedChunk[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];

  if (clean.length <= maxChunkChars) {
    return [{ text: clean, locator, ord: startOrd }];
  }

  const chunks: ParsedChunk[] = [];
  let start = 0;
  let ord = startOrd;

  while (start < clean.length) {
    let end = Math.min(start + maxChunkChars, clean.length);
    if (end < clean.length) {
      const lastSpace = clean.lastIndexOf(' ', end);
      if (lastSpace > start + maxChunkChars * 0.6) {
        end = lastSpace;
      }
    }

    const chunkText = clean.slice(start, end).trim();
    if (chunkText.length > 20) {
      chunks.push({ text: chunkText, locator, ord: ord++ });
    }

    if (end >= clean.length) break;
    start = end - overlapChars;
  }

  return chunks;
}

export async function parsePdf(buffer: Buffer): Promise<ParseResult> {
  const data = new Uint8Array(buffer);
  const loadingTask = pdfjs.getDocument({ data });
  const pdfDoc = await loadingTask.promise;
  const numPages = pdfDoc.numPages;

  const chunks: ParsedChunk[] = [];
  let currentOrd = 0;

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    const page = await pdfDoc.getPage(pageNum);
    const content = await page.getTextContent();
    const pageStrings = content.items.map((item) => ('str' in item ? String(item.str) : '')).filter(Boolean);
    const pageText = pageStrings.join(' ').trim();

    if (pageText) {
      const pageChunks = chunkText(pageText, { page: pageNum }, currentOrd);
      chunks.push(...pageChunks);
      currentOrd += pageChunks.length;
    }
    // Yield so HTTP (202/search) can run while a large PDF is parsed on this process.
    await new Promise((r) => setImmediate(r));
  }

  return { chunks, pages: numPages };
}

export async function parseTextOrMarkdown(text: string, isMarkdown = false): Promise<ParseResult> {
  const chunks: ParsedChunk[] = [];
  let currentOrd = 0;

  if (isMarkdown) {
    // Split by Markdown headings (# Heading)
    const sections = text.split(/(?=^#{1,3}\s+)/m);
    for (const section of sections) {
      const trimmed = section.trim();
      if (!trimmed) continue;

      const headingMatch = trimmed.match(/^#{1,3}\s+(.+)$/m);
      const matchedText = headingMatch?.[1];
      const heading = matchedText ? matchedText.trim() : 'Overview';

      const sectionChunks = chunkText(trimmed, { heading }, currentOrd);
      chunks.push(...sectionChunks);
      currentOrd += sectionChunks.length;
    }
  } else {
    // Plain text: split into paragraph blocks with line numbers
    const lines = text.split('\n');
    let blockText = '';
    let startLine = 1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line && line.trim()) {
        if (!blockText) startLine = i + 1;
        blockText += line + '\n';
      }

      if (blockText.length >= 800 || (i === lines.length - 1 && blockText)) {
        const textChunks = chunkText(blockText, { line: startLine }, currentOrd);
        chunks.push(...textChunks);
        currentOrd += textChunks.length;
        blockText = '';
      }
    }
  }

  return { chunks };
}
