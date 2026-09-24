import pino from 'pino';
import { ObjectId } from 'mongodb';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { env } from './env.js';
import { db } from './db.js';
import { waitUntilInteractiveQuiet } from './load.js';
import { getGridFSBucket } from './rag/gridfs.js';
import { parsePdf, parseTextOrMarkdown, type ParseResult } from './rag/parser.js';
import { generateEmbeddings } from './rag/embeddings.js';

const log = pino({ level: env.logLevel });
const workerId = `worker_${process.pid}_${Math.random().toString(36).slice(2, 6)}`;
const here = dirname(fileURLToPath(import.meta.url));
const parseWorkerFile = join(here, 'rag', import.meta.url.endsWith('.ts') ? 'parseWorker.ts' : 'parseWorker.js');

function parseInThread(kind: 'pdf' | 'text', buffer: Buffer, isMarkdown = false): Promise<ParseResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const thread = new Worker(parseWorkerFile, {
      workerData: { kind, bytes: new Uint8Array(buffer), isMarkdown }
    });
    const succeed = (msg: ParseResult) => {
      if (settled) return;
      settled = true;
      resolve(msg);
      thread.terminate().catch(() => undefined);
    };
    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      reject(err instanceof Error ? err : new Error(String(err)));
      thread.terminate().catch(() => undefined);
    };
    thread.once('message', succeed);
    thread.once('error', fail);
    thread.once('exit', (code) => {
      if (code !== 0) fail(new Error(`parse worker exited ${code}`));
    });
  });
}

async function parseDocument(mimeType: string, title: string, fileBuffer: Buffer): Promise<ParseResult> {
  const isPdf = mimeType.includes('pdf');
  const isMarkdown = mimeType.includes('markdown') || title.endsWith('.md');
  try {
    return await parseInThread(isPdf ? 'pdf' : 'text', fileBuffer, isMarkdown);
  } catch (err) {
    log.warn({ err }, 'parse worker failed; falling back to in-process parse');
    if (isPdf) return parsePdf(fileBuffer);
    return parseTextOrMarkdown(fileBuffer.toString('utf8'), isMarkdown);
  }
}

/**
 * Sweeper: reset jobs stuck in 'running' for > 5 minutes back to 'pending'.
 */
async function sweepStaleJobs(): Promise<void> {
  try {
    const database = await db();
    const staleThreshold = new Date(Date.now() - 5 * 60 * 1000);
    const result = await database.collection('jobs').updateMany(
      { status: 'running', claimedAt: { $lt: staleThreshold } },
      { $set: { status: 'pending', claimedAt: null } }
    );
    if (result.modifiedCount > 0) {
      log.info({ count: result.modifiedCount }, 'Swept stale running jobs back to pending');
    }
  } catch (err) {
    log.error({ err }, 'Error during stale jobs sweep');
  }
}

/**
 * Read-Your-Write Probe: verifies that a newly written chunk is visible in Atlas Vector Search.
 */
async function probeVectorIndex(spaceId: string, docId: string, probeEmbedding: number[]): Promise<boolean> {
  const database = await db();
  const chunksColl = database.collection<any>('chunks');
  const maxWaitMs = 45000;
  const t0 = Date.now();
  let pausedMs = 0;

  log.info({ docId, spaceId }, 'Starting read-your-write vector index probe...');

  if (env.vectorBackend === 'mongo-cosine-scan') {
    const found = await chunksColl.findOne({ spaceId, docId });
    return Boolean(found);
  }

  while (Date.now() - t0 - pausedMs < maxWaitMs) {
    // An in-flight answer also searches Atlas. Wait it out so the probe does not slow it.
    const pauseStart = Date.now();
    await waitUntilInteractiveQuiet();
    pausedMs += Date.now() - pauseStart;
    if (Date.now() - t0 - pausedMs >= maxWaitMs) break;
    try {
      const results = await chunksColl
        .aggregate([
          {
            $vectorSearch: {
              index: 'chunks_vector',
              path: 'embedding',
              queryVector: probeEmbedding,
              numCandidates: 10,
              limit: 5,
              filter: { spaceId: { $eq: spaceId } }
            }
          }
        ])
        .toArray();

      const hit = results.some((r) => String(r.docId) === docId);
      if (hit) {
        log.info({ docId, elapsedMs: Date.now() - t0 }, 'Read-your-write probe succeeded: chunk is queryable in vector index');
        return true;
      }
    } catch {
      // Index may be warming up
    }

    await new Promise((r) => setTimeout(r, 1500));
  }

  log.warn({ docId }, 'Read-your-write probe timed out');
  return false;
}

/**
 * Process a single document ingestion job.
 */
async function processJob(job: any): Promise<void> {
  const database = await db();
  const docsColl = database.collection<any>('documents');
  const chunksColl = database.collection<any>('chunks');
  const bucket = await getGridFSBucket();

  const payload = job.payload || {};
  const docId = String(payload.docId || job.docId || '');
  const spaceId = String(payload.spaceId || job.spaceId || '');

  log.info({ docId, spaceId, jobId: job._id }, 'Processing document ingestion job');
  // Searches are often fired in the same breath as the 202. Let them register
  // before this job takes Atlas or the embedding API.
  await new Promise((r) => setTimeout(r, 2000));
  await waitUntilInteractiveQuiet();

  const doc = await docsColl.findOne({ _id: docId });
  if (!doc) {
    throw new Error(`Document record not found for docId: ${docId}`);
  }
  if (!doc.fileId) {
    throw new Error(`GridFS fileId not ready for docId: ${docId}`);
  }

  // 1. Download file from GridFS
  await docsColl.updateOne({ _id: docId }, { $set: { status: 'parsing', pct: 20 } });

  const fileId = new ObjectId(String(doc.fileId));
  const downloadStream = bucket.openDownloadStream(fileId);
  const chunksBuffer: Buffer[] = [];

  for await (const chunk of downloadStream) {
    chunksBuffer.push(Buffer.from(chunk));
  }
  const fileBuffer = Buffer.concat(chunksBuffer);

  // 2. Parse file off the HTTP event loop so search/202 stay responsive during ingest.
  await waitUntilInteractiveQuiet();
  const mimeType = String(doc.mimeType || '').toLowerCase();
  const parseResult = await parseDocument(mimeType, String(doc.title || ''), fileBuffer);

  if (parseResult.chunks.length === 0) {
    throw new Error('No readable text content extracted from document');
  }

  // 3. Generate embeddings
  await waitUntilInteractiveQuiet();
  await docsColl.updateOne({ _id: docId }, { $set: { status: 'embedding', pct: 50 } });

  const texts = parseResult.chunks.map((c) => c.text);
  const embeddings = await generateEmbeddings(texts);

  // 4. Insert chunks into chunks collection
  const chunkDocs = parseResult.chunks.map((c, idx) => ({
    _id: `${docId}_${c.ord}`,
    docId,
    spaceId,
    userId: String(doc.userId || 'anonymous'),
    text: c.text,
    locator: (() => {
      const loc: { page?: number; heading?: string; line?: number } = {};
      if (c.locator?.page != null && Number.isFinite(Number(c.locator.page))) {
        loc.page = Number(c.locator.page);
      }
      if (c.locator?.heading) loc.heading = String(c.locator.heading);
      if (c.locator?.line != null && Number.isFinite(Number(c.locator.line))) {
        loc.line = Number(c.locator.line);
      }
      if (loc.page == null && !loc.heading && loc.line == null) loc.heading = 'body';
      return loc;
    })(),
    ord: c.ord,
    embedding: embeddings[idx],
    createdAt: new Date()
  }));

  // Clean existing chunks for doc if any
  await chunksColl.deleteMany({ docId });
  // Insert in small batches and yield so ask/search keep a Mongo connection on M0.
  const insertBatch = 25;
  for (let i = 0; i < chunkDocs.length; i += insertBatch) {
    await waitUntilInteractiveQuiet();
    await chunksColl.insertMany(chunkDocs.slice(i, i + insertBatch));
    await new Promise((r) => setImmediate(r));
  }

  await docsColl.updateOne({ _id: docId }, { $set: { pct: 80 } });

  // 5. Read-Your-Write Probe
  const probeSuccess = await probeVectorIndex(spaceId, docId, embeddings[0] ?? []);

  if (probeSuccess) {
    await docsColl.updateOne(
      { _id: docId },
      {
        $set: {
          status: 'indexed',
          pct: 100,
          pages: parseResult.pages,
          chunks: chunkDocs.length,
          updatedAt: new Date()
        }
      }
    );
  } else {
    // If probe times out, mark failed
    await docsColl.updateOne(
      { _id: docId },
      {
        $set: {
          status: 'failed',
          error: 'Vector index read-your-write probe timed out',
          updatedAt: new Date()
        }
      }
    );
  }
}

let isRunning = false;

/**
 * Main worker loop.
 */
export async function startWorker(): Promise<void> {
  if (isRunning) return;
  isRunning = true;
  log.info({ workerId }, 'LUMINA Ingestion Worker started');

  let sweepTimer = 0;

  while (isRunning) {
    try {
      // Periodically sweep stale claimed jobs every 30s
      if (Date.now() - sweepTimer > 30000) {
        sweepTimer = Date.now();
        await sweepStaleJobs();
      }

      const database = await db();
      const jobsColl = database.collection<any>('jobs');

      await waitUntilInteractiveQuiet();

      const job = await jobsColl.findOneAndUpdate(
        { status: 'pending' },
        {
          $set: { status: 'running', claimedAt: new Date(), workerId },
          $inc: { attempts: 1 }
        },
        { sort: { createdAt: 1 }, returnDocument: 'after' }
      );

      if (job) {
        try {
          await new Promise((r) => setImmediate(r));
          await processJob(job);
          await jobsColl.updateOne({ _id: job._id }, { $set: { status: 'done', finishedAt: new Date() } });
        } catch (jobErr) {
          log.error({ err: jobErr, jobId: job._id }, 'Failed to process document job');
          await jobsColl.updateOne(
            { _id: job._id },
            { $set: { status: 'failed', error: (jobErr as Error).message, failedAt: new Date() } }
          );
          const docId = String(job.payload?.docId || job.docId || '');
          await database.collection<any>('documents').updateOne(
            { _id: docId },
            { $set: { status: 'failed', error: (jobErr as Error).message } }
          );
        }
      } else {
        // Idle wait
        await new Promise((r) => setTimeout(r, 500));
      }
    } catch (loopErr) {
      log.error({ err: loopErr }, 'Worker loop error');
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

export function stopWorker(): void {
  isRunning = false;
}

// Standalone execution support: `npm run worker`
const isMain = process.argv[1] && process.argv[1].endsWith('worker.ts');
if (isMain) {
  startWorker().catch((err) => {
    log.fatal({ err }, 'Worker fatal error');
    process.exit(1);
  });
}
