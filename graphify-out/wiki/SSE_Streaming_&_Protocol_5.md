# SSE Streaming & Protocol

> 67 nodes

## Key Concepts

- **agent/src/index.ts** (47 connections) — `backend/agent/src/index.ts`
- **db()** (28 connections) — `backend/agent/src/db.ts`
- **worker.ts** (28 connections) — `backend/agent/src/worker.ts`
- **gateway/src/index.ts** (22 connections) — `backend/gateway/src/index.ts`
- **memoryService.ts** (14 connections) — `backend/agent/src/memory/memoryService.ts`
- **parser.ts** (10 connections) — `backend/agent/src/rag/parser.ts`
- **processJob()** (7 connections) — `backend/agent/src/worker.ts`
- **parseWorker.ts** (7 connections) — `backend/agent/src/rag/parseWorker.ts`
- **recallMemories()** (6 connections) — `backend/agent/src/memory/memoryService.ts`
- **getGridFSBucket()** (6 connections) — `backend/agent/src/rag/gridfs.ts`
- **parsePdf()** (6 connections) — `backend/agent/src/rag/parser.ts`
- **parseTextOrMarkdown()** (6 connections) — `backend/agent/src/rag/parser.ts`
- **gridfs.ts** (6 connections) — `backend/agent/src/rag/gridfs.ts`
- **parseDocument()** (5 connections) — `backend/agent/src/worker.ts`
- **startWorker()** (5 connections) — `backend/agent/src/worker.ts`
- **deleteMemory()** (4 connections) — `backend/agent/src/memory/memoryService.ts`
- **packages_contract_dist_index_newid** (4 connections)
- **ref_express** (4 connections)
- **ref_pino** (4 connections)
- **ParseResult** (3 connections) — `backend/agent/src/rag/parser.ts`
- **persistUploadedDocument()** (3 connections) — `backend/agent/src/index.ts`
- **listMemories()** (3 connections) — `backend/agent/src/memory/memoryService.ts`
- **chunkText()** (3 connections) — `backend/agent/src/rag/parser.ts`
- **run()** (3 connections) — `backend/agent/src/rag/parseWorker.ts`
- **probeVectorIndex()** (3 connections) — `backend/agent/src/worker.ts`
- *... and 42 more nodes in this community*

## Relationships

- [SSE Streaming & Protocol](SSE_Streaming_&_Protocol.md) (50 shared connections)
- [Gateway & Edge Proxy](Gateway_&_Edge_Proxy.md) (5 shared connections)
- [Database & Persistence](Database_&_Persistence.md) (3 shared connections)
- [Fs Subsystem](Fs_Subsystem.md) (2 shared connections)
- [Evaluation & Quality Grader](Evaluation_&_Quality_Grader.md) (2 shared connections)
- [API Contract & Schemas](API_Contract_&_Schemas.md) (1 shared connections)

## Source Files

- `backend/agent/src/db.ts`
- `backend/agent/src/index.ts`
- `backend/agent/src/memory/memoryService.ts`
- `backend/agent/src/rag/gridfs.ts`
- `backend/agent/src/rag/parseWorker.ts`
- `backend/agent/src/rag/parser.ts`
- `backend/agent/src/worker.ts`
- `backend/gateway/package.json`
- `backend/gateway/src/index.ts`
- `backend/gateway/src/sse.ts`

## Audit Trail

- EXTRACTED: 175 (99%)
- INFERRED: 2 (1%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*