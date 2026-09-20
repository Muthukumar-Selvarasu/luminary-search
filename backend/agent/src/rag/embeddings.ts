import OpenAI from 'openai';
import { env, secrets } from '../env.js';

let openaiClient: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (!openaiClient) {
    if (!secrets.openai) {
      throw new Error('OPENAI_API_KEY is not set for embeddings generation');
    }
    openaiClient = new OpenAI({ apiKey: secrets.openai });
  }
  return openaiClient;
}

export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const client = getOpenAI();

  // OpenAI allows up to 2048 inputs per request; we batch in 100s
  const batchSize = 100;
  const allEmbeddings: number[][] = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize).map((t) => t.slice(0, 8000)); // cap single text
    let res: OpenAI.CreateEmbeddingResponse | null = null;
    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        res = await client.embeddings.create({
          model: env.embeddingModel,
          input: batch
        });
        break;
      } catch (err) {
        lastErr = err;
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }
    if (!res) {
      throw lastErr || new Error('Embeddings creation failed after 3 attempts');
    }

    for (const item of res.data) {
      allEmbeddings.push(item.embedding);
    }
  }

  return allEmbeddings;
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const [emb] = await generateEmbeddings([text]);
  if (!emb) {
    throw new Error('Failed to generate embedding');
  }
  return emb;
}
