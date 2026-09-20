import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Both services read the single .env at the assignment root.
const here = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(here, '../../../.env') });
config({ path: resolve(process.cwd(), '.env') });

const num = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export const env = {
  port: num(process.env.PORT_GATEWAY ?? process.env.PORT, 8787),
  agentUrl: process.env.AGENT_URL ?? 'http://localhost:8000',
  corsOrigins: (process.env.CORS_ORIGINS ??
    'http://localhost:5173,http://localhost:8787,https://lumina-ui-eight.vercel.app')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  rateLimitPerMinute: num(process.env.RATE_LIMIT_PER_MINUTE, 30),
  logLevel: process.env.LOG_LEVEL ?? 'info',
  /** Serve the built UI from the gateway in production so one host serves / and /evals. */
  webDist: resolve(here, '../../../web/dist'),
  /** Graphify wiki (Ask / Evals / Graph). First existing path wins. */
  knowledgeDist: [
    resolve(here, '../../../web/dist/knowledge'),
    resolve(here, '../../../web/public/knowledge'),
    resolve(here, '../../../graphify-out/site')
  ]
} as const;
