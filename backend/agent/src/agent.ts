import pino from 'pino';
import { newId, type Depth, type Locator, type Source, type Terminated } from '@lumina/contract';
import { env } from './env.js';
import { db } from './db.js';
import type { SseStream } from './sse.js';
import { webSearch, type WebSearchHit } from './tools/webSearch.js';
import { evidenceWindow, fetchPage, groundedExcerpt, passageSnippet } from './tools/fetchPage.js';
import { hybridSearchDocuments } from './rag/hybridSearch.js';
import { saveMemory, recallMemories } from './memory/memoryService.js';
import { computeCostUsd, writeRunLog, type ToolCallRecord } from './runs.js';
import { decideNextStep, streamFinalAnswer, type ChatMessage } from './llm/client.js';

const log = pino({ level: env.logLevel });

export interface ExecuteAskParams {
  threadId: string;
  userId: string;
  requestId: string;
  query: string;
  depth: Depth;
  mode?: 'auto' | 'web' | 'docs';
  spaceId?: string;
  sse: SseStream;
}

export interface RetrievedPassage {
  kind: 'web' | 'doc';
  title: string;
  snippet: string;
  /** Longer fetched-page window used only for synthesis. Not sent as the citation. */
  body?: string;
  url?: string;
  docId?: string;
  locator?: Locator;
  subQuestion?: number;
  fetched?: boolean;
}

function hitCap(toolCalls: number, maxToolCalls: number, startTime: number, maxWallClockMs: number): boolean {
  return toolCalls >= maxToolCalls || Date.now() - startTime > maxWallClockMs;
}

const TEMPLATE_PREFIXES = [
  'core facts and definitions',
  'recent developments and comparisons',
  'limitations, trade-offs, and open questions',
  'practical implications of'
];

function looksLikeFixedTemplate(questions: string[]): boolean {
  if (questions.length === 0) return true;
  const canned = questions.filter((q) =>
    TEMPLATE_PREFIXES.some((prefix) => q.toLowerCase().startsWith(prefix))
  );
  return canned.length >= Math.min(3, questions.length);
}

function clampPlan(
  raw: Array<{ i?: number; question?: string; reason?: string }>
): Array<{ i: number; question: string; reason: string }> | null {
  const cleaned = raw
    .map((sq, idx) => ({
      i: Number(sq.i) > 0 ? Number(sq.i) : idx + 1,
      question: String(sq.question || '').trim(),
      reason: String(sq.reason || '').trim() || 'Needed to cover a distinct part of the question'
    }))
    .filter((sq) => sq.question.length > 8);

  const unique: typeof cleaned = [];
  const seen = new Set<string>();
  for (const sq of cleaned) {
    const key = sq.question.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(sq);
  }

  if (unique.length < env.deepSubQuestionsMin) return null;
  if (looksLikeFixedTemplate(unique.map((sq) => sq.question))) return null;

  return unique.slice(0, env.deepSubQuestionsMax).map((sq, idx) => ({ ...sq, i: idx + 1 }));
}

const PLAN_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'plan_research',
      description: 'Decompose this specific question into 3 to 6 sub-questions before any retrieval.',
      parameters: {
        type: 'object',
        properties: {
          subQuestions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                i: { type: 'integer' },
                question: { type: 'string' },
                reason: { type: 'string' }
              },
              required: ['i', 'question', 'reason']
            },
            minItems: 3,
            maxItems: 6
          },
          reason: { type: 'string' }
        },
        required: ['subQuestions']
      }
    }
  }
];

function parsePlanRaw(
  decision: Awaited<ReturnType<typeof decideNextStep>>
): Array<{ i?: number; question?: string; reason?: string }> {
  const planToolCall = decision.toolCalls.find((t) => t.name === 'plan_research');
  if (Array.isArray(planToolCall?.args.subQuestions)) {
    return planToolCall.args.subQuestions as Array<{ i?: number; question?: string; reason?: string }>;
  }
  const text = decision.content || '';
  const match = text.match(/\{[\s\S]*"subQuestions"[\s\S]*\}/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[0]) as { subQuestions?: unknown };
    return Array.isArray(parsed.subQuestions)
      ? (parsed.subQuestions as Array<{ i?: number; question?: string; reason?: string }>)
      : [];
  } catch {
    return [];
  }
}

async function writeResearchPlan(query: string, stricter: boolean) {
  const instruction = stricter
    ? `Call plan_research. The previous plan was a generic outline and is rejected.
Write 4 sub-questions that mention the concrete people, places, offices, dates, or claims in the user's question.
A reader who has not seen the original question must still know what is being asked.
Do not start any question with "Core facts", "Recent developments", "Limitations", or "Practical implications".
Do not retrieve anything.`
    : `Call plan_research. Write 4 DISTINCT sub-questions a careful researcher would ask about THIS question, each with a one-line reason.
Name the specific subject. Do not restate the original question as a prefix on a generic outline.
Do not use a fixed template (definitions, recent developments, limitations, practical implications).
Do not retrieve anything.`;

  return decideNextStep(
    [
      { role: 'system', content: instruction },
      { role: 'user', content: query }
    ],
    'deep',
    PLAN_TOOLS,
    20000,
    0.4
  );
}

export async function executeAsk(params: ExecuteAskParams): Promise<void> {
  const startTime = Date.now();
  const answerId = newId('ans');
  const isDeep = params.depth === 'deep';
  const maxToolCalls = isDeep ? env.maxToolCallsDeep : env.maxToolCalls;
  const maxWallClockMs = (isDeep ? env.maxWallClockSecDeep : env.maxWallClockSec) * 1000;

  let totalTokensIn = 0;
  let totalTokensOut = 0;
  let totalSearches = 0;
  let allSearchesCached = true;
  let stepIndex = 1;
  let ttftMs = 0;
  let terminated: Terminated = 'done';
  let subQuestionsCount = 0;
  let snippetFallback = false;

  const toolCallRecords: ToolCallRecord[] = [];
  const passages: RetrievedPassage[] = [];
  const recalledMemories: string[] = [];

  const trace = (
    tool: ToolCallRecord['name'],
    input: Record<string, unknown>,
    ok: boolean,
    ms: number,
    extra?: { reason?: string; error?: string; subQuestion?: number }
  ) => {
    toolCallRecords.push({ name: tool, ok, error: ok ? undefined : extra?.error || 'tool failed', ms });
    params.sse.sendTrace({
      step: stepIndex++,
      tool,
      input,
      ok,
      ms,
      reason: extra?.reason,
      error: ok ? undefined : extra?.error || 'tool failed',
      subQuestion: extra?.subQuestion
    });
  };

  const database = await db();
  const historyPromise: Promise<ChatMessage[]> = database
    .collection('messages')
    .find({ threadId: params.threadId })
    .sort({ createdAt: -1 })
    .limit(4)
    .toArray()
    .then((docs) =>
      docs
        .reverse()
        .filter((doc) => doc.role === 'user' || doc.role === 'assistant')
        .map((doc) => ({
          role: doc.role as 'user' | 'assistant',
          content: String(doc.content || '').slice(0, 800)
        }))
    );

  const finishError = async (errorMsg: string) => {
    params.sse.sendError(502, errorMsg);
    await writeRunLog({
      requestId: params.requestId,
      userId: params.userId,
      threadId: params.threadId,
      answerId,
      tokensIn: totalTokensIn,
      tokensOut: totalTokensOut,
      wallClockSec: (Date.now() - startTime) / 1000,
      searchesCount: totalSearches,
      searchCached: totalSearches > 0 && allSearchesCached,
      ttftMs,
      terminated: 'error',
      depth: params.depth,
      query: params.query,
      toolCalls: toolCallRecords
    });
    log.error({
      requestId: params.requestId,
      toolCalls: toolCallRecords.length,
      terminated: 'error',
      tokens: { in: totalTokensIn, out: totalTokensOut },
      costUsd: computeCostUsd(totalTokensIn, totalTokensOut, totalSearches),
      searchCached: false,
      ttftMs,
      latencyMs: Date.now() - startTime
    }, 'answer');
  };

  try {
    // Deep: plan_research FIRST, before any retrieval (including memory).
    let subQuestions: Array<{ i: number; question: string; reason: string }> = [];
    if (isDeep) {
      const planStart = Date.now();
      let planDecision: Awaited<ReturnType<typeof writeResearchPlan>>;
      try {
        planDecision = await writeResearchPlan(params.query, false);
      } catch {
        planDecision = await writeResearchPlan(params.query, true);
      }
      totalTokensIn += planDecision.tokensIn;
      totalTokensOut += planDecision.tokensOut;
      subQuestions = clampPlan(parsePlanRaw(planDecision)) ?? [];

      if (subQuestions.length < env.deepSubQuestionsMin) {
        const retry = await writeResearchPlan(params.query, true);
        totalTokensIn += retry.tokensIn;
        totalTokensOut += retry.tokensOut;
        planDecision = retry;
        subQuestions = clampPlan(parsePlanRaw(retry)) ?? [];
      }

      if (subQuestions.length < env.deepSubQuestionsMin) {
        throw new Error('plan_research did not return question-specific sub-questions');
      }

      subQuestionsCount = subQuestions.length;
      const planReason =
        (planDecision.toolCalls.find((t) => t.name === 'plan_research')?.args.reason as string) ||
        'Decomposed the question before retrieval';

      params.sse.sendPlan({
        subQuestions,
        reason: planReason
      });
      trace('plan_research', { query: params.query, subQuestions }, true, Date.now() - planStart, {
        reason: 'Model wrote sub-questions for this question before any retrieval'
      });
    }

    const isExplicitRemember =
      /^remember\b/i.test(params.query.trim()) || params.query.toLowerCase().includes('remember this preference');

    if (isExplicitRemember && !hitCap(toolCallRecords.length, maxToolCalls, startTime, maxWallClockMs)) {
      const prefText =
        params.query
          .replace(/^remember\s+(this\s+preference\s+for\s+all\s+future\s+answers:?\s*)?/i, '')
          .trim() || params.query;
      const memStart = Date.now();
      await saveMemory(params.userId, prefText, params.threadId);
      trace('save_memory', { text: prefText }, true, Date.now() - memStart, {
        reason: 'Persisted explicit user preference across sessions'
      });
    }

    const searchAndFetch = async (question: string, subQuestion?: number, fetchCount = 2) => {
      if (hitCap(toolCallRecords.length, maxToolCalls, startTime, maxWallClockMs)) {
        terminated = 'cap';
        return;
      }

      const searchStart = Date.now();
      let searchRes;
      try {
        searchRes = await webSearch(question);
      } catch (err) {
        const error = (err as Error).message || 'web_search failed';
        trace('web_search', { query: question }, false, Date.now() - searchStart, {
          reason: 'Search provider failed',
          error,
          subQuestion
        });
        throw err;
      }
      totalSearches++;
      if (!searchRes.cached) allSearchesCached = false;
      trace('web_search', { query: question }, true, Date.now() - searchStart, {
        reason: subQuestion ? `Researching sub-question ${subQuestion}` : 'Executed web search for grounded evidence',
        subQuestion
      });

      const candidates: WebSearchHit[] = [];
      const seen = new Set<string>();
      for (const r of searchRes.results) {
        if (!r.url || seen.has(r.url)) continue;
        seen.add(r.url);
        candidates.push(r);
      }

      const toFetch = candidates.slice(0, fetchCount);
      // Quick still has to beat TTFT p95, but 250ms almost never gets live HTML and
      // then the citation snippet is a Tavily paraphrase the grounding checker rejects.
      const fetchBudgetMs = subQuestion ? 3500 : 1200;
      const fetches = toFetch.map(async (hit) => {
        const fetchStart = Date.now();
        try {
          let title = hit.title;
          let content = '';
          let fromPage = false;
          const raced = await Promise.race([
            fetchPage(hit.url)
              .then((page) => ({ page }))
              .catch(() => ({ page: null })),
            new Promise<{ page: null }>((resolve) =>
              setTimeout(() => resolve({ page: null }), fetchBudgetMs)
            )
          ]);
          if (raced.page) {
            title = raced.page.title || title;
            content = raced.page.content;
            fromPage = true;
          } else if (hit.rawContent && hit.rawContent.length > 80) {
            content = hit.rawContent;
          } else {
            content = hit.snippet || '';
          }
          const excerpt = fromPage ? groundedExcerpt(content, question) : null;
          const snippet = excerpt?.snippet || passageSnippet(content, 280, question);
          if (!snippet) throw new Error('empty extracted content');
          passages.push({
            kind: 'web',
            title,
            snippet,
            body: excerpt?.body || evidenceWindow(content, snippet),
            url: hit.url,
            subQuestion,
            fetched: fromPage
          });
          trace('fetch_page', { url: hit.url }, true, Date.now() - fetchStart, {
            reason: fromPage
              ? subQuestion
                ? `Fetched page text for sub-question ${subQuestion}`
                : 'Fetched page text for grounding'
              : 'Used provider extract within TTFT budget',
            subQuestion
          });
        } catch (err) {
          const error = (err as Error).message || 'fetch_page failed';
          trace('fetch_page', { url: hit.url }, false, Date.now() - fetchStart, {
            reason: 'Page fetch failed',
            error,
            subQuestion
          });
        }
      });
      await Promise.all(fetches);

      if (!passages.some((p) => p.kind === 'web' && p.fetched && (subQuestion ? p.subQuestion === subQuestion : true))) {
        snippetFallback = true;
        for (const hit of toFetch) {
          if (!hit.snippet) continue;
          const snippet = passageSnippet(hit.snippet, 280, question);
          if (!snippet) continue;
          passages.push({
            kind: 'web',
            title: hit.title,
            snippet,
            body: snippet,
            url: hit.url,
            subQuestion,
            fetched: false
          });
        }
      }
    };

    const searchDocs = async (subQuestion?: number) => {
      if (!params.spaceId) return;
      if (hitCap(toolCallRecords.length, maxToolCalls, startTime, maxWallClockMs)) {
        terminated = 'cap';
        return;
      }
      const t0 = Date.now();
      try {
        const hits = await hybridSearchDocuments(params.query, params.spaceId, isDeep ? 10 : 8);
        for (const h of hits.slice(0, 5)) {
          const pageBit =
            h.locator?.page != null ? ` p. ${Number(h.locator.page)}` : '';
          const body = String(h.text || '').replace(/\s+/g, ' ').trim();
          const snippet = `${h.title}${pageBit} ${body}`.replace(/\s+/g, ' ').trim().slice(0, 900);
          if (!snippet) continue;
          passages.push({
            kind: 'doc',
            title: h.title,
            snippet,
            body: body.slice(0, 1400),
            docId: h.docId,
            locator: h.locator,
            subQuestion,
            fetched: true
          });
        }
        trace('search_documents', { query: params.query, spaceId: params.spaceId }, true, Date.now() - t0, {
          reason: 'Queried corpus documents in active space',
          subQuestion
        });
      } catch (err) {
        const error = (err as Error).message || 'search_documents failed';
        trace('search_documents', { query: params.query, spaceId: params.spaceId }, false, Date.now() - t0, {
          reason: 'Document retrieval failed',
          error,
          subQuestion
        });
        throw err;
      }
    };

    const retrievalTasks: Promise<void>[] = [];
    if (!hitCap(toolCallRecords.length, maxToolCalls, startTime, maxWallClockMs)) {
      retrievalTasks.push(
        (async () => {
          const recallStart = Date.now();
          const initialRecalled = await recallMemories(params.userId, params.query, 5);
          trace('recall_memory', { query: params.query }, true, Date.now() - recallStart, {
            reason: 'Checked long-term user preferences'
          });
          for (const m of initialRecalled) recalledMemories.push(m.text);
        })()
      );
    }

    if (isDeep) {
      const shouldDocs = params.mode === 'docs' || (params.mode === 'auto' && Boolean(params.spaceId));
      if (shouldDocs) retrievalTasks.push(searchDocs(1));

      if (params.mode !== 'docs') {
        for (const sq of subQuestions) {
          retrievalTasks.push(searchAndFetch(sq.question, sq.i, 2));
        }
      }
      const results = await Promise.allSettled(retrievalTasks);
      for (const r of results) {
        if (r.status === 'rejected') {
          throw r.reason instanceof Error ? r.reason : new Error(String(r.reason));
        }
      }
    } else {
      const shouldCheckDocs = params.mode === 'docs' || (params.mode === 'auto' && Boolean(params.spaceId));
      if (shouldCheckDocs) retrievalTasks.push(searchDocs());
      const shouldCheckWebNow =
        params.mode === 'web' || (params.mode === 'auto' && !params.spaceId);
      if (shouldCheckWebNow) retrievalTasks.push(searchAndFetch(params.query, undefined, 1));
      await Promise.all(retrievalTasks);

      const shouldCheckWebAfterDocs =
        params.mode === 'auto' && Boolean(params.spaceId) && passages.length === 0;
      if (shouldCheckWebAfterDocs) {
        await searchAndFetch(params.query, undefined, 1);
      }
    }

    if (snippetFallback) {
      params.sse.sendTrace({
        step: stepIndex++,
        tool: 'fetch_page',
        input: { note: 'snippet_fallback' },
        ok: true,
        ms: 0,
        reason: 'Fell back to search snippets because live page text was unavailable'
      });
      toolCallRecords.push({ name: 'fetch_page', ok: true, ms: 0 });
    }

    const seenItems = new Set<string>();
    const sources: Source[] = [];
    let sourceCounter = 1;
    const preferFetched = passages.some((p) => p.fetched);
    for (const p of preferFetched ? passages.filter((x) => x.fetched) : passages) {
      const key =
        p.kind === 'web'
          ? p.url
          : `${p.docId}_${p.locator?.page ?? p.locator?.heading ?? p.locator?.line ?? ''}`;
      if (!key || seenItems.has(key) || !p.snippet) continue;
      seenItems.add(key);
      sources.push({
        n: sourceCounter++,
        kind: p.kind,
        title: p.title || 'Source',
        snippet: p.snippet,
        url: p.url,
        docId: p.docId,
        locator: p.locator
          ? {
              ...(p.locator.page != null ? { page: Number(p.locator.page) } : {}),
              ...(p.locator.heading ? { heading: p.locator.heading } : {}),
              ...(p.locator.line != null ? { line: Number(p.locator.line) } : {})
            }
          : p.locator,
        subQuestion: p.subQuestion
      });
    }

    params.sse.sendSources(sources);
    params.sse.sendToken(' ');
    ttftMs = Date.now() - startTime;

    let sourcesContext = 'SOURCES RETRIEVED:\n';
    if (sources.length === 0) {
      sourcesContext +=
        '(No external sources retrieved. State that clearly. Cite nothing. Do not invent URLs, pages, or documents.)\n';
    } else {
      for (const s of sources) {
        const locatorStr = s.locator?.page
          ? `, p. ${s.locator.page}`
          : s.locator?.heading
            ? `, heading: ${s.locator.heading}`
            : s.locator?.line
              ? `, line ${s.locator.line}`
              : '';
        const ref = s.url ? ` (${s.url})` : locatorStr ? ` (${locatorStr})` : '';
        const passage = passages.find(
          (p) =>
            (p.kind === 'web' && p.url === s.url) ||
            (p.kind === 'doc' && p.docId === s.docId && p.snippet === s.snippet)
        );
        const pageText = (passage?.body || s.snippet).trim();
        const sq = s.subQuestion ? ` sub-question ${s.subQuestion}` : '';
        sourcesContext += `[${s.n}]${sq} ${s.title}${ref}\nCITED PASSAGE: ${s.snippet}\nPAGE TEXT:\n${pageText}\n\n`;
      }
    }

    const structureGuidance = isDeep
      ? `DEEP RESEARCH FORMAT:
1. Direct answer to the question.
2. One short section per sub-question.
3. What is still unknown.
Every factual claim needs an inline [n] citation.`
      : `Provide a direct, grounded answer with inline citations [n].`;

    const memoryPrompt =
      recalledMemories.length > 0
        ? `\nUSER PREFERENCES (follow these):\n${recalledMemories.map((m) => `- ${m}`).join('\n')}\n`
        : '';

    const conversationHistory = await historyPromise;

    const synthesisMessages: ChatMessage[] = [
      {
        role: 'system',
        content: `You are LUMINA.
${structureGuidance}
${memoryPrompt}
GROUNDING (mandatory):
- You have no knowledge of your own for this answer. PAGE TEXT is the only evidence.
- State a fact only when those words appear in PAGE TEXT. Copy names, titles, offices, dates, and numbers exactly as written there.
- If PAGE TEXT contradicts something you think you know, PAGE TEXT wins. Do not substitute a person, date, or title from memory.
- If PAGE TEXT does not state the fact, say the sources do not state it. Do not fill the gap.
- Every factual claim needs an inline [n] for the source the words came from.
- Do not cite a number that is not in the list.
- Conversation history is context only. It is not a source.
- If retrieval was empty, say so and cite nothing.
${snippetFallback ? '- Some sources are search snippets because the live page could not be fetched. Say that, and still do not go beyond that text.\n' : ''}
${sourcesContext}`
      },
      ...conversationHistory,
      { role: 'user', content: params.query }
    ];

    let fullAnswer = ' ';
    let firstToken = false;
    const maxSourceN = sources.length;

    for await (const rawChunk of streamFinalAnswer(synthesisMessages, (u) => {
      totalTokensIn += u.in;
      totalTokensOut += u.out;
    })) {
      if (firstToken) {
        ttftMs = Date.now() - startTime;
        firstToken = false;
      }
      let chunk = rawChunk;
      if (maxSourceN === 0) {
        chunk = chunk.replace(/\[\d+\]/g, '');
      } else {
        chunk = chunk.replace(/\[(\d+)\]/g, (match, numStr) => {
          const num = Number(numStr);
          if (num > maxSourceN || num < 1) return '';
          return match;
        });
      }
      fullAnswer += chunk;
      params.sse.sendToken(chunk);
    }

    if (hitCap(toolCallRecords.length, maxToolCalls, startTime, maxWallClockMs) && terminated === 'done') {
      // Caps already applied during retrieval; synthesis may still complete as a partial.
    }

    const totalLatencyMs = Date.now() - startTime;
    const wallClockSec = totalLatencyMs / 1000;
    const costUsd = computeCostUsd(totalTokensIn, totalTokensOut, totalSearches);
    const searchCached = totalSearches > 0 && allSearchesCached;

    try {
      const now = new Date();
      await database.collection('threads').updateOne(
        { threadId: params.threadId },
        {
          $setOnInsert: {
            threadId: params.threadId,
            userId: params.userId,
            title: params.query.slice(0, 100),
            createdAt: now
          },
          $set: { updatedAt: now }
        },
        { upsert: true }
      );

      await database.collection('messages').insertMany([
        {
          threadId: params.threadId,
          userId: params.userId,
          role: 'user',
          content: params.query,
          createdAt: now
        },
        {
          threadId: params.threadId,
          userId: params.userId,
          role: 'assistant',
          content: fullAnswer,
          sources,
          answerId,
          done: {
            latencyMs: totalLatencyMs,
            ttftMs,
            model: env.llmModel,
            tokens: { in: totalTokensIn, out: totalTokensOut },
            costUsd,
            terminated,
            depth: params.depth
          },
          createdAt: new Date()
        }
      ]);
    } catch (err) {
      log.error({ err, requestId: params.requestId }, 'Failed to persist thread message');
    }

    await writeRunLog({
      requestId: params.requestId,
      userId: params.userId,
      threadId: params.threadId,
      answerId,
      tokensIn: totalTokensIn,
      tokensOut: totalTokensOut,
      wallClockSec,
      searchesCount: totalSearches,
      searchCached,
      ttftMs,
      terminated,
      depth: params.depth,
      query: params.query,
      toolCalls: toolCallRecords
    });

    log.info(
      {
        requestId: params.requestId,
        toolCalls: toolCallRecords.length,
        terminated,
        tokens: { in: totalTokensIn, out: totalTokensOut },
        costUsd,
        searchCached,
        ttftMs,
        latencyMs: totalLatencyMs
      },
      'answer'
    );

    params.sse.sendDone({
      answerId,
      latencyMs: totalLatencyMs,
      ttftMs: ttftMs || totalLatencyMs,
      model: env.llmModel,
      tokens: { in: totalTokensIn, out: totalTokensOut },
      costUsd,
      searchCached,
      terminated,
      depth: params.depth,
      subQuestions: isDeep ? subQuestionsCount : undefined
    });
  } catch (err) {
    await finishError((err as Error).message || 'Agent loop failure');
  }
}
