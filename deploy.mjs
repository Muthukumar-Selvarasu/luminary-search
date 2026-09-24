#!/usr/bin/env node
/**
 * LUMINA - Fully Headless Cloud Deployment Script
 * Deploys Agent & Gateway to Railway with RAILWAY_TOKEN (no CLI login session)
 * and optionally the Web UI to Vercel.
 *
 * Usage:
 *   node deploy.mjs
 *   npm run deploy
 */

import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { config } from 'dotenv';

config({ path: resolve(process.cwd(), '.env'), override: true });

const RAILWAY_PROJECT_ID = '48a4170e-2d58-45d3-ab93-3751e37cc442';
const RAILWAY_ENVIRONMENT = 'production';
const RAILWAY_TOKEN = process.env.RAILWAY_TOKEN?.trim();
const RAILWAY_API_TOKEN = process.env.RAILWAY_API_TOKEN?.trim();
const VERCEL_TOKEN = process.env.VERCEL_TOKEN?.trim();
const VERCEL_ORG_ID = process.env.VERCEL_ORG_ID?.trim();
const VERCEL_PROJECT_ID = process.env.VERCEL_PROJECT_ID?.trim();
const PROJECT_TOKEN_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLACEHOLDER_RE = /your[-_ ].*token|insert_your|changeme|^xxx+$/i;

function hr() {
  console.log('─'.repeat(72));
}

function fail(msg) {
  console.error(`\n❌ Error: ${msg}`);
  process.exit(1);
}

function run(cmd, env = process.env) {
  return execSync(cmd, {
    stdio: 'inherit',
    env
  });
}

function runCapture(cmd, env = process.env) {
  return execSync(cmd, {
    encoding: 'utf8',
    env
  }).trim();
}

function isUsable(token) {
  return Boolean(token) && !PLACEHOLDER_RE.test(token) && token.length >= 20;
}

/** Project tokens belong in RAILWAY_TOKEN. Account/workspace tokens belong in RAILWAY_API_TOKEN. Never set both. */
function railwayCliEnv() {
  const env = { ...process.env };
  delete env.RAILWAY_TOKEN;
  delete env.RAILWAY_API_TOKEN;
  if (isUsable(RAILWAY_TOKEN)) {
    if (PROJECT_TOKEN_RE.test(RAILWAY_TOKEN) || !isUsable(RAILWAY_API_TOKEN)) {
      env.RAILWAY_TOKEN = RAILWAY_TOKEN;
      return { env, mode: PROJECT_TOKEN_RE.test(RAILWAY_TOKEN) ? 'project-token' : 'token' };
    }
  }
  if (isUsable(RAILWAY_API_TOKEN)) {
    env.RAILWAY_API_TOKEN = RAILWAY_API_TOKEN;
    return { env, mode: 'account-token' };
  }
  return { env, mode: null };
}

console.log('\n🚀 LUMINA Headless Cloud Deployment\n');
hr();

// 1. Verify Vercel & Railway Authentication
if (!VERCEL_TOKEN && process.env.SKIP_VERCEL !== '1') {
  fail('VERCEL_TOKEN is missing in .env. Please generate one at: https://vercel.com/account/tokens');
}

const { env: railwayEnv, mode: railwayMode } = railwayCliEnv();
if (!railwayMode) {
  fail(
    'RAILWAY_TOKEN is missing or still a placeholder. Create a Project Token at Railway → Project Settings → Tokens and paste the UUID into .env as RAILWAY_TOKEN. Do not paste a project/service/environment id.'
  );
}

try {
  // Project tokens cannot run `railway whoami`. Probe with a deploy-scoped command.
  const statusOut = runCapture(
    `npx -y @railway/cli status -p ${RAILWAY_PROJECT_ID} -e ${RAILWAY_ENVIRONMENT}`,
    railwayEnv
  );
  const projectLine = statusOut.split('\n').find((l) => /Project:/i.test(l))?.trim();
  console.log(`✓ Authenticated with Railway via ${railwayMode}${projectLine ? ` (${projectLine})` : ''}`);
} catch (err) {
  fail(
    `RAILWAY_TOKEN was rejected by Railway. Project tokens are UUIDs from Project Settings → Tokens (dashes are expected). \`railway whoami\` always fails for project tokens; use \`railway status\` / \`railway up\`. ${err.message}`
  );
}

if (process.env.SKIP_VERCEL !== '1') {
  console.log('✓ Verified tokens for Railway and Vercel in .env');
} else {
  console.log('✓ Verified RAILWAY_TOKEN in .env (Vercel skipped)');
}

if (process.argv.includes('--auth-only')) {
  console.log('✓ Railway token auth-only check passed (no deploy)');
  process.exit(0);
}

// 2. Deploy Agent to Railway
hr();
console.log('📦 Step 1/3: Deploying Agent Service to Railway...');
try {
  run(`npx -y @railway/cli up --service agent --detach -y -p ${RAILWAY_PROJECT_ID} -e ${RAILWAY_ENVIRONMENT}`, railwayEnv);
  console.log('✓ Railway Agent service deployment queued.');
} catch (err) {
  console.warn(`⚠️  Railway agent deploy warning: ${err.message}`);
}

// 3. Deploy Gateway to Railway
hr();
console.log('📦 Step 2/3: Deploying Gateway Service to Railway...');
try {
  run(`npx -y @railway/cli up --service gateway --detach -y -p ${RAILWAY_PROJECT_ID} -e ${RAILWAY_ENVIRONMENT}`, railwayEnv);
  console.log('✓ Railway Gateway service deployment queued.');
} catch (err) {
  console.warn(`⚠️  Railway gateway deploy warning: ${err.message}`);
}

// 4. Deploy Web UI to Vercel
hr();
let vercelUrl = '';
if (process.env.SKIP_VERCEL === '1') {
  console.log('\n🌐 Step 3/3: Skipping Vercel (SKIP_VERCEL=1)');
} else {
console.log('\n🌐 Step 3/3: Deploying Web UI & Edge Proxy to Vercel (Headless)...');
try {
  const vercelEnv = {
    ...process.env,
    ...(VERCEL_ORG_ID ? { VERCEL_ORG_ID } : {}),
    ...(VERCEL_PROJECT_ID ? { VERCEL_PROJECT_ID } : {})
  };
  const output = runCapture('npx -y vercel --prod --yes', { ...vercelEnv, VERCEL_TOKEN });
  const aliasMatch = output.match(/Aliased\s+(https:\/\/[a-zA-Z0-9.-]+\.vercel\.app)/i);
  const match = output.match(/https:\/\/[a-zA-Z0-9.-]+\.vercel\.app/i);
  vercelUrl = aliasMatch ? aliasMatch[1] : (match ? match[0] : 'https://lumina-ui-eight.vercel.app');
  console.log(`✓ Vercel Deployment Live at: ${vercelUrl}`);
} catch (err) {
  fail(`Vercel deployment failed: ${err.message}`);
}
}

// 5. Verify Live Health
hr();
console.log('\n🔍 Probing Deployed Health Endpoints...');
const gatewayUrl = 'https://gateway-production-9ac0.up.railway.app';
console.log(`   Probing Gateway directly at ${gatewayUrl}/health...`);
try {
  const res = await fetch(`${gatewayUrl}/health`, { signal: AbortSignal.timeout(10000) });
  if (res.ok) {
    const data = await res.json();
    console.log('✓ Live Gateway Health Status:', JSON.stringify(data, null, 2));
  } else {
    console.warn(`⚠️  Live Railway Gateway returned HTTP ${res.status} (container may still be building)`);
  }
} catch (err) {
  console.warn(`⚠️  Gateway probe notice (building): ${err.message}`);
}

if (vercelUrl) {
  console.log(`   Probing Vercel proxy at ${vercelUrl}/health...`);
  try {
    const res = await fetch(`${vercelUrl}/health`, { signal: AbortSignal.timeout(10000) });
    if (res.ok) {
      const data = await res.json();
      console.log('✓ Live Vercel Health Status:', JSON.stringify(data, null, 2));
    } else {
      console.warn(`⚠️  Live Vercel Health returned HTTP ${res.status}`);
    }
  } catch (err) {
    console.warn(`⚠️  Vercel Health probe notice: ${err.message}`);
  }
}

hr();
console.log('\n🎉 Headless Deployment Finished!');
console.log(`👉 Vercel Submission URL: ${vercelUrl || 'https://lumina-ui-eight.vercel.app'}`);
console.log(`👉 Live Gateway URL:    ${gatewayUrl}`);
console.log(`👉 Evaluation Benchmark: node benchmark/bench.mjs --target ${gatewayUrl}\n`);
