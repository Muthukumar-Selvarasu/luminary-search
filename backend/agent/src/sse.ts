import type { Response } from 'express';
import type {
  DoneEvent,
  PlanEvent,
  Source,
  StreamErrorEvent,
  TokenEvent,
  TraceEvent
} from '@lumina/contract';

export interface SseStream {
  sendPlan(data: PlanEvent): void;
  sendTrace(data: TraceEvent): void;
  sendSources(sources: Source[]): void;
  sendToken(text: string): void;
  sendDone(data: DoneEvent): void;
  sendError(status: number, error: string): void;
  close(): void;
}

/**
 * Initializes a zero-buffering Server-Sent Events (SSE) stream on an Express response.
 * Sets mandatory headers to prevent buffering in proxies (e.g. Nginx, Cloudflare).
 */
export function initSseStream(res: Response): SseStream {
  let started = false;

  const ensureStarted = () => {
    if (started || res.headersSent) return;
    started = true;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    if (typeof res.flushHeaders === 'function') {
      res.flushHeaders();
    }
    // Comment frame so proxies and the client unlock the stream before the first event.
    res.write(': connected\n\n');
    const flushable = res as Response & { flush?: () => void };
    if (typeof flushable.flush === 'function') {
      flushable.flush();
    }
  };

  ensureStarted();

  const writeFrame = (event: string, data: unknown) => {
    if (res.writableEnded) return;
    ensureStarted();
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    const flushable = res as Response & { flush?: () => void };
    if (typeof flushable.flush === 'function') {
      flushable.flush();
    }
  };

  return {
    sendPlan(data: PlanEvent) {
      writeFrame('plan', data);
    },
    sendTrace(data: TraceEvent) {
      writeFrame('trace', data);
    },
    sendSources(sources: Source[]) {
      writeFrame('sources', sources);
    },
    sendToken(text: string) {
      const payload: TokenEvent = { text };
      writeFrame('token', payload);
    },
    sendDone(data: DoneEvent) {
      writeFrame('done', data);
      res.end();
    },
    sendError(status: number, error: string) {
      if (!started && !res.headersSent) {
        res.status(status).json({ error, status });
        return;
      }
      const payload: StreamErrorEvent = { status, error };
      writeFrame('error', payload);
      res.end();
    },
    close() {
      if (!res.writableEnded) {
        res.end();
      }
    }
  };
}
