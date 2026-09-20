# DESIGN.md — LUMINA

## Components

LUMINA is structured as a decoupled dual-service distributed architecture deployed across edge and private network layers, backed by MongoDB Atlas:
1. **Edge Gateway Service (`backend/gateway`)**: A stateless Express service listening on `:8787` (publicly exposed on Vercel/Edge). It handles client HTTP ingress, CORS negotiation, `X-User-Id` authentication enforcement, cryptographic `X-Request-Id` generation and propagation, sliding-window rate limiting, and zero-buffering Server-Sent Events (SSE) streaming pass-through. It also serves the production pre-built frontend SPA (`web/dist`).
2. **Agent Engine Service (`backend/agent`)**: An internal Express application listening on `:8000` (hosted privately on Railway without public ingress). It runs the core multi-step agent reasoning loop, hosts the tool execution sandbox (`web_search`, `fetch_page`, `search_documents`, `recall_memory`, `save_memory`, and deep search `plan_research`), manages LLM provider abstractions, tracks step-level wall-clock and tool-call caps, and streams structured SSE event frames.
3. **Document Ingestion Background Worker (`backend/agent/src/worker.ts`)**: A resilient background daemon that monitors the atomic `jobs` queue. It parses binary files from MongoDB GridFS, splits text into semantically coherent chunks annotated with granular locators (page numbers for PDF, line/heading for text), generates 1536-dimensional embeddings (`text-embedding-3-small`), writes chunks to the vector collection, and executes read-your-write vector search probes before updating document statuses.
4. **MongoDB Atlas Datastore & Search Engine**: The unified persistence and indexing tier holding relational collections (`threads`, `messages`, `memories`, `spaces`, `documents`, `chunks`, `jobs`, `searchCache`, `requests`, `runs`) alongside GridFS binary buckets (`fs.files`, `fs.chunks`). It runs two native Atlas Vector Search indexes (`chunks_vector` for RAG and `memories_vector` for cross-session user memory) and an Atlas Full-Text Search index (`chunks_text` for BM25 retrieval).
5. **Two-Tier Search Cache**: A hybrid caching layer consisting of an ultra-fast in-memory LRU cache inside the agent process combined with a persistent MongoDB `searchCache` collection indexed with an automatic TTL expiration (`expiresAt: 1`, `expireAfterSeconds: 0`), keyed deterministically by SHA-256 hash of `(normalized_query, provider)`.
6. **Execution Telemetry & Run Store**: Structured run logs persisted both to disk (`runs/<requestId>.json`) and to MongoDB (`runs` collection) capturing detailed per-turn execution traces, token consumption, financial cost, tool outcomes, and termination reasons for auditing and benchmarking.

## Responsibilities

Every component in LUMINA adheres to strict single-responsibility boundaries with zero ambient authority:
- **Edge Gateway (`backend/gateway`)**: Exclusively responsible for untrusted browser communication, security policy enforcement, edge rate limiting (30 requests/minute per IP/user), user identity verification (`401 Unauthorized` on missing or malformed `X-User-Id`), request tracing headers (`X-Request-Id`), and proxying SSE streams with immediate flush (`X-Accel-Buffering: no`). **Exclusions**: The gateway is strictly forbidden from holding provider API keys (OpenAI, Anthropic, Tavily), accessing MongoDB directly, or making LLM decisions.
- **Agent Engine (`backend/agent`)**: Exclusively responsible for holding upstream AI and search provider credentials, evaluating agent reasoning cycles, executing research tools, synthesizing citations against retrieved documents, and strictly enforcing the daily deep-search spend gate (`DEEP_DAILY_CAP=5` per `X-User-Id` returning `429 Too Many Requests` with a reset timestamp). **Exclusions**: The agent service never exposes its network port directly to the browser; all client requests must flow through the gateway.
- **Ingestion Worker (`backend/agent/src/worker.ts`)**: Exclusively responsible for long-running CPU and network-intensive parsing (PDF extraction via `pdfjs-dist`), chunking, vector embedding generation, and polling Atlas vector index readiness. **Exclusions**: The worker never serves client HTTP traffic. Conversely, HTTP upload endpoints never perform synchronous parsing or embedding—`POST /spaces/:id/documents` writes to GridFS, queues a `pending` job, and responds with `202 Accepted` in under 300 ms.
- **MongoDB Atlas**: Exclusively responsible for transactional document state, vector similarity search execution, full-text inverted index querying, and TTL cache invalidation.

## Communication

Inter-component communication combines streaming, synchronous, and asynchronous protocols:
- **Client ↔ Gateway**: Standard RESTful JSON over HTTP for synchronous operations (spaces management, memory CRUD, thread history) and Server-Sent Events (SSE) over HTTP for `POST /threads/:id/ask`. The gateway sets `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`, and `X-Accel-Buffering: no` to guarantee sub-second Time-To-First-Token (TTFT) without intermediate buffering.
- **Gateway ↔ Agent Engine**: In development, direct HTTP/SSE over local loopback (`http://localhost:8000`). In cloud production, the gateway communicates with the agent service over an isolated, private virtual network (`.railway.internal`). The gateway pipes the raw SSE stream directly from the agent to the client chunk by chunk. If the agent service terminates unexpectedly or is unreachable, the gateway immediately fails loud, terminating the client response with an explicit `502 Bad Gateway` JSON envelope.
- **Agent HTTP API ↔ Background Worker**: Fully decoupled and asynchronous via the MongoDB `jobs` collection. Jobs are claimed using atomic `findOneAndUpdate({ status: 'pending' }, { $set: { status: 'running', claimedAt: new Date() } })`. If a worker process crashes mid-job, the document remains safely stored in GridFS; a periodic crash-recovery sweeper queries jobs stuck in `running` status with stale `claimedAt` timestamps (> 5 minutes) and resets them to `pending` without duplicate stage execution.
- **Agent Engine ↔ External Providers (LLMs, Tavily)**: Outbound HTTPS with strict per-call timeouts (15s for search, 30s for LLM generation) and exponential backoff retry. In accordance with the project's Fail-Loud contract, provider exceptions are never silently swallowed or masked as empty answers; any upstream failure immediately produces a `trace` event with `{ ok: false, error }` and terminates the run with `terminated: "error"` and HTTP 502.

## State

LUMINA cleanly segregates authoritative transactional state from disposable caches and tracks consistency through explicit lifecycle states:
- **Authoritative State**:
  - `threads` and `messages`: The immutable record of conversational turns, tool invocations, and synthesized responses.
  - `memories`: Long-term user facts and preferences stored with vector embeddings. Authoritative ownership belongs to the user: every memory is visible via `GET /memory`, and a deletion via `DELETE /memory/:id` completely removes the record and vector embedding from Atlas.
  - `spaces`, `documents`, and GridFS chunks: The authoritative corpus of user-uploaded knowledge.
  - `chunks`: Vector and text chunks created by the worker, annotated with spatial/heading locators.
- **Ephemeral / Disposable Cache**:
  - `searchCache`: Two-tier query cache. Deleting this collection has zero impact on domain correctness; cached queries simply fall back to upstream provider calls.
  - `jobs`: Ephemeral state machine tracking document processing stages. Once a document is `indexed`, its job record is purely historical telemetry.
  - `runs/<requestId>.json` & `runs` collection: Observability records capturing step-level telemetry, token counts, latency, and costs for automated grading and benchmarking.
- **Document Indexing Consistency Story**:
  - A newly uploaded document is inserted with `status: "pending"`. It is immediately visible in document listings but is excluded from RAG retrieval pipelines.
  - After the background worker parses the file, generates chunks, and writes them to the `chunks` collection, the document remains `pending`.
  - The worker performs a **read-your-write probe**: it executes an active vector search query against Atlas Vector Search using one of the generated chunk embeddings, filtering by `spaceId`.
  - Only when Atlas returns the probe chunk ID does the worker promote the document to `status: "indexed"`. If the probe fails or times out, the document transitions to `status: "failed"` with a descriptive error message. RAG queries exclusively filter on `status: "indexed"`, preventing partial or invisible corpus retrieval.

## Trade-offs

1. **Atlas Vector Search & Search Indexes vs. Dedicated Vector Database (e.g., Pinecone/Qdrant)**:
   - *Decision*: Co-locate vector embeddings and full-text inverted indexes in MongoDB Atlas alongside transactional application state rather than introducing an external vector database.
   - *Trade-off*: We avoided distributed transactions, dual-write synchronization bugs, and an extra external infrastructure service. In exchange, we accepted Atlas M0 tier constraints (maximum 3 search indexes across the cluster) and slightly higher cold-query vector retrieval latencies compared to specialized in-memory vector databases.
2. **MongoDB Atomic Job Queue vs. Dedicated Message Broker (e.g., Redis + BullMQ / RabbitMQ)**:
   - *Decision*: Implement the asynchronous document ingestion queue directly on MongoDB using atomic `findOneAndUpdate` queries and timestamp-based claim leases.
   - *Trade-off*: We eliminated Redis as a runtime dependency, ensuring our single MongoDB connection handles all state. In exchange, we gave up sub-millisecond job dispatch latency and built-in pub/sub primitives, accepting a 500ms worker polling interval.
3. **Synchronous SSE Streaming Pass-Through vs. Asynchronous Polling Architecture**:
   - *Decision*: Stream agent progress (`trace`), citations (`sources`), generated text (`token`), and completion metadata (`done`) over a single persistent Server-Sent Events HTTP connection held open through the gateway.
   - *Trade-off*: This achieves optimal perceptual performance with sub-second Time-To-First-Token (TTFT) and real-time trace visibility. However, it requires careful reverse-proxy configuration to prevent socket buffering, and long-running deep searches (up to 240 seconds) are susceptible to client network interruptions or edge proxy connection timeouts.
4. **Strict Read-Your-Write Index Probing vs. Optimistic Asynchronous Availability**:
   - *Decision*: Require the ingestion worker to actively verify vector index recall via an Atlas search probe before setting document status to `indexed`.
   - *Trade-off*: This introduces a 2–10 second delay between chunk insertion and document availability while Atlas asynchronously builds the HNSW index segment. We chose this over optimistic completion because querying an index before Atlas has committed the vector segment leads to silent retrieval failures and hallucinated responses. We remain mindful that aggressive index polling under high concurrent upload volume could add query load to Atlas, which we mitigated with exponential backoff probing.
