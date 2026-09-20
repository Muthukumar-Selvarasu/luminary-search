# SSE Streaming & Protocol

> 68 nodes

## Key Concepts

- **agent.ts** (40 connections) — `backend/agent/src/agent.ts`
- **agent/src/env.ts** (18 connections) — `backend/agent/src/env.ts`
- **executeAsk()** (16 connections) — `backend/agent/src/agent.ts`
- **client.ts** (15 connections) — `backend/agent/src/llm/client.ts`
- **hybridSearch.ts** (15 connections) — `backend/agent/src/rag/hybridSearch.ts`
- **runs.ts** (15 connections) — `backend/agent/src/runs.ts`
- **agent/src/db.ts** (13 connections) — `backend/agent/src/db.ts`
- **searchCache.ts** (13 connections) — `backend/agent/src/tools/searchCache.ts`
- **webSearch.ts** (12 connections) — `backend/agent/src/tools/webSearch.ts`
- **env** (11 connections) — `backend/agent/src/env.ts`
- **SseStream** (10 connections) — `backend/agent/src/sse.ts`
- **embeddings.ts** (10 connections) — `backend/agent/src/rag/embeddings.ts`
- **hybridSearchDocuments()** (8 connections) — `backend/agent/src/rag/hybridSearch.ts`
- **generateEmbedding()** (7 connections) — `backend/agent/src/rag/embeddings.ts`
- **getCachedSearch()** (7 connections) — `backend/agent/src/tools/searchCache.ts`
- **setCachedSearch()** (7 connections) — `backend/agent/src/tools/searchCache.ts`
- **webSearch()** (6 connections) — `backend/agent/src/tools/webSearch.ts`
- **decideNextStep()** (5 connections) — `backend/agent/src/llm/client.ts`
- **saveMemory()** (5 connections) — `backend/agent/src/memory/memoryService.ts`
- **generateEmbeddings()** (5 connections) — `backend/agent/src/rag/embeddings.ts`
- **writeRunLog()** (5 connections) — `backend/agent/src/runs.ts`
- **MemoryLRU** (4 connections) — `backend/agent/src/tools/searchCache.ts`
- **streamFinalAnswer()** (4 connections) — `backend/agent/src/llm/client.ts`
- **cosineScan()** (4 connections) — `backend/agent/src/rag/hybridSearch.ts`
- **computeCostUsd()** (4 connections) — `backend/agent/src/runs.ts`
- *... and 43 more nodes in this community*

## Relationships

- [SSE Streaming & Protocol](SSE_Streaming_&_Protocol.md) (48 shared connections)
- [Search & Cache Engine](Search_&_Cache_Engine.md) (9 shared connections)
- [Gateway & Edge Proxy](Gateway_&_Edge_Proxy.md) (2 shared connections)
- [Evaluation & Quality Grader](Evaluation_&_Quality_Grader.md) (2 shared connections)
- [Database & Persistence](Database_&_Persistence.md) (1 shared connections)
- [Fs Subsystem](Fs_Subsystem.md) (1 shared connections)
- [API Contract & Schemas](API_Contract_&_Schemas.md) (1 shared connections)

## Source Files

- `backend/agent/package.json`
- `backend/agent/src/agent.ts`
- `backend/agent/src/db.ts`
- `backend/agent/src/env.ts`
- `backend/agent/src/llm/client.ts`
- `backend/agent/src/memory/memoryService.ts`
- `backend/agent/src/rag/embeddings.ts`
- `backend/agent/src/rag/hybridSearch.ts`
- `backend/agent/src/runs.ts`
- `backend/agent/src/sse.ts`
- `backend/agent/src/tools/fetchPage.ts`
- `backend/agent/src/tools/searchCache.ts`
- `backend/agent/src/tools/webSearch.ts`

## Audit Trail

- EXTRACTED: 200 (99%)
- INFERRED: 2 (1%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*