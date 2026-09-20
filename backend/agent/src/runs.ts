import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Depth, Terminated, ToolName } from '@lumina/contract';
import { db } from './db.js';
import { env } from './env.js';

export interface ToolCallRecord {
  name: ToolName;
  ok: boolean;
  error?: string;
  ms?: number;
}

export interface WriteRunParams {
  requestId: string;
  userId?: string;
  threadId?: string;
  answerId?: string;
  tokensIn: number;
  tokensOut: number;
  wallClockSec: number;
  searchesCount: number;
  searchCached?: boolean;
  ttftMs?: number;
  terminated: Terminated;
  depth: Depth;
  query?: string;
  toolCalls: ToolCallRecord[];
}

export function computeCostUsd(tokensIn: number, tokensOut: number, searches: number): number {
  // Read price table (or defaults aligned with benchmark/sla.json)
  const inputPerMtok = env.llmModel.includes('mini') ? 0.15 : 3.0;
  const outputPerMtok = env.llmModel.includes('mini') ? 0.6 : 15.0;
  const searchPerCall = 0.008;

  const cost =
    (tokensIn / 1e6) * inputPerMtok +
    (tokensOut / 1e6) * outputPerMtok +
    searches * searchPerCall;

  return Math.round(cost * 100000) / 100000;
}

export async function writeRunLog(params: WriteRunParams): Promise<void> {
  const totalTokens = params.tokensIn + params.tokensOut;
  const costUsd = computeCostUsd(params.tokensIn, params.tokensOut, params.searchesCount);

  // Clean toolCalls ensuring failed tools have an error string (A1)
  const cleanToolCalls = params.toolCalls.map((t) => ({
    name: t.name,
    ok: t.ok,
    error: t.ok ? undefined : t.error || 'tool failed',
    ms: t.ms !== undefined ? Math.max(0, Math.round(t.ms)) : undefined
  }));

  const runLogData = {
    tokens: totalTokens,
    wallClockSec: Math.round(params.wallClockSec * 100) / 100,
    costUsd,
    terminated: params.terminated,
    depth: params.depth,
    query: params.query,
    searchCached: params.searchCached ?? false,
    ttftMs: params.ttftMs,
    toolCalls: cleanToolCalls
  };

  // 1. Write to runs/<requestId>.json
  try {
    mkdirSync(env.runsDir, { recursive: true });
    const filePath = resolve(env.runsDir, `${params.requestId}.json`);
    writeFileSync(filePath, JSON.stringify(runLogData, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to write run log to disk:', err);
  }

  // 2. Persist to MongoDB runs collection
  try {
    const database = await db();
    await database.collection('runs').updateOne(
      { requestId: params.requestId },
      {
        $set: {
          ...runLogData,
          requestId: params.requestId,
          userId: params.userId,
          threadId: params.threadId,
          answerId: params.answerId,
          createdAt: new Date()
        }
      },
      { upsert: true }
    );
  } catch (err) {
    console.error('Failed to write run log to MongoDB:', err);
  }
}
