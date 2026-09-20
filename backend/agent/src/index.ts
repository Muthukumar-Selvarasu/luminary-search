import express from 'express';
import pino from 'pino';
import multer from 'multer';
import { mkdirSync } from 'node:fs';
import { ObjectId } from 'mongodb';
import {
  newId,
  AskBody,
  CreateSpaceBody,
  CreateSpaceResponse,
  CreateThreadBody,
  CreateThreadResponse,
  GetThreadResponse,
  HealthResponse,
  ListDocumentsResponse,
  ListSpacesResponse,
  ListThreadsResponse,
  StatsResponse,
  UploadDocumentResponse,
  ROUTES,
  USER_HEADER,
  REQUEST_HEADER
} from '@lumina/contract';
import { env } from './env.js';
import { db, pingDb } from './db.js';
import { initSseStream } from './sse.js';
import { executeAsk } from './agent.js';
import { getGridFSBucket } from './rag/gridfs.js';
import { startWorker } from './worker.js';
import { listMemories, deleteMemory } from './memory/memoryService.js';

const log = pino({ level: env.logLevel });
const app = express();
const spaceCache = new Map<string, { name: string; userId: string }>();
const threadCache = new Set<string>();

app.use((req, res, next) => {
  const inbound = req.header(REQUEST_HEADER);
  const requestId = (Array.isArray(inbound) ? inbound[0] : inbound)?.trim() || newId('req');
  res.locals.requestId = requestId;
  res.setHeader(REQUEST_HEADER, requestId);
  next();
});

app.use((req, res, next) => {
  if (req.path === '/health') return next();
  const userId = req.header(USER_HEADER)?.trim();
  if (!userId) {
    return res.status(401).json({
      error: 'missing X-User-Id header',
      status: 401,
      requestId: String(res.locals.requestId)
    });
  }
  next();
});

const upload = multer({
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB
  storage: multer.memoryStorage()
});

app.disable('x-powered-by');
app.use((req, res, next) =>
  req.path.endsWith('/documents') && req.method === 'POST'
    ? next()
    : express.json({ limit: '1mb' })(req, res, next)
);

mkdirSync(env.runsDir, { recursive: true });

// ---------------------------------------------------------------- /health
app.get('/health', async (_req, res) => {
  const dbStatus = await pingDb();
  const body: HealthResponse = {
    status: dbStatus === 'ok' ? 'ok' : 'degraded',
    model: env.llmModel,
    searchProvider: env.searchProvider,
    vectorStore: env.vectorBackend,
    db: dbStatus,
    ai: { status: 'ok' }
  };
  res.status(dbStatus === 'ok' ? 200 : 503).json(body);
});

// ---------------------------------------------------------------- threads
// POST /threads
app.post('/threads', async (req, res) => {
  const userId = String(req.header(USER_HEADER) || 'anonymous').trim();
  const parsed = CreateThreadBody.safeParse(req.body || {});
  const title = (parsed.success ? parsed.data.title : undefined) || 'New Thread';
  const threadId = newId('thr');

  const database = await db();
  const now = new Date();
  await database.collection('threads').insertOne({
    threadId,
    userId,
    title,
    createdAt: now,
    updatedAt: now
  });
  threadCache.add(threadId);

  const response: CreateThreadResponse = { threadId };
  res.status(201).json(response);
});

// GET /threads
app.get('/threads', async (req, res) => {
  const userId = String(req.header(USER_HEADER) || 'anonymous').trim();
  const database = await db();
  const threads = await database
    .collection('threads')
    .find({ userId })
    .sort({ createdAt: -1 })
    .limit(50)
    .toArray();

  const response: ListThreadsResponse = {
    threads: threads.map((t) => ({
      threadId: String(t.threadId),
      title: String(t.title || 'Untitled Thread'),
      createdAt: (t.createdAt instanceof Date ? t.createdAt : new Date()).toISOString()
    }))
  };
  res.json(response);
});

// GET /threads/:id
app.get('/threads/:id', async (req, res) => {
  const threadId = req.params.id;
  const database = await db();
  const thread = await database.collection('threads').findOne({ threadId });
  if (!thread) {
    return res.status(404).json({ error: `Thread not found: ${threadId}`, status: 404 });
  }

  const messages = await database
    .collection('messages')
    .find({ threadId })
    .sort({ createdAt: 1 })
    .toArray();

  const response: GetThreadResponse = {
    threadId: String(thread.threadId),
    title: String(thread.title || ''),
    messages: messages.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: String(m.content || ''),
      sources: m.sources,
      answerId: m.answerId,
      done: m.done,
      createdAt: m.createdAt instanceof Date ? m.createdAt.toISOString() : undefined
    }))
  };
  res.json(response);
});

// POST /threads/:id/ask
app.post('/threads/:id/ask', async (req, res) => {
  const threadId = req.params.id;
  const userId = String(req.header(USER_HEADER) || '').trim();
  const requestId = String(res.locals.requestId || req.header(REQUEST_HEADER) || newId('req')).trim();

  const existing =
    threadCache.has(String(threadId)) ||
    (await (await db()).collection('threads').findOne({ threadId }));
  if (!existing) {
    return res.status(404).json({ error: `Thread not found: ${threadId}`, status: 404, requestId });
  }
  if (threadId) threadCache.add(String(threadId));

  const parsed = AskBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid ask body', status: 400 });
  }

  const { query, mode, depth, spaceId } = parsed.data;

  // Spend Gate: DEEP_DAILY_CAP per X-User-Id enforced in the agent service
  if (depth === 'deep') {
    const database = await db();
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);

    const deepRunsCount = await database.collection('runs').countDocuments({
      userId,
      depth: 'deep',
      createdAt: { $gte: startOfDay }
    });

    if (deepRunsCount >= env.deepDailyCap) {
      const tomorrow = new Date(startOfDay);
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      return res.status(429).json({
        error: `Daily deep search cap of ${env.deepDailyCap} reached for user`,
        status: 429,
        resetsAt: tomorrow.toISOString(),
        requestId
      });
    }
  }

  // Initialize zero-buffering SSE stream
  const sse = initSseStream(res);

  // Execute agent loop
  await executeAsk({
    threadId,
    userId,
    requestId,
    query,
    depth,
    mode,
    spaceId,
    sse
  });
});

// ---------------------------------------------------------------- spaces & documents
// POST /spaces
app.post('/spaces', async (req, res) => {
  const userId = String(req.header(USER_HEADER) || 'anonymous').trim();
  const parsed = CreateSpaceBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid space body', status: 400 });
  }

  const spaceId = newId('spc');
  const database = await db();
  const now = new Date();
  await database.collection<any>('spaces').insertOne({
    _id: spaceId,
    userId,
    name: parsed.data.name,
    createdAt: now.toISOString()
  });
  spaceCache.set(spaceId, { name: parsed.data.name, userId });

  const response: CreateSpaceResponse = { spaceId, name: parsed.data.name };
  res.status(201).json(response);
});

// GET /spaces
app.get('/spaces', async (req, res) => {
  const userId = String(req.header(USER_HEADER) || 'anonymous').trim();
  const database = await db();
  const spaces = await database.collection<any>('spaces').find({ userId }).toArray();

  const response: ListSpacesResponse = {
    spaces: spaces.map((s) => ({
      spaceId: String(s._id),
      name: String(s.name),
      createdAt: String(s.createdAt)
    }))
  };
  res.json(response);
});

// GET /spaces/:id
app.get('/spaces/:id', async (req, res) => {
  const spaceId = req.params.id;
  const database = await db();
  const space = await database.collection<any>('spaces').findOne({ _id: spaceId });
  if (!space) {
    return res.status(404).json({ error: `Space not found: ${spaceId}`, status: 404 });
  }
  spaceCache.set(spaceId, { name: String(space.name), userId: String(space.userId || '') });
  res.json({
    spaceId: String(space._id),
    name: String(space.name),
    createdAt: String(space.createdAt)
  });
});

// DELETE /spaces/:id
app.delete('/spaces/:id', async (req, res) => {
  const spaceId = req.params.id;
  const database = await db();
  const bucket = await getGridFSBucket();

  // Find all docs to clean GridFS files
  const docs = await database.collection<any>('documents').find({ spaceId }).toArray();
  for (const d of docs) {
    if (d.fileId) {
      try {
        await bucket.delete(new ObjectId(String(d.fileId)));
      } catch {}
    }
  }

  await database.collection<any>('chunks').deleteMany({ spaceId });
  await database.collection<any>('documents').deleteMany({ spaceId });
  await database.collection<any>('jobs').deleteMany({ spaceId });
  await database.collection<any>('spaces').deleteOne({ _id: spaceId });
  spaceCache.delete(spaceId);

  res.json({ ok: true });
});

// POST /spaces/:id/documents (Fast async upload -> GridFS -> 202 Accepted in < 300ms)
app.post('/spaces/:id/documents', upload.single('file'), async (req, res) => {
  const spaceId = String(req.params.id);
  const userId = String(req.header(USER_HEADER) || 'anonymous').trim();

  if (!req.file) {
    return res.status(400).json({ error: 'file is required in multipart body', status: 400 });
  }

  if (req.file.size > 25 * 1024 * 1024) {
    return res.status(413).json({ error: 'file too large, exceeds 25MB limit', status: 413 });
  }

  let space = spaceCache.get(spaceId);
  if (!space) {
    const database = await db();
    const row = await database.collection<any>('spaces').findOne({ _id: spaceId });
    if (!row) {
      return res.status(404).json({ error: `Space not found: ${spaceId}`, status: 404 });
    }
    space = { name: String(row.name), userId: String(row.userId || '') };
    spaceCache.set(spaceId, space);
  }

  const docId = newId('doc');
  const file = req.file;
  const response: UploadDocumentResponse = {
    docId,
    status: 'pending'
  };
  res.status(202).json(response);

  setImmediate(() => {
    persistUploadedDocument({
      docId,
      spaceId,
      userId,
      file
    }).catch(async (err) => {
      log.error({ err, docId, spaceId }, 'background document persist failed');
      try {
        const database = await db();
        await database.collection<any>('documents').updateOne(
          { _id: docId },
          {
            $set: {
              spaceId,
              userId,
              title: file.originalname,
              mimeType: file.mimetype,
              bytes: file.size,
              status: 'failed',
              error: (err as Error).message || 'persist failed',
              updatedAt: new Date()
            },
            $setOnInsert: { _id: docId, createdAt: new Date().toISOString() }
          },
          { upsert: true }
        );
      } catch (writeErr) {
        log.error({ writeErr, docId }, 'failed to record persist error');
      }
    });
  });
});

async function persistUploadedDocument(params: {
  docId: string;
  spaceId: string;
  userId: string;
  file: Express.Multer.File;
}): Promise<void> {
  const { docId, spaceId, userId, file } = params;
  const database = await db();
  const bucket = await getGridFSBucket();
  const uploadStream = bucket.openUploadStream(file.originalname, {
    contentType: file.mimetype,
    metadata: { spaceId, userId, docId }
  });

  await new Promise<void>((resolve, reject) => {
    uploadStream.end(file.buffer, (err?: Error) => {
      if (err) reject(err);
      else resolve();
    });
  });

  const fileId = uploadStream.id;
  const now = new Date();

  await Promise.all([
    database.collection<any>('documents').insertOne({
      _id: docId,
      spaceId,
      userId,
      title: file.originalname,
      mimeType: file.mimetype,
      bytes: file.size,
      status: 'pending',
      pct: 0,
      fileId: fileId.toString(),
      createdAt: now.toISOString()
    }),
    database.collection<any>('jobs').insertOne({
      _id: `job_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
      kind: 'index_document',
      status: 'pending',
      payload: {
        docId,
        spaceId,
        userId
      },
      userId,
      attempts: 0,
      createdAt: now
    })
  ]);
}

// GET /spaces/:id/documents
app.get('/spaces/:id/documents', async (req, res) => {
  const spaceId = req.params.id;
  const database = await db();
  const docs = await database.collection<any>('documents').find({ spaceId }).toArray();

  const response: ListDocumentsResponse = {
    documents: docs.map((d) => ({
      docId: String(d._id),
      title: String(d.title || 'Untitled'),
      status: d.status,
      pct: d.pct ?? 0,
      pages: d.pages,
      chunks: d.chunks,
      error: d.error
    }))
  };
  res.json(response);
});

// GET /spaces/:id/documents/:docId
app.get('/spaces/:id/documents/:docId', async (req, res) => {
  const { id: spaceId, docId } = req.params;
  const database = await db();
  const doc = await database.collection<any>('documents').findOne({ _id: docId, spaceId });
  if (!doc) {
    return res.status(404).json({ error: `Document not found: ${docId}`, status: 404 });
  }

  res.json({
    docId: String(doc._id),
    title: String(doc.title || 'Untitled'),
    status: doc.status,
    pct: doc.pct ?? 0,
    pages: doc.pages,
    chunks: doc.chunks,
    error: doc.error
  });
});

// DELETE /spaces/:id/documents/:docId
app.delete('/spaces/:id/documents/:docId', async (req, res) => {
  const { id: spaceId, docId } = req.params;
  const database = await db();
  const bucket = await getGridFSBucket();

  const doc = await database.collection<any>('documents').findOne({ _id: docId, spaceId });
  if (doc?.fileId) {
    try {
      await bucket.delete(new ObjectId(String(doc.fileId)));
    } catch {}
  }

  await database.collection<any>('chunks').deleteMany({ docId });
  await database.collection<any>('jobs').deleteMany({ docId });
  await database.collection<any>('documents').deleteOne({ _id: docId });

  res.json({ ok: true });
});

// GET /memory
app.get('/memory', async (req, res) => {
  const userId = String(req.header(USER_HEADER) || 'anonymous').trim();
  const memories = await listMemories(userId);
  res.json({ memories });
});

// DELETE /memory/:memoryId
const handleMemoryDelete = async (req: express.Request, res: express.Response) => {
  const userId = String(req.header(USER_HEADER) || 'anonymous').trim();
  const memoryId = req.params.memoryId || req.params.id;
  if (!memoryId) {
    return res.status(400).json({ error: 'Memory ID is required', status: 400 });
  }
  const ok = await deleteMemory(userId, memoryId);
  if (!ok) {
    return res.status(404).json({ error: `Memory not found: ${memoryId}`, status: 404 });
  }
  res.status(204).end();
};
app.delete('/memory/:memoryId', handleMemoryDelete);
app.delete('/memory/:id', handleMemoryDelete);

// GET /stats
app.get('/stats', async (req, res) => {
  const userId = String(req.header(USER_HEADER) || 'anonymous').trim();
  const database = await db();

  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  const runsColl = database.collection<any>('runs');
  const [allCount, doneCount, runsToday, recent] = await Promise.all([
    runsColl.countDocuments({}),
    runsColl.countDocuments({ terminated: 'done' }),
    runsColl.find({ createdAt: { $gte: startOfDay } }).toArray(),
    runsColl.find({ searchCached: { $exists: true } }).sort({ createdAt: -1 }).limit(200).toArray()
  ]);

  const userDeepToday = runsToday.filter((r) => r.userId === userId && r.depth === 'deep').length;
  const costUsdToday = runsToday.reduce((sum, r) => sum + (r.costUsd || 0), 0);
  const withCache = recent.filter((r) => typeof r.searchCached === 'boolean');
  const searchCacheHitRatePct =
    withCache.length > 0
      ? Math.round((withCache.filter((r) => r.searchCached).length / withCache.length) * 100)
      : 0;

  const ttfts = runsToday
    .map((r) => (typeof r.ttftMs === 'number' ? r.ttftMs : undefined))
    .filter((n): n is number => typeof n === 'number')
    .sort((a, b) => a - b);
  const p95Idx = Math.max(0, Math.floor(ttfts.length * 0.95) - (ttfts.length > 0 ? 1 : 0));
  const ttftP95Ms = ttfts.length > 0 ? ttfts[Math.min(p95Idx, ttfts.length - 1)] ?? 0 : 0;

  const stats: StatsResponse = {
    requests: Math.max(allCount, doneCount),
    answers: doneCount,
    searchCacheHitRatePct,
    ttftP95Ms: Math.round(ttftP95Ms),
    costUsdToday: Math.round(costUsdToday * 1000) / 1000,
    deepToday: userDeepToday,
    deepDailyCap: env.deepDailyCap
  };

  res.json(stats);
});

// ---------------------------------------------------------------- Fallback 501
const implementedRoutes = new Set([
  'GET /health',
  'GET /stats',
  'POST /threads',
  'GET /threads',
  'GET /threads/:id',
  'POST /threads/:id/ask',
  'GET /memory',
  'DELETE /memory/:memoryId',
  'DELETE /memory/:id',
  'POST /spaces',
  'GET /spaces',
  'GET /spaces/:id',
  'DELETE /spaces/:id',
  'POST /spaces/:id/documents',
  'GET /spaces/:id/documents',
  'GET /spaces/:id/documents/:docId',
  'DELETE /spaces/:id/documents/:docId'
]);

const notImplemented = (route: string) => (_req: express.Request, res: express.Response) => {
  res.status(501).json({ error: `not implemented yet: ${route}. Build it in backend/agent/src/.`, status: 501 });
};

for (const route of ROUTES) {
  const routeKey = `${route.method.toUpperCase()} ${route.path}`;
  if (implementedRoutes.has(routeKey) || route.path === '/evals/report.json') continue;
  const method = route.method.toLowerCase() as 'get' | 'post' | 'delete';
  app[method](route.path, notImplemented(`${route.method} ${route.path}`));
}

app.use((req, res) => res.status(404).json({ error: `no route ${req.method} ${req.path}`, status: 404 }));

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if ((err as { code?: string }).code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'file too large, exceeds 25MB limit', status: 413 });
  }
  log.error({ err, requestId: res.locals.requestId }, 'agent error');
  res.status(502).json({ error: err.message, status: 502, requestId: res.locals.requestId });
});

// Start background worker loop
startWorker().catch((err) => {
  log.error({ err }, 'Background worker failed to start');
});

app.listen(env.port, () => {
  log.info(
    {
      port: env.port,
      model: env.llmModel,
      searchProvider: env.searchProvider,
      vectorStore: env.vectorBackend
    },
    'agent up with spaces, documents, worker, and ask loop active'
  );
});
