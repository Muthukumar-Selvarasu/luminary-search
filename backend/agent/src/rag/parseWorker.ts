import { parentPort, workerData } from 'node:worker_threads';
import { parsePdf, parseTextOrMarkdown, type ParseResult } from './parser.js';

type ParseJob = {
  kind: 'pdf' | 'text';
  bytes: Uint8Array;
  isMarkdown?: boolean;
};

async function run(): Promise<ParseResult> {
  const job = workerData as ParseJob;
  const buffer = Buffer.from(job.bytes);
  if (job.kind === 'pdf') {
    return parsePdf(buffer);
  }
  return parseTextOrMarkdown(buffer.toString('utf8'), Boolean(job.isMarkdown));
}

run()
  .then((result) => {
    parentPort?.postMessage(result);
  })
  .catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(message);
  });
