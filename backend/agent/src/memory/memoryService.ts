import { newId } from '@lumina/contract';
import { db } from '../db.js';
import { generateEmbedding } from '../rag/embeddings.js';

export interface MemoryItem {
  id: string;
  text: string;
  sourceThread?: string;
  createdAt: string;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
    normA += (a[i] ?? 0) * (a[i] ?? 0);
    normB += (b[i] ?? 0) * (b[i] ?? 0);
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export async function saveMemory(userId: string, text: string, sourceThread?: string): Promise<string> {
  const database = await db();
  const memoryId = newId('mem');
  const embedding = await generateEmbedding(text);
  const now = new Date();

  await database.collection<any>('memories').insertOne({
    _id: memoryId,
    userId,
    text,
    embedding,
    sourceThread,
    createdAt: now.toISOString()
  });

  return memoryId;
}

export async function recallMemories(
  userId: string,
  query: string,
  limit = 5
): Promise<Array<{ id: string; text: string; score?: number }>> {
  const database = await db();
  const count = await database.collection<any>('memories').countDocuments({ userId });
  if (count === 0) {
    return [];
  }

  const queryEmbedding = await generateEmbedding(query);

  // 1. Try Atlas Vector Search
  try {
    const hits = await database
      .collection<any>('memories')
      .aggregate([
        {
          $vectorSearch: {
            index: 'memories_vector',
            path: 'embedding',
            queryVector: queryEmbedding,
            numCandidates: 20,
            limit,
            filter: { userId: { $eq: userId } }
          }
        },
        {
          $project: {
            _id: 1,
            text: 1,
            score: { $meta: 'vectorSearchScore' }
          }
        }
      ])
      .toArray();

    if (hits.length > 0) {
      return hits.map((h) => ({
        id: String(h._id),
        text: String(h.text),
        score: typeof h.score === 'number' ? h.score : undefined
      }));
    }
  } catch {
    // Atlas Vector Search error or unindexed, fall through to cosine fallback
  }

  // 2. In-memory cosine similarity fallback (ensures read-your-own-writes immediate consistency)
  const allMemories = await database
    .collection<any>('memories')
    .find({ userId })
    .toArray();

  if (allMemories.length === 0) {
    return [];
  }

  const scored = allMemories
    .map((m) => {
      const score = Array.isArray(m.embedding) ? cosineSimilarity(queryEmbedding, m.embedding) : 0;
      return {
        id: String(m._id),
        text: String(m.text),
        score
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored;
}

export async function listMemories(userId: string): Promise<MemoryItem[]> {
  const database = await db();
  const memories = await database
    .collection<any>('memories')
    .find({ userId })
    .sort({ createdAt: -1 })
    .toArray();

  return memories.map((m) => ({
    id: String(m._id),
    text: String(m.text),
    sourceThread: m.sourceThread ? String(m.sourceThread) : undefined,
    createdAt: new Date(m.createdAt).toISOString()
  }));
}

export async function deleteMemory(userId: string, memoryId: string): Promise<boolean> {
  const database = await db();
  const result = await database.collection<any>('memories').deleteOne({ _id: memoryId, userId });
  return result.deletedCount > 0;
}
