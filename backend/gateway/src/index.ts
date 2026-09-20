import express from 'express';
import cors from 'cors';
import http from 'node:http';
import { pinoHttp } from 'pino-http';
import pino from 'pino';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  newId,
  AskBody,
  CreateSpaceBody,
  CreateThreadBody,
  HealthResponse,
  REQUEST_HEADER,
  USER_HEADER
} from '@lumina/contract';
import { env } from './env.js';

const log = pino({ level: env.logLevel });
const app = express();

app.disable('x-powered-by');
app.use(
  cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true);
      if (env.corsOrigins.includes('*') || env.corsOrigins.includes(origin)) return cb(null, true);
      if (origin.endsWith('.vercel.app')) return cb(null, true);
      return cb(null, false);
    },
    credentials: false,
    exposedHeaders: [REQUEST_HEADER]
  })
);

// 1. Request ID Middleware
app.use((req, res, next) => {
  const raw = req.header(REQUEST_HEADER);
  const val = Array.isArray(raw) ? raw[0] : raw;
  const id = (val && val.length > 0 ? val : newId('req')).trim();
  res.locals.requestId = id;
  res.setHeader(REQUEST_HEADER, id);
  next();
});

// 2. Structured Pino HTTP Logging
app.use(
  pinoHttp({
    logger: log,
    genReqId: (_req, res) => String(res.locals.requestId),
    customProps: (req, res) => ({
      requestId: res.locals.requestId,
      userId: req.header(USER_HEADER) ?? null
    }),
    autoLogging: true
  })
);

// 3. JSON body parsing (skip multipart document upload route)
app.use((req, res, next) => {
  if (req.path.includes('/documents') && req.method === 'POST') {
    return next();
  }
  express.json({ limit: '2mb' })(req, res, next);
});

// ---------------------------------------------------------------- /health & /evals
// /health (No auth required)
app.get('/health', async (_req, res) => {
  let ai: { status: 'ok' | 'down' } & Record<string, unknown> = { status: 'down' };
  try {
    const upstream = await fetch(`${env.agentUrl}/health`, { signal: AbortSignal.timeout(3000) });
    const body = (await upstream.json()) as Record<string, unknown>;
    ai = { ...body, status: upstream.ok ? 'ok' : 'down' };
  } catch (err) {
    ai = { status: 'down', error: (err as Error).message };
  }

  const body: HealthResponse = {
    status: ai.status === 'ok' ? 'ok' : 'degraded',
    model: String(ai.model ?? 'unset'),
    searchProvider: (ai.searchProvider as HealthResponse['searchProvider']) ?? 'tavily',
    vectorStore: (ai.vectorStore as HealthResponse['vectorStore']) ?? 'atlas-vector-search',
    db: (ai.db as HealthResponse['db']) ?? 'down',
    ai
  };
  res.status(ai.status === 'ok' ? 200 : 503).json(body);
});

// /evals/report.json (No auth required)
// Prefer the Vite-built copy (same file Vercel serves from web/public/evals/report.json)
// so Railway and Vercel cannot drift after a rebuild.
app.get('/evals/report.json', (_req, res) => {
  const possiblePaths = [
    resolve(env.webDist, 'evals/report.json'),
    resolve(process.cwd(), 'backend/gateway/evals-report.json'),
    resolve(process.cwd(), 'evals-report.json'),
    resolve(process.cwd(), 'reports/report.json'),
    resolve(process.cwd(), '../../reports/report.json'),
    resolve(process.cwd(), 'reports/eval.json'),
    resolve(process.cwd(), '../../reports/eval.json'),
    resolve(process.cwd(), 'eval/report.json')
  ];
  for (const p of possiblePaths) {
    if (existsSync(p)) {
      res.setHeader('Cache-Control', 'no-store');
      return res.sendFile(p);
    }
  }
  res.json({
    status: 'pending',
    note: 'No evaluation report generated yet. Run benchmark to populate.'
  });
});

// ---------------------------------------------------------------- Edge Auth & Rate Limiting
const rateLimitMap = new Map<string, number[]>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

app.use((req, res, next) => {
  // Allow health, evals report, and static UI assets without X-User-Id
  if (
    req.path === '/health' ||
    req.path === '/evals/report.json' ||
    req.method === 'OPTIONS'
  ) {
    return next();
  }

  // Check if this is an API route vs static asset request
  const isApiRoute =
    req.path.startsWith('/threads') ||
    req.path.startsWith('/spaces') ||
    req.path.startsWith('/memory') ||
    req.path.startsWith('/stats');

  if (!isApiRoute) {
    return next();
  }

  // 1. X-User-Id Enforcement
  const userId = req.header(USER_HEADER)?.trim();
  if (!userId) {
    return res.status(401).json({
      error: 'missing X-User-Id header',
      status: 401,
      requestId: String(res.locals.requestId)
    });
  }

  // 2. Sliding Window Rate Limiting (30 req/min per user)
  const now = Date.now();
  const timestamps = rateLimitMap.get(userId) || [];
  const validTimestamps = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);

  if (validTimestamps.length >= env.rateLimitPerMinute) {
    const resetsAt = new Date(validTimestamps[0]! + RATE_LIMIT_WINDOW_MS).toISOString();
    return res.status(429).json({
      error: 'rate limit exceeded',
      status: 429,
      resetsAt,
      requestId: String(res.locals.requestId)
    });
  }

  validTimestamps.push(now);
  rateLimitMap.set(userId, validTimestamps);
  next();
});

// ---------------------------------------------------------------- Zod Contract Validation
app.use((req, res, next) => {
  if (req.method === 'POST') {
    if (req.path === '/threads') {
      const parsed = CreateThreadBody.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({
          error: parsed.error.issues[0]?.message || 'Invalid thread body',
          issues: parsed.error.issues,
          status: 400,
          requestId: String(res.locals.requestId)
        });
      }
    } else if (req.path.match(/^\/threads\/[^/]+\/ask$/)) {
      const parsed = AskBody.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: parsed.error.issues[0]?.message || 'Invalid ask body',
          issues: parsed.error.issues,
          status: 400,
          requestId: String(res.locals.requestId)
        });
      }
    } else if (req.path === '/spaces') {
      const parsed = CreateSpaceBody.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: parsed.error.issues[0]?.message || 'Invalid space body',
          issues: parsed.error.issues,
          status: 400,
          requestId: String(res.locals.requestId)
        });
      }
    }
  }
  next();
});

// ---------------------------------------------------------------- Upstream Proxy Handlers
// 1. Zero-Buffering SSE Stream Proxy for POST /threads/:id/ask
app.post('/threads/:id/ask', (req, res) => {
  const requestId = String(res.locals.requestId);
  const userId = String(req.header(USER_HEADER) || '');
  const payload = JSON.stringify(req.body ?? {});

  const agentReq = http.request(
    `${env.agentUrl}${req.originalUrl}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        'Content-Length': Buffer.byteLength(payload),
        [REQUEST_HEADER]: requestId,
        [USER_HEADER]: userId
      }
    },
    (agentRes) => {
      const status = agentRes.statusCode || 502;
      const contentType = String(agentRes.headers['content-type'] || '');
      if (status >= 400 || !contentType.includes('text/event-stream')) {
        res.status(status);
        for (const [key, val] of Object.entries(agentRes.headers)) {
          if (val) res.setHeader(key, val);
        }
        agentRes.pipe(res);
        return;
      }

      res.status(200);
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.setHeader(REQUEST_HEADER, requestId);
      if (typeof res.flushHeaders === 'function') res.flushHeaders();

      agentRes.on('data', (chunk: Buffer) => {
        res.write(chunk);
        const flushable = res as express.Response & { flush?: () => void };
        if (typeof flushable.flush === 'function') flushable.flush();
      });
      agentRes.on('end', () => {
        if (!res.writableEnded) res.end();
      });
    }
  );

  agentReq.on('error', (err) => {
    log.error({ err, requestId }, 'SSE proxy failed to connect to agent');
    if (!res.headersSent) {
      res.status(502).json({
        error: err.message || 'Upstream agent service unreachable',
        status: 502,
        requestId
      });
    } else if (!res.writableEnded) {
      res.end();
    }
  });

  agentReq.write(payload);
  agentReq.end();
});

// 2. Multipart Document Upload Streaming Proxy (POST /spaces/:id/documents)
app.post('/spaces/:id/documents', (req, res) => {
  const requestId = String(res.locals.requestId);
  const userId = String(req.header(USER_HEADER) || '');

  const agentReq = http.request(
    `${env.agentUrl}${req.originalUrl}`,
    {
      method: 'POST',
      headers: {
        ...req.headers,
        [REQUEST_HEADER]: requestId,
        [USER_HEADER]: userId
      }
    },
    (agentRes) => {
      res.status(agentRes.statusCode || 502);
      for (const [key, val] of Object.entries(agentRes.headers)) {
        if (val) res.setHeader(key, val);
      }
      agentRes.pipe(res);
    }
  );

  agentReq.on('error', (err) => {
    log.error({ err, requestId }, 'Document upload proxy error');
    if (!res.headersSent) {
      res.status(502).json({
        error: err.message || 'Failed to proxy upload to agent',
        status: 502,
        requestId
      });
    }
  });

  req.pipe(agentReq);
});

// 3. Generic REST Proxy for all other API routes
const proxyRestRoute = async (req: express.Request, res: express.Response) => {
  const requestId = String(res.locals.requestId);
  const userId = String(req.header(USER_HEADER) || '');

  try {
    const upstream = await fetch(`${env.agentUrl}${req.originalUrl}`, {
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
        [REQUEST_HEADER]: requestId,
        [USER_HEADER]: userId
      },
      body:
        req.method !== 'GET' && req.method !== 'HEAD' && req.body
          ? JSON.stringify(req.body)
          : undefined
    });

    if (upstream.status === 204) {
      return res.status(204).end();
    }

    const data = await upstream.json().catch(() => ({}));
    return res.status(upstream.status).json(data);
  } catch (err) {
    log.error({ err, requestId, path: req.path }, 'REST proxy error');
    return res.status(502).json({
      error: (err as Error).message || 'Upstream agent service unreachable',
      status: 502,
      requestId
    });
  }
};

app.all(['/threads*', '/spaces*', '/memory*', '/stats'], proxyRestRoute);

// ---------------------------------------------------------------- Graphify knowledge wiki
const knowledgeRoot = env.knowledgeDist.find((p) => existsSync(p));
if (knowledgeRoot) {
  app.use('/knowledge', express.static(knowledgeRoot, { index: 'index.html' }));
}

// ---------------------------------------------------------------- Static UI
if (existsSync(env.webDist)) {
  app.use(express.static(env.webDist));
  // SPA fallback for `/` and `/evals`. Knowledge wiki and API routes are excluded.
  app.get(
    /^(?!\/(health|stats|threads|memory|spaces|knowledge)(\/|$)|\/evals\/report\.json$).*/,
    (_req, res) => {
      res.sendFile(resolve(env.webDist, 'index.html'));
    }
  );
}

// 404 fallback
app.use((req, res) => {
  res.status(404).json({
    error: `no route ${req.method} ${req.path}`,
    status: 404,
    requestId: String(res.locals.requestId)
  });
});

// 502 error handler: fail loud, never return 200 on internal failure
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  log.error({ err, requestId: res.locals.requestId }, 'gateway error');
  res.status(502).json({
    error: err.message,
    status: 502,
    requestId: String(res.locals.requestId)
  });
});

app.listen(env.port, () => {
  log.info(
    { port: env.port, agentUrl: env.agentUrl, cors: env.corsOrigins },
    'gateway up with edge auth, zod validation, rate limit, and zero-buffering proxy'
  );
});
