import { db } from '../db.js';
import { env } from '../env.js';
import { generateEmbedding } from './embeddings.js';
import type { Locator } from '@lumina/contract';

export interface RetrievedDocumentChunk {
  chunkId: string;
  docId: string;
  spaceId: string;
  title: string;
  text: string;
  locator: Locator;
  score: number;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function normalizeLocator(raw: unknown): Locator {
  const loc = (raw && typeof raw === 'object' ? raw : {}) as {
    page?: unknown;
    heading?: unknown;
    line?: unknown;
  };
  const out: Locator = {};
  const page = Number(loc.page);
  if (Number.isInteger(page) && page > 0) out.page = page;
  if (typeof loc.heading === 'string' && loc.heading.trim()) out.heading = loc.heading.trim();
  const line = Number(loc.line);
  if (Number.isInteger(line) && line > 0) out.line = line;
  if (out.page == null && !out.heading && out.line == null) out.heading = 'body';
  return out;
}

function lexicalOverlap(query: string, text: string): number {
  const tokens = query
    .toLowerCase()
    .split(/[^a-z0-9.]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3);
  if (tokens.length === 0) return 0;
  const hay = text.toLowerCase();
  let hits = 0;
  for (const t of tokens) {
    if (hay.includes(t)) hits++;
  }
  return hits / tokens.length;
}

async function cosineScan(
  spaceId: string,
  queryEmbedding: number[],
  limit: number
): Promise<any[]> {
  const database = await db();
  const chunks = await database
    .collection('chunks')
    .find({ spaceId })
    .project({ embedding: 1, docId: 1, spaceId: 1, text: 1, locator: 1, ord: 1 })
    .limit(4000)
    .toArray();

  return chunks
    .map((chunk) => ({
      ...chunk,
      score: Array.isArray(chunk.embedding) ? cosineSimilarity(queryEmbedding, chunk.embedding) : 0
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export async function hybridSearchDocuments(
  query: string,
  spaceId: string,
  topK = 5
): Promise<RetrievedDocumentChunk[]> {
  const database = await db();
  const chunksColl = database.collection('chunks');
  const docsColl = database.collection('documents');

  const spaceDocs = await docsColl.find({ spaceId }).toArray();
  const docTitleMap = new Map<string, string>();
  for (const d of spaceDocs) {
    const title = String(d.title || 'Untitled Document');
    docTitleMap.set(String(d._id), title);
    if (d.docId) docTitleMap.set(String(d.docId), title);
  }

  const queryEmbedding = await generateEmbedding(query);
  let vectorHits: any[] = [];
  let textHits: any[] = [];

  if (env.vectorBackend === 'mongo-cosine-scan') {
    vectorHits = await cosineScan(spaceId, queryEmbedding, 20);
  } else {
    try {
      vectorHits = await chunksColl
        .aggregate([
          {
            $vectorSearch: {
              index: 'chunks_vector',
              path: 'embedding',
              queryVector: queryEmbedding,
              numCandidates: 80,
              limit: 20,
              filter: { spaceId: { $eq: spaceId } }
            }
          },
          {
            $project: {
              _id: 1,
              docId: 1,
              spaceId: 1,
              text: 1,
              locator: 1,
              ord: 1,
              score: { $meta: 'vectorSearchScore' }
            }
          }
        ])
        .toArray();
    } catch (err) {
      console.warn('Vector search warning:', (err as Error).message);
    }
  }

  try {
    textHits = await chunksColl
      .aggregate([
        {
          $search: {
            index: 'chunks_text',
            compound: {
              must: [{ text: { query, path: 'text' } }],
              filter: [{ equals: { path: 'spaceId', value: spaceId } }]
            }
          }
        },
        { $limit: 20 },
        {
          $project: {
            _id: 1,
            docId: 1,
            spaceId: 1,
            text: 1,
            locator: 1,
            ord: 1,
            score: { $meta: 'searchScore' }
          }
        }
      ])
      .toArray();
  } catch {
    try {
      textHits = await chunksColl
        .find({ spaceId, $text: { $search: query } })
        .limit(20)
        .toArray();
    } catch {
      const token = query.split(/\s+/).find((t) => t.length > 3) ?? query.split(/\s+/)[0] ?? query;
      textHits = await chunksColl
        .find({ spaceId, text: { $regex: token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } })
        .limit(20)
        .toArray();
    }
  }

  const needScan =
    env.vectorBackend === 'mongo-cosine-scan' || (vectorHits.length === 0 && textHits.length === 0);
  const scanned = needScan ? await cosineScan(spaceId, queryEmbedding, 40) : [];

  const rrfScores = new Map<string, { chunk: any; score: number }>();
  const addRanked = (hits: any[]) => {
    hits.forEach((chunk, rank) => {
      const id = String(chunk._id);
      const curr = rrfScores.get(id);
      const scoreAddition = 1 / (60 + rank + 1);
      if (curr) curr.score += scoreAddition;
      else rrfScores.set(id, { chunk, score: scoreAddition });
    });
  };

  addRanked(vectorHits);
  addRanked(textHits);
  // Exact cosine scan is the local-dev fallback and a last resort when Atlas
  // returns nothing. Always scanning the collection on the Atlas path contends
  // with ingest writes on M0 and blows the search-during-ingest SLA.
  if (env.vectorBackend === 'mongo-cosine-scan' || (vectorHits.length === 0 && textHits.length === 0)) {
    addRanked(scanned);
  }

  const sorted = Array.from(rrfScores.values()).sort((a, b) => {
    const textA = String(a.chunk?.text || '');
    const textB = String(b.chunk?.text || '');
    const scoreA = a.score + lexicalOverlap(query, textA);
    const scoreB = b.score + lexicalOverlap(query, textB);
    return scoreB - scoreA;
  });
  const results: RetrievedDocumentChunk[] = [];

  for (const item of sorted.slice(0, topK)) {
    const chunk = item.chunk;
    if (String(chunk.spaceId) !== spaceId) continue;
    const docId = String(chunk.docId);
    results.push({
      chunkId: String(chunk._id),
      docId,
      spaceId: String(chunk.spaceId),
      title: docTitleMap.get(docId) || 'Document',
      text: String(chunk.text || ''),
      locator: normalizeLocator(chunk.locator),
      score: item.score
    });
  }

  return results;
}
